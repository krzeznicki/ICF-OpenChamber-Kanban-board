// Layered settings: global defaults (per user) → project override (per user) → choice on the card.
// All of it lives in the extension's instance storage, never in the repo. The resolvers are pure
// so they run under node:test; createSettingsStore is the only part that touches storage.
import type { Task } from '../core/types.ts';
import { parseArchivedTasks, serializeArchived, type ArchivedTasks } from './archive.ts';
import { BUILTIN_PRESETS, isPristine, parseStoredPresets, usesMattSkills, type Preset, type SkillUse, type StoredPresets } from './presets.ts';
import { DEFAULT_SUMMARY_PROMPT } from './summaries.ts';

export type { Preset } from './presets.ts';

export type Location = 'worktree' | 'project';
/**
 * How a session starts. `model` is `provider/model`, `variant` its thinking level (an OpenCode
 * variant), `agent` a session agent's id; null means OpenChamber's current selection (path A) or,
 * when the extension starts the session (path B), OpenCode's default.
 */
export type StartOptions = { presetId: string; model: string | null; agent: string | null; variant: string | null; location: Location };
export type SummarySettings = { auto: boolean; language: string; prompt: string };
/** What a card stores under card:<projectId>:<taskId>: its start options and its own summary language. */
export type CardOptions = Partial<StartOptions> & { summaryLanguage?: string };
export type Settings = {
  autoStart: boolean;
  maxParallel: number;
  defaults: StartOptions;
  presetByType: Record<string, string>;
  summary: SummarySettings;
  hideChildren: boolean;
  types: string[];
  /** "Use Matt Pocock's skills when installed": global only (a project layer's value is ignored). */
  useMattSkills: boolean;
};

/**
 * One stored layer (global or project). Nested groups are partial too, so a project can override
 * one default without repeating the rest. `Partial<Settings>` is assignable to it.
 */
export type SettingsLayer = Partial<Omit<Settings, 'defaults' | 'summary'>> & {
  defaults?: Partial<StartOptions>;
  summary?: Partial<SummarySettings>;
};

/** The default prompt lives with the summaries (summaries.ts); re-exported here for the settings. */
export { DEFAULT_SUMMARY_PROMPT };

export const MAX_PARALLEL_MIN = 1;
export const MAX_PARALLEL_MAX = 10;
export const FALLBACK_PRESET_ID = 'implement';
/** A parent (feature) starts one orchestrator session with this preset unless its card says otherwise. */
export const ORCHESTRATE_PRESET_ID = 'orchestrate';
/** With Matt Pocock's skills in use, a bug defaults to this preset (unless the user set the bug type). */
export const DIAGNOSE_PRESET_ID = 'diagnose';
export const LOCATIONS: readonly Location[] = ['worktree', 'project'];

export const DEFAULT_SETTINGS: Settings = {
  autoStart: true,
  maxParallel: 3,
  defaults: { presetId: 'implement', model: null, agent: null, variant: null, location: 'worktree' },
  presetByType: { enhancement: 'implement', bug: 'implement', research: 'plan' },
  summary: { auto: true, language: 'Polish', prompt: DEFAULT_SUMMARY_PROMPT },
  hideChildren: false,
  types: ['enhancement', 'bug', 'chore', 'research'],
  useMattSkills: true,
};

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Non-blank text, or undefined: empty text in a field means "not set here". */
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

const clampParallel = (n: number): number => Math.min(MAX_PARALLEL_MAX, Math.max(MAX_PARALLEL_MIN, Math.round(n)));

const startPatch = (raw: unknown): Partial<StartOptions> => {
  const r = record(raw);
  const out: Partial<StartOptions> = {};
  if (r === null) return out;
  const presetId = text(r.presetId);
  const model = text(r.model);
  const agent = text(r.agent);
  const variant = text(r.variant);
  if (presetId !== undefined) out.presetId = presetId;
  if (model !== undefined) out.model = model;
  if (agent !== undefined) out.agent = agent;
  if (variant !== undefined) out.variant = variant;
  if (r.location === 'worktree' || r.location === 'project') out.location = r.location;
  return out;
};

/** A card's stored options; blank or null fields are dropped (they inherit). */
export const parseCardOptions = (raw: unknown): CardOptions => {
  const out: CardOptions = startPatch(raw);
  const language = text(record(raw)?.summaryLanguage);
  if (language !== undefined) out.summaryLanguage = language;
  return out;
};

