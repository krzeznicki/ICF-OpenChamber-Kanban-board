// The board's write side, kept out of main.ts: drag and drop, the detail sheet, the Add task form
// and the in-panel confirms. Every write goes through `run`, which marks the card busy (further
// drags of it are ignored), reports a failure in a toast and reloads the board afterwards.
import type { HostClient } from '@openchamber/sdk';
import type { NewTask, Task, TaskState } from '../core/types.ts';
import type { Api } from './api.ts';
import type { Preset } from './presets.ts';
import { resolveStart, type Settings, type StartOptions } from './settings.ts';
import { COLUMNS, type Column } from './columns.ts';
import { openChildren, planMove, taskTypes, type Move } from './moves.ts';
import { mountAddForm } from './ui/add.ts';
import type { Board } from './ui/board.ts';
import { askChoice } from './ui/confirm.ts';
import { openDetail, type DetailHandle, type DetailModel } from './ui/detail.ts';
import { attachDrag } from './ui/dnd.ts';

export type EditorDeps = {
  host: HostClient;
  board: Board;
  /** Null when no board is shown (no project, wizard, notice). */
  api: () => Api | null;
  tasks: () => Task[];
  tracker: () => 'local' | 'github';
  labels: () => Record<string, string>;
  /** Where a listed task is drawn now; null when hidden (e.g. "Hide sub-tasks"). */
  columnOf: (id: string) => Column | null;
  /** Reload the tasks and redraw; resolves when done. */
  reload: () => Promise<void>;
  /** Redraw from the current state (busy marks changed). */
  redraw: () => void;
  /** Dropping on In Progress (also "Move to In Progress" in the detail): starts an agent. */
  onStart: (task: Task) => void;
  /** A click or Enter on a card; true when it was handled (a card with a session opens it), else the detail opens. */
  openCard: (taskId: string) => boolean;
  /** The base types offered in the type selects (settings' `types`). */
  baseTypes: () => string[];
  /** The card start options in the detail sheet. */
  start: {
    /** Null while no project's settings are loaded. */
    context: () => { projectId: string; settings: Settings; presets: Preset[] } | null;
    load: (projectId: string, taskId: string) => Promise<Partial<StartOptions>>;
    save: (projectId: string, taskId: string, card: Partial<StartOptions>) => void;
  };
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const createEditor = (deps: EditorDeps) => {
  const moving = new Set<string>();
  let detail: { id: string; handle: DetailHandle } | null = null;
  let addDispose: (() => void) | null = null;
  /** The open sheet's stored start options; version bumps when they are (re)loaded. */
  let card: { taskId: string; projectId: string; options: Partial<StartOptions>; version: number } | null = null;

  const find = (id: string): Task | null => deps.tasks().find((t) => t.id === id) ?? null;
  const info = (message: string): void => void deps.host.toast({ kind: 'info', message }).catch(() => {});
  const fail = (message: string): void => void deps.host.toast({ kind: 'error', message }).catch(() => {});

  const detailModel = (task: Task): DetailModel => {
    const tasks = deps.tasks();
    const column = deps.columnOf(task.id) ?? (task.state === 'done' ? 'done' : task.state === 'ready-for-agent' ? 'ready' : 'backlog');
    const open = openChildren(task, tasks);
    const ctx = deps.start.context();
    const mine = card !== null && ctx !== null && card.taskId === task.id && card.projectId === ctx.projectId ? card : null;
    return {
      task,
      column,
      openChildren: open,
      types: taskTypes(tasks, deps.baseTypes()),
      labels: deps.labels(),
      moves: COLUMNS.filter(({ id }) => planMove(task, column, id, open).kind !== 'none').map(({ id, title }) => ({ to: id, label: title })),
      busy: moving.has(task.id),
      start:
        ctx === null || task.state === 'done'
          ? null
          : {
              presets: ctx.presets,
              card: mine?.options ?? {},
              inherited: resolveStart(ctx.settings, task, {}, ctx.presets),
              version: mine?.version ?? -1,
            },
    };
  };

  const loadCard = (taskId: string): void => {
    const ctx = deps.start.context();
    if (ctx === null) {
      card = null;
      return;
    }
    const mine: NonNullable<typeof card> = { taskId, projectId: ctx.projectId, options: {}, version: 0 };
    card = mine;
    deps.start
      .load(ctx.projectId, taskId)
      .then((options) => {
        if (card !== mine) return;
        mine.options = options;
        mine.version++;
        refreshDetail();
      })
      .catch((e: unknown) => fail(`Could not read the card's start options: ${errorText(e)}`));
  };

  /** After a reload: show the fresh task, or close the sheet when it left the list. */
  const refreshDetail = (): void => {
    if (detail === null) return;
    const task = find(detail.id);
    if (task === null) closeDetail();
    else detail.handle.update(detailModel(task));
  };

  const run = async (id: string, action: (api: Api) => Promise<unknown>): Promise<void> => {
    const api = deps.api();
    if (api === null || moving.has(id)) return;
    moving.add(id);
    deps.redraw();
    refreshDetail();
    try {
      await action(api);
    } catch (e) {
      fail(errorText(e));
    } finally {
      moving.delete(id);
      await deps.reload();
      refreshDetail();
    }
  };

  const close = async (task: Task, askChildren: boolean): Promise<void> => {
    let withChildren = false;
    if (askChildren) {
      const n = openChildren(task, deps.tasks());
      const answer = await askChoice(
        `Close “${task.title}”?`,
        `It has ${n} open sub-task${n === 1 ? '' : 's'}.`,
        [
          { id: 'all', label: 'Close with sub-tasks', variant: 'destructive' },
          { id: 'one', label: 'Close only this task', variant: 'secondary' },
        ],
      );
      if (answer === null) return;
      withChildren = answer === 'all';
    }
    await run(task.id, (api) => api.close(task.id, withChildren));
  };

  const apply = (task: Task, move: Move): void => {
    switch (move.kind) {
      case 'none':
        info(move.reason);
        return;
      case 'start':
        deps.onStart(task);
        return;
      case 'setState':
        void run(task.id, (api) => api.setState(task.id, move.state));
        return;
      case 'close':
        void close(task, move.askChildren);
        return;
    }
  };

  const move = (id: string, from: Column, to: Column): void => {
    const task = find(id);
    // Dropping back on its own column is not a move; say nothing.
    if (task === null || moving.has(id) || from === to) return;
    apply(task, planMove(task, from, to, openChildren(task, deps.tasks())));
  };

  const closeDetail = (): void => {
    const d = detail;
    detail = null;
    card = null;
    d?.handle.dispose();
  };

  const showDetail = (id: string): void => {
    const task = find(id);
    if (task === null) return;
    closeDetail();
    loadCard(id);
    const handle = openDetail(detailModel(task), {
      onStartOptions: (options) => {
        if (card === null || card.taskId !== id) return;
        card.options = options;
        deps.start.save(card.projectId, id, options);
      },
      onMove: (to) => {
        const t = find(id);
        if (t !== null) move(id, detailModel(t).column, to);
      },
      onState: (state: TaskState) => {
        const t = find(id);
        if (t === null) return;
        if (state === 'done') void close(t, openChildren(t, deps.tasks()) > 0);
        else void run(id, (api) => api.setState(id, state));
        refreshDetail(); // the select snaps back until the reload shows the saved state
      },
      onType: (type) => void run(id, (api) => api.setType(id, type)),
      onClose: (withChildren) => {
        const t = find(id);
        if (t === null) return;
        if (!withChildren) {
          void run(id, (api) => api.close(id, false));
          return;
        }
        const n = openChildren(t, deps.tasks());
        void askChoice(`Close “${t.title}” and its sub-tasks?`, `This closes the task and its ${n} open sub-task${n === 1 ? '' : 's'}.`, [
          { id: 'all', label: 'Close with sub-tasks', variant: 'destructive' },
        ]).then((answer) => {
          if (answer === 'all') void run(id, (api) => api.close(id, true));
        });
      },
      onOpenUrl: (url) => void deps.host.openUrl(url).catch((e: unknown) => fail(errorText(e))),
      onDismiss: closeDetail,
    });
    detail = { id, handle };
  };

  const closeAdd = (): void => {
    addDispose?.();
    addDispose = null;
    deps.board.addForm.replaceChildren();
  };

  const showAdd = (): void => {
    if (addDispose !== null) {
      deps.board.addForm.querySelector<HTMLInputElement>('input')?.focus();
      return;
    }
    const tasks = deps.tasks();
    addDispose = mountAddForm(
      deps.board.addForm,
      {
        types: taskTypes(tasks, deps.baseTypes()),
        parents: tasks.filter((t) => t.kind === 'parent' && t.state !== 'done').map((t) => ({ id: t.id, label: t.title, hint: t.id })),
        tracker: deps.tracker(),
      },
      {
        onSubmit: async (input: NewTask) => {
          const api = deps.api();
          if (api === null) return 'No project is open.';
          try {
            const task = await api.create(input);
            closeAdd();
            void deps.host.toast({ kind: 'success', message: `Created ${task.id}` }).catch(() => {});
            await deps.reload();
            return null;
          } catch (e) {
            return errorText(e);
          }
        },
        onCancel: closeAdd,
      },
    );
  };

  const detachDrag = attachDrag(deps.board.columns, {
    canDrag: (id) => !moving.has(id),
    onDrop: move,
    onOpen: (id) => {
      if (!deps.openCard(id)) showDetail(id);
    },
  });

  return {
    /** Ids whose write is in flight; the board draws them busy. */
    busy: moving as ReadonlySet<string>,
    showAdd,
    /** The detail sheet of a task (a card's Details button). */
    showDetail,
    /** Project switch or the board went away: drop the sheet and the form. */
    reset: () => {
      closeDetail();
      closeAdd();
    },
    /** After a reload from elsewhere (poll, Refresh, settings): keep the open sheet current. */
    refresh: () => {
      // Settings for another project arrived (switch): the stored card options are someone else's.
      const ctx = deps.start.context();
      if (detail !== null && (card === null || ctx === null || card.projectId !== ctx.projectId)) loadCard(detail.id);
      refreshDetail();
    },
    dispose: () => {
      detachDrag();
      closeDetail();
      closeAdd();
    },
  };
};

export type Editor = ReturnType<typeof createEditor>;
