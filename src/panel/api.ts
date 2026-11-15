// Typed client for the extension's local service. The page has no network: every call goes
// through host.serviceRequest, and every POST body carries the project's absolute `directory`.
import type { HostClient } from '@openchamber/sdk';
import type { LinkStatus, QueueEntry } from '../core/queue.ts';
import type { NewTask, Task, TaskState } from '../core/types.ts';

export type LinkRecord = { taskId: string; sessionId: string; directory: string; createdAt: number; status: LinkStatus };

/** Mirrors core/config.ts's ProjectConfig without pulling Node code into the page's type graph. */
export type ProjectConfig = { tracker: 'local' | 'github'; labels: Record<string, string> };

export type ConfigResult = { config: ProjectConfig } | { error: { code: string; message: string } };

/** A failed call: a service error (`NOT_CONFIGURED`, `GH_AUTH`, …) or a host error (`NO_SERVICE`, …). */
export class ApiError extends Error {
  public code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const errorOf = (json: unknown, status: number): ApiError => {
  const e = (json as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const code = typeof e?.code === 'string' ? e.code : 'FAILED';
  const message = typeof e?.message === 'string' ? e.message : `The service answered ${status}`;
  return new ApiError(code, message);
};

export const createApi = (host: HostClient, directory: string) => {
  const call = async <T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> => {
    let res: { status: number; body: string };
    try {
      res = await host.serviceRequest({
        method,
        path,
        ...(method === 'POST' ? { body: JSON.stringify({ ...body, directory }) } : {}),
      });
    } catch (e) {
      const code = typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : 'FAILED';
      throw new ApiError(code, e instanceof Error ? e.message : String(e));
    }
    const json = parse(res.body);
    if (res.status !== 200) throw errorOf(json, res.status);
    return json as T;
  };

  return {
    directory,
    readConfig: () => call<ConfigResult>('POST', '/config/read'),
    initConfig: (tracker: 'local' | 'github') =>
      call<{ config: ProjectConfig }>('POST', '/config/init', { tracker }).then((r) => r.config),
    /** The github.com remote of the project (origin first), or null. */
    detect: () => call<{ remote: string | null }>('POST', '/config/detect').then((r) => r.remote),
    list: () => call<{ tasks: Task[] }>('POST', '/tasks/list').then((r) => r.tasks),
    get: (id: string) => call<{ task: Task }>('POST', '/tasks/get', { id }).then((r) => r.task),
    create: (input: NewTask) => call<{ task: Task }>('POST', '/tasks/create', { input }).then((r) => r.task),
    setState: (id: string, state: TaskState) =>
      call<{ task: Task }>('POST', '/tasks/state', { id, state }).then((r) => r.task),
    setType: (id: string, type: string) => call<{ task: Task }>('POST', '/tasks/type', { id, type }).then((r) => r.task),
    close: (id: string, withChildren = false) =>
      call<{ tasks: Task[] }>('POST', '/tasks/close', { id, withChildren }).then((r) => r.tasks),
    cliPath: () => call<{ path: string }>('GET', '/cli').then((r) => r.path),
    /** Path B: the service makes the worktree (if asked) and starts the session with this model/agent. */
    startSession: (input: {
      taskId: string;
      title: string;
      prompt: string;
      model: string | null;
      agent: string | null;
      location: 'worktree' | 'project';
    }) => call<{ sessionId: string; directory: string; worktree: string | null }>('POST', '/sessions/start', input),
    /** Sessions linked to this project's tasks (path B, and path A the panel recorded), with their live status. */
    listLinks: () => call<{ links: LinkRecord[] }>('POST', '/links/list').then((r) => r.links),
    /** Records a session the panel started (path A), so the queue counts it while it runs. */
    addLink: (taskId: string, sessionId: string, sessionDirectory: string | null) =>
      call<Record<string, never>>('POST', '/links/add', { taskId, sessionId, sessionDirectory }).then(() => undefined),
    listQueue: () => call<{ queue: QueueEntry[] }>('POST', '/queue/list').then((r) => r.queue),
    /** Idempotent per task; `maxParallel` is stored so the service drains with the same limit. */
    addToQueue: (entry: QueueEntry, maxParallel: number) =>
      call<{ queue: QueueEntry[] }>('POST', '/queue/add', { entry, maxParallel }).then((r) => r.queue),
    removeFromQueue: (taskId: string) => call<{ queue: QueueEntry[] }>('POST', '/queue/remove', { taskId }).then((r) => r.queue),
    /** Atomically removes and returns the entries that may start now. */
    takeFromQueue: (maxParallel: number, starting: string[]) =>
      call<{ taken: QueueEntry[]; queue: QueueEntry[] }>('POST', '/queue/take', { maxParallel, starting }),
  };
};

export type Api = ReturnType<typeof createApi>;
