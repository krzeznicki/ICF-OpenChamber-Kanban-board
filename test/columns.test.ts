import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GuestSessionRecord } from '@openchamber/sdk';
import { columnFor, groupTasks, ledByOrchestrator, resolveSession, sessionForTask, sessionTarget, type SessionInfo } from '../src/panel/columns.ts';
import type { Task, TaskState } from '../src/core/types.ts';

const task = (state: TaskState, id = '.scratch/f/issues/01-a.md'): Task => ({
  id,
  kind: 'ticket',
  title: 'A',
  body: '',
  state,
  type: null,
  parentId: null,
  blockedBy: [],
  url: null,
  updatedAt: 0,
  claimed: false,
});

const info = (activity: SessionInfo['activity'], outcome: SessionInfo['outcome'] = null): SessionInfo => ({
  id: 's1',
  activity,
  outcome,
  archived: false,
});

const record = (id: string, itemIds: string[], extra: Partial<GuestSessionRecord> = {}): GuestSessionRecord => ({
  id,
  title: id,
  projectId: 'p1',
  directory: '/repo',
  parentId: null,
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
  worktree: null,
  activity: 'idle',
  outcome: null,
  items: itemIds.map((itemId) => ({ id: itemId })),
  ...extra,
});

test('columnFor: a done task is done', () => {
  assert.equal(columnFor(task('done'), null, false), 'done');
});

test('columnFor: a done task with a running session stays done', () => {
  assert.equal(columnFor(task('done'), info('running'), true), 'done');
});

test('columnFor: a queued task is in progress', () => {
  assert.equal(columnFor(task('needs-triage'), null, true), 'in_progress');
});

test('columnFor: a running session puts the task in progress', () => {
  assert.equal(columnFor(task('ready-for-agent'), info('running'), false), 'in_progress');
});

test('columnFor: a retrying session puts the task in progress', () => {
  assert.equal(columnFor(task('ready-for-agent'), info('retrying'), false), 'in_progress');
});

test('columnFor: a session waiting on permission puts the task in review', () => {
  assert.equal(columnFor(task('ready-for-agent'), info('waiting-permission'), false), 'review');
});

test('columnFor: a session waiting on a question puts the task in review', () => {
  assert.equal(columnFor(task('ready-for-agent'), info('waiting-question'), false), 'review');
});

test('columnFor: an idle session with an outcome puts the task in review', () => {
  assert.equal(columnFor(task('ready-for-agent'), info('idle', 'completed'), false), 'review');
  assert.equal(columnFor(task('ready-for-agent'), info('idle', 'failed'), false), 'review');
});

test('columnFor: an idle session without an outcome falls back to the state', () => {
  assert.equal(columnFor(task('ready-for-agent'), info('idle'), false), 'ready');
  assert.equal(columnFor(task('needs-info'), info('unknown'), false), 'backlog');
});

test('columnFor: ready-for-agent without a session is ready', () => {
  assert.equal(columnFor(task('ready-for-agent'), null, false), 'ready');
});

test('columnFor: every other state without a session is backlog', () => {
  for (const s of ['needs-triage', 'needs-info', 'ready-for-human', 'wontfix'] as const) {
    assert.equal(columnFor(task(s), null, false), 'backlog', s);
  }
});

test('sessionForTask: null when no session carries the task', () => {
  assert.equal(sessionForTask('t1', [record('s1', ['other'])]), null);
  assert.equal(sessionForTask('t1', []), null);
});

test('sessionForTask: maps the matching session to SessionInfo', () => {
  const s = record('s1', ['t1'], { activity: 'running', outcome: null });
  assert.deepEqual(sessionForTask('t1', [s]), { id: 's1', activity: 'running', outcome: null, archived: false });
});

test('sessionForTask: ignores archived sessions', () => {
  const archived = record('old', ['t1'], { archivedAt: 5, createdAt: 10, activity: 'running' });
  assert.equal(sessionForTask('t1', [archived]), null);
  const live = record('live', ['t1'], { createdAt: 1, outcome: 'completed' });
  assert.equal(sessionForTask('t1', [archived, live])?.id, 'live');
});

