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
import { nextToStart, type LinkStatus, type QueueEntry } from '../core/queue.ts';
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
    typeof e.queuedAt === 'number'
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
export const addToQueue = (file: string, dir: string, entry: QueueEntry, maxParallel?: number): Promise<QueueEntry[]> =>
  update(file, dir, (q) => {
    if (maxParallel !== undefined) q.maxParallel = clampMax(maxParallel);
    if (!q.entries.some((e) => e.taskId === entry.taskId)) q.entries.push(entry);
    return [...q.entries];
  });

export const removeFromQueue = (file: string, dir: string, taskId: string): Promise<QueueEntry[]> => {
  release(file, dir, taskId);
  return update(file, dir, (q) => {
    q.entries = q.entries.filter((e) => e.taskId !== taskId);
    return [...q.entries];
  });
};

// --- tasks being started, in memory (a restarted service forgets them, which only frees slots) ---

type Pending = { reserved: Map<string, number>; inFlight: Map<string, number> };
const pending = new Map<string, Pending>();
const pendingFor = (file: string, dir: string): Pending => {
  const key = `${file}\0${dir}`;
  let p = pending.get(key);
  if (p === undefined) {
    p = { reserved: new Map(), inFlight: new Map() };
    pending.set(key, p);
  }
  return p;
};

/** A link for the task was written (or its start was given up): it no longer counts as starting. */
export const release = (file: string, dir: string, taskId: string): void => {
  pendingFor(file, dir).reserved.delete(taskId);
};

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
    const links = await input.links();
    const live = new Set(links.filter((l) => l.status === 'busy' || l.status === 'waiting').map((l) => l.taskId));
    q.entries = q.entries.filter((e) => !live.has(e.taskId));
    const now = (input.now ?? Date.now)();
    const p = pendingFor(file, dir);
    const running = runningNow(links, p, input.starting ?? [], now);
    const ids = new Set(nextToStart(q.entries.map((e) => e.taskId), running, q.maxParallel));
    const taken = q.entries.filter((e) => ids.has(e.taskId));
    q.entries = q.entries.filter((e) => !ids.has(e.taskId));
    for (const e of taken) p.reserved.set(e.taskId, now);
    return { taken, queue: [...q.entries] };
  });
