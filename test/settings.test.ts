import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SUMMARY_PROMPT,
  STORAGE_KEYS,
  createLatestSaver,
  createSettingsStore,
  parseCardOptions,
  parseSettings,
  resolveSettings,
  resolveStart,
  type SettingsStorage,
} from '../src/panel/settings.ts';
import {
  BUILTIN_PRESETS,
  addPreset,
  deletePreset,
  isEdited,
  listPresets,
  parseStoredPresets,
  presetSkillsNote,
  renamePreset,
  NO_SKILLS,
  resetPreset,
  setPresetText,
  skillsFoundLine,
  usesMattSkills,
} from '../src/panel/presets.ts';
import { MATT_SKILLS } from '../src/core/skills.ts';

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

// --- resolveSettings ---

test('defaults when nothing is stored', () => {
  const s = resolveSettings({}, {});
  assert.deepEqual(s, DEFAULT_SETTINGS);
  assert.equal(s.autoStart, true);
  assert.equal(s.maxParallel, 3);
  assert.deepEqual(s.defaults, { presetId: 'implement', model: null, agent: null, location: 'worktree' });
  assert.deepEqual(s.presetByType, { enhancement: 'implement', bug: 'implement', research: 'plan' });
  assert.deepEqual(s.summary, { auto: true, language: 'Polish', prompt: DEFAULT_SUMMARY_PROMPT });
  assert.equal(s.hideChildren, false);
  assert.deepEqual(s.types, ['enhancement', 'bug', 'chore', 'research']);
  assert.equal(s.useMattSkills, true);
});

test('project overrides global field by field, nested fields included', () => {
  const s = resolveSettings(
    {
      autoStart: false,
      maxParallel: 5,
      defaults: { presetId: 'plan', model: 'anthropic/claude-sonnet-5-5', agent: 'build' },
      summary: { language: 'English' },
      presetByType: { bug: 'prototype' },
    },
    {
      maxParallel: 2,
      defaults: { agent: 'plan', location: 'project' },
      summary: { auto: false },
      presetByType: { research: 'implement' },
    },
  );
  assert.equal(s.autoStart, false); // global, project unset
  assert.equal(s.maxParallel, 2); // project wins
  assert.deepEqual(s.defaults, { presetId: 'plan', model: 'anthropic/claude-sonnet-5-5', agent: 'plan', location: 'project' });
  assert.deepEqual(s.summary, { auto: false, language: 'English', prompt: DEFAULT_SUMMARY_PROMPT });
  assert.deepEqual(s.presetByType, { enhancement: 'implement', bug: 'prototype', research: 'implement' });
});

test('a project field set to null or empty text inherits the global value', () => {
  const s = resolveSettings(
    { defaults: { model: 'anthropic/claude-sonnet-5-5' }, summary: { language: 'English' } },
    { defaults: { model: null }, summary: { language: '' } },
  );
  assert.equal(s.defaults.model, 'anthropic/claude-sonnet-5-5');
  assert.equal(s.summary.language, 'English');
});

test('maxParallel is clamped to 1..10 and rounded', () => {
  assert.equal(resolveSettings({ maxParallel: 0 }, {}).maxParallel, 1);
  assert.equal(resolveSettings({ maxParallel: -4 }, {}).maxParallel, 1);
  assert.equal(resolveSettings({ maxParallel: 99 }, {}).maxParallel, 10);
  assert.equal(resolveSettings({}, { maxParallel: 11 }).maxParallel, 10);
  assert.equal(resolveSettings({ maxParallel: 4.6 }, {}).maxParallel, 5);
  assert.equal(resolveSettings({ maxParallel: Number.NaN }, {}).maxParallel, 3);
});

test('parseSettings keeps valid fields and drops junk from storage', () => {
  assert.deepEqual(parseSettings(undefined), {});
  assert.deepEqual(parseSettings('nope'), {});
  assert.deepEqual(
    parseSettings({
      autoStart: 'yes',
      maxParallel: '4',
      hideChildren: true,
      types: ['bug', 3, ' ', 'docs'],
      defaults: { presetId: 'plan', model: 7, agent: '', location: 'moon' },
      presetByType: { bug: 'plan', x: 1 },
      summary: { auto: false, language: 9 },
      extra: 1,
    }),
    {
      hideChildren: true,
      types: ['bug', 'docs'],
      defaults: { presetId: 'plan' },
      presetByType: { bug: 'plan' },
      summary: { auto: false },
    },
  );
});

