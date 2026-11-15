import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { canLinkUnder, canLinkUnderNew, childCandidates, linkConfirm, newChildCandidates, parentTargets } from '../src/panel/link.ts';

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
