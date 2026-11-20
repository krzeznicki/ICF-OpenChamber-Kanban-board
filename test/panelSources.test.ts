import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
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
