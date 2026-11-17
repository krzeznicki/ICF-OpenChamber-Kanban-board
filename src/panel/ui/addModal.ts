// "Add task": a modal on the task modal's shell (ui/modal.ts) with every per-task option: title
// (required), type, parent, state, blocked by, description (markdown), the card's start options,
// a list of sub-tasks to create under the new task and existing tasks to link under it. What may
// be offered for the chosen tracker and parent comes from addTask.ts; the editor (edit.ts) runs
// the creates and the links. The service's error shows inside the modal; when the task was created
// but some sub-tasks were not created or linked, the modal says which and offers only Close. With
// suggestions on, Type and State start on "Let the model pick" (suggest.ts fills those in after
// the create).
import { mountBanner, mountButton, mountSelect, mountTextField } from '@openchamber/sdk/ui';
import type { Task, TaskState } from '../../core/types.ts';
import {
  CREATE_STATES,
  blockerChoices,
  canHaveSubtasks,
  draftSubtasks,
  draftType,
  emptyDraft,
  existingSubtaskChoices,
  isDirty,
  keepOffered,
  MODEL_PICK,
  validateDraft,
  type AddDraft,
  type Choice,
  type TrackerKind,
} from '../addTask.ts';
import type { Preset } from '../presets.ts';
import type { StartLists } from '../models.ts';
import type { StartOptions } from '../settings.ts';
import { mountCloseButton } from './closeButton.ts';
import { mountCheckList } from './checkList.ts';
import { askChoice } from './confirm.ts';
import { FILTER_OVER, openModalShell } from './modal.ts';
import { mountStartOptions } from './startOptions.ts';
import { hintLastChild } from './shortcutHints.ts';

export type AddModalModel = {
  tracker: TrackerKind;
  types: string[];
  /** Open parents (addTask.ts parentChoices). */
  parents: Choice[];
  /** The listed tasks, for the blocked-by and existing sub-task choices. */
  tasks: readonly Task[];
  /** Role -> label in the repo; shown as a hint when it differs. */
  labels: Record<string, string>;
  /** Null while the project's settings are loading (a muted line says so; setStart fills it in). */
  start: AddModalStart | null;
  /** The model and agent lists of the start pickers. */
  lists: StartLists;
  /** Type and State offer "Let the model pick" first, and start on it (suggest.ts). */
  suggest: boolean;
};

export type AddModalStart = {
  projectId: string;
  presets: Preset[];
  /** What a new task of this type would start with, with or without sub-tasks. */
  inherited: (type: string | null, subtasks: boolean) => StartOptions;
  summaryLanguage: string;
};

/** null: created, close; `error`: nothing was created; `partial`: the task was, some sub-tasks were not. */
export type AddResult = null | { kind: 'error'; message: string } | { kind: 'partial'; message: string };

export type AddModalCallbacks = {
  onSubmit: (draft: AddDraft) => Promise<AddResult>;
  onDismiss: () => void;
};

const NONE = '';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export type AddModalHandle = {
  setStart: (start: AddModalStart | null) => void;
  /** Creates the task, as the Create task button does (Mod+Enter); false when the form is busy or done. */
  submit: () => boolean;
  dispose: () => void;
};

