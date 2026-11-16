// The task modal's Edit form (the Task section turns into it until Save or Cancel): title and
// description (markdown). Split out of detail.ts like startOptions.ts; what it starts with and what
// it sends are taskEdit.ts.
import { mountBanner, mountButton, mountTextField } from '@openchamber/sdk/ui';
import { editDirty, type EditText } from '../taskEdit.ts';

const div = (className: string): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = className;
  return d;
};

/**
 * The Task section's Edit form: title, description (markdown), Save and Cancel. The service's
 * error shows in it; `onDone` runs after a successful save or Cancel (the section redraws).
 * `dirty` says whether closing the modal now would lose typed text; `submit` is Save (Mod+Enter).
 */
export const mountEditForm = (
  box: HTMLElement,
  initial: EditText,
  onSave: (draft: EditText) => Promise<string | null>,
  onDone: () => void,
): { dispose: () => void; dirty: () => boolean; submit: () => boolean } => {
  const titleSlot = div('kb-field');
  const bodySlot = div('kb-field');
  const errorSlot = div('kb-add-error');
  const actions = div('kb-actions kb-actions-start');
  box.append(titleSlot, bodySlot, errorSlot, actions);

  const draft: EditText = { ...initial };
  let busy = false;
  let disposed = false;
  let errorDispose: (() => void) | null = null;
  const titleField = mountTextField(titleSlot, {
    label: 'Title',
    value: draft.title,
    onChange: (v) => {
      draft.title = v;
      titleField.update({ value: v, ...(v.trim() !== '' ? { error: undefined } : {}) });
    },
  });
  const bodyField = mountTextField(bodySlot, {
    label: 'Description',
    value: draft.body,
    multiline: true,
    rows: 12,
    placeholder: 'Markdown',
    onChange: (v) => {
      draft.body = v;
      bodyField.update({ value: v });
    },
  });
  const save = mountButton(actions, { label: 'Save', size: 'sm', onClick: () => submit() });
  const cancel = mountButton(actions, { label: 'Cancel', size: 'sm', variant: 'outline', onClick: () => !busy && onDone() });

  const showError = (message: string | null): void => {
    errorDispose?.();
    errorDispose = null;
    if (message !== null) errorDispose = mountBanner(errorSlot, { tone: 'error', title: 'Could not save the task', body: message }).dispose;
  };
  const setBusy = (next: boolean): void => {
    busy = next;
    save.update({ loading: next, disabled: next });
    cancel.update({ disabled: next });
    titleField.update({ disabled: next });
    bodyField.update({ disabled: next });
  };
  const submit = (): void => {
    if (busy) return;
    if (draft.title.trim() === '') {
      titleField.update({ error: 'A title is required' });
      titleSlot.querySelector('input')?.focus();
      return;
    }
    showError(null);
    setBusy(true);
    void onSave({ ...draft }).then((error) => {
      if (disposed) return;
      setBusy(false);
      if (error === null) onDone();
      else showError(error);
    });
  };
  titleSlot.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    submit();
  });

  return {
    dirty: () => editDirty(initial, draft),
    /** Save, as its button does (Mod+Enter); false while a save is running. */
    submit: (): boolean => {
      if (busy) return false;
      submit();
      return true;
    },
    dispose: () => {
      disposed = true;
      errorDispose?.();
      titleField.dispose();
      bodyField.dispose();
      save.dispose();
      cancel.dispose();
    },
  };
};
