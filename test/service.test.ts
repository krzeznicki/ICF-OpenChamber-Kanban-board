import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

// --- Setup wizard: /config/detect and /config/init for GitHub ---

const gitExec = (stdout: string, code = 0): { exec: Exec; calls: string[][] } => {
  const calls: string[][] = [];
  const exec: Exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return { code, stdout, stderr: code === 0 ? '' : 'fatal: not a git repository' };
  };
  return { exec, calls };
};

test('/config/detect prefers origin, falls back to the first github.com remote, else null', async (t) => {
  const directory = await tmp(t);
  const cases: Array<[string, number, string | null]> = [
    [
      'upstream\thttps://github.com/up/r.git (fetch)\nupstream\thttps://github.com/up/r.git (push)\n' +
        'origin\tgit@github.com:me/r.git (fetch)\norigin\tgit@github.com:me/r.git (push)\n',
      0,
      'git@github.com:me/r.git',
    ],
    [
      'origin\thttps://gitlab.com/me/r.git (fetch)\nfork\tssh://git@github.com/me/fork.git (fetch)\n',
      0,
      'ssh://git@github.com/me/fork.git',
    ],
    ['origin\thttps://gitlab.com/me/r.git (fetch)\n', 0, null],
    ['', 0, null],
    ['', 128, null],
    ['origin\thttps://notgithub.com/me/r.git (fetch)\n', 0, null],
    ['origin\thttps://user:ghp_secret@github.com/o/r.git (fetch)\n', 0, 'https://github.com/o/r.git'],
    ['origin\thttps://ghp_token@github.com/o/r (fetch)\n', 0, 'https://github.com/o/r'],
  ];
  for (const [stdout, code, remote] of cases) {
    const { exec, calls } = gitExec(stdout, code);
    const r = await handle('POST', '/config/detect', { directory }, { exec });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json, { remote }, stdout);
    assert.deepEqual(calls, [['git', 'remote', '-v']]);
  }
});

test('/config/detect on a real repo with and without a remote', async (t) => {
  const { realExec } = await import('../src/core/exec.ts');
  const real = { exec: realExec };
  const plain = await tmp(t);
  assert.deepEqual((await handle('POST', '/config/detect', { directory: plain }, real)).json, { remote: null });

  const repo = await tmp(t);
  assert.equal((await realExec('git', ['init', '-q'], { cwd: repo })).code, 0);
  assert.deepEqual((await handle('POST', '/config/detect', { directory: repo }, real)).json, { remote: null });
  await realExec('git', ['remote', 'add', 'origin', 'https://github.com/o/r.git'], { cwd: repo });
  assert.deepEqual((await handle('POST', '/config/detect', { directory: repo }, real)).json, {
    remote: 'https://github.com/o/r.git',
  });
});

