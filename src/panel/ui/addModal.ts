// "Add task": a modal on the task modal's shell (ui/modal.ts) with every per-task option: title
// (required), type, parent, state, blocked by, description (markdown), the card's start options,
// a list of sub-tasks to create under the new task and existing tasks to link under it. What may
// be offered for the chosen tracker and parent comes from addTask.ts; the editor (edit.ts) runs
// the creates and the links. The service's error shows inside the modal; when the task was created
// but some sub-tasks were not created or linked, the modal says which and offers only Close. With
// suggestions on, Type and State start on "Let the model pick" (suggest.ts fills those in after
// the create). With several sources the task goes to the switcher's source; in All a Source select
// (starting on the primary) picks it, and parent, blockers and existing sub-tasks come only from it.
import { mountBanner, mountButton, mountSelect, mountTextField } from '@openchamber/sdk/ui';
import type { Task, TaskState } from '../../core/types.ts';
import {
  CREATE_STATES,
  blockerChoices,
  canHaveSubtasks,
  draftSubtasks,
  draftType,
  emptyDraft,
  parentChoices,
  sourceTasks,
  withSource,
  existingSubtaskChoices,
  isDirty,
  keepOffered,
  MODEL_PICK,
  validateDraft,
  type AddDraft,
  type Choice,
} from '../addTask.ts';
import type { SourceId } from '../../core/types.ts';
import type { SourceInfo } from '../api.ts';
import type { Preset } from '../presets.ts';
import { sourceOr } from '../sources.ts';
import type { StartLists } from '../models.ts';
import type { StartOptions } from '../settings.ts';
import { mountCloseButton } from './closeButton.ts';
import { mountCheckList } from './checkList.ts';
import { askChoice } from './confirm.ts';
import { FILTER_OVER, openModalShell } from './modal.ts';
import { mountStartOptions } from './startOptions.ts';
import { hintLastChild } from './shortcutHints.ts';

