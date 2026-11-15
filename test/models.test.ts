import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import type { Exec } from '../src/core/types.ts';
import { createModelList, MODELS_TIMEOUT_MS, MODELS_TTL_MS, parseModels } from '../src/service/models.ts';
import { handle } from '../src/service/routes.ts';

const directory = tmpdir();

type Call = { cmd: string; args: string[]; cwd: string; timeoutMs?: number };

/** A fake exec that answers `opencode models` from a queue of results and records each call. */
const fakeExec = (results: Array<{ code: number; stdout: string; stderr?: string } | Error>) => {
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

test('the list runs `opencode models` in the project with a timeout and caches it for 10 minutes', async () => {
  const { exec, calls } = fakeExec([
    { code: 0, stdout: 'a/one\nb/two\n' },
    { code: 0, stdout: 'a/one\nc/three\n' },
  ]);
  let now = 1_000;
  const list = createModelList(exec, () => now);
  assert.deepEqual(await list(directory), { models: ['a/one', 'b/two'] });
  now += MODELS_TTL_MS - 1;
  assert.deepEqual(await list(directory), { models: ['a/one', 'b/two'] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { cmd: 'opencode', args: ['models'], cwd: directory, timeoutMs: MODELS_TIMEOUT_MS });
  now += 2;
  assert.deepEqual(await list(directory), { models: ['a/one', 'c/three'] });
  assert.equal(calls.length, 2);
});

test('concurrent requests share one run', async () => {
  const { exec, calls } = fakeExec([{ code: 0, stdout: 'a/one\n' }]);
  const list = createModelList(exec, () => 0);
  const [x, y] = await Promise.all([list(directory), list(directory)]);
  assert.deepEqual(x, { models: ['a/one'] });
  assert.deepEqual(y, { models: ['a/one'] });
  assert.equal(calls.length, 1);
});

test('each project has its own cache (a project config can add providers)', async () => {
  const { exec, calls } = fakeExec([
    { code: 0, stdout: 'a/one\n' },
    { code: 0, stdout: 'b/two\n' },
  ]);
  const list = createModelList(exec, () => 0);
  assert.deepEqual(await list('/p1'), { models: ['a/one'] });
  assert.deepEqual(await list('/p2'), { models: ['b/two'] });
  assert.deepEqual(await list('/p1'), { models: ['a/one'] });
  assert.equal(calls.length, 2);
});

test('a failed run answers no models with the error and is not cached', async () => {
  const { exec, calls } = fakeExec([
    { code: 127, stdout: '', stderr: 'opencode: command not found' },
    new Error('spawn exploded'),
    { code: 0, stdout: 'nothing useful\n' },
    { code: 0, stdout: 'a/one\n' },
  ]);
  const list = createModelList(exec, () => 0);
  const missing = await list(directory);
  assert.deepEqual(missing.models, []);
  assert.match(missing.error ?? '', /opencode: command not found/);
  const thrown = await list(directory);
  assert.deepEqual(thrown.models, []);
  assert.match(thrown.error ?? '', /spawn exploded/);
  const empty = await list(directory);
  assert.deepEqual(empty.models, []);
  assert.match(empty.error ?? '', /no models/i);
  assert.deepEqual(await list(directory), { models: ['a/one'] });
  assert.equal(calls.length, 4);
});

test('POST /models/list answers the models, and a failure as 200 with an error (never 500)', async () => {
  const ok = fakeExec([{ code: 0, stdout: 'a/one\nb/two\n' }]);
  const r = await handle('POST', '/models/list', { directory }, { exec: ok.exec });
  assert.deepEqual(r, { status: 200, json: { models: ['a/one', 'b/two'] } });

  const bad = fakeExec([{ code: 1, stdout: '', stderr: 'boom' }]);
  const f = await handle('POST', '/models/list', { directory }, { exec: bad.exec });
  assert.equal(f.status, 200);
  assert.deepEqual((f.json as { models: string[] }).models, []);
  assert.match((f.json as { error: string }).error, /boom/);
});

test('POST /models/list caches across requests of one service (same exec)', async () => {
  const { exec, calls } = fakeExec([{ code: 0, stdout: 'a/one\n' }]);
  await handle('POST', '/models/list', { directory }, { exec });
  await handle('POST', '/models/list', { directory }, { exec });
  assert.equal(calls.length, 1);
});
