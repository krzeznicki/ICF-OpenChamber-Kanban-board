// Starting an agent for a card, once. Pure: the host calls come in as deps, so it runs under node:test.
// `isStarting` holds every task whose start is in flight or whose new session has not shown up in
// the sessions snapshot (or the service's links) yet; the board draws those cards in In Progress,
// and a second drop on one of them is 'already'.
import type { Task } from '../core/types.ts';
import type { StartOptions } from './settings.ts';

/** How long a started task waits for its session to appear before it counts as unstarted again. */
export const SETTLE_MS = 60_000;

/** `pending`: the start may have happened (a timed-out path B call); the card waits for its link. */
export type LaunchResult = 'started' | 'already' | 'failed' | 'pending';

export type LauncherDeps = {
  /**
   * Runs the start (path A or B); `sessionId: null` is a failure the dep has already reported, and
   * `pending: true` an answer that never came although the start may have run.
   */
  start: (task: Task, opts: StartOptions, prompt: string) => Promise<{ sessionId: string | null; pending?: boolean }>;
  /** The first message for the task; may fetch (the CLI path) and throw. */
  prompt: (task: Task, opts: StartOptions) => Promise<string>;
  isStarting: Set<string>;
  /** A non-archived running or waiting session already works on the task. */
  hasLiveSession: (taskId: string) => boolean;
  /** A thrown start or prompt (not a `sessionId: null` answer). */
  onError: (task: Task, error: unknown) => void;
  now?: () => number;
};

export const createLauncher = (deps: LauncherDeps) => {
  const now = deps.now ?? Date.now;
  /**
   * Started tasks waiting for their session to appear: task id -> session id (null: a pending
   * start whose session is not known yet) and start time.
   */
  const waiting = new Map<string, { sessionId: string | null; at: number }>();
  /** Tasks whose start call has not answered yet. */
  const inFlight = new Set<string>();

  /** `prompt` given (a queued entry): used as is, `deps.prompt` is not asked. */
  const launch = async (task: Task, opts: StartOptions, prompt?: string): Promise<LaunchResult> => {
    if (deps.isStarting.has(task.id) || deps.hasLiveSession(task.id)) return 'already';
    deps.isStarting.add(task.id);
    inFlight.add(task.id);
    let sessionId: string | null = null;
    let pending = false;
    try {
      const text = prompt ?? (await deps.prompt(task, opts));
      const r = await deps.start(task, opts, text);
      sessionId = r.sessionId;
      pending = sessionId === null && r.pending === true;
    } catch (e) {
      deps.onError(task, e);
    } finally {
      inFlight.delete(task.id);
    }
    if (sessionId === null && !pending) {
      deps.isStarting.delete(task.id);
      return 'failed';
    }
    waiting.set(task.id, { sessionId, at: now() });
    return pending ? 'pending' : 'started';
  };

  /**
   * After a sessions snapshot or a links reload: release the tasks whose session is now known
   * (or that waited longer than SETTLE_MS). A pending start (no session id) is released once
   * `taskKnown` finds a session for its task started after it. Returns true when something was released.
   */
  const settle = (known: (sessionId: string) => boolean, taskKnown?: (taskId: string, since: number) => boolean): boolean => {
    let changed = false;
    for (const [taskId, w] of waiting) {
      const found = w.sessionId !== null ? known(w.sessionId) : (taskKnown?.(taskId, w.at) ?? false);
      if (!found && (w.sessionId === null || now() - w.at < SETTLE_MS)) continue;
      waiting.delete(taskId);
      deps.isStarting.delete(taskId);
      changed = true;
    }
    return changed;
  };

  /** Project switch: nothing in flight belongs to the new project's board. */
  const reset = (): void => {
    waiting.clear();
    inFlight.clear();
    deps.isStarting.clear();
  };

  /** Task ids whose start call is running now (the queue counts them as starting). */
  const starting = (): string[] => [...inFlight];

  return { launch, settle, reset, starting };
};

export type Launcher = ReturnType<typeof createLauncher>;
