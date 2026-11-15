import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_SELECTION,
  DEFAULT_MODEL_ID,
  STATUS_ID,
  agentOptions,
  createAgentLoader,
  createModelLoader,
  defaultLabel,
  keptVariant,
  modelOptions,
  pickedModel,
  thinkingDefaultLabel,
  thinkingField,
  type ModelInfo,
} from '../src/panel/models.ts';

const m = (id: string, name = id, variants: string[] = []): ModelInfo => ({ id, name, variants });

test('defaultLabel: OpenChamber’s current selection when nothing is inherited, else the inherited name', () => {
  assert.equal(CURRENT_SELECTION, "Default — OpenChamber's current selection");
  assert.equal(defaultLabel(null), "Default — OpenChamber's current selection");
  assert.equal(defaultLabel('Claude Opus'), 'Default (Claude Opus)');
  assert.equal(defaultLabel(null, 'Use global'), "Use global — OpenChamber's current selection");
  assert.equal(defaultLabel('high', 'Use global'), 'Use global (high)');
});

test('model options: the default first, then the models by name, each with its id as hint (search covers both)', () => {
  const opts = modelOptions({
    models: [m('b/zeta', 'Zeta'), m('a/two', 'Alpha 2'), m('a/one', 'Alpha 1'), m('c/x')],
    value: null,
    defaultLabel: 'D',
  });
  assert.deepEqual(opts, [
    { id: DEFAULT_MODEL_ID, label: 'D' },
    { id: 'a/one', label: 'Alpha 1', hint: 'a/one' },
    { id: 'a/two', label: 'Alpha 2', hint: 'a/two' },
    { id: 'c/x', label: 'c/x' },
    { id: 'b/zeta', label: 'Zeta', hint: 'b/zeta' },
  ]);
});

test('a stored model missing from the list still shows, marked, right after the default; one in the list is not repeated', () => {
  const opts = modelOptions({ models: [m('a/one', 'One')], value: 'gone/model', defaultLabel: 'D' });
  assert.deepEqual(opts.slice(0, 3), [
    { id: DEFAULT_MODEL_ID, label: 'D' },
    { id: 'gone/model', label: 'gone/model', hint: 'not in the list' },
    { id: 'a/one', label: 'One', hint: 'a/one' },
  ]);
  assert.deepEqual(modelOptions({ models: [m('a/one')], value: 'a/one', defaultLabel: 'D' }).map((o) => o.id), [DEFAULT_MODEL_ID, 'a/one']);
});

