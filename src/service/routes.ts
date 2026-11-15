// The service's routes, free of HTTP: `main.ts` reads the request and writes `{status, json}` back.
// Every POST body carries `directory`, the project root as an absolute path.
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, readLabels, writeConfig, type ProjectConfig } from '../core/config.ts';
import { createGithubTracker } from '../core/githubTracker.ts';
import { openTracker } from '../core/openTracker.ts';
import type { Exec, NewTask, TaskState, Tracker } from '../core/types.ts';
import { TrackerError } from '../core/types.ts';
import { defaultLinksFile, listLinks, startSession, type SessionHost } from './sessions.ts';

export type Deps = {
  exec: Exec;
  /** Absolute path of the built CLI; defaults to `../build/cli/task-board.mjs` next to the service bundle. */
  cliPath?: string;
  /** OpenChamber's session control (createServiceHost(...).sessions); absent, /sessions/start fails. */
  sessions?: SessionHost;
  /** Where task -> session links are kept; defaults to ~/.icf-kanban/links.json. */
  linksFile?: string;
  /** The worktree name's unique suffix; tests fix it. */
  suffix?: () => string;
};
export type Reply = { status: number; json: unknown };

const STATES: readonly TaskState[] = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix', 'done'];

/** Bad request parameters: answered 400, unlike a TrackerError (422). */
class InvalidRequest extends Error {}

const invalid = (message: string): never => {
  throw new InvalidRequest(message);
};

const error = (status: number, code: string, message: string): Reply => ({ status, json: { error: { code, message } } });

type Body = Record<string, unknown>;

const isObject = (v: unknown): v is Body => typeof v === 'object' && v !== null && !Array.isArray(v);

const optional = (body: Body, key: string): string | null => {
  const v = body[key];
  if (v === undefined || v === null) return null;
  return typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : invalid(`"${key}" must be a string or null`);
};

const str = (body: Body, key: string): string => {
  const v = body[key];
  return typeof v === 'string' && v.trim() !== '' ? v : invalid(`"${key}" must be a non-empty string`);
};

const state = (v: unknown, key: string): TaskState =>
  typeof v === 'string' && (STATES as readonly string[]).includes(v)
    ? (v as TaskState)
    : invalid(`"${key}" must be one of ${STATES.join(', ')}`);

const directoryOf = async (body: unknown): Promise<string> => {
  if (!isObject(body)) return invalid('Request body must be a JSON object with "directory"');
  const dir = body.directory;
  if (typeof dir !== 'string' || !isAbsolute(dir)) return invalid('"directory" must be an absolute path');
  let isDir = false;
  try {
    isDir = (await stat(dir)).isDirectory();
  } catch {
    // Missing or unreadable: reported below.
  }
  return isDir ? dir : invalid(`"directory" is not an existing directory: ${dir}`);
};

const newTask = (v: unknown): NewTask => {
  if (!isObject(v)) return invalid('"input" must be an object with "title"');
  const task: NewTask = { title: str(v, 'title') };
  if (v.body !== undefined) task.body = typeof v.body === 'string' ? v.body : invalid('"input.body" must be a string');
  if (v.type !== undefined) task.type = str(v, 'type');
  if (v.state !== undefined) task.state = state(v.state, 'input.state');
  if (v.parentId !== undefined) task.parentId = str(v, 'parentId');
  if (v.blockedBy !== undefined) {
    const b = v.blockedBy;
    task.blockedBy =
      Array.isArray(b) && b.every((id) => typeof id === 'string' && id.trim() !== '')
        ? (b as string[])
        : invalid('"input.blockedBy" must be an array of task ids');
  }
  return task;
};

const defaultCliPath = (): string => fileURLToPath(new URL('../build/cli/task-board.mjs', import.meta.url));

type Route = (body: Body, dir: string, deps: Deps) => Promise<unknown>;

const tracker = (dir: string, deps: Deps): Promise<Tracker> => openTracker(dir, deps.exec);

/** The config already in `dir`, or null when it has none (an unsupported one throws). */
const existingConfig = async (dir: string): Promise<ProjectConfig | null> => {
  try {
    return await readConfig(dir);
  } catch (e) {
    if (e instanceof TrackerError && e.code === 'NOT_CONFIGURED') return null;
    throw e;
  }
};

/** A github.com URL in `git remote -v` output: `origin` first, else the first such remote. */
export const githubRemote = (output: string): string | null => {
  const remotes: Array<{ name: string; url: string }> = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^(\S+)\s+(\S+)/.exec(line);
    if (m === null) continue;
    const url = m[2]!;
    if (/^(?:[a-z+]+:\/\/)?(?:[^@/\s]+@)?github\.com[:/]/i.test(url)) remotes.push({ name: m[1]!, url });
  }
  return (remotes.find((r) => r.name === 'origin') ?? remotes[0])?.url ?? null;
};

