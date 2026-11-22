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
  source: id.startsWith('#') ? 'github' : 'local',
  ...extra,
});

const localIssue = (title: string, description: string): string =>
  `# 01: ${title}\n\n**Type:** enhancement\n**Status:** ready-for-agent\n\n${description}\n`;

test('matchesQuery: a blank query matches every task', () => {
  assert.equal(matchesQuery(task('a'), ''), true);
  assert.equal(matchesQuery(task('a'), '   '), true);
});

test('matchesQuery: finds words in the title, ignoring case', () => {
  const t = task('a', { title: 'Login timeout on Safari' });
  assert.equal(matchesQuery(t, 'safari'), true);
  assert.equal(matchesQuery(t, 'LOGIN'), true);
  assert.equal(matchesQuery(t, 'firefox'), false);
});

test('matchesQuery: finds words in the description', () => {
  const t = task('a', { title: 'Wyszukiwarka', body: 'Wyszukiwanie po tytułach oraz treści zadań' });
  assert.equal(matchesQuery(t, 'treści'), true);
  assert.equal(matchesQuery(t, 'kolumny'), false);
});

test('matchesQuery: Polish letters and accents are folded both ways', () => {
  const t = task('a', { title: 'Żądanie zmiany', body: 'Łączenie zadań, café' });
  assert.equal(matchesQuery(t, 'zadanie'), true);
  assert.equal(matchesQuery(t, 'laczenie'), true);
  assert.equal(matchesQuery(t, 'cafe'), true);
  assert.equal(matchesQuery(task('b', { title: 'Zadanie' }), 'żądanie'), true);
});

test('matchesQuery: every word must appear, in the title or the description', () => {
  const t = task('a', { title: 'Login timeout', body: 'Only on Safari 17' });
  assert.equal(matchesQuery(t, 'login safari'), true);
  assert.equal(matchesQuery(t, '  safari   timeout '), true);
  assert.equal(matchesQuery(t, 'login firefox'), false);
});

test('matchesQuery: a local file is searched without its field lines', () => {
  const t = task('a', { title: 'Search', body: localIssue('Search', 'Filter the board by words') });
  assert.equal(matchesQuery(t, 'filter'), true);
  assert.equal(matchesQuery(t, 'ready'), false);
  assert.equal(matchesQuery(t, 'enhancement'), false);
});

const board = (tasks: Task[], hideSubtasks = false) => groupTasks(tasks, [], new Set(), hideSubtasks);
const ids = (b: BoardModel) => Object.fromEntries(Object.entries(b).map(([c, cards]) => [c, cards.map((k) => `${k.child ? '  ' : ''}${k.task.id}`)]));

test('filterBoard: a blank query keeps the board as it is', () => {
  const tasks = [task('a'), task('b', {}, 'done')];
  const b = board(tasks);
  assert.deepEqual(filterBoard(b, tasks, ' '), b);
});

test('filterBoard: only matching cards stay, in their columns and order', () => {
  const tasks = [
    task('a', { title: 'Search box' }),
    task('b', { title: 'Shortcuts' }),
    task('c', { title: 'Search results count' }, 'done'),
    task('d', { title: 'Polish search' }),
  ];
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'search')), {
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
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'search')).ready, ['p', '  k1']);
});

test('filterBoard: a matching parent does not bring its sub-tasks', () => {
  const tasks = [task('p', { kind: 'parent', title: 'Search epic' }), task('k1', { title: 'Shortcuts', parentId: 'p' })];
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'search')).ready, ['p']);
});

test('filterBoard: with sub-tasks hidden, a parent shows when one of its sub-tasks matches', () => {
  const tasks = [
    task('p', { kind: 'parent', title: 'Epic' }),
    task('k1', { title: 'Search box', parentId: 'p' }),
    task('q', { title: 'Other' }),
  ];
  assert.deepEqual(ids(filterBoard(board(tasks, true), tasks, 'search')).ready, ['p']);
});

test('filterBoard: the parent keeps its full sub-task progress', () => {
  const tasks = [
    task('p', { kind: 'parent', title: 'Epic' }),
    task('k1', { title: 'Search box', parentId: 'p' }),
    task('k2', { title: 'Shortcuts', parentId: 'p' }, 'done'),
  ];
  const parent = filterBoard(board(tasks), tasks, 'search').ready.find((c) => c.task.id === 'p');
  assert.deepEqual(parent?.progress, { done: 1, total: 2 });
});

test('matchesQuery: type: keeps tasks whose type starts with the value', () => {
  const research = task('a', { title: 'Look into caching', type: 'research' });
  const bug = task('b', { title: 'Crash', type: 'bug' });
  const none = task('c', { title: 'No type' });
  assert.equal(matchesQuery(research, 'type:research'), true);
  assert.equal(matchesQuery(research, 'type=Res'), true);
  assert.equal(matchesQuery(bug, 'type:research'), false);
  assert.equal(matchesQuery(none, 'type:research'), false);
  assert.equal(matchesQuery(research, 'type:research caching'), true);
  assert.equal(matchesQuery(research, 'type:research crash'), false);
});

test('matchesQuery: state: matches the tracker state or one of its words', () => {
  const info = task('a', {}, 'needs-info');
  const ready = task('b', {}, 'ready-for-agent');
  assert.equal(matchesQuery(info, 'state:info'), true);
  assert.equal(matchesQuery(info, 'state:needs-info'), true);
  assert.equal(matchesQuery(ready, 'state:info'), false);
  assert.equal(matchesQuery(ready, 'state:agent'), true);
});

