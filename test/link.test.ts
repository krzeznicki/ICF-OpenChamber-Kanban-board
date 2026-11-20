import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { canLinkUnder, canLinkUnderNew, childCandidates, followingMove, linkChildren, linkChoices, linkConfirm, newChildCandidates, parentTargets, unlinkConfirm } from '../src/panel/link.ts';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  kind: 'ticket',
  title: id,
  body: '',
  state: 'needs-triage',
  type: null,
  parentId: null,
  blockedBy: [],
  url: null,
  updatedAt: 0,
  claimed: false,
  source: id.startsWith('#') ? 'github' : 'local',
  ...over,
});

const A = '.scratch/a/spec.md';
const B = '.scratch/b/spec.md';
const C = '.scratch/c/spec.md';

test('local: a ticket moves under another feature, not its own, not a ticket', () => {
  const fa = task(A, { kind: 'parent' });
  const fb = task(B, { kind: 'parent' });
  const t1 = task('.scratch/a/issues/01-x.md', { parentId: A });
  const t2 = task('.scratch/a/issues/02-y.md', { parentId: A });
  const tasks = [fa, fb, t1, t2];
  assert.equal(canLinkUnder('local', t1, fb, tasks), true);
  assert.equal(canLinkUnder('local', t1, fa, tasks), false);
  assert.equal(canLinkUnder('local', t1, t2, tasks), false);
  assert.deepEqual(parentTargets('local', t1, tasks).map((t) => t.id), [B]);
});

test('local: only a feature without tickets becomes a ticket', () => {
  const fa = task(A, { kind: 'parent' });
  const fb = task(B, { kind: 'parent' });
  const fc = task(C, { kind: 'parent' });
  const t1 = task('.scratch/a/issues/01-x.md', { parentId: A });
  const tasks = [fa, fb, fc, t1];
  assert.equal(canLinkUnder('local', fa, fb, tasks), false);
  assert.equal(canLinkUnder('local', fc, fb, tasks), true);
  assert.equal(canLinkUnder('local', fb, fb, tasks), false);
  assert.deepEqual(childCandidates('local', fb, tasks).map((t) => t.id), [C, t1.id]);
});

test('done tasks are never linked or link targets', () => {
  const fb = task(B, { kind: 'parent' });
  const done = task('.scratch/a/issues/01-x.md', { state: 'done' });
  assert.equal(canLinkUnder('local', done, fb, [fb, done]), false);
  assert.equal(canLinkUnder('local', task('.scratch/a/issues/02-y.md'), { ...fb, state: 'done' }, []), false);
});

test('github: any issue, but never under itself, its parent or its descendant', () => {
  const p = task('#1', { kind: 'parent' });
  const c = task('#2', { parentId: '#1' });
  const g = task('#3', { parentId: '#2' });
  const o = task('#4');
  const tasks = [p, c, g, o];
  assert.equal(canLinkUnder('github', o, c, tasks), true);
  assert.equal(canLinkUnder('github', c, p, tasks), false);
  assert.equal(canLinkUnder('github', p, g, tasks), false);
  assert.equal(canLinkUnder('github', p, o, tasks), true);
  assert.equal(canLinkUnder('github', g, p, tasks), true);
});

test('new task, local: only a new feature (no parent) takes existing tickets and features without tickets', () => {
  const fa = task(A, { kind: 'parent' });
  const fb = task(B, { kind: 'parent' });
  const t1 = task('.scratch/a/issues/01-x.md', { parentId: A });
  const done = task('.scratch/a/issues/02-y.md', { parentId: A, state: 'done' });
  const tasks = [fa, fb, t1, done];
  assert.equal(canLinkUnderNew('local', t1, null, tasks), true);
  assert.equal(canLinkUnderNew('local', fb, null, tasks), true);
  assert.equal(canLinkUnderNew('local', fa, null, tasks), false); // has tickets
  assert.equal(canLinkUnderNew('local', done, null, tasks), false);
  assert.equal(canLinkUnderNew('local', t1, B, tasks), false); // the new task is a ticket
  assert.deepEqual(newChildCandidates('local', null, tasks).map((t) => t.id), [B, t1.id]);
  assert.deepEqual(newChildCandidates('local', B, tasks), []);
});

