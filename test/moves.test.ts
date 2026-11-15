import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { openChildren, planMove, taskTypes } from '../src/panel/moves.ts';

const task = (over: Partial<Task> = {}): Task => ({
  id: '.scratch/f/issues/01-a.md',
  kind: 'ticket',
  title: 'A',
  body: '',
  state: 'needs-triage',
  type: null,
  parentId: null,
  blockedBy: [],
  url: null,
  updatedAt: 0,
  ...over,
});

test('to backlog sets needs-triage', () => {
  assert.deepEqual(planMove(task({ state: 'ready-for-agent' }), 'ready', 'backlog', 0), {
    kind: 'setState',
    state: 'needs-triage',
  });
});

test('to ready sets ready-for-agent', () => {
  assert.deepEqual(planMove(task(), 'backlog', 'ready', 0), { kind: 'setState', state: 'ready-for-agent' });
});

test('to in progress starts', () => {
  assert.deepEqual(planMove(task({ state: 'ready-for-agent' }), 'ready', 'in_progress', 0), { kind: 'start' });
  assert.deepEqual(planMove(task(), 'backlog', 'in_progress', 0), { kind: 'start' });
});

test('to review is never a move', () => {
  assert.deepEqual(planMove(task(), 'backlog', 'review', 0), {
    kind: 'none',
    reason: "Review is set by the agent's session",
  });
  assert.deepEqual(planMove(task(), 'in_progress', 'review', 0), {
    kind: 'none',
    reason: "Review is set by the agent's session",
  });
});

test('to done closes; a parent with open children asks', () => {
  assert.deepEqual(planMove(task(), 'backlog', 'done', 0), { kind: 'close', askChildren: false });
  const parent = task({ id: '.scratch/f/spec.md', kind: 'parent' });
  assert.deepEqual(planMove(parent, 'backlog', 'done', 2), { kind: 'close', askChildren: true });
  assert.deepEqual(planMove(parent, 'ready', 'done', 0), { kind: 'close', askChildren: false });
});

test('from done reopens through the target state', () => {
  const done = task({ state: 'done' });
  assert.deepEqual(planMove(done, 'done', 'backlog', 0), { kind: 'setState', state: 'needs-triage' });
  assert.deepEqual(planMove(done, 'done', 'ready', 0), { kind: 'setState', state: 'ready-for-agent' });
  assert.equal(planMove(done, 'done', 'review', 0).kind, 'none');
  const toWork = planMove(done, 'done', 'in_progress', 0);
  assert.equal(toWork.kind, 'none');
});

test('same column is not a move', () => {
  for (const c of ['backlog', 'ready', 'in_progress', 'review', 'done'] as const) {
    assert.equal(planMove(task(), c, c, 0).kind, 'none', c);
  }
});

test('openChildren counts listed, not-done sub-tasks', () => {
  const p = task({ id: 'P', kind: 'parent' });
  const tasks = [
    p,
    task({ id: 'a', parentId: 'P' }),
    task({ id: 'b', parentId: 'P', state: 'done' }),
    task({ id: 'c', parentId: 'P', state: 'wontfix' }),
    task({ id: 'd', parentId: 'Q' }),
  ];
  assert.equal(openChildren(p, tasks), 2);
  assert.equal(openChildren(task({ id: 'a' }), tasks), 0);
});

test('taskTypes offers the base types plus every used one', () => {
  assert.deepEqual(taskTypes([]), ['enhancement', 'bug', 'chore', 'research']);
  assert.deepEqual(taskTypes([task({ type: 'spike' }), task({ type: 'bug' }), task({ type: 'docs' }), task({ type: 'spike' })]), [
    'enhancement',
    'bug',
    'chore',
    'research',
    'docs',
    'spike',
  ]);
});