test('matchesQuery: the same key twice means either, different keys mean both', () => {
  const bug = task('a', { type: 'bug' }, 'needs-info');
  const research = task('b', { type: 'research' }, 'ready-for-agent');
  assert.equal(matchesQuery(bug, 'type:bug type:research'), true);
  assert.equal(matchesQuery(research, 'type:bug type:research'), true);
  assert.equal(matchesQuery(research, 'type:research state:info'), false);
});

test('matchesQuery: an unknown key is a plain word, an empty value no condition yet', () => {
  assert.equal(matchesQuery(task('a', { title: 'See foo:bar' }), 'foo:bar'), true);
  assert.equal(matchesQuery(task('a', { title: 'Plain' }), 'foo:bar'), false);
  assert.equal(matchesQuery(task('a', { type: 'bug' }), 'type:'), true);
});

test('filterBoard: column: keeps the cards drawn in that column (id or title words)', () => {
  const tasks = [task('a'), task('b', {}, 'needs-triage'), task('c', {}, 'done')];
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'column:backlog')).backlog, ['b']);
  const doneOnly = ids(filterBoard(board(tasks), tasks, 'column=Done'));
  assert.deepEqual([doneOnly.backlog, doneOnly.ready, doneOnly.done], [[], [], ['c']]);
  const running = task('r');
  const sessions = [{ id: 's', items: [{ id: 'r' }], activity: 'running', outcome: null, archivedAt: null, createdAt: 1, updatedAt: 1 }] as unknown as Parameters<typeof groupTasks>[1];
  const withRunning = groupTasks([...tasks, running], sessions, new Set(), false);
  assert.deepEqual(ids(filterBoard(withRunning, [...tasks, running], 'column:prog')).in_progress, ['r']);
});

test('filterBoard: status: matches the column or the tracker state', () => {
  const tasks = [task('a'), task('b', {}, 'needs-info'), task('c', {}, 'needs-triage')];
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'status:backlog')).backlog, ['b', 'c']);
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'status:info')).backlog, ['b']);
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'status:ready')).ready, ['a']);
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

test('filterBoard: status: naming a column means that column only, otherwise the state', () => {
  const tasks = [task('a'), task('h', {}, 'ready-for-human'), task('i', {}, 'needs-info')];
  const ready = ids(filterBoard(board(tasks), tasks, 'status:ready'));
  assert.deepEqual([ready.ready, ready.backlog], [['a'], []]);
  assert.deepEqual(ids(filterBoard(board(tasks), tasks, 'status:human')).backlog, ['h']);
});

test('filterBoard: with sub-tasks hidden, a column filter does not reach a hidden sub-task', () => {
  const tasks = [task('p', { kind: 'parent' }), task('k', { parentId: 'p' }, 'needs-info')];
  assert.deepEqual(ids(filterBoard(board(tasks, true), tasks, 'status:backlog')).ready, []);
  assert.deepEqual(ids(filterBoard(board(tasks, true), tasks, 'state:info')).ready, ['p']);
});

test('searchSuggestions: nothing while the caret sits inside a word', () => {
  assert.deepEqual(searchSuggestions('st login', 1, []), []);
  assert.deepEqual(searchSuggestions('ty', 1, []), []);
  assert.deepEqual(searchSuggestions('type:re', 6, ['research']), []);
});

test('matchesQuery reads each task as its own source stores it, whatever the primary source', () => {
  const body = localIssue('X', 'plain words');
  // A GitHub issue's body is searched whole, even on a board whose primary source is local...
  assert.equal(matchesQuery(task('#7', { body }), 'enhancement'), true);
  // ...and a local file's field lines are never searched, even when the primary source is GitHub.
  assert.equal(matchesQuery(task('.scratch/f/issues/01-x.md', { body }), 'enhancement'), false);
  assert.equal(matchesQuery(task('.scratch/f/issues/01-x.md', { body }), 'plain'), true);
});

test('matchesQuery: source: keeps the tasks of that source and joins other filters', () => {
  const mine = task('.scratch/a/issues/01.md', { type: 'bug' });
  const shared = task('#7', { type: 'bug' });
  assert.equal(matchesQuery(mine, 'source:local'), true);
  assert.equal(matchesQuery(shared, 'source:local'), false);
  assert.equal(matchesQuery(shared, 'source=git'), true);
  assert.equal(matchesQuery(shared, 'source:github type:enh'), false);
  assert.equal(matchesQuery(shared, 'source:github type:bug'), true);
  // Either source, as with any key given twice.
  assert.equal(matchesQuery(mine, 'source:github source:local'), true);
});

test('searchSuggestions: source: is offered with the project\'s sources when it has several', () => {
  const sources = ['local', 'github'];
  const offered = (text: string, list: string[]) => searchSuggestions(text, text.length, [], list).map((s) => s.label);
  assert.deepEqual(offered('so', sources), ['source:']);
  assert.deepEqual(offered('source:', sources), ['source:local', 'source:github']);
  assert.deepEqual(offered('bug source:g', sources), ['source:github']);
  // One source: nothing to tell apart, so the key is not offered.
  assert.deepEqual(offered('so', ['local']), []);
  assert.deepEqual(offered('so', []), []);
});
