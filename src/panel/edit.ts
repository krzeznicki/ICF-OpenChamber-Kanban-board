// The board's write side, kept out of main.ts: drag and drop, the task modal, the Add task modal
// and the in-panel confirms. Every write goes through `run`, which marks the card busy (further
// drags of it are ignored), reports a failure in a toast and reloads the board afterwards. A state
// change (a drop, Move to, the State select) is drawn at once (`runShown`, optimistic.ts).
import type { HostClient } from '@openchamber/sdk';
import { errorMessage, type NewTask, type SourceId, type Task, type TaskState } from '../core/types.ts';
import {
  MODEL_PICK,
  addSource,
  canAddSubtask,
  createWithSubtasks,
  existingToLink,
  partialMessage,
  sourceTasks,
  subtasksToCreate,
  toNewTask,
  type AddDraft,
} from './addTask.ts';
import type { Api, SourceInfo } from './api.ts';
import type { Preset } from './presets.ts';
import type { StartLists } from './models.ts';
import { resolveStart, type CardOptions, type Sections, type Settings } from './settings.ts';
import { askedOf, type Suggester } from './suggest.ts';
import { COLUMNS, type Column, type SessionLookup, type SessionTarget } from './columns.ts';
import { openChildren, planMove, taskTypes, type Move } from './moves.ts';
import { closingStates, type PendingStates } from './optimistic.ts';
import { openAddModal, type AddModalHandle, type AddModalStart, type AddResult } from './ui/addModal.ts';
import type { Board } from './ui/board.ts';
import { askChoice } from './ui/confirm.ts';
import { openDetail, type DetailHandle, type DetailModel, type OpenTaskShortcuts, type SessionView, type SummaryModel } from './ui/detail.ts';
import { attachDrag } from './ui/dnd.ts';
import { canLinkUnder, followingMove, linkChoices, linkConfirm, unlinkConfirm } from './link.ts';
import { sourceOr } from './sources.ts';
import { deleteConfirm } from './taskDelete.ts';
import { canPublish, publishConfirm, publishedMessage } from './taskPublish.ts';
import { editChanges, editConflict, editableText, type EditText } from './taskEdit.ts';

