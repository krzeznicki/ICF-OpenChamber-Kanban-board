import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLabels } from '../src/core/config.ts';
import { createGithubTracker } from '../src/core/githubTracker.ts';
import { TrackerError } from '../src/core/types.ts';
import { fakeGh, type FakeGhOptions, type FakeIssue } from './fakeGh.ts';

const LABELS = parseLabels(null);
const DAY = 24 * 3600 * 1000;
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString();
const ALL_LABELS = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix', 'bug', 'enhancement'];

const ISSUES: FakeIssue[] = [
  { number: 1, title: 'Feature', body: 'The spec', labels: ['enhancement', 'ready-for-agent'] },
  { number: 2, title: 'First ticket', labels: ['ready-for-agent', 'needs-info', 'bug'], parent: 1 },
  { number: 3, title: 'Second ticket', labels: ['type:chore'], parent: 1, blockedBy: [2] },
  { number: 4, title: 'Body blockers', body: 'Do it.\n\n## Blocked by\n\n- #2\n- #3\n\n## Notes\n\nsee #9\n', labels: ['ready-for-human'] },
  { number: 5, title: 'Line blocker', body: '**Blocked by:** #4, #2\n\nText', labels: ['wontfix'] },
  { number: 6, title: 'Done lately', labels: ['ready-for-agent'], state: 'CLOSED', closedAt: ago(3) },
  { number: 7, title: 'Done long ago', state: 'CLOSED', closedAt: ago(40) },
];

const setup = (issues: FakeIssue[] = ISSUES, options: FakeGhOptions = {}) => {
  const gh = fakeGh(issues, { labels: ALL_LABELS, ...options });
  return { gh, tracker: createGithubTracker('/repo', gh.exec, LABELS) };
};

const rejectsWith = async (p: Promise<unknown>, code: string, message?: RegExp): Promise<void> => {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof TrackerError, `expected TrackerError, got ${String(e)}`);
    assert.equal(e.code, code);
    if (message) assert.match(e.message, message);
    return true;
  });
};

test('list maps labels, parents, sub-issues and blockers; drops issues closed over 30 days ago', async () => {
  const { tracker, gh } = setup();
  const tasks = await tracker.list();
  assert.deepEqual(tasks.map((t) => t.id), ['#1', '#2', '#3', '#4', '#5', '#6']);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const t1 = byId.get('#1')!;
  assert.equal(t1.kind, 'parent');
  assert.equal(t1.parentId, null);
  assert.equal(t1.type, 'enhancement');
  assert.equal(t1.state, 'ready-for-agent');
  assert.equal(t1.body, 'The spec');
  assert.equal(t1.url, 'https://github.com/o/r/issues/1');
  assert.ok(t1.updatedAt > 0);
  const t2 = byId.get('#2')!;
  assert.equal(t2.kind, 'ticket');
  assert.equal(t2.parentId, '#1');
  assert.equal(t2.state, 'needs-info'); // two state labels -> first in role order
  assert.equal(t2.type, 'bug');
  assert.equal(byId.get('#3')!.type, 'chore');
  assert.equal(byId.get('#3')!.state, 'needs-triage');
  assert.deepEqual(byId.get('#3')!.blockedBy, ['#2']); // native dependency
  assert.deepEqual(byId.get('#4')!.blockedBy, ['#2', '#3']); // "## Blocked by" section only
  assert.equal(byId.get('#4')!.state, 'ready-for-human');
  assert.deepEqual(byId.get('#5')!.blockedBy, ['#4', '#2']); // "Blocked by:" line
  assert.equal(byId.get('#5')!.state, 'wontfix');
  assert.equal(byId.get('#6')!.state, 'done'); // closed wins over labels
  const list = gh.calls.find((c) => c[1] === 'issue' && c[2] === 'list')!;
  assert.deepEqual(list, [
    'gh', 'issue', 'list', '--state', 'all', '--limit', '500',
    '--json', 'number,title,body,labels,state,updatedAt,url,closedAt,assignees',
  ]);
  assert.equal(gh.calls.filter((c) => c[1] === 'api' && c[2] === 'graphql').length, 1);
});

test('custom label strings from triage-labels.md are used for state', async () => {
  const labels = parseLabels('| `ready-for-agent` | `afk` | x |\n');
  const gh = fakeGh([{ number: 1, title: 'A', labels: ['afk'] }], { labels: ['afk', 'needs-triage'] });
  const tracker = createGithubTracker('/repo', gh.exec, labels);
  assert.equal((await tracker.get('#1')).state, 'ready-for-agent');
  await tracker.setState('#1', 'needs-triage');
  assert.deepEqual(gh.commands(), ['gh issue edit 1 --add-label needs-triage --remove-label afk']);
});

