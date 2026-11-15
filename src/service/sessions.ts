// Path B of the session start (see docs/superpowers/specs/2026-11-15-session-start-findings.md):
// the service makes the worktree with git, starts the session through OpenChamber's service host
// and remembers which session works on which task, because such a session carries no items.
// The links live in ~/.icf-kanban/links.json, outside the package (a write inside it reloads the extension).
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import type { LinkStatus } from '../core/queue.ts';
import type { Exec } from '../core/types.ts';
import { TrackerError } from '../core/types.ts';
import { readJson, serial, writeJson } from './store.ts';

export type Link = { taskId: string; sessionId: string; directory: string; createdAt: number };

/** The part of the SDK's ServiceHost this needs; tests pass a fake. */
export type SessionHost = {
  start: (input: {
    prompt: string;
    directory?: string;
    title?: string;
    model?: string;
    agent?: string;
  }) => Promise<{ sessionId: string; directory: string | null }>;
  /** `idle`, `busy`, or `waiting` when only the user can move it on; throws for an unknown session. */
  status?: (sessionId: string) => Promise<'idle' | 'busy' | 'waiting'>;
};

export type StartInput = {
  directory: string;
  taskId: string;
  title: string;
  prompt: string;
  model: string | null;
  agent: string | null;
  location: 'worktree' | 'project';
};

/** Links kept per project; the oldest go first. */
export const LINKS_PER_PROJECT = 500;

export const defaultLinksFile = (): string => join(homedir(), '.icf-kanban', 'links.json');

type LinksFile = { version: 1; projects: Record<string, Link[]> };

const isLink = (v: unknown): v is Link => {
  const l = v as Partial<Link> | null;
  return (
    typeof l === 'object' &&
    l !== null &&
    typeof l.taskId === 'string' &&
    typeof l.sessionId === 'string' &&
    typeof l.directory === 'string' &&
    typeof l.createdAt === 'number'
  );
};

/** A missing file is empty; a corrupt one is set aside (store.ts); other read errors throw. */
const readLinksFile = async (file: string): Promise<LinksFile> => {
  const raw = await readJson(file);
  const projects: Record<string, Link[]> = {};
  const src = (raw as { projects?: unknown } | null)?.projects;
  if (typeof src === 'object' && src !== null && !Array.isArray(src)) {
    for (const [dir, list] of Object.entries(src)) if (Array.isArray(list)) projects[dir] = list.filter(isLink);
  }
  return { version: 1, projects };
};

export const listLinks = async (file: string, directory: string): Promise<Link[]> =>
  (await readLinksFile(file)).projects[directory] ?? [];

/** Writes are serialised per file so two starts never drop each other's link. */
export const addLink = (file: string, project: string, link: Link): Promise<void> =>
  serial(file, async () => {
    const data = await readLinksFile(file);
    const list = [...(data.projects[project] ?? []), link];
    data.projects[project] = list.slice(-LINKS_PER_PROJECT);
    await writeJson(file, data);
  });

/** How many tasks' newest sessions get their live status asked; older links answer `unknown`. */
export const STATUS_CHECK_MAX = 50;
const STATUS_CONCURRENCY = 8;

/**
 * The live status of each link's session: the newest link of each task (the newest
 * STATUS_CHECK_MAX tasks) is asked through sessions.status; the rest, and a session the host
 * does not know, are `unknown`.
 */
export const linkStatuses = async (links: readonly Link[], sessions: SessionHost | undefined): Promise<Map<string, LinkStatus>> => {
  const out = new Map<string, LinkStatus>();
  const status = sessions?.status;
  if (status === undefined) return out;
  const newest = new Map<string, Link>();
  for (const l of links) {
    const n = newest.get(l.taskId);
    if (n === undefined || l.createdAt >= n.createdAt) newest.set(l.taskId, l);
  }
  const ask = [...newest.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, STATUS_CHECK_MAX);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < ask.length) {
      const l = ask[next++]!;
      try {
        out.set(l.sessionId, await status(l.sessionId));
      } catch {
        out.set(l.sessionId, 'unknown');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(STATUS_CONCURRENCY, ask.length) }, worker));
  return out;
};

export const withStatus = async (
  links: readonly Link[],
  sessions: SessionHost | undefined,
): Promise<Array<Link & { status: LinkStatus }>> => {
  const statuses = await linkStatuses(links, sessions);
  return links.map((l) => ({ ...l, status: statuses.get(l.sessionId) ?? 'unknown' }));
};

/** Sessions working right now (busy, or waiting on the user) among a project's links. */
export const runningCount = async (links: readonly Link[], sessions: SessionHost | undefined): Promise<number> => {
  let n = 0;
  for (const s of (await linkStatuses(links, sessions)).values()) if (s === 'busy' || s === 'waiting') n++;
  return n;
};

/** `dir` is `root` or inside it. */
export const isInside = (dir: string, root: string): boolean => dir === root || dir.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

/** A branch- and folder-safe name: the task's title (or id) and a short unique suffix. */
export const worktreeSlug = (taskId: string, title: string, suffix = randomBytes(3).toString('hex')): string => {
  const base = (s: string): string =>
    s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '');
  const name = base(title) || base(taskId.replace(/^.*\//, '').replace(/\.md$/, '')) || 'task';
  return `${name}-${suffix}`;
};

/** `<parent>/<repo>-worktrees`: next to the project, never inside it. */
export const worktreesRoot = (directory: string): string => join(dirname(directory), `${basename(directory)}-worktrees`);

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export type StartDeps = { exec: Exec; sessions: SessionHost; linksFile: string; suffix?: () => string };

export const startSession = async (
  input: StartInput,
  deps: StartDeps,
): Promise<{ sessionId: string; directory: string; worktree: string | null }> => {
  let worktree: string | null = null;
  if (input.location === 'worktree') {
    const slug = worktreeSlug(input.taskId, input.title, deps.suffix?.());
    const path = join(worktreesRoot(input.directory), slug);
    const r = await deps.exec('git', ['-C', input.directory, 'worktree', 'add', '-b', `icf/${slug}`, path], { cwd: input.directory });
    if (r.code !== 0) {
      throw new TrackerError('FAILED', `Could not create the worktree ${path}: ${(r.stderr || r.stdout).trim() || `git exited ${r.code}`}`);
    }
    worktree = path;
  }
  const cwd = worktree ?? input.directory;
  let started: { sessionId: string; directory: string | null };
  try {
    started = await deps.sessions.start({
      prompt: input.prompt,
      directory: cwd,
      title: input.title,
      ...(input.model !== null ? { model: input.model } : {}),
      ...(input.agent !== null ? { agent: input.agent } : {}),
    });
  } catch (e) {
    const kept = worktree === null ? '' : ` The worktree ${worktree} was created and is kept; remove it with git worktree remove if you do not need it.`;
    throw new TrackerError('FAILED', `Could not start the session: ${message(e).replace(/\.$/, '')}.${kept}`);
  }
  const directory = started.directory ?? cwd;
  try {
    await addLink(deps.linksFile, input.directory, { taskId: input.taskId, sessionId: started.sessionId, directory, createdAt: Date.now() });
  } catch (e) {
    throw new TrackerError(
      'FAILED',
      `The session ${started.sessionId} started, but its link to the card could not be saved (${message(e)}); the card will not follow it.`,
    );
  }
  return { sessionId: started.sessionId, directory, worktree };
};
