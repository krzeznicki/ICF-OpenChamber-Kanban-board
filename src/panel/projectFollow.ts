// Which project the board shows for the directory the host is in. A chat in a worktree lies outside
// every registered project, so its project is looked up. Pure but for the injected lookups: no DOM,
// no host, so it runs under node:test.
import type { GuestProject, GuestSessionRecord } from '@openchamber/sdk';

export type FollowDeps = {
  /** The host's sessions of one project (host.listSessions). */
  listSessions: (projectId: string) => Promise<{ sessions: readonly GuestSessionRecord[] }>;
  /**
   * Which of `directories` (the projects') the git worktree `dir` was made from (the service's
   * /project/of), or null when none. Throws when the service could not be asked.
   */
  projectOfWorktree: (dir: string, directories: string[]) => Promise<string | null>;
  /** Resolves after `ms`; tests pass an immediate one. */
  wait?: (ms: number) => Promise<void>;
};

/** A lookup that could not ask the service (it may still be starting) is tried this many times, this far apart. */
export const LOOKUP_TRIES = 3;
export const LOOKUP_RETRY_MS = 2_000;

/** The registered project that contains `dir`, the longest match winning (worktrees can sit inside projects). */
export const projectContaining = (dir: string | null, projects: readonly GuestProject[]): GuestProject | null => {
  if (dir === null) return null;
  let best: GuestProject | null = null;
  for (const p of projects) {
    const inside = dir === p.directory || dir.startsWith(p.directory.endsWith('/') ? p.directory : `${p.directory}/`);
    if (inside && (best === null || p.directory.length > best.directory.length)) best = p;
  }
  return best;
};

/** The project list a lookup answered for: another list is another question. */
const listKey = (projects: readonly GuestProject[]): string => projects.map((p) => `${p.id}\n${p.directory}`).join('\n');

export const createProjectFollow = (deps: FollowDeps) => {
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  /** Directories outside every project -> what a lookup answered (null: no project) and for which project list. */
  const answered = new Map<string, { projectId: string | null; list: string }>();
  const running = new Map<string, Promise<string | null>>();

  /** The project looked up for `dir`, null when the lookup found none, undefined when none has answered for this list. */
  const lookedUp = (dir: string, projects: readonly GuestProject[]): GuestProject | null | undefined => {
    const a = answered.get(dir);
    if (a === undefined || a.list !== listKey(projects)) return undefined;
    return projects.find((p) => p.id === a.projectId) ?? null;
  };

  /**
   * The session's record names the project: the chat's own (`sessionId`, the rail panel knows it),
   * else one working in `dir` (the board page knows only the directory). A session the host lists
   * under no project is placed by git: the worktree's main checkout is the project.
   */
  const find = async (dir: string, projects: readonly GuestProject[], sessionId: string | null): Promise<string | null> => {
    const lists = await Promise.allSettled(projects.map((p) => deps.listSessions(p.id)));
    const records = lists.flatMap((r) => (r.status === 'fulfilled' ? r.value.sessions : []));
    const record = records.find((s) => s.id === sessionId) ?? records.find((s) => s.directory === dir);
    if (record !== undefined && projects.some((p) => p.id === record.projectId)) return record.projectId;
    const directory = await deps.projectOfWorktree(dir, projects.map((p) => p.directory));
    return projects.find((p) => p.directory === directory)?.id ?? null;
  };

  const findWithRetries = async (dir: string, projects: readonly GuestProject[], sessionId: string | null): Promise<string | null> => {
    for (let n = 1; ; n++) {
      try {
        const projectId = await find(dir, projects, sessionId);
        answered.set(dir, { projectId, list: listKey(projects) });
        return projectId;
      } catch {
        // Not remembered: the next call asks again.
        if (n >= LOOKUP_TRIES) return null;
        await wait(LOOKUP_RETRY_MS);
      }
    }
  };

  return {
    /**
     * The project to show: the one containing the host's directory, else the one looked up for it,
     * else the one shown now, else the first.
     */
    choose: (dir: string | null, projects: readonly GuestProject[], current: GuestProject | null): GuestProject | null =>
      projectContaining(dir, projects) ?? (dir === null ? null : lookedUp(dir, projects)) ?? current ?? projects[0] ?? null,
    /** `dir` lies outside every project and no lookup has answered for it (and this project list) yet. */
    unknown: (dir: string | null, projects: readonly GuestProject[]): dir is string =>
      dir !== null && projectContaining(dir, projects) === null && lookedUp(dir, projects) === undefined,
    /**
     * Looks up the project of a directory outside every project; `sessionId` is the chat open there,
     * when known. Resolves to its id (then `choose` answers it) or null; one lookup per directory
     * and project list at a time.
     */
    lookup: (dir: string, projects: readonly GuestProject[], sessionId: string | null): Promise<string | null> => {
      const key = `${dir}\n${listKey(projects)}`;
      const busy = running.get(key);
      if (busy !== undefined) return busy;
      const job = findWithRetries(dir, projects, sessionId).finally(() => running.delete(key));
      running.set(key, job);
      return job;
    },
  };
};

export type ProjectFollow = ReturnType<typeof createProjectFollow>;
