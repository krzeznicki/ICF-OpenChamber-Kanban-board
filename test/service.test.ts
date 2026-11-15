import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { writeConfig } from '../src/core/config.ts';
import type { Exec, Task } from '../src/core/types.ts';
import { handle } from '../src/service/routes.ts';

type T = { after: (fn: () => Promise<void>) => void };
type Err = { error: { code: string; message: string } };

const noExec: Exec = async () => {
  throw new Error('exec must not be called');
};
const deps = { exec: noExec };

const tmp = async (t: T): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'icf-service-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};

const local = async (t: T): Promise<string> => {
  const root = await tmp(t);
  await writeConfig(root, 'local');
  return root;
};

test('GET /health answers 200 {}', async () => {
  assert.deepEqual(await handle('GET', '/health', undefined, deps), { status: 200, json: {} });
});

test('create, list, get, state, type round trip on a local project', async (t) => {
  const directory = await local(t);
  const spec = await handle('POST', '/tasks/create', { directory, input: { title: 'Feature', body: 'Spec.' } }, deps);
  assert.equal(spec.status, 200, JSON.stringify(spec.json));
  const parent = (spec.json as { task: Task }).task;
  assert.equal(parent.kind, 'parent');

  const created = await handle(
    'POST',
    '/tasks/create',
    { directory, input: { title: 'Ticket', parentId: parent.id, state: 'ready-for-agent' } },
    deps,
  );
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const ticket = (created.json as { task: Task }).task;
  assert.equal(ticket.state, 'ready-for-agent');

  const listed = await handle('POST', '/tasks/list', { directory }, deps);
  assert.equal(listed.status, 200);
  assert.deepEqual((listed.json as { tasks: Task[] }).tasks.map((x) => x.id).sort(), [parent.id, ticket.id].sort());

  const moved = await handle('POST', '/tasks/state', { directory, id: ticket.id, state: 'needs-info' }, deps);
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.equal((moved.json as { task: Task }).task.state, 'needs-info');

  const typed = await handle('POST', '/tasks/type', { directory, id: ticket.id, type: 'bug' }, deps);
  assert.equal(typed.status, 200, JSON.stringify(typed.json));

  const got = await handle('POST', '/tasks/get', { directory, id: ticket.id }, deps);
  assert.equal(got.status, 200);
  const task = (got.json as { task: Task }).task;
  assert.equal(task.state, 'needs-info');
  assert.equal(task.type, 'bug');
});

test('close with children closes the feature and its tickets', async (t) => {
  const directory = await local(t);
  const parent = (
    (await handle('POST', '/tasks/create', { directory, input: { title: 'Feature' } }, deps)).json as { task: Task }
  ).task;
  await handle('POST', '/tasks/create', { directory, input: { title: 'One', parentId: parent.id } }, deps);
  const closed = await handle('POST', '/tasks/close', { directory, id: parent.id, withChildren: true }, deps);
  assert.equal(closed.status, 200, JSON.stringify(closed.json));
  const tasks = (closed.json as { tasks: Task[] }).tasks;
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every((x) => x.state === 'done'));
});

test('relative or missing directory is 400 INVALID', async (t) => {
  for (const body of [{ directory: 'relative/dir' }, {}, { directory: 42 }, null, 'text']) {
    const r = await handle('POST', '/tasks/list', body, deps);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal((r.json as Err).error.code, 'INVALID');
  }
  const root = await tmp(t);
  const file = join(root, 'file.txt');
  await writeFile(file, 'x');
  for (const directory of [join(root, 'nope'), file]) {
    const r = await handle('POST', '/tasks/list', { directory }, deps);
    assert.equal(r.status, 400, directory);
    assert.equal((r.json as Err).error.code, 'INVALID');
  }
});

test('unconfigured project: tasks routes are 422 NOT_CONFIGURED, /config/read is 200 with the error', async (t) => {
  const directory = await tmp(t);
  const listed = await handle('POST', '/tasks/list', { directory }, deps);
  assert.equal(listed.status, 422);
  assert.equal((listed.json as Err).error.code, 'NOT_CONFIGURED');

  const read = await handle('POST', '/config/read', { directory }, deps);
  assert.equal(read.status, 200);
  assert.equal((read.json as Err).error.code, 'NOT_CONFIGURED');
});

