// Several sources per project (ADR 0001): one adapter per Source, and the combined tracker the CLI
// and the service use. The combined tracker is a Tracker over the adapters: `list` merges theirs,
// every operation on an id goes to the source that owns it, `create` goes to the primary source.
// Adding a source (Linear, Jira, ...) is one adapter here plus its id in config.ts SOURCE_IDS.
import type { ProjectConfig, SourceId } from './config.ts';
import { createGithubTracker } from './githubTracker.ts';
import { createLocalTracker } from './localTracker.ts';
import type { Exec, Task, Tracker, TrackerErrorCode } from './types.ts';
import { TrackerError } from './types.ts';

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
  const message = e instanceof Error ? e.message : String(e);
  return { status: e instanceof TrackerError && e.code === 'GH_AUTH' ? 'needs-login' : 'unavailable', message };
};

const sourceError = (source: SourceId, e: unknown): SourceError => ({
  source,
  code: e instanceof TrackerError ? e.code : 'FAILED',
  message: e instanceof Error ? e.message : String(e),
  availability: availabilityOf(e).status,
});

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
    throw new TrackerError('NOT_FOUND', `No source of this project has a task "${id}" (sources: ${sources.map((s) => s.id).join(', ')})`);
  };
  const primarySource = sources.find((s) => s.id === primary) ?? sources[0]!;

  const listAll = async (opts: { source?: string } = {}): Promise<SourcedList> => {
    const asked = opts.source === undefined ? sources : sources.filter((s) => s.id === opts.source);
    if (asked.length === 0) {
      throw new TrackerError('INVALID', `Unknown source "${opts.source}": this project has ${sources.map((s) => s.id).join(', ')}`);
    }
    const results = await Promise.allSettled(asked.map((s) => s.list()));
    const failed = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
    if (failed.length === asked.length) throw failed[0];
    const tasks: Task[] = [];
    const errors: SourceError[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') tasks.push(...r.value);
      else errors.push(sourceError(asked[i]!.id, r.reason));
    });
    return { tasks, errors };
  };

  return {
    primary: primarySource.id,
    sources,
    sourceOf,
    listAll,
    list: async () => (await listAll()).tasks,
    get: async (id) => sourceOf(id).get(id),
    create: async (input) => primarySource.create(input),
    setState: async (id, state) => sourceOf(id).setState(id, state),
    setType: async (id, type) => sourceOf(id).setType(id, type),
    edit: async (id, changes) => sourceOf(id).edit(id, changes),
    claim: async (id) => sourceOf(id).claim(id),
    setParent: async (id, parentId) => sourceOf(id).setParent(id, parentId),
    removeParent: async (id) => sourceOf(id).removeParent(id),
    close: async (id, opts) => sourceOf(id).close(id, opts),
    remove: async (id, opts) => sourceOf(id).remove(id, opts),
  };
};