export type EditorDeps = {
  host: HostClient;
  board: Board;
  /** Null when no board is shown (no project, wizard, notice). */
  api: () => Api | null;
  tasks: () => Task[];
  /** The primary source's kind (and id). A listed task goes by its own source (kindOf), a new one by Add task's source. */
  /** The project's primary source. */
  primary: () => SourceId;
  /**
   * Where Add task creates (addTask.ts addSource): the switcher's view (main.ts sourceView: a source
   * id, `all`, or null without a config) and the project's sources with what each can do.
   */
  sources: () => { view: SourceId | 'all' | null; sources: SourceInfo[] };
  labels: () => Record<string, string>;
  /** Where a listed task is drawn now; null when hidden (e.g. "Hide sub-tasks"). */
  columnOf: (id: string) => Column | null;
  /** Reload the tasks and redraw; resolves when done. */
  reload: () => Promise<void>;
  /** Redraw from the current state (busy marks changed). */
  redraw: () => void;
  /**
   * Moves drawn before their write ends (optimistic.ts): `add` shows the new states at once and
   * returns a key; `settle` stops drawing them once the write and its reload are done or failed.
   */
  shown?: { add: (states: PendingStates) => number; settle: (key: number) => void };
  /** Dropping on In Progress (also "Move to In Progress" in the detail): starts an agent. */
  onStart: (task: Task) => void;
  /** The model picker's list (loaded once per panel session). */
  /** The model and agent lists of the start pickers. */
  lists: StartLists;
  /** Before a move that writes (Backlog, Ready, Done): e.g. leave the start queue. False cancels the move. */
  beforeMove?: (task: Task) => Promise<boolean>;
  /** A move to Backlog or Ready was written, before the reload (e.g. detach the card from its session). */
  afterSetState?: (task: Task, from: Column) => Promise<void>;
  /** The task modal's "Open session" (a click or Enter on a card always opens the modal). */
  session: {
    /** What the task's session allows (columns.ts sessionTarget). */
    target: (task: Task) => SessionTarget;
    /** A session known only from a link, looked up in every project's snapshot (columns.ts resolveSession). */
    check: (sessionId: string) => Promise<SessionLookup>;
    /** Only ever called with an id that is `open` in a host snapshot. */
    open: (sessionId: string) => void;
  };
  /** The manual card order (order.ts), kept in the panel's storage. */
  order: {
    /** A card dropped in its own column before `before` (null: last). */
    reorder: (taskId: string, column: Column, before: string | null) => void;
    /** A task got a new id (a local link moved it): it keeps its place. */
    rename: (from: string, to: string) => void;
    /** Tasks were deleted: their places go. */
    forget: (taskIds: readonly string[]) => void;
  };
  /** "Archive done" (archive.ts): whether a task is archived, and the modal's "Unarchive". */
  archive: { has: (task: Task) => boolean; unarchive: (taskId: string) => void };
  /** Which modal sections are open (device storage). */
  sections: { get: () => Sections; save: (sections: Sections) => void };
  /** The base types offered in the type selects (settings' `types`). */
  baseTypes: () => string[];
  /** The card start options in the task modal. */
  start: {
    /** Null while no project's settings are loaded. */
    context: () => { projectId: string; settings: Settings; presets: Preset[] } | null;
    load: (projectId: string, taskId: string) => Promise<CardOptions>;
    save: (projectId: string, taskId: string, card: CardOptions) => void;
    /** A task got a new id (a local link moved it): its stored options go under that id, the old key is deleted. */
    move: (projectId: string, from: string, to: string) => Promise<void>;
    /** A task was deleted: its stored options go. */
    forget: (projectId: string, taskId: string) => Promise<void>;
    /**
     * The task was created with "No type" in the Add task modal: the Small Model never picks its
     * type (suggest.ts createTypeClassifier). `move` and `forget` take this mark along.
     */
    markNoType: (projectId: string, taskId: string) => Promise<void>;
  };
  /** The task modal shows `taskId` (opened, or switched to it). */
  onOpenTaskShown?: (taskId: string) => void;
  /**
   * The task modal closed on `taskId`, the task it showed last: `dismissed` by the user (Escape, ×,
   * backdrop) or `gone` because the task left the board (deleted, here or elsewhere).
   */
  onOpenTaskClosed?: (taskId: string, how: 'dismissed' | 'gone') => void;
  /** The personal summary in the task modal (summaries.ts). */
  summary: {
    model: (task: Task) => SummaryModel | null;
    summarise: (task: Task) => void;
    /** The card's summary language was edited (undefined: back to the settings). */
    onLanguage: (projectId: string, taskId: string, language: string | undefined) => void;
  };
  /** Type and state of a task added here, suggested by the Small Model (suggest.ts). */
  suggest: {
    /** The global "Suggest type and state for new tasks" setting. */
    enabled: () => boolean;
    suggester: Suggester;
  };
};


