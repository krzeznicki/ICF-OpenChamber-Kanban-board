// Preset sets. A preset is a named block of instructions added to an agent's start prompt; a set is
// a named list of presets. Three sets ship with the extension (texts in presetTexts.ts): Matt Pocock's
// skills, Superpowers and Plain, each with the same seven preset ids, so presetByType and a card's
// choice work in any set. The user can edit any preset of any set (an edited built-in is stored as an
// override; "Reset" removes it), add their own presets to a set, and add their own sets (a copy of
// another set, or empty), which they can rename and delete. Which set a project uses is a setting
// (settings.ts presetSet). Pure: no DOM, no host. Stored under `presetSets` (settings.ts reads it).

import { MATT_SKILLS, SUPERPOWERS_SKILLS } from '../core/skills.ts';
import { MATT_PRESETS, PLAIN_PRESETS, SUPERPOWERS_PRESETS } from './presetTexts.ts';

/**
 * `builtin` is true for a shipped preset of a built-in set (it can be reset, not renamed or deleted).
 * `skills` (named in the text) and `requires` (loaded by those skills themselves) are set on the
 * built-in skill presets only. `skillFiles` is set by listPresets: the SKILL.md of each, which the
 * prompt names for a harness that cannot load a skill.
 */
export type Preset = {
  id: string;
  name: string;
  text: string;
  builtin: boolean;
  skills?: readonly string[];
  requires?: readonly string[];
  skillFiles?: ReadonlyArray<{ name: string; path: string }>;
};

export type BuiltinSetId = 'matt' | 'superpowers' | 'plain';
export type BuiltinSet = { id: BuiltinSetId; name: string; presets: readonly Preset[]; skills: readonly string[] };

/** The 0.2 plain presets: the Plain set, and what resolveStart checks ids against by default. */
export const BUILTIN_PRESETS: readonly Preset[] = PLAIN_PRESETS;

export const BUILTIN_SETS: readonly BuiltinSet[] = [
  { id: 'matt', name: "Matt Pocock's skills", presets: MATT_PRESETS, skills: MATT_SKILLS },
  { id: 'superpowers', name: 'Superpowers', presets: SUPERPOWERS_PRESETS, skills: SUPERPOWERS_SKILLS },
  { id: 'plain', name: 'Plain', presets: PLAIN_PRESETS, skills: [] },
];

/** The ids every built-in set has, in order. */
export const PRESET_IDS: readonly string[] = PLAIN_PRESETS.map((p) => p.id);
export const FALLBACK_ID = 'implement';

/**
 * One of the user's presets, as stored. `skills` and `requires` are kept from a built-in preset when
 * its set is copied, so the copy still names each skill's SKILL.md and its set's skills are checked.
 */
export type StoredPreset = { id: string; name: string; text: string; skills?: string[]; requires?: string[] };
/**
 * What is kept in storage: per built-in set, the edited texts of its shipped presets and the user's
 * own presets in it; and the user's own sets, whole.
 */
export type StoredSets = {
  builtin: Partial<Record<string, { texts: Record<string, string>; custom: StoredPreset[] }>>;
  custom: Array<{ id: string; name: string; presets: StoredPreset[] }>;
};
export const EMPTY_SETS: StoredSets = Object.freeze({ builtin: Object.freeze({}), custom: Object.freeze([]) }) as unknown as StoredSets;

export type SetInfo = { id: string; name: string; builtin: boolean };

const builtinSet = (id: string): BuiltinSet | undefined => BUILTIN_SETS.find((s) => s.id === id);
const isBuiltinSet = (id: string): boolean => builtinSet(id) !== undefined;

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const names = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const list = v.filter((n): n is string => typeof n === 'string' && n !== '');
  return list.length === 0 ? undefined : list;
};

/** A preset's skill metadata, only the fields that are set. */
const skillMeta = (p: { skills?: readonly string[]; requires?: readonly string[] }): { skills?: string[]; requires?: string[] } => {
  const skills = names(p.skills);
  const requires = names(p.requires);
  return { ...(skills === undefined ? {} : { skills }), ...(requires === undefined ? {} : { requires }) };
};

/** A list of stored presets read defensively: string id/name/text, unique ids, none in `reserved`. */
const parsePresetList = (raw: unknown, reserved: ReadonlySet<string> = new Set()): StoredPreset[] => {
  const out: StoredPreset[] = [];
  if (!Array.isArray(raw)) return out;
  const seen = new Set<string>();
  for (const item of raw) {
    const c = record(item);
    if (c === null || typeof c.id !== 'string' || c.id === '' || reserved.has(c.id) || seen.has(c.id)) continue;
    if (typeof c.name !== 'string' || typeof c.text !== 'string') continue;
    seen.add(c.id);
    out.push({ id: c.id, name: c.name, text: c.text, ...skillMeta(c) });
  }
  return out;
};