// --- resolveStart ---

test('card overrides project and global', () => {
  const s = resolveSettings(
    { defaults: { presetId: 'plan', model: 'a/global', agent: 'build', location: 'worktree' } },
    { defaults: { model: 'a/project' } },
  );
  assert.deepEqual(resolveStart(s, task('chore'), {}), { presetId: 'plan', model: 'a/project', agent: 'build', location: 'worktree' });
  assert.deepEqual(resolveStart(s, task('chore'), { presetId: 'prototype', model: 'a/card', agent: 'plan', location: 'project' }), {
    presetId: 'prototype',
    model: 'a/card',
    agent: 'plan',
    location: 'project',
  });
});

test('preset order: card, then the type default, then defaults.presetId', () => {
  const s = resolveSettings({ defaults: { presetId: 'prototype' } }, {});
  assert.equal(resolveStart(s, task('research'), {}).presetId, 'plan');
  assert.equal(resolveStart(s, task('bug'), {}).presetId, 'implement');
  assert.equal(resolveStart(s, task('chore'), {}).presetId, 'prototype');
  assert.equal(resolveStart(s, task(null), {}).presetId, 'prototype');
  assert.equal(resolveStart(s, task('research'), { presetId: 'orchestrate' }).presetId, 'orchestrate');
});

test('a parent defaults to orchestrate; the card choice still wins', () => {
  const s = resolveSettings({ defaults: { presetId: 'prototype' }, presetByType: { enhancement: 'plan' } }, {});
  assert.equal(resolveStart(s, task('enhancement', 'parent'), {}).presetId, 'orchestrate');
  assert.equal(resolveStart(s, task(null, 'parent'), {}).presetId, 'orchestrate');
  assert.equal(resolveStart(s, task('enhancement', 'parent'), { presetId: 'implement' }).presetId, 'implement');
  assert.equal(resolveStart(s, task('enhancement'), {}).presetId, 'plan');
});

test('an unknown preset id falls back to implement', () => {
  const s = resolveSettings({ defaults: { presetId: 'gone' } }, {});
  assert.equal(resolveStart(s, task('chore'), {}).presetId, 'implement');
  assert.equal(resolveStart(s, task('research'), { presetId: 'deleted-custom' }).presetId, 'implement');
  const byType = resolveSettings({ presetByType: { chore: 'missing' } }, {});
  assert.equal(resolveStart(byType, task('chore'), {}).presetId, 'implement');
});

test('custom presets count as known when passed in', () => {
  const s = resolveSettings({}, {});
  const presets = [...BUILTIN_PRESETS, { id: 'custom-review', name: 'Review', text: 'Review it.', builtin: false }];
  assert.equal(resolveStart(s, task('bug'), { presetId: 'custom-review' }, presets).presetId, 'custom-review');
  assert.equal(resolveStart(s, task('bug'), { presetId: 'custom-review' }).presetId, 'implement');
});

test('empty card model or agent inherits; card null presetId is ignored', () => {
  const s = resolveSettings({ defaults: { model: 'a/m', agent: 'build' } }, {});
  const card = parseCardOptions({ model: '', agent: null, presetId: null, location: 'nowhere' });
  assert.deepEqual(card, {});
  assert.deepEqual(resolveStart(s, task('bug'), card), { presetId: 'implement', model: 'a/m', agent: 'build', location: 'worktree' });
});

// --- presets ---

test('built-in presets: the seven ids in order, each with text', () => {
  assert.deepEqual(
    BUILTIN_PRESETS.map((p) => p.id),
    ['plan', 'prototype', 'implement', 'implement-no-questions', 'orchestrate', 'diagnose', 'triage'],
  );
  for (const p of BUILTIN_PRESETS) {
    assert.equal(p.builtin, true);
    assert.ok(p.text.trim().length > 40, p.id);
  }
  assert.deepEqual(
    BUILTIN_PRESETS.map((p) => p.name),
    ['Plan', 'Prototype', 'Implement', 'Implement without questions', 'Break down and orchestrate', 'Diagnose', 'Triage'],
  );
});

