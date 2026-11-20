// The service's routes, free of HTTP: `main.ts` reads the request and writes `{status, json}` back.
// Every POST body carries `directory`, the project root as an absolute path (for /project/of: the
// directory whose project is asked for).
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSessionEventRequest, SESSION_EVENTS_PATH, type GuestSessionEventRequest } from '@openchamber/sdk';
import { readConfig, readLabels, writeConfig, type ProjectConfig } from '../core/config.ts';
import { createGithubTracker } from '../core/githubTracker.ts';
import { openTracker } from '../core/openTracker.ts';
import { type CombinedTracker, sourceInfo } from '../core/sources.ts';
import type { Exec, NewTask, Task, TaskEdit, TaskState } from '../core/types.ts';
import { TrackerError } from '../core/types.ts';
import type { QueueEntry } from '../core/queue.ts';
import { createAgentList, createModelList, type AgentList, type ModelList } from './models.ts';
import { createSkillDetector, type SkillDetector } from './skills.ts';
import {
  addToQueue,
  clampMax,
  defaultQueueFile,
  inFlight,
  listQueue,
  queuedProjects,
  forgetRemoval,
  release,
  removeFromQueue,
  renameInQueue,
  requeueFailed,
  takeFromQueue,
} from './queue.ts';
import {
  addLink,
  defaultLinksFile,
  isInside,
  listLinks,
  removeLinks,
  renameLinks,
  startSession,
  withStatus,
  worktreesRoot,
  type SessionHost,
} from './sessions.ts';

export type Deps = {
  exec: Exec;
  /** Absolute path of the built CLI; defaults to `../build/cli/task-board.mjs` next to the service bundle. */
  cliPath?: string;
  /** OpenChamber's session control (createServiceHost(...).sessions); absent, /sessions/start fails. */
  sessions?: SessionHost;
  /** Where task -> session links are kept; defaults to ~/.icf-kanban/links.json. */
  linksFile?: string;
  /** Where the start queue is kept; defaults to ~/.icf-kanban/queue.json. */
  queueFile?: string;
  /** The worktree name's unique suffix; tests fix it. */
  suffix?: () => string;
  /** Where background failures (a queued start after a session event) are reported. */
  log?: (message: string) => void;
  /** Waits between the attempts of a start the host is not ready for (sessions.ts START_RETRY_MS); tests pass one that does not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** The project's models (`opencode api GET /api/model`, else `opencode models`), cached; defaults to one cache per `exec` (one per running service). */
  models?: ModelList;
  /** `opencode api GET /api/agent`, cached; defaults to one cache per `exec`, like `models`. */
  agents?: AgentList;
  /** Which of the known skills (Matt Pocock's, Superpowers) are installed, cached; defaults to one detector over the user's home. */
  skills?: SkillDetector;
};
/** `after` runs once the answer is sent (session events: answer first, then work). */
export type Reply = { status: number; json: unknown; after?: () => Promise<void> };

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

const withChildrenOf = (body: Body): boolean => {
  const w = body.withChildren;
  return w === undefined ? false : typeof w === 'boolean' ? w : invalid('"withChildren" must be a boolean');
};

/** The built CLI next to the service bundle (`service/main.js` -> `build/cli/task-board.mjs`). */
export const defaultCliPath = (): string => fileURLToPath(new URL('../build/cli/task-board.mjs', import.meta.url));

type Route = (body: Body, dir: string, deps: Deps) => Promise<unknown>;

const linksFile = (deps: Deps): string => deps.linksFile ?? defaultLinksFile();
const queueFile = (deps: Deps): string => deps.queueFile ?? defaultQueueFile();

const location = (v: unknown, key: string): 'worktree' | 'project' =>
  v === 'worktree' || v === 'project' ? v : invalid(`"${key}" must be "worktree" or "project"`);

const queueEntry = (v: unknown): QueueEntry => {
  if (!isObject(v)) return invalid('"entry" must be an object');
  const queuedAt = v.queuedAt;
  return {
    taskId: str(v, 'taskId'),
    title: str(v, 'title'),
    prompt: str(v, 'prompt'),
    model: optional(v, 'model'),
    agent: optional(v, 'agent'),
    variant: optional(v, 'variant'),
    location: location(v.location, 'entry.location'),
    queuedAt: queuedAt === undefined ? Date.now() : typeof queuedAt === 'number' ? queuedAt : invalid('"entry.queuedAt" must be a number'),
  };
};

