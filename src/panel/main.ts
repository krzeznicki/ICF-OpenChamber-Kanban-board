// Entry for both the rail panel (panel/index.html) and the full-screen page (panel/page.html).
// The layout follows ctx.surface through the data-oc-surface attribute applyHostReady sets.
// It also answers the `/kanban` slash command by opening the rail panel (see host.onResolve below).
// Data: projects and sessions from the host, tasks from our service via host.serviceRequest.
// Writes (drag and drop, the task modal, Add task) live in edit.ts; a drop on In Progress goes to starter.ts:
// it starts an agent session (or queues it over the limit) and the card then follows that session. Settings (global, per project, presets, per card) come from the
// extension's storage through settings.ts and are edited in the Settings sheet. Personal summaries
// (summaries.ts) are read or generated for the shown cards after each load. "Archive done"
// (archive.ts) hides done tasks from the board through the extension's storage only, and so is
// the manual card order (order.ts: a card dragged up or down its column).
import { connectHost } from '@openchamber/sdk';
import type { GuestProject, GuestSessionRecord, HostReadyContext } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import { VARIANT, panelId } from '../core/variant.ts';
import type { Task } from '../core/types.ts';
import { archivableIds, archivedShown, archiveTasks, archiveWriteJob, createStorageSync, createPendingMarks, isArchived, mergeArchived, reconcileArchived, unarchiveTask } from './archive.ts';
import { ApiError, createApi, type Api, type ConfigResult, type ProjectConfig } from './api.ts';
import { applyOrder, forgetInOrder, pruneOrder, renameInOrder, reorder } from './order.ts';
import { COLUMNS, groupTasks, pruneArchived, resolveSession, sessionForTask, sessionTarget, type Column, type SessionLookup } from './columns.ts';
import { createEditor, type Editor } from './edit.ts';
import { EMPTY_SETS, listPresets, type Preset, type StoredSets } from './presets.ts';
import {
  createLatestSaver,
  createSettingsStore,
  DEFAULT_SECTIONS,
  presetSetOf,
  resolveSettings,
  type Sections,
  type Settings,
  type SettingsLayer,
  STORAGE_KEYS,
  suggestEnabled,
  withDetach,
} from './settings.ts';
import { defaultChoice, loadNotice, setupOutcome, type ApiFailure, type NoticeModel, type TrackerChoice } from './setup.ts';
import { createAgentLoader, createModelLoader, type StartLists } from './models.ts';
import { createStarter } from './starter.ts';
import { MODEL_NOTICES, createLimiter, createModelAvailability } from './limiter.ts';
import { createSuggester, createTypeClassifier } from './suggest.ts';
import { taskTypes } from './moves.ts';
import { MODEL_PICK } from './addTask.ts';
import { filterBoard, searchSuggestions } from './search.ts';
import { createSummaries } from './summaries.ts';
import { createProjectFollow } from './projectFollow.ts';
import { createSessionFocus } from './sessionFocus.ts';
import { createBoard, type Board } from './ui/board.ts';
import { askChoice } from './ui/confirm.ts';
import { mountNotice } from './ui/notice.ts';
import { stateTone } from './ui/detail.ts';
import { openSessionTasks } from './ui/sessionTasks.ts';
import { bindingOf, createKeymap, sameBinding } from './keymap.ts';
import { createShortcuts, type Shortcuts } from './shortcuts.ts';
import { cheatSheetGroups } from './cheatSheet.ts';
import { openCheatSheet } from './ui/cheatSheet.ts';
import { setHintKeymap } from './ui/shortcutHints.ts';
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
  /** The shown project's session snapshot has loaded (or cannot: no sessions grant). */
  sessionsReady: boolean;
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
  /** The preset sets as stored (presets.ts). */
  presets: StoredSets;
  /** The known skills (Matt Pocock's, Superpowers) installed for `settingsFor` and their SKILL.md (POST /skills/detect); null when the check failed. */
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
  /** The manual card order (order.ts); `orderFor` is its project. */
  order: string[];
  orderFor: string | null;
  /** The toolbar's search text (search.ts); this panel session only, kept across project switches. */
  query: string;
};

