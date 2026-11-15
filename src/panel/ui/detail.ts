// The task modal, opened by a click on any card: reading first. A header (title, id, state and type
// badges, ×, and "Open session" when the task has a session that may be opened, or "Session
// archived"; "Unarchive" for a task archived by "Archive done"), then collapsible sections: Summary (the personal summary or a Summarise button), Task
// (the body as formatted markdown, ui/markdownView.ts), Sub-tasks (a parent's children, a click
// opens that task, and "Add sub-task" where addTask.ts allows it) and Settings, collapsed by
// default: state and type selects, "Move to" buttons (the keyboard path for drag and drop; Done
// asks about open sub-tasks), Open on GitHub, and the card's start options (ui/startOptions.ts).
// It sits on the shell it shares with Add task (ui/modal.ts). Which sections are open is
// remembered (settings.ts Sections). It draws what it is given and reports choices; the editor
// (edit.ts) runs them and asks to confirm.
import { mountBadge, mountBanner, mountButton, mountList, mountSelect, mountSpinner, mountTextField } from '@openchamber/sdk/ui';
import type { Tone } from '@openchamber/sdk/ui';
import type { Task, TaskState } from '../../core/types.ts';
import type { Column } from '../columns.ts';
import type { Preset } from '../presets.ts';
import type { CardOptions, Sections, StartOptions } from '../settings.ts';
import type { SummaryStatus } from '../summaries.ts';
import { mountCloseButton } from './closeButton.ts';
import { renderMarkdown } from './markdownView.ts';
import { openModalShell } from './modal.ts';
import { mountStartOptions } from './startOptions.ts';

const NO_TYPE = '';

export const STATES: readonly TaskState[] = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix', 'done'];

export type DetailModel = {
  task: Task;
  column: Column;
  openChildren: number;
  types: string[];
  /** Role -> label in the repo (triage-labels.md); shown as a hint when it differs. */
  labels: Record<string, string>;
  /** Targets whose move does something, in board order. */
  moves: { to: Column; label: string }[];
  busy: boolean;
  /** The card's start options; null hides the section (e.g. a done task). */
  start: StartModel | null;
  /** The personal summary; null hides it (no project settings yet). */
  summary: SummaryModel | null;
  /** What the header offers for the task's session (columns.ts sessionTarget, after any lookup). */
  session: SessionView;
  /** A parent's listed sub-tasks, in board order; empty hides the section. */
  children: { id: string; title: string; state: TaskState }[];
  /** The Sub-tasks section offers "Add sub-task" (addTask.ts canAddSubtask); it then shows even without children. */
  addSubtask: boolean;
  /** An archived done task (archive.ts): an "archived" badge and an "Unarchive" button in the header. */
  archived: boolean;
};

/**
 * `open`: an "Open session" button; `archived`: muted "Session archived"; `missing`: muted "Session
 * not listed in OpenChamber" (a linked session no host snapshot lists: never opened); `checking`:
 * the session is being looked up; `none`: nothing.
 */
export type SessionView = 'open' | 'archived' | 'missing' | 'checking' | 'none';

export type SummaryModel = {
  /** The summary of the task's current body, or null. */
  text: string | null;
  status: SummaryStatus;
  /** Summaries are generated on their own (the setting, and a model is there). */
  auto: boolean;
};

export type StartModel = {
  presets: Preset[];
  /** What the card itself sets (stored under card:<projectId>:<taskId>). */
  card: CardOptions;
  /** What the card would start with if it set nothing. */
  inherited: StartOptions;
  /** The summary language from the settings, shown when the card sets none. */
  summaryLanguage: string;
  /** Bumped when the stored card options were (re)loaded; the section then redraws. */
  version: number;
};

