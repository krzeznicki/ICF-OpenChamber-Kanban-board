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
export type SessionLink = { taskId: string; sessionId: string; createdAt?: number; status?: 'idle' | 'busy' | 'waiting' | 'unknown' | 'archived' };

/**
 * Links whose session a host lookup found archived (resolveSession) read `archived`: sessions.status
 * still answers `idle` for them, which would keep their card in Review. Such a link places no card.
 */
export const markArchived = <L extends SessionLink>(links: readonly L[], archived: ReadonlySet<string>): L[] =>
  archived.size === 0 ? [...links] : links.map((l) => (archived.has(l.sessionId) ? { ...l, status: 'archived' as const } : l));

/** The archived marks still worth keeping: those of sessions some link still names. */
export const pruneArchived = (archived: ReadonlySet<string>, links: readonly SessionLink[]): Set<string> => {
  const named = new Set(links.map((l) => l.sessionId));
  return new Set([...archived].filter((id) => named.has(id)));
};

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
 * When the user dragged a card with a session to Backlog or Ready (task id -> ms timestamp):
 * sessions and links created before it no longer speak for the card, which then follows its state.
 */
export type Detached = ReadonlyMap<string, number>;

const NONE: Detached = new Map();

/**
 * The newest non-archived session that carries this task as one of its items, or that the
 * service's links name for it. When the snapshot has none, the newest link whose session is not in
 * the snapshot at all speaks through its live status (busy: in progress; waiting, idle: review).
 * With `detachedAt` (see Detached), sessions and links created before it are ignored.
 */
export const sessionForTask = (
  taskId: string,
  sessions: GuestSessionRecord[],
  links: readonly SessionLink[] = [],
  detachedAt = 0,
): SessionInfo | null => {
  const linked = new Set(links.filter((l) => l.taskId === taskId).map((l) => l.sessionId));
  let best: GuestSessionRecord | null = null;
  for (const s of sessions) {
    if (s.archivedAt !== null || s.createdAt < detachedAt) continue;
    if (!linked.has(s.id) && !s.items.some((item) => item.id === taskId)) continue;
    if (best === null || s.createdAt > best.createdAt || (s.createdAt === best.createdAt && s.updatedAt > best.updatedAt)) {
      best = s;
    }
  }
  if (best !== null) return { id: best.id, activity: best.activity, outcome: best.outcome, archived: false };
  let newest: SessionLink | null = null;
  for (const l of links) {
    if (l.taskId !== taskId || (l.createdAt ?? 0) < detachedAt || fromLink(l) === null || sessions.some((s) => s.id === l.sessionId)) continue;
    if (newest === null || (l.createdAt ?? 0) >= (newest.createdAt ?? 0)) newest = l;
  }
  return newest === null ? null : fromLink(newest);
};

/**
 * What the task modal's "Open session" may do. Only a non-archived record of the project's own
 * snapshot is `open`. A session known only from a link (`check`) must first be found, not archived,
 * in a host snapshot (resolveSession): sessions.status answers `idle` for an archived session too,
 * and host.openSession given an id it cannot open lands on some other session.
 * `archived`: the task's sessions (after a detach) are all archived.
 */
export type SessionTarget = { kind: 'open'; id: string } | { kind: 'check'; id: string } | { kind: 'archived' } | { kind: 'none' };

export const sessionTarget = (
  taskId: string,
  sessions: GuestSessionRecord[],
  links: readonly SessionLink[] = [],
  detachedAt = 0,
): SessionTarget => {
  const s = sessionForTask(taskId, sessions, links, detachedAt);
  if (s !== null) return sessions.some((r) => r.id === s.id) ? { kind: 'open', id: s.id } : { kind: 'check', id: s.id };
  const linked = new Set(links.filter((l) => l.taskId === taskId).map((l) => l.sessionId));
  const archived =
    sessions.some(
      (r) => r.archivedAt !== null && r.createdAt >= detachedAt && (linked.has(r.id) || r.items.some((item) => item.id === taskId)),
    ) || links.some((l) => l.taskId === taskId && l.status === 'archived' && (l.createdAt ?? 0) >= detachedAt);
  return archived ? { kind: 'archived' } : { kind: 'none' };
};

export type SessionLookup = 'open' | 'archived' | 'missing' | 'pending';

/**
 * A session id looked up in host snapshots (every project's): only `open` may go to host.openSession.
 * Not found while a snapshot is still `loading` is `pending` (it may yet appear), not `missing`.
 */
export const resolveSession = (
  sessionId: string,
  snapshots: readonly { state: 'loading' | 'ready' | 'error'; sessions: readonly GuestSessionRecord[] }[],
): SessionLookup => {
  for (const snap of snapshots) {
    const r = snap.sessions.find((s) => s.id === sessionId);
    if (r !== undefined) return r.archivedAt === null ? 'open' : 'archived';
  }
  return snapshots.some((snap) => snap.state === 'loading') ? 'pending' : 'missing';
};

/**
 * A not-done sub-task whose parent has a working orchestrator session: the orchestrator leads it,
 * so the board starts no session of its own for it.
 */
export const ledByOrchestrator = (
  task: Task,
  sessions: GuestSessionRecord[],
  links: readonly SessionLink[] = [],
  detached: Detached = NONE,
): boolean =>
  task.parentId !== null && task.state !== 'done' && isWorking(sessionForTask(task.parentId, sessions, links, detached.get(task.parentId)));

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
  /** An archived done task, drawn (muted) only while "Show archived" is on (archive.ts). */
  archived: boolean;
};

/** Done tasks the user archived (archive.ts) and whether they are shown. */
export type ArchiveView = { ids: ReadonlySet<string>; show: boolean };

const NO_ARCHIVE: ArchiveView = { ids: new Set(), show: false };

export type BoardModel = Record<Column, CardModel[]>;

/**
 * Sort tasks into columns. Within a column the service's order is kept, except that a sub-task
 * whose parent sits in the same column follows it directly. `hideSubtasks` drops every task with a parent.
 * `starting` (starts in flight) and `queued` (the start queue) both put a card in In Progress.
 * `archive`: archived done tasks are left out unless shown; a parent's progress still counts them.
 */
export const groupTasks = (
  tasks: Task[],
  sessions: GuestSessionRecord[],
  starting: ReadonlySet<string>,
  hideSubtasks: boolean,
  links: readonly SessionLink[] = [],
  queued: ReadonlySet<string> = new Set(),
  queueErrors: ReadonlyMap<string, string> = new Map(),
  detached: Detached = NONE,
  archive: ArchiveView = NO_ARCHIVE,
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
      running = isWorking(sessionForTask(parentId, sessions, links, detached.get(parentId)));
      parentWorking.set(parentId, running);
    }
    return running;
  };

  const cards = new Map<string, { column: Column; card: CardModel }>();
  for (const task of tasks) {
    if (hideSubtasks && task.parentId !== null) continue;
    const isArchived = task.state === 'done' && archive.ids.has(task.id);
    if (isArchived && !archive.show) continue;
    const session = sessionForTask(task.id, sessions, links, detached.get(task.id));
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
        archived: isArchived,
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
