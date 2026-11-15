// What dropping a card on a column means. Pure: no DOM, no host, so it runs under node:test.
// Only Backlog, Ready and Done are written to the repo; In Progress starts an agent and Review
// comes from the agent's session alone.
import type { Task, TaskState } from '../core/types.ts';
import type { Column } from './columns.ts';

export type Move =
  | { kind: 'setState'; state: TaskState }
  | { kind: 'start' }
  | { kind: 'close'; askChildren: boolean }
  | { kind: 'none'; reason: string };

export const planMove = (task: Task, from: Column, to: Column, openChildren: number): Move => {
  if (from === to) return { kind: 'none', reason: 'The task is already in this column' };
  switch (to) {
    case 'backlog':
      return { kind: 'setState', state: 'needs-triage' };
    case 'ready':
      return { kind: 'setState', state: 'ready-for-agent' };
    case 'in_progress':
      // A closed task is reopened first (Backlog or Ready), so a start never works on a done issue.
      return task.state === 'done' || from === 'done'
        ? { kind: 'none', reason: 'Reopen the task (move it to Backlog or Ready) before starting it' }
        : { kind: 'start' };
    case 'review':
      return { kind: 'none', reason: "Review is set by the agent's session" };
    case 'done':
      return { kind: 'close', askChildren: openChildren > 0 };
  }
};

/** Listed sub-tasks of `task` that are not done yet. */
export const openChildren = (task: Task, tasks: readonly Task[]): number =>
  tasks.filter((t) => t.parentId === task.id && t.state !== 'done').length;

const BASE_TYPES = ['enhancement', 'bug', 'chore', 'research'];

/** Types offered in the selects: the base ones (settings' `types`), then every other type already used, sorted. */
export const taskTypes = (tasks: readonly Task[], base: readonly string[] = BASE_TYPES): string[] => {
  const used = new Set<string>();
  for (const t of tasks) if (t.type !== null && t.type.trim() !== '' && !base.includes(t.type)) used.add(t.type);
  return [...base, ...[...used].sort()];
};
