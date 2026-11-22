// The board shell: a two-row toolbar (a TEST badge in the test build, project switcher, source switcher with several
// sources (sourceView.ts), "Hide sub-tasks", a search field,
// Add task, Settings, Refresh; the search completes filters, ui/searchSuggest.ts, and hands Esc in an
// empty field and ↓ back to main.ts for the Board), a status slot for banners, spinner and empty states, and the five columns. The Done header carries
// "Archive done", "Show archived (N)" (archive.ts) and "Clear archive" (clearArchive.ts).
// It draws what main.ts hands it and reports clicks back; it holds no data of its own. Dragging
// is attached to `columns` by the editor (ui/dnd.ts).
import { mountBanner, mountButton, mountEmpty, mountSearchField, mountSelect, mountSpinner, mountSwitch, mountTabs } from '@openchamber/sdk/ui';
import type { BannerTone, SelectOption } from '@openchamber/sdk/ui';
import type { Task } from '../../core/types.ts';
import { VARIANT } from '../../core/variant.ts';
import { COLUMNS, type BoardModel } from '../columns.ts';
import type { Suggestion } from '../search.ts';
import type { SourceBanner } from '../sourceBanner.ts';
import type { SourceSwitcher, SourceView } from '../sourceView.ts';
import { hintLastChild, hintShortcut } from './shortcutHints.ts';
import { renderCard } from './card.ts';
import { mountSearchSuggest } from './searchSuggest.ts';