test('sessionForTask: picks the newest session', () => {
  const older = record('older', ['t1'], { createdAt: 1 });
  const newer = record('newer', ['x', 't1'], { createdAt: 2 });
  assert.equal(sessionForTask('t1', [newer, older])?.id, 'newer');
  assert.equal(sessionForTask('t1', [older, newer])?.id, 'newer');
});

const t = (id: string, state: TaskState, extra: Partial<Task> = {}): Task => ({ ...task(state, id), ...extra });
const ids = (cards: { task: Task; child: boolean }[]): string[] => cards.map((c) => (c.child ? `  ${c.task.id}` : c.task.id));

test('groupTasks: sorts by column, counts sub-tasks and puts children under their parent', () => {
  const tasks = [
    t('c1', 'needs-triage', { parentId: 'p' }),
    t('p', 'needs-triage', { kind: 'parent' }),
    t('c2', 'done', { parentId: 'p' }),
    t('r', 'ready-for-agent'),
    t('s', 'ready-for-agent'),
  ];
  const board = groupTasks(tasks, [record('s1', ['s'], { activity: 'running' })], new Set(), false);
  assert.deepEqual(ids(board.backlog), ['p', '  c1']);
  assert.deepEqual(ids(board.ready), ['r']);
  assert.deepEqual(ids(board.in_progress), ['s']);
  assert.deepEqual(ids(board.done), ['c2']);
  assert.deepEqual(board.backlog[0]?.progress, { done: 1, total: 2 });
  assert.equal(board.ready[0]?.progress, null);
});

test('groupTasks: queued ids go to in progress', () => {
  const board = groupTasks([t('a', 'ready-for-agent')], [], new Set(['a']), false);
  assert.deepEqual(ids(board.in_progress), ['a']);
});

test('groupTasks: hideSubtasks drops tasks with a parent but keeps the parent progress', () => {
  const tasks = [t('p', 'needs-triage', { kind: 'parent' }), t('c', 'done', { parentId: 'p' })];
  const board = groupTasks(tasks, [], new Set(), true);
  assert.deepEqual(ids(board.backlog), ['p']);
  assert.deepEqual(board.done, []);
  assert.deepEqual(board.backlog[0]?.progress, { done: 1, total: 1 });
});

test('groupTasks: only listed, open blockers count', () => {
  const tasks = [t('a', 'needs-triage', { blockedBy: ['b', 'd', 'gone'] }), t('b', 'needs-triage'), t('d', 'done')];
  const board = groupTasks(tasks, [], new Set(), false);
  assert.deepEqual(board.backlog.find((c) => c.task.id === 'a')?.blockers, ['b']);
});

test('sessionForTask: a session named by the service links counts, though it carries no items', () => {
  const s = record('svc', [], { activity: 'running' });
  assert.equal(sessionForTask('t1', [s]), null);
  assert.equal(sessionForTask('t1', [s], [{ taskId: 't1', sessionId: 'svc' }])?.id, 'svc');
  assert.equal(sessionForTask('t2', [s], [{ taskId: 't1', sessionId: 'svc' }]), null);
});

test('sessionForTask: newest wins across items and links; archived linked sessions are ignored', () => {
  const byItem = record('item', ['t1'], { createdAt: 1 });
  const byLink = record('link', [], { createdAt: 2, activity: 'waiting-question' });
  const links = [{ taskId: 't1', sessionId: 'link' }];
  assert.equal(sessionForTask('t1', [byItem, byLink], links)?.id, 'link');
  const archived = record('link', [], { createdAt: 2, archivedAt: 3 });
  assert.equal(sessionForTask('t1', [byItem, archived], links)?.id, 'item');
});

test('groupTasks: a linked session moves its card; a queued card without a session is marked starting', () => {
  const tasks = [t('a', 'ready-for-agent'), t('b', 'ready-for-agent')];
  const board = groupTasks(tasks, [record('svc', [], { activity: 'idle', outcome: 'completed' })], new Set(['b']), false, [
    { taskId: 'a', sessionId: 'svc' },
  ]);
  assert.deepEqual(ids(board.review), ['a']);
  assert.equal(board.review[0]?.starting, false);
  assert.deepEqual(ids(board.in_progress), ['b']);
  assert.equal(board.in_progress[0]?.starting, true);
});

