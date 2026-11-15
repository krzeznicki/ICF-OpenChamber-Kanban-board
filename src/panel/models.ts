// The model picker's logic, free of DOM: the options it shows and the session-wide list loader.
// A picked model is `provider/model`; null means "the default" (what the card or layer inherits,
// finally the model selected in OpenChamber).

/** The picker's first option: no model set here. */
export const DEFAULT_MODEL_ID = '';
/** The loading / failure row; picking it does not change the value (after a failure it retries). */
export const STATUS_ID = 'status:models'; // never a model: models have a slash

export type ModelOption = { id: string; label: string; hint?: string };

const HINT_MAX = 80;

/** "Default (anthropic/x)", or "Default (current selection)" when nothing more specific is inherited. */
export const defaultModelLabel = (inherited: string | null, word = 'Default'): string =>
  `${word} (${inherited ?? 'current selection'})`;

const clip = (s: string): string => (s.length <= HINT_MAX ? s : `${s.slice(0, HINT_MAX - 1)}…`);

/**
 * The picker's options: the default first; the stored model when it is not in the list (marked
 * once the list is known); then a loading or failure row while there is no list; then the models,
 * sorted. `models` is null until the list has loaded.
 */
export const modelOptions = (input: {
  models: readonly string[] | null;
  value: string | null;
  defaultLabel: string;
  error?: string;
}): ModelOption[] => {
  const { models, value } = input;
  const out: ModelOption[] = [{ id: DEFAULT_MODEL_ID, label: input.defaultLabel }];
  if (value !== null && value !== DEFAULT_MODEL_ID && !(models ?? []).includes(value)) {
    out.push(models === null ? { id: value, label: value } : { id: value, label: value, hint: 'not in the list' });
  }
  if (models === null) {
    out.push(
      input.error === undefined
        ? { id: STATUS_ID, label: 'Loading models…' }
        : { id: STATUS_ID, label: 'Couldn’t load models — try again', hint: clip(input.error) },
    );
    return out;
  }
  const sorted = [...new Set(models)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const m of sorted) out.push({ id: m, label: m });
  return out;
};

/** What a pick means: `{ value }` (null for the default), or null for the status row. */
export const pickedModel = (id: string): { value: string | null } | null =>
  id === STATUS_ID ? null : { value: id === DEFAULT_MODEL_ID ? null : id };

export type ModelsAnswer = { models: string[]; error?: string };

/**
 * Loads the list once per panel session: concurrent callers share one request, a success is kept,
 * a failure (an `error` answer or a throw) rejects and is tried again on the next call.
 */
export const createModelLoader = (fetchModels: () => Promise<ModelsAnswer>): (() => Promise<string[]>) => {
  let kept: Promise<string[]> | null = null;
  return () => {
    kept ??= fetchModels().then((r) => {
      if (r.error !== undefined) throw new Error(r.error);
      return r.models;
    });
    kept.catch(() => {
      kept = null;
    });
    return kept;
  };
};