const maxParallelOf = (body: Body): number | undefined =>
  body.maxParallel === undefined ? undefined : typeof body.maxParallel === 'number' ? clampMax(body.maxParallel) : invalid('"maxParallel" must be a number');

/** Path B, counted as starting for the queue until it ends; its link frees the queue's reservation. */
const start = async (dir: string, input: Omit<Parameters<typeof startSession>[0], 'directory'>, deps: Deps) => {
  if (deps.sessions === undefined) throw new TrackerError('FAILED', 'Starting sessions from the service is not available');
  const sessions = deps.sessions;
  try {
    return await inFlight(queueFile(deps), dir, input.taskId, () =>
      startSession(
        { directory: dir, ...input },
        {
          exec: deps.exec,
          sessions,
          linksFile: linksFile(deps),
          ...(deps.suffix ? { suffix: deps.suffix } : {}),
          ...(deps.log ? { log: deps.log } : {}),
          ...(deps.sleep ? { sleep: deps.sleep } : {}),
        },
      ),
    );
  } finally {
    release(queueFile(deps), dir, input.taskId);
  }
};

/** Where background failures go: `deps.log`, else stderr. */
const logOf = (deps: Deps): ((message: string) => void) => deps.log ?? ((m: string) => console.error(m));

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Runs a cleanup after a change that already happened: a failure is logged as `message: why`, never thrown. */
const bestEffort = async (deps: Deps, message: string, action: () => Promise<unknown>): Promise<void> => {
  try {
    await action();
  } catch (e) {
    logOf(deps)(`${message}: ${errorText(e)}`);
  }
};

const liveLinks = async (dir: string, deps: Deps) => withStatus(await listLinks(linksFile(deps), dir), deps.sessions);

const ERROR_MAX = 500;

/**
 * Takes what may start now from the project's queue and starts it by path B (the board may be
 * closed). A failed start (its new worktree and branch removed again) goes back to the front of
 * the queue with `lastError`, which the panel shows on the queued card; it is tried again on the
 * next drain, up to MAX_START_FAILURES times. A start whose session runs but whose link could not
 * be saved counts as started (startSession logs it), so it is never started twice.
 */
export const drainProject = async (dir: string, deps: Deps): Promise<void> => {
  const { taken } = await takeFromQueue(queueFile(deps), dir, { links: () => liveLinks(dir, deps) });
  const log = logOf(deps);
  await Promise.all(
    taken.map(async (e) => {
      try {
        await start(dir, { taskId: e.taskId, title: e.title, prompt: e.prompt, model: e.model, agent: e.agent, variant: e.variant ?? null, location: e.location }, deps);
        forgetRemoval(queueFile(deps), dir, e.taskId);
      } catch (err) {
        const why = (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MAX);
        log(`icf-kanban: could not start the queued task ${e.taskId}: ${why}`);
        await requeueFailed(queueFile(deps), dir, e, why).catch((w: unknown) =>
          log(`icf-kanban: could not put ${e.taskId} back in the queue: ${w instanceof Error ? w.message : String(w)}`),
        );
      }
    }),
  );
};

const DRAIN_EVENTS = new Set(['turn-finished', 'turn-failed']);

/**
 * A session finished a turn somewhere (events cover every project): drain each queued project the
 * session belongs to: its directory is the project, inside it, in its worktrees folder or in a
 * linked session's directory, or the session is one of its links.
 */
export const onSessionEvent = async (req: GuestSessionEventRequest, deps: Deps): Promise<void> => {
  const { event } = req;
  if (!DRAIN_EVENTS.has(event.type) || event.session.parentId !== null) return;
  const dir = event.project.directory;
  for (const project of await queuedProjects(queueFile(deps))) {
    const links = await listLinks(linksFile(deps), project);
    const ours =
      links.some((l) => l.sessionId === event.session.id) ||
      (dir !== null &&
        (isInside(dir, project) || isInside(dir, worktreesRoot(project)) || links.some((l) => isInside(dir, l.directory))));
    if (ours) await drainProject(project, deps);
  }
};

