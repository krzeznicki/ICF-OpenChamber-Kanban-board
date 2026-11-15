import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import type { Exec } from '../src/core/types.ts';
import {
  apiArgs,
  createAgentList,
  createModelList,
  MODELS_TIMEOUT_MS,
  MODELS_TTL_MS,
  parseApiAgents,
  parseApiModels,
  parseModels,
} from '../src/service/models.ts';
import { handle } from '../src/service/routes.ts';

const directory = tmpdir();

type Call = { cmd: string; args: string[]; cwd: string; timeoutMs?: number };
type Result = { code: number; stdout: string; stderr?: string } | Error;

/** A fake exec that answers from a queue of results and records each call. */
const fakeExec = (results: Result[]) => {
  const calls: Call[] = [];
  const exec: Exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd, ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
    const r = results.shift();
    if (r === undefined) throw new Error('unexpected exec call');
    if (r instanceof Error) throw r;
    return { code: r.code, stdout: r.stdout, stderr: r.stderr ?? '' };
  };
  return { exec, calls };
};

/** `/api/model` as OpenCode answers it (trimmed to the fields that matter, plus noise). */
const apiModels = (models: Array<{ providerID: string; id: string; name?: string; variants?: string[] }>): string =>
  JSON.stringify({
    location: { directory },
    data: models.map((m) => ({
      id: m.id,
      modelID: m.id,
      providerID: m.providerID,
      ...(m.name !== undefined ? { name: m.name } : {}),
      variants: (m.variants ?? []).map((id) => ({ id, settings: {} })),
      enabled: true,
    })),
  });
const ok = (stdout: string): Result => ({ code: 0, stdout });

test('parseModels keeps provider/model lines, trimmed, deduplicated, in order', () => {
  const out = [
    'anthropic/claude-sonnet-5-5',
    '',
    '  openai/gpt-6  ',
    'not a model',
    'Some header: here',
    '/missing-provider',
    'missing-model/',
    'anthropic/claude-sonnet-5-5',
    'openrouter/meta/llama-5',
    '\u001b[32mgreen/model\u001b[0m',
    'two words/x y',
  ].join('\r\n');
  assert.deepEqual(parseModels(out), [
    'anthropic/claude-sonnet-5-5',
    'openai/gpt-6',
    'openrouter/meta/llama-5',
    'green/model',
  ]);
});

test('parseApiModels: id is provider/model id, name falls back to the id, variants are the thinking levels', () => {
  const out = apiModels([
    { providerID: 'anthropic', id: 'claude-opus-5-5', name: 'Claude Opus 5.5', variants: ['low', 'high', 'max'] },
    { providerID: 'openrouter', id: 'google/gemini-4', name: 'Gemini 4' },
    { providerID: 'local', id: 'tiny' },
  ]);
  assert.deepEqual(parseApiModels(out), [
    { id: 'anthropic/claude-opus-5-5', name: 'Claude Opus 5.5', variants: ['low', 'high', 'max'] },
    { id: 'openrouter/google/gemini-4', name: 'Gemini 4', variants: [] },
    { id: 'local/tiny', name: 'local/tiny', variants: [] },
  ]);
});

test('parseApiModels drops malformed entries and duplicates, and is null for an answer that is not a model list', () => {
  const out = JSON.stringify({
    data: [
      { id: 'a', providerID: 'p', name: 'A', variants: [{ id: 'high' }, { id: '' }, { nope: 1 }, 'x', { id: 'high' }] },
      { id: 'a', providerID: 'p', name: 'A again' },
      { id: '', providerID: 'p' },
      { id: 'b' },
      { id: 'c', providerID: 'p', name: 7, variants: 'high' },
      null,
      'text',
      { id: 'two words', providerID: 'p' },
      { id: 'd', providerID: 'p', name: '  ' },
    ],
  });
  assert.deepEqual(parseApiModels(out), [
    { id: 'p/a', name: 'A', variants: ['high'] },
    { id: 'p/c', name: 'p/c', variants: [] },
    { id: 'p/d', name: 'p/d', variants: [] },
  ]);
  assert.equal(parseApiModels('not json'), null);
  assert.equal(parseApiModels('{"data":{}}'), null);
  assert.equal(parseApiModels('[]'), null);
  assert.equal(parseApiModels('null'), null);
});

