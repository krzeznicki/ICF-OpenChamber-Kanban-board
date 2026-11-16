// The task modal, opened by a click on any card. A header (title, id, badges, Edit, Delete, ×, and
// the task's session: "Open session" or why not; "Unarchive" for an archived task), a compact row
// (State, Type, Parent with "No parent", Move to), then collapsible sections whose open state is
// remembered: Summary, Task (the body as markdown, or the Edit form, ui/editForm.ts), Sub-tasks
// (rows with Unlink; "Add sub-task" opens New task / Existing tasks) and Settings (Open on GitHub,
// start options, ui/startOptions.ts). It sits on the modal shell (ui/modal.ts), draws what it is
// given and reports choices; the editor (edit.ts) runs them and asks to confirm.
import { mountBadge, mountBanner, mountButton, mountList, mountSelect, mountSpinner, mountTabs, mountTextField } from '@openchamber/sdk/ui';
import type { Tone } from '@openchamber/sdk/ui';
import type { Task, TaskState } from '../../core/types.ts';
import type { Column } from '../columns.ts';
import { subtaskModes, type SubtaskMode } from '../addTask.ts';
import type { LinkChoice } from '../link.ts';
import type { Preset } from '../presets.ts';
import type { StartLists } from '../models.ts';
import type { CardOptions, Sections, StartOptions } from '../settings.ts';
import type { SummaryStatus } from '../summaries.ts';
import type { EditText } from '../taskEdit.ts';
import { mountCloseButton } from './closeButton.ts';
import { askChoice } from './confirm.ts';
import { renderMarkdown } from './markdownView.ts';
import { FILTER_OVER, openModalShell } from './modal.ts';
import { mountEditForm } from './editForm.ts';
import { mountStartOptions } from './startOptions.ts';

