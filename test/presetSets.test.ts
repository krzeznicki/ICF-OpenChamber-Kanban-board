import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { MATT_SKILLS, SUPERPOWERS_SKILLS } from '../src/core/skills.ts';
import {
  BUILTIN_PRESETS,
  BUILTIN_SETS,
  EMPTY_SETS,
  PRESET_IDS,
  addPreset,
  addSet,
  defaultSetId,
  deletePreset,
  deleteSet,
  effectiveSetId,
  isEdited,
  isPristineSets,
  listPresets,
  listSets,
  migrateStoredPresets,
  missingSkills,
  parseStoredSets,
  pickPreset,
  presetSkillsNote,
  renamePreset,
  renameSet,
  resetPreset,
  setPresetText,
  setSkills,
  setStatusLine,
} from '../src/panel/presets.ts';
import {
  STORAGE_KEYS,
  createSettingsStore,
  migrateGlobalLayer,
  parseSettings,
  presetSetOf,
  resolveSettings,
  resolveStart,
  type SettingsStorage,
} from '../src/panel/settings.ts';

const MATT: string[] = [...MATT_SKILLS];
const SP: string[] = [...SUPERPOWERS_SKILLS];
const set = (id: string) => BUILTIN_SETS.find((s) => s.id === id)!;
const inSet = (setId: string, presetId: string) => set(setId).presets.find((p) => p.id === presetId)!;

const task = (type: string | null, kind: Task['kind'] = 'ticket'): Task => ({
  id: '.scratch/f/issues/01-a.md',
  kind,
  title: 'A',
  body: '',
  state: 'ready-for-agent',
  type,
  parentId: null,
  blockedBy: [],
  url: null,
  updatedAt: 0,
  claimed: false,
});

// --- the built-in sets ---

test('three built-in sets, each with the seven stable preset ids in order', () => {
  assert.deepEqual(
    BUILTIN_SETS.map((s) => [s.id, s.name]),
    [
      ['matt', "Matt Pocock's skills"],
      ['superpowers', 'Superpowers'],
      ['plain', 'Plain'],
    ],
  );
  assert.deepEqual([...PRESET_IDS], ['plan', 'prototype', 'implement', 'implement-no-questions', 'orchestrate', 'diagnose', 'triage']);
  for (const s of BUILTIN_SETS) {
    assert.deepEqual(s.presets.map((p) => p.id), [...PRESET_IDS], s.id);
    assert.deepEqual(s.presets.map((p) => p.name), BUILTIN_PRESETS.map((p) => p.name), s.id);
    for (const p of s.presets) {
      assert.equal(p.builtin, true);
      assert.ok(p.text.trim().length > 40, `${s.id}/${p.id}`);
    }
  }
  // The Plain set is the 0.2 plain texts, BUILTIN_PRESETS.
  assert.deepEqual(set('plain').presets, BUILTIN_PRESETS);
  assert.ok(BUILTIN_PRESETS.every((p) => p.skills === undefined));
});

test('every text uses only the known placeholders', () => {
  for (const s of BUILTIN_SETS)
    for (const p of s.presets) for (const m of p.text.matchAll(/\{([a-z]+)\}/g)) assert.ok(['cli', 'root', 'tracker', 'id', 'note'].includes(m[1]!), `${s.id}/${p.id}: {${m[1]}}`);
});

test("the Matt set is 0.2's skills texts: each names its skills, all of them detected", () => {
  for (const p of set('matt').presets) {
    assert.ok(p.skills !== undefined && p.skills.length > 0, p.id);
    for (const name of [...p.skills, ...(p.requires ?? [])]) assert.ok(MATT.includes(name), `${p.id}: ${name}`);
    for (const name of p.skills) assert.ok(p.text.includes(`/${name}`), `${p.id} names /${name}`);
    assert.match(p.text, /never run \/setup-matt-pocock-skills/, p.id);
    assert.ok(p.text.includes('{tracker}'), p.id);
    assert.match(p.text, /task-board CLI/, p.id);
  }
  assert.deepEqual(inSet('matt', 'diagnose').skills, ['diagnosing-bugs', 'implement', 'tdd', 'code-review']);
});