/** A stored layer read defensively: anything of the wrong type is dropped, never thrown. */
export const parseSettings = (raw: unknown): SettingsLayer => {
  const r = record(raw);
  const out: SettingsLayer = {};
  if (r === null) return out;
  if (typeof r.autoStart === 'boolean') out.autoStart = r.autoStart;
  if (typeof r.maxParallel === 'number' && Number.isFinite(r.maxParallel)) out.maxParallel = clampParallel(r.maxParallel);
  if (typeof r.hideChildren === 'boolean') out.hideChildren = r.hideChildren;
  if (typeof r.useMattSkills === 'boolean') out.useMattSkills = r.useMattSkills;
  if (Array.isArray(r.types)) {
    const types = [...new Set(r.types.map(text).filter((t): t is string => t !== undefined))];
    if (types.length > 0) out.types = types;
  }
  const defaults = startPatch(r.defaults);
  if (Object.keys(defaults).length > 0) out.defaults = defaults;
  const byType = record(r.presetByType);
  if (byType !== null) {
    const map: Record<string, string> = {};
    for (const [type, id] of Object.entries(byType)) {
      const v = text(id);
      if (type.trim() !== '' && v !== undefined) map[type] = v;
    }
    if (Object.keys(map).length > 0) out.presetByType = map;
  }
  const summary = record(r.summary);
  if (summary !== null) {
    const s: Partial<SummarySettings> = {};
    if (typeof summary.auto === 'boolean') s.auto = summary.auto;
    const language = text(summary.language);
    if (language !== undefined) s.language = language;
    // The prompt keeps its own spacing; only a blank one counts as unset.
    if (typeof summary.prompt === 'string' && summary.prompt.trim() !== '') s.prompt = summary.prompt;
    if (Object.keys(s).length > 0) out.summary = s;
  }
  return out;
};

const diagnose = BUILTIN_PRESETS.find((p) => p.id === DIAGNOSE_PRESET_ID) as Preset;

/** The skills a session may use under these settings, given what the service found installed. */
export const skillUse = (s: Settings, found: readonly string[]): SkillUse => ({ use: s.useMattSkills, found });

/**
 * Global, then project, over the defaults, field by field. Layers go through parseSettings first.
 * `found` is the Matt Pocock skills installed for the project (POST /skills/detect): when they are
 * in use and cover Diagnose, the built-in default for `bug` is Diagnose instead of Implement. A
 * preset the user set for `bug` in either layer still wins.
 */
export const resolveSettings = (global: SettingsLayer, project: SettingsLayer, found: readonly string[] = []): Settings => {
  const g = parseSettings(global);
  const p = parseSettings(project);
  const d = DEFAULT_SETTINGS;
  const maxParallel = p.maxParallel ?? g.maxParallel ?? d.maxParallel;
  const useMattSkills = g.useMattSkills ?? d.useMattSkills;
  const byType = usesMattSkills(diagnose, { use: useMattSkills, found }) ? { ...d.presetByType, bug: DIAGNOSE_PRESET_ID } : d.presetByType;
  return {
    autoStart: p.autoStart ?? g.autoStart ?? d.autoStart,
    maxParallel: clampParallel(maxParallel),
    defaults: { ...d.defaults, ...g.defaults, ...p.defaults },
    presetByType: { ...byType, ...g.presetByType, ...p.presetByType },
    summary: { ...d.summary, ...g.summary, ...p.summary },
    hideChildren: p.hideChildren ?? g.hideChildren ?? d.hideChildren,
    types: [...(p.types ?? g.types ?? d.types)],
    useMattSkills,
  };
};

/**
 * The options a session starts with: the card's choice, else the settings. The preset is the
 * card's, else 'orchestrate' for a parent (a feature), else the default for the task's type, else defaults.presetId; whichever id is chosen,
 * one that is not among `presets` (e.g. a deleted custom preset) becomes 'implement'.
 * `presets` defaults to the built-ins; pass listPresets(...) so custom presets count.
 */
