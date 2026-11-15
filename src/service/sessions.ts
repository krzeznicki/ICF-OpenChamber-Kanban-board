// Path B of the session start (see docs/superpowers/specs/2026-11-15-session-start-findings.md):
// the service makes the worktree with git, starts the session through OpenChamber's service host
// and remembers which session works on which task, because such a session carries no items.
// The links live in ~/.icf-kanban/links.json, outside the package (a write inside it reloads the extension).
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Exec } from '../core/types.ts';
import { TrackerError } from '../core/types.ts';

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

const readLinksFile = async (file: string): Promise<LinksFile> => {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return { version: 1, projects: {} }; // missing or unreadable: start over
  }
  const projects: Record<string, Link[]> = {};
  const src = (raw as { projects?: unknown } | null)?.projects;
  if (typeof src === 'object' && src !== null && !Array.isArray(src)) {
    for (const [dir, list] of Object.entries(src)) if (Array.isArray(list)) projects[dir] = list.filter(isLink);
  }
  return { version: 1, projects };
};

export const listLinks = async (file: string, directory: string): Promise<Link[]> =>
  (await readLinksFile(file)).projects[directory] ?? [];

/** Writes are queued so two starts never drop each other's link. */
let queue: Promise<unknown> = Promise.resolve();

export const addLink = (file: string, project: string, link: Link): Promise<void> => {
  const run = queue.then(async () => {
    const data = await readLinksFile(file);
    const list = [...(data.projects[project] ?? []), link];
    data.projects[project] = list.slice(-LINKS_PER_PROJECT);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(tmp, file);
  });
  queue = run.catch(() => {});
  return run;
};

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