export type DetailCallbacks = {
  onStartOptions: (card: CardOptions) => void;
  /** The model picker's list (loaded once per panel session). */
  loadModels: () => Promise<string[]>;
  /** The Summarise button. */
  onSummarise: () => void;
  onMove: (to: Column) => void;
  onState: (state: TaskState) => void;
  onType: (type: string) => void;
  onOpenUrl: (url: string) => void;
  /** The header's "Open session". */
  onOpenSession: () => void;
  /** A sub-task row. */
  onOpenTask: (taskId: string) => void;
  /** "Add sub-task": resolves to null on success, or the message to show under it. */
  onAddSubtask: (input: { title: string; type: string | null }) => Promise<string | null>;
  /** The user opened or collapsed a section. */
  onSections: (sections: Sections) => void;
  /** "Unarchive" on an archived task: it shows in Done again. */
  onUnarchive: () => void;
  onDismiss: () => void;
};

export type DetailOptions = { sections: Sections };

const stateTone = (state: TaskState): Tone =>
  state === 'done' ? 'success' : state === 'ready-for-agent' ? 'primary' : state === 'wontfix' ? 'neutral' : state === 'ready-for-human' ? 'info' : 'warning';

export type DetailHandle = { update: (model: DetailModel) => void; dispose: () => void };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const openDetail = (initial: DetailModel, callbacks: DetailCallbacks, options: DetailOptions): DetailHandle => {
  const shell = openModalShell({ label: initial.task.title, onDismiss: () => callbacks.onDismiss() });
  const { modal } = shell;
  const head = el('header', 'kb-modal-head');

  // The sections stay in place across updates (their open state, a focused start option field and
  // the reading position survive a reload); their contents redraw.
  const open: Sections = { ...options.sections };
  const section = (key: keyof Sections, title: string) => {
    const box = el('details', 'kb-section');
    box.open = open[key];
    const label = el('summary', 'kb-section-head', title);
    const content = el('div', 'kb-section-body');
    box.append(label, content);
    box.addEventListener('toggle', () => {
      // Our own setting of `open` fires a toggle too; only a change from what we hold is the user's.
      if (box.open === open[key]) return;
      open[key] = box.open;
      callbacks.onSections({ ...open });
    });
    return { box, label, content };
  };
  const summarySec = section('summary', 'Summary');
  const taskSec = section('task', 'Task');
  const subSec = section('subtasks', 'Sub-tasks');
  const settingsSec = section('settings', 'Settings');
  const settingsTop = el('div', 'kb-sheet-part');
  const startBox = el('section', 'kb-sheet-part kb-start');
  settingsSec.content.append(settingsTop, startBox);
  const subList = el('div', 'kb-sheet-part');
  const addBox = el('div', 'kb-sheet-part kb-add-sub');
  subSec.content.append(subList, addBox);
  modal.append(head, summarySec.box, taskSec.box, subSec.box, settingsSec.box);

  let disposers: Array<() => void> = [];
  const clear = (): void => {
    for (const d of disposers) d();
    disposers = [];
    head.replaceChildren();
    summarySec.content.replaceChildren();
    subList.replaceChildren();
    settingsTop.replaceChildren();
  };
  let startDisposers: Array<() => void> = [];
  let startKey: string | null = null;
  const clearStart = (): void => {
    for (const d of startDisposers) d();
    startDisposers = [];
    startBox.replaceChildren();
  };

  const drawStart = (taskId: string, start: StartModel | null): void => {
    const key =
      start === null
        ? null
        : JSON.stringify([taskId, start.version, start.inherited, start.summaryLanguage, start.presets.map((p) => [p.id, p.name])]);
    if (key === startKey) return;
    startKey = key;
    clearStart();
    startBox.hidden = start === null;
    if (start === null) return;
    startBox.append(el('h3', 'kb-settings-heading', 'Start options'));
    startDisposers.push(
      mountStartOptions(startBox, {
        presets: start.presets,
        card: start.card,
        inherited: start.inherited,
        summaryLanguage: start.summaryLanguage,
        loadModels: callbacks.loadModels,
        onChange: callbacks.onStartOptions,
      }),
    );
  };

  const drawHead = (m: DetailModel): void => {
    const { task } = m;
    const top = el('div', 'kb-sheet-head');
    const titles = el('div', 'kb-sheet-titles');
    titles.append(el('h2', 'kb-sheet-title', task.title), el('div', 'kb-card-id', task.id));
    const closeSlot = el('div', 'kb-sheet-x');
    top.append(titles, closeSlot);
    disposers.push(mountCloseButton(closeSlot, callbacks.onDismiss));
    head.append(top);

    const row = el('div', 'kb-modal-bar');
    const badges = el('div', 'kb-badges');
    const label = m.labels[task.state];
    disposers.push(mountBadge(badges, { label: label !== undefined && label !== task.state ? label : task.state, tone: stateTone(task.state) }).dispose);
    if (task.type !== null) disposers.push(mountBadge(badges, { label: task.type, tone: 'neutral' }).dispose);
    if (task.kind === 'parent') disposers.push(mountBadge(badges, { label: 'parent', tone: 'primary' }).dispose);
    if (m.archived) disposers.push(mountBadge(badges, { label: 'archived', tone: 'neutral' }).dispose);
    if (m.busy) {
      const spin = el('span', 'kb-inline-spin');
      badges.append(spin);
      disposers.push(mountSpinner(spin, { size: 'sm', label: 'Saving' }).dispose);
    }
    row.append(badges);
    const session = el('div', 'kb-modal-session');
    if (m.archived) {
      disposers.push(mountButton(session, { label: 'Unarchive', variant: 'outline', size: 'sm', onClick: callbacks.onUnarchive }).dispose);
    }
    if (m.session === 'open') {
      disposers.push(mountButton(session, { label: 'Open session', variant: 'default', size: 'sm', onClick: callbacks.onOpenSession }).dispose);
    } else if (m.session === 'archived') {
      session.append(el('span', 'kb-muted', 'Session archived'));
    } else if (m.session === 'missing') {
      session.append(el('span', 'kb-muted', 'Session not listed in OpenChamber'));
    } else if (m.session === 'checking') {
      const spin = el('span', 'kb-inline-spin');
      session.append(spin);
      disposers.push(mountSpinner(spin, { size: 'sm', label: 'Looking up the session' }).dispose);
    }
    row.append(session);
    head.append(row);
  };

  const drawSummary = (m: DetailModel): void => {
    const sum = m.summary;
    summarySec.box.hidden = sum === null;
    if (sum === null) return;
    const box = summarySec.content;
    if (sum.text !== null) {
      box.append(el('p', 'kb-summary-text', sum.text));
    } else if (sum.status === 'pending') {
      const note = el('p', 'kb-summary-note');
      const spin = el('span', 'kb-inline-spin');
      note.append(spin, document.createTextNode('Summarising…'));
      disposers.push(mountSpinner(spin, { size: 'sm', label: 'Summarising' }).dispose);
      box.append(note);
    } else {
      const why =
        sum.status === 'failed'
          ? 'The summary could not be written.'
          : sum.status === 'unavailable'
            ? 'No small model is available for summaries.'
            : sum.auto
              ? 'No summary yet.'
              : 'Automatic summaries are off.';
      box.append(el('p', 'kb-summary-note', why));
      const slot = el('div', 'kb-actions kb-actions-start');
      disposers.push(mountButton(slot, { label: 'Summarise', variant: 'outline', size: 'xs', onClick: callbacks.onSummarise }).dispose);
      box.append(slot);
    }
  };

  /** The Task section redraws only when what it shows changes, so a reload keeps a text selection. */
  let taskKey: string | null = null;
  const drawTask = (m: DetailModel): void => {
    const { task } = m;
    const key = JSON.stringify([task.id, task.body, task.parentId, task.blockedBy, m.openChildren]);
    if (key === taskKey) return;
    taskKey = key;
    const box = taskSec.content;
    box.replaceChildren();
    const meta = el('dl', 'kb-meta');
    const row = (term: string, value: string): void => {
      meta.append(el('dt', '', term), el('dd', '', value));
    };
    if (task.parentId !== null) row('Parent', task.parentId);
    if (task.blockedBy.length > 0) row('Blocked by', task.blockedBy.join(', '));
    if (m.openChildren > 0) row('Open sub-tasks', String(m.openChildren));
    if (meta.childElementCount > 0) box.append(meta);
    if (task.body.trim() === '') box.append(el('p', 'kb-muted', 'No description.'));
    else box.append(renderMarkdown(task.body, callbacks.onOpenUrl));
  };

  const drawChildren = (m: DetailModel): void => {
    subSec.box.hidden = m.children.length === 0 && !m.addSubtask;
    drawAddSubtask(m);
    if (m.children.length === 0) {
      subSec.label.textContent = 'Sub-tasks';
      return;
    }
    const done = m.children.filter((c) => c.state === 'done').length;
    subSec.label.textContent = `Sub-tasks (${done}/${m.children.length} done)`;
    disposers.push(
      mountList(subList, {
        items: m.children.map((c) => ({ id: c.id, title: c.title, subtitle: c.id, badge: { label: c.state, tone: stateTone(c.state) } })),
        onSelect: callbacks.onOpenTask,
        ariaLabel: 'Sub-tasks',
      }).dispose,
    );
  };

  const drawSettings = (m: DetailModel): void => {
    const { task } = m;
    const fields = el('div', 'kb-fields');
    const stateSlot = el('div', 'kb-field');
    const typeSlot = el('div', 'kb-field');
    fields.append(stateSlot, typeSlot);
    settingsTop.append(fields);
    disposers.push(
      mountSelect(stateSlot, {
        label: 'State',
        value: task.state,
        options: STATES.map((s) => {
          const label = m.labels[s];
          return { id: s, label: s, ...(label !== undefined && label !== s ? { hint: label } : {}) };
        }),
        disabled: m.busy,
        onChange: (id) => {
          if (id !== task.state) callbacks.onState(id as TaskState);
        },
      }).dispose,
    );
    const types = task.type !== null && !m.types.includes(task.type) ? [...m.types, task.type] : m.types;
    disposers.push(
      mountSelect(typeSlot, {
        label: 'Type',
        value: task.type,
        placeholder: 'No type',
        options: types.map((t) => ({ id: t, label: t })),
        disabled: m.busy,
        onChange: (id) => {
          if (id !== task.type) callbacks.onType(id);
        },
      }).dispose,
    );

    if (m.moves.length > 0) {
      const moveRow = el('div', 'kb-actions kb-actions-start');
      moveRow.append(el('span', 'kb-actions-label', 'Move to'));
      for (const { to, label } of m.moves) {
        disposers.push(
          mountButton(moveRow, { label, variant: 'outline', size: 'xs', disabled: m.busy, onClick: () => callbacks.onMove(to) }).dispose,
        );
      }
      settingsTop.append(moveRow);
    }

    const url = task.url;
    if (url !== null) {
      const actions = el('div', 'kb-actions kb-actions-start');
      disposers.push(
        mountButton(actions, { label: 'Open on GitHub', variant: 'ghost', size: 'sm', onClick: () => callbacks.onOpenUrl(url) }).dispose,
      );
      settingsTop.append(actions);
    }
    drawStart(task.id, m.start);
  };

  // "Add sub-task" stays in place across redraws (a reload must not drop what is being typed); it
  // is rebuilt only when the task or whether it may take sub-tasks changes.
  let addKey: string | null = null;
  let addTypes = '';
  let addHandle: { setTypes: (types: string[]) => void; dispose: () => void } | null = null;
  const drawAddSubtask = (m: DetailModel): void => {
    const key = m.addSubtask ? m.task.id : null;
    if (key === addKey) {
      const types = JSON.stringify(m.types);
      if (types !== addTypes) addHandle?.setTypes(m.types);
      addTypes = types;
      return;
    }
    addKey = key;
    addTypes = JSON.stringify(m.types);
    addHandle?.dispose();
    addHandle = null;
    addBox.replaceChildren();
    addBox.hidden = key === null;
    if (key === null) return;
    addHandle = mountAddSubtask(addBox, m.types, callbacks.onAddSubtask);
  };

  const draw = (m: DetailModel): void => {
    clear();
    modal.setAttribute('aria-label', m.task.title);
    modal.setAttribute('aria-busy', String(m.busy));
    drawHead(m);
    drawSummary(m);
    drawTask(m);
    drawChildren(m);
    drawSettings(m);
  };

  draw(initial);
  modal.focus();

  return {
    update: draw,
    dispose: () => {
      clear();
      clearStart();
      addHandle?.dispose();
      shell.dispose();
    },
  };
};

