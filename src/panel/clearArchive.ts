// "Clear archive": every archived task (archive.ts) is deleted for good, as the task modal's Delete
// would: what goes, the confirm's wording and the run of deletes. Pure, so it runs under node:test;
// main.ts asks (ui/confirm.ts), runs the plan and reloads.
import type { Task } from '../core/types.ts';
import type { TrackerKind } from './addTask.ts';
import { isArchived } from './archive.ts';

export type ClearDelete = { id: string; withChildren: boolean };
/** `count`: the listed archived tasks the deletes take; `skipped`: archived local features kept. */
export type ClearPlan = { deletes: ClearDelete[]; skipped: string[]; count: number };

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Local: a ticket goes alone; a feature goes with its whole folder (localTracker remove), so only
 * when every sub-task the board lists is archived too, else it is kept. GitHub: one delete per
 * archived issue, sub-issues before their parent; sub-issues not archived become top-level.
 */
export const clearArchivePlan = (tracker: TrackerKind, tasks: readonly Task[], marks: { has: (id: string) => boolean }): ClearPlan => {
  const archived = tasks.filter((t) => isArchived(t, marks));
  const ids = new Set(archived.map((t) => t.id));
  const children = new Map<string, Task[]>();
  for (const t of tasks) if (t.parentId !== null) children.set(t.parentId, [...(children.get(t.parentId) ?? []), t]);
  const hasChildren = (id: string): boolean => (children.get(id)?.length ?? 0) > 0;
  if (tracker === 'local') {
    const skipped = archived.filter((t) => t.kind === 'parent' && !(children.get(t.id) ?? []).every((c) => ids.has(c.id))).map((t) => t.id);
    const gone = new Set(archived.filter((t) => t.kind === 'parent' && !skipped.includes(t.id)).map((t) => t.id));
    const deletes: ClearDelete[] = [];
    for (const t of archived) {
      if (gone.has(t.id)) deletes.push({ id: t.id, withChildren: true });
      else if (t.kind !== 'parent' && (t.parentId === null || !gone.has(t.parentId))) deletes.push({ id: t.id, withChildren: false });
    }
    return { deletes, skipped, count: archived.length - skipped.length };
  }
  const ordered = [...archived.filter((t) => !hasChildren(t.id)), ...archived.filter((t) => hasChildren(t.id))];
  return { deletes: ordered.map((t) => ({ id: t.id, withChildren: false })), skipped: [], count: archived.length };
};

/** The confirm's title and body; null when nothing would be deleted. */
export const clearConfirm = (tracker: TrackerKind, plan: ClearPlan): { title: string; body: string } | null => {
  if (plan.deletes.length === 0) return null;
  const where =
    tracker === 'local'
      ? 'Their files in .scratch/ are deleted; a feature goes with its whole folder, including done sub-tasks older than 30 days the board no longer lists.'
      : 'Their issues are deleted on GitHub (only repository admins can delete issues); sub-issues not archived stay as top-level issues.';
  const k = plan.skipped.length;
  const kept = k > 0 ? ` ${plural(k, 'archived feature')} with sub-tasks still on the board stay${k === 1 ? 's' : ''}.` : '';
  return { title: `Delete ${plural(plan.count, 'archived task')} for good?`, body: `${where}${kept} This cannot be undone from the board.` };
};

export type ClearResult = { deleted: string[]; failed: { id: string; error: unknown }[] };

/** Runs the plan's deletes one after another; a failed one (e.g. not a GitHub admin) is noted and the rest still run. */
export const runClearArchive = async (
  deletes: readonly ClearDelete[],
  remove: (id: string, withChildren: boolean) => Promise<string[]>,
): Promise<ClearResult> => {
  const out: ClearResult = { deleted: [], failed: [] };
  for (const d of deletes) {
    try {
      out.deleted.push(...(await remove(d.id, d.withChildren)));
    } catch (error) {
      out.failed.push({ id: d.id, error });
    }
  }
  return out;
};
