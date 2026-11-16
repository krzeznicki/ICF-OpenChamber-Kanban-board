import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskState } from '../src/core/types.ts';
import { groupTasks, type BoardModel } from '../src/panel/columns.ts';
import { filterBoard, matchesQuery } from '../src/panel/search.ts';

const task = (id: string, extra: Partial<Task> = {}, state: TaskState = 'ready-for-agent'): Task => ({
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

const localIssue = (title: string, description: string): string =>
  `# 01: ${title}\n\n**Type:** enhancement\n**Status:** ready-for-agent\n\n${description}\n`;

test('matchesQuery: a blank query matches every task', () => {
  assert.equal(matchesQuery(task('a'), '', 'local'), true);
  assert.equal(matchesQuery(task('a'), '   ', 'local'), true);
});

test('matchesQuery: finds words in the title, ignoring case', () => {
  const t = task('a', { title: 'Login timeout on Safari' });
  assert.equal(matchesQuery(t, 'safari', 'github'), true);
  assert.equal(matchesQuery(t, 'LOGIN', 'github'), true);
  assert.equal(matchesQuery(t, 'firefox', 'github'), false);
});

test('matchesQuery: finds words in the description', () => {
  const t = task('a', { title: 'Wyszukiwarka', body: 'Wyszukiwanie po tytułach oraz treści zadań' });
  assert.equal(matchesQuery(t, 'treści', 'github'), true);
  assert.equal(matchesQuery(t, 'kolumny', 'github'), false);
});

test('matchesQuery: Polish letters and accents are folded both ways', () => {
  const t = task('a', { title: 'Żądanie zmiany', body: 'Łączenie zadań, café' });
  assert.equal(matchesQuery(t, 'zadanie', 'github'), true);
  assert.equal(matchesQuery(t, 'laczenie', 'github'), true);
  assert.equal(matchesQuery(t, 'cafe', 'github'), true);
  assert.equal(matchesQuery(task('b', { title: 'Zadanie' }), 'żądanie', 'github'), true);
});

test('matchesQuery: every word must appear, in the title or the description', () => {
  const t = task('a', { title: 'Login timeout', body: 'Only on Safari 17' });
  assert.equal(matchesQuery(t, 'login safari', 'github'), true);
  assert.equal(matchesQuery(t, '  safari   timeout ', 'github'), true);
  assert.equal(matchesQuery(t, 'login firefox', 'github'), false);
});

test('matchesQuery: a local file is searched without its field lines', () => {
  const t = task('a', { title: 'Search', body: localIssue('Search', 'Filter the board by words') });
  assert.equal(matchesQuery(t, 'filter', 'local'), true);
  assert.equal(matchesQuery(t, 'ready', 'local'), false);
  assert.equal(matchesQuery(t, 'enhancement', 'local'), false);
});

const board = (tasks: Task[], hideSubtasks = false) => groupTasks(tasks, [], new Set(), hideSubtasks);
const ids = (b: BoardModel) => Object.fromEntries(Object.entries(b).map(([c, cards]) => [c, cards.map((k) => `${k.child ? '  ' : ''}${k.task.id}`)]));

test('filterBoard: a blank query keeps the board as it is', () => {
  const tasks = [task('a'), task('b', {}, 'done')];
  const b = board(tasks);
  assert.deepEqual(filterBoard(b, tasks, ' ', 'github'), b);
});

test('filterBoard: only matching cards stay, in their columns and order', () => {
  const tasks = [
    task('a', { title: 'Search box' }),
    task('b', { title: 'Shortcuts' }),
    task('c', { title: 'Search results count' }, 'done'),
    task('d', { title: 'Polish search' }),
  ];
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'search', 'github')), {
    backlog: [],
    ready: ['a', 'd'],
    in_progress: [],
    review: [],
    done: ['c'],
  });
});

test('filterBoard: a matching sub-task brings its parent along, still indented under it', () => {
  const tasks = [
    task('p', { kind: 'parent', title: 'Epic' }),
    task('k1', { title: 'Search box', parentId: 'p' }),
    task('k2', { title: 'Shortcuts', parentId: 'p' }),
  ];
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'search', 'github')).ready, ['p', '  k1']);
});

test('filterBoard: a matching parent does not bring its sub-tasks', () => {
  const tasks = [task('p', { kind: 'parent', title: 'Search epic' }), task('k1', { title: 'Shortcuts', parentId: 'p' })];
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'search', 'github')).ready, ['p']);
});

test('filterBoard: with sub-tasks hidden, a parent shows when one of its sub-tasks matches', () => {
  const tasks = [
    task('p', { kind: 'parent', title: 'Epic' }),
    task('k1', { title: 'Search box', parentId: 'p' }),
    task('q', { title: 'Other' }),
  ];
  assert.deepEqual(ids(filterBoard(board(tasks, true), tasks, 'search', 'github')).ready, ['p']);
});

test('filterBoard: the parent keeps its full sub-task progress', () => {
  const tasks = [
    task('p', { kind: 'parent', title: 'Epic' }),
    task('k1', { title: 'Search box', parentId: 'p' }),
    task('k2', { title: 'Shortcuts', parentId: 'p' }, 'done'),
  ];
  const parent = filterBoard(board(tasks), tasks, 'search', 'github').ready.find((c) => c.task.id === 'p');
  assert.deepEqual(parent?.progress, { done: 1, total: 2 });
});
