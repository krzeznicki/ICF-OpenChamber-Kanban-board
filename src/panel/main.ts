// Entry for both the rail panel (panel/index.html) and the full-screen page (panel/page.html).
// The layout follows ctx.surface through the data-oc-surface attribute applyHostReady sets.
// Data: projects and sessions from the host, tasks from our service via host.serviceRequest.
// Writes (drag and drop, detail, Add task) live in edit.ts; onStart below runs a drop on In Progress:
// it starts an agent session (launcher.ts) and the card then follows that session. Settings (global, per project, presets, per card) come from the
// extension's storage through settings.ts and are edited in the Settings sheet.
import { clampStartSessionRequest, connectHost, GUEST_ATTACH_ID_MAX } from '@openchamber/sdk';
import type { GuestProject, GuestSessionRecord, HostReadyContext } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import type { Task } from '../core/types.ts';
import { ApiError, createApi, type Api, type ConfigResult, type ProjectConfig } from './api.ts';
import { groupTasks, sessionForTask, type Column, type SessionLink } from './columns.ts';
import { createEditor, type Editor } from './edit.ts';
import { createLauncher } from './launcher.ts';
import { listPresets, parseStoredPresets, type Preset, type StoredPresets } from './presets.ts';
import { buildPrompt } from './prompt.ts';
import {
  createLatestSaver,
  createSettingsStore,
  resolveSettings,
  resolveStart,
  type Settings,
  type SettingsLayer,
  type StartOptions,
} from './settings.ts';
import { defaultChoice, loadNotice, setupOutcome, type ApiFailure, type NoticeModel, type TrackerChoice } from './setup.ts';
import { createBoard, type Board } from './ui/board.ts';
import { mountNotice } from './ui/notice.ts';
import { openSettings } from './ui/settingsView.ts';
import { askStart } from './ui/startForm.ts';
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
  /** Sessions the service started for tasks (path B); they carry no items. */
  links: SessionLink[];
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
  links: [],
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
  const model = groupTasks(state.tasks, state.sessions, isStarting, state.hideSubtasks, state.links);
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
    // The links come from the service's own file; without them only path A sessions are followed.
    const [tasks, links] = await Promise.all([api.list(), api.listLinks().catch(() => null)]);
    if (mine !== generation) return;
    state.config = result.config;
    state.tasks = tasks;
    if (links !== null) state.links = links;
    state.view = 'board';
    draw();
    editor.refresh();
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
  state.links = [];
  launcher.reset();
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
      launcher.settle((id) => state.sessions.some((s) => s.id === id));
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

// --- starting agents ---

const info = (message: string): void => void host.toast({ kind: 'info', message }).catch(() => {});
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** What a start needs from the settings; null while the shown project's settings are loading. */
const startContext = (): { projectId: string; settings: Settings; presets: Preset[] } | null => {
  const id = state.projectId;
  return id === null || !globalLoaded || state.settingsFor !== id ? null : { projectId: id, settings: settings(), presets: listPresets(state.presets) };
};

const LIVE = new Set(['running', 'retrying', 'waiting-permission', 'waiting-question']);
const hasLiveSession = (taskId: string): boolean => {
  const s = sessionForTask(taskId, state.sessions, state.links);
  return s !== null && LIVE.has(s.activity);
};

/** The built CLI's absolute path, asked from the service once per project directory. */
let cli: { directory: string; path: string } | null = null;
const cliPath = async (directory: string): Promise<string> => {
  if (cli?.directory === directory) return cli.path;
  const path = await createApi(host, directory).cliPath();
  cli = { directory, path };
  return path;
};

const reloadLinks = async (projectId: string, directory: string): Promise<void> => {
  try {
    const links = await createApi(host, directory).listLinks();
    if (state.projectId !== projectId) return;
    state.links = links;
    draw();
  } catch {
    // The next load tries again.
  }
};

/**
 * Path A (the panel's host.startSession) when the card sets no model and no agent: OpenChamber
 * makes the worktree and the session carries the card as its item. Otherwise path B: the service
 * makes the worktree with git, starts the session with the model/agent and records the link.
 * An id too long to be an item (GUEST_ATTACH_ID_MAX) also takes path B, so the card can follow it.
 */
