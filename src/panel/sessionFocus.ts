// Opening the board from the rail panel inside a chat: the task (or tasks) that chat's session works
// on. Pure: no DOM, no host, so it runs under node:test.
import type { GuestSessionRecord } from '@openchamber/sdk';
import type { Task } from '../core/types.ts';
import type { Detached, SessionLink } from './columns.ts';

/**
 * The tasks this session works on, in the board's task order: those it carries as items (a path A
 * start) and those the service's links name for it (path B). A card the user dragged away after
 * the session (or link) was created no longer belongs to it, as on the board (columns.ts Detached).
 */
export const tasksForSession = (
  sessionId: string,
  tasks: readonly Task[],
  sessions: readonly GuestSessionRecord[],
  links: readonly SessionLink[] = [],
  detached: Detached = new Map(),
): Task[] => {
  /** task id -> when this session took it on (the newest record or link) */
  const since = new Map<string, number>();
  const note = (taskId: string, at: number): void => {
    if (at > (since.get(taskId) ?? -Infinity)) since.set(taskId, at);
  };
  const record = sessions.find((s) => s.id === sessionId);
  if (record !== undefined) for (const item of record.items) note(item.id, record.createdAt);
  for (const l of links) if (l.sessionId === sessionId) note(l.taskId, l.createdAt ?? 0);
  return tasks.filter((t) => {
    const at = since.get(t.id);
    return at !== undefined && at >= (detached.get(t.id) ?? 0);
  });
};

/** What the board shows for the session once: one task's modal, a list of them, a "none" notice. */
export type Focus = { kind: 'open'; taskId: string } | { kind: 'list'; tasks: Task[] } | { kind: 'none' } | { kind: 'wait' } | { kind: 'skip' };

/** What the board knows when it asks: `ready` once the project's tasks and sessions have loaded. */
export type FocusBoard = {
  ready: boolean;
  tasks: readonly Task[];
  sessions: readonly GuestSessionRecord[];
  links: readonly SessionLink[];
  detached: Detached;
};

/**
 * Decides once per panel frame (the panel was opened in the chat of `sessionId`): `wait` until the
 * board has loaded, then one answer, then `skip` for good. Without a session, always `skip`.
 */
export const createSessionFocus = (sessionId: string | null) => {
  let decided = sessionId === null;
  return {
    next: (board: FocusBoard): Focus => {
      if (decided || sessionId === null) return { kind: 'skip' };
      if (!board.ready) return { kind: 'wait' };
      decided = true;
      return decide(tasksForSession(sessionId, board.tasks, board.sessions, board.links, board.detached));
    },
  };
};

const decide = (tasks: readonly Task[]): Focus => {
  const first = tasks[0];
  if (first === undefined) return { kind: 'none' };
  return tasks.length === 1 ? { kind: 'open', taskId: first.id } : { kind: 'list', tasks: [...tasks] };
};
