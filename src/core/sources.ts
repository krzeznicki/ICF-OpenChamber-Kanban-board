// Several sources per project (ADR 0001): one adapter per Source, and the combined tracker the CLI
// and the service use. The combined tracker is a Tracker over the adapters: `list` merges theirs,
// every operation on an id goes to the source that owns it, `create` goes to the parent's source, the
// named one or the primary one. Links (parent, blockers) never cross sources.
// Adding a source (Linear, Jira, ...) is one adapter here plus its id in config.ts SOURCE_IDS.
import type { ProjectConfig, SourceId } from './config.ts';
import { createGithubTracker } from './githubTracker.ts';
import { createLocalTracker } from './localTracker.ts';
import type { Exec, NewTask, Task, Tracker, TrackerErrorCode } from './types.ts';
import { TrackerError, errorMessage } from './types.ts';

/** What a source can do; the panel and the CLI ask these instead of checking the source's kind. */
export type SourceCapabilities = {
  create: boolean;
  /** Tasks can have sub-tasks (local: a feature's tickets, two levels; GitHub: sub-issues, any depth). */
  subtasks: boolean;
  blockedBy: boolean;
  claim: boolean;
  delete: boolean;
};

/** Whether a source answers: `needs-login` the user can fix by logging in; `unavailable` anything else. */
export type SourceAvailability = { status: 'ok' } | { status: 'needs-login' | 'unavailable'; message: string };

/** What the board shows about a source without opening it (the service's /config/read). */
export type SourceInfo = { id: SourceId; label: string; capabilities: SourceCapabilities };

export type SourceAdapter = Tracker &
  SourceInfo & {
    /** True when `id` is one of this source's task ids (ids of different sources never collide). */
    owns(id: string): boolean;
    availability(): Promise<SourceAvailability>;
  };

/** One source that failed while listing; the other sources' tasks are still returned. */
export type SourceError = {
  source: SourceId;
  code: TrackerErrorCode;
  message: string;
  availability: Exclude<SourceAvailability['status'], 'ok'>;
};

export type SourcedList = { tasks: Task[]; errors: SourceError[] };

export type CombinedTracker = Tracker & {
  primary: SourceId;
  /** Every source, the primary first. */
  sources: readonly SourceAdapter[];
  /**
   * The tasks of every source (or only `source`), plus the error of each source that failed. When
   * every source asked fails, it throws the first error, as a single tracker did. `list` is this
   * without the errors.
   */
  listAll(opts?: { source?: string }): Promise<SourcedList>;
  /** The source that owns `id`; NOT_FOUND when none does. */
  sourceOf(id: string): SourceAdapter;
};

const ALL: SourceCapabilities = { create: true, subtasks: true, blockedBy: true, claim: true, delete: true };

export const SOURCES: Record<SourceId, Omit<SourceInfo, 'id'>> = {
  local: { label: 'Local', capabilities: ALL },
  github: { label: 'GitHub', capabilities: ALL },
};

export const sourceInfo = (id: SourceId): SourceInfo => ({ id, ...SOURCES[id] });

const availabilityOf = (e: unknown): Exclude<SourceAvailability, { status: 'ok' }> => {
  return { status: e instanceof TrackerError && e.code === 'GH_AUTH' ? 'needs-login' : 'unavailable', message: errorMessage(e) };
};

/**
 * The error of a source whose list failed with `e`. Its availability comes from the error's code,
 * else from asking the source (a gh login that expired after the preflight fails as a plain gh error).
 */
const sourceError = async (source: SourceAdapter, e: unknown): Promise<SourceError> => {
  const fromError = availabilityOf(e).status;
  const asked = fromError === 'needs-login' ? null : await source.availability().catch(() => null);
  return {
    source: source.id,
    code: e instanceof TrackerError ? e.code : 'FAILED',
    message: errorMessage(e),
    availability: asked?.status === 'needs-login' ? 'needs-login' : fromError,
  };
};

export const createLocalSource = (root: string): SourceAdapter => ({
  ...createLocalTracker(root),
  ...sourceInfo('local'),
  owns: (id) => id.startsWith('.scratch/'),
  availability: async () => ({ status: 'ok' }),
});

