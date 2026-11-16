import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GuestProject, GuestSessionRecord } from '@openchamber/sdk';
import { createProjectFollow, projectContaining, type FollowDeps } from '../src/panel/projectFollow.ts';

const project = (name: string): GuestProject => ({ id: `id-${name}`, name, directory: `/projects/${name}` });
const projects = [project('first'), project('kanban')];
/** Where OpenChamber puts a session's worktree: outside every registered project. */
const WORKTREE = '/home/.local/share/opencode/worktree/7bf6/issue-gentle-heron';

const record = (id: string, extra: Partial<GuestSessionRecord> = {}): GuestSessionRecord => ({
  id,
  title: id,
  projectId: 'id-kanban',
  directory: WORKTREE,
  parentId: null,
  createdAt: 100,
  updatedAt: 100,
  archivedAt: null,
  worktree: null,
  activity: 'running',
  outcome: null,
  items: [],
  ...extra,
});

const deps = (over: Partial<FollowDeps> = {}): FollowDeps => ({
  listSessions: async () => ({ sessions: [] }),
  projectOfWorktree: async () => null,
  wait: async () => {},
  ...over,
});

/** What the board shows once the lookup for the host's directory has ended. */
const shown = async (d: FollowDeps, dir: string, sessionId: string | null = null): Promise<string | undefined> => {
  const follow = createProjectFollow(d);
  if (follow.unknown(dir, projects)) await follow.lookup(dir, projects, sessionId);
  return follow.choose(dir, projects, null)?.name;
};

test('projectContaining: the longest registered project containing the directory', () => {
  const nested = [project('first'), { id: 'inner', name: 'inner', directory: '/projects/first/packages/inner' }];
  assert.equal(projectContaining('/projects/first/packages/inner/src', nested)?.id, 'inner');
  assert.equal(projectContaining('/projects/first-other', nested), null);
});

test('a chat inside a project shows that project', async () => {
  assert.equal(await shown(deps(), '/projects/kanban/src'), 'kanban');
});

test('the board page opened from a worktree session shows the project the worktree was made from', async () => {
  // The page has no session of its own, and the host lists the session under no project.
  const d = deps({
    projectOfWorktree: async (dir, directories) => (dir === WORKTREE && directories.includes('/projects/kanban') ? '/projects/kanban' : null),
  });
  assert.equal(await shown(d, WORKTREE), 'kanban');
});

test('the board page opened from a worktree session shows the project the host lists that session under', async () => {
  const d = deps({ listSessions: async (id) => ({ sessions: id === 'id-kanban' ? [record('s1')] : [] }) });
  assert.equal(await shown(d, WORKTREE), 'kanban');
});

test("the rail panel's own session names the project, whatever directory its record carries", async () => {
  const d = deps({ listSessions: async (id) => ({ sessions: id === 'id-kanban' ? [record('s1', { directory: '/elsewhere' })] : [] }) });
  assert.equal(await shown(d, WORKTREE, 's1'), 'kanban');
});

test('a directory no lookup can place keeps the shown project, else the first', async () => {
  const follow = createProjectFollow(deps());
  assert.equal(await follow.lookup(WORKTREE, projects, null), null);
  assert.equal(follow.choose(WORKTREE, projects, projects[1]!)?.name, 'kanban');
  assert.equal(follow.choose(WORKTREE, projects, null)?.name, 'first');
});

test('a lookup that cannot ask the service tries again by itself, so a starting service does not leave the first project', async () => {
  let calls = 0;
  const d = deps({
    projectOfWorktree: async () => {
      if (++calls < 3) throw new Error('service is starting');
      return '/projects/kanban';
    },
  });
  assert.equal(await shown(d, WORKTREE), 'kanban');
});

test('a lookup that never reaches the service gives up, and the next one asks again', async () => {
  let calls = 0;
  const follow = createProjectFollow(
    deps({
      projectOfWorktree: async () => {
        calls++;
        throw new Error('no service');
      },
    }),
  );
  assert.equal(await follow.lookup(WORKTREE, projects, null), null);
  assert.equal(calls, 3);
  assert.equal(follow.unknown(WORKTREE, projects), true);
});

test('an answer is remembered, also "no project", until the project list changes', async () => {
  let calls = 0;
  const follow = createProjectFollow(
    deps({
      projectOfWorktree: async (_dir, directories) => {
        calls++;
        return directories.includes('/projects/late') ? '/projects/late' : null;
      },
    }),
  );
  assert.equal(await follow.lookup(WORKTREE, projects, null), null);
  assert.equal(follow.unknown(WORKTREE, projects), false);
  const more = [...projects, project('late')];
  assert.equal(follow.unknown(WORKTREE, more), true);
  assert.equal(await follow.lookup(WORKTREE, more, null), 'id-late');
  assert.equal(follow.unknown(WORKTREE, more), false);
  assert.equal(follow.choose(WORKTREE, more, null)?.name, 'late');
  assert.equal(calls, 2);
});