test('the Superpowers set runs the named Superpowers skills, keeping every 0.2 rule', () => {
  const skills = (id: string) => inSet('superpowers', id).skills;
  assert.deepEqual(skills('plan'), ['brainstorming', 'writing-plans']);
  assert.deepEqual(skills('prototype'), ['brainstorming']);
  assert.deepEqual(skills('implement'), ['test-driven-development', 'verification-before-completion', 'requesting-code-review']);
  assert.deepEqual(skills('implement-no-questions'), ['test-driven-development', 'verification-before-completion', 'requesting-code-review']);
  assert.deepEqual(skills('orchestrate'), ['writing-plans', 'subagent-driven-development']);
  assert.deepEqual(skills('diagnose'), ['systematic-debugging', 'test-driven-development', 'verification-before-completion']);
  // Triage is the plain triage text.
  assert.deepEqual(inSet('superpowers', 'triage'), inSet('plain', 'triage'));
  for (const p of set('superpowers').presets) {
    if (p.id === 'triage') continue;
    for (const name of p.skills!) {
      assert.ok(SP.includes(name), `${p.id}: ${name} is detected`);
      assert.ok(p.text.includes(name), `${p.id} names ${name}`);
    }
    // The board's worktree exists; merging is the user's call; no setup skills; tracker writes through the CLI at the root.
    assert.match(p.text, /do not create another/, p.id);
    assert.match(p.text, /using-git-worktrees/, p.id);
    assert.match(p.text, /finishing-a-development-branch/, p.id);
    assert.match(p.text, /never run a setup skill/i, p.id);
    assert.ok(p.text.includes('{tracker}') && p.text.includes('{root}') && p.text.includes('{note}'), p.id);
    assert.ok(p.text.includes('{cli} create') && p.text.includes('{cli} state'), p.id);
    assert.ok(!/\/setup-matt-pocock-skills|\/grill-with-docs|\/tdd\b/.test(p.text), `${p.id} names no Matt skill`);
  }
  const t = (id: string) => inSet('superpowers', id).text;
  assert.match(t('plan'), /brainstorming[\s\S]*writing-plans/);
  assert.ok(t('plan').includes('--parent <feature id>') && t('plan').includes('--body-file -'));
  assert.ok(t('plan').includes('{cli} state {id} done'));
  assert.match(t('prototype'), /prototype\/<name>/);
  assert.match(t('implement'), /ask the user/);
  assert.match(t('implement-no-questions'), /Do not run brainstorming/);
  assert.match(t('implement-no-questions'), /assumption/);
  assert.match(t('orchestrate'), /no sub-tasks yet[\s\S]*writing-plans[\s\S]*subagent-driven-development/);
  assert.ok(t('orchestrate').includes('--parent {id}') && t('orchestrate').includes('{cli} claim'));
  // Existing sub-tasks still get a plan file: subagent-driven-development needs one for its workspace.
  assert.ok(
    t('orchestrate').includes(
      'If this worktree has no plan file for these sub-tasks, write one first under docs/superpowers/plans/ from `{cli} show <id>` of each sub-task (one plan task per sub-task, in dependency order), commit it, and use it as the plan.',
    ),
  );
  assert.ok(t('orchestrate').indexOf('no plan file') < t('orchestrate').indexOf('Then run subagent-driven-development'));
  // Not every session has a worktree from the board (path A, project folder).
  assert.ok(t('implement').includes('If the board made a worktree for this session, work in it and do not create another'));
  assert.ok(t('implement').includes('if you are on main/master, follow the skill\'s rule and ask before building there'));
  assert.match(t('diagnose'), /systematic-debugging[\s\S]*test-driven-development/);
  assert.match(t('diagnose'), /root cause/);
});

