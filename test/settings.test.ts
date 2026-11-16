import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SUMMARY_PROMPT,
  STORAGE_KEYS,
  createLatestSaver,
  createSettingsStore,
  parseCardOptions,
  parseSettings,
  resolveSettings,
  suggestEnabled,
  resolveStart,
  startsFromExtension,
  type SettingsStorage,
} from '../src/panel/settings.ts';
import { BUILTIN_PRESETS } from '../src/panel/presets.ts';

/** What resolveStart reads: the type, and whether the task has sub-tasks on the board. */
const task = (type: string | null, subtasks = false) => ({ type, subtasks });

// --- resolveSettings ---

test('defaults when nothing is stored', () => {
  const s = resolveSettings({}, {});
  assert.deepEqual(s, DEFAULT_SETTINGS);
  assert.equal(s.autoStart, true);
  assert.equal(s.maxParallel, 3);
  assert.deepEqual(s.defaults, { presetId: 'implement', model: null, agent: null, variant: null, location: 'worktree' });
  assert.deepEqual(s.presetByType, { enhancement: 'implement', bug: 'diagnose', research: 'plan' });
  assert.deepEqual(s.summary, { auto: true, language: 'English', prompt: DEFAULT_SUMMARY_PROMPT });
  assert.equal(s.hideChildren, false);
  assert.deepEqual(s.types, ['enhancement', 'bug', 'chore', 'research']);
  assert.equal(s.presetSet, 'plain');
  assert.equal(s.suggestFields, true);
});

test('suggestFields ("Suggest type and state for new tasks") is global only: a project layer cannot change it', () => {
  assert.equal(resolveSettings({ suggestFields: false }, {}).suggestFields, false);
  assert.equal(resolveSettings({}, { suggestFields: false }).suggestFields, true);
  assert.equal(resolveSettings({ suggestFields: false }, { suggestFields: true }).suggestFields, false);
  assert.deepEqual(parseSettings({ suggestFields: false }), { suggestFields: false });
  assert.deepEqual(parseSettings({ suggestFields: 'no' }), {});
});