test('preflight runs once per tracker, before the first command', async () => {
  const { tracker, gh } = setup();
  await tracker.list();
  await tracker.get('#2');
  assert.deepEqual(gh.calls.slice(0, 2), [['gh', '--version'], ['gh', 'auth', 'status']]);
  assert.equal(gh.calls.filter((c) => c[1] === '--version').length, 1);
  assert.equal(gh.calls.filter((c) => c[1] === 'auth').length, 1);
});

test('get accepts "#n" and "n"; unknown -> NOT_FOUND; garbage -> INVALID', async () => {
  const { tracker } = setup();
  assert.equal((await tracker.get('3')).id, '#3');
  await rejectsWith(tracker.get('#99'), 'NOT_FOUND');
  await rejectsWith(tracker.get('.scratch/x/spec.md'), 'INVALID');
});

test('setState issues exactly one edit call with both flags', async () => {
  const { tracker, gh } = setup();
  const task = await tracker.setState('#2', 'ready-for-human');
  assert.deepEqual(gh.commands(), [
    'gh issue edit 2 --add-label ready-for-human --remove-label ready-for-agent --remove-label needs-info',
  ]);
  assert.equal(task.state, 'ready-for-human');
  assert.deepEqual(gh.issues.find((i) => i.number === 2)!.labels, ['bug', 'ready-for-human']);
});

test('setState creates a missing label first', async () => {
  const { tracker, gh } = setup(ISSUES, { labels: ['bug'] });
  await tracker.setState('#3', 'ready-for-agent');
  const cmds = gh.commands();
  assert.match(cmds[0]!, /^gh label create ready-for-agent /);
  assert.equal(cmds[1], 'gh issue edit 3 --add-label ready-for-agent');
  assert.equal(cmds.length, 2);
});

test('setState done closes; from done reopens and sets the label', async () => {
  const { tracker, gh } = setup();
  assert.equal((await tracker.setState('#3', 'done')).state, 'done');
  assert.deepEqual(gh.commands(), ['gh issue close 3']);
  const reopened = await tracker.setState('#6', 'needs-info');
  assert.equal(reopened.state, 'needs-info');
  assert.deepEqual(gh.commands().slice(1), [
    'gh issue reopen 6',
    'gh issue edit 6 --add-label needs-info --remove-label ready-for-agent',
  ]);
});

test('setType swaps type labels; custom types become type:<x>', async () => {
  const { tracker, gh } = setup();
  assert.equal((await tracker.setType('#2', 'research')).type, 'research');
  assert.match(gh.commands()[0]!, /^gh label create type:research /);
  assert.equal(gh.commands()[1], 'gh issue edit 2 --add-label type:research --remove-label bug');
  assert.equal((await tracker.setType('#3', 'bug')).type, 'bug');
  assert.equal(gh.commands()[2], 'gh issue edit 3 --add-label bug --remove-label type:chore');
});

test('create uses --parent, --label and --blocked-by and returns the new task', async () => {
  const { tracker, gh } = setup();
  const task = await tracker.create({
    title: 'New one',
    body: 'Body',
    type: 'bug',
    state: 'ready-for-agent',
    parentId: '#1',
    blockedBy: ['#2', '3'],
  });
  assert.deepEqual(gh.commands(), [
    'gh issue create --title New one --body Body --label ready-for-agent --label bug --parent 1 --blocked-by 2,3',
  ]);
  assert.equal(task.id, '#8');
  assert.equal(task.parentId, '#1');
  assert.equal(task.state, 'ready-for-agent');
  assert.equal(task.type, 'bug');
  assert.deepEqual(task.blockedBy, ['#2', '#3']);
  await rejectsWith(tracker.create({ title: '  ' }), 'INVALID');
  await rejectsWith(tracker.create({ title: 'x', parentId: 'nope' }), 'INVALID');
});

test('closing a parent with children closes each open child, then the parent', async () => {
  const issues: FakeIssue[] = [
    { number: 1, title: 'Feature' },
    { number: 2, title: 'A', parent: 1 },
    { number: 3, title: 'B', parent: 1, state: 'CLOSED', closedAt: ago(1) },
    { number: 4, title: 'C', parent: 1 },
  ];
  const { tracker, gh } = setup(issues);
  const closed = await tracker.close('#1', { withChildren: true });
  assert.deepEqual(gh.commands(), ['gh issue close 2', 'gh issue close 4', 'gh issue close 1']);
  assert.deepEqual(closed.map((t) => t.id), ['#1', '#2', '#4']);
  assert.ok(closed.every((t) => t.state === 'done'));
});