const modelLists = new WeakMap<Exec, ModelList>();
const modelList = (deps: Deps): ModelList => {
  if (deps.models !== undefined) return deps.models;
  let list = modelLists.get(deps.exec);
  if (list === undefined) {
    list = createModelList(deps.exec);
    modelLists.set(deps.exec, list);
  }
  return list;
};

const agentLists = new WeakMap<Exec, AgentList>();
const agentList = (deps: Deps): AgentList => {
  if (deps.agents !== undefined) return deps.agents;
  let list = agentLists.get(deps.exec);
  if (list === undefined) {
    list = createAgentList(deps.exec);
    agentLists.set(deps.exec, list);
  }
  return list;
};

let defaultSkills: SkillDetector | null = null;
const skillDetector = (deps: Deps): SkillDetector => deps.skills ?? (defaultSkills ??= createSkillDetector());

const tracker = (dir: string, deps: Deps): Promise<CombinedTracker> => openTracker(dir, deps.exec);

/** The config as the panel gets it: each source with its label and capabilities, the primary first. */
const configAnswer = (config: ProjectConfig) => ({ ...config, sources: config.sources.map(sourceInfo) });

/**
 * A task that got a new id (local: its file moved) takes its session links and queue entry along.
 * The move is done by then, so a failing re-key is logged and the caller still answers the moved task.
 */
const followMove = async (id: string, task: Task, dir: string, deps: Deps): Promise<void> => {
  if (task.id === id) return;
  const rekey = (what: string, action: () => Promise<unknown>): Promise<void> =>
    bestEffort(deps, `icf-kanban: ${id} is now ${task.id}, but its ${what} could not follow`, action);
  await rekey('session links', () => renameLinks(linksFile(deps), dir, id, task.id));
  await rekey('queue entry', () => renameInQueue(queueFile(deps), dir, id, task.id));
};

/** The config already in `dir`, or null when it has none (an unsupported one throws). */
const existingConfig = async (dir: string): Promise<ProjectConfig | null> => {
  try {
    return await readConfig(dir);
  } catch (e) {
    if (e instanceof TrackerError && e.code === 'NOT_CONFIGURED') return null;
    throw e;
  }
};

/**
 * A remote URL without credentials: an http(s) URL loses its whole `user[:token]@` part; another
 * scheme keeps its user (ssh://git@...) but loses a password. scp-style `git@github.com:o/r` stays.
 */
const withoutCredentials = (url: string): string =>
  /^https?:\/\//i.test(url)
    ? url.replace(/^(https?:\/\/)[^@/]*@/i, '$1')
    : url.replace(/^([a-z+]+:\/\/[^:@/]*):[^@/]*@/i, '$1@');

/** A github.com URL in `git remote -v` output, without credentials: `origin` first, else the first such remote. */
export const githubRemote = (output: string): string | null => {
  const remotes: Array<{ name: string; url: string }> = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^(\S+)\s+(\S+)/.exec(line);
    if (m === null) continue;
    const url = m[2]!;
    if (/^(?:[a-z+]+:\/\/)?(?:[^@/\s]+@)?github\.com[:/]/i.test(url)) remotes.push({ name: m[1]!, url: withoutCredentials(url) });
  }
  return (remotes.find((r) => r.name === 'origin') ?? remotes[0])?.url ?? null;
};

const detectRemote = async (dir: string, exec: Exec): Promise<string | null> => {
  const r = await exec('git', ['remote', '-v'], { cwd: dir });
  return r.code === 0 ? githubRemote(r.stdout) : null;
};

/**
 * The main checkout of the repository `dir` is in: for a worktree (OpenChamber's, or one made with
 * git) the directory it was made from. Null outside git and for a bare repository.
 */
