import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL_ID,
  STATUS_ID,
  createModelLoader,
  defaultModelLabel,
  modelOptions,
  pickedModel,
} from '../src/panel/models.ts';

test('defaultModelLabel names what the default resolves to', () => {
  assert.equal(defaultModelLabel(null), 'Default (current selection)');
  assert.equal(defaultModelLabel('a/one'), 'Default (a/one)');
  assert.equal(defaultModelLabel(null, 'Use global'), 'Use global (current selection)');
});

test('options: the default first, then the models sorted by provider and model', () => {
  const opts = modelOptions({ models: ['b/zeta', 'a/two', 'a/one'], value: null, defaultLabel: 'Default (current selection)' });
  assert.deepEqual(opts, [
    { id: DEFAULT_MODEL_ID, label: 'Default (current selection)' },
    { id: 'a/one', label: 'a/one' },
    { id: 'a/two', label: 'a/two' },
    { id: 'b/zeta', label: 'b/zeta' },
  ]);
});

test('a stored model missing from the list still shows, marked, right after the default', () => {
  const opts = modelOptions({ models: ['a/one'], value: 'gone/model', defaultLabel: 'Default (x)' });
  assert.deepEqual(opts.slice(0, 3), [
    { id: DEFAULT_MODEL_ID, label: 'Default (x)' },
    { id: 'gone/model', label: 'gone/model', hint: 'not in the list' },
    { id: 'a/one', label: 'a/one' },
  ]);
});

test('a stored model in the list is not repeated', () => {
  const opts = modelOptions({ models: ['a/one'], value: 'a/one', defaultLabel: 'D' });
  assert.deepEqual(opts.map((o) => o.id), [DEFAULT_MODEL_ID, 'a/one']);
});

test('while loading: the stored model without a mark, and a loading row', () => {
  const opts = modelOptions({ models: null, value: 'a/one', defaultLabel: 'D' });
  assert.deepEqual(opts, [
    { id: DEFAULT_MODEL_ID, label: 'D' },
    { id: 'a/one', label: 'a/one' },
    { id: STATUS_ID, label: 'Loading models…' },
  ]);
});

test('after a failure: the stored model and a row to try again with the reason', () => {
  const opts = modelOptions({ models: null, value: null, defaultLabel: 'D', error: 'opencode: command not found' });
  assert.deepEqual(opts, [
    { id: DEFAULT_MODEL_ID, label: 'D' },
    { id: STATUS_ID, label: 'Couldn’t load models — try again', hint: 'opencode: command not found' },
  ]);
  const long = modelOptions({ models: null, value: null, defaultLabel: 'D', error: 'x'.repeat(300) });
  assert.ok((long[1]!.hint ?? '').length <= 80);
});

test('pickedModel maps the default to null and ignores the status row', () => {
  assert.deepEqual(pickedModel(DEFAULT_MODEL_ID), { value: null });
  assert.deepEqual(pickedModel('a/one'), { value: 'a/one' });
  assert.equal(pickedModel(STATUS_ID), null);
});

test('the loader fetches once and shares the answer', async () => {
  let calls = 0;
  const load = createModelLoader(async () => {
    calls++;
    return { models: ['a/one'] };
  });
  const [x, y] = await Promise.all([load(), load()]);
  assert.deepEqual(x, ['a/one']);
  assert.deepEqual(y, ['a/one']);
  assert.deepEqual(await load(), ['a/one']);
  assert.equal(calls, 1);
});

test('the loader does not keep a failure: an error answer or a throw is tried again', async () => {
  const answers: Array<() => Promise<{ models: string[]; error?: string }>> = [
    async () => ({ models: [], error: 'boom' }),
    async () => {
      throw new Error('no service');
    },
    async () => ({ models: ['a/one'] }),
  ];
  let calls = 0;
  const load = createModelLoader(() => answers[calls++]!());
  await assert.rejects(load(), /boom/);
  await assert.rejects(load(), /no service/);
  assert.deepEqual(await load(), ['a/one']);
  assert.deepEqual(await load(), ['a/one']);
  assert.equal(calls, 3);
});
