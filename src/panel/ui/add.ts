// "Add task": an inline form under the board header. Title (required), type, optional parent and a
// few sentences; the task lands in Backlog (needs-triage). The service's error shows in the form.
import { mountBanner, mountButton, mountSelect, mountTextField } from '@openchamber/sdk/ui';
import type { SelectOption } from '@openchamber/sdk/ui';
import type { NewTask } from '../../core/types.ts';

export type AddFormModel = {
  types: string[];
  /** Open parent tasks a new ticket can belong to. */
  parents: SelectOption[];
  tracker: 'local' | 'github';
};

export type AddFormCallbacks = {
  /** Resolves to null on success, or the message to show. */
  onSubmit: (input: NewTask) => Promise<string | null>;
  onCancel: () => void;
};

const NONE = '';

export const mountAddForm = (root: HTMLElement, model: AddFormModel, callbacks: AddFormCallbacks): (() => void) => {
  const form = document.createElement('form');
  form.className = 'kb-add';
  form.noValidate = true;
  const slot = (className: string): HTMLDivElement => {
    const d = document.createElement('div');
    d.className = className;
    form.append(d);
    return d;
  };
  const titleSlot = slot('kb-add-title');
  const row = slot('kb-fields');
  const typeSlot = document.createElement('div');
  typeSlot.className = 'kb-field';
  const parentSlot = document.createElement('div');
  parentSlot.className = 'kb-field';
  row.append(typeSlot, parentSlot);
  const bodySlot = slot('kb-add-body');
  const errorSlot = slot('kb-add-error');
  const actions = slot('kb-actions');
  root.replaceChildren(form);

  let title = '';
  let body = '';
  let type = 'enhancement';
  let parent = NONE;
  let busy = false;
  let errorDispose: (() => void) | null = null;

  const titleField = mountTextField(titleSlot, {
    label: 'Title',
    value: '',
    placeholder: 'What should be done?',
    onChange: (v) => {
      title = v;
      titleField.update({ value: v, ...(v.trim() !== '' ? { error: undefined } : {}) });
    },
  });
  const typeSelect = mountSelect(typeSlot, {
    label: 'Type',
    value: type,
    options: [{ id: NONE, label: 'No type' }, ...model.types.map((t) => ({ id: t, label: t }))],
    onChange: (id) => {
      type = id;
      typeSelect.update({ value: id });
    },
  });
  const noParent = model.tracker === 'local' ? 'None (new feature)' : 'None';
  const parentSelect = mountSelect(parentSlot, {
    label: 'Parent',
    value: parent,
    options: [{ id: NONE, label: noParent }, ...model.parents],
    searchable: model.parents.length > 8,
    onChange: (id) => {
      parent = id;
      parentSelect.update({ value: id });
    },
  });
  const bodyField = mountTextField(bodySlot, {
    label: 'Description',
    value: '',
    multiline: true,
    rows: 3,
    placeholder: 'A few sentences: what and why.',
    onChange: (v) => {
      body = v;
      bodyField.update({ value: v });
    },
  });
  const create = mountButton(actions, { label: 'Create in Backlog', size: 'sm', onClick: () => submit() });
  const cancel = mountButton(actions, { label: 'Cancel', variant: 'outline', size: 'sm', onClick: () => callbacks.onCancel() });

  const showError = (message: string | null): void => {
    errorDispose?.();
    errorDispose = null;
    if (message !== null) errorDispose = mountBanner(errorSlot, { tone: 'error', title: 'Could not create the task', body: message }).dispose;
  };

  const setBusy = (next: boolean): void => {
    busy = next;
    create.update({ loading: next, disabled: next });
    cancel.update({ disabled: next });
    titleField.update({ disabled: next });
    bodyField.update({ disabled: next });
    typeSelect.update({ disabled: next });
    parentSelect.update({ disabled: next });
  };

  const submit = (): void => {
    if (busy) return;
    const t = title.trim();
    if (t === '') {
      titleField.update({ error: 'A title is required' });
      form.querySelector<HTMLInputElement>('.kb-add-title input')?.focus();
      return;
    }
    showError(null);
    setBusy(true);
    const input: NewTask = {
      title: t,
      state: 'needs-triage',
      ...(body.trim() !== '' ? { body: body.trim() } : {}),
      ...(type !== NONE ? { type } : {}),
      ...(parent !== NONE ? { parentId: parent } : {}),
    };
    void callbacks.onSubmit(input).then((error) => {
      if (!form.isConnected) return;
      setBusy(false);
      showError(error);
    });
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented && !busy) callbacks.onCancel();
  });
  form.querySelector<HTMLInputElement>('.kb-add-title input')?.focus();

  return () => {
    errorDispose?.();
    for (const h of [titleField, typeSelect, parentSelect, bodyField, create, cancel]) h.dispose();
    form.remove();
  };
};
