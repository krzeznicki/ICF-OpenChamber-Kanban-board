// The board's write side, kept out of main.ts: drag and drop, the detail sheet, the Add task form
// and the in-panel confirms. Every write goes through `run`, which marks the card busy (further
// drags of it are ignored), reports a failure in a toast and reloads the board afterwards.
import type { HostClient } from '@openchamber/sdk';
import type { NewTask, Task, TaskState } from '../core/types.ts';
import type { Api } from './api.ts';
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
  /** Dropping on In Progress. Task 12 wires sessions here. */
  onStart: (task: Task) => void;
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const createEditor = (deps: EditorDeps) => {
  const moving = new Set<string>();
  let detail: { id: string; handle: DetailHandle } | null = null;
  let addDispose: (() => void) | null = null;

  const find = (id: string): Task | null => deps.tasks().find((t) => t.id === id) ?? null;
  const info = (message: string): void => void deps.host.toast({ kind: 'info', message }).catch(() => {});
  const fail = (message: string): void => void deps.host.toast({ kind: 'error', message }).catch(() => {});

  const detailModel = (task: Task): DetailModel => {
    const tasks = deps.tasks();
    const column = deps.columnOf(task.id) ?? (task.state === 'done' ? 'done' : task.state === 'ready-for-agent' ? 'ready' : 'backlog');
    const open = openChildren(task, tasks);
    return {
      task,
      column,
      openChildren: open,
      types: taskTypes(tasks),
      labels: deps.labels(),
      moves: COLUMNS.filter(({ id }) => planMove(task, column, id, open).kind !== 'none').map(({ id, title }) => ({ to: id, label: title })),
      busy: moving.has(task.id),
    };
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
    d?.handle.dispose();
  };

  const showDetail = (id: string): void => {
    const task = find(id);
    if (task === null) return;
    closeDetail();
    const handle = openDetail(detailModel(task), {
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
        types: taskTypes(tasks),
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
    onOpen: showDetail,
  });

  return {
    /** Ids whose write is in flight; the board draws them busy. */
    busy: moving as ReadonlySet<string>,
    showAdd,
    /** Project switch or the board went away: drop the sheet and the form. */
    reset: () => {
      closeDetail();
      closeAdd();
    },
    /** After a reload from elsewhere (poll, Refresh): keep the open sheet current. */
    refresh: refreshDetail,
    dispose: () => {
      detachDrag();
      closeDetail();
      closeAdd();
    },
  };
};

export type Editor = ReturnType<typeof createEditor>;
