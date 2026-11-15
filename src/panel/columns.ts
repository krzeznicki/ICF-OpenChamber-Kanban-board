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

export const columnFor = (task: Task, session: SessionInfo | null, queued: boolean): Column => {
  if (task.state === 'done') return 'done';
  if (queued) return 'in_progress';
  if (session !== null && !session.archived) {
    const a = session.activity;
    if (a === 'running' || a === 'retrying') return 'in_progress';
    if (a === 'waiting-permission' || a === 'waiting-question') return 'review';
    if (a === 'idle' && session.outcome !== null) return 'review';
  }
  return task.state === 'ready-for-agent' ? 'ready' : 'backlog';
};

/** A session the service started for a task (path B): such a session carries no items. */
export type SessionLink = { taskId: string; sessionId: string };

/**
 * The newest non-archived session that carries this task as one of its items, or that the
 * service's links name for it.
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
  return best === null ? null : { id: best.id, activity: best.activity, outcome: best.outcome, archived: false };
};

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
};

export type BoardModel = Record<Column, CardModel[]>;

/**
 * Sort tasks into columns. Within a column the service's order is kept, except that a sub-task
 * whose parent sits in the same column follows it directly. `hideSubtasks` drops every task with a parent.
 */
export const groupTasks = (
  tasks: Task[],
  sessions: GuestSessionRecord[],
  queued: ReadonlySet<string>,
  hideSubtasks: boolean,
  links: readonly SessionLink[] = [],
): BoardModel => {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const children = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parentId === null || !byId.has(t.parentId)) continue;
    const list = children.get(t.parentId) ?? [];
    list.push(t);
    children.set(t.parentId, list);
  }

  const cards = new Map<string, { column: Column; card: CardModel }>();
  for (const task of tasks) {
    if (hideSubtasks && task.parentId !== null) continue;
    const session = sessionForTask(task.id, sessions, links);
    const kids = children.get(task.id) ?? [];
    cards.set(task.id, {
      column: columnFor(task, session, queued.has(task.id)),
      card: {
        task,
        session,
        blockers: task.blockedBy.filter((id) => {
          const b = byId.get(id);
          return b !== undefined && b.state !== 'done';
        }),
        progress: kids.length === 0 ? null : { done: kids.filter((k) => k.state === 'done').length, total: kids.length },
        child: false,
        starting: queued.has(task.id) && session === null,
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
