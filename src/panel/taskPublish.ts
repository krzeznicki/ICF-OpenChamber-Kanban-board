// "Publish to GitHub" in the task modal (core/publish.ts does the work in the service): when it is
// offered, the confirm's wording and the toast after. Pure, so it runs under node:test.
import type { Task } from '../core/types.ts';

/** An open local task, in a project that has a GitHub source. */
export const canPublish = (task: Task, sources: readonly string[]): boolean =>
  task.source === 'local' && task.state !== 'done' && sources.includes('github');

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export const publishConfirm = (task: Task, tasks: readonly Task[]): { title: string; body: string; label: string } => {
  const n = task.kind === 'parent' ? tasks.filter((t) => t.parentId === task.id).length : 0;
  const what = n > 0 ? `an issue with ${plural(n, 'sub-issue')}` : 'an issue';
  const files = n > 0 ? 'Its local files are' : 'The local file is';
  return {
    title: `Publish “${task.title}” to GitHub?`,
    body:
      `This creates ${what} in the project's GitHub Issues, visible to everyone who can see the repository. ` +
      `${files} closed (Done) with a link to the issue. If GitHub fails half way, nothing local is closed.`,
    label: 'Publish',
  };
};

export const publishedMessage = (result: { issue: Pick<Task, 'id'>; subIssues: readonly unknown[] }): string => {
  const n = result.subIssues.length;
  return n === 0 ? `Published as ${result.issue.id}` : `Published as ${result.issue.id} with ${plural(n, 'sub-issue')}`;
};
