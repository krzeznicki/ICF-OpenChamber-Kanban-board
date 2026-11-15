// Presets: named blocks of instructions added to an agent's start prompt. Seven built-ins ship with
// the extension, each in two versions: `text`, plain instructions, and `mattText`, the same step run
// with Matt Pocock's skills (used when the user allows it and every skill in `skills` is installed).
// The user can edit a built-in's text (stored as an override that wins over both; "Reset" removes
// it) and add, rename and delete their own. Pure: no DOM, no host. The stored shape lives under the `presets`
// storage key (settings.ts reads and writes it).

import { MATT_SKILLS } from '../core/skills.ts';

/** `skills` and `mattText` are set on built-ins only. */
export type Preset = { id: string; name: string; text: string; builtin: boolean; skills?: readonly string[]; mattText?: string };

/** Whether Matt Pocock's skills may be used (the global setting) and which are installed. */
export type SkillUse = { use: boolean; found: readonly string[] };
export const NO_SKILLS: SkillUse = Object.freeze({ use: false, found: [] });

/** Closes every skills text: how to load the skills, and that the board still moves through the CLI. */
const SKILLS_NOTE = [
  'About the skills: load each skill named here with your skill tool; if it cannot be loaded, read its SKILL.md and follow it.',
  "Matt's skills and the task-board CLI write the same format: the skills read the tracker setup in docs/agents/issue-tracker.md, which the board wrote, so what they create shows on the board (do not run /setup-matt-pocock-skills).",
  'Still change states with the task-board CLI (`state`, and `claim` for sub-tasks) as shown above, so the board follows.',
].join('\n');

const withSkills = (lines: string[]): string => [...lines, SKILLS_NOTE].join('\n');

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
    skills: ['grill-with-docs', 'to-spec', 'to-tickets'],
    mattText: withSkills([
      "Plan this task with Matt Pocock's skills before changing any code.",
      '- Run /grill-with-docs to sharpen the task with the user, a round of questions at a time; it keeps the terms in GLOSSARY.md and the decisions as ADRs.',
      '- If a question needs a runnable answer, do not build it here: suggest a Prototype task for it.',
      '- If this is a multi-session build, stay in this context and run /to-spec, then /to-tickets: the spec and its tickets (each with its blocking edges, ready-for-agent) land on the board as a feature with its sub-tasks.',
      '- Otherwise finish with the sharpened plan and ask the user to approve it. Do not write code.',
    ]),
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
    skills: ['prototype', 'handoff'],
    mattText: withSkills([
      "Answer this task's design question with Matt Pocock's skills.",
      '- Run /prototype: throwaway code that answers the one question in this task, kept on a `prototype/<name>` branch out of main.',
      '- Record the answer on this task: the verdict, the question it settled and the branch (a comment on the GitHub issue, or a note in the local issue file).',
      '- Finish with /handoff, so the session that plans or builds this picks up what you learned, and say where the handoff file is.',
    ]),
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
    skills: ['implement', 'tdd', 'code-review'],
    mattText: withSkills([
      "Implement this task with Matt Pocock's skills.",
      '- Run /implement with this task as its ticket. It drives /tdd (agree the seams, then one red-green slice at a time) and closes with /code-review of your diff against the branch you started from.',
      '- When a decision is unclear, ask the user before going on.',
      '- Finish with a short summary of what changed and how you tested it.',
    ]),
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
    skills: ['implement', 'tdd', 'code-review'],
    mattText: withSkills([
      "Implement this task with Matt Pocock's skills, without stopping to ask questions.",
      '- Run /implement with this task as its ticket; it drives /tdd and closes with /code-review.',
      '- Where a skill would ask the user (the seams for /tdd, the fixed point for /code-review, an unclear decision), decide yourself: choose the simplest reasonable option and go on.',
      '- Finish with a short summary of what changed, how you tested it, and every assumption you made.',
    ]),
  },
  {
    id: 'orchestrate',
    name: 'Break down and orchestrate',
    builtin: true,
    text: [
      'Break this task down and orchestrate the work.',
      '- If it has no sub-tasks yet, split it into small tickets and create them with the task-board CLI, with `--parent <this task id> --state ready-for-agent`.',
      '- Claim each ticket before work starts on it; claim needs ready-for-agent, so move a sub-task to ready-for-agent first if needed.',
      '- Hand each ticket to a subagent; start a ticket only when the tickets blocking it are done.',
      '- Move each ticket with the task-board CLI as it starts and finishes.',
      '- Keep working until all sub-tasks are done, then summarise the result.',
    ].join('\n'),
    skills: ['to-tickets', 'implement-spec', 'tdd', 'code-review'],
    mattText: withSkills([
      "Break this task down and orchestrate the work with Matt Pocock's skills.",
      '- If it has no sub-tasks yet, run /to-tickets on it: tracer-bullet tickets with their blocking edges, published as sub-tasks of this task in ready-for-agent.',
      '- Then run /implement-spec over the sub-tasks: it reads them as a task graph, runs implementer subagents (each driving /tdd) across the ready frontier on one integration branch, and ends with one /code-review.',
      '- Claim each sub-task as its implementer starts and move it to done once merged.',
      '- Keep working until all sub-tasks are done, then summarise the result and name the integration branch.',
    ]),
  },
  {
    id: 'diagnose',
    name: 'Diagnose',
    builtin: true,
    text: [
      'Diagnose this bug, then fix it.',
      '- Reproduce it first: a test or command that fails on this bug.',
      '- Find the cause before changing code; check one guess at a time.',
      '- Fix it with a regression test, and run the tests until they pass.',
      '- Finish with the cause, the fix and how you checked it.',
    ].join('\n'),
    skills: ['diagnosing-bugs', 'implement', 'tdd', 'code-review'],
    mattText: withSkills([
      "Diagnose and fix this bug with Matt Pocock's skills.",
      '- Run /diagnosing-bugs: build a tight feedback loop that goes red on this bug before any theory, reproduce and minimise, rank hypotheses, instrument.',
      '- Once the cause is found, make the fix through /implement: the minimised repro is the first /tdd slice, as a regression test, and it closes with /code-review.',
      '- Finish with the cause, the fix, and the command that went red before and green after.',
    ]),
  },
  {
    id: 'triage',
    name: 'Triage',
    builtin: true,
    text: [
      'Triage this task; do not implement it.',
      '- Read it and the code it touches; check whether it is already done, a duplicate, or was rejected before.',
      '- For a bug, try to reproduce it.',
      '- Decide its state: ready-for-agent with a short brief (what to build, how to check it), needs-info with specific questions, ready-for-human with the reason, or wontfix with the reason.',
      '- Write the brief, questions or reason on the task, and set the state with the task-board CLI.',
    ].join('\n'),
    skills: ['triage'],
    mattText: withSkills([
      "Triage this task with Matt Pocock's skills; it arrived raw and nobody has evaluated it yet.",
      '- Run /triage on this task: gather context, check it is not already implemented or rejected, recommend a category and state, verify the claim (reproduce a bug), and grill it into shape if needed.',
      '- Apply the outcome as /triage says: an agent brief for ready-for-agent, triage notes for needs-info, a reason for ready-for-human or wontfix.',
      '- Do not implement it.',
    ]),
  },
];

