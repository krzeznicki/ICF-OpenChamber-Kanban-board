// Entry for both the rail panel (panel/index.html) and the full-screen page (panel/page.html).
// The layout follows ctx.surface through the data-oc-surface attribute applyHostReady sets.
// Data: projects and sessions from the host, tasks from our service via host.serviceRequest.
// Writes (drag and drop, detail, Add task) live in edit.ts; a drop on In Progress goes to starter.ts:
// it starts an agent session (or queues it over the limit) and the card then follows that session. Settings (global, per project, presets, per card) come from the
// extension's storage through settings.ts and are edited in the Settings sheet.
import { connectHost } from '@openchamber/sdk';
import type { GuestProject, GuestSessionRecord, HostReadyContext } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import type { Task } from '../core/types.ts';
import { ApiError, createApi, type Api, type ConfigResult, type ProjectConfig } from './api.ts';
import { groupTasks, sessionForTask, type Column } from './columns.ts';
import { createEditor, type Editor } from './edit.ts';
import { listPresets, parseStoredPresets, type Preset, type StoredPresets } from './presets.ts';
import {
  createLatestSaver,
  createSettingsStore,
  resolveSettings,
  type Settings,
  type SettingsLayer,
} from './settings.ts';
import { defaultChoice, loadNotice, setupOutcome, type ApiFailure, type NoticeModel, type TrackerChoice } from './setup.ts';
import { createStarter } from './starter.ts';
import { createBoard, type Board } from './ui/board.ts';
import { mountNotice } from './ui/notice.ts';
import { openSettings } from './ui/settingsView.ts';
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
  /** Where each drawn task sits, from the last draw. */
  columns: Map<string, Column>;
  /** Stored settings layers; `settingsFor` is the project whose layer is loaded (null: none yet). */
  globalSettings: SettingsLayer;
  projectSettings: SettingsLayer;
  settingsFor: string | null;
  presets: StoredPresets;
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
  columns: new Map(),
  globalSettings: {},
  projectSettings: {},
  settingsFor: null,
  presets: parseStoredPresets(undefined),
};

const store = createSettingsStore(host.storage);
const fail = (message: string): void => void host.toast({ kind: 'error', message }).catch(() => {});
// Every field reports each keystroke; only the newest value per key is written.
const saver = createLatestSaver<() => Promise<void>>(
  (_key, run) => run(),
  (e) => fail(`Could not save settings: ${e instanceof Error ? e.message : String(e)}`),
);
let settingsSheet: { dispose: () => void } | null = null;
/** Global settings and presets are read once at start; editing waits for them, so nothing stored is overwritten. */
let globalLoaded = false;

const loadGlobalSettings = async (): Promise<void> => {
  try {
    const [global, presets] = await Promise.all([store.loadGlobal(), store.loadPresets()]);
    state.globalSettings = global;
    state.presets = presets;
    globalLoaded = true;
    applySettings();
  } catch (e) {
    fail(`Could not read the settings: ${e instanceof Error ? e.message : String(e)}`);
  }
};

/** The Review count last put on the rail icon. */
let badge: number | null = null;
const setBadge = (count: number | null): void => {
  if (count === badge) return;
  badge = count;
  void host.setBadge(count).catch(() => {});
};

let board: Board;
let editor: Editor;
let unsubscribeSessions: (() => void) | null = null;
/** Bumped on every load and project switch; a stale answer is dropped. */
let generation = 0;

const project = (): GuestProject | null => state.projects.find((p) => p.id === state.projectId) ?? null;

/** The settings in force for the shown project (global only until its layer has loaded). */
const settings = (): Settings =>
  resolveSettings(state.globalSettings, state.settingsFor !== null && state.settingsFor === state.projectId ? state.projectSettings : {});

/** After any settings change: the hide switch follows, the board and an open detail redraw. */
const applySettings = (): void => {
  const hide = settings().hideChildren;
  if (hide !== state.hideSubtasks) {
    state.hideSubtasks = hide;
    board.setHideSubtasks(hide);
    draw();
  }
  editor.refresh();
};

const loadProjectSettings = async (id: string): Promise<void> => {
  try {
    const layer = await store.loadProject(id);
    if (state.projectId !== id) return;
    state.projectSettings = layer;
    state.settingsFor = id;
  } catch (e) {
    if (state.projectId !== id) return;
    state.projectSettings = {};
    state.settingsFor = id;
    fail(`Could not read the project settings: ${e instanceof Error ? e.message : String(e)}`);
  }
  applySettings();
};

const saveProjectSettings = (id: string, layer: SettingsLayer): void => {
  if (state.settingsFor === id) state.projectSettings = layer;
  saver.save(`project:${id}`, () => store.saveProject(id, layer));
};

const closeSettings = (): void => {
  const sheet = settingsSheet;
  settingsSheet = null;
  sheet?.dispose();
};