// --- which set ---

test('setSkills / missingSkills / defaultSetId: Matt if its skills are found, else Superpowers, else Plain', () => {
  assert.deepEqual(setSkills('matt'), MATT);
  assert.deepEqual(setSkills('superpowers'), SP);
  assert.deepEqual(setSkills('plain'), []);
  assert.deepEqual(setSkills('set-mine'), []);
  assert.deepEqual(missingSkills('superpowers', SP.slice(1)), [SP[0]]);
  assert.deepEqual(missingSkills('plain', []), []);
  assert.equal(defaultSetId([...MATT, ...SP]), 'matt');
  assert.equal(defaultSetId(MATT), 'matt');
  assert.equal(defaultSetId([...MATT.slice(1), ...SP]), 'superpowers');
  assert.equal(defaultSetId(SP), 'superpowers');
  assert.equal(defaultSetId(SP.slice(1)), 'plain');
  assert.equal(defaultSetId([]), 'plain');
});

test('effectiveSetId: the first layer (project, then global) whose set exists, else the default for what was found', () => {
  const { stored, id } = addSet(EMPTY_SETS, 'Mine', null);
  assert.equal(effectiveSetId(stored, [id], []), id);
  assert.equal(effectiveSetId(stored, [undefined, 'superpowers'], MATT), 'superpowers');
  assert.equal(effectiveSetId(stored, ['set-deleted'], SP), 'superpowers');
  assert.equal(effectiveSetId(stored, [], []), 'plain');
  // A deleted set in the project layer falls through to the global choice …
  assert.equal(effectiveSetId(stored, ['set-deleted', id], MATT), id);
  assert.equal(effectiveSetId(stored, ['set-deleted', 'plain'], MATT), 'plain');
  // … and one in the global layer to the default.
  assert.equal(effectiveSetId(stored, [undefined, 'set-deleted'], MATT), 'matt');
  assert.equal(effectiveSetId(stored, ['set-gone', 'set-deleted'], SP), 'superpowers');
  // The same through the settings layers.
  assert.equal(presetSetOf({ presetSet: id }, { presetSet: 'set-deleted' }, stored, MATT), id);
  assert.equal(presetSetOf({ presetSet: 'set-deleted' }, {}, stored, SP), 'superpowers');
  assert.equal(presetSetOf({ presetSet: 'plain' }, { presetSet: 'superpowers' }, stored, MATT), 'superpowers');
  assert.equal(presetSetOf({}, {}, stored, []), 'plain');
});

test('resolveSettings: the set is the project choice, else the global one, else the default by skills found', () => {
  assert.equal(resolveSettings({}, {}).presetSet, 'plain');
  assert.equal(resolveSettings({}, {}, MATT).presetSet, 'matt');
  assert.equal(resolveSettings({}, {}, SP).presetSet, 'superpowers');
  assert.equal(resolveSettings({ presetSet: 'plain' }, {}, MATT).presetSet, 'plain');
  assert.equal(resolveSettings({ presetSet: 'plain' }, { presetSet: 'superpowers' }, MATT).presetSet, 'superpowers');
  assert.deepEqual(parseSettings({ presetSet: ' set-x ', useMattSkills: true }), { presetSet: 'set-x' });
  assert.deepEqual(parseSettings({ presetSet: '' }), {});
});

test('the 0.2 toggle migrates: off becomes the Plain set, on (or unset) the default', () => {
  assert.deepEqual(migrateGlobalLayer({ useMattSkills: false, maxParallel: 2 }), { maxParallel: 2, presetSet: 'plain' });
  assert.deepEqual(migrateGlobalLayer({ useMattSkills: true }), {});
  assert.deepEqual(migrateGlobalLayer({ useMattSkills: false, presetSet: 'matt' }), { presetSet: 'matt' });
  assert.deepEqual(migrateGlobalLayer(undefined), {});
});