test('editing a built-in stores only the override; reset removes it', () => {
  let stored = parseStoredPresets(undefined);
  assert.deepEqual(listPresets(stored), BUILTIN_PRESETS);
  stored = setPresetText(stored, 'plan', 'Just plan.');
  assert.deepEqual(stored, { builtin: { plan: 'Just plan.' }, custom: [] });
  assert.equal(isEdited(stored, 'plan'), true);
  assert.equal(listPresets(stored).find((p) => p.id === 'plan')?.text, 'Just plan.');
  stored = resetPreset(stored, 'plan');
  assert.deepEqual(stored, { builtin: {}, custom: [] });
  assert.equal(isEdited(stored, 'plan'), false);
  // Writing the original text back is the same as a reset.
  const original = BUILTIN_PRESETS[0]!.text;
  assert.deepEqual(setPresetText(setPresetText(stored, 'plan', 'x'), 'plan', original), { builtin: {}, custom: [] });
});

test('custom presets: add, rename, edit, delete', () => {
  let stored = parseStoredPresets(undefined);
  const added = addPreset(stored, 'Review');
  stored = added.stored;
  assert.equal(added.id, 'custom-review');
  const second = addPreset(stored, 'Review');
  assert.equal(second.id, 'custom-review-2');
  stored = second.stored;
  stored = renamePreset(stored, 'custom-review', 'Code review');
  stored = setPresetText(stored, 'custom-review', 'Review the diff.');
  const list = listPresets(stored);
  assert.deepEqual(list.slice(7), [
    { id: 'custom-review', name: 'Code review', text: 'Review the diff.', builtin: false },
    { id: 'custom-review-2', name: 'Review', text: '', builtin: false },
  ]);
  stored = deletePreset(stored, 'custom-review');
  assert.deepEqual(
    listPresets(stored).map((p) => p.id),
    ['plan', 'prototype', 'implement', 'implement-no-questions', 'orchestrate', 'diagnose', 'triage', 'custom-review-2'],
  );
  // Built-ins cannot be renamed or deleted.
  assert.deepEqual(deletePreset(stored, 'plan'), stored);
  assert.deepEqual(renamePreset(stored, 'plan', 'X'), stored);
});

test('a blank custom name gets a placeholder; ids never collide with built-ins', () => {
  const { stored, id } = addPreset(parseStoredPresets(undefined), '   ');
  assert.equal(id, 'custom-preset');
  assert.equal(listPresets(stored).at(-1)?.name, 'Untitled preset');
  assert.equal(addPreset(stored, 'Plan').id, 'custom-plan');
});

test('parseStoredPresets drops junk', () => {
  assert.deepEqual(
    parseStoredPresets({
      builtin: { plan: 'P', nope: 'x', implement: 3 },
      custom: [{ id: 'custom-a', name: 'A', text: 'a' }, { id: 'plan', name: 'Clash', text: '' }, { id: 5 }, 'x'],
    }),
    { builtin: { plan: 'P' }, custom: [{ id: 'custom-a', name: 'A', text: 'a' }] },
  );
});

// --- storage ---

const fakeStorage = () => {
  const data = new Map<string, unknown>();
  const storage: SettingsStorage = {
    get: async (key) => structuredClone(data.get(key)) as never,
    set: async (key, value) => {
      assert.ok(key.length >= 1 && key.length <= 128, `key length ${key.length}`);
      data.set(key, structuredClone(value));
    },
    delete: async (key) => {
      data.delete(key);
    },
  };
  return { data, storage };
};

test('storage keys are exactly as specified', () => {
  assert.equal(STORAGE_KEYS.global, 'settings:global');
  assert.equal(STORAGE_KEYS.project('p1'), 'settings:project:p1');
  assert.equal(STORAGE_KEYS.presets, 'presets');
  assert.equal(STORAGE_KEYS.card('p1', '#42'), 'card:p1:#42');
});