const state: State = {
  projects: [],
  projectId: null,
  pinned: false,
  hostDirectory: null,
  sessions: [],
  sessionsReady: false,
  config: null,
  tasks: null,
  hideSubtasks: false,
  lastLoad: 0,
  view: 'none',
  columns: new Map(),
  globalSettings: {},
  projectSettings: {},
  settingsFor: null,
  presets: EMPTY_SETS,
  skills: null,
  detached: new Map(),
  detachedFor: null,
  archived: new Set(),
  archivedFor: null,
  archivedTasks: new Map(),
  archivedTasksFor: null,
  showArchived: false,
  order: [],
  orderFor: null,
  query: '',
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
/** Whether a load may take the stored archive marks over memory (archive.ts createStorageSync). */
const archiveSync = createStorageSync();
/** The shown project's manual card order (empty while another project's is loaded). */
const order = (): string[] => (state.orderFor === state.projectId ? state.order : []);
/** The same rule for the card order: a load takes storage only when every reorder of this frame is written. */
const orderSync = createStorageSync();
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
    const presets = await store.loadPresets();
    const global = await store.loadGlobal();
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

/** The project's models and agents through the service, fetched the first time a picker needs them in a project, then kept per project directory. */
const lists: StartLists = {
  models: createModelLoader(
    (directory) => createApi(host, directory).listModels(),
    () => project()?.directory ?? null,
  ),
  agents: createAgentLoader(
    (directory) => createApi(host, directory).listAgents(),
    () => project()?.directory ?? null,
  ),
};

/** The settings in force for the shown project (global only until its layer has loaded). */
const settings = (): Settings => {
  const loaded = state.settingsFor !== null && state.settingsFor === state.projectId;
  return resolveSettings(state.globalSettings, loaded ? state.projectSettings : {}, loaded ? (state.skills?.found ?? []) : []);
};

/** The shown board's types (the settings' and those its tasks use), without the model-pick marker. */
const boardTypes = (): string[] => (state.tasks === null ? [] : taskTypes(state.tasks, settings().types).filter((t) => t !== MODEL_PICK));

/** The presets a start uses: those of the project's preset set (settings presetSet), with each skill's SKILL.md. */
const presets = (): Preset[] => {
  const skills = state.settingsFor === state.projectId ? state.skills : null;
  const loaded = state.settingsFor !== null && state.settingsFor === state.projectId;
  return listPresets(state.presets, presetSetOf(state.globalSettings, loaded ? state.projectSettings : {}, state.presets, skills?.found ?? []), skills?.paths ?? {});
};

/** After any settings change: the hide switch follows, the board and an open detail redraw. */
const applySettings = (): void => {
  applyKeymap();
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

/** The known skills installed for the project, or null when the service could not tell. */
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
      lists,
    },
  );
};

