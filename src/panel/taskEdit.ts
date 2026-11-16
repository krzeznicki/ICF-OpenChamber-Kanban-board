// Editing a task's title and description from the task modal: what the form starts with, and what
// it sends. A local file's heading, field lines and appended sections are not shown in the form;
// the tracker keeps them (localFormat.ts withDescription).
import { issueDescription } from '../core/localFormat.ts';
import type { Task, TaskEdit } from '../core/types.ts';
import type { TrackerKind } from './addTask.ts';

export type EditText = { title: string; body: string };

/** The form's starting values. */
export const editableText = (tracker: TrackerKind, task: Task): EditText => ({
  title: task.title,
  body: tracker === 'local' ? issueDescription(task.body) : task.body,
});

/** Only the changed fields (null: nothing to save), or the message for a blank title. */
export const editChanges = (from: EditText, draft: EditText): { changes: TaskEdit | null } | { error: string } => {
  const title = draft.title.trim();
  if (title === '') return { error: 'A title is required' };
  const changes: TaskEdit = {};
  if (title !== from.title.trim()) changes.title = title;
  if (draft.body !== from.body) changes.body = draft.body;
  return { changes: Object.keys(changes).length === 0 ? null : changes };
};

/** Whether closing the form would throw typed text away (the modal asks "Discard changes?" first). */
export const editDirty = (from: EditText, draft: EditText): boolean => draft.title !== from.title || draft.body !== from.body;

/**
 * Checked against the task as stored right before saving: a field about to be saved that changed
 * since the form opened (an agent edited it meanwhile) would be overwritten, so the save is refused
 * with this message. Null: safe to save. Fields not being saved may have changed; they are kept.
 */
export const editConflict = (tracker: TrackerKind, stored: Task, from: EditText, changes: TaskEdit): string | null => {
  const now = editableText(tracker, stored);
  const changed: string[] = [];
  if (changes.title !== undefined && now.title.trim() !== from.title.trim()) changed.push('title');
  if (changes.body !== undefined && now.body !== from.body) changed.push('description');
  if (changed.length === 0) return null;
  return `The ${changed.join(' and ')} changed since you opened the form (an agent may have edited the task); copy your text, cancel and edit again.`;
};
