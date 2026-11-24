import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { groupSteps, openChildren, planGroupMove, planMove, taskTypes } from '../src/panel/moves.ts';
import type { Column } from '../src/panel/columns.ts';

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
  claimed: false,
  source: over.id?.startsWith('#') ? 'github' : 'local',
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

test('planGroupMove: each card planned from its own column; those already there are skipped, each refusal said once', () => {
  const a = task({ id: 'a' });
  const b = task({ id: 'b', state: 'done' });
  const c = task({ id: 'c', state: 'done' });
  const d = task({ id: 'd', state: 'ready-for-agent' });
  const plan = planGroupMove(
    [
      { task: a, from: 'backlog' },
      { task: b, from: 'done' },
      { task: c, from: 'done' },
      { task: d, from: 'in_progress' },
    ],
    'in_progress',
    [a, b, c, d],
  );
  assert.deepEqual(plan.moves, [{ task: a, from: 'backlog', move: { kind: 'start' } }]);
  assert.deepEqual(plan.reasons, ['Reopen the task (move it to Backlog or Ready) before starting it']);
});

test('planGroupMove: a parent closed with the group asks about its open children', () => {
  const p = task({ id: 'P', kind: 'parent' });
  const kid = task({ id: 'k', parentId: 'P' });
  const plan = planGroupMove([{ task: p, from: 'ready' }], 'done', [p, kid]);
  assert.deepEqual(plan.moves, [{ task: p, from: 'ready', move: { kind: 'close', askChildren: true } }]);
  assert.deepEqual(plan.reasons, []);
});

test('groupSteps: Mod+Shift+←/→ on Marked cards moves each one column on from its own, grouped by column; the edge stays', () => {
  const columns = new Map<string, Column>([
    ['a', 'backlog'],
    ['b', 'ready'],
    ['c', 'backlog'],
    ['d', 'done'],
  ]);
  assert.deepEqual(groupSteps(['a', 'b', 'c', 'd', 'gone'], columns, 1), [
    { ids: ['a', 'c'], to: 'ready' },
    { ids: ['b'], to: 'in_progress' },
  ]);
  assert.deepEqual(groupSteps(['a', 'b'], columns, -1), [{ ids: ['b'], to: 'backlog' }]);
});
