// The manual card order (dragging a card up or down its column). Pure, so it runs under node:test.
// One list of task ids per project in the panel's storage (taskOrder:<projectId>), so it works the
// same for local and GitHub trackers and never touches the repo. Only the relative order of tasks
// sharing a column matters; tasks without a position keep the tracker's order, after the ordered ones.
import type { Task } from '../core/types.ts';

/** The tasks sorted by the stored order; groupTasks then keeps that order within each column. */
export const applyOrder = (tasks: readonly Task[], order: readonly string[]): Task[] => {
  const rank = new Map(order.map((id, i) => [id, i]));
  const ranked = tasks.filter((t) => rank.has(t.id)).sort((a, b) => (rank.get(a.id) as number) - (rank.get(b.id) as number));
  return [...ranked, ...tasks.filter((t) => !rank.has(t.id))];
};

/**
 * The order after `taskId` was dropped in its column before `before` (null: last). `column` is the
 * column's ids as drawn; all of them get a position (the drop is exact even among unordered cards),
 * as one block where the column's first stored task was. Other tasks keep their places.
 */
export const reorder = (order: readonly string[], column: readonly string[], taskId: string, before: string | null): string[] => {
  const rest = column.filter((id) => id !== taskId);
  const at = before === null || before === taskId ? -1 : rest.indexOf(before);
  const block =
    before === taskId ? [...column] : at === -1 ? [...rest, taskId] : [...rest.slice(0, at), taskId, ...rest.slice(at)];
  const inColumn = new Set(column);
  const first = order.findIndex((id) => inColumn.has(id));
  const others = order.filter((id) => !inColumn.has(id));
  const cut = first === -1 ? others.length : order.slice(0, first).filter((id) => !inColumn.has(id)).length;
  return [...others.slice(0, cut), ...block, ...others.slice(cut)];
};

/** Ids kept per project (one storage value holds at most 64 KiB; local ids are paths). */
export const ORDER_MAX = 500;

/** The stored ids, read defensively: non-empty strings, the first of duplicates, at most ORDER_MAX. */
export const parseOrder = (raw: unknown): string[] =>
  Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === 'string' && id !== ''))].slice(0, ORDER_MAX) : [];

/** A task got a new id (a local link moved its file): it keeps its place under the new id. */
export const renameInOrder = (order: readonly string[], from: string, to: string): string[] =>
  order.includes(from) ? order.filter((id) => id !== to).map((id) => (id === from ? to : id)) : [...order];

/**
 * Before a write: ids of tasks the tracker no longer lists (deleted, long-closed issues) are dropped.
 * `unlisted(id)` keeps the ids of a source that failed to list (sourceBanner.ts's listedBoard).
 */
export const pruneOrder = (order: readonly string[], tasks: readonly Task[], unlisted: (id: string) => boolean = () => false): string[] => {
  const listed = new Set(tasks.map((t) => t.id));
  return order.filter((id) => listed.has(id) || unlisted(id));
};

/** Deleted tasks lose their places (their ids could otherwise linger until the next reorder). */
export const forgetInOrder = (order: readonly string[], ids: readonly string[]): string[] => {
  const gone = new Set(ids);
  return order.filter((id) => !gone.has(id));
};
