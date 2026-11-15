// Starting an agent for a card, once. Pure: the host calls come in as deps, so it runs under node:test.
// `isStarting` holds every task whose start is in flight or whose new session has not shown up in
// the sessions snapshot (or the service's links) yet; the board draws those cards in In Progress,
// and a second drop on one of them is 'already'.
import type { Task } from '../core/types.ts';
import type { StartOptions } from './settings.ts';

/** How long a started task waits for its session to appear before it counts as unstarted again. */
export const SETTLE_MS = 60_000;

export type LaunchResult = 'started' | 'already' | 'failed';

export type LauncherDeps = {
  /** Runs the start (path A or B); `sessionId: null` is a failure the dep has already reported. */
  start: (task: Task, opts: StartOptions, prompt: string) => Promise<{ sessionId: string | null }>;
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
  /** Started tasks waiting for their session to appear: task id -> session id and start time. */
  const waiting = new Map<string, { sessionId: string; at: number }>();

  const launch = async (task: Task, opts: StartOptions): Promise<LaunchResult> => {
    if (deps.isStarting.has(task.id) || deps.hasLiveSession(task.id)) return 'already';
    deps.isStarting.add(task.id);
    let sessionId: string | null = null;
    try {
      const prompt = await deps.prompt(task, opts);
      sessionId = (await deps.start(task, opts, prompt)).sessionId;
    } catch (e) {
      deps.onError(task, e);
    }
    if (sessionId === null) {
      deps.isStarting.delete(task.id);
      return 'failed';
    }
    waiting.set(task.id, { sessionId, at: now() });
    return 'started';
  };

  /**
   * After a sessions snapshot or a links reload: release the tasks whose session is now known
   * (or that waited longer than SETTLE_MS). Returns true when something was released.
   */
  const settle = (known: (sessionId: string) => boolean): boolean => {
    let changed = false;
    for (const [taskId, w] of waiting) {
      if (!known(w.sessionId) && now() - w.at < SETTLE_MS) continue;
      waiting.delete(taskId);
      deps.isStarting.delete(taskId);
      changed = true;
    }
    return changed;
  };

  /** Project switch: nothing in flight belongs to the new project's board. */
  const reset = (): void => {
    waiting.clear();
    deps.isStarting.clear();
  };

  return { launch, settle, reset };
};

export type Launcher = ReturnType<typeof createLauncher>;
