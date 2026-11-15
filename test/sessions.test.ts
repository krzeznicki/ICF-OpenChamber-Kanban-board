import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Exec } from '../src/core/types.ts';
import { handle, type Deps } from '../src/service/routes.ts';
import { worktreeSlug, worktreesRoot, type SessionHost } from '../src/service/sessions.ts';

type T = { after: (fn: () => Promise<void>) => void };
type Err = { error: { code: string; message: string } };

const tmp = async (t: T): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'icf-sessions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};

/** A project folder, and a fake HOME next to it holding links.json. */
const setup = async (t: T, over: { code?: number; startFails?: boolean } = {}) => {
  const root = await tmp(t);
  const directory = join(root, 'repo');
  await mkdir(directory);
  const linksFile = join(root, 'home', '.icf-kanban', 'links.json');
  const execs: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const exec: Exec = async (cmd, args, opts) => {
    execs.push({ cmd, args, cwd: opts.cwd });
    return over.code ? { code: over.code, stdout: '', stderr: 'fatal: a branch named x already exists' } : { code: 0, stdout: '', stderr: '' };
  };
  const starts: Array<Parameters<SessionHost['start']>[0]> = [];
  let n = 0;
  const sessions: SessionHost = {
    start: async (input) => {
      starts.push(input);
      if (over.startFails) throw new Error('Session control is not approved');
      n++;
      return { sessionId: `ses_${n}`, directory: input.directory ?? null };
    },
  };
  const deps: Deps = { exec, sessions, linksFile, suffix: () => 'abc123' };
  return { root, directory, linksFile, execs, starts, deps };
};

const body = (directory: string, extra: Record<string, unknown> = {}) => ({
  directory,
  taskId: '.scratch/board/issues/03-drag-cards.md',
  title: 'Drag cards',
  prompt: 'Do it',
  model: 'anthropic/claude-sonnet-5-5',
  agent: null,
  location: 'worktree',
  ...extra,
});

test('/sessions/start with a worktree: git worktree add next to the repo, then sessions.start there, then the link', async (t) => {
  const { directory, linksFile, execs, starts, deps } = await setup(t);
  const r = await handle('POST', '/sessions/start', body(directory), deps);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const wt = join(dirname(directory), 'repo-worktrees', 'drag-cards-abc123');
  assert.deepEqual(execs, [
    { cmd: 'git', args: ['-C', directory, 'worktree', 'add', '-b', 'icf/drag-cards-abc123', wt], cwd: directory },
  ]);
  assert.deepEqual(starts, [{ prompt: 'Do it', directory: wt, title: 'Drag cards', model: 'anthropic/claude-sonnet-5-5' }]);
  assert.deepEqual(r.json, { sessionId: 'ses_1', directory: wt, worktree: wt });

  const stored = JSON.parse(await readFile(linksFile, 'utf8')) as { projects: Record<string, unknown[]> };
  const links = stored.projects[directory] as Array<Record<string, unknown>>;
  assert.equal(links.length, 1);
  assert.equal(links[0]!.taskId, '.scratch/board/issues/03-drag-cards.md');
  assert.equal(links[0]!.sessionId, 'ses_1');
  assert.equal(links[0]!.directory, wt);
  assert.equal(typeof links[0]!.createdAt, 'number');

  const listed = await handle('POST', '/links/list', { directory }, deps);
  assert.equal(listed.status, 200);
  // Without sessions.status the live status is unknown.
  assert.deepEqual((listed.json as { links: unknown[] }).links, links.map((l) => ({ ...l, status: 'unknown' })));
});

test('/sessions/start in the project folder runs no git and passes the agent', async (t) => {
  const { directory, execs, starts, deps } = await setup(t);
  const r = await handle('POST', '/sessions/start', body(directory, { location: 'project', model: null, agent: 'build' }), deps);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(execs, []);
  assert.deepEqual(starts, [{ prompt: 'Do it', directory, title: 'Drag cards', agent: 'build' }]);
  assert.equal((r.json as { worktree: null }).worktree, null);
});

