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

const rejectsWith = async (p: Promise<unknown>, code: string, message?: RegExp): Promise<void> => {
  await assert.rejects(p, (e: unknown) => e instanceof TrackerError && e.code === code && (message === undefined || message.test(e.message)));
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

test('create rejects blockers that are not existing tickets of the same feature, writing nothing', async (t) => {
  const root = await repo(t);
  await mkdir(join(root, '.scratch/other-feature/issues'), { recursive: true });
  await writeFile(join(root, '.scratch/other-feature/issues/03-x.md'), '# 03: X\n');
  await writeFile(join(root, '.scratch/example-feature/issues/03-local.md'), '# 03: Local\n');
  const tracker = createLocalTracker(root);
  const before = (await tracker.list()).map((x) => x.id);
  await rejectsWith(
    tracker.create({ title: 'x', parentId: SPEC, blockedBy: ['.scratch/other-feature/issues/03-x.md'] }),
    'INVALID',
  );
  await rejectsWith(
    tracker.create({ title: 'x', parentId: SPEC, blockedBy: ['.scratch/example-feature/issues/05-missing.md'] }),
    'INVALID',
  );
  await rejectsWith(tracker.create({ title: 'x', parentId: SPEC, blockedBy: [SPEC] }), 'INVALID');
  await rejectsWith(tracker.create({ title: 'x', parentId: SPEC, blockedBy: ['#42'] }), 'INVALID');
  assert.deepEqual((await tracker.list()).map((x) => x.id), before);
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

test('claim writes Status: claimed; the task stays ready-for-agent and is claimed until setState', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  const before = await tracker.setState(T2, 'ready-for-agent');
  assert.equal(before.claimed, false);
  const claimed = await tracker.claim(T2);
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.state, 'ready-for-agent');
  const text = await readFile(join(root, T2), 'utf8');
  assert.match(text, /\*\*Status:\*\* claimed\n/);
  assert.doesNotMatch(text, /ready-for-agent/);
  // Claiming again is allowed: a claimed ticket is still ready-for-agent.
  assert.equal((await tracker.claim(T2)).claimed, true);
  assert.equal((await tracker.list()).find((x) => x.id === T2)?.claimed, true);
  const done = await tracker.setState(T2, 'done');
  assert.equal(done.claimed, false);
  assert.equal(done.state, 'done');
});

test('claim of a parent or a missing ticket fails', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  await rejectsWith(tracker.claim('.scratch/example-feature/issues/09-none.md'), 'NOT_FOUND');
  await rejectsWith(tracker.claim(SPEC), 'INVALID');
  await tracker.setState(T1, 'done');
  await rejectsWith(tracker.claim(T1), 'INVALID');
});

test('claim is only allowed for a ready-for-agent ticket', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  for (const state of ['needs-triage', 'needs-info', 'ready-for-human', 'wontfix', 'done'] as const) {
    await tracker.setState(T2, state);
    await assert.rejects(tracker.claim(T2), (e: unknown) => e instanceof TrackerError && e.code === 'INVALID' && /Only a ready-for-agent task can be claimed/.test(e.message), state);
    assert.equal((await tracker.get(T2)).claimed, false);
  }
});

/** Feature "other" with two tickets: 02 is blocked by 01. */
const other = async (root: string): Promise<{ spec: string; a: string; b: string }> => {
  const tracker = createLocalTracker(root);
  const spec = (await tracker.create({ title: 'Other' })).id;
  const a = (await tracker.create({ title: 'Alpha', parentId: spec })).id;
  const b = (await tracker.create({ title: 'Beta', parentId: spec, blockedBy: [a] })).id;
  return { spec, a, b };
};

test('setParent moves a ticket into another feature with its next number, renumbered and without blockers', async (t) => {
  const root = await repo(t);
  const o = await other(root);
  const tracker = createLocalTracker(root);
  const moved = await tracker.setParent(T2, o.spec);
  assert.equal(moved.id, '.scratch/other/issues/03-second.md');
  assert.equal(moved.parentId, o.spec);
  assert.equal(moved.title, 'Second');
  assert.equal(moved.state, 'needs-info');
  assert.equal(moved.type, 'bug');
  assert.deepEqual(moved.blockedBy, []); // 01 and 07 pointed at example-feature's tickets
  assert.equal(
    await readFile(join(root, moved.id), 'utf8'),
    '# 03: Second\n\nDo it.\n\n**Blocked by:** None (can start immediately)\n\n**Type:** bug\n\n**Status:** needs-info\n',
  );
  assert.equal(existsSync(join(root, T2)), false);
  assert.deepEqual((await tracker.list()).map((x) => x.id), [SPEC, T1, o.spec, o.a, o.b, moved.id]);
});

