import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalTracker } from '../src/core/localTracker.ts';
import { TrackerError } from '../src/core/types.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/scratch', import.meta.url));
const SPEC = '.scratch/example-feature/spec.md';
const T1 = '.scratch/example-feature/issues/01-ticket-title.md';
const T2 = '.scratch/example-feature/issues/02-second.md';

/** Temp repo with a copy of the fixtures plus a second ticket blocked by 01 and by a missing 07. */
const repo = async (t: { after: (fn: () => Promise<void>) => void }): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'icf-local-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(FIXTURES, join(root, '.scratch'), { recursive: true });
  await writeFile(
    join(root, T2),
    '# 02: Second\n\nDo it.\n\n**Blocked by:** 01, 07\n\n**Type:** bug\n\n**Status:** needs-info\n',
  );
  return root;
};

const rejectsWith = async (p: Promise<unknown>, code: string): Promise<void> => {
  await assert.rejects(p, (e: unknown) => e instanceof TrackerError && e.code === code);
};

test('list returns the parent and its tickets with parentId and blockedBy as ids', async (t) => {
  const root = await repo(t);
  const tasks = await createLocalTracker(root).list();
  assert.deepEqual(
    tasks.map((x) => x.id),
    [SPEC, T1, T2],
  );
  const [spec, t1, t2] = tasks;
  assert.equal(spec!.kind, 'parent');
  assert.equal(spec!.parentId, null);
  assert.equal(spec!.title, 'example-feature'); // the template spec has no "# " heading
  assert.equal(spec!.state, 'needs-triage');
  assert.equal(t1!.kind, 'ticket');
  assert.equal(t1!.parentId, SPEC);
  assert.equal(t1!.state, 'ready-for-agent');
  assert.equal(t1!.url, null);
  assert.equal(t2!.title, 'Second');
  assert.equal(t2!.type, 'bug');
  assert.equal(t2!.state, 'needs-info');
  assert.deepEqual(t2!.blockedBy, [T1]); // 07 has no file -> dropped
  assert.ok(t2!.updatedAt > 0);
  assert.equal(t2!.body, await readFile(join(root, T2), 'utf8'));
});

test('empty repo (no .scratch) lists []', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'icf-local-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await createLocalTracker(root).list(), []);
});

test('list hides done tasks older than 30 days, keeps recent ones', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  await tracker.setState(T1, 'done');
  await tracker.setState(T2, 'done');
  const old = new Date(Date.now() - 31 * 24 * 3600 * 1000);
  await utimes(join(root, T1), old, old);
  const ids = (await tracker.list()).map((x) => x.id);
  assert.deepEqual(ids, [SPEC, T2]);
  // still reachable by id
  assert.equal((await tracker.get(T1)).state, 'done');
});

test('a feature without spec.md gets a parent titled from the slug, written only when edited', async (t) => {
  const root = await repo(t);
  await mkdir(join(root, '.scratch/no-spec/issues'), { recursive: true });
  await writeFile(join(root, '.scratch/no-spec/issues/01-a.md'), '# 01: A\n\n**Status:** ready-for-human\n');
  const tracker = createLocalTracker(root);
  const tasks = await tracker.list();
  const parent = tasks.find((x) => x.id === '.scratch/no-spec/spec.md');
  assert.ok(parent);
  assert.equal(parent.title, 'no-spec');
  assert.equal(parent.body, '');
  assert.equal(parent.state, 'needs-triage');
  assert.equal(tasks.find((x) => x.id === '.scratch/no-spec/issues/01-a.md')!.parentId, '.scratch/no-spec/spec.md');
  assert.equal(existsSync(join(root, '.scratch/no-spec/spec.md')), false);

  const edited = await tracker.setState('.scratch/no-spec/spec.md', 'ready-for-agent');
  assert.equal(edited.state, 'ready-for-agent');
  assert.equal(edited.title, 'no-spec');
  assert.equal(
    await readFile(join(root, '.scratch/no-spec/spec.md'), 'utf8'),
    '# no-spec\n\n**Status:** ready-for-agent\n',
  );
});

