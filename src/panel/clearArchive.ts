// "Clear archive": every archived task (archive.ts) is deleted for good, as the task modal's Delete
// would. Pure, so it runs under node:test; main.ts asks (ui/confirm.ts) and runs the plan.
import type { Task } from '../core/types.ts';
import type { TrackerKind } from './addTask.ts';
import { isArchived } from './archive.ts';

export type ClearDelete = { id: string; withChildren: boolean };
export type ClearPlan = { deletes: ClearDelete[]; skipped: string[] };

export const clearArchivePlan = (tracker: TrackerKind, tasks: readonly Task[], marks: { has: (id: string) => boolean }): ClearPlan => {
  const archived = tasks.filter((t) => isArchived(t, marks));
  const ids = new Set(archived.map((t) => t.id));
  const childrenOf = (id: string): Task[] => tasks.filter((t) => t.parentId === id);
  const deletes: ClearDelete[] = [];
  const skipped: string[] = [];
  if (tracker === 'local') {
    // A local feature is deleted with its whole folder: only when every sub-task listed goes too.
    const gone = new Set<string>();
    for (const t of archived) {
      if (t.kind !== 'parent') continue;
      if (childrenOf(t.id).every((c) => ids.has(c.id))) gone.add(t.id);
      else skipped.push(t.id);
    }
    for (const t of archived) {
      if (t.kind === 'parent') {
        if (gone.has(t.id)) deletes.push({ id: t.id, withChildren: true });
      } else if (t.parentId === null || !gone.has(t.parentId)) deletes.push({ id: t.id, withChildren: false });
    }
    return { deletes, skipped };
  }
  // GitHub: one `gh issue delete` per archived issue; sub-issues first, kept ones become top-level.
  const parents = archived.filter((t) => childrenOf(t.id).length > 0);
  const rest = archived.filter((t) => childrenOf(t.id).length === 0);
  return { deletes: [...rest, ...parents].map((t) => ({ id: t.id, withChildren: false })), skipped };
};

export type ClearResult = { deleted: string[]; failed: { id: string; error: string }[] };

/** Runs the plan's deletes one after another; a failed one (e.g. not a GitHub admin) is noted and the rest still run. */
export const runClearArchive = async (
  deletes: readonly ClearDelete[],
  remove: (id: string, withChildren: boolean) => Promise<string[]>,
): Promise<ClearResult> => {
  const out: ClearResult = { deleted: [], failed: [] };
  for (const d of deletes) {
    try {
      out.deleted.push(...(await remove(d.id, d.withChildren)));
    } catch (e) {
      out.failed.push({ id: d.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
};
