// The model, thinking and agent pickers' logic, free of DOM: the options they show and the
// per-project list loaders. A picked model is `provider/model`, a thinking level one of its
// variants, an agent a session agent's id; null means "the default" (what the card or layer
// inherits, finally OpenChamber's current selection).

/** As the service lists them (POST /models/list, /agents/list). */
/** `variantsKnown: false`: the list came from `opencode models`, so the levels are unknown, not absent. */
export type ModelInfo = { id: string; name: string; variants: string[]; variantsKnown?: false };
export type AgentInfo = { id: string; name: string; description: string };

/** The lists the start options pick from; each loads once per project and rejects with the reason on failure. */
export type StartLists = { models: () => Promise<ModelInfo[]>; agents: () => Promise<AgentInfo[]> };

/** The pickers' first option: nothing set here. */
export const DEFAULT_ID = '';
/** The loading / failure row; picking it does not change the value (after a failure it retries). */
export const STATUS_ID = 'status:list'; // never a model (models have a slash), an agent or a level (no colon)

export type ModelOption = { id: string; label: string; hint?: string };

const HINT_MAX = 80;

/** The default option when nothing more specific is inherited. */
export const CURRENT_SELECTION = "Default — OpenChamber's current selection";

/** "Default (Claude Opus 5.5)", or "Default — OpenChamber's current selection" when nothing is inherited. */
export const defaultLabel = (inherited: string | null, word = 'Default'): string =>
  inherited === null ? `${word} — OpenChamber's current selection` : `${word} (${inherited})`;

/**
 * The thinking select's default: the inherited level; with none, a session with a model set starts
 * from the extension (path B) on the model's own default level, and one without on OpenChamber's.
 */
export const thinkingDefaultLabel = (inherited: string | null, hasModel: boolean, word = 'Default'): string =>
  inherited !== null ? `${word} (${inherited})` : hasModel ? `${word} — the model’s default` : defaultLabel(null, word);

/** The muted line under every set of start options. */
export const START_PATH_NOTE =
  'With a model, agent or thinking level set, the extension starts the session itself, in its own worktree (or the project folder). With none set, OpenChamber starts it with its current selection.';

const clip = (s: string): string => (s.length <= HINT_MAX ? s : `${s.slice(0, HINT_MAX - 1)}…`);

const statusRow = (what: string, error: string | undefined): ModelOption =>
  error === undefined
    ? { id: STATUS_ID, label: `Loading ${what}…` }
    : { id: STATUS_ID, label: `Couldn’t load ${what} — try again`, hint: clip(error) };

/** The stored value when the list does not hold it: plain while loading, marked once the list is known. */
const stored = (value: string | null, known: readonly string[] | null, missing: string): ModelOption[] =>
  value === null || value === DEFAULT_ID || (known ?? []).includes(value)
    ? []
    : [known === null ? { id: value, label: value } : { id: value, label: value, hint: missing }];

const byLabel = (a: ModelOption, b: ModelOption): number => {
  const x = a.label.toLowerCase();
  const y = b.label.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * The model picker's options: the default first; the stored model when it is not in the list;
 * then a loading or failure row while there is no list; then the models by name, the id as hint.
 * `models` is null until the list has loaded.
 */
export const modelOptions = (input: { models: readonly ModelInfo[] | null; value: string | null; defaultLabel: string; error?: string }): ModelOption[] => {
  const { models, value } = input;
  const out: ModelOption[] = [{ id: DEFAULT_ID, label: input.defaultLabel }];
  out.push(...stored(value, models === null ? null : models.map((m) => m.id), 'not in the list'));
  if (models === null) return [...out, statusRow('models', input.error)];
  const seen = new Set<string>();
  const list: ModelOption[] = [];
  for (const m of models) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    list.push(m.name === m.id ? { id: m.id, label: m.id } : { id: m.id, label: m.name, hint: m.id });
  }
  return [...out, ...list.sort(byLabel)];
};

/** What a pick means: `{ value }` (null for the default), or null for the status row. */
export const pickedModel = (id: string): { value: string | null } | null =>
  id === STATUS_ID ? null : { value: id === DEFAULT_ID ? null : id };

/** The agent picker's options: like the models', in the server's order, descriptions as hints. */
export const agentOptions = (input: { agents: readonly AgentInfo[] | null; value: string | null; defaultLabel: string; error?: string }): ModelOption[] => {
  const { agents, value } = input;
  const out: ModelOption[] = [{ id: DEFAULT_ID, label: input.defaultLabel }];
  out.push(...stored(value, agents === null ? null : agents.map((a) => a.id), 'not in the list'));
  if (agents === null) return [...out, statusRow('agents', input.error)];
  for (const a of agents) out.push(a.description === '' ? { id: a.id, label: a.name } : { id: a.id, label: a.name, hint: clip(a.description) });
  return out;
};

