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
  renamePreset,
  resetPreset,
  setPresetText,
} from '../src/panel/presets.ts';

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

test('built-in presets: the five ids in order, each with text', () => {
  assert.deepEqual(
    BUILTIN_PRESETS.map((p) => p.id),
    ['plan', 'prototype', 'implement', 'implement-no-questions', 'orchestrate'],
  );
  for (const p of BUILTIN_PRESETS) {
    assert.equal(p.builtin, true);
    assert.ok(p.text.trim().length > 40, p.id);
  }
  assert.deepEqual(
    BUILTIN_PRESETS.map((p) => p.name),
    ['Plan', 'Prototype', 'Implement', 'Implement without questions', 'Break down and orchestrate'],
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
  assert.deepEqual(list.slice(5), [
    { id: 'custom-review', name: 'Code review', text: 'Review the diff.', builtin: false },
    { id: 'custom-review-2', name: 'Review', text: '', builtin: false },
  ]);
  stored = deletePreset(stored, 'custom-review');
  assert.deepEqual(
    listPresets(stored).map((p) => p.id),
    ['plan', 'prototype', 'implement', 'implement-no-questions', 'orchestrate', 'custom-review-2'],
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
