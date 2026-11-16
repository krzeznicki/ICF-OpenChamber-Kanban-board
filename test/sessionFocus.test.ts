import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GuestSessionRecord } from '@openchamber/sdk';
import { createSessionFocus, tasksForSession } from '../src/panel/sessionFocus.ts';
import type { Task } from '../src/core/types.ts';
import type { SessionLink } from '../src/panel/columns.ts';

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  kind: 'ticket',
  title: id,
  body: '',
  state: 'ready-for-agent',
  type: null,
  parentId: null,
  blockedBy: [],
  url: null,
  updatedAt: 0,
  claimed: false,
  ...extra,
});

const record = (id: string, itemIds: string[], extra: Partial<GuestSessionRecord> = {}): GuestSessionRecord => ({
  id,
  title: id,
  projectId: 'p1',
  directory: '/repo',
  parentId: null,
  createdAt: 100,
  updatedAt: 100,
  archivedAt: null,
  worktree: null,
  activity: 'running',
  outcome: null,
  items: itemIds.map((itemId) => ({ id: itemId })),
  ...extra,
});

const board = (tasks: Task[], sessions: GuestSessionRecord[], links: SessionLink[] = []) => ({ ready: true, tasks, sessions, links, detached: new Map() });

const ids = (tasks: Task[]): string[] => tasks.map((t) => t.id);

test('tasksForSession: a task the session carries as an item belongs to it', () => {
  const tasks = [task('a'), task('b')];
  assert.deepEqual(ids(tasksForSession('s1', tasks, [record('s1', ['b']), record('s2', ['a'])])), ['b']);
});

test('tasksForSession: a task the service links name for the session belongs to it (session not in the snapshot)', () => {
  const tasks = [task('a'), task('b'), task('c')];
  const links = [
    { taskId: 'c', sessionId: 's1', createdAt: 100 },
    { taskId: 'a', sessionId: 's2', createdAt: 100 },
  ];
  assert.deepEqual(ids(tasksForSession('s1', tasks, [], links)), ['c']);
});

test('tasksForSession: a card dragged away from the session after it started no longer belongs to it', () => {
  const tasks = [task('a'), task('b'), task('c')];
  const sessions = [record('s1', ['a', 'b'], { createdAt: 100 })];
  const links = [{ taskId: 'c', sessionId: 's1', createdAt: 100 }];
  const detached = new Map([
    ['a', 200], // dragged away after s1 started
    ['b', 50], // dragged away before s1 started: s1 counts again
    ['c', 200],
  ]);
  assert.deepEqual(ids(tasksForSession('s1', tasks, sessions, links, detached)), ['b']);
});

test('sessionFocus: one task of the session opens that task', () => {
  const focus = createSessionFocus('s1');
  assert.deepEqual(focus.next(board([task('a'), task('b')], [record('s1', ['a'])])), { kind: 'open', taskId: 'a' });
});

test('sessionFocus: several tasks of the session are listed', () => {
  const focus = createSessionFocus('s1');
  const links = [{ taskId: 'b', sessionId: 's1', createdAt: 100 }];
  assert.deepEqual(focus.next(board([task('a'), task('b'), task('c')], [record('s1', ['a'])], links)), {
    kind: 'list',
    tasks: [task('a'), task('b')],
  });
});

test('sessionFocus: waits until the board is loaded, then decides once per panel frame', () => {
  const focus = createSessionFocus('s1');
  assert.deepEqual(focus.next({ ...board([task('a')], [record('s1', ['a'])]), ready: false }), { kind: 'wait' });
  assert.deepEqual(focus.next(board([task('a')], [record('s1', [])])), { kind: 'none' });
  assert.deepEqual(focus.next(board([task('a')], [record('s1', ['a'])])), { kind: 'skip' });
});

test('sessionFocus: a panel opened outside a session shows nothing', () => {
  const focus = createSessionFocus(null);
  assert.deepEqual(focus.next(board([task('a')], [record('s1', ['a'])])), { kind: 'skip' });
});