/** The project of the host's directory, also when that is a worktree outside every project (projectFollow.ts). */
const follow = createProjectFollow({
  listSessions: (id) => host.listSessions(id),
  projectOfWorktree: (dir, directories) => createApi(host, dir).projectOfWorktree(directories),
});

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
    applyOrder(state.tasks, order()),
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
  const tracker = state.config.tracker;
  const shown = filterBoard(model, state.tasks, state.query, tracker);
  board.render(shown, editor.busy, (task) => summaries.get(task), {
    archivable: archivableIds(state.tasks, marks).length,
    archived: archivedCount,
    showArchived: state.showArchived,
  });
  auditLinks();
  focusSession();
  if (state.tasks.length > 0 && state.query.trim() !== '' && Object.values(shown).every((cards) => cards.length === 0)) {
    board.setStatus({ kind: 'empty', title: 'No tasks match', body: `No task on the board matches "${state.query.trim()}".` });
  } else if (state.tasks.length === 0) {
    board.setStatus({
      kind: 'empty',
      title: 'No tasks yet',
      body:
        tracker === 'github'
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
    const orderToken = orderSync.loadToken();
    const [tasks, marks, gone, shelved, ranked] = await Promise.all([
      api.list(),
      store.loadDetached(p.id).catch(() => null),
      store.loadArchived(p.id).catch(() => null),
      store.loadArchivedTasks(p.id).catch(() => null),
      store.loadOrder(p.id).catch(() => null),
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
    // The stored order (the other frame may have reordered) unless this frame's own is still unwritten.
    // Ids the tracker no longer lists (deleted elsewhere, long done) are pruned and that written back,
    // but only when nothing changed the order since the load began: a task moved meanwhile (new id)
    // may be missing from this list yet.
    if (ranked !== null && (orderSync.trusts(orderToken) || state.orderFor !== p.id)) {
      const pruned = pruneOrder(ranked, tasks);
      state.order = pruned;
      state.orderFor = p.id;
      if (pruned.length !== ranked.length && orderSync.trusts(orderToken)) setOrder(p.id, pruned);
    }
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
  state.sessionsReady = false;
  // The note spoke about the project the panel opened on.
  board.setSessionNote(null);
  state.detached = new Map();
  state.detachedFor = null;
  state.archived = new Set();
  state.archivedFor = null;
  state.archivedTasks = new Map();
  state.archivedTasksFor = null;
  state.showArchived = false;
  state.order = [];
  state.orderFor = null;
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
      if (snapshot.state !== 'loading') state.sessionsReady = true;
      starter.onSnapshot();
      draw();
    });
    // The user may have switched again while the subscription registered.
    if (state.projectId === id) unsubscribeSessions = unsubscribe;
    else unsubscribe();
  } catch {
    // Without the sessions grant the board still works; In Progress and Review stay empty.
    if (state.projectId === id) {
      state.sessionsReady = true;
      draw();
    }
  }
};

const projectOptions = () => state.projects.map((p) => ({ id: p.id, label: p.name, hint: p.directory }));

/** The project the board last showed by the host's directory or the user's pick, kept across frames; read once in start(). */
let lastProject: string | null = null;
let lastProjectLoaded = false;

/** A project the directory named or the user picked becomes the last used one; a fallback never does. */
const rememberProject = (id: string): void => {
  if (id === lastProject) return;
  lastProject = id;
  saver.save(STORAGE_KEYS.lastProject, () => store.saveLastProject(id));
};

/** `lookUp` false: the lookup for the host's directory just ended, so it is not started again. */
const followHost = (lookUp = true): void => {
  const current = project();
  if (state.pinned && current !== null) return;
  // Nothing shown yet and the answer is on its way: wait for it rather than flash the first project.
  if (lookUp && lookUpHostProject() && current === null) return;
  // Nor on a project list still loading, where the directory's project may only be missing yet.
  if (current === null && !projectsSettled && follow.unknown(state.hostDirectory, state.projects)) return;
  const named = follow.recognised(state.hostDirectory, state.projects);
  // Nor before the last used project is read, which a directory nothing names falls back to.
  if (current === null && named === null && !lastProjectLoaded) return;
  if (named !== null) rememberProject(named.id);
  void selectProject(follow.choose(state.hostDirectory, state.projects, current, lastProject)?.id ?? null);
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

/** One generate limit for the panel: summaries and type/state suggestions take turns. */
const generateLimit = createLimiter();
/**
 * One "Small Model available" flag for both: whichever finds the model missing or not granted gives
 * the one notice, automatic summaries stop and Add task stops offering "Let the model pick".
 */
const smallModel = createModelAvailability((code) =>
  void host.toast({ kind: 'info', message: code === 'NOT_GRANTED' ? MODEL_NOTICES.NOT_GRANTED : MODEL_NOTICES.NO_MODEL }).catch(() => {}),
);

const summaries = createSummaries({
  generate: (request) => host.generate(request),
  limit: generateLimit,
  storage: host.storage,
  // Only once the shown project's settings are in: a summary in the wrong language is wasted.
  context: () => {
    const id = state.projectId;
    return id === null || !globalLoaded || state.settingsFor !== id ? null : { projectId: id, summary: settings().summary };
  },
  loadLanguage: async (projectId, taskId) => (await store.loadCard(projectId, taskId)).summaryLanguage,
  onChange: summaryChanged,
  // A summary generated now: a task without a type gets one picked too (classifier below).
  onGenerated: (projectId, task) => void classifier.onSummary(projectId, task),
  availability: smallModel,
});

// --- type and state of tasks added here (suggest.ts) ---

const suggester = createSuggester({
  generate: (request) => host.generate(request),
  limit: generateLimit,
  availability: smallModel,
  busy: (taskId) => editor.busy.has(taskId),
  // The suggestion was written: show it (load refreshes an open task modal too).
  onApplied: () => void load(),
  onNotice: (message) => void host.toast({ kind: 'info', message }).catch(() => {}),
});

/**
 * The type of a task without one (CLI, agents, GitHub, sub-tasks), picked when its summary is
 * generated. Only for the shown project (its types and tracker); never for a task the user created
 * with "No type".
 */
const classifier = createTypeClassifier({
  suggester,
  enabled: () => suggestEnabled(globalLoaded, state.globalSettings),
  types: (projectId) =>
    projectId !== state.projectId || state.settingsFor !== projectId || state.tasks === null
      ? []
      : taskTypes(state.tasks, settings().types).filter((t) => t !== MODEL_PICK),
  explicitNoType: (projectId, taskId) => store.hasNoType(projectId, taskId),
  target: (projectId) => {
    const p = state.projects.find((x) => x.id === projectId);
    if (p === undefined) return null;
    const api = createApi(host, p.directory);
    return { get: api.get, setType: api.setType, setState: api.setState };
  },
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
  lists,
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

// --- The manual card order (order.ts): panel storage only, for local and GitHub trackers alike ---

const setOrder = (projectId: string, next: string[]): void => {
  state.order = next;
  state.orderFor = projectId;
  const n = orderSync.edit();
  saver.save(STORAGE_KEYS.taskOrder(projectId), () => store.saveOrder(projectId, next).then(() => orderSync.written(n)));
};

/** A card dropped in its own column: the whole column, as drawn, gets its positions. */
const reorderCard = (taskId: string, column: Column, before: string | null): void => {
  const id = state.projectId;
  if (id === null || state.tasks === null) return;
  const ids = [...state.columns].filter(([, c]) => c === column).map(([t]) => t);
  const next = pruneOrder(reorder(order(), ids, taskId, before), state.tasks);
  setOrder(id, next);
  draw();
};

/** Tasks were deleted: their places go. */
const forgetOrdered = (ids: readonly string[]): void => {
  const id = state.projectId;
  if (id !== null && ids.some((d) => order().includes(d))) setOrder(id, forgetInOrder(order(), ids));
};

/** A local link moved a task's file: its place follows the new id. */
const renameOrdered = (from: string, to: string): void => {
  const id = state.projectId;
  if (id !== null && order().includes(from)) setOrder(id, renameInOrder(order(), from, to));
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

// --- The rail panel opened in a chat: that session's task (sessionFocus.ts) ---

/** Set in start(): the rail panel decides once, for the chat it was opened in; other surfaces never. */
let sessionFocus = createSessionFocus(null);
/** The rail panel's session id and the directory of its chat (set in start()), for finding its project. */
let panelSession: { id: string; directory: string | null } | null = null;
/** The host's project list has loaded: until then the shown project may be a fallback. */
let projectsSettled = false;
/** Lookups of the host directory's project in flight: the focus waits, the shown project may still change. */
let projectLookups = 0;

/**
 * The host's directory lies outside every project (a session's worktree): its project is looked up
 * and then followed. On the board page too, which has no session of its own to ask about. True
 * when a lookup is in flight.
 */
const lookUpHostProject = (): boolean => {
  const directory = state.hostDirectory;
  if (!projectsSettled || !follow.unknown(directory, state.projects)) return false;
  projectLookups++;
  void follow.lookup(directory, state.projects, panelSession?.directory === directory ? panelSession.id : null).then(() => {
    projectLookups--;
    // followHost keeps a project the user picked; the host moved on meanwhile: its own lookup answers.
    if (state.hostDirectory === directory) followHost(false);
    draw(); // the focus may decide now
  });
  return true;
};

const focusSession = (): void => {
  const tasks = state.tasks ?? [];
  const focus = sessionFocus.next({
    ready: projectsSettled && projectLookups === 0 && state.view === 'board' && state.tasks !== null && state.sessionsReady,
    tasks,
    sessions: state.sessions,
    links: starter.links(),
    detached: detached(),
  });
  // After the board has drawn: the modal opens over it.
  if (focus.kind === 'open') queueMicrotask(() => editor.showDetail(focus.taskId));
  else if (focus.kind === 'none') board.setSessionNote('No task on this board is being worked on in this session.');
  else if (focus.kind === 'list') {
    const rows = focus.tasks.map((t) => {
      const column = state.columns.get(t.id);
      return { id: t.id, title: t.title, status: COLUMNS.find((c) => c.id === column)?.title ?? t.state, tone: stateTone(t.state) };
    });
    queueMicrotask(() => openSessionTasks(rows, (id) => editor.showDetail(id)));
  }
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

/**
 * The panel's Shortcuts (shortcuts.ts). Context, first answer wins: a confirm (askChoice, the start
 * form) or Settings means none, then the task modal, then Add task, then the Board when no other
 * dialog is open.
 */
let shortcuts: Shortcuts | null = null;
/** The bindings last applied (their stored text), so an unrelated settings change does not rebuild the Keymap. */
let appliedKeys: string | null = null;

/** The user's bindings (global settings) into the dispatcher and every button tooltip, at once. */
const applyKeymap = (): void => {
  if (shortcuts === null) return;
  const overrides = state.globalSettings.shortcuts ?? {};
  const text = JSON.stringify(overrides);
  if (text === appliedKeys) return;
  appliedKeys = text;
  const keymap = createKeymap(overrides);
  shortcuts.setKeymap(keymap);
  setHintKeymap(keymap, shortcuts.platform);
};

const installShortcuts = (): void => {
  shortcuts = createShortcuts();
  shortcuts.addLayer(() => (document.querySelector('.kb-confirm-backdrop') !== null ? 'none' : null));
  shortcuts.addLayer(() => (settingsSheet !== null ? 'none' : null));
  shortcuts.addLayer(() => editor.openModal());
  // Any other dialog (the session's task list, one added later) keeps the Board's Shortcuts off.
  shortcuts.addLayer(() => (state.view === 'board' && document.querySelector('[aria-modal="true"]') === null ? 'board' : 'none'));
  shortcuts.on('board.addTask', () => {
    if (state.config === null) return false;
    editor.showAdd();
  });
  shortcuts.on('add.create', () => editor.submitAddForm());
  installToolbarShortcuts(shortcuts);
  installCheatSheet(shortcuts);
  applyKeymap();
};

/**
 * The toolbar's Shortcuts: each does what its control does. Refresh always takes the key, even
 * while a load runs (its button is disabled then), so Mod+Shift+R never reloads the iframe; outside
 * the Board (a dialog open) its key is swallowed too.
 */
const installToolbarShortcuts = (shortcuts: Shortcuts): void => {
  shortcuts.on('board.projects', () => board.openProjects());
  shortcuts.on('board.settings', () => showSettings());
  shortcuts.on('board.refresh', () => {
    if (!board.busy()) void load();
  });
  document.addEventListener('keydown', (e) => {
    const pressed = bindingOf({ key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, platform: shortcuts.platform });
    if (pressed !== null && sameBinding(pressed, shortcuts.keymap().get('board.refresh').binding)) e.preventDefault();
  });
};

/** `?` on the Board opens the cheat sheet, built from the Keymap now; no Shortcuts while it is open. */
const installCheatSheet = (shortcuts: Shortcuts): void => {
  let open = false;
  shortcuts.addLayer(() => (open ? 'none' : null), { front: true });
  shortcuts.on('board.cheatSheet', () => {
    if (open) return false;
    open = true;
    openCheatSheet(cheatSheetGroups(shortcuts.keymap(), shortcuts.platform), () => {
      open = false;
    });
  });
};

const start = (ctx: HostReadyContext): void => {
  injectStyles();
  void store
    .loadLastProject()
    .catch(() => null)
    .then((id) => {
      lastProject ??= id;
      lastProjectLoaded = true;
      if (state.projects.length > 0) followHost();
    });
  void store
    .loadSections()
    .then((s) => {
      sections = s;
    })
    .catch(() => {});
  const root = document.getElementById('root') ?? document.body;
  state.hostDirectory = ctx.directory;
  if (ctx.surface === 'panel') {
    const id = ctx.session?.id ?? null;
    panelSession = id === null ? null : { id, directory: ctx.directory };
    sessionFocus = createSessionFocus(id);
  }
  board = createBoard(root, {
    onProject: (id) => {
      state.pinned = true;
      rememberProject(id);
      void selectProject(id);
    },
    onHideSubtasks: (hide) => {
      state.hideSubtasks = hide;
      // The switch is the project's "Hide sub-tasks" setting.
      const id = state.settingsFor;
      if (id !== null && id === state.projectId) saveProjectSettings(id, { ...state.projectSettings, hideChildren: hide });
      draw();
    },
    onSearch: (query) => {
      state.query = query;
      draw();
    },
    suggest: (text, caret) => searchSuggestions(text, caret, boardTypes()),
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
    lists,
    beforeMove: (task) => starter.leaveQueue(task.id),
    afterSetState: detach,
    session: {
      target: (task) => sessionTarget(task.id, state.sessions, starter.links(), detached().get(task.id)),
      check: checkSession,
      open: (id) => void host.openSession(id).catch((e: unknown) => fail(`Could not open the session: ${errorText(e)}`)),
    },
    sections: { get: () => sections, save: saveSections },
    archive: { has: (task) => isArchived(task, archivedTasks()), unarchive },
    order: { reorder: reorderCard, rename: renameOrdered, forget: forgetOrdered },
    baseTypes: () => settings().types,
    start: {
      context: startContext,
      load: (projectId, taskId) => store.loadCard(projectId, taskId),
      save: (projectId, taskId, card) => saver.save(`card:${projectId}:${taskId}`, () => store.saveCard(projectId, taskId, card)),
      // After any pending save of the old key, so the options moved are the newest.
      move: async (projectId, from, to) => {
        await saver.idle();
        await store.moveCard(projectId, from, to);
        await store.moveNoType(projectId, from, to);
      },
      forget: async (projectId, taskId) => {
        await saver.idle();
        await store.forgetCard(projectId, taskId);
        await store.forgetNoType(projectId, taskId);
      },
      markNoType: (projectId, taskId) => store.markNoType(projectId, taskId),
    },
    summary: {
      model: (task) =>
        startContext() === null ? null : { text: summaries.get(task), status: summaries.status(task), auto: summaries.auto() },
      summarise: (task) => void summaries.summarise(task),
      onLanguage: (projectId, taskId, language) => summaries.setLanguage(projectId, taskId, language),
    },
    // Global only; off until the global layer is read.
    suggest: { enabled: () => suggestEnabled(globalLoaded, state.globalSettings), suggester },
  });
  installShortcuts();
  // Answers the model gave after an earlier frame of this panel was gone are kept by the host. Only
  // summaries are taken back; a late type/state suggestion is dropped (summaries.acceptLate ignores
  // it), since the task may have been changed by then.
  if (ctx.features?.lateGenerateResults === true) host.onLateGenerateResult((late) => void summaries.acceptLate(late));
  void loadGlobalSettings();
  board.setStatus({ kind: 'loading' });

  host.onDirectory((dir) => {
    // The user moved to another chat before the board decided: what was decided for the chat the
    // panel opened in would land on another one, so the panel shows nothing (once per opening).
    if (dir !== state.hostDirectory) sessionFocus = createSessionFocus(null);
    state.hostDirectory = dir;
    if (state.projects.length > 0) followHost();
  });
  host
    .onProjects((snapshot) => {
      state.projects = snapshot.projects;
      board.setProjects(projectOptions(), state.projectId);
      if (snapshot.state === 'loading' && snapshot.projects.length === 0) return;
      if (state.projectId !== null && project() === null) state.pinned = false; // the project went away
      // Before followHost, which starts the lookup of a worktree's project only on a settled list.
      const settled = snapshot.state !== 'loading';
      if (settled) projectsSettled = true;
      followHost();
      if (settled) draw();
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

// `/kanban` (`/kanban-test` in the test build) opens this panel and attaches nothing. With no
// background entry the host asks a mounted panel frame, or loads this entry hidden just to answer;
// the rail surface id is `plugin:<panel id>`. Arguments are ignored.
host.onResolve(async () => {
  await host.openSurface(`plugin:${panelId(VARIANT)}`);
  return null;
});

let mounted = false;
host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  // A hidden frame loaded only to answer a slash command: no board to draw or poll.
  if (ctx.surface === 'background') return;
  if (mounted) return;
  mounted = true;
  start(ctx);
});