test('new task, github: any open issue, but not the chosen parent or its ancestors', () => {
  const p = task('#1', { kind: 'parent' });
  const c = task('#2', { parentId: '#1' });
  const g = task('#3', { parentId: '#2' });
  const o = task('#4');
  const closed = task('#5', { state: 'done' });
  const tasks = [p, c, g, o, closed];
  assert.deepEqual(newChildCandidates('github', null, tasks).map((t) => t.id), ['#1', '#2', '#3', '#4']);
  // The new task goes under #2: #2 and #1 above it would make a cycle; #3 (a sibling) may move.
  assert.deepEqual(newChildCandidates('github', '#2', tasks).map((t) => t.id), ['#3', '#4']);
});

test('detail pickers: a local ticket picks another feature; a feature picks tasks to link under it', () => {
  const fa = task(A, { kind: 'parent', title: 'Feature A' });
  const fb = task(B, { kind: 'parent', title: 'Feature B' });
  const fc = task(C, { kind: 'parent', title: 'Feature C' });
  const t1 = task('.scratch/a/issues/01-x.md', { parentId: A, title: 'X' });
  const tasks = [fa, fb, fc, t1];
  assert.deepEqual(linkChoices('local', t1, tasks), {
    parents: [
      { id: B, label: 'Feature B', hint: B },
      { id: C, label: 'Feature C', hint: C },
    ],
    children: [],
  });
  // A feature with tickets cannot become a sub-task.
  assert.deepEqual(linkChoices('local', fa, tasks).parents, []);
  // An empty feature may become a ticket of another; it takes the empty feature C and A's ticket.
  assert.deepEqual(linkChoices('local', fb, tasks), {
    parents: [
      { id: A, label: 'Feature A', hint: A },
      { id: C, label: 'Feature C', hint: C },
    ],
    children: [
      { id: C, label: 'Feature C', hint: C },
      { id: t1.id, label: 'X', hint: t1.id },
    ],
  });
});

test('detail pickers: github never offers the task itself, its parent, or its own descendants as parents', () => {
  const p = task('#1', { kind: 'parent', title: 'P' });
  const c = task('#2', { parentId: '#1', title: 'C' });
  const g = task('#3', { parentId: '#2', title: 'G' });
  const d = task('#4', { state: 'done', title: 'D' });
  const o = task('#5', { title: 'O' });
  const { parents, children } = linkChoices('github', c, [p, c, g, d, o]);
  assert.deepEqual(parents.map((x) => x.id), ['#5']);
  // Its own parent under it would be a cycle; its child is linked already.
  assert.deepEqual(children.map((x) => x.id), ['#5']);
});

test('detail pickers: a done task offers nothing', () => {
  const fb = task(B, { kind: 'parent', state: 'done' });
  const t1 = task('.scratch/a/issues/01-x.md');
  assert.deepEqual(linkChoices('local', fb, [fb, t1]), { parents: [], children: [] });
});

