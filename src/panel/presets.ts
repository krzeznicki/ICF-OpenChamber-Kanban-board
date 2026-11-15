// Presets: named blocks of instructions added to an agent's start prompt. Five built-ins ship with
// the extension; the user can edit their text (stored as an override, "Reset" removes it) and add,
// rename and delete their own. Pure: no DOM, no host. The stored shape lives under the `presets`
// storage key (settings.ts reads and writes it).

export type Preset = { id: string; name: string; text: string; builtin: boolean };

/** What is kept in storage: only the edited built-in texts and the user's own presets. */
export type StoredPresets = {
  builtin: Record<string, string>;
  custom: Array<{ id: string; name: string; text: string }>;
};

export const BUILTIN_PRESETS: readonly Preset[] = [
  {
    id: 'plan',
    name: 'Plan',
    builtin: true,
    text: [
      'Plan this task before changing any code.',
      '- Read the task and the code it touches.',
      '- Write a short plan: the steps, the files to change, how you will test it, and the open questions.',
      '- Ask the user to approve the plan and answer the questions. Do not write code until they do.',
    ].join('\n'),
  },
  {
    id: 'prototype',
    name: 'Prototype',
    builtin: true,
    text: [
      'Build a quick, throwaway prototype that answers the question in this task.',
      '- Keep it small and apart from production code.',
      '- Skip polish, tests and edge cases unless the question is about them.',
      '- Finish with the answer, what the prototype shows, and what a real implementation would need.',
    ].join('\n'),
  },
  {
    id: 'implement',
    name: 'Implement',
    builtin: true,
    text: [
      'Implement this task.',
      '- Read the task and the code it touches first.',
      '- Write or update tests with the change and run them until they pass.',
      '- Keep the change focused on the task; note anything else you find instead of fixing it.',
      '- When a decision is unclear, ask the user before going on.',
      '- Finish with a short summary of what changed and how you tested it.',
    ].join('\n'),
  },
  {
    id: 'implement-no-questions',
    name: 'Implement without questions',
    builtin: true,
    text: [
      'Implement this task without stopping to ask questions.',
      '- Read the task and the code it touches first.',
      '- Write or update tests with the change and run them until they pass.',
      '- When a decision is unclear, choose the simplest reasonable option and go on.',
      '- Finish with a short summary of what changed, how you tested it, and every assumption you made.',
    ].join('\n'),
  },
  {
    id: 'orchestrate',
    name: 'Break down and orchestrate',
    builtin: true,
    text: [
      'Break this task down and orchestrate the work.',
      '- If it has no sub-tasks yet, split it into small tickets and create them with the task-board CLI.',
      '- Hand each ticket to a subagent; start a ticket only when the tickets blocking it are done.',
      '- Move each ticket with the task-board CLI as it starts and finishes.',
      '- Keep working until all sub-tasks are done, then summarise the result.',
    ].join('\n'),
  },
];

const BUILTIN_IDS = new Set(BUILTIN_PRESETS.map((p) => p.id));
const builtinText = (id: string): string | undefined => BUILTIN_PRESETS.find((p) => p.id === id)?.text;

export const isBuiltinPreset = (id: string): boolean => BUILTIN_IDS.has(id);

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Reads the stored value defensively: anything malformed is dropped, never thrown. */
export const parseStoredPresets = (raw: unknown): StoredPresets => {
  const r = record(raw);
  const builtin: Record<string, string> = {};
  const custom: StoredPresets['custom'] = [];
  const b = record(r?.builtin);
  if (b !== null) for (const [id, text] of Object.entries(b)) if (BUILTIN_IDS.has(id) && typeof text === 'string') builtin[id] = text;
  if (Array.isArray(r?.custom)) {
    const seen = new Set<string>();
    for (const item of r.custom) {
      const c = record(item);
      if (c === null || typeof c.id !== 'string' || c.id === '' || BUILTIN_IDS.has(c.id) || seen.has(c.id)) continue;
      if (typeof c.name !== 'string' || typeof c.text !== 'string') continue;
      seen.add(c.id);
      custom.push({ id: c.id, name: c.name, text: c.text });
    }
  }
  return { builtin, custom };
};

/** Every preset the user can pick: built-ins (with their edits) first, then the user's own. */
export const listPresets = (stored: StoredPresets): Preset[] => [
  ...BUILTIN_PRESETS.map((p) => ({ ...p, text: stored.builtin[p.id] ?? p.text })),
  ...stored.custom.map((c) => ({ ...c, builtin: false })),
];

/** A built-in whose text differs from the shipped one. */
export const isEdited = (stored: StoredPresets, id: string): boolean => Object.hasOwn(stored.builtin, id);

/** True when nothing differs from the shipped presets; the storage key is then deleted. */
export const isPristine = (stored: StoredPresets): boolean => Object.keys(stored.builtin).length === 0 && stored.custom.length === 0;

export const setPresetText = (stored: StoredPresets, id: string, text: string): StoredPresets => {
  const original = builtinText(id);
  if (original !== undefined) {
    const builtin = { ...stored.builtin };
    if (text === original) delete builtin[id];
    else builtin[id] = text;
    return { ...stored, builtin };
  }
  return { ...stored, custom: stored.custom.map((c) => (c.id === id ? { ...c, text } : c)) };
};

export const resetPreset = (stored: StoredPresets, id: string): StoredPresets => {
  if (!isEdited(stored, id)) return stored;
  const builtin = { ...stored.builtin };
  delete builtin[id];
  return { ...stored, builtin };
};

const UNTITLED = 'Untitled preset';

const slug = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'preset';

export const addPreset = (stored: StoredPresets, name: string): { stored: StoredPresets; id: string } => {
  const trimmed = name.trim();
  const base = `custom-${slug(trimmed)}`;
  const taken = new Set(stored.custom.map((c) => c.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return { id, stored: { ...stored, custom: [...stored.custom, { id, name: trimmed === '' ? UNTITLED : trimmed, text: '' }] } };
};

/** Only the user's own presets can be renamed; the id stays, so cards that use it keep it. */
export const renamePreset = (stored: StoredPresets, id: string, name: string): StoredPresets => {
  if (BUILTIN_IDS.has(id)) return stored;
  const trimmed = name.trim();
  return { ...stored, custom: stored.custom.map((c) => (c.id === id ? { ...c, name: trimmed === '' ? UNTITLED : trimmed } : c)) };
};

/** Built-ins cannot be deleted. Cards that used a deleted preset fall back to Implement. */
export const deletePreset = (stored: StoredPresets, id: string): StoredPresets =>
  BUILTIN_IDS.has(id) ? stored : { ...stored, custom: stored.custom.filter((c) => c.id !== id) };