test('/config/read reports UNSUPPORTED with 200', async (t) => {
  const directory = await tmp(t);
  await handle('POST', '/config/init', { directory, tracker: 'local' }, deps);
  await writeFile(join(directory, 'docs/agents/issue-tracker.md'), '# Issue tracker: Jira\n');
  const read = await handle('POST', '/config/read', { directory }, deps);
  assert.equal(read.status, 200);
  assert.equal((read.json as Err).error.code, 'UNSUPPORTED');
});

test('/config/init writes the config and /config/read returns it', async (t) => {
  const directory = await tmp(t);
  const init = await handle('POST', '/config/init', { directory, tracker: 'local' }, deps);
  assert.equal(init.status, 200, JSON.stringify(init.json));
  assert.equal((init.json as { config: { tracker: string } }).config.tracker, 'local');
  const read = await handle('POST', '/config/read', { directory }, deps);
  assert.equal(read.status, 200);
  const config = (read.json as { config: { tracker: string; labels: Record<string, string> } }).config;
  assert.equal(config.tracker, 'local');
  assert.equal(config.labels['ready-for-agent'], 'ready-for-agent');

  const other = await handle('POST', '/config/init', { directory, tracker: 'github' }, deps);
  assert.equal(other.status, 422);
  assert.equal((other.json as Err).error.code, 'INVALID');
});

test('bad parameters are 400 INVALID', async (t) => {
  const directory = await local(t);
  const cases: Array<[string, unknown]> = [
    ['/config/init', { directory, tracker: 'jira' }],
    ['/tasks/get', { directory }],
    ['/tasks/get', { directory, id: '' }],
    ['/tasks/create', { directory }],
    ['/tasks/create', { directory, input: { title: '  ' } }],
    ['/tasks/create', { directory, input: { title: 'x', state: 'doing' } }],
    ['/tasks/create', { directory, input: { title: 'x', blockedBy: 'a' } }],
    ['/tasks/state', { directory, id: 'x', state: 'in-progress' }],
    ['/tasks/type', { directory, id: 'x', type: '' }],
    ['/tasks/close', { directory, id: 'x', withChildren: 'yes' }],
  ];
  for (const [path, body] of cases) {
    const r = await handle('POST', path, body, deps);
    assert.equal(r.status, 400, `${path} ${JSON.stringify(body)}`);
    assert.equal((r.json as Err).error.code, 'INVALID');
  }
});

test('TrackerError is 422, anything else 500', async (t) => {
  const directory = await local(t);
  const missing = await handle('POST', '/tasks/get', { directory, id: '.scratch/nope/issues/01-x.md' }, deps);
  assert.equal(missing.status, 422);
  assert.equal((missing.json as Err).error.code, 'NOT_FOUND');

  const gh = await tmp(t);
  await writeConfig(gh, 'github');
  const boom: Exec = async () => {
    throw new Error('boom');
  };
  const failed = await handle('POST', '/tasks/list', { directory: gh }, { exec: boom });
  assert.equal(failed.status, 500);
  assert.equal((failed.json as Err).error.code, 'FAILED');
  assert.match((failed.json as Err).error.message, /boom/);
});

test('unknown route is 404, wrong method 405', async () => {
  assert.equal((await handle('GET', '/nope', undefined, deps)).status, 404);
  assert.equal((await handle('GET', '/tasks/list', undefined, deps)).status, 405);
  assert.equal((await handle('POST', '/health', {}, deps)).status, 405);
});

test('GET /cli answers an absolute path to the built CLI; deps can override it', async () => {
  const r = await handle('GET', '/cli', undefined, deps);
  assert.equal(r.status, 200);
  const path = (r.json as { path: string }).path;
  assert.ok(isAbsolute(path));
  assert.match(path, /build[\\/]cli[\\/]task-board\.mjs$/);
  const o = await handle('GET', '/cli', undefined, { exec: noExec, cliPath: '/opt/x/task-board.mjs' });
  assert.deepEqual(o.json, { path: '/opt/x/task-board.mjs' });
});