test('over-long keys are shortened deterministically to 128 characters', () => {
  const long = `.scratch/${'x'.repeat(200)}/issues/01-a.md`;
  const a = STORAGE_KEYS.card('p1', long);
  assert.equal(a.length, 128);
  assert.equal(a, STORAGE_KEYS.card('p1', long));
  assert.notEqual(a, STORAGE_KEYS.card('p1', `${long}x`));
  assert.ok(a.startsWith('card:p1:'));
});

test('store round-trips layers; empty layers delete their key', async () => {
  const { data, storage } = fakeStorage();
  const store = createSettingsStore(storage);
  assert.deepEqual(await store.loadGlobal(), {});
  await store.saveGlobal({ maxParallel: 4 });
  await store.saveProject('p1', { defaults: { model: 'a/b' } });
  await store.saveCard('p1', '#1', { presetId: 'plan', model: null });
  assert.deepEqual(data.get('settings:global'), { maxParallel: 4 });
  assert.deepEqual(data.get('settings:project:p1'), { defaults: { model: 'a/b' } });
  assert.deepEqual(data.get('card:p1:#1'), { presetId: 'plan' });
  assert.deepEqual(await store.loadProject('p1'), { defaults: { model: 'a/b' } });
  assert.deepEqual(await store.loadCard('p1', '#1'), { presetId: 'plan' });
  await store.saveCard('p1', '#1', {});
  await store.saveProject('p1', { defaults: {} });
  assert.equal(data.has('card:p1:#1'), false);
  assert.equal(data.has('settings:project:p1'), false);
});

test('store saves presets only when something differs from the built-ins', async () => {
  const { data, storage } = fakeStorage();
  const store = createSettingsStore(storage);
  await store.savePresets(setPresetText(parseStoredPresets(undefined), 'plan', 'P'));
  assert.deepEqual(data.get('presets'), { builtin: { plan: 'P' }, custom: [] });
  assert.equal(listPresets(await store.loadPresets()).find((p) => p.id === 'plan')?.text, 'P');
  await store.savePresets(parseStoredPresets(undefined));
  assert.equal(data.has('presets'), false);
});

test('latest saver: one save per key at a time, the newest waiting value next', async () => {
  const saved: string[] = [];
  const errors: unknown[] = [];
  let release: () => void = () => {};
  let first = true;
  const saver = createLatestSaver<string>(
    async (key, value) => {
      if (first) {
        first = false;
        await new Promise<void>((r) => (release = r));
      }
      if (value === 'boom') throw new Error('boom');
      saved.push(`${key}=${value}`);
    },
    (e) => errors.push(e),
  );
  saver.save('k', 'a');
  saver.save('k', 'b');
  saver.save('k', 'c');
  saver.save('other', 'x');
  release();
  await saver.idle();
  assert.deepEqual(saved, ['other=x', 'k=a', 'k=c']);
  saver.save('k', 'boom');
  saver.save('k', 'd');
  await saver.idle();
  assert.equal(errors.length, 1);
  assert.deepEqual(saved.at(-1), 'k=d');
});

test('detached marks: parsed defensively, newest kept, stored under detached:<projectId>', async () => {
  const { parseDetached, withDetach, STORAGE_KEYS: K, createSettingsStore: create } = await import('../src/panel/settings.ts');
  assert.deepEqual([...parseDetached({ a: 5, b: 'x', c: -1, d: Number.NaN })], [['a', 5]]);
  assert.deepEqual([...parseDetached(null)], []);
  const m = withDetach(new Map([['a', 1]]), 'b', 2);
  assert.deepEqual([...m], [['a', 1], ['b', 2]]);
  const capped = withDetach(new Map(Array.from({ length: 5 }, (_, i) => [`t${i}`, i] as [string, number])), 'new', 10, 3);
  assert.deepEqual([...capped.keys()].sort(), ['new', 't3', 't4']);
  assert.equal(K.detached('p1'), 'detached:p1');
  const data = new Map<string, unknown>();
  const store = create({ get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) });
  await store.saveDetached('p1', new Map([['t', 7]]));
  assert.deepEqual(data.get('detached:p1'), { t: 7 });
  assert.deepEqual([...(await store.loadDetached('p1'))], [['t', 7]]);
});