test('setParent: tickets left behind that were blocked by the moved one lose that blocker', async (t) => {
  const root = await repo(t);
  const o = await other(root);
  const tracker = createLocalTracker(root);
  await tracker.setParent(o.a, SPEC);
  const b = await tracker.get(o.b);
  assert.deepEqual(b.blockedBy, []);
  assert.match(b.body, /\*\*Blocked by:\*\* None \(can start immediately\)/);
  // A new ticket of "other" that reuses number 01 is not a silent blocker of 02.
  await createLocalTracker(root).create({ title: 'New one', parentId: o.spec });
  assert.deepEqual((await tracker.get(o.b)).blockedBy, []);
});

test('setParent makes a feature without tickets a ticket of another feature and removes its folder', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  const lone = await tracker.create({ title: 'Lone idea', body: 'Some text.', type: 'enhancement', state: 'ready-for-human' });
  const moved = await tracker.setParent(lone.id, SPEC);
  assert.equal(moved.id, '.scratch/example-feature/issues/03-lone-idea.md');
  assert.equal(moved.kind, 'ticket');
  assert.equal(moved.parentId, SPEC);
  assert.equal(moved.title, 'Lone idea');
  assert.equal(moved.type, 'enhancement');
  assert.equal(moved.state, 'ready-for-human');
  assert.match(moved.body, /^# 03: Lone idea\n/);
  assert.match(moved.body, /Some text\./);
  assert.equal(existsSync(join(root, '.scratch/lone-idea')), false);
});

test('setParent refuses a feature with tickets, a ticket or missing parent, itself and its current parent', async (t) => {
  const root = await repo(t);
  const o = await other(root);
  const tracker = createLocalTracker(root);
  await rejectsWith(tracker.setParent(o.spec, SPEC), 'INVALID'); // two levels only
  await rejectsWith(tracker.setParent(T2, o.a), 'INVALID'); // a parent must be a spec.md
  await rejectsWith(tracker.setParent(SPEC, SPEC), 'INVALID');
  await rejectsWith(tracker.setParent(T2, SPEC), 'INVALID'); // already its parent
  await rejectsWith(tracker.setParent(T2, '.scratch/missing/spec.md'), 'NOT_FOUND');
  await rejectsWith(tracker.setParent('.scratch/example-feature/issues/09-x.md', o.spec), 'NOT_FOUND');
  assert.deepEqual((await tracker.list()).map((x) => x.id), [SPEC, T1, T2, o.spec, o.a, o.b]);
});

test('setParent refuses a feature without tickets whose folder holds other files, before writing anything', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  const lone = await tracker.create({ title: 'Lone idea' });
  await mkdir(join(root, '.scratch/lone-idea/issues'), { recursive: true });
  await writeFile(join(root, '.scratch/lone-idea/notes.md'), 'n');
  await mkdir(join(root, '.scratch/lone-idea/assets'));
  await rejectsWith(tracker.setParent(lone.id, SPEC), 'INVALID', /assets\/.*notes\.md|notes\.md.*assets/);
  assert.deepEqual((await tracker.list()).map((x) => x.id), [SPEC, T1, T2, lone.id]);
  assert.equal(existsSync(join(root, '.scratch/example-feature/issues/03-lone-idea.md')), false);
});

test('edit title rewrites only the heading (keeping its NN: prefix); the id and file name stay', async (t) => {
  const root = await repo(t);
  const before = await readFile(join(root, T2), 'utf8');
  const task = await createLocalTracker(root).edit(T2, { title: '  Renamed  ' });
  assert.equal(task.id, T2);
  assert.equal(task.title, 'Renamed');
  assert.equal(await readFile(join(root, T2), 'utf8'), before.replace('# 02: Second', '# 02: Renamed'));
});

