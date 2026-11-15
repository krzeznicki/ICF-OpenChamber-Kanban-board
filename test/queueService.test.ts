import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { GuestSessionEventRequest } from '@openchamber/sdk';
import type { QueueEntry } from '../src/core/queue.ts';
import type { Exec } from '../src/core/types.ts';
import { RESERVE_MS, takeFromQueue } from '../src/service/queue.ts';
import { handle, type Deps } from '../src/service/routes.ts';
import { addLink, linkStatuses, STALE_LINK_MS, unknownSession, type SessionHost } from '../src/service/sessions.ts';

type T = { after: (fn: () => Promise<void>) => void };
type Status = 'idle' | 'busy' | 'waiting';

const setup = async (t: T) => {
  const root = await mkdtemp(join(tmpdir(), 'icf-queue-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'repo');
  await mkdir(directory);
  const home = join(root, 'home', '.icf-kanban');
  const linksFile = join(home, 'links.json');
  const queueFile = join(home, 'queue.json');
  const exec: Exec = async () => ({ code: 0, stdout: '', stderr: '' });
  const status = new Map<string, Status>();
  const starts: Array<Parameters<SessionHost['start']>[0]> = [];
  const logs: string[] = [];
  const statusFails = { on: false };
  let n = 0;
  const sessions: SessionHost = {
    start: async (input) => {
      starts.push(input);
      n++;
      status.set(`ses_q${n}`, 'busy');
      return { sessionId: `ses_q${n}`, directory: input.directory ?? null };
    },
    status: async (id) => {
      if (statusFails.on) throw Object.assign(new Error('Session control is not approved'), { code: 'NOT_GRANTED', status: 403 });
      const s = status.get(id);
      if (s === undefined) throw Object.assign(new Error('No such session'), { code: 'NOT_FOUND', status: 404 });
      return s;
    },
  };
  const deps: Deps = { exec, sessions, linksFile, queueFile, suffix: () => 'abc123', log: (m) => logs.push(m) };
  /** A session already working on a task of `dir`. */
  const running = async (taskId: string, sessionId: string, s: Status = 'busy', dir = directory): Promise<void> => {
    status.set(sessionId, s);
    await addLink(linksFile, dir, { taskId, sessionId, directory: dir, createdAt: Date.now() });
  };
  return { root, directory, linksFile, queueFile, deps, status, statusFails, starts, logs, running };
};

const entry = (taskId: string, extra: Partial<QueueEntry> = {}): QueueEntry => ({
  taskId,
  title: `Task ${taskId}`,
  prompt: `Do ${taskId}`,
  model: null,
  agent: null,
  variant: null,
  location: 'project',
  queuedAt: 1,
  ...extra,
});

const post = async (deps: Deps, path: string, body: Record<string, unknown>) => {
  const r = await handle('POST', path, body, deps);
  assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.json)}`);
  return r.json as { queue: QueueEntry[]; taken: QueueEntry[] };
};

const ids = (list: QueueEntry[]): string[] => list.map((e) => e.taskId);

test('/queue/add keeps order and is idempotent per task; /queue/list reads it back', async (t) => {
  const { directory, deps } = await setup(t);
  await post(deps, '/queue/add', { directory, entry: entry('a'), maxParallel: 2 });
  await post(deps, '/queue/add', { directory, entry: entry('b') });
  const again = await post(deps, '/queue/add', { directory, entry: entry('a', { prompt: 'changed' }) });
  assert.deepEqual(ids(again.queue), ['a', 'b']);
  assert.equal(again.queue[0]!.prompt, 'Do a');
  assert.deepEqual(ids((await post(deps, '/queue/list', { directory })).queue), ['a', 'b']);
});

test('/queue/remove drops one task; the last one removes the project from the file', async (t) => {
  const { directory, queueFile, deps } = await setup(t);
  await post(deps, '/queue/add', { directory, entry: entry('a') });
  await post(deps, '/queue/add', { directory, entry: entry('b') });
  assert.deepEqual(ids((await post(deps, '/queue/remove', { directory, taskId: 'a' })).queue), ['b']);
  assert.deepEqual(ids((await post(deps, '/queue/remove', { directory, taskId: 'b' })).queue), []);
  assert.deepEqual(JSON.parse(await readFile(queueFile, 'utf8')).projects, {});
});

test('/queue/take respects the limit and the order, counting busy and waiting links', async (t) => {
  const { directory, deps, running } = await setup(t);
  await running('x', 'ses_x', 'busy');
  await running('y', 'ses_y', 'waiting');
  await running('z', 'ses_z', 'idle');
  for (const id of ['a', 'b', 'c']) await post(deps, '/queue/add', { directory, entry: entry(id) });
  const first = await post(deps, '/queue/take', { directory, maxParallel: 3 });
  assert.deepEqual(ids(first.taken), ['a']);
  assert.deepEqual(ids(first.queue), ['b', 'c']);
  // 'a' is reserved until its link shows up: nothing else fits.
  assert.deepEqual(ids((await post(deps, '/queue/take', { directory, maxParallel: 3 })).taken), []);
  // Raising the limit lets the next ones through, in order.
  const more = await post(deps, '/queue/take', { directory, maxParallel: 5 });
  assert.deepEqual(ids(more.taken), ['b', 'c']);
  assert.deepEqual(more.queue, []);
});

test('/queue/take counts the ids the panel is starting and frees a reservation once its link is added', async (t) => {
  const { directory, deps, status } = await setup(t);
  for (const id of ['a', 'b', 'c']) await post(deps, '/queue/add', { directory, entry: entry(id) });
  assert.deepEqual(ids((await post(deps, '/queue/take', { directory, maxParallel: 2, starting: ['p'] })).taken), ['a']);
  // The panel started 'a' (path A) and recorded it: it now counts as its busy session, not twice.
  status.set('ses_a', 'busy');
  await post(deps, '/links/add', { directory, taskId: 'a', sessionId: 'ses_a', sessionDirectory: directory });
  assert.deepEqual(ids((await post(deps, '/queue/take', { directory, maxParallel: 2 })).taken), ['b']);
  status.set('ses_a', 'idle');
  // 'b' is still reserved (no link yet): one slot left.
  assert.deepEqual(ids((await post(deps, '/queue/take', { directory, maxParallel: 2 })).taken), ['c']);
});

test('a reservation lapses after RESERVE_MS; an entry whose task already runs is dropped', async (t) => {
  const { directory, queueFile, deps, running } = await setup(t);
  for (const id of ['a', 'b']) await post(deps, '/queue/add', { directory, entry: entry(id) });
  const links = async () => [];
  assert.deepEqual(ids((await takeFromQueue(queueFile, directory, { maxParallel: 1, links, now: () => 1000 })).taken), ['a']);
  assert.deepEqual(ids((await takeFromQueue(queueFile, directory, { links, now: () => 1000 + RESERVE_MS - 1 })).taken), []);
  assert.deepEqual(ids((await takeFromQueue(queueFile, directory, { links, now: () => 1000 + RESERVE_MS })).taken), ['b']);

  await post(deps, '/queue/add', { directory, entry: entry('c') });
  await running('c', 'ses_c', 'busy');
  const r = await post(deps, '/queue/take', { directory, maxParallel: 5 });
  assert.deepEqual(r.taken, []);
  assert.deepEqual(r.queue, []);
});

test('queue routes reject bad input with 400', async (t) => {
  const { directory, deps } = await setup(t);
  const bad = [
    ['/queue/add', { entry: { ...entry('a'), location: 'moon' } }],
    ['/queue/add', { entry: { ...entry('a'), prompt: '' } }],
    ['/queue/add', { entry: entry('a'), maxParallel: 'three' }],
    ['/queue/add', { entry: { ...entry('a'), variant: 5 } }],
    ['/queue/remove', {}],
    ['/queue/take', { starting: 'a' }],
    ['/links/add', { taskId: 'a' }],
    ['/links/add', { taskId: 'a', sessionId: 's', sessionDirectory: 'relative' }],
  ] as const;
  for (const [path, body] of bad) assert.equal((await handle('POST', path, { directory, ...body }, deps)).status, 400, path);
});

test('an entry keeps its variant; one stored before 0.3 (no variant) is still read and starts with none', async (t) => {
  const { directory, queueFile, deps } = await setup(t);
  await post(deps, '/queue/add', { directory, entry: entry('a', { variant: 'high' }) });
  assert.equal((await post(deps, '/queue/list', { directory })).queue[0]!.variant, 'high');
  const old: Record<string, unknown> = { ...entry('b') };
  delete old.variant;
  await writeFile(queueFile, JSON.stringify({ version: 1, projects: { [directory]: { maxParallel: 3, entries: [old] } } }));
  const listed = (await post(deps, '/queue/list', { directory })).queue;
  assert.deepEqual(ids(listed), ['b']);
  assert.equal(listed[0]!.variant ?? null, null);
});

test('a corrupt queue.json is set aside and read as empty', async (t) => {
  const { directory, queueFile, deps } = await setup(t);
  await mkdir(dirname(queueFile), { recursive: true });
  await writeFile(queueFile, 'nope');
  assert.deepEqual((await post(deps, '/queue/list', { directory })).queue, []);
  const kept = (await readdir(dirname(queueFile))).filter((f) => f.startsWith('queue.json.corrupt-'));
  assert.equal(kept.length, 1);
  await post(deps, '/queue/add', { directory, entry: entry('a') });
  assert.deepEqual(ids((await post(deps, '/queue/list', { directory })).queue), ['a']);
});

test('/links/list carries each session’s live status; an unknown session is unknown', async (t) => {
  const { directory, deps, running, linksFile } = await setup(t);
  await running('a', 'ses_a', 'busy');
  await running('b', 'ses_b', 'waiting');
  await running('c', 'ses_c', 'idle');
  await addLink(linksFile, directory, { taskId: 'd', sessionId: 'ses_gone', directory, createdAt: Date.now() });
  const r = (await handle('POST', '/links/list', { directory }, deps)).json as { links: Array<{ taskId: string; status: string }> };
  assert.deepEqual(
    r.links.map((l) => [l.taskId, l.status]),
    [
      ['a', 'busy'],
      ['b', 'waiting'],
      ['c', 'idle'],
      ['d', 'unknown'],
    ],
  );
});

const event = (type: GuestSessionEventRequest['event']['type'], sessionId: string, dir: string | null, parentId: string | null = null) => ({
  v: 1,
  requestId: 'req_1',
  event: { id: 'evt_1', type, at: 1, session: { id: sessionId, parentId }, project: { directory: dir }, linked: [] },
});

const deliver = async (deps: Deps, body: unknown) => {
  const r = await handle('POST', '/session-events', body, deps);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { ok: true });
  await r.after?.();
};

test('a turn-finished event in the project drains its queue by path B; the link frees the slot', async (t) => {
  const { directory, deps, status, starts, running, linksFile } = await setup(t);
  await running('x', 'ses_x', 'busy');
  await post(deps, '/queue/add', { directory, entry: entry('a', { model: 'p/m', agent: 'build', variant: 'max' }), maxParallel: 1 });
  await post(deps, '/queue/add', { directory, entry: entry('b') });
  // Still busy: nothing starts.
  await deliver(deps, event('turn-finished', 'ses_x', directory));
  assert.equal(starts.length, 0);
  status.set('ses_x', 'idle');
  await deliver(deps, event('turn-finished', 'ses_x', directory));
  assert.deepEqual(starts, [{ prompt: 'Do a', directory, title: 'Task a', model: 'p/m', agent: 'build', variant: 'max' }]);
  assert.deepEqual(ids((await post(deps, '/queue/list', { directory })).queue), ['b']);
  const links = JSON.parse(await readFile(linksFile, 'utf8')).projects[directory] as Array<{ taskId: string }>;
  assert.deepEqual(links.map((l) => l.taskId), ['x', 'a']);
  // 'a' now runs (busy): the limit of 1 holds 'b' back.
  await deliver(deps, event('turn-failed', 'ses_x', directory));
  assert.equal(starts.length, 1);
});

test('an event from a linked worktree session drains its project; an unrelated directory does nothing', async (t) => {
  const { root, directory, deps, starts, running } = await setup(t);
  const worktree = join(root, 'repo-worktrees', 'task-x-abc123');
  await mkdir(worktree, { recursive: true });
  await running('x', 'ses_x', 'idle', directory);
  await post(deps, '/queue/add', { directory, entry: entry('a'), maxParallel: 1 });

  await deliver(deps, event('turn-finished', 'ses_other', join(root, 'elsewhere')));
  await deliver(deps, event('turn-finished', 'ses_other', null));
  await deliver(deps, event('turn-started', 'ses_x', directory));
  await deliver(deps, event('turn-finished', 'ses_sub', directory, 'ses_x'));
  assert.equal(starts.length, 0);

  await deliver(deps, event('turn-finished', 'ses_wt', worktree));
  assert.equal(starts.length, 1);
});

test('an event names a linked session even when its directory is unknown', async (t) => {
  const { directory, deps, starts, running } = await setup(t);
  await running('x', 'ses_x', 'idle');
  await post(deps, '/queue/add', { directory, entry: entry('a') });
  await deliver(deps, event('turn-finished', 'ses_x', null));
  assert.equal(starts.length, 1);
});

test('a failed queued start goes back to the front with lastError, unreserved, and is retried on the next drain only', async (t) => {
  const { directory, deps, starts, logs } = await setup(t);
  let fail = true;
  const flaky: Deps = {
    ...deps,
    sessions: { ...deps.sessions!, start: async (input) => (fail ? Promise.reject(new Error('quota')) : deps.sessions!.start(input)) },
  };
  await post(flaky, '/queue/add', { directory, entry: entry('a'), maxParallel: 1 });
  await post(flaky, '/queue/add', { directory, entry: entry('b') });
  await deliver(flaky, event('turn-finished', 'ses_x', directory));
  assert.equal(starts.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /could not start the queued task a: .*quota/);
  const back = (await post(deps, '/queue/list', { directory })).queue;
  assert.deepEqual(ids(back), ['a', 'b']);
  assert.match(back[0]!.lastError ?? '', /quota/);
  assert.equal(back[1]!.lastError, undefined);
  // Its reservation was released: the next drain (limit 1) takes it again, and it starts.
  fail = false;
  await deliver(flaky, event('turn-finished', 'ses_x', directory));
  assert.equal(starts.length, 1);
  assert.equal(starts[0]!.prompt, 'Do a');
  assert.deepEqual(ids((await post(deps, '/queue/list', { directory })).queue), ['b']);
});

test('after 3 failed starts an entry stays queued with lastError and is not taken again automatically', async (t) => {
  const { directory, deps, logs } = await setup(t);
  let tries = 0;
  const failing: Deps = { ...deps, sessions: { ...deps.sessions!, start: async () => (tries++, Promise.reject(new Error('quota'))) } };
  await post(failing, '/queue/add', { directory, entry: entry('a'), maxParallel: 1 });
  for (let i = 0; i < 5; i++) await deliver(failing, event('turn-finished', 'ses_x', directory));
  assert.equal(tries, 3);
  const q = (await post(deps, '/queue/list', { directory })).queue;
  assert.deepEqual(ids(q), ['a']);
  assert.equal(q[0]!.failures, 3);
  assert.match(q[0]!.lastError ?? '', /quota/);
  assert.match(q[0]!.lastError ?? '', /not retried automatically/);
  assert.equal(logs.length, 3);
  // A stuck entry does not hold up the ones behind it.
  await post(deps, '/queue/add', { directory, entry: entry('b') });
  const r = await post(deps, '/queue/take', { directory, maxParallel: 1 });
  assert.deepEqual(ids(r.taken), ['b']);
  assert.deepEqual(ids(r.queue), ['a']);
  // Taken out and queued again by the user: a fresh entry, tried again.
  await post(deps, '/queue/remove', { directory, taskId: 'a' });
  await post(deps, '/queue/add', { directory, entry: entry('a') });
  assert.equal((await post(deps, '/queue/list', { directory })).queue.find((e) => e.taskId === 'a')!.failures, undefined);
});

test('a queued start that succeeds but cannot save its link is not put back (no duplicate session)', async (t) => {
  const { root, directory, deps, starts, logs } = await setup(t);
  await post(deps, '/queue/add', { directory, entry: entry('a'), maxParallel: 1 });
  // Links can be read (none yet) but not written.
  const locked = join(root, 'locked');
  await mkdir(locked);
  await chmod(locked, 0o500);
  t.after(() => chmod(locked, 0o700).catch(() => {}));
  const broken: Deps = { ...deps, linksFile: join(locked, 'links.json') };
  await deliver(broken, event('turn-finished', 'ses_x', directory));
  assert.equal(starts.length, 1);
  assert.deepEqual(ids((await post(deps, '/queue/list', { directory })).queue), []);
  assert.ok(logs.some((l) => /ses_q1 started, but its link/.test(l)), logs.join('\n'));
  assert.ok(!logs.some((l) => /could not start the queued task/.test(l)), logs.join('\n'));
  await deliver(broken, event('turn-finished', 'ses_x', directory));
  assert.equal(starts.length, 1);
});

test('fail closed: when status lookups fail (not 404), take starts nothing; a 404 (deleted session) does not block', async (t) => {
  const { directory, deps, starts, statusFails, running, linksFile } = await setup(t);
  await running('x', 'ses_x', 'idle');
  await post(deps, '/queue/add', { directory, entry: entry('a'), maxParallel: 3 });
  statusFails.on = true;
  const r = await post(deps, '/queue/take', { directory, maxParallel: 3 });
  assert.deepEqual(r.taken, []);
  assert.deepEqual(ids(r.queue), ['a']);
  await deliver(deps, event('turn-finished', 'ses_x', directory));
  assert.equal(starts.length, 0);
  // /links/list shows a failed lookup as unknown.
  const listed = (await handle('POST', '/links/list', { directory }, deps)).json as { links: Array<{ status: string }> };
  assert.deepEqual(listed.links.map((l) => l.status), ['unknown']);
  statusFails.on = false;
  await addLink(linksFile, directory, { taskId: 'gone', sessionId: 'ses_deleted', directory, createdAt: Date.now() });
  assert.deepEqual(ids((await post(deps, '/queue/take', { directory, maxParallel: 3 })).taken), ['a']);
});

test('fail closed: without a status call at all, a project with links takes nothing', async (t) => {
  const { directory, deps, running } = await setup(t);
  await running('x', 'ses_x', 'idle');
  const { status: _s, ...noStatus } = deps.sessions!;
  const blind: Deps = { ...deps, sessions: noStatus };
  await post(blind, '/queue/add', { directory, entry: entry('a') });
  assert.deepEqual((await post(blind, '/queue/take', { directory, maxParallel: 3 })).taken, []);
});

test('/queue/take counts the task ids the panel snapshot shows as running', async (t) => {
  const { directory, deps } = await setup(t);
  for (const id of ['a', 'b', 'c']) await post(deps, '/queue/add', { directory, entry: entry(id) });
  const r = await post(deps, '/queue/take', { directory, maxParallel: 3, running: ['x', 'y'], starting: ['y'] });
  assert.deepEqual(ids(r.taken), ['a']);
  assert.equal((await handle('POST', '/queue/take', { directory, running: 'x' }, deps)).status, 400);
});

test('/session-events: a body that is not a session event is 400 and drains nothing', async (t) => {
  const { deps } = await setup(t);
  assert.equal((await handle('POST', '/session-events', { v: 99 }, deps)).status, 400);
  assert.equal((await handle('GET', '/session-events', undefined, deps)).status, 405);
});

test('unknownSession: 404, 410 or code NOT_FOUND mean a deleted session; other refusals do not', () => {
  assert.equal(unknownSession({ status: 404, code: 'X' }), true);
  assert.equal(unknownSession({ status: 410, code: 'GONE' }), true);
  assert.equal(unknownSession({ status: 400, code: 'NOT_FOUND' }), true);
  assert.equal(unknownSession({ status: 403, code: 'NOT_GRANTED' }), false);
  assert.equal(unknownSession(new Error('boom')), false);
  assert.equal(unknownSession(null), false);
});

test('a deleted linked session answered 410 / NOT_FOUND does not block the queue', async (t) => {
  for (const refusal of [{ status: 410, code: 'GONE' }, { status: 400, code: 'NOT_FOUND' }]) {
    const { directory, deps, linksFile } = await setup(t);
    const gone: Deps = {
      ...deps,
      sessions: { ...deps.sessions!, status: async () => Promise.reject(Object.assign(new Error('gone'), refusal)) },
    };
    await addLink(linksFile, directory, { taskId: 'old', sessionId: 'ses_deleted', directory, createdAt: Date.now() });
    await post(gone, '/queue/add', { directory, entry: entry('a') });
    assert.deepEqual(ids((await post(gone, '/queue/take', { directory, maxParallel: 3 })).taken), ['a'], JSON.stringify(refusal));
  }
});

test('a failed lookup blocks only for links younger than 24 h; an older link reads unknown', async (t) => {
  const { directory, deps, linksFile, statusFails } = await setup(t);
  statusFails.on = true;
  await addLink(linksFile, directory, { taskId: 'old', sessionId: 'ses_old', directory, createdAt: Date.now() - STALE_LINK_MS - 1000 });
  await post(deps, '/queue/add', { directory, entry: entry('a') });
  assert.deepEqual(ids((await post(deps, '/queue/take', { directory, maxParallel: 3 })).taken), ['a']);
  // A young link whose lookup fails still blocks.
  await addLink(linksFile, directory, { taskId: 'new', sessionId: 'ses_new', directory, createdAt: Date.now() });
  await post(deps, '/queue/add', { directory, entry: entry('b') });
  assert.deepEqual((await post(deps, '/queue/take', { directory, maxParallel: 3 })).taken, []);
  const at = Date.now();
  const statuses = await linkStatuses(
    [
      { taskId: 'old', sessionId: 'ses_old', directory, createdAt: at - STALE_LINK_MS },
      { taskId: 'new', sessionId: 'ses_new', directory, createdAt: at - STALE_LINK_MS + 1 },
    ],
    deps.sessions,
    at,
  );
  assert.equal(statuses.get('ses_old'), 'unknown');
  assert.equal(statuses.get('ses_new'), 'error');
});

test('take, then remove while the start is in flight, then the start fails: the entry stays removed', async (t) => {
  const { directory, deps, logs } = await setup(t);
  const rejects: Array<(e: Error) => void> = [];
  let started: () => void = () => {};
  const inStart = new Promise<void>((r) => (started = r));
  const slow: Deps = {
    ...deps,
    sessions: {
      ...deps.sessions!,
      start: () =>
        new Promise((_res, rej) => {
          rejects.push(rej);
          if (rejects.length === 2) started();
        }),
    },
  };
  await post(slow, '/queue/add', { directory, entry: entry('a') });
  await post(slow, '/queue/add', { directory, entry: entry('b') });
  const r = await handle('POST', '/session-events', event('turn-finished', 'ses_x', directory), slow);
  const draining = r.after!();
  await inStart;
  // 'b' was taken too (limit 3); only 'a' is removed by the user.
  assert.deepEqual(ids((await post(slow, '/queue/remove', { directory, taskId: 'a' })).queue), []);
  for (const rej of rejects) rej(new Error('quota'));
  await draining;
  assert.equal(logs.filter((l) => l.includes('queued task a')).length, 1);
  const left = (await post(deps, '/queue/list', { directory })).queue;
  assert.deepEqual(ids(left), ['b'], 'a stays removed; b (not removed) is requeued');
  // Queued again by the user: a later failure requeues it normally.
  await post(deps, '/queue/add', { directory, entry: entry('a') });
  assert.deepEqual(ids((await post(deps, '/queue/list', { directory })).queue), ['b', 'a']);
});