test('detail sections: defaults (Settings collapsed), defensive parse, short key, stored through the store', async () => {
  const { DEFAULT_SECTIONS, parseSections, STORAGE_KEYS: K, createSettingsStore: create } = await import('../src/panel/settings.ts');
  assert.deepEqual(DEFAULT_SECTIONS, { summary: true, task: true, subtasks: true, settings: false });
  assert.deepEqual(parseSections(undefined), DEFAULT_SECTIONS);
  assert.deepEqual(parseSections({ settings: true, task: 'yes', bogus: false }), { ...DEFAULT_SECTIONS, settings: true });
  assert.ok(K.detailSections.length <= 128);
  const data = new Map<string, unknown>();
  const storage: SettingsStorage = {
    get: async (k) => data.get(k),
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
  const s = create(storage);
  assert.deepEqual(await s.loadSections(), DEFAULT_SECTIONS);
  await s.saveSections({ ...DEFAULT_SECTIONS, task: false });
  assert.deepEqual(await s.loadSections(), { ...DEFAULT_SECTIONS, task: false });
});

test('archived sessions: parsed defensively, stored per project under archivedSessions:<projectId>', async () => {
  const { parseArchivedSessions, STORAGE_KEYS: K, createSettingsStore: create } = await import('../src/panel/settings.ts');
  assert.deepEqual([...parseArchivedSessions(['a', 3, '', 'b', 'a'])], ['a', 'b']);
  assert.deepEqual([...parseArchivedSessions({ a: 1 })], []);
  assert.equal(K.archivedSessions('p1'), 'archivedSessions:p1');
  assert.ok(K.archivedSessions('p'.repeat(300)).length <= 128);
  const data = new Map<string, unknown>();
  const store = create({ get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) });
  await store.saveArchived('p1', new Set(['s1']));
  assert.deepEqual(data.get('archivedSessions:p1'), ['s1']);
  assert.deepEqual([...(await store.loadArchived('p1'))], ['s1']);
  await store.saveArchived('p1', new Set());
  assert.equal(data.has('archivedSessions:p1'), false);
});

// --- Matt Pocock's skills ---

const ALL = [...MATT_SKILLS];
const preset = (id: string) => BUILTIN_PRESETS.find((p) => p.id === id)!;

test('every built-in names its skills and carries a mattText that invokes each of them', () => {
  for (const p of BUILTIN_PRESETS) {
    assert.ok(p.skills !== undefined && p.skills.length > 0, p.id);
    assert.ok(p.mattText !== undefined && p.mattText.trim().length > 80, p.id);
    for (const name of [...p.skills, ...(p.requires ?? [])]) assert.ok((MATT_SKILLS as readonly string[]).includes(name), `${p.id}: ${name} is detected`);
    for (const name of p.skills) assert.ok(p.mattText.includes(`/${name}`), `${p.id} mattText names /${name}`);
    // Hidden dependencies are checked, not invoked by name.
    for (const name of p.requires ?? []) assert.ok(!p.mattText.includes(`/${name}`), `${p.id} does not invoke /${name}`);
    // The tracker is at the project root; tracker writes go through the task-board CLI, which writes the skills' format.
    assert.match(p.mattText, /task-board CLI/, p.id);
    assert.match(p.mattText, /same format/, p.id);
    assert.ok(p.mattText.includes('{tracker}'), p.id);
    assert.match(p.mattText, /never run \/setup-matt-pocock-skills/, p.id);
  }
  assert.deepEqual(preset('plan').skills, ['grill-with-docs', 'to-spec', 'to-tickets']);
  assert.deepEqual(preset('plan').requires, ['grilling', 'domain-modeling']);
  assert.deepEqual(preset('prototype').skills, ['prototype']);
  assert.deepEqual(preset('implement').skills, ['implement', 'tdd', 'code-review']);
  assert.deepEqual(preset('implement-no-questions').skills, ['implement', 'tdd', 'code-review']);
  assert.deepEqual(preset('orchestrate').skills, ['to-tickets', 'implement-spec', 'tdd', 'code-review']);
  assert.deepEqual(preset('diagnose').skills, ['diagnosing-bugs', 'implement', 'tdd', 'code-review']);
  assert.deepEqual(preset('triage').skills, ['triage']);
  assert.deepEqual(preset('triage').requires, ['grilling', 'domain-modeling']);
  assert.ok(BUILTIN_PRESETS.every((p) => !p.mattText!.includes('handoff')));
  assert.match(preset('prototype').mattText!, /prototype\/<name>/);
  assert.match(preset('prototype').mattText!, /worktree/);
  assert.match(preset('orchestrate').mattText!, /task graph/);
});

