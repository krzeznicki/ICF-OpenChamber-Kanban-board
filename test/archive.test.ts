import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskState } from '../src/core/types.ts';
import {
  ARCHIVE_MAX,
  archivableIds,
  archiveTasks,
  archivedShown,
  parseArchivedTasks,
  reconcileArchived,
  serializeArchived,
  unarchiveTask,
} from '../src/panel/archive.ts';
import { groupTasks } from '../src/panel/columns.ts';
import { createSettingsStore, STORAGE_KEYS } from '../src/panel/settings.ts';

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

test('parseArchivedTasks: { id, archivedAt }[] read defensively, last entry per id wins', () => {
  assert.deepEqual([...parseArchivedTasks(undefined)], []);
  assert.deepEqual([...parseArchivedTasks({ a: 1 })], []);
  const m = parseArchivedTasks([
    { id: 'a', archivedAt: 5 },
    { id: '', archivedAt: 5 },
    { id: 'b', archivedAt: 'x' },
    { id: 'c', archivedAt: -1 },
    null,
    'd',
    { id: 'a', archivedAt: 7 },
  ]);
  assert.deepEqual([...m], [['a', 7]]);
});

test('serializeArchived: oldest first, capped to the newest ARCHIVE_MAX', () => {
  assert.deepEqual(serializeArchived(new Map([['b', 2], ['a', 1]])), [
    { id: 'a', archivedAt: 1 },
    { id: 'b', archivedAt: 2 },
  ]);
  const many = new Map(Array.from({ length: ARCHIVE_MAX + 3 }, (_, i) => [`t${i}`, i + 1] as const));
  const out = serializeArchived(many);
  assert.equal(out.length, ARCHIVE_MAX);
  assert.equal(out[0]?.id, 't3');
});

test('archivableIds: done tasks not archived yet, sub-tasks included', () => {
  const tasks = [task('a', 'done'), task('b', 'ready-for-agent'), task('c', 'done', { parentId: 'a' }), task('d', 'done')];
  assert.deepEqual(archivableIds(tasks, new Map([['d', 1]])), ['a', 'c']);
});

test('archiveTasks marks ids with the time; unarchiveTask drops one; both copy', () => {
  const before = new Map([['x', 1]]);
  const after = archiveTasks(before, ['a', 'b'], 9);
  assert.deepEqual([...after], [['x', 1], ['a', 9], ['b', 9]]);
  assert.equal(before.size, 1);
  const back = unarchiveTask(after, 'a');
  assert.deepEqual([...back], [['x', 1], ['b', 9]]);
  assert.equal(after.size, 3);
});

test('reconcileArchived: prunes ids the tracker no longer lists and unarchives reopened tasks', () => {
  const marks = new Map([['done', 1], ['gone', 2], ['reopened', 3]]);
  const tasks = [task('done', 'done'), task('reopened', 'ready-for-agent')];
  const r = reconcileArchived(marks, tasks);
  assert.deepEqual([...r.marks], [['done', 1]]);
  assert.equal(r.changed, true);
  const same = reconcileArchived(r.marks, tasks);
  assert.equal(same.changed, false);
});

test('archivedShown: the archived marks for listed done tasks', () => {
  const tasks = [task('a', 'done'), task('b', 'needs-triage')];
  assert.equal(archivedShown(tasks, new Map([['a', 1], ['b', 1], ['z', 1]])), 1);
});

test('groupTasks hides archived tasks, or shows them marked; a parent still counts archived done children', () => {
  const tasks = [
    task('p', 'ready-for-agent', { kind: 'parent' }),
    task('c1', 'done', { parentId: 'p' }),
    task('c2', 'needs-triage', { parentId: 'p' }),
    task('d', 'done'),
  ];
  const archived = new Set(['c1', 'd']);
  const hidden = groupTasks(tasks, [], new Set(), false, [], new Set(), new Map(), new Map(), { ids: archived, show: false });
  assert.deepEqual(hidden.done, []);
  assert.deepEqual(hidden.ready.find((c) => c.task.id === 'p')?.progress, { done: 1, total: 2 });

  const shown = groupTasks(tasks, [], new Set(), false, [], new Set(), new Map(), new Map(), { ids: archived, show: true });
  assert.deepEqual(shown.done.map((c) => [c.task.id, c.archived]), [['c1', true], ['d', true]]);
  assert.equal(shown.ready[0]?.archived, false);

  // A task archived but no longer done (before reconcile ran) is not hidden.
  const reopened = groupTasks([task('d', 'ready-for-agent')], [], new Set(), false, [], new Set(), new Map(), new Map(), { ids: archived, show: false });
  assert.deepEqual(reopened.ready.map((c) => [c.task.id, c.archived]), [['d', false]]);
});

test('archived tasks: stored per project under archivedTasks:<projectId>, apart from archivedSessions', async () => {
  assert.equal(STORAGE_KEYS.archivedTasks('p1'), 'archivedTasks:p1');
  assert.notEqual(STORAGE_KEYS.archivedTasks('p1'), STORAGE_KEYS.archivedSessions('p1'));
  assert.ok(STORAGE_KEYS.archivedTasks('p'.repeat(300)).length <= 128);
  const data = new Map<string, unknown>();
  const store = createSettingsStore({
    get: async (k) => data.get(k),
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  });
  await store.saveArchivedTasks('p1', new Map([['a', 4]]));
  assert.deepEqual(data.get('archivedTasks:p1'), [{ id: 'a', archivedAt: 4 }]);
  assert.deepEqual([...(await store.loadArchivedTasks('p1'))], [['a', 4]]);
  await store.saveArchivedTasks('p1', new Map());
  assert.equal(data.has('archivedTasks:p1'), false);
});