/**
 * The Sub-tasks section's inline "Add sub-task": a title, an optional type and Add. Enter adds.
 * The service's error shows under it; on success the title clears for the next one.
 */
const mountAddSubtask = (
  box: HTMLElement,
  types: string[],
  onAdd: (input: { title: string; type: string | null }) => Promise<string | null>,
): { setTypes: (types: string[]) => void; dispose: () => void } => {
  box.append(el('h3', 'kb-settings-heading', 'Add sub-task'));
  const row = el('div', 'kb-fields kb-add-sub-row');
  const titleSlot = el('div', 'kb-field kb-add-sub-title');
  const typeSlot = el('div', 'kb-field kb-add-sub-type');
  const buttonSlot = el('div', 'kb-add-sub-button');
  row.append(titleSlot, typeSlot, buttonSlot);
  const errorSlot = el('div', 'kb-add-error');
  box.append(row, errorSlot);

  let title = '';
  let type = NO_TYPE;
  let busy = false;
  let errorDispose: (() => void) | null = null;
  let disposed = false;
  const typeOptions = (list: string[]) => [{ id: NO_TYPE, label: 'No type' }, ...list.map((t) => ({ id: t, label: t }))];

  const titleField = mountTextField(titleSlot, {
    label: 'Title',
    value: '',
    placeholder: 'A sub-task of this task',
    onChange: (v) => {
      title = v;
      titleField.update({ value: v, ...(v.trim() !== '' ? { error: undefined } : {}) });
    },
  });
  const typeSelect = mountSelect(typeSlot, {
    label: 'Type',
    value: type,
    options: typeOptions(types),
    onChange: (id) => {
      type = id;
      typeSelect.update({ value: id });
    },
  });
  const add = mountButton(buttonSlot, { label: 'Add', size: 'sm', variant: 'outline', onClick: () => submit() });

  const showError = (message: string | null): void => {
    errorDispose?.();
    errorDispose = null;
    if (message !== null) errorDispose = mountBanner(errorSlot, { tone: 'error', title: 'Could not add the sub-task', body: message }).dispose;
  };
  const setBusy = (next: boolean): void => {
    busy = next;
    add.update({ loading: next, disabled: next });
    titleField.update({ disabled: next });
    typeSelect.update({ disabled: next });
  };
  const submit = (): void => {
    if (busy) return;
    const t = title.trim();
    if (t === '') {
      titleField.update({ error: 'A title is required' });
      titleSlot.querySelector('input')?.focus();
      return;
    }
    showError(null);
    setBusy(true);
    void onAdd({ title: t, type: type === NO_TYPE ? null : type }).then((error) => {
      if (disposed) return;
      setBusy(false);
      showError(error);
      if (error === null) {
        title = '';
        titleField.update({ value: '' });
      }
      titleSlot.querySelector('input')?.focus();
    });
  };
  titleSlot.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    submit();
  });

  return {
    setTypes: (list) => typeSelect.update({ options: typeOptions(list) }),
    dispose: () => {
      disposed = true;
      errorDispose?.();
      titleField.dispose();
      typeSelect.dispose();
      add.dispose();
    },
  };
};