test('parseApiAgents keeps the primary agents that are not hidden', () => {
  const out = JSON.stringify({
    data: [
      { id: 'build', name: 'Build', mode: 'primary', hidden: false, description: 'The default agent.' },
      { id: 'general', name: 'General', mode: 'subagent', hidden: false, description: 'x' },
      { id: 'title', name: 'Title', mode: 'primary', hidden: true },
      { id: 'plan', mode: 'primary' },
      { id: 'all', name: 'All', mode: 'all', description: 5 },
      { id: 'build', name: 'Build twice', mode: 'primary' },
      { name: 'No id', mode: 'primary' },
      null,
    ],
  });
  assert.deepEqual(parseApiAgents(out), [
    { id: 'build', name: 'Build', description: 'The default agent.' },
    { id: 'plan', name: 'plan', description: '' },
    { id: 'all', name: 'All', description: '' },
  ]);
  assert.equal(parseApiAgents('oops'), null);
  assert.equal(parseApiAgents('{"agents":[]}'), null);
});

test('apiArgs asks the server for the project: the directory goes URI-encoded in the x-opencode-directory header', () => {
  assert.deepEqual(apiArgs('/api/model', '/tmp/zażółć dir'), [
    'api',
    'GET',
    '/api/model',
    '-H',
    `x-opencode-directory:${encodeURIComponent('/tmp/zażółć dir')}`,
  ]);
});

test('models come from `opencode api GET /api/model` in the project, with a timeout, cached for 10 minutes', async () => {
  const { exec, calls } = fakeExec([
    ok(apiModels([{ providerID: 'a', id: 'one', name: 'One', variants: ['high'] }])),
    ok(apiModels([{ providerID: 'c', id: 'three', name: 'Three' }])),
  ]);
  let now = 1_000;
  const list = createModelList(exec, () => now);
  const first = { models: [{ id: 'a/one', name: 'One', variants: ['high'] }] };
  assert.deepEqual(await list(directory), first);
  now += MODELS_TTL_MS - 1;
  assert.deepEqual(await list(directory), first);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { cmd: 'opencode', args: apiArgs('/api/model', directory), cwd: directory, timeoutMs: MODELS_TIMEOUT_MS });
  now += 2;
  assert.deepEqual(await list(directory), { models: [{ id: 'c/three', name: 'Three', variants: [] }] });
  assert.equal(calls.length, 2);
});

test('when the API fails, models fall back to `opencode models` (names are the ids, no thinking levels)', async () => {
  const { exec, calls } = fakeExec([{ code: 1, stdout: '', stderr: 'unknown command api' }, ok('a/one\nb/two\n')]);
  const list = createModelList(exec, () => 0);
  assert.deepEqual(await list(directory), {
    models: [
      { id: 'a/one', name: 'a/one', variants: [] },
      { id: 'b/two', name: 'b/two', variants: [] },
    ],
  });
  assert.deepEqual(calls[1], { cmd: 'opencode', args: ['models'], cwd: directory, timeoutMs: MODELS_TIMEOUT_MS });
  // An unparsable or empty answer and a throw also fall back.
  for (const bad of [ok('<html>'), ok('{"data":[]}'), new Error('spawn exploded')]) {
    const f = fakeExec([bad, ok('a/one\n')]);
    assert.deepEqual(await createModelList(f.exec, () => 0)(directory), { models: [{ id: 'a/one', name: 'a/one', variants: [] }] });
  }
});

test('concurrent requests share one run; each project has its own cache', async () => {
  const { exec, calls } = fakeExec([ok(apiModels([{ providerID: 'a', id: 'one' }])), ok(apiModels([{ providerID: 'b', id: 'two' }]))]);
  const list = createModelList(exec, () => 0);
  const [x, y] = await Promise.all([list('/p1'), list('/p1')]);
  assert.deepEqual(x, y);
  assert.deepEqual((await list('/p2')).models.map((m) => m.id), ['b/two']);
  assert.deepEqual((await list('/p1')).models.map((m) => m.id), ['a/one']);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.cwd, '/p2');
});

