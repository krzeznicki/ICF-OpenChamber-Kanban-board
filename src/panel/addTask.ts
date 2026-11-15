// What the Add task modal (ui/addModal.ts) and the task modal's "Add sub-task" may offer, and how a
// filled form becomes service calls. Pure: no DOM, no host, so it runs under node:test.
// Local tracker: a task without a parent is a feature (spec.md) and its sub-tasks are tickets under
// it; a ticket takes no sub-tasks, and blockers must be open tickets of the same feature (the
// local tracker rejects any other). GitHub: any open issue may be a blocker, and any open issue can
// take sub-tasks (it becomes a parent).
import type { NewTask, Task, TaskKind, TaskState } from '../core/types.ts';
import type { CardOptions } from './settings.ts';

export type TrackerKind = 'local' | 'github';
export type Choice = { id: string; label: string; hint?: string };

/**
 * "Let the model pick" in the Type and State selects (suggest.ts): the task is created as
 * needs-triage with no type, and the Small Model's suggestion fills in these fields afterwards.
 * A type literally named ":model" is not offered in the add form, so the two never clash.
 */
export const MODEL_PICK = ':model';
export type ModelPick = typeof MODEL_PICK;

/** The add form's values; '' means "none" for type and parent, MODEL_PICK "let the model pick". */
export type AddDraft = {
  title: string;
  type: string;
  parentId: string;
  state: TaskState | ModelPick;
  blockedBy: string[];
  body: string;
  /** Raw sub-task rows as typed (empty rows are ignored). */
  subtasks: string[];
  /** The card's start options, saved under card:<projectId>:<taskId> once the task exists. */
  start: CardOptions;
};

/** `suggest`: Type and State start on "Let the model pick" (the setting is on and a model may answer). */
export const emptyDraft = (suggest = false): AddDraft => ({
  title: '',
  type: suggest ? MODEL_PICK : '',
  parentId: '',
  state: suggest ? MODEL_PICK : 'needs-triage',
  blockedBy: [],
  body: '',
  subtasks: [],
  start: {},
});

/**
 * True when closing the form would lose something: text typed (blank text does not count), a
 * blocker or start option set, or a choice changed from what the form opened with (`initial`).
 */
export const isDirty = (draft: AddDraft, initial: AddDraft = emptyDraft()): boolean =>
  draft.title.trim() !== '' ||
  draft.body.trim() !== '' ||
  draft.subtasks.some((row) => row.trim() !== '') ||
  draft.type !== initial.type ||
  draft.parentId !== initial.parentId ||
  draft.state !== initial.state ||
  draft.blockedBy.length > 0 ||
  Object.values(draft.start).some((v) => v !== undefined);

/** States a new task may start in: the open ones (done and wontfix are reached by moving it). */
export const CREATE_STATES: readonly TaskState[] = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human'];

const choice = (t: Task): Choice => ({ id: t.id, label: t.title, hint: t.id });

/** Open parents a new task may belong to. */
export const parentChoices = (tasks: readonly Task[]): Choice[] =>
  tasks.filter((t) => t.kind === 'parent' && t.state !== 'done').map(choice);

/** Open tasks the new task may be blocked by, given the chosen parent ('' = none). */
export const blockerChoices = (tasks: readonly Task[], tracker: TrackerKind, parentId: string): Choice[] => {
  // A sub-issue blocked by its own parent would never be unblocked: the parent waits for it.
  if (tracker === 'github') return tasks.filter((t) => t.state !== 'done' && t.id !== parentId).map(choice);
  if (parentId === '') return [];
  return tasks.filter((t) => t.kind === 'ticket' && t.parentId === parentId && t.state !== 'done').map(choice);
};

/** The selected ids still offered, in the order they were picked (after a parent change). */
export const keepOffered = (selected: readonly string[], offered: readonly Choice[]): string[] => {
  const ids = new Set(offered.map((c) => c.id));
  return selected.filter((id) => ids.has(id));
};

/** Whether the new task may list sub-tasks to create under it. */
export const canHaveSubtasks = (tracker: TrackerKind, parentId: string): boolean => tracker === 'github' || parentId === '';

/** Whether the task modal offers "Add sub-task" for this task. */
export const canAddSubtask = (task: Task, tracker: TrackerKind): boolean =>
  task.state !== 'done' && (tracker === 'github' || task.kind === 'parent');

export const subtaskTitles = (rows: readonly string[]): string[] => rows.map((r) => r.trim()).filter((r) => r !== '');

/** The sub-task titles to create under the new task: none when it may not have any (rows hidden, not cleared). */
export const subtasksToCreate = (d: AddDraft, tracker: TrackerKind): string[] =>
  canHaveSubtasks(tracker, d.parentId) ? subtaskTitles(d.subtasks) : [];

/** What the new task will be, so its inherited start options (preset by kind) can be shown. */
export const draftKind = (d: AddDraft, tracker: TrackerKind): TaskKind => {
  if (tracker === 'local') return d.parentId === '' ? 'parent' : 'ticket';
  return subtaskTitles(d.subtasks).length > 0 ? 'parent' : 'ticket';
};

/** The type the task is created with: none for "No type" and for "Let the model pick". */
export const draftType = (d: Pick<AddDraft, 'type'>): string | null => (d.type === '' || d.type === MODEL_PICK ? null : d.type);

export const validateDraft = (d: AddDraft): { title?: string } => (d.title.trim() === '' ? { title: 'A title is required' } : {});

export const toNewTask = (d: AddDraft, tracker: TrackerKind): NewTask => {
  const body = d.body.trim();
  const blockers = tracker === 'local' && d.parentId === '' ? [] : d.blockedBy;
  const type = draftType(d);
  return {
    title: d.title.trim(),
    state: d.state === MODEL_PICK ? 'needs-triage' : d.state,
    ...(type !== null ? { type } : {}),
    ...(body !== '' ? { body } : {}),
    ...(d.parentId !== '' ? { parentId: d.parentId } : {}),
    ...(blockers.length > 0 ? { blockedBy: [...blockers] } : {}),
  };
};

export type SubtaskFailure = { title: string; message: string };

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Creates the task, then each sub-task under it, one after another (local numbering and GitHub's
 * `--parent` both want that order). The task failing rejects; a failing sub-task is collected.
 */
export const createWithSubtasks = async (
  create: (input: NewTask) => Promise<Task>,
  input: NewTask,
  subtasks: readonly string[],
): Promise<{ task: Task; failed: SubtaskFailure[] }> => {
  const task = await create(input);
  const failed: SubtaskFailure[] = [];
  for (const title of subtasks) {
    try {
      await create({ title, state: 'needs-triage', parentId: task.id });
    } catch (e) {
      failed.push({ title, message: messageOf(e) });
    }
  }
  return { task, failed };
};

export const partialMessage = (taskId: string, failed: readonly SubtaskFailure[]): string => {
  const n = failed.length;
  const list = failed.map((f) => `“${f.title}” (${f.message})`).join('; ');
  return `Created ${taskId}, but ${n} sub-task${n === 1 ? ' was' : 's were'} not created: ${list}.`;
};
