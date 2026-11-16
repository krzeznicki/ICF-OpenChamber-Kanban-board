export type TaskState =
  | 'needs-triage'
  | 'needs-info'
  | 'ready-for-agent'
  | 'ready-for-human'
  | 'wontfix'
  | 'done';

/** Every TaskState, in workflow order. */
export const TASK_STATES: readonly TaskState[] = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix', 'done'];

export type TaskKind = 'parent' | 'ticket';

export type Task = {
  /** local: ".scratch/<feature>/issues/01-slug.md" or ".scratch/<feature>/spec.md"; github: "#42" */
  id: string;
  kind: TaskKind;
  title: string;
  /** full markdown as stored */
  body: string;
  /** no state line / no label -> 'needs-triage' */
  state: TaskState;
  /** 'bug' | 'enhancement' | custom ('chore', 'research', ...) */
  type: string | null;
  parentId: string | null;
  /** ids */
  blockedBy: string[];
  /** github html url, null for local */
  url: string | null;
  /** epoch ms */
  updatedAt: number;
  /**
   * An agent took it with `task-board claim` (local: `Status: claimed`; GitHub: it has an assignee).
   * Only counts while the task is ready-for-agent and its parent's orchestrator session runs.
   */
  claimed: boolean;
};

export type NewTask = {
  title: string;
  body?: string;
  type?: string;
  state?: TaskState;
  parentId?: string;
  blockedBy?: string[];
};

/** What `Tracker.edit` changes; an omitted field stays as it is. */
export type TaskEdit = {
  title?: string;
  /** The description only (local: without the heading, field lines and `## Comments` / `## Answer`). */
  body?: string;
};

export interface Tracker {
  /** open tasks + done ones from the last 30 days */
  list(): Promise<Task[]>;
  get(id: string): Promise<Task>;
  create(input: NewTask): Promise<Task>;
  /** 'done' closes; from 'done' reopens */
  setState(id: string, state: TaskState): Promise<Task>;
  setType(id: string, type: string): Promise<Task>;
  /**
   * Changes the title and/or the description; the id stays (local: the file is not renamed). Local
   * keeps the heading's `NN:`, the Type / Status / Blocked by lines and the `## Comments` /
   * `## Answer` sections (localFormat.ts withDescription). A blank title is INVALID.
   */
  edit(id: string, changes: TaskEdit): Promise<Task>;
  /** Marks a sub-task as taken by the orchestrator (local: `Status: claimed`; GitHub: assign @me). */
  claim(id: string): Promise<Task>;
  /**
   * Makes an existing task a sub-task of another existing task (re-parenting it if it has one).
   * The returned task can have a new id (local: the file moves into the parent's feature), so
   * callers re-key whatever they keep under `id`. Itself, its current parent or a target that
   * cannot be a parent is INVALID.
   */
  setParent(id: string, parentId: string): Promise<Task>;
  /**
   * Unlinks a sub-task from its parent; it becomes a top-level task. Like setParent the id can
   * change (local: the ticket moves out into a feature of its own). A task without a parent is INVALID.
   */
  removeParent(id: string): Promise<Task>;
  /** returns every task it closed */
  close(id: string, opts: { withChildren: boolean }): Promise<Task[]>;
  /**
   * Deletes the task for good; returns the ids of every task it deleted (sub-tasks first), so
   * callers drop what they keep under them. Local: a feature with tickets needs `withChildren`
   * (the whole folder goes; other files in it refuse). GitHub: `gh issue delete` (repo admins only);
   * `withChildren` deletes the whole subtree (closed sub-issues and their sub-issues too); without
   * it sub-issues stay as top-level issues.
   */
  remove(id: string, opts: { withChildren: boolean }): Promise<string[]>;
}

export type Exec = (
  cmd: string,
  args: string[],
  /** `timeoutMs`: stop the program after this long and report a failed run (default: no limit). */
  opts: { cwd: string; timeoutMs?: number },
) => Promise<{ code: number; stdout: string; stderr: string }>;

export type TrackerErrorCode =
  | 'NOT_CONFIGURED'
  | 'UNSUPPORTED'
  | 'NOT_FOUND'
  | 'GH_MISSING'
  | 'GH_AUTH'
  | 'GH_OLD'
  | 'INVALID'
  | 'FAILED';

export class TrackerError extends Error {
  // Declared explicitly: Node's type stripping does not support constructor parameter properties.
  public code: TrackerErrorCode;

  constructor(code: TrackerErrorCode, message: string) {
    super(message);
    this.name = 'TrackerError';
    this.code = code;
  }
}
