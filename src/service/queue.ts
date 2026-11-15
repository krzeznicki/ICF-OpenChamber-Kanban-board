// The start queue, kept by the service so it drains with the board closed (spec "Queue").
// ~/.icf-kanban/queue.json holds, per project directory, the waiting entries (oldest first) and the
// limit the panel last sent. Every change runs under one lock per file (store.ts), so a take by the
// panel and a take after a session event never hand out the same entry.
//
// The running count is: sessions of the project's links that are busy or waiting, plus tasks
// that are being started and have no such link yet: entries handed out by a take (reserved until
// their link is written, or RESERVE_MS), starts the service is running, and the ids the panel says
// it is starting itself.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MAX_START_FAILURES, nextToStart, type LinkStatus, type QueueEntry } from '../core/queue.ts';
import { readJson, serial, writeJson } from './store.ts';

export const defaultQueueFile = (): string => join(homedir(), '.icf-kanban', 'queue.json');

export const DEFAULT_MAX_PARALLEL = 3;
export const MAX_PARALLEL_LIMIT = 10;
/** How long a taken entry counts as starting when no link for it shows up. */
export const RESERVE_MS = 180_000;

type ProjectQueue = { maxParallel: number; entries: QueueEntry[] };
type QueueFile = { version: 1; projects: Record<string, ProjectQueue> };

const isEntry = (v: unknown): v is QueueEntry => {
  const e = v as Partial<QueueEntry> | null;
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof e.taskId === 'string' &&
    typeof e.title === 'string' &&
    typeof e.prompt === 'string' &&
    (e.model === null || typeof e.model === 'string') &&
    (e.agent === null || typeof e.agent === 'string') &&
    (e.location === 'worktree' || e.location === 'project') &&
    typeof e.queuedAt === 'number' &&
    (e.lastError === undefined || typeof e.lastError === 'string') &&
    (e.failures === undefined || (typeof e.failures === 'number' && Number.isFinite(e.failures)))
  );
};

export const clampMax = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(MAX_PARALLEL_LIMIT, Math.max(1, Math.round(n))) : DEFAULT_MAX_PARALLEL;

const readQueueFile = async (file: string): Promise<QueueFile> => {
  const raw = await readJson(file);
  const projects: Record<string, ProjectQueue> = {};
  const src = (raw as { projects?: unknown } | null)?.projects;
  if (typeof src === 'object' && src !== null && !Array.isArray(src)) {
    for (const [dir, q] of Object.entries(src)) {
      const p = q as Partial<ProjectQueue> | null;
      if (typeof p !== 'object' || p === null || !Array.isArray(p.entries)) continue;
      projects[dir] = { maxParallel: clampMax(p.maxParallel), entries: p.entries.filter(isEntry) };
    }
  }
  return { version: 1, projects };
};

/** Read-modify-write under the file's lock; a project left with no entries is dropped. */
const update = <T>(file: string, dir: string, fn: (q: ProjectQueue) => Promise<T> | T): Promise<T> =>
  serial(file, async () => {
    const data = await readQueueFile(file);
    const q = data.projects[dir] ?? { maxParallel: DEFAULT_MAX_PARALLEL, entries: [] };
    const before = JSON.stringify(data.projects[dir] ?? null);
    const result = await fn(q);
    if (q.entries.length === 0) delete data.projects[dir];
    else data.projects[dir] = q;
    if (JSON.stringify(data.projects[dir] ?? null) !== before) await writeJson(file, data);
    return result;
  });

export const listQueue = async (file: string, dir: string): Promise<QueueEntry[]> =>
  (await readQueueFile(file)).projects[dir]?.entries ?? [];

/** Every project directory with a non-empty queue. */
export const queuedProjects = async (file: string): Promise<string[]> =>
  Object.entries((await readQueueFile(file)).projects)
    .filter(([, q]) => q.entries.length > 0)
    .map(([dir]) => dir);

/** Appends the entry unless its task already waits (then only the limit is updated). */
export const addToQueue = (file: string, dir: string, entry: QueueEntry, maxParallel?: number): Promise<QueueEntry[]> => {
  // Queued again by the user: an earlier removal no longer stands.
  forgetRemoval(file, dir, entry.taskId);
  return update(file, dir, (q) => {
    if (maxParallel !== undefined) q.maxParallel = clampMax(maxParallel);
    if (!q.entries.some((e) => e.taskId === entry.taskId)) q.entries.push(entry);
    return [...q.entries];
  });
};

export const removeFromQueue = (file: string, dir: string, taskId: string): Promise<QueueEntry[]> => {
  const p = pendingFor(file, dir);
  // Taken and still starting: remember the removal, so a failed start does not put it back.
  if (p.reserved.has(taskId) || p.inFlight.has(taskId)) p.removed.add(taskId);
  release(file, dir, taskId);
  return update(file, dir, (q) => {
    q.entries = q.entries.filter((e) => e.taskId !== taskId);
    return [...q.entries];
  });
};

/** An entry that failed MAX_START_FAILURES times: it stays listed but is never taken automatically. */
export const isStuck = (e: QueueEntry): boolean => (e.failures ?? 0) >= MAX_START_FAILURES;

