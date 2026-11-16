// The board shell: a toolbar (a TEST badge in the test build, project switcher, "Hide sub-tasks", a search field,
// Add task, Settings, Refresh), a status slot for banners, spinner and empty states, and the five columns. The Done header carries
// "Archive done" and "Show archived (N)" (archive.ts).
// It draws what main.ts hands it and reports clicks back; it holds no data of its own. Dragging
// is attached to `columns` by the editor (ui/dnd.ts).
import { mountBanner, mountButton, mountEmpty, mountSearchField, mountSelect, mountSpinner, mountSwitch } from '@openchamber/sdk/ui';
import type { BannerTone, SelectOption } from '@openchamber/sdk/ui';
import type { Task } from '../../core/types.ts';
import { VARIANT } from '../../core/variant.ts';
import { COLUMNS, type BoardModel } from '../columns.ts';
import type { Suggestion } from '../search.ts';
import { renderCard } from './card.ts';
import { mountSearchSuggest } from './searchSuggest.ts';

export type BoardCallbacks = {
  onProject: (projectId: string) => void;
  onHideSubtasks: (hide: boolean) => void;
  /** The search field's text, on every keystroke (search.ts filters the cards). */
  onSearch: (query: string) => void;
  /** The search field's completions for the text and caret (search.ts searchSuggestions). */
  suggest: (text: string, caret: number) => Suggestion[];
  onRefresh: () => void;
  onAdd: () => void;
  onSettings: () => void;
  /** The Done header's "Archive done" (the caller asks to confirm). */
  onArchiveDone: () => void;
  /** The Done header's "Show archived (N)" switch. */
  onShowArchived: (show: boolean) => void;
};

/** The Done header's archive tools: how many done tasks "Archive done" takes, how many are archived. */
export type DoneTools = { archivable: number; archived: number; showArchived: boolean };

const NO_TOOLS: DoneTools = { archivable: 0, archived: 0, showArchived: false };

export type BoardStatus =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'banner'; tone: BannerTone; title: string; body?: string }
  | { kind: 'empty'; title: string; body: string }
  /** Anything else drawn in the slot (the setup wizard, a notice); returns its dispose. */
  | { kind: 'custom'; mount: (slot: HTMLElement) => () => void };

const div = (className: string): HTMLDivElement => {
  const node = document.createElement('div');
  node.className = className;
  return node;
};

