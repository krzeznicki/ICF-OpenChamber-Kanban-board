// Stable SDK controls: polls update values without replacing the form or taking its focus.
import { mountButton, mountSelect, mountSwitch } from '@openchamber/sdk/ui';
import { TASK_STATES, type TaskState } from '../../core/types.ts';
import type { BulkDraft } from '../bulkEdit.ts';
import type { BulkToolbarModel } from '../bulkToolbar.ts';

export type BulkToolbarCallbacks = {
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
  const head = slot('kb-bulk-head');
  const count = slot('kb-bulk-count', head);
  count.setAttribute('aria-live', 'polite');
  const all = mountButton(slot('', head), { label: 'Select all', variant: 'outline', size: 'sm', onClick: callbacks.onSelectAll });
  const clear = mountButton(slot('', head), { label: 'Clear', variant: 'outline', size: 'sm', onClick: callbacks.onClear });
  const fields = slot('kb-bulk-fields');
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
  return {
    update: (model: BulkToolbarModel, types: readonly string[]): void => {
      root.hidden = model.count === 0;
      count.textContent = `${model.count} marked${model.hiddenCount ? ` (${model.hiddenCount} hidden by filters)` : ''}`;
      all.update({ disabled: model.locked });
      clear.update({ disabled: model.locked });
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
      const errorText = model.failures.map(f => `${f.id} — ${f.field}: ${f.message}`).join('\n');
      if (errorText !== previousErrors) {
        previousErrors = errorText;
        errors.textContent = errorText;
      }
    },
    dispose: () => {
      all.dispose(); clear.dispose(); state.dispose(); type.dispose(); apply.dispose(); children.dispose();
      root.replaceChildren();
    },
  };
};