const startTask = async (task: Task, opts: StartOptions, prompt: string): Promise<{ sessionId: string | null }> => {
  const p = project();
  if (p === null) throw new Error('No project is open');
  if (opts.model !== null || opts.agent !== null || task.id.length > GUEST_ATTACH_ID_MAX) {
    const r = await createApi(host, p.directory).startSession({
      taskId: task.id,
      title: task.title,
      prompt,
      model: opts.model,
      agent: opts.agent,
      location: opts.location,
    });
    void reloadLinks(p.id, p.directory);
    return { sessionId: r.sessionId };
  }
  const result = await host.startSession(
    clampStartSessionRequest({
      providerId: 'icf-kanban',
      id: task.id,
      title: task.title,
      url: task.url ?? `https://icf-kanban.local/t/${encodeURIComponent(task.id)}`,
      text: prompt,
      projectId: p.id,
      worktree: opts.location === 'worktree' ? true : false,
      navigation: 'preserve',
    }),
  );
  if (result.sessionId === null) {
    const what = result.failure === 'bootstrap-failed' ? 'setting up the worktree failed' : 'the session could not be created';
    void host
      .toast({
        kind: 'error',
        message: `Could not start “${task.title}”: ${what}. The worktree ${result.worktree.directory || result.directory} is kept.`,
        persistent: true,
      })
      .catch(() => {});
    return { sessionId: null };
  }
  if (result.sent === 'no-model' || result.sent === 'failed') {
    const why = result.sent === 'no-model' ? 'no model is selected' : 'sending failed';
    fail(`The session for “${task.title}” was created, but its first message was not sent (${why}). Open it and send the task yourself.`);
  }
  if (result.linked === false) fail(`The session for “${task.title}” started, but the card could not be linked to it; the card will not follow it.`);
  return { sessionId: result.sessionId };
};

const isStarting = new Set<string>();
const launcher = createLauncher({
  isStarting,
  hasLiveSession,
  start: startTask,
  prompt: async (task, opts) => {
    const p = project();
    if (p === null) throw new Error('No project is open');
    const presets = listPresets(state.presets);
    const preset = presets.find((x) => x.id === opts.presetId) ?? presets.find((x) => x.id === 'implement') ?? presets[0]!;
    const children = (state.tasks ?? []).filter((t) => t.parentId === task.id);
    return buildPrompt(task, preset, await cliPath(p.directory), children);
  },
  onError: (task, e) => fail(`Could not start “${task.title}”: ${errorText(e)}`),
});

/** A drop on In Progress: resolve the start options, ask first when "Start automatically" is off, then launch. */
const onStart = async (task: Task): Promise<void> => {
  const ctx = startContext();
  if (ctx === null) {
    info('Settings are loading, try again in a moment');
    return;
  }
  if (isStarting.has(task.id) || hasLiveSession(task.id)) {
    info(`“${task.title}” already has an agent working on it`);
    return;
  }
  let card: Partial<StartOptions>;
  try {
    card = await store.loadCard(ctx.projectId, task.id);
  } catch (e) {
    fail(`Could not read the card's start options: ${errorText(e)}`);
    return;
  }
  let opts = resolveStart(ctx.settings, task, card, ctx.presets);
  if (!ctx.settings.autoStart) {
    const picked = await askStart(task.title, opts, ctx.presets);
    if (picked === null) return;
    opts = picked;
  }
  if (state.projectId !== ctx.projectId) return;
  const pending = launcher.launch(task, opts);
  draw(); // the card shows in In Progress while it starts
  const result = await pending;
  if (result === 'already') info(`“${task.title}” already has an agent working on it`);
  else if (result === 'started') void host.toast({ kind: 'success', message: `Started an agent on “${task.title}”` }).catch(() => {});
  draw();
};

/** A click on a card with a session opens the session; the detail stays on its Details button. */
const openCard = (taskId: string): boolean => {
  const s = sessionForTask(taskId, state.sessions, state.links);
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
    onStart: (task) => void onStart(task),
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