export type AddModalModel = {
  /** The primary source's kind: how a source the panel does not know is handled. */
  /** The project's primary source (a draft with no source chosen goes there). */
  primary: SourceId;
  types: string[];
  /** Where the task goes and, in All, the Source select's options (addTask.ts addSource). */
  source: { source: SourceId; picker: Choice[] | null };
  /** The project's sources, for what each can do (capabilities); empty: everything. */
  sources: readonly SourceInfo[];
  /** The listed tasks of every source; parent, blocked-by and existing sub-task choices take the chosen source's. */
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

/** The form's wording for each source (a local feature and its tickets, a GitHub issue and its sub-issues). */
const COPY: Record<SourceId, { noParent: string; noBlockersTopLevel: string; noBlockers: string; newSubtasks: string; noExisting: string; existingSubtasks: string }> = {
  local: {
    noParent: 'None (new feature)',
    noBlockersTopLevel: 'A new feature has no blockers; pick a parent to choose tickets of that feature.',
    noBlockers: 'That feature has no open tickets.',
    newSubtasks: 'Created as tickets of the new feature, in this order.',
    noExisting: 'No open tickets or features without tickets to move.',
    existingSubtasks: 'Moved into the new feature as its tickets once it is created.',
  },
  github: {
    noParent: 'None',
    noBlockersTopLevel: 'No open issues.',
    noBlockers: 'No open issues.',
    newSubtasks: 'Created as sub-issues of the new issue, in this order.',
    noExisting: 'No open issues.',
    existingSubtasks: 'Linked as sub-issues of the new issue once it is created.',
  },
};

export const openAddModal = (
  model: AddModalModel,
  callbacks: AddModalCallbacks,
): AddModalHandle => {
  const d: AddDraft = emptyDraft(model.suggest);
  if (!model.suggest) d.type = model.types.includes('enhancement') ? 'enhancement' : NONE;
  d.source = model.source.source;
  const ALL_CAPS: SourceInfo['capabilities'] = { create: true, subtasks: true, blockedBy: true, claim: true, delete: true };
  /** What the chosen source can do; a source missing from the config can do everything. */
  const caps = (): SourceInfo['capabilities'] => model.sources.find((s) => s.id === d.source)?.capabilities ?? ALL_CAPS;
  /** How the chosen source works (wording, local file rules). */
  const kind = (): SourceId => sourceOr(d.source, model.primary);
  /** The chosen source's tasks: the only ones the form offers. */
  const tasks = (): Task[] => sourceTasks(model.tasks, d.source);
  /** The wording of the chosen source. */
  const copy = (): (typeof COPY)[SourceId] => COPY[kind()];
  const parentOptions = (): Choice[] => [{ id: NONE, label: copy().noParent }, ...parentChoices(tasks())];
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
  const sourceCell = el('div', 'kb-field');
  const parentCell = el('div', 'kb-field');
  if (model.source.picker !== null) parentSlot.append(sourceCell);
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
  /** The Source select (All only): a new source re-scopes everything picked so far. */
  const sourceSelect =
    model.source.picker === null
      ? null
      : mountSelect(sourceCell, {
          label: 'Source',
          value: d.source,
          options: model.source.picker,
          onChange: (id) => {
            Object.assign(d, withSource(d, id as SourceId, model.tasks, model.sources.find((s) => s.id === id)?.capabilities ?? ALL_CAPS));
            sourceSelect?.update({ value: id });
            drawParent();
            drawBlockers();
            drawSubtasks();
            drawExisting();
            drawStart();
          },
        });
  const parentSelect = mountSelect(parentCell, {
    label: 'Parent',
    value: d.parentId,
    options: parentOptions(),
    searchable: parentOptions().length - 1 > FILTER_OVER,
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
  /** The chosen source's parents; hidden where it takes no sub-tasks. */
  const drawParent = (): void => {
    const options = parentOptions();
    parentCell.hidden = !caps().subtasks;
    parentSelect.update({ value: d.parentId, options, searchable: options.length - 1 > FILTER_OVER });
  };
  drawParent();
  const fixed = [titleField, typeSelect, stateSelect, parentSelect, bodyField, ...(sourceSelect === null ? [] : [sourceSelect])];

  // --- blocked by: checkboxes of what addTask.ts offers for this parent ---
  let blockerDisposers: Array<() => void> = [];
  let blockerFilter = '';
  const drawBlockers = (): void => {
    for (const x of blockerDisposers) x();
    blockerDisposers = [];
    blockersBox.replaceChildren();
    const offered = caps().blockedBy ? blockerChoices(tasks(), kind(), d.parentId) : [];
    d.blockedBy = keepOffered(d.blockedBy, offered);
    blockersBox.hidden = !caps().blockedBy;
    if (blockersBox.hidden) return;
    blockersBox.append(el('h3', 'kb-settings-heading', 'Blocked by'));
    if (offered.length === 0) {
      const why = d.parentId === NONE ? copy().noBlockersTopLevel : copy().noBlockers;
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
    subBox.hidden = !caps().subtasks;
    if (subBox.hidden) return;
    subBox.append(el('h3', 'kb-settings-heading', 'Sub-tasks'));
    if (!canHaveSubtasks(kind(), d.parentId)) {
      subBox.append(el('p', 'kb-muted', 'A ticket of a feature cannot have sub-tasks here; choose no parent to create a feature with sub-tasks.'));
      return;
    }
    subBox.append(
      el(
        'p',
        'kb-muted',
        copy().newSubtasks,
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
    const offered = caps().subtasks ? existingSubtaskChoices(tasks(), kind(), d.parentId) : [];
    d.existing = keepOffered(d.existing, offered);
    // Where the new task takes no sub-tasks, the Sub-tasks section already says why.
    existingBox.hidden = !caps().subtasks || !canHaveSubtasks(kind(), d.parentId);
    if (existingBox.hidden) return;
    existingBox.append(el('h3', 'kb-settings-heading', 'Existing sub-tasks'));
    if (offered.length === 0) {
      existingBox.append(el('p', 'kb-muted', copy().noExisting));
      return;
    }
    existingBox.append(
      el(
        'p',
        'kb-muted',
        copy().existingSubtasks,
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
    const inherited = s === null ? null : s.inherited(draftType(d), draftSubtasks(d, kind()));
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