const POST: Record<string, Route> = {
  '/config/read': async (_body, dir) => {
    try {
      return { config: await readConfig(dir) };
    } catch (e) {
      // The panel branches on these: an unconfigured project shows the tracker picker.
      if (e instanceof TrackerError && (e.code === 'NOT_CONFIGURED' || e.code === 'UNSUPPORTED')) {
        return { error: { code: e.code, message: e.message } };
      }
      throw e;
    }
  },
  '/config/init': async (body, dir, deps) => {
    const kind = body.tracker;
    if (kind !== 'local' && kind !== 'github') return invalid('"tracker" must be "local" or "github"');
    const alreadySetUp = (tracker: string): never => {
      throw new TrackerError(
        'INVALID',
        `docs/agents/issue-tracker.md already configures the ${tracker} tracker; it was left unchanged`,
      );
    };
    const existing = await existingConfig(dir);
    if (existing !== null && existing.tracker !== kind) alreadySetUp(existing.tracker);
    // GitHub: check gh before writing anything, so a missing or logged-out gh leaves the project untouched.
    // writeConfig never writes triage-labels.md, so the label strings are already final here.
    const gh = kind === 'github' ? createGithubTracker(dir, deps.exec, await readLabels(dir)) : null;
    await gh?.preflight();
    await writeConfig(dir, kind);
    const config = await readConfig(dir);
    if (config.tracker !== kind) alreadySetUp(config.tracker);
    await gh?.setupLabels();
    return { config };
  },
  '/config/detect': async (_body, dir, deps) => {
    const r = await deps.exec('git', ['remote', '-v'], { cwd: dir });
    return { remote: r.code === 0 ? githubRemote(r.stdout) : null };
  },
  '/tasks/list': async (_body, dir, deps) => ({ tasks: await (await tracker(dir, deps)).list() }),
  '/tasks/get': async (body, dir, deps) => {
    const id = str(body, 'id');
    return { task: await (await tracker(dir, deps)).get(id) };
  },
  '/tasks/create': async (body, dir, deps) => {
    const input = newTask(body.input);
    return { task: await (await tracker(dir, deps)).create(input) };
  },
  '/tasks/state': async (body, dir, deps) => {
    const id = str(body, 'id');
    const to = state(body.state, 'state');
    return { task: await (await tracker(dir, deps)).setState(id, to) };
  },
  '/tasks/type': async (body, dir, deps) => {
    const id = str(body, 'id');
    const type = str(body, 'type');
    return { task: await (await tracker(dir, deps)).setType(id, type) };
  },
  '/tasks/close': async (body, dir, deps) => {
    const id = str(body, 'id');
    const w = body.withChildren;
    const withChildren = w === undefined ? false : typeof w === 'boolean' ? w : invalid('"withChildren" must be a boolean');
    return { tasks: await (await tracker(dir, deps)).close(id, { withChildren }) };
  },
  '/sessions/start': async (body, dir, deps) => {
    const taskId = str(body, 'taskId');
    const title = str(body, 'title');
    const prompt = str(body, 'prompt');
    const model = optional(body, 'model');
    const agent = optional(body, 'agent');
    const location = body.location;
    if (location !== 'worktree' && location !== 'project') return invalid('"location" must be "worktree" or "project"');
    if (deps.sessions === undefined) throw new TrackerError('FAILED', 'Starting sessions from the service is not available');
    return startSession(
      { directory: dir, taskId, title, prompt, model, agent, location },
      { exec: deps.exec, sessions: deps.sessions, linksFile: deps.linksFile ?? defaultLinksFile(), ...(deps.suffix ? { suffix: deps.suffix } : {}) },
    );
  },
  '/links/list': async (_body, dir, deps) => ({ links: await listLinks(deps.linksFile ?? defaultLinksFile(), dir) }),
};

const GET: Record<string, (deps: Deps) => unknown> = {
  '/health': () => ({}),
  '/cli': (deps) => ({ path: deps.cliPath ?? defaultCliPath() }),
};

export const handle = async (method: string, path: string, body: unknown, deps: Deps): Promise<Reply> => {
  try {
    const m = method.toUpperCase();
    const get = GET[path];
    const post = POST[path];
    if (get === undefined && post === undefined) return error(404, 'NOT_FOUND', `No route ${path}`);
    if (m === 'GET' && get !== undefined) return { status: 200, json: get(deps) };
    if (m === 'POST' && post !== undefined) {
      const dir = await directoryOf(body);
      return { status: 200, json: await post(body as Body, dir, deps) };
    }
    return error(405, 'INVALID', `${path} does not accept ${m}`);
  } catch (e) {
    if (e instanceof InvalidRequest) return error(400, 'INVALID', e.message);
    if (e instanceof TrackerError) return error(422, e.code, e.message);
    return error(500, 'FAILED', e instanceof Error ? e.message : String(e));
  }
};
