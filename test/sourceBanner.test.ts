import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskState } from '../src/core/types.ts';
import type { SourceError, SourceInfo } from '../src/panel/api.ts';
import { archiveWriteJob, reconcileArchived } from '../src/panel/archive.ts';
import { pruneOrder } from '../src/panel/order.ts';
import { listedBoard, sourceBanners } from '../src/panel/sourceBanner.ts';

const task = (id: string, source: string, state: TaskState = 'needs-triage'): Task => ({
  id, kind: 'ticket', title: id, body: '', state, type: null, parentId: null,
  blockedBy: [], url: null, updatedAt: 0, claimed: false, source,
});

const ALL = { create: true, subtasks: true, blockedBy: true, claim: true, delete: true };
const SOURCES: SourceInfo[] = [
  { id: 'local', label: 'Local', capabilities: ALL },
  { id: 'github', label: 'GitHub', capabilities: ALL },
];

const down: SourceError = { source: 'github', code: 'FAILED', message: 'could not resolve host api.github.com', availability: 'unavailable' };
const loggedOut: SourceError = {
  source: 'github', code: 'GH_AUTH', message: 'gh is not logged in to GitHub: run `gh auth login`', availability: 'needs-login',
};

test('sourceBanners: none when every source listed', () => {
  assert.deepEqual(sourceBanners([], SOURCES), []);
});

test('sourceBanners: an unavailable source names its label, its message and offers Try again', () => {
  assert.deepEqual(sourceBanners([down], SOURCES), [
    { source: 'github', tone: 'warning', title: 'GitHub unavailable', body: 'could not resolve host api.github.com', action: 'Try again' },
  ]);
});

test('sourceBanners: a source that needs a login has its own text', () => {
  const [b] = sourceBanners([loggedOut], SOURCES);
  assert.equal(b?.title, 'GitHub needs a login');
  assert.equal(b?.body, 'Log in, then try again: gh is not logged in to GitHub: run `gh auth login`');
  assert.equal(b?.action, 'Try again');
});

test('sourceBanners: a source the panel does not know is named by its id', () => {
  const [b] = sourceBanners([{ ...down, source: 'jira' }], SOURCES);
  assert.equal(b?.title, 'jira unavailable');
});

test('sourceBanners: a config warning (an unknown source skipped) gets its own banner after the failed sources', () => {
  const warning = 'Unknown source "jira" under ## Additional sources in docs/agents/issue-tracker.md is skipped';
  const banners = sourceBanners([down], SOURCES, [warning]);
  assert.equal(banners.length, 2);
  assert.equal(banners[1]?.title, 'A source in issue-tracker.md was skipped');
  assert.equal(banners[1]?.body, warning);
});

test('listedBoard: the tasks of the sources that listed, and nothing unlisted when all answered', () => {
  const tasks = [task('.scratch/a/spec.md', 'local'), task('#1', 'github')];
  const r = listedBoard({ tasks, errors: [] });
  assert.deepEqual(r.tasks, tasks);
  assert.deepEqual(r.errors, []);
  assert.equal(r.unlisted('#7'), false);
  assert.deepEqual(listedBoard({ tasks }).errors, []);
});

test('listedBoard: ids of a failed source count as unlisted; ids of a working one do not', () => {
  const r = listedBoard({ tasks: [task('.scratch/a/spec.md', 'local')], errors: [down] });
  assert.deepEqual(r.errors, [down]);
  assert.equal(r.unlisted('#7'), true);
  assert.equal(r.unlisted('7'), true);
  assert.equal(r.unlisted('.scratch/gone/spec.md'), false);
  const localDown = listedBoard({ tasks: [task('#1', 'github')], errors: [{ ...down, source: 'local' }] });
  assert.equal(localDown.unlisted('.scratch/a/spec.md'), true);
  assert.equal(localDown.unlisted('#2'), false);
});

// A GitHub outage must not wipe the archive marks and order of GitHub's tasks.
test('a failed source keeps its archive marks and order; a working source is pruned', () => {
  const r = listedBoard({ tasks: [task('.scratch/a/spec.md', 'local', 'done')], errors: [loggedOut] });
  const marks = new Map([['.scratch/a/spec.md', 1], ['.scratch/gone/spec.md', 2], ['#4', 3]]);
  const fixed = reconcileArchived(marks, r.tasks, r.unlisted);
  assert.deepEqual([...fixed.marks], [['.scratch/a/spec.md', 1], ['#4', 3]]);
  assert.equal(fixed.changed, true);
  assert.deepEqual(pruneOrder(['#4', '.scratch/gone/spec.md', '.scratch/a/spec.md'], r.tasks, r.unlisted), ['#4', '.scratch/a/spec.md']);
});

test('an archive write while a source is down keeps that source\'s marks', async () => {
  const r = listedBoard({ tasks: [task('.scratch/a/spec.md', 'local', 'done')], errors: [down] });
  let saved: ReadonlyMap<string, number> | null = null;
  const job = archiveWriteJob(
    { marks: new Map([['.scratch/a/spec.md', 5]]), removed: new Map(), tasks: r.tasks, unlisted: r.unlisted },
    { load: async () => new Map([['#4', 3], ['.scratch/gone/spec.md', 2]]), save: async (m) => void (saved = m) },
    () => {},
  );
  await job();
  assert.deepEqual([...(saved ?? new Map())].sort(), [['#4', 3], ['.scratch/a/spec.md', 5]]);
});
