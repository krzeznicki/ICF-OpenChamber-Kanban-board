// Public action preview and executor. UI confirms a subset; no silent skips or swallowed errors.
import { errorMessage, type Task } from '../core/types.ts';
import type { Api, SourceInfo } from './api.ts';
import type { Column } from './columns.ts';
import type { ActionResult } from './actionResult.ts';
import { planBulk, type BulkProgress } from './bulkEdit.ts';

export type BulkAction =
  | { kind: 'move'; to: Column }
  | { kind: 'label'; label: string; mode: 'add' | 'remove' }
  | { kind: 'parent'; parentId: string }
  | { kind: 'unparent' }
  | { kind: 'blocker'; blockerId: string }
  | { kind: 'start' | 'queue' | 'archive' | 'restore' }
  | { kind: 'delete'; withChildren: boolean }
  | { kind: 'copy'; format: 'titles' | 'links' };
export type ActionContext = {
  sources: readonly SourceInfo[];
  archived: ReadonlySet<string>;
  busy: ReadonlySet<string>;
  complete: boolean;
};
export type ActionPreview = { eligible: string[]; excluded: { id: string; reason: string }[]; additional: string[] };
export type BulkActionOutcome = {
  succeeded: string[]; failures: { id: string; message: string }[];
  pending: { id: string; message: string }[]; remapped: { from: string; to: string }[];
};
export type ActionDeps = {
  api: Pick<Api, 'get' | 'changeLabel' | 'addBlocker' | 'setParent' | 'removeParent' | 'remove'>;
  tasks(): readonly Task[];
  context(): ActionContext;
  move(id: string, to: Column): Promise<ActionResult>;
  start(id: string, mode: 'start' | 'queue'): Promise<ActionResult>;
  archive(ids: readonly string[], restore: boolean): Promise<void>;
  remap(from: string, to: string): Promise<void>;
  deleted(ids: readonly string[]): Promise<void>;
  copy(text: string): Promise<void>;
};

export const previewAction = (action: BulkAction, tasks: readonly Task[], selected: readonly string[], context: ActionContext): ActionPreview => {
  const out: ActionPreview = { eligible: [], excluded: [], additional: [] };
  const byId = new Map(tasks.map(t => [t.id, t]));
  const relation = action.kind === 'parent' ? action.parentId : action.kind === 'blocker' ? action.blockerId : null;
  const reason = (task: Task): string | null => {
    if (action.kind === 'copy') return null;
    if (!context.complete) return 'Task sources are not fully loaded. Refresh first.';
    const seen = new Set<string>();
    for (let at: string | null = task.id; at && !seen.has(at); at = byId.get(at)?.parentId ?? null) {
      if (context.busy.has(at)) return 'This task or its parent is being changed.';
      seen.add(at);
    }
    const cap = context.sources.find(s => s.id === task.source)?.capabilities;
    if (action.kind === 'label' && !cap?.labels) return 'This source does not support labels.';
    if (action.kind === 'delete' && !cap?.delete) return 'This source does not support deletion.';
    if (action.kind === 'blocker' && !cap?.blockedBy) return 'This source does not support blockers.';
    if ((action.kind === 'parent' || action.kind === 'unparent') && !cap?.subtasks) return 'This source does not support parent changes.';
    if (action.kind === 'unparent' && task.parentId === null) return 'This task has no parent.';
    if ((action.kind === 'start' || action.kind === 'queue' || (action.kind === 'move' && action.to === 'in_progress')) && task.state === 'done') return 'Reopen this task before starting it.';
    if (action.kind === 'move' && action.to === 'review') return 'Review is set by the agent session.';
    if (action.kind === 'archive' && (task.state !== 'done' || context.archived.has(task.id))) return 'Only completed, unarchived tasks can be archived.';
    if (action.kind === 'restore' && !context.archived.has(task.id)) return 'This task is not archived.';
    if (relation !== null) {
      const target = byId.get(relation);
      if (!target) return 'Choose an existing target task.';
      if (selected.includes(relation)) return 'The target must be outside the selected group.';
      if (target.source !== task.source) return 'Tasks from different sources cannot be linked.';
      if (action.kind === 'parent') {
        if (task.source === 'local' && (target.kind !== 'parent' || tasks.some(t => t.parentId === task.id))) return 'Local tasks can only move under a feature and cannot carry their own sub-tasks.';
        const visited = new Set<string>();
        for (let p: string | null = target.id; p && !visited.has(p); p = byId.get(p)?.parentId ?? null) {
          if (p === task.id) return 'This parent would create a cycle.';
          visited.add(p);
        }
      }
      if (action.kind === 'blocker' && task.source === 'local' && (task.kind !== 'ticket' || target.kind !== 'ticket' || task.parentId !== target.parentId)) return 'Local blockers must be tickets in the same feature.';
    }
    return null;
  };
  for (const id of new Set(selected)) {
    const task = byId.get(id);
    const why = task ? reason(task) : 'Task is no longer listed.';
    if (why) out.excluded.push({ id, reason: why }); else out.eligible.push(id);
  }
  if (action.kind === 'delete' && action.withChildren && out.eligible.length) {
    try {
      const plan = planBulk(tasks, out.eligible, { state: 'done', type: null, withChildren: true });
      if (plan.closeIds.some(id => context.busy.has(id))) throw new Error('A sub-task is being changed.');
      out.additional = plan.closeIds.filter(id => !selected.includes(id));
    } catch (e) {
      out.excluded.push(...out.eligible.map(id => ({ id, reason: errorMessage(e) })));
      out.eligible = [];
    }
  }
  return out;
};