export const createGithubSource = (root: string, exec: Exec, labels: ProjectConfig['labels']): SourceAdapter => {
  const tracker = createGithubTracker(root, exec, labels);
  return {
    ...tracker,
    ...sourceInfo('github'),
    // `42` is accepted as well as `#42`, as the GitHub tracker always did.
    owns: (id) => /^\s*#?\d+\s*$/.test(id),
    availability: async () => {
      try {
        await tracker.preflight();
        return { status: 'ok' };
      } catch (e) {
        return availabilityOf(e);
      }
    },
  };
};

export const createCombinedTracker = (primary: SourceId, sources: readonly SourceAdapter[]): CombinedTracker => {
  const sourceOf = (id: string): SourceAdapter => {
    const owner = sources.find((s) => s.owns(id));
    if (owner !== undefined) return owner;
    // One source: it judges the id itself, so its own messages stay as they were.
    if (sources.length === 1) return sources[0]!;
    throw new TrackerError('NOT_FOUND', `No source of this project has a task "${id}" (sources: ${known()})`);
  };
  const primarySource = sources.find((s) => s.id === primary) ?? sources[0]!;
  const known = (): string => sources.map((s) => s.id).join(', ');
  const named = (id: string): SourceAdapter => {
    const source = sources.find((s) => s.id === id);
    if (source === undefined) throw new TrackerError('INVALID', `Unknown source "${id}": this project has ${known()}`);
    return source;
  };
  const NO_LINKS = 'tasks of different sources are never linked';

  /** Where a new task goes: its parent's source, else the named one, else the primary one. */
  const targetOf = (input: NewTask): SourceAdapter => {
    const asked = input.source === undefined ? undefined : named(input.source);
    if (input.parentId === undefined) return asked ?? primarySource;
    const parent = sourceOf(input.parentId);
    if (asked !== undefined && asked !== parent) {
      throw new TrackerError(
        'INVALID',
        `A sub-task goes to its parent's source: ${input.parentId} is in ${parent.id}, not ${asked.id}; drop --source or pick a parent in ${asked.id}`,
      );
    }
    return parent;
  };

  const create = async (input: NewTask): Promise<Task> => {
    const target = targetOf(input);
    for (const b of input.blockedBy ?? []) {
      const owner = sources.find((s) => s.owns(b));
      if (owner !== undefined && owner !== target) {
        throw new TrackerError('INVALID', `Blocker ${b} is in ${owner.id}, but the new task goes to ${target.id}: ${NO_LINKS}`);
      }
    }
    const { source: _source, ...rest } = input;
    return target.create(rest);
  };

  const setParent = async (id: string, parentId: string): Promise<Task> => {
    const child = sourceOf(id);
    const parent = sourceOf(parentId);
    if (child !== parent) {
      throw new TrackerError('INVALID', `${id} (${child.id}) and ${parentId} (${parent.id}) are in different sources: ${NO_LINKS}`);
    }
    return child.setParent(id, parentId);
  };

  const listAll = async (opts: { source?: string } = {}): Promise<SourcedList> => {
    const asked = opts.source === undefined ? sources : sources.filter((s) => s.id === opts.source);
    if (asked.length === 0) {
      throw new TrackerError('INVALID', `Unknown source "${opts.source}": this project has ${known()}`);
    }
    const results = await Promise.allSettled(asked.map((s) => s.list()));
    const failed = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
    if (failed.length === asked.length) throw failed[0];
    const tasks: Task[] = [];
    const errors: SourceError[] = [];
    for (const [i, r] of results.entries()) {
      if (r.status === 'fulfilled') tasks.push(...r.value);
      else errors.push(await sourceError(asked[i]!, r.reason));
    }
    return { tasks, errors };
  };

  return {
    primary: primarySource.id,
    sources,
    sourceOf,
    listAll,
    list: async () => (await listAll()).tasks,
    get: async (id) => sourceOf(id).get(id),
    create,
    setState: async (id, state) => sourceOf(id).setState(id, state),
    setType: async (id, type) => sourceOf(id).setType(id, type),
    edit: async (id, changes) => sourceOf(id).edit(id, changes),
    claim: async (id) => sourceOf(id).claim(id),
    setParent,
    removeParent: async (id) => sourceOf(id).removeParent(id),
    close: async (id, opts) => sourceOf(id).close(id, opts),
    remove: async (id, opts) => sourceOf(id).remove(id, opts),
  };
};