test('bug defaults to Diagnose in every set that has it, else Implement', () => {
  const s = resolveSettings({}, {});
  assert.equal(s.presetByType.bug, 'diagnose');
  for (const b of BUILTIN_SETS) assert.equal(resolveStart(s, task('bug'), {}, listPresets(EMPTY_SETS, b.id)).presetId, 'diagnose', b.id);
  const { stored, id } = addSet(EMPTY_SETS, 'Empty', null);
  assert.equal(resolveStart(s, task('bug'), {}, listPresets(stored, id)).presetId, 'implement');
  // The user's choice for bug still wins.
  assert.equal(resolveSettings({ presetByType: { bug: 'plan' } }, {}).presetByType.bug, 'plan');
});

// --- presets in a set ---

test('listPresets: the set\'s presets, an unknown set reads as Plain; skill files for unedited skill presets', () => {
  const paths = { brainstorming: '/sp/brainstorming/SKILL.md', 'writing-plans': '/sp/writing-plans/SKILL.md' };
  const plan = listPresets(EMPTY_SETS, 'superpowers', paths).find((p) => p.id === 'plan')!;
  assert.equal(plan.text, inSet('superpowers', 'plan').text);
  assert.deepEqual(plan.skillFiles, [
    { name: 'brainstorming', path: '/sp/brainstorming/SKILL.md' },
    { name: 'writing-plans', path: '/sp/writing-plans/SKILL.md' },
  ]);
  assert.deepEqual(listPresets(EMPTY_SETS, 'nope'), BUILTIN_PRESETS);
  assert.equal(listPresets(EMPTY_SETS, 'plain', paths)[0]!.skillFiles, undefined);
  const edited = setPresetText(EMPTY_SETS, 'superpowers', 'plan', 'Mine.');
  const p2 = listPresets(edited, 'superpowers', paths).find((p) => p.id === 'plan')!;
  assert.equal(p2.text, 'Mine.');
  assert.equal(p2.skillFiles, undefined);
});

test('pickPreset: the id, else Implement of the set, else Plain Implement', () => {
  assert.equal(pickPreset(listPresets(EMPTY_SETS, 'matt'), 'plan').text, inSet('matt', 'plan').text);
  assert.equal(pickPreset(listPresets(EMPTY_SETS, 'matt'), 'gone').text, inSet('matt', 'implement').text);
  assert.equal(pickPreset([], 'plan').text, inSet('plain', 'implement').text);
});

test('editing a built-in set: only the override is stored, per set; reset or the shipped text removes it', () => {
  let stored = setPresetText(EMPTY_SETS, 'matt', 'plan', 'Just plan.');
  assert.deepEqual(stored, { builtin: { matt: { texts: { plan: 'Just plan.' }, custom: [] } }, custom: [] });
  assert.equal(isEdited(stored, 'matt', 'plan'), true);
  assert.equal(isEdited(stored, 'plain', 'plan'), false);
  assert.equal(listPresets(stored, 'plain')[0]!.text, inSet('plain', 'plan').text);
  assert.deepEqual(resetPreset(stored, 'matt', 'plan'), EMPTY_SETS);
  stored = setPresetText(stored, 'matt', 'plan', inSet('matt', 'plan').text);
  assert.deepEqual(stored, EMPTY_SETS);
  assert.equal(isPristineSets(stored), true);
  // Built-ins cannot be renamed or deleted.
  assert.deepEqual(renamePreset(EMPTY_SETS, 'matt', 'plan', 'X'), EMPTY_SETS);
  assert.deepEqual(deletePreset(EMPTY_SETS, 'matt', 'plan'), EMPTY_SETS);
});