test('/project/root: the main checkout of a worktree, of the checkout itself, and null outside git', async (t) => {
  const { realExec } = await import('../src/core/exec.ts');
  const { realpath } = await import('node:fs/promises');
  const real = { exec: realExec };
  const root = await realpath(await tmp(t));
  const repo = join(root, 'repo');
  const worktree = join(root, 'elsewhere', 'wt');
  await mkdir(repo);
  const git = async (...args: string[]): Promise<void> => {
    const r = await realExec('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: repo });
    assert.equal(r.code, 0, r.stderr);
  };
  await git('init', '-q');
  await git('commit', '-q', '--allow-empty', '-m', 'init');
  await git('worktree', 'add', '-q', '-b', 'side', worktree);
  await mkdir(join(worktree, 'src'));

  assert.deepEqual((await handle('POST', '/project/root', { directory: worktree }, real)).json, { root: repo });
  assert.deepEqual((await handle('POST', '/project/root', { directory: join(worktree, 'src') }, real)).json, { root: repo });
  assert.deepEqual((await handle('POST', '/project/root', { directory: repo }, real)).json, { root: repo });
  const plain = await tmp(t);
  assert.deepEqual((await handle('POST', '/project/root', { directory: plain }, real)).json, { root: null });
});

test('/config/init github: a failed gh preflight is 422 and writes nothing', async (t) => {
  const { fakeGh } = await import('./fakeGh.ts');
  const cases: Array<[Parameters<typeof fakeGh>[1], string, RegExp]> = [
    [{ version: null }, 'GH_MISSING', /brew install gh/],
    [{ version: '2.50.0' }, 'GH_OLD', /brew upgrade gh/],
    [{ authed: false }, 'GH_AUTH', /gh auth login/],
  ];
  for (const [options, code, fix] of cases) {
    const directory = await tmp(t);
    const gh = fakeGh([], options);
    const r = await handle('POST', '/config/init', { directory, tracker: 'github' }, { exec: gh.exec });
    assert.equal(r.status, 422, code);
    assert.equal((r.json as Err).error.code, code);
    assert.match((r.json as Err).error.message, fix);
    const read = await handle('POST', '/config/read', { directory }, deps);
    assert.equal((read.json as Err).error.code, 'NOT_CONFIGURED', code);
    assert.ok(!gh.calls.some((c) => c[1] === 'label'), `${code}: no label calls`);
  }
});

test('/config/init github without a github.com remote is 422 INVALID and writes nothing', async (t) => {
  const { fakeGh } = await import('./fakeGh.ts');
  for (const remote of [null, 'https://gitlab.com/me/r.git']) {
    const directory = await tmp(t);
    const gh = fakeGh([], { remote });
    const r = await handle('POST', '/config/init', { directory, tracker: 'github' }, { exec: gh.exec });
    assert.equal(r.status, 422, String(remote));
    assert.equal((r.json as Err).error.code, 'INVALID');
    assert.equal((r.json as Err).error.message, 'This folder has no GitHub remote; add one or choose Local');
    const read = await handle('POST', '/config/read', { directory }, deps);
    assert.equal((read.json as Err).error.code, 'NOT_CONFIGURED');
    assert.ok(!gh.calls.some((c) => c[0] === 'gh' && c[1] === 'label'), 'no label calls');
  }
});

test('/config/init github writes the config and creates only the missing labels', async (t) => {
  const { fakeGh } = await import('./fakeGh.ts');
  const directory = await tmp(t);
  const gh = fakeGh([], { labels: ['bug', 'needs-info'] });
  const r = await handle('POST', '/config/init', { directory, tracker: 'github' }, { exec: gh.exec });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((r.json as { config: { tracker: string } }).config.tracker, 'github');
  const created = gh.calls.filter((c) => c[1] === 'label' && c[2] === 'create').map((c) => c[3]);
  assert.deepEqual(created.sort(), ['enhancement', 'needs-triage', 'ready-for-agent', 'ready-for-human', 'wontfix']);
  assert.equal(gh.calls.filter((c) => c[1] === '--version').length, 1, 'one preflight');
  assert.deepEqual(
    [...gh.labels].sort(),
    ['bug', 'enhancement', 'needs-info', 'needs-triage', 'ready-for-agent', 'ready-for-human', 'wontfix'],
  );
});

test('/config/init github uses the label strings from triage-labels.md', async (t) => {
  const { fakeGh } = await import('./fakeGh.ts');
  const { mkdir } = await import('node:fs/promises');
  const directory = await tmp(t);
  await mkdir(join(directory, 'docs/agents'), { recursive: true });
  await writeFile(join(directory, 'docs/agents/triage-labels.md'), '| Role | Label |\n|---|---|\n| ready-for-agent | agent-ready |\n');
  const gh = fakeGh([]);
  const r = await handle('POST', '/config/init', { directory, tracker: 'github' }, { exec: gh.exec });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(gh.labels.has('agent-ready'));
  assert.ok(!gh.labels.has('ready-for-agent'));
});

test('/config/init github on a project already set up for local is 422 INVALID without calling gh', async (t) => {
  const directory = await local(t);
  const r = await handle('POST', '/config/init', { directory, tracker: 'github' }, deps);
  assert.equal(r.status, 422);
  assert.equal((r.json as Err).error.code, 'INVALID');
  assert.match((r.json as Err).error.message, /local/);
});

test('POST /tasks/state changes exactly one line of a local issue file', async (t) => {
  const directory = await local(t);
  const id = '.scratch/feature/issues/01-thing.md';
  const before = [
    '# 01: Thing',
    '',
    '**What to build:** a thing, with *markdown* that must survive.',
    '',
    '**Blocked by:** None (can start immediately)',
    '',
    '**Status:** needs-triage',
    '',
    '- [ ] Criterion one',
    '- [ ] Criterion two',
    '',
  ].join('\n');
  await mkdir(join(directory, '.scratch', 'feature', 'issues'), { recursive: true });
  await writeFile(join(directory, ...id.split('/')), before);

  const moved = await handle('POST', '/tasks/state', { directory, id, state: 'ready-for-agent' }, deps);
  assert.equal(moved.status, 200, JSON.stringify(moved.json));

  const a = before.split('\n');
  const b = (await readFile(join(directory, ...id.split('/')), 'utf8')).split('\n');
  assert.equal(b.length, a.length);
  const changed = a.map((line, i) => i).filter((i) => a[i] !== b[i]);
  assert.deepEqual(changed, [6]);
  assert.equal(b[6], '**Status:** ready-for-agent');
});

test('POST /tasks/edit changes the title and description; bad parameters are 400', async (t) => {
  const directory = await local(t);
  const spec = (await handle('POST', '/tasks/create', { directory, input: { title: 'Feature' } }, deps)).json as { task: Task };
  const edited = await handle('POST', '/tasks/edit', { directory, id: spec.task.id, title: 'Renamed', body: 'Now with text.' }, deps);
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  const task = (edited.json as { task: Task }).task;
  assert.equal(task.id, spec.task.id);
  assert.equal(task.title, 'Renamed');
  assert.match(task.body, /Now with text\./);
  const none = await handle('POST', '/tasks/edit', { directory, id: spec.task.id }, deps);
  assert.equal(none.status, 400);
  const bad = await handle('POST', '/tasks/edit', { directory, id: spec.task.id, body: 3 }, deps);
  assert.equal(bad.status, 400);
  const blank = await handle('POST', '/tasks/edit', { directory, id: spec.task.id, title: ' ' }, deps);
  assert.equal(blank.status, 422);
  assert.equal((blank.json as Err).error.code, 'INVALID');
});

test('POST /tasks/delete deletes a feature with its tickets and drops their session links and queue entries', async (t) => {
  const directory = await local(t);
  const files = await tmp(t);
  const d = { exec: noExec, linksFile: join(files, 'links.json'), queueFile: join(files, 'queue.json') };
  const spec = ((await handle('POST', '/tasks/create', { directory, input: { title: 'Feature' } }, d)).json as { task: Task }).task;
  const ticket = ((await handle('POST', '/tasks/create', { directory, input: { title: 'Ticket', parentId: spec.id } }, d)).json as { task: Task }).task;
  const keep = ((await handle('POST', '/tasks/create', { directory, input: { title: 'Other' } }, d)).json as { task: Task }).task;
  for (const taskId of [ticket.id, keep.id]) {
    assert.equal((await handle('POST', '/links/add', { directory, taskId, sessionId: `ses_${taskId.length}` }, d)).status, 200);
    const entry = { taskId, title: 't', prompt: 'p', location: 'project' };
    assert.equal((await handle('POST', '/queue/add', { directory, entry }, d)).status, 200);
  }
  const alone = await handle('POST', '/tasks/delete', { directory, id: spec.id }, d);
  assert.equal(alone.status, 422);
  const r = await handle('POST', '/tasks/delete', { directory, id: spec.id, withChildren: true }, d);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual((r.json as { deleted: string[] }).deleted, [ticket.id, spec.id]);
  const links = (await handle('POST', '/links/list', { directory }, d)).json as { links: { taskId: string }[] };
  assert.deepEqual(links.links.map((l) => l.taskId), [keep.id]);
  const queue = (await handle('POST', '/queue/list', { directory }, d)).json as { queue: { taskId: string }[] };
  assert.deepEqual(queue.queue.map((e) => e.taskId), [keep.id]);
  assert.equal((await handle('POST', '/tasks/delete', { directory, id: keep.id, withChildren: 'yes' }, d)).status, 400);
});

test('POST /tasks/delete: a failing session-link cleanup is logged and the queue entry still goes', async (t) => {
  const directory = await local(t);
  const files = await tmp(t);
  // A folder where the links file should be: reading it fails.
  const linksFile = join(files, 'links.json');
  await mkdir(linksFile);
  const logged: string[] = [];
  const d = { exec: noExec, linksFile, queueFile: join(files, 'queue.json'), log: (m: string) => logged.push(m) };
  const task = ((await handle('POST', '/tasks/create', { directory, input: { title: 'Feature' } }, d)).json as { task: Task }).task;
  const entry = { taskId: task.id, title: 't', prompt: 'p', location: 'project' };
  assert.equal((await handle('POST', '/queue/add', { directory, entry }, d)).status, 200);
  const r = await handle('POST', '/tasks/delete', { directory, id: task.id }, d);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const queue = (await handle('POST', '/queue/list', { directory }, d)).json as { queue: { taskId: string }[] };
  assert.deepEqual(queue.queue, []);
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /session links/);
});
