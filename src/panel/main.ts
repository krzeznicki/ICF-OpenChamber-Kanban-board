// Entry for both the rail panel (panel/index.html) and the full-screen page (panel/page.html).
// The layout follows ctx.surface through the data-oc-surface attribute applyHostReady sets.
// Data: projects and sessions from the host, tasks from our service via host.serviceRequest.
// Writes (drag and drop, the task modal, Add task) live in edit.ts; a drop on In Progress goes to starter.ts:
// it starts an agent session (or queues it over the limit) and the card then follows that session. Settings (global, per project, presets, per card) come from the
// extension's storage through settings.ts and are edited in the Settings sheet. Personal summaries
// (summaries.ts) are read or generated for the shown cards after each load. "Archive done"
// (archive.ts) hides done tasks from the board through the extension's storage only.
import { connectHost } from '@openchamber/sdk';
import type { GuestProject, GuestSessionRecord, HostReadyContext } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import type { Task } from '../core/types.ts';
import { archivableIds, archivedShown, archiveTasks, archiveWriteJob, createArchiveSync, createPendingMarks, isArchived, mergeArchived, reconcileArchived, unarchiveTask } from './archive.ts';
import { ApiError, createApi, type Api, type ConfigResult, type ProjectConfig } from './api.ts';
import { groupTasks, pruneArchived, resolveSession, sessionForTask, sessionTarget, type Column, type SessionLookup } from './columns.ts';
import { createEditor, type Editor } from './edit.ts';
import { listPresets, parseStoredPresets, type Preset, type StoredPresets } from './presets.ts';
import {
  createLatestSaver,
  createSettingsStore,
  DEFAULT_SECTIONS,
  resolveSettings,
  skillUse,
  type Sections,
  type Settings,
  type SettingsLayer,
  STORAGE_KEYS,
  withDetach,
} from './settings.ts';
import { defaultChoice, loadNotice, setupOutcome, type ApiFailure, type NoticeModel, type TrackerChoice } from './setup.ts';
import { createModelLoader } from './models.ts';
import { createStarter } from './starter.ts';
import { createSummaries } from './summaries.ts';
import { createBoard, type Board } from './ui/board.ts';
import { askChoice } from './ui/confirm.ts';
import { mountNotice } from './ui/notice.ts';
import { openSettings } from './ui/settingsView.ts';
import { injectStyles } from './ui/styles.ts';
import { mountWizard } from './ui/wizard.ts';

const POLL_MS = 60_000;
/** After a settings edit, stored summaries for the new language or prompt are read once typing stops. */
const SUMMARY_SETTLE_MS = 1_500;

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
  /** Matt Pocock's skills installed for `settingsFor` and their SKILL.md (POST /skills/detect); null when the check failed. */
  skills: { found: string[]; paths: Record<string, string> } | null;
  /** Cards the user dragged away from their sessions (columns.ts Detached); `detachedFor` is their project. */
  detached: Map<string, number>;
  detachedFor: string | null;
  /** Session ids of links a host lookup found archived (columns.ts markArchived); `archivedFor` is their project. */
  archived: Set<string>;
  archivedFor: string | null;
  /** Done tasks the user archived (archive.ts), task id -> when; `archivedTasksFor` is their project. */
  archivedTasks: Map<string, number>;
  archivedTasksFor: string | null;
  /** The Done header's "Show archived" switch (this panel session only). */
  showArchived: boolean;
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
  skills: null,
  detached: new Map(),
  detachedFor: null,
  archived: new Set(),
  archivedFor: null,
  archivedTasks: new Map(),
  archivedTasksFor: null,
  showArchived: false,
};

const store = createSettingsStore(host.storage);
const fail = (message: string): void => void host.toast({ kind: 'error', message }).catch(() => {});
const info = (message: string): void => void host.toast({ kind: 'info', message }).catch(() => {});

/** The shown project's detach marks (empty while another project's are loaded). */
const detached = (): Map<string, number> => (state.detachedFor === state.projectId ? state.detached : new Map());
/** The shown project's sessions found archived (empty while another project's are loaded). */
const archived = (): Set<string> => (state.archivedFor === state.projectId ? state.archived : new Set());
/** The shown project's archived done tasks (empty while another project's are loaded). */
const archivedTasks = (): Map<string, number> => (state.archivedTasksFor === state.projectId ? state.archivedTasks : new Map());
/** Whether a load may take the stored archive marks over memory (archive.ts createArchiveSync). */
const archiveSync = createArchiveSync();
/**
 * Per project, task id -> when this frame unarchived it: a merge with storage does not bring those
 * marks back. Kept across project switches (a write of the old project may still be queued).
 */