/**
 * The thinking select for `model` (the model the session would use: set here or inherited):
 * disabled, with the reason, when there is no model or the model has no levels; else the default
 * and the model's levels. A stored level the model lacks stays visible, marked. While the list
 * loads (models null) only the stored level and a loading row show.
 */
export const thinkingField = (input: {
  model: string | null;
  models: readonly ModelInfo[] | null;
  value: string | null;
  defaultLabel: string;
  error?: string;
}): { options: ModelOption[]; disabled: boolean; reason?: string } => {
  const first: ModelOption = { id: DEFAULT_ID, label: input.defaultLabel };
  const keep = (known: readonly string[] | null, missing = 'not offered by this model'): ModelOption[] => stored(input.value, known, missing);
  if (input.model === null) return { options: [first, ...keep([])], disabled: input.value === null, reason: 'Pick a model first' };
  if (input.models === null) return { options: [first, ...keep(null), statusRow('thinking levels', input.error)], disabled: false };
  const model = input.models.find((m) => m.id === input.model);
  // A model the list does not know: its levels are unknown, so a stored one is kept as is.
  if (model === undefined) return { options: [first, ...keep(null)], disabled: input.value === null, reason: 'Thinking levels unknown for this model' };
  if (model.variants.length === 0 && model.variantsKnown === false)
    return { options: [first, ...keep(null)], disabled: input.value === null, reason: 'Thinking levels unavailable' };
  if (model.variants.length === 0) return { options: [first, ...keep([])], disabled: input.value === null, reason: 'This model has no thinking levels' };
  return { options: [first, ...keep(model.variants), ...model.variants.map((v) => ({ id: v, label: v }))], disabled: false };
};

/**
 * The thinking level to keep when the model changes to `model`: kept when the new model offers it
 * or its levels are unknown (not listed, list not loaded, or back to the default model).
 */
export const keptVariant = (variant: string | null, model: string | null, models: readonly ModelInfo[] | null): string | null => {
  if (variant === null || model === null || models === null) return variant;
  const m = models.find((x) => x.id === model);
  return m === undefined || m.variantsKnown === false || m.variants.includes(variant) ? variant : null;
};

/**
 * The level after a model pick: checked against the model then in force (the picked one, else the
 * inherited one); with no model in force at all there is nothing to think with.
 */
export const variantAfterModelPick = (
  variant: string | null,
  picked: string | null,
  inherited: string | null,
  models: readonly ModelInfo[] | null,
): string | null => {
  const inForce = picked ?? inherited;
  return inForce === null ? null : keptVariant(variant, inForce, models);
};

/**
 * Before a start: a level the resolved model is known not to offer (a card's level set over an
 * inherited model that has since changed) is dropped, and named in `dropped`.
 */
export const offeredVariant = <T extends { model: string | null; variant: string | null }>(
  opts: T,
  models: readonly ModelInfo[] | null,
): { opts: T; dropped: string | null } => {
  const kept = keptVariant(opts.variant, opts.model, models);
  return kept === opts.variant ? { opts, dropped: null } : { opts: { ...opts, variant: kept }, dropped: opts.variant };
};

/**
 * Loads a list once per project directory (`directory()`; the service also caches per directory):
 * concurrent callers share one request, a success is kept, a failure (an `error` answer or a throw)
 * rejects and is tried again on the next call. No project (null) rejects.
 */
const createDirectoryLoader = <T>(
  fetch: (directory: string) => Promise<{ list: T[]; error?: string }>,
  directory: () => string | null,
): (() => Promise<T[]>) => {
  const kept = new Map<string, Promise<T[]>>();
  return () => {
    const dir = directory();
    if (dir === null) return Promise.reject(new Error('Open a project to load the list'));
    let p = kept.get(dir);
    if (p === undefined) {
      const fresh = fetch(dir).then((r) => {
        if (r.error !== undefined) throw new Error(r.error);
        return r.list;
      });
      fresh.catch(() => {
        if (kept.get(dir) === fresh) kept.delete(dir);
      });
      kept.set(dir, fresh);
      p = fresh;
    }
    return p;
  };
};

export type ModelsAnswer = { models: ModelInfo[]; error?: string };
export type AgentsAnswer = { agents: AgentInfo[]; error?: string };

export const createModelLoader = (
  fetchModels: (directory: string) => Promise<ModelsAnswer>,
  directory: () => string | null = () => '',
): (() => Promise<ModelInfo[]>) =>
  createDirectoryLoader(
    (d) => fetchModels(d).then((r) => ({ list: r.models, ...(r.error !== undefined ? { error: r.error } : {}) })),
    directory,
  );

export const createAgentLoader = (
  fetchAgents: (directory: string) => Promise<AgentsAnswer>,
  directory: () => string | null = () => '',
): (() => Promise<AgentInfo[]>) =>
  createDirectoryLoader(
    (d) => fetchAgents(d).then((r) => ({ list: r.agents, ...(r.error !== undefined ? { error: r.error } : {}) })),
    directory,
  );