test('create under a parent numbers after the highest existing file', async (t) => {
  const root = await repo(t);
  await writeFile(join(root, '.scratch/example-feature/issues/09-later.md'), '# 09: Later\n');
  const tracker = createLocalTracker(root);
  const created = await tracker.create({
    title: 'New thing',
    body: 'Build it.',
    type: 'enhancement',
    state: 'ready-for-agent',
    parentId: SPEC,
    blockedBy: [T2],
  });
  const id = '.scratch/example-feature/issues/10-new-thing.md';
  assert.equal(created.id, id);
  assert.equal(created.kind, 'ticket');
  assert.equal(created.parentId, SPEC);
  assert.equal(created.title, 'New thing');
  assert.equal(created.type, 'enhancement');
  assert.equal(created.state, 'ready-for-agent');
  assert.deepEqual(created.blockedBy, [T2]);
  const text = await readFile(join(root, id), 'utf8');
  assert.match(text, /^# 10: New thing\n/);
  assert.match(text, /\*\*Blocked by:\*\* 02\n/);
});

test('create without parent makes a feature directory with spec.md', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  const created = await tracker.create({ title: 'Dark mode', body: 'Make it dark.', type: 'enhancement' });
  assert.equal(created.id, '.scratch/dark-mode/spec.md');
  assert.equal(created.kind, 'parent');
  assert.equal(created.title, 'Dark mode');
  assert.equal(created.type, 'enhancement');
  assert.equal(created.state, 'needs-triage');
  assert.equal(
    await readFile(join(root, '.scratch/dark-mode/spec.md'), 'utf8'),
    '# Dark mode\n\n**Type:** enhancement\n\nMake it dark.\n',
  );
  // same title again does not overwrite
  const again = await tracker.create({ title: 'Dark mode', state: 'ready-for-human' });
  assert.equal(again.id, '.scratch/dark-mode-2/spec.md');
  assert.equal(again.state, 'ready-for-human');
  // a ticket in the new feature starts at 01
  const ticket = await tracker.create({ title: 'First', parentId: created.id });
  assert.equal(ticket.id, '.scratch/dark-mode/issues/01-first.md');
});

test('create with an unknown parent rejects NOT_FOUND, with a ticket as parent INVALID', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  await rejectsWith(tracker.create({ title: 'x', parentId: '.scratch/nope/spec.md' }), 'NOT_FOUND');
  await rejectsWith(tracker.create({ title: 'x', parentId: T1 }), 'INVALID');
});

test("setState('done') writes resolved; setState('ready-for-agent') reopens", async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  const done = await tracker.setState(T2, 'done');
  assert.equal(done.state, 'done');
  let text = await readFile(join(root, T2), 'utf8');
  assert.match(text, /\*\*Status:\*\* resolved\n/);
  const reopened = await tracker.setState(T2, 'ready-for-agent');
  assert.equal(reopened.state, 'ready-for-agent');
  text = await readFile(join(root, T2), 'utf8');
  assert.match(text, /\*\*Status:\*\* ready-for-agent\n/);
  assert.doesNotMatch(text, /resolved/);
});

test('setType writes the Type line', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  const task = await tracker.setType(T1, 'bug');
  assert.equal(task.type, 'bug');
  assert.match(await readFile(join(root, T1), 'utf8'), /\*\*Type:\*\* bug\n/);
});

test('close with children resolves the spec and every ticket and returns them', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  const closed = await tracker.close(SPEC, { withChildren: true });
  assert.deepEqual(closed.map((x) => x.id).sort(), [SPEC, T1, T2].sort());
  assert.ok(closed.every((x) => x.state === 'done'));
  for (const id of [SPEC, T1, T2]) {
    assert.match(await readFile(join(root, id), 'utf8'), /\*\*Status:\*\* resolved/);
  }
});

test('close without children closes only the task itself', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  const closed = await tracker.close(SPEC, { withChildren: false });
  assert.deepEqual(closed.map((x) => x.id), [SPEC]);
  assert.equal((await tracker.get(T1)).state, 'ready-for-agent');
});

test('ids escaping .scratch/ reject INVALID; missing ones NOT_FOUND', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  await rejectsWith(tracker.get('../x'), 'INVALID');
  await rejectsWith(tracker.get('.scratch/../package.json'), 'INVALID');
  await rejectsWith(tracker.get('/etc/passwd'), 'INVALID');
  await rejectsWith(tracker.setState('.scratch/example-feature/../../x.md', 'done'), 'INVALID');
  await rejectsWith(tracker.get('.scratch/example-feature/notes.md'), 'INVALID');
  await rejectsWith(tracker.get('.scratch/example-feature/issues/99-missing.md'), 'NOT_FOUND');
  await rejectsWith(tracker.get('.scratch/missing-feature/spec.md'), 'NOT_FOUND');
});