export const createEditor = (deps: EditorDeps) => {
  const moving = new Set<string>();
  /** `onFollow`: the open task got a new id (a local link moved it); its handlers use that one. */
  let detail: { id: string; handle: DetailHandle; onFollow: (id: string) => void } | null = null;
  let addModal: AddModalHandle | null = null;
  /** What the open Add task form offers: the types, and whether "Let the model pick" is there. */
  let addOffer: { types: string[]; suggest: boolean } = { types: [], suggest: false };
  /** The open modal's stored start options; version bumps when they are (re)loaded. */
  let card: { taskId: string; projectId: string; options: CardOptions; version: number } | null = null;
  /** The open modal's lookup of a session known only from a link (SessionTarget `check`). */
  let lookup: { id: string; result: SessionLookup; inflight: boolean } | null = null;

  const find = (id: string): Task | null => deps.tasks().find((t) => t.id === id) ?? null;
  /** How `task` is handled (wording, local file rules): by the source it lives in. */
  const kindOf = (task: Task): SourceId => task.source;
  const info = (message: string): void => void deps.host.toast({ kind: 'info', message }).catch(() => {});
  const fail = (message: string): void => void deps.host.toast({ kind: 'error', message }).catch(() => {});

  const runLookup = (id: string): void => {
    const mine: NonNullable<typeof lookup> = { id, result: 'pending', inflight: true };
    lookup = mine;
    deps.session
      .check(id)
      .catch(() => 'missing' as const)
      .then((result) => {
        if (lookup !== mine) return;
        mine.inflight = false;
        mine.result = result;
        // Still pending (a snapshot was loading): keep the spinner; the next refresh asks again.
        if (result !== 'pending') refreshDetail();
      });
  };

  const sessionView = (task: Task): SessionView => {
    const target = deps.session.target(task);
    if (target.kind !== 'check') return target.kind;
    if (lookup?.id !== target.id || (!lookup.inflight && lookup.result === 'pending')) runLookup(target.id);
    const result = lookup?.result ?? 'pending';
    return result === 'pending' ? 'checking' : result;
  };

  const openSession = (taskId: string): void => {
    const task = find(taskId);
    if (task === null) return;
    const target = deps.session.target(task);
    if (target.kind === 'open') {
      deps.session.open(target.id);
      return;
    }
    if (target.kind !== 'check') return;
    // Looked up again on the click: it may have been archived since the modal opened.
    const id = target.id;
    void deps.session
      .check(id)
      .catch(() => 'missing' as const)
      .then((result) => {
        if (result === 'open') deps.session.open(id);
        else
          info(
            result === 'archived'
              ? 'That session was archived.'
              : result === 'pending'
                ? 'OpenChamber is still loading its sessions; try again in a moment.'
                : 'That session is not listed in OpenChamber.',
          );
        if (lookup?.id === id && result !== 'pending') {
          lookup.result = result;
          refreshDetail();
        }
      });
  };

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
              inherited: resolveStart(ctx.settings, { type: task.type, subtasks: tasks.some((t) => t.parentId === task.id) }, {}, ctx.presets),
              summaryLanguage: ctx.settings.summary.language,
              version: mine?.version ?? -1,
            },
      summary: deps.summary.model(task),
      session: sessionView(task),
      publish: canPublish(task, deps.sources().sources.map((s) => s.id)),
      children: tasks.filter((t) => t.parentId === task.id).map((t) => ({ id: t.id, title: t.title, state: t.state })),
      addSubtask: canAddSubtask(task, kindOf(task)),
      archived: deps.archive.has(task),
      links: (() => {
        const parent = task.parentId === null ? null : find(task.parentId);
        const offered = linkChoices(kindOf(task), task, tasks);
        return {
          parent: task.parentId === null ? null : { id: task.parentId, label: parent?.title ?? task.parentId, hint: task.parentId },
          ...offered,
        };
      })(),
      text: editableText(kindOf(task), task),
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
      .catch((e: unknown) => fail(`Could not read the card's start options: ${errorMessage(e)}`));
  };

  /** The open task's new id after a link moved it, until the reload lists it under that id. */
  let followed: string | null = null;

  /** After a reload: show the fresh task, or close the modal when it left the list. */
  const refreshDetail = (): void => {
    if (detail === null) return;
    const task = find(detail.id);
    if (task === null && detail.id === followed) return; // moved; the reload in flight lists it
    if (task === null) {
      const id = detail.id;
      closeDetail();
      deps.onOpenTaskClosed?.(id, 'gone');
    } else detail.handle.update(detailModel(task));
  };

  /**
   * Every write of the panel: marks `id` busy (drawn so, further drags ignored) while `action` runs,
   * then reloads the board; `after` runs once the reload is done. The caller checks `moving` first.
   */
  const busyWhile = async <T>(id: string, action: () => Promise<T>, after?: () => void): Promise<T> => {
    moving.add(id);
    deps.redraw();
    refreshDetail();
    try {
      return await action();
    } finally {
      moving.delete(id);
      await deps.reload();
      after?.();
      refreshDetail();
    }
  };

  /**
   * A state change shown at once (the card sits in its new column while the write and the reload
   * from the source run in the background); a failed write is a toast and the reload puts it back.
   */
  const runShown = async (id: string, states: PendingStates, action: (api: Api) => Promise<unknown>): Promise<void> => {
    if (deps.api() === null || moving.has(id)) return;
    const key = deps.shown?.add(states);
    try {
      await run(id, action);
    } finally {
      if (key !== undefined) deps.shown!.settle(key);
    }
  };

  /** A write whose failure is a toast. */
  const run = async (id: string, action: (api: Api) => Promise<unknown>): Promise<void> => {
    const api = deps.api();
    if (api === null || moving.has(id)) return;
    await busyWhile(id, () => action(api).then(() => undefined, (e: unknown) => fail(errorMessage(e))));
  };

  /** A write whose failure comes back as text for the caller to show (null: done). */
  const attempt = (action: () => Promise<unknown>): Promise<string | null> =>
    action().then(
      () => null,
      (e: unknown) => errorMessage(e),
    );

  /**
   * The api's setParent as every link of the panel uses it: a task that comes back with a new id
   * (local: its file moved) is followed by the open modal, its place in the manual order and its
   * stored start options move to that id (the service re-keys its session links and queue entry).
   */
  const following = <A extends unknown[]>(op: (id: string, ...rest: A) => Promise<Task>) =>
    followingMove(
      op,
      async (from, to) => {
        follow(from, to);
        deps.order.rename(from, to);
        const ctx = deps.start.context();
        if (ctx !== null) await deps.start.move(ctx.projectId, from, to);
      },
      (from, to, e) => fail(`${from} is now ${to}, but its start options could not follow: ${errorMessage(e)}`),
    );
  const setParentOf = (api: Api) => following(api.setParent);

  /**
   * Links `childId` under `parentId`: the modal's Parent picker and "Link existing task", and a
   * card dropped onto a card. Resolves to null, or the service's error for the caller to show.
   */
  const linkTask = (childId: string, parentId: string): Promise<string | null> =>
    relink(childId, async (api) => {
      const moved = await setParentOf(api)(childId, parentId);
      info(moved.id !== childId ? `Linked ${childId} under ${parentId}; it is now ${moved.id}` : `Linked ${childId} under ${parentId}`);
    });

  /**
   * Unlinks `childId` from its parent: "No parent" in the Parent picker, and "Unlink" in a parent's
   * sub-task list (after a confirm). Resolves to null, or the service's error for the caller to show.
   */
  const unlinkTask = (childId: string): Promise<string | null> =>
    relink(childId, async (api) => {
      const moved = await following(api.removeParent)(childId);
      info(moved.id !== childId ? `Unlinked ${childId} from its parent; it is now ${moved.id}` : `Unlinked ${childId} from its parent`);
    });

  /** Marks `childId` busy while `action` changes its parent, then reloads; an error comes back as text. */
  const relink = async (childId: string, action: (api: Api) => Promise<void>): Promise<string | null> => {
    const api = deps.api();
    if (api === null) return 'No project is open.';
    if (moving.has(childId)) return null;
    return busyWhile(childId, () => attempt(() => action(api)), () => {
      followed = null;
    });
  };

  /** The open modal shows `from`, which now is `to`: it follows (its card options too). */
  const follow = (from: string, to: string): void => {
    if (detail === null || detail.id !== from) return;
    detail.id = to;
    followed = to;
    detail.onFollow(to);
    if (card !== null && card.taskId === from) card.taskId = to;
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
    if (deps.beforeMove !== undefined && !(await deps.beforeMove(task))) return;
    await runShown(task.id, closingStates(task, deps.tasks(), withChildren), (api) => api.close(task.id, withChildren));
  };

  const apply = (task: Task, from: Column, move: Move): void => {
    switch (move.kind) {
      case 'none':
        info(move.reason);
        return;
      case 'start':
        deps.onStart(task);
        return;
      case 'setState':
        void (async () => {
          if (deps.beforeMove !== undefined && !(await deps.beforeMove(task))) return;
          await runShown(task.id, new Map([[task.id, move.state]]), async (api) => {
            await api.setState(task.id, move.state);
            await deps.afterSetState?.(task, from);
          });
        })();
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
    apply(task, from, planMove(task, from, to, openChildren(task, deps.tasks())));
  };

  /** A card dropped onto an accepting card: confirm, then link it under that card (a failure is a toast). */
  const link = async (id: string, parentId: string): Promise<void> => {
    const child = find(id);
    const parent = find(parentId);
    if (child === null || parent === null || moving.has(id)) return;
    const { title, body } = linkConfirm(kindOf(child), child, parent);
    if ((await askChoice(title, body, [{ id: 'link', label: 'Make sub-task' }])) !== 'link') return;
    const error = await linkTask(id, parentId);
    if (error !== null) fail(error);
  };

  /**
   * The modal's Edit form: saves only what changed, and only when what it changes is still what the
   * form opened with (taskEdit.ts editConflict), so an agent's edit meanwhile is not overwritten.
   * Resolves to null (the form closes), or the error for the form to show (it stays open with the draft).
   */
  const editTask = async (id: string, from: EditText, draft: EditText): Promise<string | null> => {
    const api = deps.api();
    if (api === null) return 'No project is open.';
    const result = editChanges(from, draft);
    if ('error' in result) return result.error;
    if (result.changes === null) return null;
    if (moving.has(id)) return 'The task is being changed right now; save again in a moment.';
    const changes = result.changes;
    return busyWhile(id, () =>
      attempt(async () => {
        const stored = await api.get(id);
        const conflict = editConflict(kindOf(stored), stored, from, changes);
        if (conflict !== null) throw new Error(conflict);
        await api.edit(id, changes);
      }),
    );
  };

  /** The modal's Delete: confirm, delete, then drop the place in the card order and the stored start options of every deleted task. */
  const deleteTask = async (id: string): Promise<void> => {
    const task = find(id);
    const api = deps.api();
    if (task === null || api === null || moving.has(id)) return;
    const { title, body, choices } = deleteConfirm(kindOf(task), task, deps.tasks());
    const answer = await askChoice(title, body, choices);
    if (answer === null) return;
    let deleted: string[] = [];
    await run(id, async (a) => {
      deleted = await a.remove(id, answer === 'all');
    });
    if (deleted.length === 0) return; // failed: run showed the error
    info(deleted.length === 1 ? `Deleted ${deleted[0]}` : `Deleted ${deleted.length} tasks`);
    deps.order.forget(deleted);
    const ctx = deps.start.context();
    if (ctx !== null) {
      for (const d of deleted) await deps.start.forget(ctx.projectId, d).catch((e: unknown) => fail(`Could not drop the start options of ${d}: ${errorMessage(e)}`));
    }
  };

  /** The modal's "Publish to GitHub": confirm, publish; a half-done publish shows what was created (run's error toast). */
  const publishTask = async (id: string): Promise<void> => {
    const task = find(id);
    if (task === null || deps.api() === null || moving.has(id)) return;
    const { title, body, label } = publishConfirm(task, deps.tasks());
    if ((await askChoice(title, body, [{ id: 'publish', label }])) !== 'publish') return;
    await run(id, async (a) => info(publishedMessage(await a.publish(id))));
  };

  const closeDetail = (): void => {
    const d = detail;
    detail = null;
    card = null;
    lookup = null;
    d?.handle.dispose();
  };

  const showDetail = (openId: string): void => {
    let id = openId;
    const task = find(id);
    if (task === null) return;
    closeDetail();
    loadCard(id);
    const handle = openDetail(detailModel(task), {
      onOpenSession: () => openSession(id),
      onOpenTask: (child) => queueMicrotask(() => showDetail(child)),
      onAddSubtask: async ({ title, type }) => {
        const api = deps.api();
        if (api === null) return 'No project is open.';
        const input: NewTask = { title, state: 'needs-triage', parentId: id, ...(type !== null ? { type } : {}) };
        try {
          const created = await api.create(input);
          info(`Created ${created.id}`);
        } catch (e) {
          return errorMessage(e);
        }
        await deps.reload();
        refreshDetail();
        return null;
      },
      onSetParent: (parentId) => linkTask(id, parentId),
      onEdit: (from, draft) => editTask(id, from, draft),
      onDelete: () => void deleteTask(id),
      onPublish: () => void publishTask(id),
      onLinkChild: (childId) => linkTask(childId, id),
      onRemoveParent: () => unlinkTask(id),
      onUnlinkChild: async (childId) => {
        const child = find(childId);
        const parent = find(id);
        if (child === null || parent === null) return null;
        const { title, body } = unlinkConfirm(kindOf(child), child, parent.title);
        if ((await askChoice(title, body, [{ id: 'unlink', label: 'Unlink', variant: 'destructive' }])) !== 'unlink') return null;
        return unlinkTask(childId);
      },
      onSections: deps.sections.save,
      onUnarchive: () => {
        deps.archive.unarchive(id);
        refreshDetail();
      },
      lists: deps.lists,
      onStartOptions: (options) => {
        if (card === null || card.taskId !== id) return;
        const languageChanged = options.summaryLanguage !== card.options.summaryLanguage;
        card.options = options;
        deps.start.save(card.projectId, id, options);
        if (languageChanged) deps.summary.onLanguage(card.projectId, id, options.summaryLanguage);
      },
      onSummarise: () => {
        const t = find(id);
        if (t !== null) deps.summary.summarise(t);
      },
      onMove: (to) => {
        const t = find(id);
        if (t !== null) move(id, detailModel(t).column, to);
      },
      onState: (state: TaskState) => {
        const t = find(id);
        if (t === null) return;
        if (state === 'done') void close(t, openChildren(t, deps.tasks()) > 0);
        else void runShown(id, new Map([[id, state]]), (api) => api.setState(id, state));
        refreshDetail(); // the select snaps back until the reload shows the saved state
      },
      onType: (type) => void run(id, (api) => api.setType(id, type)),
      onOpenUrl: (url) => void deps.host.openUrl(url).catch((e: unknown) => fail(errorMessage(e))),
      onDismiss: () => {
        closeDetail();
        deps.onOpenTaskClosed?.(id, 'dismissed');
      },
    }, { sections: deps.sections.get() });
    detail = { id, handle, onFollow: (next) => (id = next) };
    deps.onOpenTaskShown?.(id);
  };

  const closeAdd = (): void => {
    const m = addModal;
    addModal = null;
    m?.dispose();
  };

  /** Creates the task, saves its start options, then its sub-tasks one by one; reloads once at the end. */
  const submitAdd = async (draft: AddDraft): Promise<AddResult> => {
    const api = deps.api();
    if (api === null) return { kind: 'error', message: 'No project is open.' };
    const ctx = deps.start.context();
    // The draft's source decides how it is handled; its parent and links are of that source only.
    const source = sourceOr(draft.source, deps.primary());
    const subtasks = subtasksToCreate(draft, source);
    const existing = existingToLink(draft, source, sourceTasks(deps.tasks(), source)).map((id) => ({ id, label: find(id)?.title ?? id }));
    /** Never throws: the task exists by now, so a storage hiccup is a toast, not "could not create". */
    const saveStart = (taskId: string): void => {
      if (ctx === null || Object.keys(draft.start).length === 0) return;
      try {
        deps.start.save(ctx.projectId, taskId, draft.start);
        if (draft.start.summaryLanguage !== undefined) deps.summary.onLanguage(ctx.projectId, taskId, draft.start.summaryLanguage);
      } catch (e) {
        fail(`Could not save the start options of ${taskId}: ${errorMessage(e)}`);
      }
    };
    let first = true;
    let result: Awaited<ReturnType<typeof createWithSubtasks>>;
    try {
      result = await createWithSubtasks(
        async (input) => {
          const task = await api.create(input);
          // The first create is the task itself: its start options are stored once its id is known.
          if (first) {
            first = false;
            saveStart(task.id);
            if (ctx !== null && draft.type === '') {
              void deps.start.markNoType(ctx.projectId, task.id).catch((e: unknown) => fail(`Could not keep "No type" for ${task.id}: ${errorMessage(e)}`));
            }
          }
          return task;
        },
        toNewTask(draft, source),
        subtasks,
        { existing, setParent: setParentOf(api) },
      );
    } catch (e) {
      return { kind: 'error', message: errorMessage(e) };
    }
    const { task, failed } = result;
    // Fields left on "Let the model pick": asked once the task (and its sub-tasks) exist. Only this
    // task: its sub-tasks stay as created. The api is bound to the task's project directory.
    const asked = addOffer.suggest ? askedOf(draft, addOffer.types) : { type: false, state: false };
    if (asked.type || asked.state) {
      void deps.suggest.suggester.suggest({
        taskId: task.id,
        title: draft.title.trim(),
        body: draft.body.trim(),
        types: addOffer.types,
        asked,
        target: { get: api.get, setType: api.setType, setState: api.setState },
      });
    }
    if (failed.length === 0) {
      closeAdd();
      const n = subtasks.length + existing.length;
      void deps.host
        .toast({ kind: 'success', message: n === 0 ? `Created ${task.id}` : `Created ${task.id} with ${n} sub-task${n === 1 ? '' : 's'}` })
        .catch(() => {});
    }
    await deps.reload();
    return failed.length === 0 ? null : { kind: 'partial', message: partialMessage(task.id, failed) };
  };

  /** The add modal's start options; null while the project's settings are loading. */
  const addStart = (): AddModalStart | null => {
    const ctx = deps.start.context();
    return ctx === null
      ? null
      : {
          projectId: ctx.projectId,
          presets: ctx.presets,
          inherited: (type, subtasks) => resolveStart(ctx.settings, { type, subtasks }, {}, ctx.presets),
          summaryLanguage: ctx.settings.summary.language,
        };
  };

  const showAdd = (): void => {
    if (addModal !== null) return;
    const tasks = deps.tasks();
    const types = taskTypes(tasks, deps.baseTypes()).filter((t) => t !== MODEL_PICK);
    addOffer = { types, suggest: deps.suggest.enabled() && deps.suggest.suggester.available() };
    const { view, sources } = deps.sources();
    addModal = openAddModal(
      {
        primary: deps.primary(),
        types,
        suggest: addOffer.suggest,
        source: addSource(view, sources, deps.primary()),
        sources,
        tasks,
        labels: deps.labels(),
        start: addStart(),
        lists: deps.lists,
      },
      { onSubmit: submitAdd, onDismiss: closeAdd },
    );
  };

  const detachDrag = attachDrag(deps.board.columns, {
    canDrag: (id) => !moving.has(id),
    onDrop: move,
    canLink: (id, parentId) => {
      const child = find(id);
      const parent = find(parentId);
      return child !== null && parent !== null && canLinkUnder(kindOf(child), child, parent, deps.tasks());
    },
    onLink: (id, parentId) => void link(id, parentId),
    onReorder: (id, column, before) => {
      if (!moving.has(id)) deps.order.reorder(id, column, before);
    },
    onOpen: showDetail,
  });

  return {
    /** Ids whose write is in flight; the board draws them busy. */
    busy: moving as ReadonlySet<string>,
    showAdd,
    /** Add task's Create task (Mod+Enter); false when no form is open or it is busy. */
    submitAddForm: (): boolean => addModal?.submit() ?? false,
    /** Which of the two modals is open, for the Shortcut context: the task modal first. */
    openModal: (): 'task' | 'add' | null => (detail !== null ? 'task' : addModal !== null ? 'add' : null),
    /** The task modal (also what a click or Enter on a card opens). */
    showDetail,
    /** The Open task: its task id now and its Shortcuts (ui/detail.ts), or null when no task modal is open. */
    openTask: (): { id: string; shortcuts: OpenTaskShortcuts } | null => (detail === null ? null : { id: detail.id, shortcuts: detail.handle.shortcuts }),
    /**
     * Mod+↑/↓: the open modal shows `id` instead, once a changed Edit form is discarded. Resolves
     * false when it stays (kept, or the modal closed meanwhile).
     */
    switchOpenTask: async (id: string): Promise<boolean> => {
      const from = detail;
      if (from === null || find(id) === null || !(await from.handle.shortcuts.leave()) || detail !== from) return false;
      showDetail(id);
      return true;
    },
    /** Moves a card to another column through the same path as a drop (Mod+Shift+←/→). */
    moveCard: (id: string, to: Column): void => {
      const from = deps.columnOf(id);
      if (from !== null) move(id, from, to);
    },
    /** Project switch or the board went away: drop the modal and the form. */
    reset: () => {
      closeDetail();
      closeAdd();
    },
    /** After a reload from elsewhere (poll, Refresh, settings): keep the open modal current. */
    refresh: () => {
      // Settings for another project arrived (switch): the stored card options are someone else's.
      const ctx = deps.start.context();
      if (detail !== null && (card === null || ctx === null || card.projectId !== ctx.projectId)) loadCard(detail.id);
      refreshDetail();
      // The project's settings may have arrived (or changed) while Add task is open.
      addModal?.setStart(addStart());
    },
    dispose: () => {
      detachDrag();
      closeDetail();
      closeAdd();
    },
  };
};

export type Editor = ReturnType<typeof createEditor>;
