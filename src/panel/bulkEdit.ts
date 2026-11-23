// Explicit field edits, not column moves: never starts/stops agents or changes queue/session links.
import { errorMessage, type Task, type TaskState } from '../core/types.ts';
import type { Api } from './api.ts';

export type BulkDraft = { state: TaskState | null; type: string | null; withChildren: boolean };
export type BulkFailure = { id: string; field: 'read' | 'type' | 'state'; message: string };
export type BulkPlan = {
  selectedIds: readonly string[];
  typeIds: readonly string[];
  closeIds: readonly string[];
  children: ReadonlyMap<string, readonly string[]>;
  draft: BulkDraft;
};
export type BulkResult = { succeeded: string[]; failures: BulkFailure[] };
export type BulkProgress = { completed: number; total: number };
export type BulkApi = Pick<Api, 'get' | 'setType' | 'setState'>;

export const planBulk = (tasks: readonly Task[], ids: readonly string[], draft: BulkDraft): BulkPlan => {
  const selectedIds = [...new Set(ids)];
  const known = new Set(tasks.map(t => t.id));
  for (const id of selectedIds) if (!known.has(id)) throw new Error(`Task not found: ${id}`);
  const children = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.parentId !== null) children.set(task.parentId, [...(children.get(task.parentId) ?? []), task.id]);
  }
  const closeIds: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Cycle in sub-task hierarchy.');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of children.get(id) ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
    closeIds.push(id);
  };
  if (draft.state === 'done' && draft.withChildren) for (const id of selectedIds) visit(id);
  return { selectedIds, typeIds: draft.type === null ? [] : selectedIds, closeIds, children, draft: { ...draft } };
};

export const runBulk = async (plan: BulkPlan, api: BulkApi, progress: (value: BulkProgress) => void, retryIds?: readonly string[]): Promise<BulkResult> => {
  const succeeded: string[] = [];
  const failures: BulkFailure[] = [];
  const ids = (plan.closeIds.length ? plan.closeIds : plan.selectedIds).filter(id => retryIds === undefined || retryIds.includes(id));
  for (const id of ids) {
    let field: BulkFailure['field'] = 'read';
    try {
      const task = await api.get(id);
      field = 'type';
      if (plan.typeIds.includes(id) && plan.draft.type !== null && task.type !== plan.draft.type) await api.setType(id, plan.draft.type);
      field = 'state';
      if (plan.closeIds.length && (plan.children.get(id) ?? []).some(child => failures.some(f => f.id === child))) {
        throw new Error('A sub-task could not be closed. Retry its closure before closing this task.');
      }
      if (plan.draft.state !== null && task.state !== plan.draft.state) await api.setState(id, plan.draft.state);
      succeeded.push(id);
    } catch (e) {
      failures.push({ id, field, message: errorMessage(e) });
    }
    progress({ completed: succeeded.length + failures.length, total: ids.length });
  }
  return { succeeded, failures };
};