export const createBoard = (root: HTMLElement, callbacks: BoardCallbacks) => {
  const shell = div('kb');
  const toolbar = div('kb-toolbar');
  const projectSlot = div('kb-project');
  const switchSlot = div('kb-hide');
  const searchSlot = div('kb-search');
  const spacer = div('kb-spacer');
  const addSlot = div('kb-add-button');
  const settingsSlot = div('kb-settings-button');
  const refreshSlot = div('kb-refresh');
  toolbar.append(projectSlot, switchSlot, searchSlot, spacer, addSlot, settingsSlot, refreshSlot);
  // The local test build (npm run build:test) says so, so it is never mistaken for production.
  if (VARIANT === 'test') {
    const badge = document.createElement('span');
    badge.className = 'kb-test-badge';
    badge.textContent = 'TEST';
    badge.title = 'Kanban TEST: the local development build, separate from the production Kanban Board';
    toolbar.prepend(badge);
  }
  const status = div('kb-status');
  // The rail panel's note for its chat's session (sessionFocus.ts): independent of the status slot,
  // which every draw resets.
  const sessionNote = div('kb-session-note');
  const columns = div('kb-columns');
  shell.append(toolbar, status, sessionNote, columns);
  root.replaceChildren(shell);

  const project = mountSelect(projectSlot, {
    value: null,
    options: [],
    placeholder: 'Loading projects…',
    searchable: true,
    searchPlaceholder: 'Find a project',
    onChange: (id) => {
      project.update({ value: id });
      callbacks.onProject(id);
    },
  });
  const hideSwitch = mountSwitch(switchSlot, {
    label: 'Hide sub-tasks',
    checked: false,
    onChange: (checked) => {
      hideSwitch.update({ checked });
      callbacks.onHideSubtasks(checked);
    },
  });
  // The kit's field clears itself on Escape and with its clear button.
  const search = mountSearchField(searchSlot, {
    value: '',
    placeholder: 'Search tasks, type:, status:…',
    label: 'Search tasks by title or description, or filter with type:, state:, status: and column:',
    onChange: (query) => {
      search.update({ value: query });
      callbacks.onSearch(query);
    },
  });
  mountSearchSuggest(searchSlot, {
    suggest: callbacks.suggest,
    apply: (query) => {
      search.update({ value: query });
      callbacks.onSearch(query);
    },
  });
  const add = mountButton(addSlot, { label: 'Add task', size: 'sm', disabled: true, onClick: callbacks.onAdd });
  mountButton(settingsSlot, { label: 'Settings', variant: 'outline', size: 'sm', onClick: callbacks.onSettings });
  const refresh = mountButton(refreshSlot, { label: 'Refresh', variant: 'outline', size: 'sm', onClick: callbacks.onRefresh });

  let statusDispose: (() => void) | null = null;
  let sessionNoteDispose: (() => void) | null = null;
  const setSessionNote = (text: string | null): void => {
    sessionNoteDispose?.();
    sessionNoteDispose = null;
    sessionNote.replaceChildren();
    if (text === null) return;
    sessionNoteDispose = mountBanner(sessionNote, { tone: 'info', title: text, action: { label: 'Dismiss', onClick: () => setSessionNote(null) } }).dispose;
  };
  let cardDisposers: Array<() => void> = [];

  /** "Archive done" and "Show archived (N)" under the Done header; disposed with the cards. */
  const doneTools = (done: DoneTools): HTMLElement => {
    const tools = div('kb-column-tools');
    if (done.archivable > 0) {
      const slot = div('kb-archive-button');
      tools.append(slot);
      cardDisposers.push(mountButton(slot, { label: 'Archive done', variant: 'outline', size: 'xs', onClick: callbacks.onArchiveDone }).dispose);
    }
    if (done.archived > 0) {
      const slot = div('kb-show-archived');
      tools.append(slot);
      cardDisposers.push(
        mountSwitch(slot, { label: `Show archived (${done.archived})`, checked: done.showArchived, onChange: callbacks.onShowArchived }).dispose,
      );
    }
    return tools;
  };

  return {
    /** The persistent container the cards are drawn in; drag listeners live here. */
    columns,
    /** "Add task" works only while a board is shown. */
    setCanAdd: (enabled: boolean) => add.update({ disabled: !enabled }),
    /** The "Hide sub-tasks" switch follows the project's settings when they load. */
    setHideSubtasks: (checked: boolean) => hideSwitch.update({ checked }),
    setProjects: (options: SelectOption[], value: string | null) => {
      project.update({
        options,
        value,
        placeholder: options.length === 0 ? 'No projects' : 'Choose a project',
        disabled: options.length === 0,
      });
    },
    /** A dismissible info banner above the columns (the rail panel's session note); null removes it. */
    setSessionNote,
    setBusy: (busy: boolean) => refresh.update({ loading: busy, disabled: busy }),
    setStatus: (next: BoardStatus) => {
      statusDispose?.();
      statusDispose = null;
      status.replaceChildren();
      if (next.kind === 'loading') {
        const wrap = div('kb-loading');
        status.append(wrap);
        statusDispose = mountSpinner(wrap, { label: 'Loading tasks' }).dispose;
      } else if (next.kind === 'banner') {
        statusDispose = mountBanner(status, {
          tone: next.tone,
          title: next.title,
          ...(next.body !== undefined ? { body: next.body } : {}),
        }).dispose;
      } else if (next.kind === 'empty') {
        statusDispose = mountEmpty(status, { title: next.title, body: next.body }).dispose;
      } else if (next.kind === 'custom') {
        statusDispose = next.mount(status);
      }
    },
    /** Draws the columns; null hides them (no project, no tracker, or an error). */
    render: (
      board: BoardModel | null,
      busy: ReadonlySet<string> = new Set(),
      summaryOf: (task: Task) => string | null = () => null,
      done: DoneTools = NO_TOOLS,
    ) => {
      for (const d of cardDisposers) d();
      cardDisposers = [];
      columns.replaceChildren();
      columns.hidden = board === null;
      if (board === null) return;
      for (const { id, title } of COLUMNS) {
        const cards = board[id];
        const column = div('kb-column');
        column.dataset.column = id;
        const head = div('kb-column-head');
        const name = document.createElement('span');
        name.textContent = title;
        const count = document.createElement('span');
        count.className = 'kb-count';
        count.textContent = String(cards.length);
        head.append(name, count);
        column.append(head);
        if (id === 'done' && (done.archivable > 0 || done.archived > 0)) column.append(doneTools(done));
        const list = div('kb-cards');
        if (cards.length === 0) {
          const none = div('kb-none');
          none.textContent = 'Nothing here';
          list.append(none);
        }
        for (const model of cards) {
          const card = renderCard(model, busy.has(model.task.id), summaryOf(model.task));
          list.append(card.node);
          cardDisposers.push(card.dispose);
        }
        column.append(list);
        columns.append(column);
      }
    },
  };
};

export type Board = ReturnType<typeof createBoard>;