test("the user's own presets in a built-in set: add, rename, edit, delete; ids never clash", () => {
  let { stored, id } = addPreset(EMPTY_SETS, 'superpowers', 'Review');
  assert.equal(id, 'custom-review');
  const second = addPreset(stored, 'superpowers', 'Review');
  assert.equal(second.id, 'custom-review-2');
  stored = renamePreset(second.stored, 'superpowers', 'custom-review', 'Code review');
  stored = setPresetText(stored, 'superpowers', 'custom-review', 'Review the diff.');
  assert.deepEqual(listPresets(stored, 'superpowers').slice(7), [
    { id: 'custom-review', name: 'Code review', text: 'Review the diff.', builtin: false },
    { id: 'custom-review-2', name: 'Review', text: '', builtin: false },
  ]);
  assert.equal(listPresets(stored, 'matt').length, 7, 'other sets untouched');
  stored = deletePreset(stored, 'superpowers', 'custom-review');
  assert.deepEqual(listPresets(stored, 'superpowers').slice(7).map((p) => p.id), ['custom-review-2']);
  assert.equal(addPreset(EMPTY_SETS, 'plain', 'Plan').id, 'custom-plan');
  assert.equal(listPresets(addPreset(EMPTY_SETS, 'plain', '  ').stored, 'plain').at(-1)!.name, 'Untitled preset');
});

test('custom sets: a copy (with edits) or empty, rename, delete; every preset in them is the user\'s', () => {
  const edited = setPresetText(EMPTY_SETS, 'superpowers', 'implement', 'My way.');
  const copy = addSet(edited, 'Team', 'superpowers');
  assert.equal(copy.id, 'set-team');
  const team = listPresets(copy.stored, copy.id);
  assert.deepEqual(team.map((p) => p.id), [...PRESET_IDS]);
  assert.equal(team.find((p) => p.id === 'implement')!.text, 'My way.');
  assert.ok(team.every((p) => !p.builtin && p.skills === undefined));
  const empty = addSet(copy.stored, 'Team', null);
  assert.equal(empty.id, 'set-team-2');
  assert.deepEqual(listPresets(empty.stored, empty.id), []);
  assert.deepEqual(
    listSets(empty.stored).map((s) => [s.id, s.name, s.builtin]),
    [
      ['matt', "Matt Pocock's skills", true],
      ['superpowers', 'Superpowers', true],
      ['plain', 'Plain', true],
      ['set-team', 'Team', false],
      ['set-team-2', 'Team', false],
    ],
  );
  let stored = renameSet(empty.stored, 'set-team-2', '  ');
  assert.equal(listSets(stored).at(-1)!.name, 'Untitled set');
  assert.deepEqual(renameSet(stored, 'matt', 'X'), stored, 'built-in sets keep their names');
  // Presets of a custom set: rename, edit, delete, add.
  stored = renamePreset(stored, 'set-team', 'plan', 'Think');
  stored = setPresetText(stored, 'set-team', 'plan', 'T');
  stored = deletePreset(stored, 'set-team', 'triage');
  stored = addPreset(stored, 'set-team', 'Extra').stored;
  const after = listPresets(stored, 'set-team');
  assert.deepEqual(after[0], { id: 'plan', name: 'Think', text: 'T', builtin: false });
  assert.deepEqual(after.map((p) => p.id), ['plan', 'prototype', 'implement', 'implement-no-questions', 'orchestrate', 'diagnose', 'custom-extra']);
  assert.equal(isEdited(stored, 'set-team', 'plan'), false);
  stored = deleteSet(stored, 'set-team');
  assert.deepEqual(listSets(stored).map((s) => s.id), ['matt', 'superpowers', 'plain', 'set-team-2']);
  assert.deepEqual(deleteSet(stored, 'plain'), stored);
  assert.equal(addSet(EMPTY_SETS, 'Plain', null).id, 'set-plain');
});

