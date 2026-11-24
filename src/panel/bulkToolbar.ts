// The bulk-edit toolbar's state (spec docs/superpowers/specs/2026-11-23-bulk-edit-toolbar-design.md):
// the draft, the operation it runs (bulkEdit.ts) and what is left to retry. DOM-free, so it runs
// under node:test; ui/bulkToolbar.ts draws the model and main.ts wires the deps.
import { errorMessage, type Task } from '../core/types.ts';
import { planBulk, runBulk, type BulkApi, type BulkDraft, type BulkFailure, type BulkPlan, type BulkProgress } from './bulkEdit.ts';
import { previewAction, runAction, type BulkAction, type ActionDeps, type ActionPreview } from './bulkActions.ts';

export type BulkToolbarDeps = {
  actions?: () => ActionDeps | null;
  /** The current project's API (null: no project). */
  api: () => BulkApi | null;
  /** Every task of the project, as last listed. */
  tasks: () => readonly Task[];
  /** The ids drawn on the Board now. */
  visible: () => readonly string[];
  /** Tasks with a save already in flight elsewhere in the panel. */
  busy: () => ReadonlySet<string>;
  /** Whether `tasks` holds every source's tasks (a listing failed: false). */
  complete: () => boolean;
  /** The model changed: redraw the toolbar. */
  changed: () => void;
  /** Replace the Marked cards. */
  replace: (ids: readonly string[]) => void;
  /** Keep these marks even when a redraw does not draw them. */
  retain: (ids: readonly string[]) => void;
  /** Lock (or unlock) every other way to change the board while the operation runs. */
  lock: (locked: boolean, ids: readonly string[]) => void;
  /** Reload the board's tasks. */
  reload: () => Promise<void>;
};

const emptyDraft = (): BulkDraft => ({ state: null, type: null, withChildren: true });

