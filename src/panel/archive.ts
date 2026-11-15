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

/** The one rule for "archived": a done task with a mark (a stale mark on a reopened task does not count). */
export const isArchived = (task: Task, marks: { has: (id: string) => boolean }): boolean => task.state === 'done' && marks.has(task.id);

/**
 * Two frames' marks (rail panel and full-screen page share the storage): the newest archivedAt per
 * id. `removed` (id -> when this frame unarchived it) drops marks of the other side archived before then.
 */
export const mergeArchived = (mine: ArchivedTasks, stored: ArchivedTasks, removed: ArchivedTasks = new Map()): Map<string, number> => {
  const out = new Map<string, number>();
  for (const source of [mine, stored]) {
    for (const [id, at] of source) {
      if (at <= (removed.get(id) ?? 0)) continue;
      if (at > (out.get(id) ?? 0)) out.set(id, at);
    }
  }
  return out;
};

/**
 * Whether a load may take a stored value (the archive marks, the card order) over this frame's
 * memory. Every write of it (a user change or a load's reconcile) takes a number from `edit()` and reports `written(n)` only
 * once the store accepted it. Writes are collapsed (createLatestSaver): a waiting job may be replaced
 * by a newer one and never run, which is fine because numbers grow, so the newest write covers it.
 * A failed write leaves memory in charge until a later one succeeds.
 */
export const createStorageSync = () => {
  let edits = 0;
  let written = 0;
  return {
    edit: (): number => ++edits,
    written: (n: number): void => {
      if (n > written) written = n;
    },
    /** Taken when a load starts reading storage. */
    loadToken: (): number => (written === edits ? edits : -1),
    /** Storage read with this token is current: nothing was unwritten at the start, nothing changed since. */
    trusts: (token: number): boolean => token !== -1 && token === edits,
  };
};

/** What a write of one project's marks takes along when it is queued. */
export type ArchiveSnapshot = { marks: ArchivedTasks; removed: ArchivedTasks; tasks: readonly Task[] | null };

/**
 * The job that writes one project's marks. Everything it writes is taken when it is queued, not when
 * it runs, so a project switch (which resets memory) or a wait behind a running write loses nothing.
 * Memory only builds up between queuings, so the newest queued snapshot holds the change of any job
 * the saver replaced. When it runs it joins what storage holds now (the other frame's marks, minus
 * this frame's unarchives), reconciles with the snapshot's tasks, writes, then reports what it wrote.
 * A failed read writes the snapshot alone; a failed write throws and reports nothing.
 */
export const archiveWriteJob =
  (
    snap: ArchiveSnapshot,
    io: { load: () => Promise<ArchivedTasks>; save: (marks: ReadonlyMap<string, number>) => Promise<void> },
    onWritten: (marks: Map<string, number>) => void,
  ) =>
  async (): Promise<void> => {
    const stored = await io.load().catch(() => null);
    const merged = stored === null ? new Map(snap.marks) : mergeArchived(snap.marks, stored, snap.removed);
    const next = snap.tasks === null ? merged : reconcileArchived(merged, snap.tasks).marks;
    await io.save(next);
    onWritten(next);
  };

/**
 * The marks queued for writing per project and not yet written. createLatestSaver drops a waiting
 * job when a newer one for the same key arrives, and the newer snapshot may lack its marks (memory
 * was rebuilt from storage after a project switch). So every new snapshot joins what is still
 * queued (minus this frame's unarchives), and is remembered as queued under its sequence number. A
 * write with that number or later clears it; a failed write keeps it for the next snapshot.
 */
export const createPendingMarks = () => {
  const pending = new Map<string, { marks: Map<string, number>; n: number }>();
  return {
    queue: (projectId: string, marks: ArchivedTasks, removed: ArchivedTasks, n: number): Map<string, number> => {
      const prev = pending.get(projectId);
      const joined = prev === undefined ? new Map(marks) : mergeArchived(marks, prev.marks, removed);
      pending.set(projectId, { marks: joined, n });
      return joined;
    },
    written: (projectId: string, n: number): void => {
      const prev = pending.get(projectId);
      if (prev !== undefined && n >= prev.n) pending.delete(projectId);
    },
  };
};