test('while loading and after a failure: the stored model and a status row', () => {
  assert.deepEqual(modelOptions({ models: null, value: 'a/one', defaultLabel: 'D' }), [
    { id: DEFAULT_MODEL_ID, label: 'D' },
    { id: 'a/one', label: 'a/one' },
    { id: STATUS_ID, label: 'Loading models…' },
  ]);
  assert.deepEqual(modelOptions({ models: null, value: null, defaultLabel: 'D', error: 'opencode: command not found' }), [
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

test('agent options: the default, the stored agent if missing, then the agents in their order with descriptions as hints', () => {
  const agents = [
    { id: 'build', name: 'Build', description: 'The default agent.' },
    { id: 'plan', name: 'Plan', description: '' },
  ];
  assert.deepEqual(agentOptions({ agents, value: null, defaultLabel: 'D' }), [
    { id: DEFAULT_MODEL_ID, label: 'D' },
    { id: 'build', label: 'Build', hint: 'The default agent.' },
    { id: 'plan', label: 'Plan' },
  ]);
  assert.deepEqual(agentOptions({ agents, value: 'review', defaultLabel: 'D' })[1], { id: 'review', label: 'review', hint: 'not in the list' });
  assert.deepEqual(agentOptions({ agents: null, value: null, defaultLabel: 'D' })[1], { id: STATUS_ID, label: 'Loading agents…' });
  assert.equal(agentOptions({ agents: null, value: null, defaultLabel: 'D', error: 'down' })[1]!.label, 'Couldn’t load agents — try again');
});

test('thinking: disabled without a model, and for a model with no levels', () => {
  const models = [m('a/think', 'Think', ['low', 'high', 'max']), m('a/flat', 'Flat')];
  const none = thinkingField({ model: null, models, value: null, defaultLabel: 'D' });
  assert.equal(none.disabled, true);
  assert.equal(none.reason, 'Pick a model first');
  assert.deepEqual(none.options, [{ id: DEFAULT_MODEL_ID, label: 'D' }]);
  const flat = thinkingField({ model: 'a/flat', models, value: null, defaultLabel: 'D' });
  assert.equal(flat.disabled, true);
  assert.equal(flat.reason, 'This model has no thinking levels');
});

test('thinking: the levels of the model in their order; a stored level the model lacks stays, marked', () => {
  const models = [m('a/think', 'Think', ['low', 'high', 'max'])];
  const f = thinkingField({ model: 'a/think', models, value: null, defaultLabel: 'D' });
  assert.equal(f.disabled, false);
  assert.deepEqual(f.options, [
    { id: DEFAULT_MODEL_ID, label: 'D' },
    { id: 'low', label: 'low' },
    { id: 'high', label: 'high' },
    { id: 'max', label: 'max' },
  ]);
  const stale = thinkingField({ model: 'a/think', models, value: 'xhigh', defaultLabel: 'D' });
  assert.deepEqual(stale.options[1], { id: 'xhigh', label: 'xhigh', hint: 'not offered by this model' });
  // A model not in the list (or the list not loaded): the stored level is kept, nothing else offered.
  const unknown = thinkingField({ model: 'gone/m', models, value: 'high', defaultLabel: 'D' });
  assert.equal(unknown.disabled, false);
  assert.deepEqual(unknown.options.map((o) => o.id), [DEFAULT_MODEL_ID, 'high']);
  const loading = thinkingField({ model: 'a/think', models: null, value: null, defaultLabel: 'D' });
  assert.deepEqual(loading.options.map((o) => o.id), [DEFAULT_MODEL_ID, STATUS_ID]);
});

test('keptVariant: a level survives a model change only if the new model offers it (or its levels are unknown)', () => {
  const models = [m('a/x', 'X', ['low', 'high']), m('a/y', 'Y', ['max']), m('a/z', 'Z')];
  assert.equal(keptVariant('high', 'a/x', models), 'high');
  assert.equal(keptVariant('high', 'a/y', models), null);
  assert.equal(keptVariant('high', 'a/z', models), null);
  assert.equal(keptVariant('high', 'gone/m', models), 'high');
  assert.equal(keptVariant('high', 'a/y', null), 'high');
  assert.equal(keptVariant(null, 'a/x', models), null);
  // Back to the default model: the level is kept (it may apply to an inherited model).
  assert.equal(keptVariant('high', null, models), 'high');
});

test('the model loader fetches once per project and shares the answer; failures are tried again', async () => {
  let calls = 0;
  const answers: Array<() => Promise<{ models: ModelInfo[]; error?: string }>> = [
    async () => ({ models: [], error: 'boom' }),
    async () => {
      throw new Error('no service');
    },
    async () => ({ models: [m('a/one')] }),
  ];
  const load = createModelLoader(() => answers[calls++]!());
  await assert.rejects(load(), /boom/);
  await assert.rejects(load(), /no service/);
  const [x, y] = await Promise.all([load(), load()]);
  assert.deepEqual(x, [m('a/one')]);
  assert.deepEqual(y, [m('a/one')]);
  assert.deepEqual(await load(), [m('a/one')]);
  assert.equal(calls, 3);
});

test('the loaders keep one list per project directory; no project rejects', async () => {
  let dir: string | null = '/a';
  const asked: string[] = [];
  const load = createAgentLoader(
    async (d) => {
      asked.push(d);
      return { agents: [{ id: `${d}-agent`, name: 'A', description: '' }] };
    },
    () => dir,
  );
  assert.equal((await load())[0]!.id, '/a-agent');
  dir = '/b';
  assert.equal((await load())[0]!.id, '/b-agent');
  dir = '/a';
  await load();
  assert.deepEqual(asked, ['/a', '/b']);
  dir = null;
  await assert.rejects(load(), /Open a project/);
  const failing = createAgentLoader(async () => ({ agents: [], error: 'down' }));
  await assert.rejects(failing(), /down/);
});

test('thinking’s default: the inherited level, else the model’s own default, else OpenChamber’s selection', () => {
  assert.equal(thinkingDefaultLabel('high', true), 'Default (high)');
  assert.equal(thinkingDefaultLabel(null, true), 'Default — the model’s default');
  assert.equal(thinkingDefaultLabel(null, false), "Default — OpenChamber's current selection");
  assert.equal(thinkingDefaultLabel(null, true, 'Use global'), 'Use global — the model’s default');
});
