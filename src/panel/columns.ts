// Which board column a task sits in. Pure: no DOM, no host, so it runs under node:test.
// In Progress and Review come only from OpenChamber sessions and are never written to the repo.
import type { GuestSessionActivity, GuestSessionRecord } from '@openchamber/sdk';
import type { Task } from '../core/types.ts';

export type Column = 'backlog' | 'ready' | 'in_progress' | 'review' | 'done';

export const COLUMNS: readonly { id: Column; title: string }[] = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'ready', title: 'Ready' },
  { id: 'in_progress', title: 'In Progress' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' },
];

export type SessionInfo = {
  id: string;
  activity: GuestSessionActivity;
  outcome: 'completed' | 'failed' | null;
  archived: boolean;
};

/** The session works right now (running or retrying). */
export const isWorking = (session: SessionInfo | null): boolean =>
  session !== null && !session.archived && (session.activity === 'running' || session.activity === 'retrying');

/**
 * `parentSessionRunning`: the task's parent has a working orchestrator session (the caller asks
 * sessionForTask for the parent). A sub-task the orchestrator claimed then sits in In Progress.
 */
export const columnFor = (task: Task, session: SessionInfo | null, queued: boolean, parentSessionRunning = false): Column => {
  if (task.state === 'done') return 'done';
  if (queued) return 'in_progress';
  if (session !== null && !session.archived) {
    const a = session.activity;
    if (a === 'running' || a === 'retrying') return 'in_progress';
    if (a === 'waiting-permission' || a === 'waiting-question') return 'review';
    if (a === 'idle' && session.outcome !== null) return 'review';
  }
  if (task.state === 'ready-for-agent' && task.claimed && parentSessionRunning) return 'in_progress';
  return task.state === 'ready-for-agent' ? 'ready' : 'backlog';
};

/**
 * A session the service knows works on a task: started by the service (path B, no items) or
 * recorded by the panel (path A). `status` is its live state from the service, when known.
 */
export type SessionLink = { taskId: string; sessionId: string; createdAt?: number; status?: 'idle' | 'busy' | 'waiting' | 'unknown' };

/** A linked session missing from the snapshot (e.g. in a sibling worktree project), from its live status. */
const fromLink = (link: SessionLink): SessionInfo | null => {
  switch (link.status) {
    case 'busy':
      return { id: link.sessionId, activity: 'running', outcome: null, archived: false };
    case 'waiting':
      return { id: link.sessionId, activity: 'waiting-question', outcome: null, archived: false };
    case 'idle':
      return { id: link.sessionId, activity: 'idle', outcome: 'completed', archived: false };
    default:
      return null;
  }
};

/**
 * The newest non-archived session that carries this task as one of its items, or that the
 * service's links name for it. When the snapshot has none, the newest link whose session is not in
 * the snapshot at all speaks through its live status (busy: in progress; waiting, idle: review).
 */
export const sessionForTask = (
  taskId: string,
  sessions: GuestSessionRecord[],
  links: readonly SessionLink[] = [],
): SessionInfo | null => {
  const linked = new Set(links.filter((l) => l.taskId === taskId).map((l) => l.sessionId));
  let best: GuestSessionRecord | null = null;
  for (const s of sessions) {
    if (s.archivedAt !== null) continue;
    if (!linked.has(s.id) && !s.items.some((item) => item.id === taskId)) continue;
    if (best === null || s.createdAt > best.createdAt || (s.createdAt === best.createdAt && s.updatedAt > best.updatedAt)) {
      best = s;
    }
  }
  if (best !== null) return { id: best.id, activity: best.activity, outcome: best.outcome, archived: false };
  let newest: SessionLink | null = null;
  for (const l of links) {
    if (l.taskId !== taskId || fromLink(l) === null || sessions.some((s) => s.id === l.sessionId)) continue;
    if (newest === null || (l.createdAt ?? 0) >= (newest.createdAt ?? 0)) newest = l;
  }
  return newest === null ? null : fromLink(newest);
};

/**
 * A not-done sub-task whose parent has a working orchestrator session: the orchestrator leads it,
 * so the board starts no session of its own for it.
 */