test('parseStoredSets drops junk', () => {
  assert.deepEqual(
    parseStoredSets({
      builtin: {
        matt: { texts: { plan: 'P', nope: 'x', implement: 3 }, custom: [{ id: 'custom-a', name: 'A', text: 'a' }, { id: 'plan', name: 'Clash', text: '' }, 5] },
        unknown: { texts: { plan: 'x' } },
        plain: 'x',
      },
      custom: [
        { id: 'set-a', name: 'A', presets: [{ id: 'plan', name: 'P', text: 'p' }, { id: 'plan', name: 'Dup', text: '' }, { id: 1 }] },
        { id: 'matt', name: 'Clash', presets: [] },
        { id: 'set-a', name: 'Dup', presets: [] },
        { id: 'set-b', name: 'B' },
        'x',
      ],
    }),
    {
      builtin: { matt: { texts: { plan: 'P' }, custom: [{ id: 'custom-a', name: 'A', text: 'a' }] } },
      custom: [
        { id: 'set-a', name: 'A', presets: [{ id: 'plan', name: 'P', text: 'p' }] },
        { id: 'set-b', name: 'B', presets: [] },
      ],
    },
  );
  assert.deepEqual(parseStoredSets('x'), EMPTY_SETS);
  assert.deepEqual(parseStoredSets(undefined), EMPTY_SETS);
});

test('migrateStoredPresets: 0.2 edits and own presets go to every built-in set (they applied whatever text was used)', () => {
  const migrated = migrateStoredPresets({ builtin: { plan: 'P', nope: 'x' }, custom: [{ id: 'custom-a', name: 'A', text: 'a' }] });
  const all = { texts: { plan: 'P' }, custom: [{ id: 'custom-a', name: 'A', text: 'a' }] };
  assert.deepEqual(migrated, { builtin: { matt: all, superpowers: all, plain: all }, custom: [] });
  for (const s of BUILTIN_SETS) {
    assert.equal(listPresets(migrated, s.id).find((p) => p.id === 'plan')!.text, 'P', `${s.id}: edited text`);
    assert.ok(listPresets(migrated, s.id).some((p) => p.id === 'custom-a'), `${s.id}: own preset reachable`);
  }
  assert.deepEqual(migrateStoredPresets(undefined), EMPTY_SETS);
  assert.deepEqual(migrateStoredPresets({ builtin: {}, custom: [] }), EMPTY_SETS);
});

test('Settings lines: what each set needs and what was found', () => {
  assert.equal(setStatusLine('matt', MATT, true), "All of Matt Pocock's skills were found.");
  assert.equal(setStatusLine('superpowers', SP.slice(2), true), `Superpowers skills missing: ${SP.slice(0, 2).join(', ')}. Sessions are still told to run them.`);
  assert.equal(setStatusLine('plain', [], true), 'Plain instructions; no skills needed.');
  assert.equal(setStatusLine('set-x', [], true), 'Your own set: its texts are used as written.');
  assert.equal(setStatusLine('matt', null, false), 'Open a project to check which skills are installed.');
  assert.equal(setStatusLine('matt', null, true), 'The service could not check which skills are installed.');
  assert.equal(presetSkillsNote(inSet('matt', 'implement'), 'matt', false), "Runs Matt Pocock's skills: /implement, /tdd, /code-review.");
  assert.equal(presetSkillsNote(inSet('superpowers', 'plan'), 'superpowers', false), 'Runs Superpowers skills: brainstorming, writing-plans.');
  assert.equal(presetSkillsNote(inSet('superpowers', 'plan'), 'superpowers', true), 'Your text is used.');
  assert.equal(presetSkillsNote(inSet('plain', 'plan'), 'plain', false), null);
  // The set decides the wording, not the first skill's name (Matt's /prototype vs a Superpowers preset).
  const odd = { id: 'x', name: 'X', text: 'x', builtin: true, skills: ['prototype'] };
  assert.equal(presetSkillsNote(odd, 'superpowers', false), 'Runs Superpowers skills: prototype.');
  assert.equal(presetSkillsNote(odd, 'matt', false), "Runs Matt Pocock's skills: /prototype.");
});

// --- storage ---

