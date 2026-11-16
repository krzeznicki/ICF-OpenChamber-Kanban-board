import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskState } from '../src/core/types.ts';
import { clearArchivePlan, runClearArchive } from '../src/panel/clearArchive.ts';

const task = (id: string, state: TaskState, extra: Partial<Task> = {}): Task => ({
  id,
  kind: 'ticket',
  title: id,
  body: '',
  state,
  type: null,
  parentId: null,
  blockedBy: [],
  url: null,
  updatedAt: 0,
  claimed: false,
  ...extra,
});

const marks = (...ids: string[]): Map<string, number> => new Map(ids.map((id) => [id, 1]));

const SPEC = '.scratch/f/spec.md';
const T1 = '.scratch/f/issues/01-a.md';
const T2 = '.scratch/f/issues/02-b.md';

test('clearArchivePlan local: archived tickets go one by one; unarchived and reopened tasks stay', () => {
  const tasks = [task('.scratch/g/issues/01-x.md', 'done'), task('.scratch/h/issues/01-y.md', 'done'), task('.scratch/k/issues/01-z.md', 'ready-for-agent')];
  const plan = clearArchivePlan('local', tasks, marks('.scratch/g/issues/01-x.md', '.scratch/k/issues/01-z.md'));
  assert.deepEqual(plan.deletes, [{ id: '.scratch/g/issues/01-x.md', withChildren: false }]);
  assert.deepEqual(plan.skipped, []);
});

test('clearArchivePlan local: a feature whose listed sub-tasks are all archived goes as one folder delete', () => {
  const tasks = [task(SPEC, 'done', { kind: 'parent' }), task(T1, 'done', { parentId: SPEC }), task(T2, 'done', { parentId: SPEC })];
  const plan = clearArchivePlan('local', tasks, marks(SPEC, T1, T2));
  assert.deepEqual(plan.deletes, [{ id: SPEC, withChildren: true }]);
  assert.deepEqual(plan.skipped, []);
});

test('clearArchivePlan local: a feature with a sub-task not archived is kept (its folder would take it); its archived sub-tasks still go', () => {
  const tasks = [task(SPEC, 'done', { kind: 'parent' }), task(T1, 'done', { parentId: SPEC }), task(T2, 'ready-for-agent', { parentId: SPEC })];
  const plan = clearArchivePlan('local', tasks, marks(SPEC, T1));
  assert.deepEqual(plan.deletes, [{ id: T1, withChildren: false }]);
  assert.deepEqual(plan.skipped, [SPEC]);
});

test('clearArchivePlan github: each archived issue alone, sub-issues before their parent; unarchived sub-issues stay', () => {
  const tasks = [
    task('#1', 'done', { kind: 'parent' }),
    task('#2', 'done', { parentId: '#1' }),
    task('#3', 'done', { parentId: '#1' }),
    task('#4', 'done'),
  ];
  const plan = clearArchivePlan('github', tasks, marks('#1', '#2', '#4'));
  assert.deepEqual(plan.deletes, [
    { id: '#2', withChildren: false },
    { id: '#4', withChildren: false },
    { id: '#1', withChildren: false },
  ]);
  assert.deepEqual(plan.skipped, []);
});

test('runClearArchive: deletes in plan order, a failure is recorded and the rest still go', async () => {
  const calls: string[] = [];
  const remove = async (id: string, withChildren: boolean): Promise<string[]> => {
    calls.push(`${id}:${withChildren}`);
    if (id === '#2') throw new Error('Only repository admins can delete GitHub issues');
    return id === SPEC ? [T1, SPEC] : [id];
  };
  const out = await runClearArchive(
    [
      { id: '#2', withChildren: false },
      { id: SPEC, withChildren: true },
      { id: '#4', withChildren: false },
    ],
    remove,
  );
  assert.deepEqual(calls, ['#2:false', `${SPEC}:true`, '#4:false']);
  assert.deepEqual(out.deleted, [T1, SPEC, '#4']);
  assert.deepEqual(out.failed, [{ id: '#2', error: 'Only repository admins can delete GitHub issues' }]);
});