export const ledByOrchestrator = (
  task: Task,
  sessions: GuestSessionRecord[],
  links: readonly SessionLink[] = [],
): boolean => task.parentId !== null && task.state !== 'done' && isWorking(sessionForTask(task.parentId, sessions, links));

export type CardModel = {
  task: Task;
  session: SessionInfo | null;
  /** Ids of listed, not-done tasks this one waits for. A blocker missing from the list is treated as finished. */
  blockers: string[];
  /** Sub-task counts for a task with children in the list; null otherwise. */
  progress: { done: number; total: number } | null;
  /** Drawn indented right under its parent in the same column. */
  child: boolean;
  /** Its start is in flight, or its new session has not shown up yet. */
  starting: boolean;
  /** It waits in the start queue (over the limit of running sessions). */
  queued: boolean;
  /** Why the service's last start of this queued card failed; null otherwise. */
  queueError: string | null;
  /** A sub-task whose parent's orchestrator session works now (see ledByOrchestrator). */
  ledByOrchestrator: boolean;
};

export type BoardModel = Record<Column, CardModel[]>;

/**
 * Sort tasks into columns. Within a column the service's order is kept, except that a sub-task
 * whose parent sits in the same column follows it directly. `hideSubtasks` drops every task with a parent.
 * `starting` (starts in flight) and `queued` (the start queue) both put a card in In Progress.
 */
export const groupTasks = (
  tasks: Task[],
  sessions: GuestSessionRecord[],
  starting: ReadonlySet<string>,
  hideSubtasks: boolean,
  links: readonly SessionLink[] = [],
  queued: ReadonlySet<string> = new Set(),
  queueErrors: ReadonlyMap<string, string> = new Map(),
): BoardModel => {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const children = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parentId === null || !byId.has(t.parentId)) continue;
    const list = children.get(t.parentId) ?? [];
    list.push(t);
    children.set(t.parentId, list);
  }

  const parentWorking = new Map<string, boolean>();
  const parentRunning = (parentId: string | null): boolean => {
    if (parentId === null) return false;
    let running = parentWorking.get(parentId);
    if (running === undefined) {
      running = isWorking(sessionForTask(parentId, sessions, links));
      parentWorking.set(parentId, running);
    }
    return running;
  };

  const cards = new Map<string, { column: Column; card: CardModel }>();
  for (const task of tasks) {
    if (hideSubtasks && task.parentId !== null) continue;
    const session = sessionForTask(task.id, sessions, links);
    const kids = children.get(task.id) ?? [];
    const led = task.state !== 'done' && parentRunning(task.parentId);
    cards.set(task.id, {
      column: columnFor(task, session, starting.has(task.id) || (queued.has(task.id) && task.state !== 'done'), led),
      card: {
        task,
        session,
        blockers: task.blockedBy.filter((id) => {
          const b = byId.get(id);
          return b !== undefined && b.state !== 'done';
        }),
        progress: kids.length === 0 ? null : { done: kids.filter((k) => k.state === 'done').length, total: kids.length },
        child: false,
        starting: starting.has(task.id) && session === null,
        queued: queued.has(task.id) && !starting.has(task.id) && task.state !== 'done',
        queueError: queued.has(task.id) && !starting.has(task.id) && task.state !== 'done' ? (queueErrors.get(task.id) ?? null) : null,
        ledByOrchestrator: led,
      },
    });
  }

  const board: BoardModel = { backlog: [], ready: [], in_progress: [], review: [], done: [] };
  const placed = new Set<string>();
  for (const task of tasks) {
    const entry = cards.get(task.id);
    if (entry === undefined || placed.has(task.id)) continue;
    // A sub-task waits for its parent when both share a column.
    const parent = task.parentId === null ? undefined : cards.get(task.parentId);
    if (parent !== undefined && parent.column === entry.column && !placed.has(task.parentId as string)) continue;
    board[entry.column].push(entry.card);
    placed.add(task.id);
    for (const kid of children.get(task.id) ?? []) {
      const k = cards.get(kid.id);
      if (k === undefined || placed.has(kid.id) || k.column !== entry.column) continue;
      board[entry.column].push({ ...k.card, child: true });
      placed.add(kid.id);
    }
  }
  return board;
};
