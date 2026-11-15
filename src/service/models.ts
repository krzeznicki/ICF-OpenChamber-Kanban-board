// The models and agents a session can start with, as OpenCode's server lists them for the project
// (its opencode config can add providers and agents): `opencode api GET /api/model` and
// `GET /api/agent`, asked with the project in the x-opencode-directory header and kept in memory
// for 10 minutes per project. Models fall back to `opencode models` (one `provider/model` per line,
// no names or thinking levels) when the API answer fails. A failure is answered as
// `{ models: [], error }` / `{ agents: [], error }` and not cached, so the next request tries again.
import type { Exec } from '../core/types.ts';

export const MODELS_TTL_MS = 10 * 60 * 1000;
/** `opencode models` can take several seconds while it refreshes its provider catalogue. */
export const MODELS_TIMEOUT_MS = 60 * 1000;
const ERROR_MAX = 500;

/** A model: `provider/model` id, display name, and its thinking levels (OpenCode's variants). */
export type ModelInfo = { id: string; name: string; variants: string[] };
/** A session agent (mode primary, not hidden). */
export type AgentInfo = { id: string; name: string; description: string };

export type ModelListResult = { models: ModelInfo[]; error?: string };
export type AgentListResult = { agents: AgentInfo[]; error?: string };

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
/** `provider/model`, where the model part may itself hold slashes (openrouter/meta/llama). */
const MODEL = /^[^\s/]+\/\S*[^\s/]$/;
/** An agent id: one word. */
const AGENT = /^\S+$/;

/** The `provider/model` lines of `opencode models`, trimmed and deduplicated, in their order. */
export const parseModels = (stdout: string): string[] => {
  const seen = new Set<string>();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(ANSI, '').trim();
    if (MODEL.test(line)) seen.add(line);
  }
  return [...seen];
};

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** The `data` array of an OpenCode API answer, or null when the text is not such an answer. */
const dataOf = (stdout: string): unknown[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const data = record(parsed)?.data;
  return Array.isArray(data) ? data : null;
};

/**
 * `/api/model`'s `{ data: [{ id, providerID, name, variants: [{ id }] }] }` as ModelInfo, in its
 * order; the id is `providerID/id` (what `opencode models` prints and sessions.start takes).
 * Malformed entries and repeats are dropped; null when the answer is not a model list.
 */
export const parseApiModels = (stdout: string): ModelInfo[] | null => {
  const data = dataOf(stdout);
  if (data === null) return null;
  const out = new Map<string, ModelInfo>();
  for (const raw of data) {
    const m = record(raw);
    const provider = nonBlank(m?.providerID);
    const model = nonBlank(m?.id);
    if (m === null || provider === null || model === null) continue;
    const id = `${provider}/${model}`;
    if (!MODEL.test(id) || out.has(id)) continue;
    const variants = new Set<string>();
    if (Array.isArray(m.variants)) {
      for (const v of m.variants) {
        const vid = nonBlank(record(v)?.id);
        if (vid !== null) variants.add(vid);
      }
    }
    out.set(id, { id, name: nonBlank(m.name) ?? id, variants: [...variants] });
  }
  return [...out.values()];
};

/** `/api/agent`'s agents a session can run as: mode primary (or all), not hidden. Null when not an agent list. */
export const parseApiAgents = (stdout: string): AgentInfo[] | null => {
  const data = dataOf(stdout);
  if (data === null) return null;
  const out = new Map<string, AgentInfo>();
  for (const raw of data) {
    const a = record(raw);
    const id = nonBlank(a?.id);
    if (a === null || id === null || !AGENT.test(id) || out.has(id)) continue;
    if (a.hidden === true || (a.mode !== 'primary' && a.mode !== 'all')) continue;
    out.set(id, { id, name: nonBlank(a.name) ?? id, description: nonBlank(a.description) ?? '' });
  }
  return [...out.values()];
};

