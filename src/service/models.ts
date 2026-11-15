// The models a session can start with: `opencode models` (one `provider/model` per line), run in the
// project (its opencode config can add providers) and kept in memory for 10 minutes per project.
// A failure is answered as `{ models: [], error }` and not cached, so the next request tries again.
import type { Exec } from '../core/types.ts';

export const MODELS_TTL_MS = 10 * 60 * 1000;
/** `opencode models` can take several seconds while it refreshes its provider catalogue. */
export const MODELS_TIMEOUT_MS = 60 * 1000;
const ERROR_MAX = 500;

export type ModelListResult = { models: string[]; error?: string };

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
/** `provider/model`, where the model part may itself hold slashes (openrouter/meta/llama). */
const MODEL = /^[^\s/]+\/\S*[^\s/]$/;

/** The `provider/model` lines of `opencode models`, trimmed and deduplicated, in their order. */
export const parseModels = (stdout: string): string[] => {
  const seen = new Set<string>();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(ANSI, '').trim();
    if (MODEL.test(line)) seen.add(line);
  }
  return [...seen];
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A cached `opencode models` per project directory. */
export const createModelList = (exec: Exec, now: () => number = Date.now) => {
  const cache = new Map<string, { at: number; models: string[] }>();
  const running = new Map<string, Promise<ModelListResult>>();

  const run = async (directory: string): Promise<ModelListResult> => {
    try {
      const r = await exec('opencode', ['models'], { cwd: directory, timeoutMs: MODELS_TIMEOUT_MS });
      if (r.code !== 0) {
        const why = (r.stderr.trim() || r.stdout.trim() || `exit code ${r.code}`).slice(0, ERROR_MAX);
        return { models: [], error: `opencode models failed: ${why}` };
      }
      const models = parseModels(r.stdout);
      if (models.length === 0) return { models: [], error: 'opencode models listed no models' };
      cache.set(directory, { at: now(), models });
      return { models };
    } catch (e) {
      return { models: [], error: `opencode models failed: ${message(e).slice(0, ERROR_MAX)}` };
    }
  };

  return (directory: string): Promise<ModelListResult> => {
    const hit = cache.get(directory);
    if (hit !== undefined && now() - hit.at < MODELS_TTL_MS) return Promise.resolve({ models: [...hit.models] });
    const pending = running.get(directory);
    if (pending !== undefined) return pending;
    const p = run(directory).finally(() => running.delete(directory));
    running.set(directory, p);
    return p;
  };
};

export type ModelList = ReturnType<typeof createModelList>;