const SHIPPED_IDS = new Set(PRESET_IDS);

/** Reads the stored value defensively: anything malformed is dropped, never thrown. */
export const parseStoredSets = (raw: unknown): StoredSets => {
  const r = record(raw);
  const builtin: StoredSets['builtin'] = {};
  const b = record(r?.builtin);
  if (b !== null) {
    for (const set of BUILTIN_SETS) {
      const entry = record(b[set.id]);
      if (entry === null) continue;
      const texts: Record<string, string> = {};
      const t = record(entry.texts);
      if (t !== null) for (const [id, text] of Object.entries(t)) if (SHIPPED_IDS.has(id) && typeof text === 'string') texts[id] = text;
      const custom = parsePresetList(entry.custom, SHIPPED_IDS);
      if (Object.keys(texts).length > 0 || custom.length > 0) builtin[set.id] = { texts, custom };
    }
  }
  const custom: StoredSets['custom'] = [];
  if (Array.isArray(r?.custom)) {
    const seen = new Set<string>();
    for (const item of r.custom) {
      const c = record(item);
      if (c === null || typeof c.id !== 'string' || c.id === '' || isBuiltinSet(c.id) || seen.has(c.id) || typeof c.name !== 'string') continue;
      seen.add(c.id);
      custom.push({ id: c.id, name: c.name, presets: parsePresetList(c.presets) });
    }
  }
  return { builtin, custom };
};

/**
 * The 0.2 `presets` value ({ builtin: {id: text}, custom: [...] }) as sets. A 0.2 edit or own preset
 * applied whatever text was in use, so it goes to every built-in set: whichever set a project ends up
 * with (the default follows what is installed), it runs what the user wrote and has their presets.
 */
export const migrateStoredPresets = (raw: unknown): StoredSets => {
  const r = record(raw);
  const texts: Record<string, string> = {};
  const b = record(r?.builtin);
  if (b !== null) for (const [id, text] of Object.entries(b)) if (SHIPPED_IDS.has(id) && typeof text === 'string') texts[id] = text;
  const custom = parsePresetList(r?.custom, SHIPPED_IDS);
  if (Object.keys(texts).length === 0 && custom.length === 0) return EMPTY_SETS;
  return parseStoredSets({ builtin: Object.fromEntries(BUILTIN_SETS.map((s) => [s.id, { texts, custom }])), custom: [] });
};

/** True when nothing differs from the shipped sets; the storage key is then deleted. */
export const isPristineSets = (stored: StoredSets): boolean => Object.keys(stored.builtin).length === 0 && stored.custom.length === 0;

/** Built-in sets first, then the user's. */
export const listSets = (stored: StoredSets): SetInfo[] => [
  ...BUILTIN_SETS.map((s) => ({ id: s.id, name: s.name, builtin: true })),
  ...stored.custom.map((s) => ({ id: s.id, name: s.name, builtin: false })),
];

const hasSet = (stored: StoredSets, id: string): boolean => isBuiltinSet(id) || stored.custom.some((s) => s.id === id);

/**
 * Every skill a set's presets name or need: a built-in set's list; for the user's set, those its
 * presets keep from the set they were copied from (none for Plain, an empty set or own presets).
 */
export const setSkills = (setId: string, stored: StoredSets = EMPTY_SETS): string[] => {
  const builtin = builtinSet(setId);
  if (builtin !== undefined) return [...builtin.skills];
  const mine = stored.custom.find((s) => s.id === setId);
  return [...new Set((mine?.presets ?? []).flatMap((p) => [...(p.skills ?? []), ...(p.requires ?? [])]))];
};

export const missingSkills = (setId: string, found: readonly string[], stored: StoredSets = EMPTY_SETS): string[] =>
  setSkills(setId, stored).filter((n) => !found.includes(n));

/** The set used when none is chosen: Matt's if all its skills are found, else Superpowers' if found, else Plain. */
export const defaultSetId = (found: readonly string[]): BuiltinSetId => {
  if (missingSkills('matt', found).length === 0) return 'matt';
  if (missingSkills('superpowers', found).length === 0) return 'superpowers';
  return 'plain';
};

/**
 * The set a project uses: the first of `requested` (project layer, then global) that exists — a
 * deleted set is skipped, so the next layer decides — else the default for the skills found.
 */
export const effectiveSetId = (stored: StoredSets, requested: ReadonlyArray<string | null | undefined>, found: readonly string[]): string =>
  requested.find((id): id is string => id !== null && id !== undefined && hasSet(stored, id)) ?? defaultSetId(found);