test('close without children closes only the task', async () => {
  const { tracker, gh } = setup();
  const closed = await tracker.close('#1', { withChildren: false });
  assert.deepEqual(gh.commands(), ['gh issue close 1']);
  assert.deepEqual(closed.map((t) => t.id), ['#1']);
});

test('no gh -> GH_MISSING with the install hint', async () => {
  const { tracker } = setup(ISSUES, { version: null });
  await rejectsWith(tracker.list(), 'GH_MISSING', /install.*brew install gh/);
});

test('old gh -> GH_OLD', async () => {
  const { tracker } = setup(ISSUES, { version: '2.93.9' });
  await rejectsWith(tracker.list(), 'GH_OLD', /2\.93\.9.*2\.94/);
  const ok = setup(ISSUES, { version: '2.94.0' });
  assert.equal((await ok.tracker.list()).length, 6);
});

test('not logged in -> GH_AUTH with gh auth login', async () => {
  const { tracker } = setup(ISSUES, { authed: false });
  await rejectsWith(tracker.list(), 'GH_AUTH', /gh auth login/);
});

test('issues disabled -> FAILED with gh\'s sentence', async () => {
  const { tracker } = setup(ISSUES, { issuesDisabled: true });
  await rejectsWith(tracker.list(), 'FAILED', /has disabled issues/);
});

test('empty repo lists [] without a GraphQL call', async () => {
  const { tracker, gh } = setup([]);
  assert.deepEqual(await tracker.list(), []);
  assert.equal(gh.calls.filter((c) => c[1] === 'api').length, 0);
});

test('claimed: an issue with an assignee is claimed, in list and get', async () => {
  const { tracker } = setup([
    { number: 1, title: 'Feature' },
    { number: 2, title: 'Mine', labels: ['ready-for-agent'], parent: 1, assignees: ['me'] },
    { number: 3, title: 'Free', labels: ['ready-for-agent'], parent: 1 },
  ]);
  const byId = new Map((await tracker.list()).map((x) => [x.id, x]));
  assert.equal(byId.get('#2')!.claimed, true);
  assert.equal(byId.get('#3')!.claimed, false);
  assert.equal((await tracker.get('#2')).claimed, true);
  assert.equal((await tracker.get('#3')).claimed, false);
});

test('claim assigns @me and keeps the state label; setState does not remove assignees', async () => {
  const { tracker, gh } = setup([
    { number: 1, title: 'Feature' },
    { number: 2, title: 'Kid', labels: ['ready-for-agent'], parent: 1 },
    { number: 3, title: 'Closed kid', parent: 1, state: 'CLOSED', closedAt: ago(1) },
  ]);
  await rejectsWith(tracker.claim('#3'), 'INVALID');
  const claimed = await tracker.claim('#2');
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.state, 'ready-for-agent');
  assert.deepEqual(gh.commands(), ['gh issue edit 2 --add-assignee @me']);
  const done = await tracker.setState('#2', 'done');
  assert.equal(done.state, 'done');
  assert.ok(!gh.commands().some((c) => c.includes('--remove-assignee')));
});

test('claim of a parent issue is INVALID and runs no edit', async () => {
  const { tracker, gh } = setup();
  await rejectsWith(tracker.claim('#1'), 'INVALID');
  assert.deepEqual(gh.commands(), []);
});

test('claim is only allowed for a ready-for-agent issue; others are INVALID with no edit', async () => {
  const { tracker, gh } = setup([
    { number: 1, title: 'Feature' },
    { number: 2, title: 'Triage', parent: 1 },
    { number: 3, title: 'Info', labels: ['needs-info'], parent: 1 },
    { number: 4, title: 'Human', labels: ['ready-for-human'], parent: 1 },
    { number: 5, title: 'Wontfix', labels: ['wontfix'], parent: 1 },
    { number: 6, title: 'Closed', labels: ['ready-for-agent'], parent: 1, state: 'CLOSED', closedAt: ago(1) },
  ]);
  for (const id of ['#2', '#3', '#4', '#5', '#6']) {
    await rejectsWith(tracker.claim(id), 'INVALID', /Only a ready-for-agent task can be claimed/);
  }
  assert.deepEqual(gh.commands(), []);
});

