// Stable SDK controls: polls update values without replacing the form or taking its focus.
import { mountButton, mountSelect, mountSwitch } from '@openchamber/sdk/ui';
import { TASK_STATES, type TaskState } from '../../core/types.ts';
import type { BulkDraft } from '../bulkEdit.ts';
import type { BulkToolbarModel } from '../bulkToolbar.ts';
import { bulkIconButton } from './bulkIcons.ts';
import { ACTION_LABELS, mountBulkActionForm, type ActionFormDeps } from './bulkActionForm.ts';
import type { BulkAction } from '../bulkActions.ts';

export type BulkToolbarCallbacks = {
  actions?: Omit<ActionFormDeps, 'dismiss'>;
  onDraft: (change: Partial<BulkDraft>) => void;
  onApply: () => void;
  onClear: () => void;
  onSelectAll: () => void;
};

export const mountBulkToolbar = (root: HTMLElement, callbacks: BulkToolbarCallbacks) => {
  root.classList.add('kb-bulk');
  root.hidden = true;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Edit marked tasks');
  const slot = (className: string, parent = root): HTMLDivElement => {
    const node = document.createElement('div');
    node.className = className;
    parent.append(node);
    return node;
  };
  const top = slot('kb-bulk-top');
  const head = slot('kb-bulk-head', top);
  const count = slot('kb-bulk-count', head);
  count.setAttribute('aria-live', 'polite');
  const all = bulkIconButton(head, 'all', 'Select all', callbacks.onSelectAll);
  const clear = bulkIconButton(head, 'clear', 'Clear', callbacks.onClear);
  const fields = slot('kb-bulk-fields', top);
  const stateSlot = slot('kb-bulk-field', fields);
  stateSlot.dataset.bulkField = 'state';
  const typeSlot = slot('kb-bulk-field', fields);
  typeSlot.dataset.bulkField = 'type';
  const state = mountSelect(stateSlot, {
    label: 'State', value: '', options: [{ id: '', label: 'No change' }, ...TASK_STATES.map(id => ({ id, label: id }))],
    onChange: id => callbacks.onDraft({ state: id === '' ? null : id as TaskState }),
  });
  const type = mountSelect(typeSlot, {
    label: 'Type', value: '', options: [{ id: '', label: 'No change' }],
    onChange: id => callbacks.onDraft({ type: id || null }),
  });
  const apply = mountButton(slot('kb-bulk-apply', fields), { label: 'Apply', size: 'sm', disabled: true, onClick: callbacks.onApply });
  const actionRow = slot('kb-bulk-actions');
  const groups: BulkAction['kind'][][] = [['move', 'label'], ['parent', 'unparent', 'blocker'], ['start', 'queue'], ['archive', 'restore', 'copy'], ['delete']];
  const actionButtons: { kind: BulkAction['kind']; handle: ReturnType<typeof bulkIconButton> }[] = [];
  let lastAction: BulkAction | null = null;
  const popover = slot('kb-bulk-popover');
  const actionForm = mountBulkActionForm(popover, {
    tasks: () => callbacks.actions?.tasks() ?? [],
    preview: action => callbacks.actions?.preview(action) ?? { eligible: [], excluded: [], additional: [] },
    submit: async (action, ids) => { await callbacks.actions?.submit(action, ids); },
    dismiss: () => {},
  });
  for (const group of groups) {
    const wrap = slot('kb-bulk-action-group', actionRow);
    for (const kind of group) {
      const handle = bulkIconButton(wrap, kind, ACTION_LABELS[kind], () => actionForm.open(kind, handle.button, lastAction));
      actionButtons.push({ kind, handle });
    }
  }
  const childrenSlot = slot('kb-bulk-children');
  const children = mountSwitch(childrenSlot, {
    label: 'Close sub-tasks', checked: true,
    onChange: checked => callbacks.onDraft({ withChildren: checked }),
  });
  const extra = slot('kb-muted', childrenSlot);
  const status = slot('kb-bulk-status');
  status.setAttribute('role', 'status');
  const errors = slot('kb-bulk-errors');
  errors.setAttribute('aria-live', 'polite');
  let previousState = '';
  let previousType = '';
  let previousErrors = '';
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || root.querySelector('[role="listbox"]')) return;
    event.preventDefault(); event.stopPropagation();
    if (actionForm.isOpen()) actionForm.dismiss(); else callbacks.onClear();
  };
  root.addEventListener('keydown', onKey);
  const measure = () => root.parentElement?.style.setProperty('--kb-bulk-space', root.hidden ? '0px' : `${root.getBoundingClientRect().height + 28}px`);
  const observer = new ResizeObserver(measure);
  observer.observe(root);
  return {
    isActionOpen: actionForm.isOpen,
    update: (model: BulkToolbarModel, types: readonly string[]): void => {
      lastAction = model.lastAction;
      root.hidden = model.count === 0;
      if (root.hidden) actionForm.dismiss();
      count.textContent = `${model.count} marked${model.hiddenCount ? ` (${model.hiddenCount} hidden by filters)` : ''}`;
      all.update(model.locked);
      clear.update(model.locked);
      for (const { kind, handle } of actionButtons) {
        // Relationship actions need a target chosen in their form before eligibility is known.
        const action: BulkAction | null = kind === 'parent' || kind === 'blocker' ? null
          : kind === 'move' ? { kind, to: 'ready' }
          : kind === 'label' ? { kind, label: '', mode: 'add' }
          : kind === 'copy' ? { kind, format: 'titles' }
          : kind === 'delete' ? { kind, withChildren: false } : { kind };
        const preview = action ? callbacks.actions?.preview(action) : undefined;
        const unavailable = preview !== undefined && preview.eligible.length === 0;
        handle.update(model.locked || unavailable, unavailable ? preview.excluded[0]?.reason : undefined);
      }
      actionForm.update(model.locked);
      apply.update({ disabled: !model.canApply, label: model.locked ? 'Saving…' : 'Apply' });
      const stateKey = JSON.stringify([model.draft.state, model.locked]);
      if (stateKey !== previousState) {
        previousState = stateKey;
        state.update({ value: model.draft.state ?? '', disabled: model.locked });
      }
      const options = [...new Set([...types, ...(model.draft.type ? [model.draft.type] : [])])];
      const typeKey = JSON.stringify([options, model.draft.type, model.locked]);
      if (typeKey !== previousType) {
        previousType = typeKey;
        type.update({ value: model.draft.type ?? '', disabled: model.locked, options: [{ id: '', label: 'No change' }, ...options.map(id => ({ id, label: id }))] });
      }
      childrenSlot.hidden = model.draft.state !== 'done';
      children.update({ checked: model.draft.withChildren, disabled: model.locked });
      extra.textContent = model.draft.withChildren ? `${model.extraCloseCount} additional sub-task${model.extraCloseCount === 1 ? '' : 's'} to close` : 'Only marked tasks will be closed';
      status.textContent = model.locked && model.progress ? `Saving ${model.progress.completed} of ${model.progress.total} tasks…` : model.notice ?? model.blockReason ?? '';
      const errorText = [...model.failures.map(f => `${f.id} — ${f.field}: ${f.message}`), ...model.actionFailures.map(f => `${f.id} — ${f.message}`)].join('\n');
      if (errorText !== previousErrors) {
        previousErrors = errorText;
        errors.textContent = errorText;
      }
      measure();
    },
    dispose: () => {
      observer.disconnect(); root.removeEventListener('keydown', onKey);
      actionForm.dispose(); state.dispose(); type.dispose(); apply.dispose(); children.dispose();
      root.replaceChildren();
    },
  };
};