test('sessionForTask: a linked session missing from the snapshot follows its live status', () => {
  const link = (status: 'idle' | 'busy' | 'waiting' | 'unknown', createdAt = 1) => ({ taskId: 't1', sessionId: `s_${status}`, status, createdAt });
  assert.equal(sessionForTask('t1', [], [link('busy')])?.activity, 'running');
  assert.equal(sessionForTask('t1', [], [link('waiting')])?.activity, 'waiting-question');
  assert.deepEqual(sessionForTask('t1', [], [link('idle')]), { id: 's_idle', activity: 'idle', outcome: 'completed', archived: false });
  assert.equal(sessionForTask('t1', [], [link('unknown')]), null);
  // The newest link wins; a snapshot session (archived too) is never overridden by its link.
  assert.equal(sessionForTask('t1', [], [link('busy', 1), link('idle', 2)])?.id, 's_idle');
  const archived = record('s_busy', [], { archivedAt: 3 });
  assert.equal(sessionForTask('t1', [archived], [link('busy')]), null);
});

test('groupTasks: link status columns (busy in progress, waiting and idle review); queued cards are marked', () => {
  const tasks = [t('a', 'ready-for-agent'), t('b', 'ready-for-agent'), t('c', 'ready-for-agent'), t('q', 'ready-for-agent'), t('d', 'done')];
  const links = [
    { taskId: 'a', sessionId: 'sa', status: 'busy' as const },
    { taskId: 'b', sessionId: 'sb', status: 'waiting' as const },
    { taskId: 'c', sessionId: 'sc', status: 'idle' as const },
  ];
  const board = groupTasks(tasks, [], new Set(), false, links, new Set(['q', 'd']));
  assert.deepEqual(ids(board.in_progress), ['a', 'q']);
  assert.deepEqual(ids(board.review), ['b', 'c']);
  assert.deepEqual(ids(board.done), ['d']);
  assert.equal(board.in_progress.find((c) => c.task.id === 'q')?.queued, true);
  assert.equal(board.in_progress.find((c) => c.task.id === 'q')?.starting, false);
  assert.equal(board.done[0]?.queued, false);
  const withError = groupTasks(tasks, [], new Set(), false, links, new Set(['q']), new Map([['q', 'quota'], ['a', 'x']]));
  assert.equal(withError.in_progress.find((c) => c.task.id === 'q')?.queueError, 'quota');
  assert.equal(withError.in_progress.find((c) => c.task.id === 'a')?.queueError, null);
});

// --- parent orchestration ---

test('columnFor: a claimed ready-for-agent child is in progress only while its parent session runs', () => {
  const claimed = { ...task('ready-for-agent'), parentId: 'p', claimed: true };
  assert.equal(columnFor(claimed, null, false, true), 'in_progress');
  assert.equal(columnFor(claimed, null, false, false), 'ready');
  assert.equal(columnFor(claimed, null, false), 'ready');
  // Not claimed: the orchestrator has not taken it yet.
  assert.equal(columnFor({ ...claimed, claimed: false }, null, false, true), 'ready');
  // Only ready-for-agent counts (on GitHub an assignee can stay on any state).
  assert.equal(columnFor({ ...claimed, state: 'needs-info' }, null, false, true), 'backlog');
  assert.equal(columnFor({ ...claimed, state: 'done' }, null, false, true), 'done');
});

test('groupTasks: a claimed child follows its running parent into In Progress and is led by the orchestrator', () => {
  const tasks = [
    t('p', 'ready-for-agent', { kind: 'parent' }),
    t('c1', 'ready-for-agent', { parentId: 'p', claimed: true }),
    t('c2', 'ready-for-agent', { parentId: 'p' }),
    t('c3', 'done', { parentId: 'p' }),
  ];
  const board = groupTasks(tasks, [record('orch', ['p'], { activity: 'running' })], new Set(), false);
  assert.deepEqual(ids(board.in_progress), ['p', '  c1']);
  assert.deepEqual(ids(board.ready), ['c2']);
  assert.deepEqual(ids(board.done), ['c3']);
  const all = Object.values(board).flat();
  const led = (id: string): boolean | undefined => all.find((c) => c.task.id === id)?.ledByOrchestrator;
  assert.equal(led('p'), false);
  assert.equal(led('c1'), true);
  assert.equal(led('c2'), true);
  assert.equal(led('c3'), false);
});