const showSettings = (): void => {
  closeSettings();
  if (!globalLoaded) {
    // The first read failed or is still running: try again rather than edit over stored values.
    void host.toast({ kind: 'info', message: 'Settings are loading, try again in a moment' }).catch(() => {});
    void loadGlobalSettings();
    return;
  }
  const p = project();
  const id = p !== null && state.settingsFor === p.id ? p.id : null;
  settingsSheet = openSettings(
    {
      tab: 'global',
      global: state.globalSettings,
      project: p !== null && id !== null ? { name: p.name, layer: state.projectSettings } : null,
      presets: state.presets,
    },
    {
      onGlobal: (layer) => {
        state.globalSettings = layer;
        saver.save('global', () => store.saveGlobal(layer));
        applySettings();
      },
      onProject: (layer) => {
        if (id === null) return;
        saveProjectSettings(id, layer);
        applySettings();
      },
      onPresets: (stored) => {
        state.presets = stored;
        saver.save('presets', () => store.savePresets(stored));
        editor.refresh();
      },
      onDismiss: closeSettings,
    },
  );
};

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
  board.setCanAdd(state.view === 'board' && state.config !== null);
  state.columns = new Map();
  if (state.config === null || state.tasks === null) {
    setBadge(null);
    board.render(null);
    return;
  }
  const model = groupTasks(state.tasks, state.sessions, starter.isStarting, state.hideSubtasks, starter.links(), starter.queuedIds(), starter.queueErrors());
  for (const [column, cards] of Object.entries(model)) for (const c of cards) state.columns.set(c.task.id, column as Column);
  // The attention mark: sessions that finished or wait for the user.
  setBadge(model.review.length || null);
  board.render(model, editor.busy);
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
  editor.reset();
  state.config = null;
  state.tasks = null;
  state.view = 'notice';
  board.setStatus({ kind: 'custom', mount: (slot) => mountNotice(slot, notice, () => void load()) });
  draw();
};

const showWizard = (api: Api, remote: string | null): void => {
  editor.reset();
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
    // Links and the start queue come from the service's own files (starter.ts).
    const [tasks] = await Promise.all([api.list(), starter.refresh(p.id, p.directory)]);
    if (mine !== generation) return;
    state.config = result.config;
    state.tasks = tasks;
    state.view = 'board';
    draw();
    editor.refresh();
    starter.onSnapshot(); // drain the queue now that the tasks are known
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
  editor.reset();
  closeSettings();
  state.settingsFor = null;
  state.projectSettings = {};
  if (id !== null) void loadProjectSettings(id);
  state.sessions = [];
  starter.reset();
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
      starter.onSnapshot();
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

// --- starting agents (starter.ts) ---

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** What a start needs from the settings; null while the shown project's settings are loading. */
const startContext = (): { projectId: string; settings: Settings; presets: Preset[] } | null => {
  const id = state.projectId;
  return id === null || !globalLoaded || state.settingsFor !== id ? null : { projectId: id, settings: settings(), presets: listPresets(state.presets) };
};

const starter = createStarter({
  host,
  project,
  tasks: () => state.tasks,
  sessions: () => state.sessions,
  context: startContext,
  loadCard: (projectId, taskId) => store.loadCard(projectId, taskId),
  draw: () => draw(),
});

/** A click on a card with a session opens the session; the detail stays on its Details button. */
const openCard = (taskId: string): boolean => {
  const s = sessionForTask(taskId, state.sessions, starter.links());
  if (s === null) return false;
  void host.openSession(s.id).catch((e: unknown) => fail(`Could not open the session: ${errorText(e)}`));
  return true;
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
      // The switch is the project's "Hide sub-tasks" setting.
      const id = state.settingsFor;
      if (id !== null && id === state.projectId) saveProjectSettings(id, { ...state.projectSettings, hideChildren: hide });
      draw();
    },
    onRefresh: () => void load(),
    onAdd: () => editor.showAdd(),
    onSettings: showSettings,
    onDetails: (id) => editor.showDetail(id),
  });
  editor = createEditor({
    host,
    board,
    api: () => {
      const p = project();
      return p === null || state.view !== 'board' ? null : createApi(host, p.directory);
    },
    tasks: () => state.tasks ?? [],
    tracker: () => state.config?.tracker ?? 'local',
    labels: () => state.config?.labels ?? {},
    columnOf: (id) => state.columns.get(id) ?? null,
    reload: load,
    redraw: draw,
    onStart: (task) => void starter.onStart(task),
    beforeMove: (task) => starter.leaveQueue(task.id),
    openCard,
    baseTypes: () => settings().types,
    start: {
      context: startContext,
      load: (projectId, taskId) => store.loadCard(projectId, taskId),
      save: (projectId, taskId, card) => saver.save(`card:${projectId}:${taskId}`, () => store.saveCard(projectId, taskId, card)),
    },
  });
  void loadGlobalSettings();
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