const mainCheckout = async (dir: string, exec: Exec): Promise<string | null> => {
  const r = await exec('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir, timeoutMs: 10_000 });
  const common = r.code === 0 ? r.stdout.trim() : '';
  return isAbsolute(common) && basename(common) === '.git' ? dirname(common) : null;
};

const real = async (path: string): Promise<string | null> => {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
};

/**
 * Which of `candidates` (project directories, returned as given) the worktree `dir` belongs to:
 * the longest one holding its main checkout, else the only one inside that checkout (a project
 * registered as a folder of the repository). Paths are compared resolved, so a symlinked project matches.
 */
const projectOf = async (dir: string, candidates: readonly string[], exec: Exec): Promise<string | null> => {
  const checkout = await mainCheckout(dir, exec);
  const root = checkout === null ? null : await real(checkout);
  if (root === null) return null;
  const resolved = (await Promise.all(candidates.map(async (c) => ({ given: c, path: await real(c) })))).flatMap((c) =>
    c.path === null ? [] : [{ given: c.given, path: c.path }],
  );
  const holding = resolved.filter((c) => isInside(root, c.path)).sort((a, b) => b.path.length - a.path.length);
  if (holding[0] !== undefined) return holding[0].given;
  const within = resolved.filter((c) => isInside(c.path, root));
  return within.length === 1 ? within[0]!.given : null;
};

const POST: Record<string, Route> = {
  /** `directory` here is any directory (a session's worktree), not a project's. */
  '/project/of': async (body, dir, deps) => {
    const candidates = body.candidates;
    if (!Array.isArray(candidates) || !candidates.every((c): c is string => typeof c === 'string' && isAbsolute(c))) {
      return invalid('"candidates" must be an array of absolute paths');
    }
    return { project: await projectOf(dir, candidates, deps.exec) };
  },
  '/config/read': async (_body, dir) => {
    try {
      return { config: configAnswer(await readConfig(dir)) };
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
    // GitHub needs a github.com remote (gh works on it); without one nothing is written.
    if (kind === 'github' && (await detectRemote(dir, deps.exec)) === null) {
      throw new TrackerError('INVALID', 'This folder has no GitHub remote; add one or choose Local');
    }
    // GitHub: check gh before writing anything, so a missing or logged-out gh leaves the project untouched.
    // writeConfig never writes triage-labels.md, so the label strings are already final here.
    const gh = kind === 'github' ? createGithubTracker(dir, deps.exec, await readLabels(dir)) : null;
    await gh?.preflight();
    await writeConfig(dir, kind);
    const config = await readConfig(dir);
    if (config.tracker !== kind) alreadySetUp(config.tracker);
    await gh?.setupLabels();
    return { config: configAnswer(config) };
  },
  '/config/detect': async (_body, dir, deps) => ({ remote: await detectRemote(dir, deps.exec) }),
  /** `errors`: one per source that failed (SourceError); the other sources' tasks are still listed. */
  '/tasks/list': async (_body, dir, deps) => await (await tracker(dir, deps)).listAll(),
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
  /** Title and/or description (the tracker checks a blank title); the task keeps its id. */
  '/tasks/edit': async (body, dir, deps) => {
    const id = str(body, 'id');
    const changes: TaskEdit = {};
    for (const key of ['title', 'body'] as const) {
      const v = body[key];
      if (v === undefined) continue;
      changes[key] = typeof v === 'string' ? v : invalid(`"${key}" must be a string`);
    }
    if (Object.keys(changes).length === 0) return invalid('Give "title", "body" or both');
    return { task: await (await tracker(dir, deps)).edit(id, changes) };
  },
  /**
   * Links an existing task under an existing parent. The answer's task can have a new id (local:
   * the file moved); the task's session links and queue entry are re-keyed to it first.
   */
  '/tasks/parent': async (body, dir, deps) => {
    const id = str(body, 'id');
    const parentId = str(body, 'parentId');
    const task = await (await tracker(dir, deps)).setParent(id, parentId);
    await followMove(id, task, dir, deps);
    return { task };
  },
  /** Unlinks a sub-task from its parent; a changed id (local: it became a feature) is re-keyed as in /tasks/parent. */
  '/tasks/unparent': async (body, dir, deps) => {
    const id = str(body, 'id');
    const task = await (await tracker(dir, deps)).removeParent(id);
    await followMove(id, task, dir, deps);
    return { task };
  },
  '/tasks/close': async (body, dir, deps) => {
    const id = str(body, 'id');
    return { tasks: await (await tracker(dir, deps)).close(id, { withChildren: withChildrenOf(body) }) };
  },
  /**
   * Deletes the task (and with `withChildren` its sub-tasks); answers every deleted id. Their session
   * links and queue entries go too. The delete is done by then, so a failing cleanup is only logged,
   * each on its own (a broken links file does not keep the queue entry).
   */
  '/tasks/delete': async (body, dir, deps) => {
    const id = str(body, 'id');
    const deleted = await (await tracker(dir, deps)).remove(id, { withChildren: withChildrenOf(body) });
    for (const taskId of deleted) {
      const why = (what: string): string => `icf-kanban: ${taskId} was deleted, but its ${what} could not be removed`;
      await bestEffort(deps, why('session links'), () => removeLinks(linksFile(deps), dir, taskId));
      await bestEffort(deps, why('queue entry'), () => removeFromQueue(queueFile(deps), dir, taskId));
    }
    return { deleted };
  },
  '/sessions/start': async (body, dir, deps) => {
    const taskId = str(body, 'taskId');
    const title = str(body, 'title');
    const prompt = str(body, 'prompt');
    const model = optional(body, 'model');
    const agent = optional(body, 'agent');
    const variant = optional(body, 'variant');
    const where = location(body.location, 'location');
    return start(dir, { taskId, title, prompt, model, agent, variant, location: where }, deps);
  },
  /** Links with the live status of their session (idle, busy, waiting, unknown). */
  '/links/list': async (_body, dir, deps) => ({
    links: (await liveLinks(dir, deps)).map((l) => (l.status === 'error' ? { ...l, status: 'unknown' as const } : l)),
  }),
  /** A session the panel started itself (path A), so the queue counts it while it runs. */
  '/links/add': async (body, dir, deps) => {
    const taskId = str(body, 'taskId');
    const sessionId = str(body, 'sessionId');
    const at = optional(body, 'sessionDirectory');
    if (at !== null && !isAbsolute(at)) return invalid('"sessionDirectory" must be an absolute path');
    await addLink(linksFile(deps), dir, { taskId, sessionId, directory: at ?? dir, createdAt: Date.now() });
    release(queueFile(deps), dir, taskId);
    return {};
  },
  /** `{ models: [{ id: 'provider/model', name, variants }] }`; a failure is `{ models: [], error }`, never an error status. */
  '/models/list': async (_body, dir, deps) => modelList(deps)(dir),
  /** `{ agents: [{ id, name, description }] }` (session agents); a failure is `{ agents: [], error }`, never an error status. */
  '/agents/list': async (_body, dir, deps) => agentList(deps)(dir),
  /** `{ found: [...], paths: {name: SKILL.md} }`: which of the known skills (core/skills.ts) are installed for this project, plugin cache included. */
  '/skills/detect': async (_body, dir, deps) => skillDetector(deps)(dir),
  '/queue/list': async (_body, dir, deps) => ({ queue: await listQueue(queueFile(deps), dir) }),
  '/queue/add': async (body, dir, deps) => ({ queue: await addToQueue(queueFile(deps), dir, queueEntry(body.entry), maxParallelOf(body)) }),
  '/queue/remove': async (body, dir, deps) => ({ queue: await removeFromQueue(queueFile(deps), dir, str(body, 'taskId')) }),
  '/queue/take': async (body, dir, deps) => {
    const ids = (key: string): string[] => {
      const s = body[key];
      return s === undefined
        ? []
        : Array.isArray(s) && s.every((id) => typeof id === 'string')
          ? (s as string[])
          : invalid(`"${key}" must be an array of task ids`);
    };
    const max = maxParallelOf(body);
    return takeFromQueue(queueFile(deps), dir, {
      ...(max !== undefined ? { maxParallel: max } : {}),
      starting: ids('starting'),
      running: ids('running'),
      links: () => liveLinks(dir, deps),
    });
  },
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
    if (path === SESSION_EVENTS_PATH) {
      if (m !== 'POST') return error(405, 'INVALID', `${path} does not accept ${m}`);
      const req = readSessionEventRequest(JSON.stringify(body ?? null));
      if (req === null) return error(400, 'INVALID', 'Not a session event of a known wire version');
      return { status: 200, json: { ok: true }, after: () => onSessionEvent(req, deps) };
    }
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
    return error(500, 'FAILED', errorText(e));
  }
};
