import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { canLinkUnder, childCandidates, linkChoices, linkConfirm, parentTargets } from '../src/panel/link.ts';

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
