import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskState } from '../src/core/types.ts';
import { groupTasks } from '../src/panel/columns.ts';
import { applyOrder, forgetInOrder, ORDER_MAX, parseOrder, pruneOrder, renameInOrder, reorder } from '../src/panel/order.ts';

const t = (id: string, state: TaskState = 'needs-triage', parentId: string | null = null): Task => ({
  id,
  kind: 'ticket',
  title: id,
  body: '',
  state,
  type: null,
  parentId,
  blockedBy: [],
  url: null,
  updatedAt: 0,
  claimed: false,
});

const backlog = (tasks: Task[]): string[] => groupTasks(tasks, [], new Set(), false).backlog.map((c) => c.task.id);

test('applyOrder: stored positions come first in their order; unordered tasks follow in the tracker order', () => {
  const tasks = [t('a'), t('b'), t('c'), t('d')];
  assert.deepEqual(backlog(applyOrder(tasks, [])), ['a', 'b', 'c', 'd']);
  assert.deepEqual(backlog(applyOrder(tasks, ['c', 'a'])), ['c', 'a', 'b', 'd']);
  // Ids the tracker no longer lists are ignored.
  assert.deepEqual(backlog(applyOrder(tasks, ['gone', 'd'])), ['d', 'a', 'b', 'c']);
});

test('applyOrder: sub-tasks still follow their parent, in their stored order', () => {
  const tasks = [t('p'), t('k1', 'needs-triage', 'p'), t('k2', 'needs-triage', 'p'), t('q')];
  assert.deepEqual(backlog(applyOrder(tasks, ['q', 'k2', 'p', 'k1'])), ['q', 'p', 'k2', 'k1']);
});

test('reorder: the dragged card lands before the given card, or last; the column becomes fully ordered', () => {
  const tasks = [t('a'), t('b'), t('c'), t('r', 'ready-for-agent')];
  const column = ['a', 'b', 'c'];
  assert.deepEqual(backlog(applyOrder(tasks, reorder([], column, 'c', 'a'))), ['c', 'a', 'b']);
  assert.deepEqual(backlog(applyOrder(tasks, reorder([], column, 'a', null))), ['b', 'c', 'a']);
  assert.deepEqual(backlog(applyOrder(tasks, reorder([], column, 'a', 'c'))), ['b', 'a', 'c']);
  // Before itself, or before the card right after it: nothing moves.
  assert.deepEqual(reorder(['a', 'b', 'c'], column, 'b', 'c'), ['a', 'b', 'c']);
  assert.deepEqual(reorder(['a', 'b', 'c'], column, 'b', 'b'), ['a', 'b', 'c']);
});

test('reorder: tasks of other columns keep their places in the stored order', () => {
  const order = ['x', 'a', 'y', 'b', 'z'];
  const next = reorder(order, ['a', 'b', 'c'], 'b', 'a');
  assert.deepEqual(next.filter((id) => ['x', 'y', 'z'].includes(id)), ['x', 'y', 'z']);
  assert.deepEqual(next.filter((id) => ['a', 'b', 'c'].includes(id)), ['b', 'a', 'c']);
  // The column block takes the place of its first stored task.
  assert.deepEqual(next, ['x', 'b', 'a', 'c', 'y', 'z']);
});

test('renameInOrder: a task that got a new id (a local link moved it) keeps its place', () => {
  assert.deepEqual(renameInOrder(['a', 'b', 'c'], 'b', 'f/02-b'), ['a', 'f/02-b', 'c']);
  assert.deepEqual(renameInOrder(['a', 'b'], 'gone', 'x'), ['a', 'b']);
  // A stale entry under the new id goes; the moved task's place wins.
  assert.deepEqual(renameInOrder(['x', 'a', 'b'], 'b', 'x'), ['a', 'x']);
});

test('parseOrder: stored ids read defensively, without duplicates, at most ORDER_MAX kept', () => {
  assert.deepEqual(parseOrder(['a', 7, '', 'b', 'a', null]), ['a', 'b']);
  assert.deepEqual(parseOrder({ a: 1 }), []);
  assert.deepEqual(parseOrder(undefined), []);
  const many = Array.from({ length: ORDER_MAX + 5 }, (_, i) => `t${i}`);
  assert.equal(parseOrder(many).length, ORDER_MAX);
  assert.equal(parseOrder(many)[0], 't0');
});

test('pruneOrder: ids of tasks the tracker no longer lists are dropped', () => {
  assert.deepEqual(pruneOrder(['a', 'gone', 'b'], [t('b'), t('a')]), ['a', 'b']);
});

test('forgetInOrder: deleted tasks lose their places; the others keep their order', () => {
  assert.deepEqual(forgetInOrder(['a', 'b', 'c', 'd'], ['c', 'a', 'x']), ['b', 'd']);
  assert.deepEqual(forgetInOrder(['a'], []), ['a']);
});