test('skills texts that create or record tracker items do it through the CLI at the root ({cli} carries --dir)', () => {
  const creates = ['plan', 'orchestrate'];
  for (const id of creates) {
    const t = preset(id).mattText!;
    assert.ok(t.includes('{cli} create --title'), id);
    assert.ok(t.includes('--blocked-by'), id);
    assert.ok(t.includes('--state ready-for-agent --body-file -'), id);
  }
  assert.ok(preset('orchestrate').mattText!.includes('--parent {id}'));
  // Notes go to the root's issue file or the GitHub issue ({note}); states through `state`.
  for (const id of ['plan', 'prototype', 'triage']) assert.ok(preset(id).mattText!.includes('{note}'), id);
  for (const id of ['plan', 'triage', 'orchestrate']) assert.ok(preset(id).mattText!.includes('{cli} state'), id);
  assert.ok(preset('orchestrate').mattText!.includes('{cli} claim'));
  // Plan says what becomes of this task once a feature supersedes it.
  assert.ok(preset('plan').mattText!.includes('{cli} state {id} done'));
  // Triage never relabels or closes by itself; wontfix goes through the CLI too.
  const triage = preset('triage').mattText!;
  assert.ok(triage.includes('{cli} state {id} <state>'));
  assert.match(triage, /wontfix/);
  assert.match(triage, /do not change labels or close/i);
  // Diagnose: no correct seam is itself the finding; cleanup before done.
  const diagnose = preset('diagnose').mattText!;
  assert.match(diagnose, /no correct seam/);
  assert.match(diagnose, /\[DEBUG-/);
  assert.match(diagnose, /throwaway/);
});

test('usesMattSkills: only when switched on and every skill the preset names is found', () => {
  const implement = preset('implement');
  assert.equal(usesMattSkills(implement, { use: true, found: ALL }), true);
  assert.equal(usesMattSkills(implement, { use: false, found: ALL }), false);
  assert.equal(usesMattSkills(implement, { use: true, found: ['implement', 'tdd'] }), false);
  assert.equal(usesMattSkills(implement, NO_SKILLS), false);
  // A hidden dependency missing keeps the plain text.
  assert.equal(usesMattSkills(preset('plan'), { use: true, found: ALL.filter((n) => n !== 'domain-modeling') }), false);
  assert.equal(usesMattSkills(preset('plan'), { use: true, found: ['grill-with-docs', 'to-spec', 'to-tickets', 'grilling', 'domain-modeling'] }), true);
  assert.equal(usesMattSkills({ id: 'custom-x', name: 'X', text: 'x', builtin: false }, { use: true, found: ALL }), false);
});

test('listPresets: mattText when the skills are in use, text otherwise; a user edit wins over both', () => {
  const pristine = parseStoredPresets(undefined);
  const on = { use: true, found: ALL };
  const byId = (list: ReturnType<typeof listPresets>, id: string) => list.find((p) => p.id === id)!.text;
  assert.equal(byId(listPresets(pristine, on), 'implement'), preset('implement').mattText);
  assert.equal(byId(listPresets(pristine, { use: false, found: ALL }), 'implement'), preset('implement').text);
  assert.equal(byId(listPresets(pristine), 'implement'), preset('implement').text);
  // Only the presets whose skills are all found switch.
  const some = listPresets(pristine, { use: true, found: ['triage', 'grilling', 'domain-modeling', 'implement'] });
  assert.equal(byId(some, 'triage'), preset('triage').mattText);
  assert.equal(byId(some, 'implement'), preset('implement').text);
  // An edited built-in keeps the user's text whatever is installed.
  const edited = setPresetText(pristine, 'implement', 'My way.');
  assert.equal(byId(listPresets(edited, on), 'implement'), 'My way.');
  assert.equal(byId(listPresets(edited), 'implement'), 'My way.');
  // Typing the shipped skills text back is not an edit either.
  assert.deepEqual(setPresetText(edited, 'implement', preset('implement').mattText!), { builtin: {}, custom: [] });
});

test('bug defaults to diagnose only when the toggle is on and Diagnose\'s skills are found', () => {
  const diag = preset('diagnose').skills!;
  assert.equal(resolveSettings({}, {}, ALL).presetByType.bug, 'diagnose');
  assert.equal(resolveSettings({}, {}, [...diag]).presetByType.bug, 'diagnose');
  assert.equal(resolveSettings({}, {}).presetByType.bug, 'implement');
  assert.equal(resolveSettings({}, {}, diag.slice(1)).presetByType.bug, 'implement');
  assert.equal(resolveSettings({ useMattSkills: false }, {}, ALL).presetByType.bug, 'implement');
  // The toggle is global: a project layer cannot turn it off.
  assert.equal(resolveSettings({}, { useMattSkills: false }, ALL).useMattSkills, true);
  // A type the user set keeps the user's preset.
  assert.equal(resolveSettings({ presetByType: { bug: 'plan' } }, {}, ALL).presetByType.bug, 'plan');
  assert.equal(resolveSettings({}, { presetByType: { bug: 'implement' } }, ALL).presetByType.bug, 'implement');
  // The other defaults do not move.
  assert.deepEqual(resolveSettings({}, {}, ALL).presetByType, { enhancement: 'implement', bug: 'diagnose', research: 'plan' });
  // And a bug card starts Diagnose.
  assert.equal(resolveStart(resolveSettings({}, {}, ALL), task('bug'), {}).presetId, 'diagnose');
});

test('parseSettings keeps a boolean useMattSkills only', () => {
  assert.deepEqual(parseSettings({ useMattSkills: false }), { useMattSkills: false });
  assert.deepEqual(parseSettings({ useMattSkills: 'no' }), {});
});

test('the Settings lines: which skills were found, and what each built-in runs with', () => {
  assert.equal(skillsFoundLine(['implement', 'tdd'], true), "Matt Pocock's skills found: implement, tdd. Missing: grill-with-docs, grilling, domain-modeling, to-spec, to-tickets, prototype, implement-spec, code-review, diagnosing-bugs, triage.");
  assert.equal(skillsFoundLine(ALL, true), `Matt Pocock's skills found: ${ALL.join(', ')}.`);
  assert.match(skillsFoundLine([], true), /^None of Matt Pocock's skills were found/);
  assert.equal(skillsFoundLine(null, true), 'The service could not check for skills; the presets use their plain instructions.');
  assert.equal(skillsFoundLine(null, false), "Open a project to check which of Matt Pocock's skills are installed.");
  const on = { use: true, found: ALL };
  assert.equal(presetSkillsNote(preset('implement'), on, false), "Runs with Matt Pocock's skills: /implement, /tdd, /code-review.");
  assert.equal(presetSkillsNote(preset('implement'), { use: false, found: ALL }, false), "Plain instructions: Matt Pocock's skills are switched off (Global).");
  assert.equal(presetSkillsNote(preset('implement'), { use: true, found: ['implement'] }, false), 'Plain instructions until /tdd, /code-review are installed.');
  assert.equal(presetSkillsNote(preset('triage'), { use: true, found: ['grilling', 'domain-modeling'] }, false), 'Plain instructions until /triage is installed.');
  assert.equal(presetSkillsNote(preset('triage'), { use: true, found: ['triage'] }, false), 'Plain instructions until grilling, domain-modeling are installed.');
  assert.equal(presetSkillsNote(preset('implement'), on, true), 'Your text is used, whatever skills are installed.');
  assert.equal(presetSkillsNote({ id: 'custom-x', name: 'X', text: '', builtin: false }, on, false), null);
});
