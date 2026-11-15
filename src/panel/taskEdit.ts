// Editing a task's title and description from the task modal: what the form starts with, and what
// it sends. A local file's heading, field lines and appended sections are not shown in the form;
// the tracker keeps them (localFormat.ts withDescription).
import { issueDescription } from '../core/localFormat.ts';
import type { Task, TaskEdit } from '../core/types.ts';

export type EditText = { title: string; body: string };

/** The form's starting values. */
export const editableText = (tracker: 'local' | 'github', task: Task): EditText => ({
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
