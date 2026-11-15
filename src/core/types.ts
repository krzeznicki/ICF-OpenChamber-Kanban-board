export type TaskState =
  | 'needs-triage'
  | 'needs-info'
  | 'ready-for-agent'
  | 'ready-for-human'
  | 'wontfix'
  | 'done';

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

export interface Tracker {
  /** open tasks + done ones from the last 30 days */
  list(): Promise<Task[]>;
  get(id: string): Promise<Task>;
  create(input: NewTask): Promise<Task>;
  /** 'done' closes; from 'done' reopens */
  setState(id: string, state: TaskState): Promise<Task>;
  setType(id: string, type: string): Promise<Task>;
  /** Marks a sub-task as taken by the orchestrator (local: `Status: claimed`; GitHub: assign @me). */
  claim(id: string): Promise<Task>;
  /** returns every task it closed */
  close(id: string, opts: { withChildren: boolean }): Promise<Task[]>;
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
