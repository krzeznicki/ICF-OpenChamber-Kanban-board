// Which project the board shows for the directory the host is in. A chat in a worktree lies outside
// every registered project, so its project is looked up. Pure but for the injected lookups: no DOM,
// no host, so it runs under node:test.
import type { GuestProject, GuestSessionRecord } from '@openchamber/sdk';

export type FollowDeps = {
  /** The host's sessions of one project (host.listSessions). */
  listSessions: (projectId: string) => Promise<{ sessions: readonly GuestSessionRecord[] }>;
  /** The main checkout of the git worktree `dir` (the service's /project/root), or null when it is none. */
  mainCheckout: (dir: string) => Promise<string | null>;
};

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

export const createProjectFollow = (deps: FollowDeps) => {
  /** Directories outside every project -> the project found for them. */
  const found = new Map<string, string>();
  const running = new Map<string, Promise<string | null>>();

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
    return projectContaining(await deps.mainCheckout(dir), projects)?.id ?? null;
  };

  return {
    /**
     * The project to show: the one containing the host's directory, else the one looked up for it,
     * else the one shown now, else the first.
     */
    choose: (dir: string | null, projects: readonly GuestProject[], current: GuestProject | null): GuestProject | null => {
      const looked = dir === null ? undefined : found.get(dir);
      return projectContaining(dir, projects) ?? projects.find((p) => p.id === looked) ?? current ?? projects[0] ?? null;
    },
    /** `dir` lies outside every project and has not been looked up with success yet. */
    unknown: (dir: string | null, projects: readonly GuestProject[]): dir is string =>
      dir !== null && projectContaining(dir, projects) === null && !projects.some((p) => p.id === found.get(dir)),
    /**
     * Looks up the project of a directory outside every project; `sessionId` is the chat open there,
     * when known. Resolves to its id (then `choose` answers it) or null; one lookup per directory at a time.
     */
    lookup: (dir: string, projects: readonly GuestProject[], sessionId: string | null): Promise<string | null> => {
      const busy = running.get(dir);
      if (busy !== undefined) return busy;
      const job = find(dir, projects, sessionId)
        .catch(() => null)
        .then((id) => {
          running.delete(dir);
          if (id !== null) found.set(dir, id);
          return id;
        });
      running.set(dir, job);
      return job;
    },
  };
};

export type ProjectFollow = ReturnType<typeof createProjectFollow>;
