// Entry for both the rail panel (panel/index.html) and the full-screen page (panel/page.html).
// The layout follows ctx.surface through the data-oc-surface attribute applyHostReady sets.
// Data: projects and sessions from the host, tasks from our service via host.serviceRequest.
import { connectHost } from '@openchamber/sdk';
import type { GuestProject, GuestSessionRecord, HostReadyContext } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import type { Task } from '../core/types.ts';
import { ApiError, createApi, type ProjectConfig } from './api.ts';
import { groupTasks } from './columns.ts';
import { createBoard, type Board } from './ui/board.ts';
import { injectStyles } from './ui/styles.ts';

const POLL_MS = 60_000;

const host = connectHost();

type State = {
  projects: GuestProject[];
  projectId: string | null;
  /** The user picked a project in the switcher; stop following the host's directory. */
  pinned: boolean;
  hostDirectory: string | null;
  sessions: GuestSessionRecord[];
  config: ProjectConfig | null;
  tasks: Task[] | null;
  hideSubtasks: boolean;
  lastLoad: number;
};

const state: State = {
  projects: [],
  projectId: null,
  pinned: false,
  hostDirectory: null,
  sessions: [],
  config: null,
  tasks: null,
  hideSubtasks: false,
  lastLoad: 0,
};

let board: Board;
let unsubscribeSessions: (() => void) | null = null;
/** Bumped on every load and project switch; a stale answer is dropped. */
let generation = 0;

const project = (): GuestProject | null => state.projects.find((p) => p.id === state.projectId) ?? null;

/** The registered project that contains `dir`, the longest match winning (worktrees sit inside projects). */
const projectFor = (dir: string | null): GuestProject | null => {
  if (dir === null) return null;
  let best: GuestProject | null = null;
  for (const p of state.projects) {
    const inside = dir === p.directory || dir.startsWith(p.directory.endsWith('/') ? p.directory : `${p.directory}/`);
    if (inside && (best === null || p.directory.length > best.directory.length)) best = p;
  }
  return best;
};

const draw = (): void => {
  if (state.config === null || state.tasks === null) {
    board.render(null);
    return;
  }
  board.render(groupTasks(state.tasks, state.sessions, new Set(), state.hideSubtasks));
  if (state.tasks.length === 0) {
    board.setStatus({
      kind: 'empty',
      title: 'No tasks yet',
      body:
        state.config.tracker === 'github'
          ? 'Open issues of this repository show up here. Create one on GitHub or with the task-board CLI, then press Refresh.'
          : 'Issues under .scratch/<feature>/issues/ show up here. Create one with the task-board CLI or an agent skill, then press Refresh.',
    });
  } else {
    board.setStatus({ kind: 'none' });
  }
};

const load = async (): Promise<void> => {
  const p = project();
  const mine = ++generation;
  if (p === null) {
    state.config = null;
    state.tasks = null;
    board.setStatus({ kind: 'empty', title: 'No project', body: 'Open or choose a project to see its board.' });
    draw();
    return;
  }
  const api = createApi(host, p.directory);
  if (state.tasks === null) board.setStatus({ kind: 'loading' });
  board.setBusy(true);
  try {
    const result = await api.readConfig();
    if (mine !== generation) return;
    if ('error' in result) {
      state.config = null;
      state.tasks = null;
      board.setStatus(
        result.error.code === 'NOT_CONFIGURED'
          ? { kind: 'banner', tone: 'info', title: 'This project has no tracker yet', body: result.error.message }
          : { kind: 'banner', tone: 'warning', title: 'This project’s tracker is not supported', body: result.error.message },
      );
      draw();
      return;
    }
    const tasks = await api.list();
    if (mine !== generation) return;
    state.config = result.config;
    state.tasks = tasks;
    state.lastLoad = Date.now();
    draw();
  } catch (e) {
    if (mine !== generation) return;
    state.config = null;
    state.tasks = null;
    const code = e instanceof ApiError ? e.code : 'FAILED';
    board.setStatus({
      kind: 'banner',
      tone: 'error',
      title: code === 'NO_SERVICE' ? 'The ICF-kanban service is not allowed or not running' : 'Could not load the board',
      body: e instanceof Error ? e.message : String(e),
    });
    draw();
  } finally {
    if (mine === generation) board.setBusy(false);
  }
};

const selectProject = async (id: string | null): Promise<void> => {
  if (id === state.projectId) return;
  state.projectId = id;
  state.sessions = [];
  state.config = null;
  state.tasks = null;
  board.setProjects(projectOptions(), id);
  unsubscribeSessions?.();
  unsubscribeSessions = null;
  void load();
  if (id === null) return;
  try {
    const unsubscribe = await host.onSessions(id, (snapshot) => {
      if (snapshot.projectId !== state.projectId) return;
      state.sessions = snapshot.sessions;
      draw();
    });
    // The user may have switched again while the subscription registered.
    if (state.projectId === id) unsubscribeSessions = unsubscribe;
    else unsubscribe();
  } catch {
    // Without the sessions grant the board still works; In Progress and Review stay empty.
  }
};

const projectOptions = () => state.projects.map((p) => ({ id: p.id, label: p.name, hint: p.directory }));

const followHost = (): void => {
  const current = project();
  if (state.pinned && current !== null) return;
  const next = projectFor(state.hostDirectory) ?? current ?? state.projects[0] ?? null;
  void selectProject(next?.id ?? null);
};

const start = (ctx: HostReadyContext): void => {
  injectStyles();
  const root = document.getElementById('root') ?? document.body;
  state.hostDirectory = ctx.directory;
  board = createBoard(root, {
    onProject: (id) => {
      state.pinned = true;
      void selectProject(id);
    },
    onHideSubtasks: (hide) => {
      state.hideSubtasks = hide;
      draw();
    },
    onRefresh: () => void load(),
  });
  board.setStatus({ kind: 'loading' });

  host.onDirectory((dir) => {
    state.hostDirectory = dir;
    if (state.projects.length > 0) followHost();
  });
  host
    .onProjects((snapshot) => {
      state.projects = snapshot.projects;
      board.setProjects(projectOptions(), state.projectId);
      if (snapshot.state === 'loading' && snapshot.projects.length === 0) return;
      if (state.projectId !== null && project() === null) state.pinned = false; // the project went away
      followHost();
    })
    .catch((e: unknown) => {
      board.setStatus({
        kind: 'banner',
        tone: 'error',
        title: 'Projects are not available',
        body: `${e instanceof Error ? e.message : String(e)}. Allow the “sessions” capability for ICF-kanban in Settings → Extensions.`,
      });
    });

  setInterval(() => {
    if (document.visibilityState === 'visible') void load();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.lastLoad >= POLL_MS) void load();
  });
};

let mounted = false;
host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  if (mounted) return;
  mounted = true;
  start(ctx);
});
