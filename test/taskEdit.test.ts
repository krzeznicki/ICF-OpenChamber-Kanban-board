import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { editChanges, editableText } from '../src/panel/taskEdit.ts';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  kind: 'ticket',
  title: id,
  body: '',
  state: 'needs-triage',
  type: null,
  parentId: null,
  blockedBy: [],
  url: null,
  updatedAt: 0,
  claimed: false,
  ...over,
});

test('editableText: a local task edits its description without heading, fields and comments; GitHub its body', () => {
  const body = '# 01: Fix it\n\nWhat.\n\n**Status:** ready-for-agent\n\n## Comments\n\nhi\n';
  assert.deepEqual(editableText('local', task('.scratch/a/issues/01-fix-it.md', { title: 'Fix it', body })), { title: 'Fix it', body: 'What.' });
  assert.deepEqual(editableText('github', task('#3', { title: 'Fix it', body })), { title: 'Fix it', body });
});

test('editChanges sends only what changed; nothing changed is null; a blank title is an error', () => {
  const from = { title: 'A', body: 'x' };
  assert.deepEqual(editChanges(from, { title: ' B ', body: 'x' }), { changes: { title: 'B' } });
  assert.deepEqual(editChanges(from, { title: 'A', body: 'y\n' }), { changes: { body: 'y\n' } });
  assert.deepEqual(editChanges(from, { title: 'A ', body: 'x' }), { changes: null });
  assert.deepEqual(editChanges(from, { title: '  ', body: 'y' }), { error: 'A title is required' });
});