export const resolveStart = (
  s: Settings,
  task: Task,
  card: Partial<StartOptions>,
  presets: readonly Preset[] = BUILTIN_PRESETS,
): StartOptions => {
  const c = parseCardOptions(card);
  const byKind = task.kind === 'parent' ? ORCHESTRATE_PRESET_ID : undefined;
  const byType = task.type !== null ? s.presetByType[task.type] : undefined;
  const wanted = c.presetId ?? byKind ?? byType ?? s.defaults.presetId;
  const model = c.model ?? s.defaults.model;
  return {
    presetId: presets.some((p) => p.id === wanted) ? wanted : FALLBACK_PRESET_ID,
    model,
    agent: c.agent ?? s.defaults.agent,
    // A thinking level belongs to a model: without one it is dropped (the session would start on
    // OpenChamber's selection, whose levels are unknown here).
    variant: model === null ? null : (c.variant ?? s.defaults.variant),
    location: c.location ?? s.defaults.location,
  };
};

/**
 * Path B (the extension starts the session through the service, with its own worktree) when a
 * model, an agent or a thinking level is set: OpenChamber's start (path A) can set none of them and
 * uses its current composer selection.
 */
export const startsFromExtension = (opts: StartOptions): boolean =>
  opts.model !== null || opts.agent !== null || opts.variant !== null;

// --- storage ---

const MAX_KEY = 128;

/** FNV-1a, 32 bit, as 8 hex digits: a stable short tag for a key that is too long. */
const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/** Storage keys hold at most 128 characters; a longer one keeps its start and ends in a hash. */
const fit = (key: string): string => (key.length <= MAX_KEY ? key : `${key.slice(0, MAX_KEY - 9)}~${fnv(key)}`);

export const STORAGE_KEYS = {
  global: 'settings:global',
  project: (projectId: string): string => fit(`settings:project:${projectId}`),
  presets: 'presets',
  card: (projectId: string, taskId: string): string => fit(`card:${projectId}:${taskId}`),
  /** Per project: task id -> when the user dragged the card away from its session (columns.ts Detached). */
  detached: (projectId: string): string => fit(`detached:${projectId}`),
  /** Per project: session ids a host lookup found archived (columns.ts markArchived). */
  archivedSessions: (projectId: string): string => fit(`archivedSessions:${projectId}`),
  /** Per project: done tasks the user archived ("Archive done", archive.ts), `{ id, archivedAt }[]`. */
  archivedTasks: (projectId: string): string => fit(`archivedTasks:${projectId}`),
  /** Which sections of the task modal are open (one entry for every task and project). */
  detailSections: 'detail-sections',
} as const;

/** Archived-session marks kept per project. */
export const ARCHIVED_MAX = 500;

/** The stored archived-session ids, read defensively: non-empty strings, no duplicates. */
export const parseArchivedSessions = (raw: unknown): Set<string> =>
  new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && id !== '').slice(-ARCHIVED_MAX) : []);

/** The task modal's collapsible sections: open (true) or collapsed. */
export type Sections = { summary: boolean; task: boolean; subtasks: boolean; settings: boolean };

/** Reading first: Summary, Task and Sub-tasks open, Settings collapsed. */
export const DEFAULT_SECTIONS: Sections = Object.freeze({ summary: true, task: true, subtasks: true, settings: false });

/** The stored section state, read defensively: unknown keys and non-booleans fall back to the defaults. */
export const parseSections = (raw: unknown): Sections => {
  const r = record(raw);
  const out: Sections = { ...DEFAULT_SECTIONS };
  if (r !== null) for (const k of Object.keys(out) as (keyof Sections)[]) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  return out;
};

/** Detach marks kept per project; the oldest go first. */
export const DETACHED_MAX = 200;

/** The stored detach marks, read defensively: anything but a positive finite number is dropped. */
export const parseDetached = (raw: unknown): Map<string, number> => {
  const out = new Map<string, number>();
  const r = record(raw);
  if (r !== null) for (const [id, at] of Object.entries(r)) if (typeof at === 'number' && Number.isFinite(at) && at > 0) out.set(id, at);
  return out;
};

/** A copy with `taskId` marked at `at`, keeping the `max` newest marks. */
export const withDetach = (marks: ReadonlyMap<string, number>, taskId: string, at: number, max = DETACHED_MAX): Map<string, number> => {
  const next = new Map(marks);
  next.delete(taskId);
  next.set(taskId, at);
  return new Map([...next].sort((a, b) => a[1] - b[1]).slice(-max));
};

export type SettingsStorage = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: never) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

const isEmptyLayer = (layer: SettingsLayer): boolean =>
  Object.entries(layer).every(([, v]) => v === undefined || (record(v) !== null && Object.keys(v as object).length === 0));