test('when both fail the answer is no models with the errors, not cached', async () => {
  const { exec, calls } = fakeExec([
    { code: 2, stdout: '', stderr: 'api down' },
    { code: 127, stdout: '', stderr: 'opencode: command not found' },
    ok('{}'),
    ok('nothing useful\n'),
    ok(apiModels([{ providerID: 'a', id: 'one' }])),
  ]);
  const list = createModelList(exec, () => 0);
  const missing = await list(directory);
  assert.deepEqual(missing.models, []);
  assert.match(missing.error ?? '', /api down/);
  assert.match(missing.error ?? '', /opencode: command not found/);
  const empty = await list(directory);
  assert.deepEqual(empty.models, []);
  assert.match(empty.error ?? '', /no models/i);
  assert.deepEqual((await list(directory)).models.map((m) => m.id), ['a/one']);
  assert.equal(calls.length, 5);
});

test('agents come from `opencode api GET /api/agent`, cached per project for 10 minutes; a failure is not cached', async () => {
  const agents = (ids: string[]) => JSON.stringify({ data: ids.map((id) => ({ id, name: id.toUpperCase(), mode: 'primary', hidden: false, description: `${id} agent` })) });
  const { exec, calls } = fakeExec([
    { code: 1, stdout: '', stderr: 'no server' },
    ok('garbage'),
    ok(agents(['build', 'plan'])),
    ok(agents(['build'])),
  ]);
  let now = 0;
  const list = createAgentList(exec, () => now);
  const failed = await list(directory);
  assert.deepEqual(failed.agents, []);
  assert.match(failed.error ?? '', /no server/);
  const garbled = await list(directory);
  assert.deepEqual(garbled.agents, []);
  assert.match(garbled.error ?? '', /could not read/i);
  const good = {
    agents: [
      { id: 'build', name: 'BUILD', description: 'build agent' },
      { id: 'plan', name: 'PLAN', description: 'plan agent' },
    ],
  };
  assert.deepEqual(await list(directory), good);
  now += MODELS_TTL_MS - 1;
  assert.deepEqual(await list(directory), good);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2], { cmd: 'opencode', args: apiArgs('/api/agent', directory), cwd: directory, timeoutMs: MODELS_TIMEOUT_MS });
  now += 2;
  assert.deepEqual((await list(directory)).agents.map((a) => a.id), ['build']);
});

test('POST /models/list and /agents/list answer the lists, and a failure as 200 with an error (never 500)', async () => {
  const good = fakeExec([ok(apiModels([{ providerID: 'a', id: 'one', name: 'One', variants: ['max'] }]))]);
  const r = await handle('POST', '/models/list', { directory }, { exec: good.exec });
  assert.deepEqual(r, { status: 200, json: { models: [{ id: 'a/one', name: 'One', variants: ['max'] }] } });

  const bad = fakeExec([{ code: 1, stdout: '', stderr: 'boom' }, { code: 1, stdout: '', stderr: 'boom too' }]);
  const f = await handle('POST', '/models/list', { directory }, { exec: bad.exec });
  assert.equal(f.status, 200);
  assert.deepEqual((f.json as { models: unknown[] }).models, []);
  assert.match((f.json as { error: string }).error, /boom/);

  const agents = fakeExec([ok(JSON.stringify({ data: [{ id: 'build', name: 'Build', mode: 'primary', description: 'd' }] }))]);
  const a = await handle('POST', '/agents/list', { directory }, { exec: agents.exec });
  assert.deepEqual(a, { status: 200, json: { agents: [{ id: 'build', name: 'Build', description: 'd' }] } });

  const noAgents = fakeExec([new Error('spawn failed')]);
  const n = await handle('POST', '/agents/list', { directory }, { exec: noAgents.exec });
  assert.equal(n.status, 200);
  assert.deepEqual((n.json as { agents: unknown[] }).agents, []);
  assert.match((n.json as { error: string }).error, /spawn failed/);
});

test('POST /models/list and /agents/list cache across requests of one service (same exec)', async () => {
  const { exec, calls } = fakeExec([
    ok(apiModels([{ providerID: 'a', id: 'one' }])),
    ok(JSON.stringify({ data: [{ id: 'build', mode: 'primary' }] })),
  ]);
  await handle('POST', '/models/list', { directory }, { exec });
  await handle('POST', '/models/list', { directory }, { exec });
  await handle('POST', '/agents/list', { directory }, { exec });
  await handle('POST', '/agents/list', { directory }, { exec });
  assert.equal(calls.length, 2);
});