test('setParent sets the native parent with gh issue edit --parent; the number stays, an old parent is replaced', async () => {
  const { tracker, gh } = setup();
  const linked = await tracker.setParent('#4', '#5');
  assert.equal(linked.id, '#4');
  assert.equal(linked.parentId, '#5');
  assert.equal((await tracker.get('#5')).kind, 'parent');
  const moved = await tracker.setParent('#3', '#4');
  assert.equal(moved.id, '#3');
  assert.equal(moved.parentId, '#4');
  assert.deepEqual(gh.commands(), ['gh issue edit 4 --parent 5', 'gh issue edit 3 --parent 4']);
});

test('setParent refuses itself and its current parent; a missing issue is NOT_FOUND', async () => {
  const { tracker, gh } = setup();
  await rejectsWith(tracker.setParent('#2', '#2'), 'INVALID');
  await rejectsWith(tracker.setParent('#2', '#1'), 'INVALID', /already/);
  await rejectsWith(tracker.setParent('#2', '#99'), 'NOT_FOUND');
  await rejectsWith(tracker.setParent('#99', '#1'), 'NOT_FOUND');
  assert.deepEqual(gh.commands(), []);
});

test('setParent refuses a parent that is the task itself’s descendant (walking up the would-be parent’s chain)', async () => {
  const { tracker, gh } = setup([
    { number: 1, title: 'Top' },
    { number: 2, title: 'Middle', parent: 1 },
    { number: 3, title: 'Leaf', parent: 2 },
    { number: 4, title: 'Other' },
  ]);
  await rejectsWith(tracker.setParent('#1', '#3'), 'INVALID', /#3 is a descendant of #1/);
  await rejectsWith(tracker.setParent('#1', '#2'), 'INVALID', /descendant/);
  assert.deepEqual(gh.commands(), []);
  assert.equal((await tracker.setParent('#4', '#3')).parentId, '#3');
});

test('edit changes the title and body with gh issue edit; only what is given is sent', async () => {
  const { tracker, gh } = setup();
  const both = await tracker.edit('#4', { title: ' New title ', body: 'New body' });
  assert.equal(both.id, '#4');
  assert.equal(both.title, 'New title');
  assert.equal(both.body, 'New body');
  await tracker.edit('#5', { body: '' });
  assert.equal((await tracker.get('#5')).title, 'Line blocker');
  assert.deepEqual(gh.commands(), ['gh issue edit 4 --title New title --body New body', 'gh issue edit 5 --body ']);
});

test('edit with a blank title is INVALID and runs no edit', async () => {
  const { tracker, gh } = setup();
  await rejectsWith(tracker.edit('#4', { title: ' ' }), 'INVALID');
  assert.deepEqual(gh.commands(), []);
});

test('remove deletes with gh issue delete --yes; withChildren deletes the sub-issues first', async () => {
  const { tracker, gh } = setup();
  assert.deepEqual(await tracker.remove('#4', { withChildren: false }), ['#4']);
  assert.deepEqual(await tracker.remove('#1', { withChildren: true }), ['#2', '#3', '#1']);
  assert.deepEqual(gh.commands(), ['gh issue delete 4 --yes', 'gh issue delete 2 --yes', 'gh issue delete 3 --yes', 'gh issue delete 1 --yes']);
  assert.deepEqual((await tracker.list()).map((t) => t.id), ['#5', '#6']);
});

test('remove without withChildren keeps the sub-issues as top-level issues', async () => {
  const { tracker } = setup();
  assert.deepEqual(await tracker.remove('#1', { withChildren: false }), ['#1']);
  assert.equal((await tracker.get('#2')).parentId, null);
});

test('remove by a non-admin is FAILED with a clear message; a missing issue is NOT_FOUND', async () => {
  const { tracker } = setup(ISSUES, { notAdmin: true });
  await rejectsWith(tracker.remove('#4', { withChildren: false }), 'FAILED', /Only repository admins can delete GitHub issues.*close it instead/);
  await rejectsWith(tracker.remove('#99', { withChildren: false }), 'NOT_FOUND');
});

test('removeParent unlinks the native parent with gh issue edit --remove-parent; the number stays', async () => {
  const { tracker, gh } = setup();
  const alone = await tracker.removeParent('#2');
  assert.equal(alone.id, '#2');
  assert.equal(alone.parentId, null);
  assert.deepEqual(gh.commands(), ['gh issue edit 2 --remove-parent']);
});

test('removeParent refuses an issue without a parent; a missing issue is NOT_FOUND', async () => {
  const { tracker, gh } = setup();
  await rejectsWith(tracker.removeParent('#1'), 'INVALID', /no parent/);
  await rejectsWith(tracker.removeParent('#99'), 'NOT_FOUND');
  assert.deepEqual(gh.commands(), []);
});
