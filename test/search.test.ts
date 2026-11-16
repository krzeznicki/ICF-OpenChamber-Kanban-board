import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskState } from '../src/core/types.ts';
import { groupTasks, type BoardModel } from '../src/panel/columns.ts';
import { filterBoard, matchesQuery, searchSuggestions } from '../src/panel/search.ts';

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

test('matchesQuery: type: keeps tasks whose type starts with the value', () => {
  const research = task('a', { title: 'Look into caching', type: 'research' });
  const bug = task('b', { title: 'Crash', type: 'bug' });
  const none = task('c', { title: 'No type' });
  assert.equal(matchesQuery(research, 'type:research', 'github'), true);
  assert.equal(matchesQuery(research, 'type=Res', 'github'), true);
  assert.equal(matchesQuery(bug, 'type:research', 'github'), false);
  assert.equal(matchesQuery(none, 'type:research', 'github'), false);
  assert.equal(matchesQuery(research, 'type:research caching', 'github'), true);
  assert.equal(matchesQuery(research, 'type:research crash', 'github'), false);
});

test('matchesQuery: state: matches the tracker state or one of its words', () => {
  const info = task('a', {}, 'needs-info');
  const ready = task('b', {}, 'ready-for-agent');
  assert.equal(matchesQuery(info, 'state:info', 'github'), true);
  assert.equal(matchesQuery(info, 'state:needs-info', 'github'), true);
  assert.equal(matchesQuery(ready, 'state:info', 'github'), false);
  assert.equal(matchesQuery(ready, 'state:agent', 'github'), true);
});

test('matchesQuery: the same key twice means either, different keys mean both', () => {
  const bug = task('a', { type: 'bug' }, 'needs-info');
  const research = task('b', { type: 'research' }, 'ready-for-agent');
  assert.equal(matchesQuery(bug, 'type:bug type:research', 'github'), true);
  assert.equal(matchesQuery(research, 'type:bug type:research', 'github'), true);
  assert.equal(matchesQuery(research, 'type:research state:info', 'github'), false);
});

test('matchesQuery: an unknown key is a plain word, an empty value no condition yet', () => {
  assert.equal(matchesQuery(task('a', { title: 'See foo:bar' }), 'foo:bar', 'github'), true);
  assert.equal(matchesQuery(task('a', { title: 'Plain' }), 'foo:bar', 'github'), false);
  assert.equal(matchesQuery(task('a', { type: 'bug' }), 'type:', 'github'), true);
});

test('filterBoard: column: keeps the cards drawn in that column (id or title words)', () => {
  const tasks = [task('a'), task('b', {}, 'needs-triage'), task('c', {}, 'done')];
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'column:backlog', 'github')).backlog, ['b']);
  const doneOnly = ids(filterBoard(board(tasks), tasks, 'column=Done', 'github'));
  assert.deepEqual([doneOnly.backlog, doneOnly.ready, doneOnly.done], [[], [], ['c']]);
  const running = task('r');
  const sessions = [{ id: 's', items: [{ id: 'r' }], activity: 'running', outcome: null, archivedAt: null, createdAt: 1, updatedAt: 1 }] as unknown as Parameters<typeof groupTasks>[1];
  const withRunning = groupTasks([...tasks, running], sessions, new Set(), false);
  assert.deepEqual(ids(filterBoard(withRunning, [...tasks, running], 'column:prog', 'github')).in_progress, ['r']);
});

test('filterBoard: status: matches the column or the tracker state', () => {
  const tasks = [task('a'), task('b', {}, 'needs-info'), task('c', {}, 'needs-triage')];
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'status:backlog', 'github')).backlog, ['b', 'c']);
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'status:info', 'github')).backlog, ['b']);
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'status:ready', 'github')).ready, ['a']);
});

const labels = (text: string, caret = text.length, types: string[] = ['bug', 'enhancement', 'research']) =>
  searchSuggestions(text, caret, types).map((s) => s.label);

test('searchSuggestions: a word that starts a key offers the key', () => {
  assert.deepEqual(labels('ty'), ['type:']);
  assert.deepEqual(labels('login st'), ['state:', 'status:']);
  assert.deepEqual(labels(''), []);
  assert.deepEqual(labels('login '), []);
  assert.deepEqual(labels('xyz'), []);
});

test('searchSuggestions: after key: the values that match what is typed', () => {
  assert.deepEqual(labels('type:'), ['type:bug', 'type:enhancement', 'type:research']);
  assert.deepEqual(labels('type=re'), ['type=research']);
  assert.deepEqual(labels('state:info'), ['state:needs-info']);
  assert.deepEqual(labels('column:prog'), ['column:in_progress']);
  assert.deepEqual(labels('status:ready'), ['status:ready', 'status:ready-for-agent', 'status:ready-for-human']);
  assert.deepEqual(labels('type:bug'), [], 'nothing more to complete');
});

test('searchSuggestions: picking one replaces the word under the caret and moves past it', () => {
  const [key] = searchSuggestions('login ty', 8, []);
  assert.deepEqual(key, { label: 'type:', text: 'login type:', caret: 11 });
  const [value] = searchSuggestions('type:re login', 7, ['research']);
  assert.deepEqual(value, { label: 'type:research', text: 'type:research login', caret: 14 });
  const [last] = searchSuggestions('login type:re', 13, ['research']);
  assert.deepEqual(last, { label: 'type:research', text: 'login type:research ', caret: 20 });
});