/** `opencode api GET <path>` for the project: the server reads the directory from this header (URI-encoded). */
export const apiArgs = (path: string, directory: string): string[] => [
  'api',
  'GET',
  path,
  '-H',
  `x-opencode-directory:${encodeURIComponent(directory)}`,
];

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const clip = (s: string): string => s.slice(0, ERROR_MAX);

type Attempt<T> = { ok: T } | { error: string };

/** Runs one opencode command and parses its stdout; any failure becomes `{ error }`. */
const attempt = async <T>(
  exec: Exec,
  what: string,
  args: string[],
  directory: string,
  parse: (stdout: string) => T | null,
): Promise<Attempt<T>> => {
  try {
    const r = await exec('opencode', args, { cwd: directory, timeoutMs: MODELS_TIMEOUT_MS });
    if (r.code !== 0) return { error: `${what} failed: ${clip(r.stderr.trim() || r.stdout.trim() || `exit code ${r.code}`)}` };
    const parsed = parse(r.stdout);
    return parsed === null ? { error: `could not read the answer of ${what}` } : { ok: parsed };
  } catch (e) {
    return { error: `${what} failed: ${clip(message(e))}` };
  }
};

/** One cached list per project directory: concurrent requests share a run; only successes are kept. */
const cachedPerDirectory = <T, R>(
  run: (directory: string) => Promise<{ value: T } | { error: string }>,
  empty: (error: string) => R,
  wrap: (value: T) => R,
  now: () => number,
): ((directory: string) => Promise<R>) => {
  const cache = new Map<string, { at: number; value: T }>();
  const running = new Map<string, Promise<R>>();
  const go = async (directory: string): Promise<R> => {
    const r = await run(directory);
    if ('error' in r) return empty(r.error);
    cache.set(directory, { at: now(), value: r.value });
    return wrap(r.value);
  };
  return (directory: string): Promise<R> => {
    const hit = cache.get(directory);
    if (hit !== undefined && now() - hit.at < MODELS_TTL_MS) return Promise.resolve(wrap(hit.value));
    const pending = running.get(directory);
    if (pending !== undefined) return pending;
    const p = go(directory).finally(() => running.delete(directory));
    running.set(directory, p);
    return p;
  };
};

/** The project's models: the API first, `opencode models` when that fails. */
export const createModelList = (exec: Exec, now: () => number = Date.now): ((directory: string) => Promise<ModelListResult>) => {
  const run = async (directory: string): Promise<{ value: ModelInfo[] } | { error: string }> => {
    const api = await attempt(exec, 'opencode api GET /api/model', apiArgs('/api/model', directory), directory, (s) => {
      const m = parseApiModels(s);
      return m === null || m.length === 0 ? null : m;
    });
    if ('ok' in api) return { value: api.ok };
    const cli = await attempt(exec, 'opencode models', ['models'], directory, parseModels);
    if ('error' in cli) return { error: `${api.error}; ${cli.error}` };
    if (cli.ok.length === 0) return { error: `${api.error}; opencode models listed no models` };
    return { value: cli.ok.map((id) => ({ id, name: id, variants: [] })) };
  };
  return cachedPerDirectory<ModelInfo[], ModelListResult>(
    run,
    (error) => ({ models: [], error }),
    (models) => ({ models: models.map((m) => ({ ...m, variants: [...m.variants] })) }),
    now,
  );
};

/** The project's session agents from the API (no fallback; a failure leaves the picker on the default). */
export const createAgentList = (exec: Exec, now: () => number = Date.now): ((directory: string) => Promise<AgentListResult>) => {
  const run = async (directory: string): Promise<{ value: AgentInfo[] } | { error: string }> => {
    const api = await attempt(exec, 'opencode api GET /api/agent', apiArgs('/api/agent', directory), directory, parseApiAgents);
    return 'ok' in api ? { value: api.ok } : api;
  };
  return cachedPerDirectory<AgentInfo[], AgentListResult>(
    run,
    (error) => ({ agents: [], error }),
    (agents) => ({ agents: agents.map((a) => ({ ...a })) }),
    now,
  );
};

export type ModelList = ReturnType<typeof createModelList>;
export type AgentList = ReturnType<typeof createAgentList>;