export const runAction = async (action: BulkAction, ids: readonly string[], deps: ActionDeps, progress: (p: BulkProgress) => void = () => {}): Promise<BulkActionOutcome> => {
  const out: BulkActionOutcome = { succeeded: [], failures: [], pending: [], remapped: [] };
  const preview = previewAction(action, deps.tasks(), ids, deps.context());
  out.failures.push(...preview.excluded.map(f => ({ id: f.id, message: f.reason })));
  const recursive = action.kind === 'delete' && action.withChildren;
  const plan = recursive ? planBulk(deps.tasks(), preview.eligible, { state: 'done', type: null, withChildren: true }) : null;
  const targets = plan?.closeIds ?? preview.eligible;
  if (action.kind === 'copy' || action.kind === 'archive' || action.kind === 'restore') {
    try {
      if (!targets.length) return out;
      if (action.kind === 'copy') {
        const tasks = await Promise.all(targets.map(id => deps.api.get(id)));
        await deps.copy(tasks.map(t => action.format === 'titles' ? t.title : t.url ?? t.id).join('\n'));
      } else await deps.archive(targets, action.kind === 'restore');
      out.succeeded.push(...targets);
    } catch (e) { out.failures.push(...targets.map(id => ({ id, message: errorMessage(e) }))); }
    progress({ completed: targets.length, total: targets.length });
    return out;
  }
  for (const original of targets) {
    let id = original;
    try {
      if (plan && (plan.children.get(id) ?? []).some(child => out.failures.some(f => f.id === child))) throw new Error('A sub-task could not be deleted; its parent was kept.');
      const task = await deps.api.get(id);
      let next: Task | null = null;
      let result: ActionResult | null = null;
      switch (action.kind) {
        case 'label': await deps.api.changeLabel(id, action.label, action.mode); break;
        case 'blocker': await deps.api.addBlocker(id, action.blockerId); break;
        case 'parent': if (task.parentId !== action.parentId) next = await deps.api.setParent(id, action.parentId); break;
        case 'unparent': if (task.parentId !== null) next = await deps.api.removeParent(id); break;
        case 'move': result = await deps.move(id, action.to); break;
        case 'start': case 'queue': result = await deps.start(id, action.kind); break;
        case 'delete': {
          // Leaves first; never let a recursive server call delete newly added, unconfirmed children.
          if (plan && task.source === 'github' && task.childCount !== 0) throw new Error('Sub-tasks changed since confirmation. Refresh before deleting.');
          const deleted = await deps.api.remove(id, false);
          await deps.deleted(deleted);
          break;
        }
      }
      if (next && next.id !== id) {
        out.remapped.push({ from: id, to: next.id });
        id = next.id;
        await deps.remap(original, id);
      }
      if (result?.kind === 'pending') out.pending.push({ id, message: result.message });
      else if (result?.kind === 'failed') out.failures.push({ id, message: result.message });
      else if (result?.kind === 'cancelled') out.failures.push({ id, message: 'Cancelled; no change was made.' });
      else out.succeeded.push(id);
    } catch (e) { out.failures.push({ id, message: errorMessage(e) }); }
    progress({ completed: out.succeeded.length + out.failures.length + out.pending.length, total: targets.length });
  }
  return out;
};