/**
 * A taken entry whose start failed: back at the front of the queue (replacing a copy queued again
 * meanwhile) with the reason and one more failure, and no longer reserved. It is retried on the
 * next drain, not in a loop, until it failed MAX_START_FAILURES times; then it waits for the user.
 * An entry the user removed while it was starting stays removed.
 */
export const requeueFailed = (file: string, dir: string, entry: QueueEntry, error: string): Promise<QueueEntry[]> => {
  release(file, dir, entry.taskId);
  if (forgetRemoval(file, dir, entry.taskId)) return listQueue(file, dir);
  const failures = (entry.failures ?? 0) + 1;
  const lastError =
    failures >= MAX_START_FAILURES
      ? `${error} (failed ${failures} times; not retried automatically: move the card out of In Progress and back to try again)`
      : error;
  return update(file, dir, (q) => {
    q.entries = q.entries.filter((e) => e.taskId !== entry.taskId);
    q.entries.unshift({ ...entry, lastError, failures });
    return [...q.entries];
  });
};

// --- tasks being started, in memory (a restarted service forgets them, which only frees slots) ---

/** `removed`: tombstones of taken entries the user removed while they were starting. */
type Pending = { reserved: Map<string, number>; inFlight: Map<string, number>; removed: Set<string> };
const pending = new Map<string, Pending>();
const pendingFor = (file: string, dir: string): Pending => {
  const key = `${file}\0${dir}`;
  let p = pending.get(key);
  if (p === undefined) {
    p = { reserved: new Map(), inFlight: new Map(), removed: new Set() };
    pending.set(key, p);
  }
  return p;
};

/** A link for the task was written (or its start was given up): it no longer counts as starting. */
export const release = (file: string, dir: string, taskId: string): void => {
  pendingFor(file, dir).reserved.delete(taskId);
};

/** Clears the task's removal tombstone; true when there was one. Called when its start ended. */
export const forgetRemoval = (file: string, dir: string, taskId: string): boolean => pendingFor(file, dir).removed.delete(taskId);

/** Counts a start the service runs from its start until it ends. */
export const inFlight = async <T>(file: string, dir: string, taskId: string, fn: () => Promise<T>): Promise<T> => {
  const p = pendingFor(file, dir);
  p.inFlight.set(taskId, (p.inFlight.get(taskId) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const n = (p.inFlight.get(taskId) ?? 1) - 1;
    if (n <= 0) p.inFlight.delete(taskId);
    else p.inFlight.set(taskId, n);
  }
};

export type LiveLink = { taskId: string; sessionId: string; status: LinkStatus };

export type TakeInput = {
  /** The limit from the panel's settings; absent (a session event), the one stored with the queue. */
  maxParallel?: number;
  /** Task ids the panel is starting itself right now. */
  starting?: readonly string[];
  /** Task ids the panel's sessions snapshot shows working (running or waiting): the count never falls below them. */
  running?: readonly string[];
  /** The project's links with their live status, read when the lock is held. */
  links: () => Promise<LiveLink[]>;
  now?: () => number;
};

/** Running sessions plus tasks being started that have no running session yet. */
export const runningNow = (links: readonly LiveLink[], p: Pending, starting: readonly string[], now: number): number => {
  for (const [taskId, at] of p.reserved) if (now - at >= RESERVE_MS) p.reserved.delete(taskId);
  const live = links.filter((l) => l.status === 'busy' || l.status === 'waiting');
  const liveTasks = new Set(live.map((l) => l.taskId));
  const starts = new Set([...p.reserved.keys(), ...p.inFlight.keys(), ...starting]);
  let n = new Set(live.map((l) => l.sessionId)).size;
  for (const id of starts) if (!liveTasks.has(id)) n++;
  return n;
};

/**
 * Removes and returns the entries that may start now (nextToStart over the running count) and
 * reserves them. An entry whose task already has a running session is dropped: it is not started twice.
 */
export const takeFromQueue = (file: string, dir: string, input: TakeInput): Promise<{ taken: QueueEntry[]; queue: QueueEntry[] }> =>
  update(file, dir, async (q) => {
    if (input.maxParallel !== undefined) q.maxParallel = clampMax(input.maxParallel);
    if (q.entries.length === 0) return { taken: [], queue: [] };
    if (q.entries.every(isStuck)) return { taken: [], queue: [...q.entries] };
    const links = await input.links();
    // Fail closed: a status lookup that failed (no grant, host unreachable, rate limit) means the
    // running count is unknown, so nothing starts; the next event or panel drain tries again.
    if (links.some((l) => l.status === 'error')) return { taken: [], queue: [...q.entries] };
    const live = new Set(links.filter((l) => l.status === 'busy' || l.status === 'waiting').map((l) => l.taskId));
    q.entries = q.entries.filter((e) => !live.has(e.taskId));
    const now = (input.now ?? Date.now)();
    const p = pendingFor(file, dir);
    const running = runningNow(links, p, [...(input.starting ?? []), ...(input.running ?? [])], now);
    // A stuck entry stays listed (the card shows its error) but neither starts nor holds up the rest.
    const ids = new Set(nextToStart(q.entries.filter((e) => !isStuck(e)).map((e) => e.taskId), running, q.maxParallel));
    const taken = q.entries.filter((e) => ids.has(e.taskId));
    q.entries = q.entries.filter((e) => !ids.has(e.taskId));
    for (const e of taken) p.reserved.set(e.taskId, now);
    return { taken, queue: [...q.entries] };
  });
