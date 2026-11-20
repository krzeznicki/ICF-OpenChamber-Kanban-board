import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { canPublish, publishConfirm, publishedMessage } from '../src/panel/taskPublish.ts';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  kind: id.endsWith('spec.md') ? 'parent' : 'ticket',
  title: id,
  body: '',
  state: 'needs-triage',
  type: null,
  parentId: null,
  blockedBy: [],
  url: null,
  updatedAt: 0,
  claimed: false,
  source: id.startsWith('#') ? 'github' : 'local',
  ...over,
});

test('"Publish to GitHub" shows only on an open local task of a project with a GitHub source', () => {
  const local = task('.scratch/f/spec.md');
  assert.equal(canPublish(local, ['local', 'github']), true);
  assert.equal(canPublish(local, ['github', 'local']), true);
  assert.equal(canPublish(local, ['local']), false, 'no GitHub source');
  assert.equal(canPublish(task('#4'), ['local', 'github']), false, 'already on GitHub');
  assert.equal(canPublish(task('.scratch/f/spec.md', { state: 'done' }), ['local', 'github']), false, 'done');
});

test('the confirm says it goes public, counts the sub-issues and that the local files close', () => {
  const spec = task('.scratch/f/spec.md', { title: 'Login' });
  const tasks = [spec, task('.scratch/f/issues/01-a.md', { parentId: spec.id }), task('.scratch/f/issues/02-b.md', { parentId: spec.id })];
  const withSubs = publishConfirm(spec, tasks);
  assert.equal(withSubs.title, 'Publish “Login” to GitHub?');
  assert.match(withSubs.body, /an issue with 2 sub-issues/);
  assert.match(withSubs.body, /everyone who can see the repository/);
  assert.match(withSubs.body, /local files are closed \(Done\) with a link/);
  assert.equal(withSubs.label, 'Publish');

  const alone = publishConfirm(tasks[1]!, tasks);
  assert.match(alone.body, /creates an issue in/);
  assert.match(alone.body, /local file is closed \(Done\) with a link/);
});

test('the toast names the new issue and how many sub-issues it got', () => {
  const issue = task('#7');
  assert.equal(publishedMessage({ issue, subIssues: [] }), 'Published as #7');
  assert.equal(publishedMessage({ issue, subIssues: [{ task: task('#8') }] }), 'Published as #7 with 1 sub-issue');
  assert.equal(publishedMessage({ issue, subIssues: [{ task: task('#8') }, { task: task('#9') }] }), 'Published as #7 with 2 sub-issues');
});