export const createBulkToolbar = (deps: BulkToolbarDeps) => {
  let ids: readonly string[] = [];
  let draft = emptyDraft();
  let saving = false;
  let retry: BulkPlan | null = null;
  let failures: BulkFailure[] = [];
  let progress: BulkProgress | null = null;
  let notice: string | null = null;
  let actionFailures: { id: string; message: string }[] = [];
  let lastAction: BulkAction | null = null;
  const actionPreview = (action: BulkAction): ActionPreview => {
    const a = deps.actions?.();
    return a ? previewAction(action, deps.tasks(), ids, a.context())
      : { eligible: [], excluded: ids.map(id => ({ id, reason: 'Actions are unavailable.' })), additional: [] };
  };

  const currentPlan = (): BulkPlan => retry ?? planBulk(deps.tasks(), ids, draft);
  const targets = (plan: BulkPlan): readonly string[] => retry ? ids : plan.closeIds.length ? plan.closeIds : plan.selectedIds;
  const blockReason = (): string | null => {
    if (deps.api() === null) return 'No project is open.';
    if (!deps.complete()) return 'Task sources could not be fully loaded. Refresh before editing the group.';
    try {
      const parents = new Map(deps.tasks().map(t => [t.id, t.parentId]));
      const busy = deps.busy();
      // Existing editor operations reserve their root; closing/deleting it may still write children.
      const overlaps = (id: string): boolean => {
        const seen = new Set<string>();
        for (let at: string | null = id; at !== null && !seen.has(at); at = parents.get(at) ?? null) {
          if (busy.has(at)) return true;
          seen.add(at);
        }
        return false;
      };
      return targets(currentPlan()).some(overlaps)
        ? 'A selected task or sub-task is being changed. Wait for that save to finish.' : null;
    } catch (e) {
      return errorMessage(e);
    }
  };
  const canApply = (): boolean => !saving && ids.length > 0 && (draft.state !== null || draft.type !== null) && blockReason() === null;

  const clear = (): void => {
    if (saving) return;
    ids = [];
    draft = emptyDraft();
    retry = null;
    failures = [];
    progress = null;
    notice = null;
    actionFailures = [];
    lastAction = null;
    deps.retain([]);
    deps.replace([]);
    deps.changed();
  };

  return {
    actionPreview,
    executeAction: async (action: BulkAction, confirmedIds: readonly string[]): Promise<void> => {
      const a = deps.actions?.();
      if (saving || !a || !confirmedIds.length || confirmedIds.some(id => !ids.includes(id))) return;
      const preview = actionPreview(action);
      if (confirmedIds.some(id => !preview.eligible.includes(id))) {
        notice = 'The selection or available actions changed. Check the preview and try again.';
        deps.changed();
        return;
      }
      const context = a.context();
      const targetIds = [...new Set([...confirmedIds, ...preview.additional])];
      const excluded = ids.filter(id => !confirmedIds.includes(id));
      saving = true;
      notice = null;
      failures = [];
      actionFailures = [];
      lastAction = action;
      progress = { completed: 0, total: targetIds.length };
      deps.retain(ids);
      deps.lock(true, targetIds);
      deps.changed();
      try {
        const result = await runAction(action, confirmedIds, { ...a, context: () => context }, p => { progress = p; deps.changed(); });
        actionFailures = [...result.failures, ...result.pending];
        if (action.kind !== 'copy') {
          ids = [...new Set([...excluded, ...actionFailures.map(f => f.id)])];
          retry = null;
          deps.retain(ids);
          deps.replace(ids);
        }
        notice = action.kind === 'copy' && !actionFailures.length ? 'Copied to clipboard.'
          : `${result.succeeded.length} completed${result.pending.length ? `, ${result.pending.length} awaiting confirmation` : ''}${excluded.length ? `, ${excluded.length} excluded` : ''}.`;
        await deps.reload();
        if (ids.length === 0) draft = emptyDraft();
      } catch (e) { notice = errorMessage(e); }
      finally {
        saving = false;
        deps.lock(false, targetIds);
        deps.changed();
      }
    },
    model: () => {
      let extraCloseCount = 0;
      try {
        const plan = currentPlan();
        extraCloseCount = plan.closeIds.filter(id => !plan.selectedIds.includes(id)).length;
      } catch { /* blockReason explains why the preview is unavailable */ }
      return {
        count: ids.length, draft: { ...draft }, canApply: canApply(), failures, locked: saving, progress, notice, blockReason: saving ? null : blockReason(),
        hiddenCount: ids.filter(id => !deps.visible().includes(id)).length,
        extraCloseCount,
        actionFailures, lastAction,
      };
    },
    selectionChanged: (next: readonly string[]): void => {
      if (saving || (ids.length === next.length && ids.every((id, i) => id === next[i]))) return;
      ids = [...next];
      retry = null;
      failures = [];
      actionFailures = [];
      lastAction = null;
      deps.retain([]);
      if (ids.length === 0) draft = emptyDraft();
      deps.changed();
    },
    setDraft: (change: Partial<BulkDraft>): void => {
      if (saving) return;
      draft = { ...draft, ...change };
      retry = null;
      failures = [];
      deps.changed();
    },
    apply: async (): Promise<void> => {
      const api = deps.api();
      if (!canApply() || api === null) return;
      const plan = currentPlan();
      const targetIds = targets(plan);
      saving = true;
      notice = null;
      progress = { completed: 0, total: targetIds.length };
      deps.retain(ids);
      deps.lock(true, targetIds);
      deps.changed();
      try {
        const result = await runBulk(plan, api, value => { progress = value; deps.changed(); }, retry ? ids : undefined);
        failures = result.failures;
        if (failures.length) {
          retry = plan;
          ids = failures.map(f => f.id);
          deps.retain(ids);
          deps.replace(ids);
        }
        await deps.reload();
        if (result.failures.length === 0) {
          ids = [];
          draft = emptyDraft();
          retry = null;
          deps.retain([]);
          deps.replace([]);
        }
      } catch (e) {
        notice = errorMessage(e);
      } finally {
        saving = false;
        deps.lock(false, targetIds);
        deps.changed();
      }
    },
    clear,
    reset: clear,
  };
};

export type BulkToolbar = ReturnType<typeof createBulkToolbar>;
export type BulkToolbarModel = ReturnType<BulkToolbar['model']>;
