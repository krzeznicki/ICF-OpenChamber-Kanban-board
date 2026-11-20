import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { ApiError, listedTasks } from '../src/panel/api.ts';
import { sourceKind } from '../src/panel/sources.ts';

const task = (id: string, source: string): Task => ({
  id, kind: 'ticket', title: id, body: '', state: 'needs-triage', type: null, parentId: null,
  blockedBy: [], url: null, updatedAt: 0, claimed: false, source,
});

test('sourceKind: a task goes by its own source; an unknown source falls back to the primary', () => {
  assert.equal(sourceKind(task('#1', 'github'), 'local'), 'github');
  assert.equal(sourceKind(task('.scratch/a/spec.md', 'local'), 'github'), 'local');
  assert.equal(sourceKind(task('jira:X-1', 'jira'), 'github'), 'github');
});

test('listedTasks: the tasks when every source answered', () => {
  const tasks = [task('#1', 'github')];
  assert.deepEqual(listedTasks({ tasks, errors: [] }), tasks);
  assert.deepEqual(listedTasks({ tasks }), tasks);
});

// Until the board shows a banner for a failed source, a partial list would prune the archive marks
// and order of that source's tasks, so the load fails as it did with one tracker.
test('listedTasks: a failed source fails the load with its code and message', () => {
  assert.throws(
    () =>
      listedTasks({
        tasks: [task('.scratch/a/spec.md', 'local')],
        errors: [{ source: 'github', code: 'GH_AUTH', message: 'gh is not logged in', availability: 'needs-login' }],
      }),
    (e: unknown) => e instanceof ApiError && e.code === 'GH_AUTH' && /github: gh is not logged in/.test(e.message),
  );
});
