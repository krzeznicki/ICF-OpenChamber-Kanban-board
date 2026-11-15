// Which existing task may be linked under which existing parent (tracker setParent): shared by the
// task detail's pickers, the add form's "existing sub-tasks" and dropping a card onto a card.
// Pure: no DOM, so it runs under node:test. Mirrors what the trackers accept, so the UI never
// offers a link the service would refuse.
// Local tracker: a parent is a feature (spec.md); a ticket, or a feature without tickets, may move
// under another feature. GitHub: any issue may take any other, but never one of its own ancestors.
import type { Task } from '../core/types.ts';
import type { TrackerKind } from './addTask.ts';

/** True when `child` may become a sub-task of `parent` (both open, not already linked so). */
export const canLinkUnder = (tracker: TrackerKind, child: Task, parent: Task, tasks: readonly Task[]): boolean => {
  if (child.id === parent.id || child.state === 'done' || parent.state === 'done') return false;
  if (child.parentId === parent.id) return false;
  if (tracker === 'local') {
    if (parent.kind !== 'parent') return false;
    return child.kind === 'ticket' || !tasks.some((t) => t.parentId === child.id);
  }
  // GitHub: linking under a descendant would make a cycle.
  const seen = new Set<string>();
  for (let up: string | null = parent.parentId; up !== null && !seen.has(up); ) {
    if (up === child.id) return false;
    seen.add(up);
    up = tasks.find((t) => t.id === up)?.parentId ?? null;
  }
  return true;
};

/** Open parents `child` may be linked under, in board order. */
export const parentTargets = (tracker: TrackerKind, child: Task, tasks: readonly Task[]): Task[] =>
  tasks.filter((p) => canLinkUnder(tracker, child, p, tasks));

/** Existing tasks that may be linked under `parent` as its sub-tasks, in board order. */
export const childCandidates = (tracker: TrackerKind, parent: Task, tasks: readonly Task[]): Task[] =>
  tasks.filter((c) => canLinkUnder(tracker, c, parent, tasks));