const unarchivedAt = new Map<string, Map<string, number>>();
const removedFor = (projectId: string): ReadonlyMap<string, number> => unarchivedAt.get(projectId) ?? new Map();
/** Per project, the marks queued for writing and not yet written (archive.ts createPendingMarks). */
const pendingMarks = createPendingMarks();
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
    summariseShown(); // tasks may have loaded before the settings
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

/** `opencode models` through the service, fetched the first time a model picker opens in a project, then kept per project directory. */
const loadModels = createModelLoader(
  (directory) => createApi(host, directory).listModels(),
  () => project()?.directory ?? null,
);

/** The settings in force for the shown project (global only until its layer has loaded). */
const settings = (): Settings => {
  const loaded = state.settingsFor !== null && state.settingsFor === state.projectId;
  return resolveSettings(state.globalSettings, loaded ? state.projectSettings : {}, loaded ? (state.skills?.found ?? []) : []);
};

/** The presets a start uses: built-ins switch to their skills text when the settings and the installed skills allow it. */
const presets = (): Preset[] => {
  const skills = state.settingsFor === state.projectId ? state.skills : null;
  return listPresets(state.presets, { ...skillUse(settings(), skills?.found ?? []), paths: skills?.paths ?? {} });
};

/** After any settings change: the hide switch follows, the board and an open detail redraw. */
const applySettings = (): void => {
  const hide = settings().hideChildren;
  if (hide !== state.hideSubtasks) {
    state.hideSubtasks = hide;
    board.setHideSubtasks(hide);
  }
  // A new summary language or prompt is a new key: the cards drop the old text at once.
  draw();
  editor.refresh();
  // What is stored for the new key is read once typing stops; generating waits for the sheet to
  // close or the next load, so typing a prompt does not start a run per keystroke.
  summarySettingsChanged();
};

/** Matt Pocock's skills for the project, or null when the service could not tell. */
const detectSkills = async (id: string): Promise<State['skills']> => {
  const p = state.projects.find((x) => x.id === id);
  if (p === undefined) return null;
  try {
    return await createApi(host, p.directory).detectSkills();
  } catch {
    return null;
  }
};

/** The project's layer and its installed skills load together: a start waits for both (startContext). */
const loadProjectSettings = async (id: string): Promise<void> => {
  const skills = detectSkills(id);
  try {
    const layer = await store.loadProject(id);
    const found = await skills;
    if (state.projectId !== id) return;
    state.projectSettings = layer;
    state.skills = found;
    state.settingsFor = id;
  } catch (e) {
    const found = await skills;
    if (state.projectId !== id) return;
    state.projectSettings = {};
    state.skills = found;
    state.settingsFor = id;
    fail(`Could not read the project settings: ${e instanceof Error ? e.message : String(e)}`);
  }
  applySettings();
  summariseShown(); // tasks may have loaded before the settings
};

const saveProjectSettings = (id: string, layer: SettingsLayer): void => {
  if (state.settingsFor === id) state.projectSettings = layer;
  saver.save(`project:${id}`, () => store.saveProject(id, layer));
};