export type BoardCallbacks = {
  onProject: (projectId: string) => void;
  /** The source switcher's pick: All or one source. */
  onSource: (view: SourceView) => void;
  onHideSubtasks: (hide: boolean) => void;
  /** The search field's text, on every keystroke (search.ts filters the cards). */
  onSearch: (query: string) => void;
  /** The search field's completions for the text and caret (search.ts searchSuggestions). */
  suggest: (text: string, caret: number) => Suggestion[];
  /** Esc in the empty search field (the kit's first Esc clears it): back to the Board. */
  onSearchExit: () => void;
  /** ↓ in the search field with no completion list open: select the first card; false when none. */
  onSearchDown: () => boolean;
  onRefresh: () => void;
  onAdd: () => void;
  onSettings: () => void;
  /** The Done header's "Archive done" (the caller asks to confirm). */
  onArchiveDone: () => void;
  /** The Done header's "Show archived (N)" switch. */
  onShowArchived: (show: boolean) => void;
  /** The Done header's "Clear archive": deletes the archived tasks for good (the caller asks to confirm). */
  onClearArchive: () => void;
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
  const sourceSlot = div('kb-source');
  sourceSlot.hidden = true;
  const switchSlot = div('kb-hide');
  const searchSlot = div('kb-search');
  const spacer = div('kb-spacer');
  const addSlot = div('kb-add-button');
  const settingsSlot = div('kb-settings-button');
  const refreshSlot = div('kb-refresh');
  // Two rows: the project and the actions on top, what the board shows (source, search, sub-tasks) below.
  const topRow = div('kb-toolbar-row');
  const viewRow = div('kb-toolbar-row kb-toolbar-view');
  topRow.append(projectSlot, spacer, addSlot, settingsSlot, refreshSlot);
  viewRow.append(sourceSlot, searchSlot, switchSlot);
  toolbar.append(topRow, viewRow);
  // The local test build (npm run build:test) says so, so it is never mistaken for production.
  if (VARIANT === 'test') {
    const badge = document.createElement('span');
    badge.className = 'kb-test-badge';
    badge.textContent = 'TEST';
    badge.title = 'Kanban TEST: the local development build, separate from the production Kanban Board';
    topRow.prepend(badge);
  }
  const status = div('kb-status');
  // The rail panel's note for its chat's session (sessionFocus.ts): independent of the status slot,
  // which every draw resets.
  const sessionNote = div('kb-session-note');
  // One banner per source that failed to list (sourceBanner.ts); the other sources' cards stay below.
  const sourceNotes = div('kb-source-notes');
  const columns = div('kb-columns');
  shell.append(toolbar, status, sourceNotes, sessionNote, columns);
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
  // Segments or a dropdown, rebuilt only when the project's sources change (sourceView.ts sourceSwitcher).
  let sourceControl: { key: string; set: (view: SourceView) => void; dispose: () => void } | null = null;
  const setSources = (switcher: SourceSwitcher | null, view: SourceView | null): void => {
    const key = switcher === null ? '' : JSON.stringify(switcher);
    if (sourceControl?.key !== key) {
      sourceControl?.dispose();
      sourceControl = null;
      sourceSlot.replaceChildren();
      if (switcher !== null) {
        const pick = (id: string): void => {
          sourceControl?.set(id as SourceView);
          callbacks.onSource(id as SourceView);
        };
        const first = view ?? switcher.options[0]!.value;
        if (switcher.kind === 'segments') {
          const tabs = mountTabs(sourceSlot, { items: switcher.options.map((o) => ({ id: o.value, label: o.label })), activeId: first, onChange: pick, trackBackground: true });
          sourceControl = { key, set: (v) => tabs.update({ activeId: v }), dispose: tabs.dispose };
        } else {
          const select = mountSelect(sourceSlot, { value: first, options: switcher.options.map((o) => ({ id: o.value, label: o.label })), onChange: pick });
          sourceControl = { key, set: (v) => select.update({ value: v }), dispose: select.dispose };
        }
      }
    }
    sourceSlot.hidden = sourceControl === null;
    if (sourceControl !== null && view !== null) sourceControl.set(view);
  };
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
    label: 'Search tasks by title or description, or filter with type:, state:, status:, column: and source:',
    onChange: (query) => setQuery(query),
  });
  const setQuery = (query: string): void => {
    search.update({ value: query });
    callbacks.onSearch(query);
  };
  // The field's completion list lives as long as the board, like the field itself.
  mountSearchSuggest(searchSlot, { suggest: callbacks.suggest, apply: setQuery });
  // Esc and ↓ in the field, in steps: the completion list takes them first (capturing on the slot),
  // then the kit's Esc clears a non-empty field (both preventDefault); only what is left reaches here,
  // registered after the kit's listener on the same input.
  const searchInput = searchSlot.querySelector<HTMLInputElement>('input');
  searchInput?.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (e.key === 'Escape' && searchInput.value === '') {
      e.preventDefault();
      callbacks.onSearchExit();
    } else if (e.key === 'ArrowDown' && callbacks.onSearchDown()) {
      e.preventDefault();
    }
  });
  const add = mountButton(addSlot, { label: 'Add task', size: 'sm', disabled: true, onClick: callbacks.onAdd });
  mountButton(settingsSlot, { label: 'Settings', variant: 'outline', size: 'sm', onClick: callbacks.onSettings });
  const refresh = mountButton(refreshSlot, { label: 'Refresh', variant: 'outline', size: 'sm', onClick: callbacks.onRefresh });
  // Key hints in the tooltips (shortcutHints.ts); they follow a rebinding.
  hintShortcut(projectSlot, 'board.projects', 'Switch project');
  hintShortcut(switchSlot, 'board.toggleSubtasks', 'Hide or show sub-tasks');
  hintLastChild(addSlot, 'board.addTask', 'Add task');
  hintLastChild(settingsSlot, 'board.settings', 'Settings');
  hintLastChild(refreshSlot, 'board.refresh', 'Refresh');
  hintShortcut(searchSlot, 'board.search', 'Search tasks');
  let refreshBusy = false;

  let statusDispose: (() => void) | null = null;
  let sessionNoteDispose: (() => void) | null = null;
  const setSessionNote = (text: string | null): void => {
    sessionNoteDispose?.();
    sessionNoteDispose = null;
    sessionNote.replaceChildren();
    if (text === null) return;
    sessionNoteDispose = mountBanner(sessionNote, { tone: 'info', title: text, action: { label: 'Dismiss', onClick: () => setSessionNote(null) } }).dispose;
  };
  let sourceNoteDisposers: Array<() => void> = [];
  const setSourceBanners = (banners: readonly SourceBanner[], onRetry: () => void): void => {
    for (const d of sourceNoteDisposers) d();
    sourceNoteDisposers = [];
    sourceNotes.replaceChildren();
    for (const b of banners) {
      const slot = div('kb-source-note');
      sourceNotes.append(slot);
      sourceNoteDisposers.push(mountBanner(slot, { tone: b.tone, title: b.title, body: b.body, action: { label: b.action, onClick: onRetry } }).dispose);
    }
  };
  let cardDisposers: Array<() => void> = [];

  /** Under the Done header: "Archive done" and "Clear archive" side by side, then "Show archived (N)"; disposed with the cards. */
  const doneTools = (done: DoneTools): HTMLElement => {
    const tools = div('kb-column-tools');
    const buttons = div('kb-archive-buttons');
    const button = (label: string, onClick: () => void): void => {
      const slot = div('kb-archive-button');
      buttons.append(slot);
      cardDisposers.push(mountButton(slot, { label, variant: 'outline', size: 'xs', onClick }).dispose);
    };
    if (done.archivable > 0) button('Archive done', callbacks.onArchiveDone);
    if (done.archived > 0) button('Clear archive', callbacks.onClearArchive);
    tools.append(buttons);
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
    /** The source switcher: null hides it (one source, or no board); `view` is the one shown. */
    setSources,
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
    /** The banners of the sources that failed to list, each with a retry; [] removes them. */
    setSourceBanners,
    setBusy: (busy: boolean) => {
      refreshBusy = busy;
      refresh.update({ loading: busy, disabled: busy });
    },
    /** Refresh is running (its button is disabled), so the Refresh Shortcut does nothing either. */
    busy: () => refreshBusy,
    /** Focuses the search field with its text selected (the Search Shortcut). */
    focusSearch: (): boolean => {
      if (searchInput === null) return false;
      searchInput.focus();
      searchInput.select();
      return true;
    },
    /**
     * Opens the project switcher with its search focused, as a click on it does (the Project
     * switcher Shortcut). False when it is disabled (no projects); an open one gets its search focused.
     */
    openProjects: (): boolean => {
      const trigger = projectSlot.querySelector<HTMLButtonElement>('.oc-sdk-trigger');
      if (trigger === null || trigger.disabled) return false;
      if (trigger.getAttribute('aria-expanded') === 'true') projectSlot.querySelector<HTMLInputElement>('.oc-sdk-popup-search input')?.focus();
      else trigger.click();
      return true;
    },
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
      sourceOf: (task: Task) => string | null = () => null,
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
          const card = renderCard(model, busy.has(model.task.id), summaryOf(model.task), sourceOf(model.task));
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
