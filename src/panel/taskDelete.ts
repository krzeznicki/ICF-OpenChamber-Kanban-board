// Deleting a task from the task modal: the confirm's wording and answers. Pure, so it runs under
// node:test; edit.ts asks (ui/confirm.ts) and calls the service, which also drops the task's
// session links and queue entry.
import type { Task } from '../core/types.ts';
import type { TrackerKind } from './addTask.ts';

/** `all` deletes the sub-tasks too (withChildren), `one` only the task. Fits ui/confirm.ts Choice (not imported: it pulls in the DOM). */
export type DeleteChoice = { id: 'all' | 'one'; label: string; variant: 'destructive' | 'secondary' };
export type DeleteConfirm = { title: string; body: string; choices: DeleteChoice[] };

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export const deleteConfirm = (tracker: TrackerKind, task: Task, tasks: readonly Task[]): DeleteConfirm => {
  const n = tasks.filter((t) => t.parentId === task.id).length;
  const title = `Delete “${task.title}”?`;
  if (tracker === 'local') {
    if (task.kind !== 'parent') {
      return { title, body: `The file ${task.id} is deleted. This cannot be undone from the board.`, choices: [{ id: 'one', label: 'Delete', variant: 'destructive' }] };
    }
    // A feature's tickets cannot stay without it: the whole folder goes (localTracker remove).
    const folder = task.id.replace(/spec\.md$/, '');
    const subs = n > 0 ? `, including ${plural(n, 'sub-task')} on the board and any older done ones` : '';
    return {
      title,
      body: `The folder ${folder} is deleted with spec.md and all its sub-tasks${subs}. This cannot be undone from the board.`,
      choices: [{ id: 'all', label: n > 0 ? 'Delete with sub-tasks' : 'Delete', variant: 'destructive' }],
    };
  }
  const base = `${task.id} is deleted on GitHub for good; only repository admins can delete issues (closing keeps it).`;
  if (n === 0) return { title, body: base, choices: [{ id: 'one', label: 'Delete', variant: 'destructive' }] };
  return {
    title,
    body: `${base} It has ${plural(n, 'sub-issue')}; kept, they become top-level issues.`,
    choices: [
      { id: 'all', label: 'Delete with sub-issues', variant: 'destructive' },
      { id: 'one', label: 'Delete only this issue', variant: 'secondary' },
    ],
  };
};