const NO_TYPE = '';
/** The Parent picker's "No parent" option, offered while the task has a parent: picking it unlinks. */
const NO_PARENT = '';

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
  /**
   * Linking existing tasks (link.ts linkChoices): `parent` is the task's current parent (shown as the
   * Parent picker's value), `parents` the ones it may move under (empty hides the picker unless a
   * parent is set), `children` the tasks "Existing tasks" may make its sub-tasks (empty hides it).
   */
  links: { parent: LinkChoice | null; parents: LinkChoice[]; children: LinkChoice[] };
  /** What the Edit form starts with (taskEdit.ts editableText). */
  text: EditText;
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
  /** The model and agent lists of the start pickers. */
  lists: StartLists;
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
  /** The Parent picker: resolves to null on success, or the message to show under it. */
  onSetParent: (parentId: string) => Promise<string | null>;
  /** A pick in "Existing tasks": resolves to null on success, or the message to show under it. */
  onLinkChild: (childId: string) => Promise<string | null>;
  /**
   * The Edit form's Save, with the values the form opened with (only what differs from them is
   * saved): resolves to null on success (the form closes), or the message to show in it.
   */
  onEdit: (from: EditText, draft: EditText) => Promise<string | null>;
  /** The header's "Delete" (the editor confirms first). */
  onDelete: () => void;
  /** "No parent" in the Parent picker: resolves to null on success, or the message to show under it. */
  onRemoveParent: () => Promise<string | null>;
  /** "Unlink" on a sub-task row (the caller confirms): resolves to null on success or cancel, or the message to show. */
  onUnlinkChild: (childId: string) => Promise<string | null>;
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
  // Escape, a backdrop click and the close button: an Edit form with typed text asks first, so a
  // stray key does not throw the draft away.
  let asking = false;
  const dismiss = (): void => {
    if (asking) return;
    if (editing === null || !editing.dirty()) return callbacks.onDismiss();
    asking = true;
    void askChoice('Discard changes?', 'The title or description you edited has not been saved.', [
      { id: 'discard', label: 'Discard', variant: 'destructive' },
    ]).then((answer) => {
      asking = false;
      if (answer === 'discard') callbacks.onDismiss();
    });
  };
  const shell = openModalShell({ label: initial.task.title, onDismiss: dismiss });
  const { modal } = shell;
  const head = el('header', 'kb-modal-head');
  // State, Type and Move to: above the task text, outside the collapsible sections.
  const quick = el('div', 'kb-quick');

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
  const subList = el('div', 'kb-sheet-part kb-sub-rows');
  // "Add sub-task": a button until clicked, then a head (tabs "New task" / "Existing tasks" and
  // Cancel) over one of the two boxes, so the section stays compact when nothing is being added.
  const adderBox = el('div', 'kb-sheet-part kb-add-sub');
  const adderHead = el('div', 'kb-add-sub-head');
  const addBox = el('div', 'kb-sheet-part');
  const linkBox = el('div', 'kb-sheet-part');
  adderBox.append(adderHead, addBox, linkBox);
  subSec.content.append(subList, adderBox);
  modal.append(head, quick, summarySec.box, taskSec.box, subSec.box, settingsSec.box);

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
        lists: callbacks.lists,
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
    disposers.push(mountCloseButton(closeSlot, dismiss));
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
    if (editing === null) {
      disposers.push(
        mountButton(session, { label: 'Edit', variant: 'ghost', size: 'sm', disabled: m.busy, onClick: () => startEdit(m) }).dispose,
      );
      disposers.push(mountButton(session, { label: 'Delete', variant: 'ghost', size: 'sm', disabled: m.busy, onClick: callbacks.onDelete }).dispose);
    }
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
  /** The open Edit form: it stays in place across updates (what is typed survives a poll). */
  let editing: { taskId: string; dispose: () => void; dirty: () => boolean } | null = null;
  const stopEdit = (): void => {
    editing?.dispose();
    editing = null;
    taskKey = null;
  };
  const startEdit = (m: DetailModel): void => {
    if (editing !== null) return;
    const box = taskSec.content;
    box.replaceChildren();
    taskKey = null;
    const form = mountEditForm(box, m.text, (draft) => callbacks.onEdit(m.text, draft), () => {
      stopEdit();
      if (current !== null) draw(current);
    });
    editing = { taskId: m.task.id, ...form };
    taskSec.box.open = true;
    if (current !== null) draw(current); // the header drops its Edit button
    box.querySelector('input')?.focus();
  };
  const drawTask = (m: DetailModel): void => {
    const { task } = m;
    if (editing !== null && editing.taskId !== task.id) stopEdit(); // another task now (a link moved it)
    if (editing !== null) return;
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

  /** The last failed "Unlink", shown under the sub-task list until the task changes or another unlink. */
  let unlinkError: { taskId: string; message: string } | null = null;
  const drawChildren = (m: DetailModel): void => {
    subSec.box.hidden = m.children.length === 0 && !m.addSubtask && m.links.children.length === 0;
    drawAdder(m);
    if (m.children.length === 0) {
      subSec.label.textContent = 'Sub-tasks';
      return;
    }
    const done = m.children.filter((c) => c.state === 'done').length;
    subSec.label.textContent = `Sub-tasks (${done}/${m.children.length} done)`;
    if (unlinkError !== null && unlinkError.taskId !== m.task.id) unlinkError = null;
    // One row per sub-task: the list item opens it, "Unlink" next to it removes it from this parent.
    // The SDK list has no row actions, so each row is a one-item list beside its own button.
    for (const c of m.children) {
      const row = el('div', 'kb-sub-row');
      const item = el('div', 'kb-sub-row-item');
      const action = el('div', 'kb-sub-row-action');
      row.append(item, action);
      subList.append(row);
      disposers.push(
        mountList(item, {
          items: [{ id: c.id, title: c.title, subtitle: c.id, badge: { label: c.state, tone: stateTone(c.state) } }],
          onSelect: callbacks.onOpenTask,
          ariaLabel: `Sub-task ${c.title}`,
        }).dispose,
        mountButton(action, {
          label: 'Unlink',
          variant: 'ghost',
          size: 'xs',
          disabled: m.busy,
          onClick: () => {
            const taskId = m.task.id;
            unlinkError = null;
            void callbacks.onUnlinkChild(c.id).then((error) => {
              if (disposed || error === null) return;
              unlinkError = { taskId, message: error };
              if (current !== null) draw(current);
            });
          },
        }).dispose,
      );
    }
    if (unlinkError !== null) {
      const errorSlot = el('div', 'kb-add-error');
      subList.append(errorSlot);
      disposers.push(mountBanner(errorSlot, { tone: 'error', title: 'Could not unlink the sub-task', body: unlinkError.message }).dispose);
    }
  };

  /**
   * The State / Type / Move to row redraws only when what it shows changes (like the Task section),
   * so an open select or a focused button survives a poll. Its handlers capture the task's id,
   * state and type, which are part of the key.
   */
  let quickKey: string | null = null;
  /** The Parent picker's last failure, shown until the task changes or another pick. */
  let parentError: { taskId: string; message: string } | null = null;
  let quickDisposers: Array<() => void> = [];
  const clearQuick = (): void => {
    for (const d of quickDisposers) d();
    quickDisposers = [];
    quick.replaceChildren();
  };
  const drawQuick = (m: DetailModel): void => {
    const { task } = m;
    if (parentError !== null && parentError.taskId !== task.id) parentError = null;
    const key = JSON.stringify([task.id, task.state, task.type, m.types, m.labels, m.moves, m.busy, m.links.parent, m.links.parents, parentError]);
    if (key === quickKey) return;
    quickKey = key;
    clearQuick();
    const disposers = quickDisposers;
    const fields = el('div', 'kb-quick-fields');
    const stateSlot = el('div', 'kb-field');
    const typeSlot = el('div', 'kb-field');
    fields.append(stateSlot, typeSlot);
    quick.append(fields);
    const { parent, parents } = m.links;
    // A set parent is shown even when there is nowhere else to move the task.
    if (parents.length > 0 || parent !== null) {
      const parentSlot = el('div', 'kb-field');
      fields.append(parentSlot);
      const listed = parent !== null && !parents.some((p) => p.id === parent.id) ? [parent, ...parents] : parents;
      // With a parent set, "No parent" unlinks it.
      const options = parent !== null ? [{ id: NO_PARENT, label: 'No parent', hint: 'Unlink from the parent' }, ...listed] : listed;
      disposers.push(
        mountSelect(parentSlot, {
          label: 'Parent',
          value: parent?.id ?? null,
          placeholder: 'No parent',
          options,
          searchable: options.length > FILTER_OVER,
          disabled: m.busy,
          onChange: (id) => {
            if (id === task.parentId) return;
            const taskId = task.id;
            quickKey = null; // snaps back until the reload shows the new parent
            parentError = null;
            const change = id === NO_PARENT ? callbacks.onRemoveParent() : callbacks.onSetParent(id);
            void change.then((error) => {
              if (disposed || error === null) return;
              parentError = { taskId: current?.task.id ?? taskId, message: error };
              quickKey = null;
              if (current !== null) drawQuick(current);
            });
          },
        }).dispose,
      );
    }
    if (parentError !== null) {
      const errorSlot = el('div', 'kb-add-error');
      quick.append(errorSlot);
      disposers.push(mountBanner(errorSlot, { tone: 'error', title: 'Could not change the parent', body: parentError.message }).dispose);
    }
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
          if (id === task.state) return;
          // The change may be cancelled or skipped (Close …? dialog, beforeMove): the next update
          // must redraw so the select snaps back to the task's real state.
          quickKey = null;
          callbacks.onState(id as TaskState);
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
          if (id === task.type) return;
          quickKey = null; // as for State: a skipped or failed change must snap back on the next update
          callbacks.onType(id);
        },
      }).dispose,
    );

    if (m.moves.length > 0) {
      const moveRow = el('div', 'kb-actions kb-actions-start kb-quick-moves');
      moveRow.setAttribute('role', 'group');
      moveRow.setAttribute('aria-label', 'Move to');
      moveRow.append(el('span', 'kb-actions-label', 'Move to'));
      for (const { to, label } of m.moves) {
        disposers.push(
          mountButton(moveRow, { label, variant: 'outline', size: 'xs', disabled: m.busy, onClick: () => callbacks.onMove(to) }).dispose,
        );
      }
      quick.append(moveRow);
    }
  };

  const drawSettings = (m: DetailModel): void => {
    const { task } = m;
    // Left with nothing (a local task without start options, e.g. done), the section hides.
    // `start` is null for a done task or while no project settings are loaded (edit.ts detailModel).
    settingsSec.box.hidden = task.url === null && m.start === null;
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
    if (key === null) return;
    addHandle = mountAddSubtask(addBox, m.types, callbacks.onAddSubtask);
  };

  // "Existing tasks": a select that links the picked task as a sub-task at once. Redrawn only
  // when what it offers changes, so an open popup survives a poll.
  let linkKey: string | null = null;
  let linkError: { taskId: string; message: string } | null = null;
  let linkDisposers: Array<() => void> = [];
  const clearLink = (): void => {
    for (const d of linkDisposers) d();
    linkDisposers = [];
    linkBox.replaceChildren();
  };
  const drawLinkChild = (m: DetailModel): void => {
    const { task } = m;
    if (linkError !== null && linkError.taskId !== task.id) linkError = null;
    const offered = m.links.children;
    const key = JSON.stringify([task.id, offered, m.busy, linkError]);
    if (key === linkKey) return;
    linkKey = key;
    clearLink();
    if (offered.length === 0) return;
    const slot = el('div', 'kb-field');
    const errorSlot = el('div', 'kb-add-error');
    linkBox.append(slot, errorSlot);
    linkDisposers.push(
      mountSelect(slot, {
        label: 'Make a sub-task of this one',
        value: null,
        placeholder: 'Choose a task',
        options: offered,
        searchable: offered.length > FILTER_OVER,
        disabled: m.busy,
        onChange: (id) => {
          const taskId = task.id;
          linkKey = null; // back to "Choose a task" on the next update
          linkError = null;
          void callbacks.onLinkChild(id).then((error) => {
            if (disposed || error === null) return;
            linkError = { taskId, message: error };
            linkKey = null;
            if (current !== null) drawLinkChild(current);
          });
        },
      }).dispose,
    );
    if (linkError !== null) {
      linkDisposers.push(mountBanner(errorSlot, { tone: 'error', title: 'Could not link the task', body: linkError.message }).dispose);
    }
  };

  /** The open "Add sub-task" and its tab; null while only the button shows. Closes when the task changes. */
  let adder: { taskId: string; mode: SubtaskMode } | null = null;
  let adderKey: string | null = null;
  let adderDisposers: Array<() => void> = [];
  const clearAdderHead = (): void => {
    for (const d of adderDisposers) d();
    adderDisposers = [];
    adderHead.replaceChildren();
  };
  const drawAdder = (m: DetailModel): void => {
    const existing = m.links.children.length;
    const modes = subtaskModes(m.addSubtask, existing);
    if (adder !== null && (adder.taskId !== m.task.id || modes.length === 0)) adder = null;
    if (adder !== null && !modes.includes(adder.mode)) adder = { taskId: adder.taskId, mode: modes[0]! };
    adderBox.hidden = modes.length === 0;
    // The head redraws only when it changes, like the other parts, so a focused tab survives a poll;
    // the boxes keep their own keys (what is being typed survives too).
    const key = JSON.stringify([m.task.id, modes, existing, adder]);
    if (key !== adderKey) {
      adderKey = key;
      clearAdderHead();
      const redraw = (): void => {
        if (current !== null) drawAdder(current);
      };
      if (adder === null) {
        const actions = el('div', 'kb-actions kb-actions-start');
        adderHead.append(actions);
        adderDisposers.push(
          mountButton(actions, {
            label: 'Add sub-task',
            variant: 'outline',
            size: 'xs',
            onClick: () => {
              adder = { taskId: m.task.id, mode: modes[0]! };
              redraw();
              if (adder.mode === 'new') addBox.querySelector('input')?.focus();
            },
          }).dispose,
        );
      } else {
        const open = adder;
        const pick = el('div', 'kb-add-sub-modes');
        const cancel = el('div', 'kb-add-sub-cancel');
        adderHead.append(pick, cancel);
        if (modes.length > 1) {
          const tabs = mountTabs(pick, {
            items: [
              { id: 'new', label: 'New task' },
              { id: 'existing', label: 'Existing tasks', count: existing },
            ],
            activeId: open.mode,
            onChange: (id) => {
              adder = { taskId: open.taskId, mode: id as SubtaskMode };
              redraw();
            },
          });
          adderDisposers.push(tabs.dispose);
        } else {
          pick.append(el('h3', 'kb-settings-heading', open.mode === 'new' ? 'New sub-task' : 'Existing tasks'));
        }
        adderDisposers.push(
          mountButton(cancel, {
            label: 'Cancel',
            variant: 'ghost',
            size: 'xs',
            onClick: () => {
              adder = null;
              redraw();
            },
          }).dispose,
        );
      }
    }
    drawAddSubtask(m);
    drawLinkChild(m);
    addBox.hidden = adder?.mode !== 'new';
    linkBox.hidden = adder?.mode !== 'existing';
  };

  let current: DetailModel | null = null;
  let disposed = false;
  const draw = (m: DetailModel): void => {
    current = m;
    clear();
    modal.setAttribute('aria-label', m.task.title);
    modal.setAttribute('aria-busy', String(m.busy));
    drawHead(m);
    drawQuick(m);
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
      disposed = true;
      clear();
      clearStart();
      clearQuick();
      clearLink();
      editing?.dispose();
      clearAdderHead();
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