export const openAddModal = (
  model: AddModalModel,
  callbacks: AddModalCallbacks,
): AddModalHandle => {
  const d: AddDraft = emptyDraft(model.suggest);
  if (!model.suggest) d.type = model.types.includes('enhancement') ? 'enhancement' : NONE;
  /** A type literally named like the sentinel is not offered (it would read as the model's pick). */
  const types = model.types.filter((t) => t !== MODEL_PICK);
  const pick = model.suggest ? [{ id: MODEL_PICK, label: 'Let the model pick', hint: 'Small Model, after the task is created' }] : [];
  /** What the form opened with: closing it unchanged asks nothing. */
  const initial: AddDraft = { ...d };
  let busy = false;
  /** The task was created but some sub-tasks were not: only Close is left. */
  let finished = false;
  /** "Discard this task?" is open: a second Escape or click does not ask again. */
  let asking = false;
  const locked = (): boolean => busy || finished;
  // Escape, a backdrop click, × and Cancel: a filled form asks before it is thrown away.
  const dismiss = (): void => {
    if (busy || asking) return;
    if (finished || !isDirty(d, initial)) {
      callbacks.onDismiss();
      return;
    }
    asking = true;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void askChoice('Discard this task?', 'What you entered in the form will be lost.', [
      { id: 'discard', label: 'Discard', variant: 'destructive' },
    ]).then((answer) => {
      asking = false;
      // The modal may have gone meanwhile (project switch).
      if (answer === 'discard' && modal.isConnected && !busy) callbacks.onDismiss();
      else if (focused?.isConnected) focused.focus();
    });
  };
  const shell = openModalShell({ label: 'Add task', onDismiss: dismiss, className: 'kb-add-modal' });
  const { modal } = shell;
  const disposers: Array<() => void> = [];

  const head = el('header', 'kb-modal-head');
  const top = el('div', 'kb-sheet-head');
  const titles = el('div', 'kb-sheet-titles');
  titles.append(el('h2', 'kb-sheet-title', 'Add task'));
  const closeSlot = el('div', 'kb-sheet-x');
  top.append(titles, closeSlot);
  head.append(top);
  disposers.push(mountCloseButton(closeSlot, dismiss));

  const form = el('form', 'kb-add-form');
  form.noValidate = true;
  const part = (className = 'kb-sheet-part'): HTMLDivElement => {
    const p = el('div', className);
    form.append(p);
    return p;
  };
  const titleSlot = part('kb-add-title');
  const row1 = part('kb-fields');
  const typeSlot = el('div', 'kb-field');
  const stateSlot = el('div', 'kb-field');
  row1.append(typeSlot, stateSlot);
  const parentSlot = part('kb-fields');
  const parentCell = el('div', 'kb-field');
  parentSlot.append(parentCell);
  const blockersBox = part('kb-sheet-part kb-add-group');
  const bodySlot = part('kb-add-body');
  const subBox = part('kb-sheet-part kb-add-group');
  const existingBox = part('kb-sheet-part kb-add-group');
  const startBox = part('kb-sheet-part kb-start');
  const errorSlot = part('kb-add-error');
  const actions = part('kb-actions');
  modal.append(head, form);

  // --- title, type, state, parent, description ---
  const titleField = mountTextField(titleSlot, {
    label: 'Title',
    value: '',
    placeholder: 'What should be done?',
    onChange: (v) => {
      d.title = v;
      titleField.update({ value: v, ...(v.trim() !== '' ? { error: undefined } : {}) });
    },
  });
  const typeSelect = mountSelect(typeSlot, {
    label: 'Type',
    value: d.type,
    options: [...pick, { id: NONE, label: 'No type' }, ...types.map((t) => ({ id: t, label: t }))],
    onChange: (id) => {
      d.type = id;
      typeSelect.update({ value: id });
      drawStart();
    },
  });
  const stateSelect = mountSelect(stateSlot, {
    label: 'State',
    value: d.state,
    options: [
      ...pick,
      ...CREATE_STATES.map((s) => {
        const label = model.labels[s];
        return { id: s, label: s, ...(label !== undefined && label !== s ? { hint: label } : {}) };
      }),
    ],
    onChange: (id) => {
      d.state = id as TaskState | typeof MODEL_PICK;
      stateSelect.update({ value: id });
    },
  });
  const parentSelect = mountSelect(parentCell, {
    label: 'Parent',
    value: d.parentId,
    options: [{ id: NONE, label: model.tracker === 'local' ? 'None (new feature)' : 'None' }, ...model.parents],
    searchable: model.parents.length > FILTER_OVER,
    onChange: (id) => {
      d.parentId = id;
      parentSelect.update({ value: id });
      drawBlockers();
      drawSubtasks();
      drawExisting();
      drawStart();
    },
  });
  const bodyField = mountTextField(bodySlot, {
    label: 'Description',
    value: '',
    multiline: true,
    rows: 6,
    placeholder: 'Markdown: what and why, acceptance criteria…',
    onChange: (v) => {
      d.body = v;
      bodyField.update({ value: v });
    },
  });
  const fixed = [titleField, typeSelect, stateSelect, parentSelect, bodyField];

  // --- blocked by: checkboxes of what addTask.ts offers for this parent ---
  let blockerDisposers: Array<() => void> = [];
  let blockerFilter = '';
  const drawBlockers = (): void => {
    for (const x of blockerDisposers) x();
    blockerDisposers = [];
    blockersBox.replaceChildren();
    const offered = blockerChoices(model.tasks, model.tracker, d.parentId);
    d.blockedBy = keepOffered(d.blockedBy, offered);
    blockersBox.append(el('h3', 'kb-settings-heading', 'Blocked by'));
    if (offered.length === 0) {
      const why =
        model.tracker === 'local'
          ? d.parentId === NONE
            ? 'A new feature has no blockers; pick a parent to choose tickets of that feature.'
            : 'That feature has no open tickets.'
          : 'No open issues.';
      blockersBox.append(el('p', 'kb-muted', why));
      return;
    }
    blockerDisposers = mountCheckList(blockersBox, {
      offered,
      filterLabel: 'Filter blockers',
      filter: blockerFilter,
      onFilter: (v) => (blockerFilter = v),
      selected: () => d.blockedBy,
      onSelected: (ids) => {
        d.blockedBy = ids;
      },
      disabled: locked(),
    });
  };

  // --- sub-tasks: rows of titles, created under the new task ---
  let subDisposers: Array<() => void> = [];
  const drawSubtasks = (focusRow?: number): void => {
    for (const x of subDisposers) x();
    subDisposers = [];
    subBox.replaceChildren();
    subBox.append(el('h3', 'kb-settings-heading', 'Sub-tasks'));
    if (!canHaveSubtasks(model.tracker, d.parentId)) {
      subBox.append(el('p', 'kb-muted', 'A ticket of a feature cannot have sub-tasks here; choose no parent to create a feature with sub-tasks.'));
      return;
    }
    subBox.append(
      el(
        'p',
        'kb-muted',
        model.tracker === 'local' ? 'Created as tickets of the new feature, in this order.' : 'Created as sub-issues of the new issue, in this order.',
      ),
    );
    d.subtasks.forEach((value, i) => {
      const row = el('div', 'kb-add-sub-row');
      const fieldSlot = el('div', 'kb-field');
      const removeSlot = el('div', 'kb-add-sub-remove');
      row.append(fieldSlot, removeSlot);
      subBox.append(row);
      const field = mountTextField(fieldSlot, {
        value,
        placeholder: `Sub-task ${i + 1}`,
        disabled: locked(),
        onChange: (v) => {
          d.subtasks[i] = v;
          field.update({ value: v });
          drawStart(); // GitHub: having sub-tasks makes it a parent (orchestrate preset)
        },
      });
      fieldSlot.querySelector('input')?.setAttribute('aria-label', `Sub-task ${i + 1}`);
      // Enter adds the next row instead of submitting the whole form.
      // Mod+Enter is left to the Create task Shortcut (shortcuts.ts).
      fieldSlot.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        d.subtasks.splice(i + 1, 0, '');
        drawSubtasks(i + 1);
      });
      const remove = mountButton(removeSlot, {
        label: '×',
        variant: 'ghost',
        size: 'sm',
        disabled: locked(),
        onClick: () => {
          d.subtasks.splice(i, 1);
          drawSubtasks(Math.min(i, d.subtasks.length - 1));
          drawStart();
        },
      });
      const button = removeSlot.querySelector('button');
      button?.setAttribute('aria-label', `Remove sub-task ${i + 1}`);
      if (button !== null) button.title = 'Remove';
      subDisposers.push(field.dispose, remove.dispose);
    });
    const addSlot = el('div', 'kb-actions kb-actions-start');
    subBox.append(addSlot);
    subDisposers.push(
      mountButton(addSlot, {
        label: 'Add sub-task',
        variant: 'outline',
        size: 'xs',
        disabled: locked(),
        onClick: () => {
          d.subtasks.push('');
          drawSubtasks(d.subtasks.length - 1);
        },
      }).dispose,
    );
    if (focusRow !== undefined && focusRow >= 0) subBox.querySelectorAll('input')[focusRow]?.focus();
  };

  // --- existing sub-tasks: open tasks linked under the new task once it exists (tracker setParent) ---
  let existingDisposers: Array<() => void> = [];
  let existingFilter = '';
  const drawExisting = (): void => {
    for (const x of existingDisposers) x();
    existingDisposers = [];
    existingBox.replaceChildren();
    const offered = existingSubtaskChoices(model.tasks, model.tracker, d.parentId);
    d.existing = keepOffered(d.existing, offered);
    // Where the new task takes no sub-tasks, the Sub-tasks section already says why.
    existingBox.hidden = !canHaveSubtasks(model.tracker, d.parentId);
    if (existingBox.hidden) return;
    existingBox.append(el('h3', 'kb-settings-heading', 'Existing sub-tasks'));
    if (offered.length === 0) {
      existingBox.append(el('p', 'kb-muted', model.tracker === 'local' ? 'No open tickets or features without tickets to move.' : 'No open issues.'));
      return;
    }
    existingBox.append(
      el(
        'p',
        'kb-muted',
        model.tracker === 'local' ? 'Moved into the new feature as its tickets once it is created.' : 'Linked as sub-issues of the new issue once it is created.',
      ),
    );
    existingDisposers = mountCheckList(existingBox, {
      offered,
      filterLabel: 'Filter existing tasks',
      filter: existingFilter,
      onFilter: (v) => (existingFilter = v),
      selected: () => d.existing,
      onSelected: (ids) => {
        d.existing = ids;
        drawStart(); // GitHub: having sub-tasks makes it a parent (orchestrate preset)
      },
      disabled: locked(),
    });
  };

  // --- start options: redrawn when what they inherit changes (type, kind, the project's settings) ---
  let start = model.start;
  let startDispose: (() => void) | null = null;
  let startKey: string | null = null;
  const lockStart = (): void => {
    // The kit's inherit fields have no disabled state: the block is inert while it may not change.
    startBox.inert = locked();
    startBox.classList.toggle('is-locked', locked());
  };
  const drawStart = (): void => {
    const s = start;
    const inherited = s === null ? null : s.inherited(draftType(d), draftSubtasks(d, model.tracker));
    const key =
      s === null ? 'loading' : JSON.stringify([s.projectId, inherited, s.summaryLanguage, s.presets.map((p) => [p.id, p.name])]);
    lockStart();
    if (key === startKey) return;
    startKey = key;
    startDispose?.();
    startDispose = null;
    startBox.replaceChildren(el('h3', 'kb-settings-heading', 'Start options'));
    if (s === null || inherited === null) {
      startBox.append(el('p', 'kb-muted', 'Start options load with the project settings.'));
      return;
    }
    startBox.append(el('p', 'kb-muted', 'Used when an agent starts on this task; unset fields follow the settings.'));
    startDispose = mountStartOptions(startBox, {
      presets: s.presets,
      card: d.start,
      inherited,
      summaryLanguage: s.summaryLanguage,
      lists: model.lists,
      onChange: (card) => {
        d.start = card;
      },
    });
  };

  // --- actions ---
  let errorDispose: (() => void) | null = null;
  const showBanner = (tone: 'error' | 'warning' | null, title = '', body = ''): void => {
    errorDispose?.();
    errorDispose = null;
    if (tone !== null) errorDispose = mountBanner(errorSlot, { tone, title, body }).dispose;
    if (tone !== null) errorSlot.scrollIntoView({ block: 'nearest' });
  };
  const create = mountButton(actions, { label: 'Create task', size: 'sm', onClick: () => void submit() });
  hintLastChild(actions, 'add.create', 'Create task');
  let createDisposed = false;
  const cancel = mountButton(actions, { label: 'Cancel', variant: 'outline', size: 'sm', onClick: dismiss });

  const setBusy = (next: boolean): void => {
    busy = next;
    modal.setAttribute('aria-busy', String(next));
    if (!createDisposed) create.update({ loading: next, disabled: next || finished });
    cancel.update({ disabled: next });
    for (const h of fixed) h.update({ disabled: next || finished });
    drawBlockers();
    drawSubtasks();
    drawExisting();
    lockStart();
  };

  const submit = (): boolean => {
    if (busy || finished) return false;
    const invalid = validateDraft(d);
    if (invalid.title !== undefined) {
      titleField.update({ error: invalid.title });
      titleSlot.querySelector('input')?.focus();
      return true;
    }
    showBanner(null);
    setBusy(true);
    void callbacks.onSubmit({ ...d, blockedBy: [...d.blockedBy], subtasks: [...d.subtasks], existing: [...d.existing], start: { ...d.start } }).then((result) => {
      if (!modal.isConnected) return;
      if (result?.kind === 'partial') finished = true;
      setBusy(false);
      if (result === null) return;
      if (result.kind === 'error') {
        showBanner('error', 'Could not create the task', result.message);
        return;
      }
      showBanner('warning', 'Some sub-tasks were not created or linked', result.message);
      createDisposed = true;
      create.dispose();
      cancel.update({ label: 'Close', variant: 'default' });
      actions.querySelector('button')?.focus();
    });
    return true;
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  // Enter in the title creates the task (the kit's buttons are not submit buttons); Mod+Enter is
  // left to the Create task Shortcut (shortcuts.ts).
  titleSlot.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    submit();
  });

  drawBlockers();
  drawSubtasks();
  drawExisting();
  drawStart();
  titleSlot.querySelector('input')?.focus();

  return {
    setStart: (next: AddModalStart | null) => {
      start = next;
      drawStart();
    },
    submit,
    dispose: () => {
      for (const x of [...disposers, ...blockerDisposers, ...subDisposers, ...existingDisposers]) x();
      for (const h of fixed) h.dispose();
      startDispose?.();
      errorDispose?.();
      if (!createDisposed) create.dispose();
      cancel.dispose();
      shell.dispose();
    },
  };
};