/** Reads and writes the layers. Writes are cleaned first; an empty layer deletes its key. */
export const createSettingsStore = (storage: SettingsStorage) => {
  const put = async (key: string, value: object, empty: boolean): Promise<void> => {
    if (empty) await storage.delete(key);
    else await storage.set(key, value as never);
  };
  const saveLayer = (key: string, layer: SettingsLayer): Promise<void> => {
    const clean = parseSettings(layer);
    return put(key, clean, isEmptyLayer(clean));
  };
  return {
    loadGlobal: async (): Promise<SettingsLayer> => parseSettings(await storage.get(STORAGE_KEYS.global)),
    saveGlobal: (layer: SettingsLayer): Promise<void> => saveLayer(STORAGE_KEYS.global, layer),
    loadProject: async (projectId: string): Promise<SettingsLayer> => parseSettings(await storage.get(STORAGE_KEYS.project(projectId))),
    saveProject: (projectId: string, layer: SettingsLayer): Promise<void> => saveLayer(STORAGE_KEYS.project(projectId), layer),
    loadPresets: async (): Promise<StoredPresets> => parseStoredPresets(await storage.get(STORAGE_KEYS.presets)),
    savePresets: (stored: StoredPresets): Promise<void> => {
      const clean = parseStoredPresets(stored);
      return put(STORAGE_KEYS.presets, clean, isPristine(clean));
    },
    loadCard: async (projectId: string, taskId: string): Promise<CardOptions> =>
      parseCardOptions(await storage.get(STORAGE_KEYS.card(projectId, taskId))),
    saveCard: (projectId: string, taskId: string, card: CardOptions): Promise<void> => {
      const clean = parseCardOptions(card);
      return put(STORAGE_KEYS.card(projectId, taskId), clean, Object.keys(clean).length === 0);
    },
    loadDetached: async (projectId: string): Promise<Map<string, number>> => parseDetached(await storage.get(STORAGE_KEYS.detached(projectId))),
    saveDetached: (projectId: string, marks: ReadonlyMap<string, number>): Promise<void> =>
      put(STORAGE_KEYS.detached(projectId), Object.fromEntries(marks), marks.size === 0),
    loadArchived: async (projectId: string): Promise<Set<string>> => parseArchivedSessions(await storage.get(STORAGE_KEYS.archivedSessions(projectId))),
    saveArchived: (projectId: string, ids: ReadonlySet<string>): Promise<void> =>
      ids.size === 0 ? storage.delete(STORAGE_KEYS.archivedSessions(projectId)) : storage.set(STORAGE_KEYS.archivedSessions(projectId), [...ids].slice(-ARCHIVED_MAX) as never),
    loadArchivedTasks: async (projectId: string): Promise<Map<string, number>> =>
      parseArchivedTasks(await storage.get(STORAGE_KEYS.archivedTasks(projectId))),
    saveArchivedTasks: (projectId: string, marks: ArchivedTasks): Promise<void> =>
      put(STORAGE_KEYS.archivedTasks(projectId), serializeArchived(marks), marks.size === 0),
    loadSections: async (): Promise<Sections> => parseSections(await storage.get(STORAGE_KEYS.detailSections)),
    saveSections: (sections: Sections): Promise<void> => {
      const clean = parseSections(sections);
      const pristine = (Object.keys(clean) as (keyof Sections)[]).every((k) => clean[k] === DEFAULT_SECTIONS[k]);
      return put(STORAGE_KEYS.detailSections, clean, pristine);
    },
  };
};

export type SettingsStore = ReturnType<typeof createSettingsStore>;

/**
 * Text fields report every keystroke. This runs at most one save per key at a time; values that
 * arrive meanwhile are collapsed into the newest, which is saved next. `idle` resolves once
 * nothing is in flight (tests, and anyone who must read back what was typed).
 */
export const createLatestSaver = <T>(save: (key: string, value: T) => Promise<void>, onError: (e: unknown) => void) => {
  const running = new Map<string, Promise<void>>();
  const waiting = new Map<string, T>();
  const pump = (key: string, value: T): Promise<void> => {
    const p = save(key, value)
      .catch(onError)
      .then(() => {
        running.delete(key);
        if (!waiting.has(key)) return;
        const next = waiting.get(key) as T;
        waiting.delete(key);
        return pump(key, next);
      });
    running.set(key, p);
    return p;
  };
  return {
    save: (key: string, value: T): void => {
      if (running.has(key)) waiting.set(key, value);
      else void pump(key, value);
    },
    idle: async (): Promise<void> => {
      while (running.size > 0) await Promise.all(running.values());
    },
  };
};
