import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { editChanges, editConflict, editDirty, editableText } from '../src/panel/taskEdit.ts';

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

test('editConflict: a field being saved that changed since the form opened (an agent edited it) refuses the save', () => {
  const body = '# 01: Fix it\n\nWhat.\n\n**Status:** ready-for-agent\n';
  const opened = task('.scratch/a/issues/01-fix-it.md', { title: 'Fix it', body });
  const from = editableText('local', opened);
  // Unchanged since: saves.
  assert.equal(editConflict('local', opened, from, { body: 'New.' }), null);
  // Only the status line changed: the description is the same, so it still saves.
  const statusOnly = { ...opened, body: body.replace('ready-for-agent', 'needs-info') };
  assert.equal(editConflict('local', statusOnly, from, { body: 'New.' }), null);
  // The description changed: saving it would overwrite that.
  const agentEdited = { ...opened, body: body.replace('What.', 'What, more precisely.') };
  assert.match(editConflict('local', agentEdited, from, { body: 'New.' }) ?? '', /description changed since you opened the form/);
  // Saving only the title does not touch the changed description.
  assert.equal(editConflict('local', agentEdited, from, { title: 'Fix it now' }), null);
  // The title changed: saving a title refuses.
  const renamed = { ...opened, title: 'Fix it soon' };
  assert.match(editConflict('github', renamed, { title: 'Fix it', body }, { title: 'Fix it now' }) ?? '', /title changed since you opened the form/);
  assert.equal(editConflict('github', renamed, { title: 'Fix it', body }, { body: 'x' }), null);
});

test('editDirty: only a draft that differs from what the form opened with asks before it is discarded', () => {
  const from = { title: 'A', body: 'x' };
  assert.equal(editDirty(from, { title: 'A', body: 'x' }), false);
  assert.equal(editDirty(from, { title: 'B', body: 'x' }), true);
  assert.equal(editDirty(from, { title: 'A', body: 'x\n' }), true);
});