test('the link confirm names both tasks; locally it warns about the new id and dropped blockers', () => {
  const fb = task(B, { kind: 'parent', title: 'Feature B' });
  const t1 = task('.scratch/a/issues/01-x.md', { title: 'Fix X' });
  const local = linkConfirm('local', t1, fb);
  assert.equal(local.title, 'Make “Fix X” a sub-task of “Feature B”?');
  assert.match(local.body, /\.scratch\/a\/issues\/01-x\.md/);
  assert.match(local.body, /\.scratch\/b\/spec\.md/);
  assert.match(local.body, /new id/);
  assert.match(local.body, /blockers/);
  const gh = linkConfirm('github', task('#2', { title: 'Fix X' }), task('#1', { title: 'Epic' }));
  assert.equal(gh.title, 'Make “Fix X” a sub-task of “Epic”?');
  assert.doesNotMatch(gh.body, /new id|blockers/);
  assert.match(gh.body, /#2/);
  assert.match(gh.body, /#1/);
});

test('followingMove (setParent): a task that came back with a new id is reported once; a kept id is not', async () => {
  const moved: string[][] = [];
  const setParent = followingMove(
    async (id: string, parentId: string) => task(id === 'old' ? 'new' : id, { parentId }),
    async (from, to) => void moved.push([from, to]),
    () => assert.fail('no error expected'),
  );
  assert.equal((await setParent('old', 'P')).id, 'new');
  assert.equal((await setParent('#4', '#5')).id, '#4');
  assert.deepEqual(moved, [['old', 'new']]);
});

test('followingMove (setParent): a failing follow-up is reported, the link still resolves; a failing link rejects without a follow-up', async () => {
  const errors: string[] = [];
  const ok = followingMove(
    async (id: string, _parentId: string) => task(`${id}-moved`),
    async () => {
      throw new Error('storage full');
    },
    (from, to, e) => void errors.push(`${from}->${to}: ${(e as Error).message}`),
  );
  assert.equal((await ok('a', 'P')).id, 'a-moved');
  assert.deepEqual(errors, ['a->a-moved: storage full']);
  let followed = false;
  const bad = followingMove(
    async (_id: string, _parentId: string): Promise<Task> => {
      throw new Error('INVALID');
    },
    async () => void (followed = true),
    () => {},
  );
  await assert.rejects(bad('a', 'P'), /INVALID/);
  assert.equal(followed, false);
});

test('followingMove follows any tracker call that may change the id, e.g. removeParent', async () => {
  const moved: string[][] = [];
  const removeParent = followingMove(
    async (id: string) => task(id === 'old' ? 'new' : id),
    async (from, to) => void moved.push([from, to]),
    () => assert.fail('no error expected'),
  );
  assert.equal((await removeParent('old')).id, 'new');
  assert.equal((await removeParent('#4')).id, '#4');
  assert.deepEqual(moved, [['old', 'new']]);
});

test('unlinkConfirm names both tasks; locally it says the task becomes a feature with a new id and loses its blockers', () => {
  const local = unlinkConfirm('local', task('.scratch/f/issues/02-fix-x.md', { title: 'Fix X' }), 'Epic');
  assert.equal(local.title, 'Remove “Fix X” from “Epic”?');
  assert.match(local.body, /own feature/);
  assert.match(local.body, /new id/);
  assert.match(local.body, /blockers/);
  const gh = unlinkConfirm('github', task('#2', { title: 'Fix X' }), 'Epic');
  assert.equal(gh.title, 'Remove “Fix X” from “Epic”?');
  assert.doesNotMatch(gh.body, /new id|blockers/);
  assert.match(gh.body, /#2/);
});

test('linkChildren links the picked tasks one after another and names the ones that failed', async () => {
  const calls: string[] = [];
  let running = 0;
  const link = async (id: string): Promise<string | null> => {
    assert.equal(running, 0, 'one link at a time');
    running++;
    calls.push(id);
    await Promise.resolve();
    running--;
    return id === 'b' ? 'refused' : id === 'c' ? 'gone' : null;
  };
  const picked = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
    { id: 'c', label: 'Gamma' },
  ];
  assert.equal(await linkChildren(picked, link), '2 tasks were not linked: “Beta” (refused); “Gamma” (gone)');
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.equal(await linkChildren([{ id: 'b', label: 'Beta' }], link), '1 task was not linked: “Beta” (refused)');
  assert.equal(await linkChildren(picked.slice(0, 1), link), null);
});