test('groupTasks: with the parent session finished, a claimed child shows Ready and is not led', () => {
  const tasks = [t('p', 'ready-for-agent', { kind: 'parent' }), t('c1', 'ready-for-agent', { parentId: 'p', claimed: true })];
  const board = groupTasks(tasks, [record('orch', ['p'], { activity: 'idle', outcome: 'completed' })], new Set(), false);
  assert.deepEqual(ids(board.ready), ['c1']);
  assert.equal(board.ready[0]?.ledByOrchestrator, false);
});

test('groupTasks: a parent session known only by its busy link also leads the children', () => {
  const tasks = [t('p', 'ready-for-agent', { kind: 'parent' }), t('c1', 'ready-for-agent', { parentId: 'p', claimed: true })];
  const board = groupTasks(tasks, [], new Set(), false, [{ taskId: 'p', sessionId: 'sp', status: 'busy' }]);
  assert.deepEqual(ids(board.in_progress), ['p', '  c1']);
});

test('ledByOrchestrator: a not-done child whose parent session runs or retries', () => {
  const child = t('c1', 'ready-for-agent', { parentId: 'p' });
  assert.equal(ledByOrchestrator(child, [record('orch', ['p'], { activity: 'running' })]), true);
  assert.equal(ledByOrchestrator(child, [record('orch', ['p'], { activity: 'retrying' })]), true);
  assert.equal(ledByOrchestrator(child, [record('orch', ['p'], { activity: 'waiting-question' })]), false);
  assert.equal(ledByOrchestrator(child, []), false);
  assert.equal(ledByOrchestrator({ ...child, state: 'done' }, [record('orch', ['p'], { activity: 'running' })]), false);
  assert.equal(ledByOrchestrator(t('x', 'ready-for-agent'), [record('orch', ['p'], { activity: 'running' })]), false);
});

// --- Detach: a card dragged out of In Progress / Review to Backlog or Ready ---

test('sessionForTask: sessions and links created before detachedAt are ignored; newer ones count', () => {
  const t = '.scratch/f/issues/01-a.md';
  const old = record('old', [t], { activity: 'running', createdAt: 100 });
  assert.equal(sessionForTask(t, [old], [], 200), null);
  assert.equal(sessionForTask(t, [old], [], 0)?.id, 'old');
  const linked = record('lk', [], { activity: 'running', createdAt: 150 });
  assert.equal(sessionForTask(t, [linked], [{ taskId: t, sessionId: 'lk', createdAt: 160 }], 200), null);
  // A link-only session (missing from the snapshot) created before the detach is ignored too.
  assert.equal(sessionForTask(t, [], [{ taskId: t, sessionId: 'gone', createdAt: 150, status: 'busy' }], 200), null);
  assert.equal(sessionForTask(t, [], [{ taskId: t, sessionId: 'gone', status: 'busy' }], 200), null, 'a link without createdAt is older');
  // Started again after the detach: the new session counts.
  const fresh = record('new', [t], { activity: 'running', createdAt: 300 });
  assert.equal(sessionForTask(t, [old, fresh], [], 200)?.id, 'new');
});

test('groupTasks: after a detach the card follows its state (Ready / Backlog), not the older session', () => {
  const ready = task('ready-for-agent', 'r');
  const triage = task('needs-triage', 'b');
  const sessions = [
    record('s-r', ['r'], { activity: 'idle', outcome: 'completed', createdAt: 10 }),
    record('s-b', ['b'], { activity: 'running', createdAt: 10 }),
  ];
  const before = groupTasks([ready, triage], sessions, new Set(), false);
  assert.deepEqual(before.review.map((c) => c.task.id), ['r']);
  assert.deepEqual(before.in_progress.map((c) => c.task.id), ['b']);
  const detached = new Map([
    ['r', 20],
    ['b', 20],
  ]);
  const after = groupTasks([ready, triage], sessions, new Set(), false, [], new Set(), new Map(), detached);
  assert.deepEqual(after.ready.map((c) => c.task.id), ['r']);
  assert.deepEqual(after.backlog.map((c) => c.task.id), ['b']);
  assert.equal(after.ready[0]!.session, null);
});