const list = (names: readonly string[]): string => names.map((n) => `/${n}`).join(', ');

/** The Settings line under the toggle and atop Presets: what was found, null when it could not be checked. */
export const skillsFoundLine = (found: readonly string[] | null): string => {
  if (found === null) return "Could not check which of Matt Pocock's skills are installed; open a project.";
  if (found.length === 0) {
    return "None of Matt Pocock's skills were found in ~/.config/opencode/skills, ~/.claude/skills, ~/.agents/skills or the project's .opencode/skills and .claude/skills.";
  }
  const missing = MATT_SKILLS.filter((n) => !found.includes(n));
  return `Matt Pocock's skills found: ${found.join(', ')}.${missing.length > 0 ? ` Missing: ${missing.join(', ')}.` : ''}`;
};

/** Under a built-in in the Presets tab: which text its sessions get and why. Null for the user's own presets. */
export const presetSkillsNote = (preset: Preset, skills: SkillUse, edited: boolean): string | null => {
  if (!preset.builtin || preset.skills === undefined) return null;
  if (edited) return 'Your text is used, whatever skills are installed.';
  if (usesMattSkills(preset, skills)) return `Runs with Matt Pocock's skills: ${list(preset.skills)}.`;
  if (!skills.use) return "Plain instructions: Matt Pocock's skills are switched off (Global).";
  const missing = preset.skills.filter((n) => !skills.found.includes(n));
  return `Plain instructions until ${list(missing)} ${missing.length === 1 ? 'is' : 'are'} installed.`;
};

const BUILTIN_IDS = new Set(BUILTIN_PRESETS.map((p) => p.id));
const shipped = (id: string): Preset | undefined => BUILTIN_PRESETS.find((p) => p.id === id);

/** True when the user allows Matt's skills and every skill this (built-in) preset names is installed. */
export const usesMattSkills = (preset: Preset, skills: SkillUse): boolean =>
  skills.use &&
  preset.mattText !== undefined &&
  preset.skills !== undefined &&
  preset.skills.length > 0 &&
  preset.skills.every((name) => skills.found.includes(name));

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

/**
 * Every preset the user can pick: built-ins first, then the user's own. A built-in's text is the
 * user's edit, else its skills text when `skills` allows it (usesMattSkills), else its plain text.
 */
export const listPresets = (stored: StoredPresets, skills: SkillUse = NO_SKILLS): Preset[] => [
  ...BUILTIN_PRESETS.map((p) => ({ ...p, text: stored.builtin[p.id] ?? (usesMattSkills(p, skills) ? (p.mattText as string) : p.text) })),
  ...stored.custom.map((c) => ({ ...c, builtin: false })),
];

/** A built-in whose text differs from the shipped one. */
export const isEdited = (stored: StoredPresets, id: string): boolean => Object.hasOwn(stored.builtin, id);

/** True when nothing differs from the shipped presets; the storage key is then deleted. */
export const isPristine = (stored: StoredPresets): boolean => Object.keys(stored.builtin).length === 0 && stored.custom.length === 0;

/** Typing either shipped text (plain or skills) back into a built-in removes the edit. */
export const setPresetText = (stored: StoredPresets, id: string, text: string): StoredPresets => {
  const original = shipped(id);
  if (original !== undefined) {
    const builtin = { ...stored.builtin };
    if (text === original.text || text === original.mattText) delete builtin[id];
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