/** A preset with the SKILL.md of each skill it names or needs, where known. */
const withSkillFiles = (p: Preset, paths: Readonly<Record<string, string>>): Preset => {
  if (p.skills === undefined && p.requires === undefined) return p;
  const skillFiles = [...(p.skills ?? []), ...(p.requires ?? [])].flatMap((name) => {
    const path = paths[name];
    return path === undefined ? [] : [{ name, path }];
  });
  return skillFiles.length === 0 ? p : { ...p, skillFiles };
};

/** A shipped preset as listed: the user's edit, else its text with the SKILL.md paths known. */
const resolveShipped = (p: Preset, edit: string | undefined, paths: Readonly<Record<string, string>>): Preset =>
  edit !== undefined ? { ...p, text: edit } : withSkillFiles(p, paths);

/** One of the user's presets; one copied from a skills preset keeps its skills and their SKILL.md. */
const own = (p: StoredPreset, paths: Readonly<Record<string, string>> = {}): Preset =>
  withSkillFiles({ id: p.id, name: p.name, text: p.text, builtin: false, ...skillMeta(p) }, paths);

/**
 * Every preset of a set, as a session would get it: a built-in set's shipped presets (edits applied,
 * each skill's SKILL.md from `paths`), then the user's own. An unknown set id reads as Plain.
 */
export const listPresets = (stored: StoredSets, setId: string, paths: Readonly<Record<string, string>> = {}): Preset[] => {
  const mine = stored.custom.find((s) => s.id === setId);
  if (mine !== undefined) return mine.presets.map((p) => own(p, paths));
  const set = builtinSet(setId) ?? (builtinSet('plain') as BuiltinSet);
  const edits = stored.builtin[set.id];
  return [...set.presets.map((p) => resolveShipped(p, edits?.texts[p.id], paths)), ...(edits?.custom ?? []).map((p) => own(p, paths))];
};

/** The preset a session starts with: `id`, else the set's Implement, else Plain's Implement. */
export const pickPreset = (presets: readonly Preset[], id: string): Preset =>
  presets.find((p) => p.id === id) ?? presets.find((p) => p.id === FALLBACK_ID) ?? (PLAIN_PRESETS.find((p) => p.id === FALLBACK_ID) as Preset);

/** A shipped preset of a built-in set whose text differs from the shipped one. */
export const isEdited = (stored: StoredSets, setId: string, presetId: string): boolean =>
  stored.builtin[setId] !== undefined && Object.hasOwn(stored.builtin[setId].texts, presetId);

const shipped = (setId: string, presetId: string): Preset | undefined => builtinSet(setId)?.presets.find((p) => p.id === presetId);

/** The stored entry of a built-in set after `change`; an entry left empty is dropped. */
const withBuiltin = (
  stored: StoredSets,
  setId: string,
  change: (e: { texts: Record<string, string>; custom: StoredPreset[] }) => { texts: Record<string, string>; custom: StoredPreset[] },
): StoredSets => {
  const current = stored.builtin[setId] ?? { texts: {}, custom: [] };
  const next = change({ texts: { ...current.texts }, custom: [...current.custom] });
  const builtin = { ...stored.builtin };
  if (Object.keys(next.texts).length === 0 && next.custom.length === 0) delete builtin[setId];
  else builtin[setId] = next;
  return { ...stored, builtin };
};

/** The user's own presets of a set (a built-in set's added ones, or a custom set's), changed. */
const withOwn = (stored: StoredSets, setId: string, change: (list: StoredPreset[]) => StoredPreset[]): StoredSets => {
  if (isBuiltinSet(setId)) return withBuiltin(stored, setId, (e) => ({ ...e, custom: change(e.custom) }));
  return { ...stored, custom: stored.custom.map((s) => (s.id === setId ? { ...s, presets: change(s.presets) } : s)) };
};

/** Typing a built-in's shipped text back removes the edit. */
export const setPresetText = (stored: StoredSets, setId: string, presetId: string, text: string): StoredSets => {
  const original = shipped(setId, presetId);
  if (original !== undefined)
    return withBuiltin(stored, setId, (e) => {
      if (text === original.text) delete e.texts[presetId];
      else e.texts[presetId] = text;
      return e;
    });
  return withOwn(stored, setId, (list) => list.map((p) => (p.id === presetId ? { ...p, text } : p)));
};

export const resetPreset = (stored: StoredSets, setId: string, presetId: string): StoredSets =>
  !isEdited(stored, setId, presetId)
    ? stored
    : withBuiltin(stored, setId, (e) => {
        delete e.texts[presetId];
        return e;
      });

const UNTITLED = 'Untitled preset';
const UNTITLED_SET = 'Untitled set';