test('/sessions/start: a failing git is 422 and starts nothing', async (t) => {
  const { directory, starts, linksFile, deps } = await setup(t, { code: 128 });
  const r = await handle('POST', '/sessions/start', body(directory), deps);
  assert.equal(r.status, 422);
  assert.match((r.json as Err).error.message, /Could not create the worktree .*a branch named x already exists/);
  assert.equal(starts.length, 0);
  await assert.rejects(readFile(linksFile, 'utf8'));
});

test('/sessions/start: a failing start is 422 naming the kept worktree, and writes no link', async (t) => {
  const { directory, linksFile, deps } = await setup(t, { startFails: true });
  const r = await handle('POST', '/sessions/start', body(directory), deps);
  assert.equal(r.status, 422);
  const msg = (r.json as Err).error.message;
  assert.match(msg, /Session control is not approved/);
  assert.ok(msg.includes(join(dirname(directory), 'repo-worktrees', 'drag-cards-abc123')), msg);
  await assert.rejects(readFile(linksFile, 'utf8'));
});

test('/sessions/start: bad parameters are 400; without session control 422', async (t) => {
  const { directory, deps } = await setup(t);
  for (const extra of [{ location: 'elsewhere' }, { taskId: '' }, { prompt: 3 }, { model: 5 }]) {
    const r = await handle('POST', '/sessions/start', body(directory, extra), deps);
    assert.equal(r.status, 400, JSON.stringify(extra));
  }
  const { sessions: _s, ...without } = deps;
  const r = await handle('POST', '/sessions/start', body(directory), without);
  assert.equal(r.status, 422);
});

test('links are kept per project, and concurrent starts keep every link', async (t) => {
  const { directory, root, deps } = await setup(t);
  const other = join(root, 'other');
  await mkdir(other);
  const replies = await Promise.all([
    handle('POST', '/sessions/start', body(directory, { location: 'project', taskId: 'a' }), deps),
    handle('POST', '/sessions/start', body(directory, { location: 'project', taskId: 'b' }), deps),
    handle('POST', '/sessions/start', body(other, { location: 'project', taskId: 'c' }), deps),
  ]);
  assert.deepEqual(replies.map((r) => r.status), [200, 200, 200]);
  const mine = (await handle('POST', '/links/list', { directory }, deps)).json as { links: Array<{ taskId: string }> };
  assert.deepEqual(mine.links.map((l) => l.taskId).sort(), ['a', 'b']);
  const theirs = (await handle('POST', '/links/list', { directory: other }, deps)).json as { links: Array<{ taskId: string }> };
  assert.deepEqual(theirs.links.map((l) => l.taskId), ['c']);
});

test('/links/list: no file is an empty list; a corrupt file is set aside, then empty', async (t) => {
  const { directory, linksFile, deps } = await setup(t);
  assert.deepEqual((await handle('POST', '/links/list', { directory }, deps)).json, { links: [] });
  await mkdir(dirname(linksFile), { recursive: true });
  await writeFile(linksFile, '{not json');
  assert.deepEqual((await handle('POST', '/links/list', { directory }, deps)).json, { links: [] });
  const kept = (await readdir(dirname(linksFile))).filter((f) => f.startsWith('links.json.corrupt-'));
  assert.equal(kept.length, 1);
  assert.equal(await readFile(join(dirname(linksFile), kept[0]!), 'utf8'), '{not json');
  await assert.rejects(readFile(linksFile, 'utf8'));
});

test('/links/list: an unreadable links file (not a missing one) is an error, never an empty list', async (t) => {
  const { directory, linksFile, deps } = await setup(t);
  await mkdir(linksFile, { recursive: true }); // a folder where the file should be: EISDIR
  const r = await handle('POST', '/links/list', { directory }, deps);
  assert.equal(r.status, 500);
});

test('worktree names: slug from the title, else the file name, plus the suffix; root next to the repo', () => {
  assert.equal(worktreeSlug('#4', 'Fix: the Ünïcode bug!', 'f00'), 'fix-the-unicode-bug-f00');
  assert.equal(worktreeSlug('.scratch/f/issues/07-make-it.md', '***', 'f00'), '07-make-it-f00');
  assert.equal(worktreeSlug('#4', '', 'f00'), '4-f00');
  assert.equal(worktreesRoot('/a/b/repo'), '/a/b/repo-worktrees');
  assert.equal(basename(worktreesRoot('/repo')), 'repo-worktrees');
});