test('edit body replaces only the description: heading, field lines and ## Comments stay', async (t) => {
  const root = await repo(t);
  const T3 = '.scratch/example-feature/issues/03-third.md';
  await writeFile(
    join(root, T3),
    '# 03: Third\n\nOld lead.\n\n**Blocked by:** 02\n\n**Type:** chore\n\n**Status:** ready-for-agent\n\n- [ ] old criterion\n\n## Comments\n\nagent: on it\n',
  );
  const tracker = createLocalTracker(root);
  const task = await tracker.edit(T3, { body: 'New lead.\n\n- [ ] new criterion\n' });
  assert.equal(
    await readFile(join(root, T3), 'utf8'),
    '# 03: Third\n\nNew lead.\n\n**Blocked by:** 02\n\n**Type:** chore\n\n**Status:** ready-for-agent\n\n- [ ] new criterion\n\n## Comments\n\nagent: on it\n',
  );
  assert.equal(task.state, 'ready-for-agent');
  assert.equal(task.type, 'chore');
  assert.deepEqual(task.blockedBy, [T2]);
});

test('edit body that starts with a list or heading puts the field lines right under the title', async (t) => {
  const root = await repo(t);
  await createLocalTracker(root).edit(T2, { body: '## What\n\nStatus: not a field here' });
  assert.equal(
    await readFile(join(root, T2), 'utf8'),
    '# 02: Second\n\n**Blocked by:** 01, 07\n\n**Type:** bug\n\n**Status:** needs-info\n\n## What\n\nStatus: not a field here\n',
  );
  assert.equal((await createLocalTracker(root).get(T2)).state, 'needs-info');
});

test('edit a feature: its spec.md gets a heading (no number); a feature without spec.md gets one written', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  const spec = await tracker.edit(SPEC, { title: 'Example' });
  assert.equal(spec.id, SPEC);
  assert.equal(spec.title, 'Example');
  assert.match(await readFile(join(root, SPEC), 'utf8'), /^# Example\n\n## Problem Statement\n/);
  await mkdir(join(root, '.scratch/bare'));
  const bare = await tracker.edit('.scratch/bare/spec.md', { body: 'What it is.' });
  assert.equal(await readFile(join(root, '.scratch/bare/spec.md'), 'utf8'), '# bare\n\nWhat it is.\n');
  assert.equal(bare.title, 'bare');
});

test('edit with a blank title is INVALID and writes nothing; a missing task is NOT_FOUND', async (t) => {
  const root = await repo(t);
  const before = await readFile(join(root, T2), 'utf8');
  await rejectsWith(createLocalTracker(root).edit(T2, { title: '  ', body: 'x' }), 'INVALID');
  assert.equal(await readFile(join(root, T2), 'utf8'), before);
  await rejectsWith(createLocalTracker(root).edit('.scratch/example-feature/issues/09-none.md', { title: 'x' }), 'NOT_FOUND');
});

test('remove deletes a ticket file; tickets that listed it as a blocker lose it', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  assert.deepEqual(await tracker.remove(T1, { withChildren: false }), [T1]);
  assert.equal(existsSync(join(root, T1)), false);
  assert.match(await readFile(join(root, T2), 'utf8'), /\*\*Blocked by:\*\* 07\n/);
  assert.deepEqual((await tracker.list()).map((x) => x.id), [SPEC, T2]);
});

test('remove of a feature with tickets needs withChildren; then its whole folder goes', async (t) => {
  const root = await repo(t);
  const tracker = createLocalTracker(root);
  await rejectsWith(tracker.remove(SPEC, { withChildren: false }), 'INVALID', /2 sub-tasks/);
  assert.equal(existsSync(join(root, T1)), true);
  assert.deepEqual(await tracker.remove(SPEC, { withChildren: true }), [T1, T2, SPEC]);
  assert.equal(existsSync(join(root, '.scratch/example-feature')), false);
  assert.deepEqual(await tracker.list(), []);
});

test('remove refuses a feature whose folder holds other files, before deleting anything; a missing task is NOT_FOUND', async (t) => {
  const root = await repo(t);
  await writeFile(join(root, '.scratch/example-feature/map.md'), '# Map\n');
  const tracker = createLocalTracker(root);
  await rejectsWith(tracker.remove(SPEC, { withChildren: true }), 'INVALID', /map\.md/);
  assert.equal(existsSync(join(root, T1)), true);
  assert.equal(existsSync(join(root, SPEC)), true);
  await rejectsWith(tracker.remove('.scratch/example-feature/issues/09-none.md', { withChildren: false }), 'NOT_FOUND');
});