test('suggestEnabled: off until the global layer is read (a stored "off" must not flash on), then the global setting', () => {
  assert.equal(suggestEnabled(false, {}), false);
  assert.equal(suggestEnabled(false, { suggestFields: true }), false);
  assert.equal(suggestEnabled(true, {}), true);
  assert.equal(suggestEnabled(true, { suggestFields: false }), false);
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
  assert.deepEqual(s.defaults, { presetId: 'plan', model: 'anthropic/claude-sonnet-5-5', agent: 'plan', variant: null, location: 'project' });
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
      defaults: { presetId: 'plan', model: 7, agent: '', variant: 3, location: 'moon' },
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

test('variant (thinking level): stored per layer and per card, resolved like the model; old values without it read as null', () => {
  assert.deepEqual(parseSettings({ defaults: { variant: ' high ' } }), { defaults: { variant: 'high' } });
  assert.deepEqual(parseCardOptions({ model: 'a/m', variant: 'max' }), { model: 'a/m', variant: 'max' });
  assert.deepEqual(parseCardOptions({ model: 'a/m', variant: '' }), { model: 'a/m' });
  const s = resolveSettings({ defaults: { model: 'a/global', variant: 'low' } }, { defaults: { variant: 'high' } });
  assert.equal(s.defaults.variant, 'high');
  assert.equal(resolveStart(s, task('chore'), {}).variant, 'high');
  assert.equal(resolveStart(s, task('chore'), { variant: 'max' }).variant, 'max');
  // Stored before 0.3: no variant anywhere.
  const old = resolveSettings({ defaults: { model: 'a/m', agent: 'build' } }, {});
  assert.deepEqual(resolveStart(old, task('chore'), { model: 'a/card' }), { presetId: 'implement', model: 'a/card', agent: 'build', variant: null, location: 'worktree' });
});

test('a thinking level needs a model: with no model resolved the variant is dropped', () => {
  const s = resolveSettings({ defaults: { variant: 'high' } }, {});
  assert.equal(resolveStart(s, task('chore'), {}).variant, null);
  assert.equal(resolveStart(s, task('chore'), { variant: 'max' }).variant, null);
  // The card's model owns the level: the global one is not carried onto it.
  assert.equal(resolveStart(s, task('chore'), { model: 'a/m' }).variant, null);
  assert.equal(resolveStart(s, task('chore'), { model: 'a/m', variant: 'high' }).variant, 'high');
});

test('a layer that sets a model owns the thinking level: it is never inherited onto another model', () => {
  const g = { defaults: { model: 'a/x', variant: 'xhigh' } };
  // Card sets model Y, thinking empty: no level (not X's xhigh).
  const s = resolveSettings(g, {});
  assert.equal(resolveStart(s, task('chore'), { model: 'a/y' }).variant, null);
  assert.equal(resolveStart(s, task('chore'), { model: 'a/y', variant: 'low' }).variant, 'low');
  assert.equal(resolveStart(s, task('chore'), {}).variant, 'xhigh');
  // A card that sets only the level keeps the inherited model with that level.
  assert.equal(resolveStart(s, task('chore'), { variant: 'max' }).variant, 'max');
  // Project sets model Y, thinking empty: no level.
  const p = resolveSettings(g, { defaults: { model: 'a/y' } });
  assert.deepEqual([p.defaults.model, p.defaults.variant], ['a/y', null]);
  assert.equal(resolveStart(p, task('chore'), {}).variant, null);
  // Project sets only the level: it applies to the global model.
  assert.equal(resolveSettings(g, { defaults: { variant: 'low' } }).defaults.variant, 'low');
  // Project sets both.
  assert.equal(resolveSettings(g, { defaults: { model: 'a/y', variant: 'high' } }).defaults.variant, 'high');
});

test('startsFromExtension: path B when a model, an agent or a thinking level is set; path A when none is', () => {
  const base = { presetId: 'implement', model: null, agent: null, variant: null, location: 'worktree' as const };
  assert.equal(startsFromExtension(base), false);
  assert.equal(startsFromExtension({ ...base, location: 'project' }), false);
  assert.equal(startsFromExtension({ ...base, model: 'a/m' }), true);
  assert.equal(startsFromExtension({ ...base, agent: 'plan' }), true);
  assert.equal(startsFromExtension({ ...base, variant: 'high' }), true);
});

test('card overrides project and global', () => {
  const s = resolveSettings(
    { defaults: { presetId: 'plan', model: 'a/global', agent: 'build', location: 'worktree' } },
    { defaults: { model: 'a/project' } },
  );
  assert.deepEqual(resolveStart(s, task('chore'), {}), { presetId: 'plan', model: 'a/project', agent: 'build', variant: null, location: 'worktree' });
  assert.deepEqual(resolveStart(s, task('chore'), { presetId: 'prototype', model: 'a/card', agent: 'plan', location: 'project' }), {
    presetId: 'prototype',
    model: 'a/card',
    agent: 'plan',
    variant: null,
    location: 'project',
  });
});

test('preset order: card, then the type default, then defaults.presetId', () => {
  const s = resolveSettings({ defaults: { presetId: 'prototype' } }, {});
  assert.equal(resolveStart(s, task('research'), {}).presetId, 'plan');
  assert.equal(resolveStart(s, task('bug'), {}).presetId, 'diagnose');
  assert.equal(resolveStart(s, task('chore'), {}).presetId, 'prototype');
  assert.equal(resolveStart(s, task(null), {}).presetId, 'prototype');
  assert.equal(resolveStart(s, task('research'), { presetId: 'orchestrate' }).presetId, 'orchestrate');
});

test('a task with sub-tasks defaults to orchestrate; the card choice still wins', () => {
  const s = resolveSettings({ defaults: { presetId: 'prototype' }, presetByType: { enhancement: 'plan' } }, {});
  assert.equal(resolveStart(s, task('enhancement', true), {}).presetId, 'orchestrate');
  assert.equal(resolveStart(s, task('bug', true), {}).presetId, 'orchestrate');
  assert.equal(resolveStart(s, task(null, true), {}).presetId, 'orchestrate');
  assert.equal(resolveStart(s, task('enhancement', true), { presetId: 'implement' }).presetId, 'implement');
});

test('a task without sub-tasks (a local spec.md too) takes its type preset; research that adds sub-tasks then orchestrates', () => {
  const s = resolveSettings({}, {});
  assert.equal(resolveStart(s, task('bug'), {}).presetId, 'diagnose');
  assert.equal(resolveStart(s, task('enhancement'), {}).presetId, 'implement');
  assert.equal(resolveStart(s, task('research'), {}).presetId, 'plan');
  assert.equal(resolveStart(s, task('research', true), {}).presetId, 'orchestrate');
  const mine = resolveSettings({ presetByType: { bug: 'triage' } }, {});
  assert.equal(resolveStart(mine, task('bug'), {}).presetId, 'triage');
  assert.equal(resolveStart(s, task('bug'), { presetId: 'orchestrate' }).presetId, 'orchestrate');
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
  assert.deepEqual(resolveStart(s, task('bug'), card), { presetId: 'diagnose', model: 'a/m', agent: 'build', variant: null, location: 'worktree' });
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

test('moveCard: a task that got a new id keeps its start options under it; the old key is deleted', async () => {
  const { data, storage } = fakeStorage();
  const store = createSettingsStore(storage);
  await store.saveCard('p1', '.scratch/a/issues/01-x.md', { presetId: 'plan' });
  await store.moveCard('p1', '.scratch/a/issues/01-x.md', '.scratch/b/issues/03-x.md');
  assert.equal(data.has('card:p1:.scratch/a/issues/01-x.md'), false);
  assert.deepEqual(data.get('card:p1:.scratch/b/issues/03-x.md'), { presetId: 'plan' });
  // Nothing stored: nothing written under the new id.
  await store.moveCard('p1', '#1', '#2');
  assert.equal(data.has('card:p1:#2'), false);
});

test('"No type" marks: kept per project and task, follow a new id, go with the task', async () => {
  const { data, storage } = fakeStorage();
  const store = createSettingsStore(storage);
  assert.equal(STORAGE_KEYS.noType('p1', '#1'), 'noType:p1:#1');
  assert.equal(await store.hasNoType('p1', '#1'), false);
  await store.markNoType('p1', '#1');
  assert.equal(await store.hasNoType('p1', '#1'), true);
  assert.equal(await store.hasNoType('p2', '#1'), false, 'per project');
  await store.moveNoType('p1', '#1', '#9');
  assert.equal(await store.hasNoType('p1', '#1'), false);
  assert.equal(await store.hasNoType('p1', '#9'), true);
  await store.moveNoType('p1', '#2', '#3'); // nothing marked: nothing written
  assert.equal(data.has('noType:p1:#3'), false);
  await store.forgetNoType('p1', '#9');
  assert.equal(await store.hasNoType('p1', '#9'), false);
  assert.equal(data.size, 0);
  data.set('noType:p1:#5', 'garbage');
  assert.equal(await store.hasNoType('p1', '#5'), false, 'only a stored true counts');
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

test('last used project: one id for every frame, read defensively, cleared with null', async () => {
  const { STORAGE_KEYS: K, createSettingsStore: create } = await import('../src/panel/settings.ts');
  const data = new Map<string, unknown>();
  const storage: SettingsStorage = {
    get: async (k) => data.get(k),
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
  const s = create(storage);
  assert.equal(await s.loadLastProject(), null);
  await s.saveLastProject('p1');
  assert.equal(data.get(K.lastProject), 'p1');
  assert.equal(await s.loadLastProject(), 'p1');
  data.set(K.lastProject, { id: 'p1' });
  assert.equal(await s.loadLastProject(), null);
  await s.saveLastProject(null);
  assert.equal(data.has(K.lastProject), false);
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

test('manual card order: stored under taskOrder:<projectId> as an id list, at most ORDER_MAX; empty deletes', async () => {
  const { ORDER_MAX } = await import('../src/panel/order.ts');
  const { data, storage } = fakeStorage();
  const store = createSettingsStore(storage);
  assert.equal(STORAGE_KEYS.taskOrder('p1'), 'taskOrder:p1');
  await store.saveOrder('p1', ['b', 'a']);
  assert.deepEqual(data.get('taskOrder:p1'), ['b', 'a']);
  assert.deepEqual(await store.loadOrder('p1'), ['b', 'a']);
  await store.saveOrder('p1', Array.from({ length: ORDER_MAX + 1 }, (_, i) => `t${i}`));
  assert.equal((data.get('taskOrder:p1') as string[]).length, ORDER_MAX);
  await store.saveOrder('p1', []);
  assert.equal(data.has('taskOrder:p1'), false);
  assert.deepEqual(await store.loadOrder('p2'), []);
});

test('summary language: a fresh install summarises in English; a language the user set survives an update', async () => {
  const data = new Map<string, unknown>();
  const storage = {
    get: async (k: string) => data.get(k),
    set: async (k: string, v: never) => void data.set(k, v),
    delete: async (k: string) => void data.delete(k),
  };
  const store = createSettingsStore(storage);
  // First run: nothing stored, and nothing gets written just by reading the settings.
  assert.equal(resolveSettings(await store.loadGlobal(), {}).summary.language, 'English');
  assert.equal(data.has(STORAGE_KEYS.global), false);
  // Only what the user typed is stored, so a new default never replaces it (Polish was 0.3's default).
  await store.saveGlobal({ summary: { language: 'Polish' } });
  assert.equal(resolveSettings(await createSettingsStore(storage).loadGlobal(), {}).summary.language, 'Polish');
});

// --- Shortcut overrides (keymap.ts) ---

test('shortcut overrides: global only, read defensively, only overrides kept', () => {
  assert.deepEqual(DEFAULT_SETTINGS.shortcuts, {});
  assert.deepEqual(resolveSettings({ shortcuts: { 'board.addTask': 'Mod+Shift+a' } }, {}).shortcuts, { 'board.addTask': 'Mod+Shift+a' });
  // Per-project bindings are out of scope: a project layer cannot change them.
  assert.deepEqual(resolveSettings({}, { shortcuts: { 'board.addTask': 'Mod+Shift+a' } }).shortcuts, {});
  assert.deepEqual(
    parseSettings({ shortcuts: { 'board.addTask': 'Mod+Shift+a', 'board.selectUp': 'Mod+U', 'nope.action': 'Mod+X', 'task.edit': 42 } }),
    { shortcuts: { 'board.addTask': 'Mod+Shift+a' } },
  );
  assert.deepEqual(parseSettings({ shortcuts: 'Mod+A' }), {});
  assert.deepEqual(parseSettings({ shortcuts: {} }), {});
});

test('store: shortcut overrides round-trip in the global layer; resetting all deletes them', async () => {
  const { data, storage } = fakeStorage();
  const store = createSettingsStore(storage);
  await store.saveGlobal({ maxParallel: 2, shortcuts: { 'task.edit': 'Mod+Shift+e' } });
  assert.deepEqual(data.get('settings:global'), { maxParallel: 2, shortcuts: { 'task.edit': 'Mod+Shift+e' } });
  assert.deepEqual((await store.loadGlobal()).shortcuts, { 'task.edit': 'Mod+Shift+e' });
  await store.saveGlobal({ maxParallel: 2, shortcuts: {} });
  assert.deepEqual(data.get('settings:global'), { maxParallel: 2 });
  await store.saveGlobal({ shortcuts: {} });
  assert.equal(data.has('settings:global'), false);
});
