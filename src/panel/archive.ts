// "Archive done": done tasks the user cleared off the board. Only the panel's own storage changes
// (archivedTasks:<projectId>, task id -> when it was archived); the repo and GitHub stay as they are,
// the tasks are already resolved or closed. Pure, so it runs under node:test.
import type { Task } from '../core/types.ts';

/** Task id -> ms timestamp of its archiving. */
export type ArchivedTasks = ReadonlyMap<string, number>;

/** Marks kept per project (one storage value holds at most 64 KiB); the oldest go first. */
export const ARCHIVE_MAX = 400;

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** The stored `{ id, archivedAt }[]`, read defensively: bad entries are dropped, a later entry for an id wins. */
export const parseArchivedTasks = (raw: unknown): Map<string, number> => {
  const out = new Map<string, number>();
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    const r = record(entry);
    if (r === null || typeof r.id !== 'string' || r.id === '') continue;
    const at = r.archivedAt;
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) continue;
    out.delete(r.id);
    out.set(r.id, at);
  }
  return out;
};

/** What is stored: oldest first, the newest ARCHIVE_MAX kept. */
export const serializeArchived = (marks: ArchivedTasks): { id: string; archivedAt: number }[] =>
  [...marks]
    .sort((a, b) => a[1] - b[1])
    .slice(-ARCHIVE_MAX)
    .map(([id, archivedAt]) => ({ id, archivedAt }));

/** What "Archive done" archives: every done task not archived yet (also sub-tasks hidden by "Hide sub-tasks"). */
export const archivableIds = (tasks: readonly Task[], marks: ArchivedTasks): string[] =>
  tasks.filter((t) => t.state === 'done' && !marks.has(t.id)).map((t) => t.id);

export const archiveTasks = (marks: ArchivedTasks, ids: readonly string[], at: number): Map<string, number> => {
  const next = new Map(marks);
  for (const id of ids) next.set(id, at);
  return next;
};

export const unarchiveTask = (marks: ArchivedTasks, id: string): Map<string, number> => {
  const next = new Map(marks);
  next.delete(id);
  return next;
};

/**
 * After a load: marks of tasks the tracker no longer lists are pruned, and a task that left Done
 * (reopened) is unarchived. `changed` says whether the stored value needs a write.
 */
export const reconcileArchived = (marks: ArchivedTasks, tasks: readonly Task[]): { marks: Map<string, number>; changed: boolean } => {
  const done = new Set(tasks.filter((t) => t.state === 'done').map((t) => t.id));
  const next = new Map([...marks].filter(([id]) => done.has(id)));
  return { marks: next, changed: next.size !== marks.size };
};

/** How many listed tasks are archived (the "Show archived (N)" count). */
export const archivedShown = (tasks: readonly Task[], marks: ArchivedTasks): number =>
  tasks.filter((t) => t.state === 'done' && marks.has(t.id)).length;