const fakeStorage = (initial: Record<string, unknown> = {}) => {
  const data = new Map<string, unknown>(Object.entries(initial));
  const storage: SettingsStorage = {
    get: async (key) => structuredClone(data.get(key)) as never,
    set: async (key, value) => void data.set(key, structuredClone(value)),
    delete: async (key) => void data.delete(key),
  };
  return { data, storage };
};

test('store: sets live under presetSets; pristine deletes the key', async () => {
  assert.equal(STORAGE_KEYS.presetSets, 'presetSets');
  const { data, storage } = fakeStorage();
  const store = createSettingsStore(storage);
  assert.deepEqual(await store.loadPresets(), EMPTY_SETS);
  const edited = setPresetText(EMPTY_SETS, 'plain', 'plan', 'P');
  await store.savePresets(edited);
  assert.deepEqual(data.get('presetSets'), edited);
  assert.deepEqual(await store.loadPresets(), edited);
  await store.savePresets(EMPTY_SETS);
  assert.equal(data.has('presetSets'), false);
});

test('store: the old presets key is migrated once and deleted', async () => {
  const { data, storage } = fakeStorage({ presets: { builtin: { implement: 'Mine' }, custom: [] }, 'settings:global': { useMattSkills: false } });
  const store = createSettingsStore(storage);
  const loaded = await store.loadPresets();
  assert.equal(listPresets(loaded, 'matt').find((p) => p.id === 'implement')!.text, 'Mine');
  assert.equal(listPresets(loaded, 'plain').find((p) => p.id === 'implement')!.text, 'Mine');
  assert.equal(data.has('presets'), false);
  assert.deepEqual(data.get('presetSets'), loaded);
  // A reset to pristine later does not bring the old edits back.
  await store.savePresets(EMPTY_SETS);
  assert.deepEqual(await store.loadPresets(), EMPTY_SETS);
  // The toggle: off reads as the Plain set.
  assert.deepEqual(await store.loadGlobal(), { presetSet: 'plain' });
  // A pristine old value is just dropped.
  const other = fakeStorage({ presets: { builtin: {}, custom: [] } });
  assert.deepEqual(await createSettingsStore(other.storage).loadPresets(), EMPTY_SETS);
  assert.equal(other.data.size, 0);
});

test('store: migrated 0.2 presets pin no set; the default set (by detection) has the edits and own presets', async () => {
  const old = { builtin: { implement: 'Mine' }, custom: [{ id: 'custom-a', name: 'A', text: 'a' }] };
  const run = async (global: unknown) => {
    const { data, storage } = fakeStorage({ presets: old, ...(global === undefined ? {} : { 'settings:global': global }) });
    const store = createSettingsStore(storage);
    const loaded = await store.loadPresets();
    return { loaded, global: await store.loadGlobal(), raw: data.get('settings:global'), has: data.has('settings:global') };
  };
  const unset = await run(undefined);
  assert.equal(unset.has, false, 'no global layer written');
  assert.deepEqual(unset.global, {});
  const on = await run({ useMattSkills: true, maxParallel: 2 });
  assert.deepEqual(on.raw, { useMattSkills: true, maxParallel: 2 }, 'global layer left as stored');
  assert.deepEqual(on.global, { maxParallel: 2 });
  // With Superpowers installed (and Matt's not), the default is Superpowers: the 0.2 edit and own preset are used.
  const setId = effectiveSetId(unset.loaded, [undefined, unset.global.presetSet], SP);
  assert.equal(setId, 'superpowers');
  assert.equal(pickPreset(listPresets(unset.loaded, setId), 'implement').text, 'Mine');
  assert.equal(pickPreset(listPresets(unset.loaded, setId), 'custom-a').text, 'a');
  // Toggle off still reads as Plain, which has them too; a set already chosen stays.
  assert.deepEqual((await run({ useMattSkills: false })).global, { presetSet: 'plain' });
  assert.deepEqual((await run({ presetSet: 'superpowers' })).global, { presetSet: 'superpowers' });
});