const slug = (name: string, fallback: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || fallback;

const unique = (base: string, taken: ReadonlySet<string>): string => {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
};

export const addPreset = (stored: StoredSets, setId: string, name: string): { stored: StoredSets; id: string } => {
  const trimmed = name.trim();
  const id = unique(`custom-${slug(trimmed, 'preset')}`, new Set(listPresets(stored, setId).map((p) => p.id)));
  return { id, stored: withOwn(stored, setId, (list) => [...list, { id, name: trimmed === '' ? UNTITLED : trimmed, text: '' }]) };
};

/** The user's presets can be renamed, a built-in set's shipped ones not; the id stays, so cards keep it. */
export const renamePreset = (stored: StoredSets, setId: string, presetId: string, name: string): StoredSets => {
  if (shipped(setId, presetId) !== undefined) return stored;
  const trimmed = name.trim();
  return withOwn(stored, setId, (list) => list.map((p) => (p.id === presetId ? { ...p, name: trimmed === '' ? UNTITLED : trimmed } : p)));
};

/** A built-in set's shipped presets cannot be deleted. Cards that used a deleted preset fall back to Implement. */
export const deletePreset = (stored: StoredSets, setId: string, presetId: string): StoredSets =>
  shipped(setId, presetId) !== undefined ? stored : withOwn(stored, setId, (list) => list.filter((p) => p.id !== presetId));

/**
 * A new set of the user's: a copy of `from` as it reads now (edits included, as the user's own
 * presets, each keeping the skills it names), or empty.
 */
export const addSet = (stored: StoredSets, name: string, from: string | null): { stored: StoredSets; id: string } => {
  const trimmed = name.trim();
  const id = unique(`set-${slug(trimmed, 'set')}`, new Set(listSets(stored).map((s) => s.id)));
  const presets = from === null ? [] : listPresets(stored, from).map((p) => ({ id: p.id, name: p.name, text: p.text, ...skillMeta(p) }));
  return { id, stored: { ...stored, custom: [...stored.custom, { id, name: trimmed === '' ? UNTITLED_SET : trimmed, presets }] } };
};

/** Only the user's sets can be renamed; the id stays, so the settings that chose it keep it. */
export const renameSet = (stored: StoredSets, id: string, name: string): StoredSets => {
  const trimmed = name.trim();
  return { ...stored, custom: stored.custom.map((s) => (s.id === id ? { ...s, name: trimmed === '' ? UNTITLED_SET : trimmed } : s)) };
};

/** Built-in sets cannot be deleted. Settings that chose a deleted set use the default set. */
export const deleteSet = (stored: StoredSets, id: string): StoredSets =>
  isBuiltinSet(id) ? stored : { ...stored, custom: stored.custom.filter((s) => s.id !== id) };

// --- Settings lines ---

const SKILLS_OWNER: Partial<Record<string, string>> = { matt: "Matt Pocock's skills", superpowers: 'Superpowers skills' };

/**
 * Under the set pickers: what the set needs and what was found. `found` is null when it is not known:
 * no project open, or the service's check failed.
 */
export const setStatusLine = (setId: string, found: readonly string[] | null, projectOpen: boolean, stored: StoredSets = EMPTY_SETS): string => {
  const builtin = isBuiltinSet(setId);
  const skills = setSkills(setId, stored);
  if (!builtin && skills.length === 0) return 'Your own set: its texts are used as written.';
  if (skills.length === 0) return 'Plain instructions; no skills needed.';
  if (found === null) return projectOpen ? 'The service could not check which skills are installed.' : 'Open a project to check which skills are installed.';
  const missing = missingSkills(setId, found, stored);
  if (missing.length === 0)
    return !builtin ? 'All of the skills this set names were found.' : setId === 'matt' ? "All of Matt Pocock's skills were found." : 'All of the Superpowers skills were found.';
  return `${SKILLS_OWNER[setId] ?? 'Skills'} missing: ${missing.join(', ')}. Sessions are still told to run them.`;
};

/** A set's name in a picker, flagged when its skills are known to be missing. */
export const setOptionLabel = (set: SetInfo, found: readonly string[] | null, stored: StoredSets = EMPTY_SETS): string =>
  found !== null && missingSkills(set.id, found, stored).length > 0 ? `${set.name} (skills missing)` : set.name;

/** Under a built-in skill preset of set `setId` in the Presets tab: which skills it runs. Null for the others. */
export const presetSkillsNote = (preset: Preset, setId: string, edited: boolean): string | null => {
  if (!preset.builtin || preset.skills === undefined || preset.skills.length === 0) return null;
  if (edited) return 'Your text is used.';
  return setId === 'matt' ? `Runs Matt Pocock's skills: ${preset.skills.map((n) => `/${n}`).join(', ')}.` : `Runs Superpowers skills: ${preset.skills.join(', ')}.`;
};
