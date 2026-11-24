import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeMove } from '../src/panel/actionResult.ts';
import type { Task } from '../src/core/types.ts';

const task: Task = { id: 'a', title: 'A', kind: 'ticket', body: '', state: 'ready-for-agent', type: null, parentId: null, blockedBy: [], claimed: false, source: 'local', url: null, updatedAt: 0 };
test('move outcomes distinguish saved, refused, cancelled and failed operations', async () => {
  let state = task.state;
  const deps = {
    before: async () => true, after: async () => {}, chooseChildren: async () => null as boolean | null,
    setState: async (_id: string, s: Task['state']) => { state = s; },
    close: async () => {}, start: async () => ({ kind: 'success' as const, id: task.id }),
  };
  assert.equal((await executeMove(task, 'ready', 'backlog', 0, deps)).kind, 'success');
  assert.equal(state, 'needs-triage');
  assert.equal((await executeMove(task, 'ready', 'review', 0, deps)).kind, 'failed');
  assert.equal((await executeMove(task, 'ready', 'done', 2, deps)).kind, 'cancelled');
  assert.equal((await executeMove(task, 'ready', 'backlog', 0, { ...deps, setState: async () => { throw new Error('write failed'); } })).kind, 'failed');
});
