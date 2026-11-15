// Entry for both the rail panel (panel/index.html) and the full-screen page (panel/page.html).
// The layout follows ctx.surface through the data-oc-surface attribute applyHostReady sets.
// Data: projects and sessions from the host, tasks from our service via host.serviceRequest.
import { connectHost } from '@openchamber/sdk';
import type { GuestProject, GuestSessionRecord, HostReadyContext } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import type { Task } from '../core/types.ts';
import { ApiError, createApi, type Api, type ConfigResult, type ProjectConfig } from './api.ts';
import { groupTasks } from './columns.ts';
import { defaultChoice, loadNotice, setupOutcome, type ApiFailure, type NoticeModel, type TrackerChoice } from './setup.ts';
import { createBoard, type Board } from './ui/board.ts';
import { mountNotice } from './ui/notice.ts';
import { injectStyles } from './ui/styles.ts';
import { mountWizard } from './ui/wizard.ts';

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
  /** When the last load was attempted, successful or not. */
  lastLoad: number;
  /** What the status slot shows; polling leaves the wizard alone so the user's pick survives. */
  view: 'none' | 'board' | 'wizard' | 'notice';
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
  view: 'none',
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

const failureOf = (e: unknown): ApiFailure => ({
  code: e instanceof ApiError ? e.code : 'FAILED',
  message: e instanceof Error ? e.message : String(e),
});

/** Clears the board and shows a notice whose button re-runs the load. */
const showNotice = (notice: NoticeModel): void => {
  state.config = null;
  state.tasks = null;
  state.view = 'notice';
  board.setStatus({ kind: 'custom', mount: (slot) => mountNotice(slot, notice, () => void load()) });
  draw();
};

const showWizard = (api: Api, remote: string | null): void => {
  state.config = null;
  state.tasks = null;
  state.view = 'wizard';
  board.setStatus({
    kind: 'custom',
    mount: (slot) => {
      const wizard = mountWizard(slot, {
        remote,
        initial: defaultChoice(remote),
        onSetup: (choice) => {
          wizard.setBusy(true);
          void setup(api, choice);
        },
      });
      return wizard.dispose;
    },
  });
  draw();
};

/** The wizard's button: write the config, then read it back and show the board or a notice. */
const setup = async (api: Api, choice: TrackerChoice): Promise<void> => {
  const mine = ++generation;
  board.setBusy(true);
  let initError: ApiFailure | null = null;
  try {
    await api.initConfig(choice);
  } catch (e) {
    initError = failureOf(e);
  }
  if (mine !== generation) return;
  let read: ConfigResult;
  try {
    read = await api.readConfig();
  } catch (e) {
    read = { error: failureOf(e) };
  }
  if (mine !== generation) return;
  board.setBusy(false);
  const outcome = setupOutcome(choice, initError, read);
  if (outcome.kind === 'board') void load();
  else showNotice(outcome.notice);
};

const load = async (): Promise<void> => {
  const p = project();
  const mine = ++generation;
  if (p === null) {
    state.config = null;
    state.tasks = null;
    state.view = 'none';
    board.setStatus({ kind: 'empty', title: 'No project', body: 'Open or choose a project to see its board.' });
    draw();
    return;
  }
  // Set on every attempt: after an error, returning to the tab does not reload (and call gh) at once.
  state.lastLoad = Date.now();
  const api = createApi(host, p.directory);
  if (state.tasks === null) board.setStatus({ kind: 'loading' });
  board.setBusy(true);
  try {
    const result = await api.readConfig();
    if (mine !== generation) return;
    if ('error' in result) {
      if (result.error.code !== 'NOT_CONFIGURED') {
        showNotice(loadNotice(result.error));
        return;
      }
      const remote = await api.detect().catch(() => null);
      if (mine !== generation) return;
      showWizard(api, remote);
      return;
    }
    const tasks = await api.list();
    if (mine !== generation) return;
    state.config = result.config;
    state.tasks = tasks;
    state.view = 'board';
    draw();
  } catch (e) {
    if (mine !== generation) return;
    showNotice(loadNotice(failureOf(e)));
  } finally {
    if (mine === generation) board.setBusy(false);
  }
};

/** Background reloads (poll, tab shown) skip the wizard: nothing changes there on its own. */
const backgroundLoad = (): void => {
  if (state.view !== 'wizard') void load();
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
    if (document.visibilityState === 'visible') backgroundLoad();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.lastLoad >= POLL_MS) backgroundLoad();
  });
};

let mounted = false;
host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  if (mounted) return;
  mounted = true;
  start(ctx);
});
