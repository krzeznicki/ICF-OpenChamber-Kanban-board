// Which existing task may be linked under which existing parent (tracker setParent): shared by the
// task detail's pickers, the add form's "existing sub-tasks" and dropping a card onto a card.
// Pure: no DOM, so it runs under node:test. Mirrors what the trackers accept, so the UI never
// offers a link the service would refuse.
// Local tracker: a parent is a feature (spec.md); a ticket, or a feature without tickets, may move
// under another feature. GitHub: any issue may take any other, but never one of its own ancestors.
import type { Task } from '../core/types.ts';
import type { TrackerKind } from './addTask.ts';

/** True when `id` is `from` or one of its ancestors (following parentId through `tasks`). */
const isOrAbove = (id: string, from: string | null, tasks: readonly Task[]): boolean => {
  const seen = new Set<string>();
  for (let up = from; up !== null && !seen.has(up); up = tasks.find((t) => t.id === up)?.parentId ?? null) {
    if (up === id) return true;
    seen.add(up);
  }
  return false;
};

/** Local: what may become a ticket of another feature, a ticket or a feature without tickets (two levels only). */
const movableLocally = (child: Task, tasks: readonly Task[]): boolean =>
  child.kind === 'ticket' || !tasks.some((t) => t.parentId === child.id);

/** True when `child` may become a sub-task of `parent` (both open, not already linked so). */
export const canLinkUnder = (tracker: TrackerKind, child: Task, parent: Task, tasks: readonly Task[]): boolean => {
  if (child.id === parent.id || child.state === 'done' || parent.state === 'done') return false;
  if (child.parentId === parent.id) return false;
  if (tracker === 'local') return parent.kind === 'parent' && movableLocally(child, tasks);
  // GitHub: linking under a descendant would make a cycle.
  return !isOrAbove(child.id, parent.parentId, tasks);
};

/** Open parents `child` may be linked under, in board order. */
export const parentTargets = (tracker: TrackerKind, child: Task, tasks: readonly Task[]): Task[] =>
  tasks.filter((p) => canLinkUnder(tracker, child, p, tasks));

/** Existing tasks that may be linked under `parent` as its sub-tasks, in board order. */
export const childCandidates = (tracker: TrackerKind, parent: Task, tasks: readonly Task[]): Task[] =>
  tasks.filter((c) => canLinkUnder(tracker, c, parent, tasks));

/**
 * True when existing `child` may become a sub-task of a task not created yet (the add form), which
 * will go under `parentId` (null: none). Local: only a new feature (no parent) takes sub-tasks.
 * GitHub: the chosen parent and its ancestors would make a cycle.
 */
export const canLinkUnderNew = (tracker: TrackerKind, child: Task, parentId: string | null, tasks: readonly Task[]): boolean => {
  if (child.state === 'done') return false;
  if (tracker === 'local') return parentId === null && movableLocally(child, tasks);
  return !isOrAbove(child.id, parentId, tasks);
};

/** Existing tasks that may be linked under a task not created yet, in board order. */
export const newChildCandidates = (tracker: TrackerKind, parentId: string | null, tasks: readonly Task[]): Task[] =>
  tasks.filter((c) => canLinkUnderNew(tracker, c, parentId, tasks));

export type LinkChoice = { id: string; label: string; hint: string };

const linkChoice = (t: Task): LinkChoice => ({ id: t.id, label: t.title, hint: t.id });

/**
 * The task detail's two pickers: `parents` for "Parent" (move this task under one) and `children`
 * for "Link existing task" (make one a sub-task of this task). Empty hides the picker.
 */
export const linkChoices = (
  tracker: TrackerKind,
  task: Task,
  tasks: readonly Task[],
): { parents: LinkChoice[]; children: LinkChoice[] } => ({
  parents: parentTargets(tracker, task, tasks).map(linkChoice),
  children: childCandidates(tracker, task, tasks).map(linkChoice),
});

/**
 * Every link from the panel goes through this: `setParent` (api), then, when the task came back
 * with a new id (local: its file moved), `onMoved(from, to)` so whatever the panel keeps under the
 * old id follows it. The link stands even when that follow-up fails: `onError` reports it.
 */
export const followingSetParent =
  (
    setParent: (id: string, parentId: string) => Promise<Task>,
    onMoved: (from: string, to: string) => Promise<void>,
    onError: (from: string, to: string, error: unknown) => void,
  ) =>
  async (id: string, parentId: string): Promise<Task> => {
    const task = await setParent(id, parentId);
    if (task.id !== id) {
      try {
        await onMoved(id, task.id);
      } catch (e) {
        onError(id, task.id, e);
      }
    }
    return task;
  };

/** The confirm before linking (dropping a card onto a card): names both tasks; locally the move changes the id and drops blockers. */
export const linkConfirm = (tracker: TrackerKind, child: Task, parent: Task): { title: string; body: string } => ({
  title: `Make “${child.title}” a sub-task of “${parent.title}”?`,
  body:
    tracker === 'local'
      ? `${child.id} moves into the feature ${parent.id} as its next ticket: it gets a new id and its blockers (both ways) are dropped.`
      : `${child.id} becomes a sub-task of ${parent.id}, replacing its current parent if it has one.`,
});