const closeSettings = (): void => {
  const sheet = settingsSheet;
  settingsSheet = null;
  sheet?.dispose();
  if (sheet !== null) summariseShown();
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
      skills: id !== null ? (state.skills?.found ?? null) : null,
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
      loadModels,
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
  const marks = archivedTasks();
  const archivedCount = archivedShown(state.tasks, marks);
  if (archivedCount === 0) state.showArchived = false;
  const model = groupTasks(
    state.tasks,
    state.sessions,
    starter.isStarting,
    state.hideSubtasks,
    starter.links(),
    starter.queuedIds(),
    starter.queueErrors(),
    detached(),
    { ids: new Set(marks.keys()), show: state.showArchived },
  );
  for (const [column, cards] of Object.entries(model)) for (const c of cards) state.columns.set(c.task.id, column as Column);
  // The attention mark: sessions that finished or wait for the user.
  setBadge(model.review.length || null);
  board.render(model, editor.busy, (task) => summaries.get(task), {
    archivable: archivableIds(state.tasks, marks).length,
    archived: archivedCount,
    showArchived: state.showArchived,
  });
  auditLinks();
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
    const token = archiveSync.loadToken();
    const [tasks, marks, gone, shelved] = await Promise.all([
      api.list(),
      store.loadDetached(p.id).catch(() => null),
      store.loadArchived(p.id).catch(() => null),
      store.loadArchivedTasks(p.id).catch(() => null),
      starter.refresh(p.id, p.directory),
    ]);
    if (mine !== generation) return;
    // Stored marks (also those of the board's other frame) join this frame's own; unreadable ones keep memory.
    if (marks !== null) {
      const merged = new Map(detached());
      for (const [taskId, at] of marks) if (at > (merged.get(taskId) ?? 0)) merged.set(taskId, at);
      state.detached = merged;
      state.detachedFor = p.id;
    }
    if (gone !== null) {
      state.archived = new Set([...archived(), ...gone]);
      state.archivedFor = p.id;
    }
    // Stored archive marks (also the other frame's) win when every change of this frame is written;
    // otherwise memory (empty after a switch) and storage join, newest per id, minus this frame's
    // unarchives. Then ids the tracker no longer lists are pruned and reopened tasks unarchived, and
    // that is written back.
    const base =
      shelved === null ? archivedTasks() : archiveSync.trusts(token) ? shelved : mergeArchived(archivedTasks(), shelved, removedFor(p.id));
    const fixed = reconcileArchived(base, tasks);
    state.archivedTasks = fixed.marks;
    state.archivedTasksFor = p.id;
    if (fixed.changed) writeArchivedTasks(p.id, fixed.marks, tasks);
    state.config = result.config;
    state.tasks = tasks;
    state.view = 'board';
    draw();
    editor.refresh();
    summariseShown();
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
  state.skills = null;
  state.projectSettings = {};
  if (id !== null) void loadProjectSettings(id);
  state.sessions = [];
  state.detached = new Map();
  state.detachedFor = null;
  state.archived = new Set();
  state.archivedFor = null;
  state.archivedTasks = new Map();
  state.archivedTasksFor = null;
  state.showArchived = false;
  audited.clear();
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

// --- summaries (summaries.ts) ---

let summaryRedraw = false;
/** Many summaries land together; one redraw of the board and the open detail covers them. */
const summaryChanged = (): void => {
  if (summaryRedraw) return;
  summaryRedraw = true;
  setTimeout(() => {
    summaryRedraw = false;
    draw();
    editor.refresh();
  }, 50);
};

const summaries = createSummaries({
  generate: (request) => host.generate(request),
  storage: host.storage,
  // Only once the shown project's settings are in: a summary in the wrong language is wasted.
  context: () => {
    const id = state.projectId;
    return id === null || !globalLoaded || state.settingsFor !== id ? null : { projectId: id, summary: settings().summary };
  },
  loadLanguage: async (projectId, taskId) => (await store.loadCard(projectId, taskId)).summaryLanguage,
  onChange: summaryChanged,
  onUnavailable: (code) =>
    void host
      .toast({
        kind: 'info',
        message:
          code === 'NOT_GRANTED'
            ? 'Summaries need the “model” permission for Kanban Board (Settings → Extensions). Automatic summaries are off for now.'
            : 'No small model is set, so automatic summaries are off for now. Choose a Small Model in OpenChamber settings, then press Summarise in a task.',
      })
      .catch(() => {}),
});

/**
 * The shown cards' summaries: generated when automatic summaries are on (not for done tasks),
 * otherwise only read back from storage. `generate: false` only reads (after a settings edit).
 */
const summariseShown = (generate = true): void => {
  if (state.tasks === null) return;
  const auto = generate && summaries.auto();
  for (const task of state.tasks) {
    const column = state.columns.get(task.id);
    if (column === undefined || column === 'done') continue;
    void (auto ? summaries.ensure(task) : summaries.load(task));
  }
};

let summarySettle: ReturnType<typeof setTimeout> | null = null;
const summarySettingsChanged = (): void => {
  if (summarySettle !== null) clearTimeout(summarySettle);
  summarySettle = setTimeout(() => {
    summarySettle = null;
    summariseShown(false);
  }, SUMMARY_SETTLE_MS);
};

// --- starting agents (starter.ts) ---

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** What a start needs from the settings; null while the shown project's settings are loading. */
const startContext = (): { projectId: string; settings: Settings; presets: Preset[] } | null => {
  const id = state.projectId;
  return id === null || !globalLoaded || state.settingsFor !== id ? null : { projectId: id, settings: settings(), presets: presets() };
};

const starter = createStarter({
  host,
  project,
  tasks: () => state.tasks,
  sessions: () => state.sessions,
  context: startContext,
  loadCard: (projectId, taskId) => store.loadCard(projectId, taskId),
  detached,
  archived,
  draw: () => draw(),
  loadModels,
});

/**
 * A card with a session was dragged to Backlog or Ready and its state written: the card stops
 * following that session (and any older one) until it is started again. The session keeps running.
 */
const detach = async (task: Task, from: Column): Promise<void> => {
  const id = state.projectId;
  if (id === null || (from !== 'in_progress' && from !== 'review')) return;
  const marks = detached();
  if (sessionForTask(task.id, state.sessions, starter.links(), marks.get(task.id)) === null) return;
  state.detached = withDetach(marks, task.id, Date.now());
  state.detachedFor = id;
  const saved = state.detached;
  saver.save(STORAGE_KEYS.detached(id), () => store.saveDetached(id, saved));
  info('Moved; the agent session keeps running — open it from the session list');
};

// --- "Archive done" (archive.ts): panel storage only, the repo and GitHub stay as they are ---

/**
 * The one write path of the archive marks (user changes and a load's reconcile). The marks, tasks and
 * this frame's unarchives are snapshotted now, when the job is queued (archive.ts archiveWriteJob): a
 * project switch before it runs, or a wait behind a running write, loses nothing, and the newest
 * queued job holds any change of one the saver replaced. Only a write that succeeded counts as written.
 */
const writeArchivedTasks = (projectId: string, marks: ReadonlyMap<string, number>, tasks: readonly Task[] | null): void => {
  const n = archiveSync.edit();
  const removed = new Map(removedFor(projectId));
  // Joined with marks still queued: a job this one replaces may hold some memory no longer has.
  const snapshot = pendingMarks.queue(projectId, marks, removed, n);
  const job = archiveWriteJob(
    { marks: snapshot, removed, tasks },
    { load: () => store.loadArchivedTasks(projectId), save: (next) => store.saveArchivedTasks(projectId, next) },
    (next) => {
      archiveSync.written(n);
      pendingMarks.written(projectId, n);
      // The other frame's marks (or, after a switch back, this job's own) join what the board shows.
      if (state.archivedTasksFor !== projectId || state.tasks === null) return;
      const current = state.archivedTasks;
      const shown = reconcileArchived(mergeArchived(current, next, removedFor(projectId)), state.tasks).marks;
      if (sameMarks(current, shown)) return;
      state.archivedTasks = shown;
      draw();
      editor.refresh();
    },
  );
  saver.save(STORAGE_KEYS.archivedTasks(projectId), job);
};

const sameMarks = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean =>
  a.size === b.size && [...a].every(([id, at]) => b.get(id) === at);

/** A user change of the shown project's archive marks: stored, then the board and an open modal redraw. */
const setArchivedTasks = (projectId: string, marks: Map<string, number>): void => {
  state.archivedTasks = marks;
  state.archivedTasksFor = projectId;
  writeArchivedTasks(projectId, marks, state.tasks);
  draw();
  editor.refresh();
};

const archiveDone = async (): Promise<void> => {
  const id = state.projectId;
  if (id === null || state.tasks === null) return;
  const n = archivableIds(state.tasks, archivedTasks()).length;
  if (n === 0) return;
  const answer = await askChoice(
    `Archive ${n} done task${n === 1 ? '' : 's'}?`,
    'They leave the board. Nothing changes in the repository or on GitHub; “Show archived” brings them back, and a reopened task returns on its own.',
    [{ id: 'archive', label: 'Archive' }],
  );
  // The board may have reloaded or switched project while the question was open.
  if (answer === null || state.projectId !== id || state.tasks === null) return;
  const ids = archivableIds(state.tasks, archivedTasks());
  if (ids.length === 0) return;
  setArchivedTasks(id, archiveTasks(archivedTasks(), ids, Date.now()));
  info(`Archived ${ids.length} done task${ids.length === 1 ? '' : 's'}`);
};

const unarchive = (taskId: string): void => {
  const id = state.projectId;
  if (id === null || !archivedTasks().has(taskId)) return;
  unarchivedAt.set(id, new Map(removedFor(id)).set(taskId, Date.now()));
  setArchivedTasks(id, unarchiveTask(archivedTasks(), taskId));
};

/**
 * A session known only from a link: looked up in every project's snapshot, so that
 * host.openSession only ever gets an id the host lists, not archived (columns.ts SessionTarget).
 */
const checkSessions = async (sessionIds: readonly string[]): Promise<Map<string, SessionLookup>> => {
  const projectId = state.projectId;
  const lists = await Promise.allSettled(state.projects.map((p) => host.listSessions(p.id)));
  const snapshots = lists.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const out = new Map(sessionIds.map((id) => [id, resolveSession(id, snapshots)] as const));
  const gone = [...out].filter(([, r]) => r === 'archived').map(([id]) => id);
  if (gone.length > 0 && projectId !== null && projectId === state.projectId) noteArchived(projectId, gone);
  return out;
};

const checkSession = async (sessionId: string): Promise<SessionLookup> => (await checkSessions([sessionId])).get(sessionId) ?? 'missing';

/** Sessions found archived: their links stop placing cards (Review -> the tracker state's column); kept per project. */
const noteArchived = (projectId: string, ids: readonly string[]): void => {
  const next = pruneArchived(new Set([...archived(), ...ids]), starter.links());
  state.archived = next;
  state.archivedFor = projectId;
  saver.save(STORAGE_KEYS.archivedSessions(projectId), () => store.saveArchived(projectId, next));
  draw();
  editor.refresh();
};

/**
 * Link-only sessions reading `idle` (finished, or archived: sessions.status cannot tell) are looked
 * up once per panel session, so a card whose session was archived leaves Review without a click.
 */
const audited = new Set<string>();
const auditLinks = (): void => {
  const listed = new Set(state.sessions.map((s) => s.id));
  const ids = starter
    .links()
    .filter((l) => l.status === 'idle' && !listed.has(l.sessionId) && !audited.has(l.sessionId))
    .map((l) => l.sessionId);
  if (ids.length === 0) return;
  for (const id of ids) audited.add(id);
  void checkSessions(ids).then((r) => {
    // Still loading somewhere: try those again on a later draw.
    for (const [id, result] of r) if (result === 'pending') audited.delete(id);
  }, () => {
    for (const id of ids) audited.delete(id);
  });
};

/** Which task modal sections are open; read once at start, saved on every toggle. */
let sections: Sections = { ...DEFAULT_SECTIONS };
const saveSections = (next: Sections): void => {
  sections = next;
  saver.save(STORAGE_KEYS.detailSections, () => store.saveSections(next));
};

const start = (ctx: HostReadyContext): void => {
  injectStyles();
  void store
    .loadSections()
    .then((s) => {
      sections = s;
    })
    .catch(() => {});
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
    onArchiveDone: () => void archiveDone(),
    onShowArchived: (show) => {
      state.showArchived = show;
      draw();
    },
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
    loadModels,
    beforeMove: (task) => starter.leaveQueue(task.id),
    afterSetState: detach,
    session: {
      target: (task) => sessionTarget(task.id, state.sessions, starter.links(), detached().get(task.id)),
      check: checkSession,
      open: (id) => void host.openSession(id).catch((e: unknown) => fail(`Could not open the session: ${errorText(e)}`)),
    },
    sections: { get: () => sections, save: saveSections },
    archive: { has: (task) => isArchived(task, archivedTasks()), unarchive },
    baseTypes: () => settings().types,
    start: {
      context: startContext,
      load: (projectId, taskId) => store.loadCard(projectId, taskId),
      save: (projectId, taskId, card) => saver.save(`card:${projectId}:${taskId}`, () => store.saveCard(projectId, taskId, card)),
    },
    summary: {
      model: (task) =>
        startContext() === null ? null : { text: summaries.get(task), status: summaries.status(task), auto: summaries.auto() },
      summarise: (task) => void summaries.summarise(task),
      onLanguage: (projectId, taskId, language) => summaries.setLanguage(projectId, taskId, language),
    },
  });
  // Answers the model gave after an earlier frame of this panel was gone are kept by the host.
  if (ctx.features?.lateGenerateResults === true) host.onLateGenerateResult((late) => void summaries.acceptLate(late));
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
        body: `${e instanceof Error ? e.message : String(e)}. Allow the “sessions” capability for Kanban Board in Settings → Extensions.`,
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