test('ledByOrchestrator / groupTasks: a detached parent session no longer leads its children', () => {
  const parent = { ...task('ready-for-agent', 'p'), kind: 'parent' as const };
  const kid = { ...task('ready-for-agent', 'k'), parentId: 'p', claimed: true };
  const sessions = [record('sp', ['p'], { activity: 'running', createdAt: 10 })];
  assert.equal(ledByOrchestrator(kid, sessions, []), true);
  assert.equal(ledByOrchestrator(kid, sessions, [], new Map([['p', 20]])), false);
  const g = groupTasks([parent, kid], sessions, new Set(), false, [], new Set(), new Map(), new Map([['p', 20]]));
  assert.deepEqual(g.ready.map((c) => c.task.id), ['p', 'k']);
});

// The archived-session jump (0.2): a session known only from links.json answers `idle` to
// sessions.status even when archived (status knows activity, not archiving), so the card read as a
// finished session and a click handed host.openSession an id missing from the project's snapshot.
test('sessionTarget: a non-archived snapshot session can be opened directly', () => {
  const s = record('s1', ['t1'], { activity: 'idle', outcome: 'completed' });
  assert.deepEqual(sessionTarget('t1', [s]), { kind: 'open', id: 's1' });
  const linked = record('svc', [], { activity: 'running' });
  assert.deepEqual(sessionTarget('t1', [linked], [{ taskId: 't1', sessionId: 'svc' }]), { kind: 'open', id: 'svc' });
});

test('sessionTarget: an id known only from a link must be looked up first, never opened directly', () => {
  const links = [{ taskId: 't1', sessionId: 'ses_gone', status: 'idle' as const, createdAt: 1 }];
  assert.deepEqual(sessionTarget('t1', [], links), { kind: 'check', id: 'ses_gone' });
});

test('sessionTarget: only archived sessions -> archived; nothing at all -> none', () => {
  const archived = record('s1', ['t1'], { archivedAt: 5, activity: 'idle', outcome: 'completed' });
  assert.deepEqual(sessionTarget('t1', [archived]), { kind: 'archived' });
  const archivedLink = record('svc', [], { archivedAt: 5 });
  assert.deepEqual(sessionTarget('t1', [archivedLink], [{ taskId: 't1', sessionId: 'svc', status: 'idle' }]), { kind: 'archived' });
  assert.deepEqual(sessionTarget('t1', []), { kind: 'none' });
  // A link whose session the host does not know (deleted): nothing to open.
  assert.deepEqual(sessionTarget('t1', [], [{ taskId: 't1', sessionId: 'x', status: 'unknown' }]), { kind: 'none' });
});

test('sessionTarget: a live session wins over an archived one; a detach hides both', () => {
  const old = record('old', ['t1'], { createdAt: 1, archivedAt: 9 });
  const live = record('live', ['t1'], { createdAt: 2 });
  assert.deepEqual(sessionTarget('t1', [old, live]), { kind: 'open', id: 'live' });
  assert.deepEqual(sessionTarget('t1', [old, live], [], 10), { kind: 'none' });
});

test('resolveSession: found and not archived -> open; archived -> archived; in no snapshot -> missing', () => {
  const a = [record('x', []), record('arch', [], { archivedAt: 3 })];
  const b = [record('y', [], { projectId: 'p2' })];
  assert.equal(resolveSession('y', [a, b]), 'open');
  assert.equal(resolveSession('arch', [a, b]), 'archived');
  assert.equal(resolveSession('ses_gone', [a, b]), 'missing');
  assert.equal(resolveSession('ses_gone', []), 'missing');
});
