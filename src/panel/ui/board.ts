// The board shell: a toolbar (project switcher, "Hide sub-tasks", Add task, Refresh), a slot for
// the Add task form, a status slot for banners, spinner and empty states, and the five columns.
// It draws what main.ts hands it and reports clicks back; it holds no data of its own. Dragging
// is attached to `columns` by the editor (ui/dnd.ts).
import { mountBanner, mountButton, mountEmpty, mountSelect, mountSpinner, mountSwitch } from '@openchamber/sdk/ui';
import type { BannerTone, SelectOption } from '@openchamber/sdk/ui';
import { COLUMNS, type BoardModel } from '../columns.ts';
import { renderCard } from './card.ts';

export type BoardCallbacks = {
  onProject: (projectId: string) => void;
  onHideSubtasks: (hide: boolean) => void;
  onRefresh: () => void;
  onAdd: () => void;
};

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
  const spacer = div('kb-spacer');
  const addSlot = div('kb-add-button');
  const refreshSlot = div('kb-refresh');
  toolbar.append(projectSlot, switchSlot, spacer, addSlot, refreshSlot);
  const addForm = div('kb-add-slot');
  const status = div('kb-status');
  const columns = div('kb-columns');
  shell.append(toolbar, addForm, status, columns);
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
  const add = mountButton(addSlot, { label: 'Add task', size: 'sm', disabled: true, onClick: callbacks.onAdd });
  const refresh = mountButton(refreshSlot, { label: 'Refresh', variant: 'outline', size: 'sm', onClick: callbacks.onRefresh });

  let statusDispose: (() => void) | null = null;
  let cardDisposers: Array<() => void> = [];

  return {
    /** The persistent container the cards are drawn in; drag listeners live here. */
    columns,
    /** Where the Add task form is mounted; empty when closed. */
    addForm,
    /** "Add task" works only while a board is shown. */
    setCanAdd: (enabled: boolean) => add.update({ disabled: !enabled }),
    setProjects: (options: SelectOption[], value: string | null) => {
      project.update({
        options,
        value,
        placeholder: options.length === 0 ? 'No projects' : 'Choose a project',
        disabled: options.length === 0,
      });
    },
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
    render: (board: BoardModel | null, busy: ReadonlySet<string> = new Set()) => {
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
        const list = div('kb-cards');
        if (cards.length === 0) {
          const none = div('kb-none');
          none.textContent = 'Nothing here';
          list.append(none);
        }
        for (const model of cards) {
          const card = renderCard(model, busy.has(model.task.id));
          list.append(card.node);
          cardDisposers.push(card.dispose);
        }
        column.append(head, list);
        columns.append(column);
      }
    },
  };
};

export type Board = ReturnType<typeof createBoard>;
