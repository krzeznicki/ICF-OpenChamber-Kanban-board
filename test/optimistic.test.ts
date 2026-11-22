// Moves show at once (optimistic.ts): the moved card's new state is drawn before the write and the
// reload from the source finish; a reload that lands meanwhile does not snap it back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { closingStates, createPending } from '../src/panel/optimistic.ts';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, kind: 'ticket', title: id, body: '', state: 'needs-triage', type: null, parentId: null, blockedBy: [],
  url: null, updatedAt: 0, claimed: false, source: 'github', ...over,
});

test('a pending state is drawn over the listed one until it is settled', () => {
  const pending = createPending();
  const listed = [task('#1'), task('#2')];
  const key = pending.add(new Map([['#1', 'ready-for-agent']]));
  assert.deepEqual(pending.apply(listed).map((t) => t.state), ['ready-for-agent', 'needs-triage']);
  // A reload that lands before the write: still the new state.
  assert.equal(pending.apply([task('#1')])[0]!.state, 'ready-for-agent');
  pending.settle(key);
  assert.equal(pending.apply(listed)[0]!.state, 'needs-triage');
});

test('apply leaves the list untouched (same objects) with nothing pending', () => {
  const pending = createPending();
  const listed = [task('#1')];
  assert.equal(pending.apply(listed)[0], listed[0]);
});

test('a later move of the same card wins; settling the earlier one keeps the later', () => {
  const pending = createPending();
  const first = pending.add(new Map([['#1', 'ready-for-agent']]));
  pending.add(new Map([['#1', 'done']]));
  pending.settle(first);
  assert.equal(pending.apply([task('#1')])[0]!.state, 'done');
});

test('closingStates: the task goes done; its open sub-tasks too only when closed with it', () => {
  const parent = task('#1', { kind: 'parent' });
  const tasks = [parent, task('#2', { parentId: '#1' }), task('#3', { parentId: '#1', state: 'done' }), task('#4')];
  assert.deepEqual([...closingStates(parent, tasks, false)], [['#1', 'done']]);
  assert.deepEqual([...closingStates(parent, tasks, true)], [['#1', 'done'], ['#2', 'done']]);
});
