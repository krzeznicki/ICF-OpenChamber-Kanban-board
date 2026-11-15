// Starting agents from cards, and the start queue as the panel drives it. main.ts wires it to the
// host and the board; the queue itself lives in the service (~/.icf-kanban/queue.json), which also
// drains it after session events while the board is closed.
//
// A drop on In Progress launches at once when a slot is free; over the project's limit (running
// sessions plus starts in flight) or behind an already waiting card it is queued instead, and the
// card shows "Queued" in In Progress. Every sessions snapshot drains: the service hands out what may
// start now (/queue/take) and each entry goes through the normal launcher (path A or B by its options).
import { clampStartSessionRequest, GUEST_ATTACH_ID_MAX } from '@openchamber/sdk';
import type { GuestProject, GuestSessionRecord, HostClient } from '@openchamber/sdk';
import type { Task } from '../core/types.ts';
import { ApiError, createApi } from './api.ts';
import { ledByOrchestrator, sessionForTask, type Detached, type SessionLink } from './columns.ts';
import { createLauncher } from './launcher.ts';
import type { Preset } from './presets.ts';
import { buildPrompt } from './prompt.ts';
import type { QueueEntry } from './queue.ts';
import { resolveStart, type Settings, type StartOptions } from './settings.ts';
import { askStart } from './ui/startForm.ts';

/** A pending start (timed-out path B call) is released by a link for its task created up to this long before. */
const PENDING_LOOKBACK_MS = 120_000;
/** After a timed-out path B call, the links are read again after these delays. */
const PENDING_RELOADS_MS = [10_000, 30_000];
/** serviceRequest codes for "sent, but no answer": the service may have started the session. */
const NO_ANSWER = new Set(['HOST_TIMEOUT', 'REQUEST_FAILED']);

const LIVE = new Set(['running', 'retrying', 'waiting-permission', 'waiting-question']);

export type StartContext = { projectId: string; settings: Settings; presets: Preset[] };

export type StarterDeps = {
  host: HostClient;
  project: () => GuestProject | null;
  tasks: () => Task[] | null;
  sessions: () => GuestSessionRecord[];
  /** Null while the shown project's settings are loading. */
  context: () => StartContext | null;
  loadCard: (projectId: string, taskId: string) => Promise<Partial<StartOptions>>;
  /** Cards the user dragged away from their sessions (columns.ts Detached) in the shown project. */
  detached: () => Detached;
  draw: () => void;
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const createStarter = (deps: StarterDeps) => {
  const { host } = deps;
  const fail = (message: string): void => void host.toast({ kind: 'error', message }).catch(() => {});
  const info = (message: string): void => void host.toast({ kind: 'info', message }).catch(() => {});

  /** Links (path B and recorded path A sessions) and the queue of the shown project. */
  let links: SessionLink[] = [];
  let queue: QueueEntry[] = [];
  /** The project the links and the queue above belong to. */
  let shown: string | null = null;

  const currentId = (): string | null => deps.project()?.id ?? null;

  const hasLiveSession = (taskId: string): boolean => {
    const s = sessionForTask(taskId, deps.sessions(), links, deps.detached().get(taskId));
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

  const settleNow = (): boolean => {
    const sessions = deps.sessions();
    return launcher.settle(
      (id) => sessions.some((s) => s.id === id) || links.some((l) => l.sessionId === id),
      (taskId, since) => links.some((l) => l.taskId === taskId && (l.createdAt ?? 0) >= since - PENDING_LOOKBACK_MS),
    );
  };

  const reloadLinks = async (projectId: string, directory: string): Promise<void> => {
    try {
      const fresh = await createApi(host, directory).listLinks();
      if (currentId() !== projectId) return;
      links = fresh;
      shown = projectId;
      settleNow();
      deps.draw();
    } catch {
      // The next load tries again.
    }
  };

  /**
   * Path A (the panel's host.startSession) when the card sets no model and no agent: OpenChamber
   * makes the worktree and the session carries the card as its item; the panel then records the
   * link so the queue counts the session. Otherwise path B: the service makes the worktree with git,
   * starts the session with the model/agent and records the link. An id too long to be an item
   * (GUEST_ATTACH_ID_MAX) also takes path B, so the card can follow it.
   */
  const startTask = async (task: Task, opts: StartOptions, prompt: string): Promise<{ sessionId: string | null; pending?: boolean }> => {
    const p = deps.project();
    if (p === null) throw new Error('No project is open');
    const api = createApi(host, p.directory);
    if (opts.model !== null || opts.agent !== null || task.id.length > GUEST_ATTACH_ID_MAX) {
      try {
        const r = await api.startSession({
          taskId: task.id,
          title: task.title,
          prompt,
          model: opts.model,
          agent: opts.agent,
          location: opts.location,
        });
        if (r.linkError !== undefined) fail(r.linkError);
        void reloadLinks(p.id, p.directory);
        return { sessionId: r.sessionId };
      } catch (e) {
        if (!(e instanceof ApiError) || !NO_ANSWER.has(e.code)) throw e;
        // No answer, but the service may have started it: wait for its link instead of failing
        // (a retry now would start a second session).
        for (const ms of PENDING_RELOADS_MS) setTimeout(() => void reloadLinks(p.id, p.directory), ms);
        void reloadLinks(p.id, p.directory);
        return { sessionId: null, pending: true };
      }
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
    // Recorded in the service's links too (also when linked is false): the queue counts it, and the card follows it.
    const sessionId = result.sessionId;
    void api
      .addLink(task.id, sessionId, result.directory ?? result.worktree?.directory ?? null)
      .then(() => reloadLinks(p.id, p.directory))
      .catch(() => {});
    return { sessionId };
  };

  const buildFor = async (task: Task, opts: StartOptions): Promise<string> => {
    const p = deps.project();
    if (p === null) throw new Error('No project is open');
    const ctx = deps.context();
    const presets = ctx?.presets ?? [];
    const preset = presets.find((x) => x.id === opts.presetId) ?? presets.find((x) => x.id === 'implement') ?? presets[0];
    if (preset === undefined) throw new Error('Settings are loading, try again in a moment');
    const children = (deps.tasks() ?? []).filter((t) => t.parentId === task.id);
    return buildPrompt(task, preset, await cliPath(p.directory), p.directory, children);
  };

  const isStarting = new Set<string>();
  const launcher = createLauncher({
    isStarting,
    hasLiveSession,
    start: startTask,
    prompt: buildFor,
    onError: (task, e) => fail(`Could not start “${task.title}”: ${errorText(e)}`),
  });

  const report = (task: Task, result: string): void => {
    if (result === 'already') info(`“${task.title}” already has an agent working on it`);
    else if (result === 'started') void host.toast({ kind: 'success', message: `Started an agent on “${task.title}”` }).catch(() => {});
    else if (result === 'pending')
      info(`Starting “${task.title}” is taking longer than expected; the card follows its session once it shows up`);
  };

  const queuedIds = (): Set<string> => new Set(shown === currentId() ? queue.map((e) => e.taskId) : []);

  /** Queued tasks whose last start by the service failed, with the reason. */
  const queueErrors = (): Map<string, string> =>
    new Map(shown === currentId() ? queue.flatMap((e) => (e.lastError !== undefined ? [[e.taskId, e.lastError] as const] : [])) : []);

  /** Tasks with a running or waiting session, and starts in flight: the slots in use. */
  const occupied = (): number => {
    const ids = new Set(isStarting);
    for (const t of deps.tasks() ?? []) if (hasLiveSession(t.id)) ids.add(t.id);
    return ids.size;
  };

  // --- draining ---

  let draining = false;
  let again = false;

  const drainOnce = async (): Promise<void> => {
    const ctx = deps.context();
    const p = deps.project();
    const list = deps.tasks();
    if (ctx === null || p === null || p.id !== ctx.projectId || list === null || shown !== p.id || queue.length === 0) return;
    const api = createApi(host, p.directory);
    const max = ctx.settings.maxParallel;
    let r: { taken: QueueEntry[]; queue: QueueEntry[] };
    try {
      // The tasks the snapshot shows working count too, so the limit holds even if the service
      // cannot read their status.
      const running = list.filter((t) => hasLiveSession(t.id)).map((t) => t.id);
      r = await api.takeFromQueue(max, launcher.starting(), running);
    } catch {
      return; // the next snapshot (or the service, after a session event) tries again
    }
    if (currentId() !== p.id) {
      // Switched meanwhile: the taken entries go back so they are not lost.
      for (const e of r.taken) await api.addToQueue(e, max).catch(() => {});
      return;
    }
    queue = r.queue;
    for (const e of r.taken) {
      const task = list.find((t) => t.id === e.taskId);
      if (task === undefined || task.state === 'done') {
        void api.removeFromQueue(e.taskId).catch(() => {}); // frees its reservation
        continue;
      }
      const opts: StartOptions = { presetId: '', model: e.model, agent: e.agent, location: e.location };
      void launcher.launch(task, opts, e.prompt).then((result) => {
        if (result === 'failed' || result === 'already') void api.removeFromQueue(e.taskId).catch(() => {});
        if (result !== 'already') report(task, result);
        deps.draw();
      });
    }
    deps.draw();
  };

  /** Starts what the queue allows now; runs once at a time, and again when asked meanwhile. */
  const drain = async (): Promise<void> => {
    if (draining) {
      again = true;
      return;
    }
    draining = true;
    try {
      do {
        again = false;
        await drainOnce();
      } while (again);
    } finally {
      draining = false;
    }
  };

  const enqueue = async (task: Task, opts: StartOptions, ctx: StartContext): Promise<void> => {
    const p = deps.project();
    if (p === null || p.id !== ctx.projectId) return;
    let prompt: string;
    try {
      prompt = await buildFor(task, opts);
    } catch (e) {
      fail(`Could not queue “${task.title}”: ${errorText(e)}`);
      return;
    }
    const entry: QueueEntry = {
      taskId: task.id,
      title: task.title,
      prompt,
      model: opts.model,
      agent: opts.agent,
      location: opts.location,
      queuedAt: Date.now(),
    };
    try {
      const fresh = await createApi(host, p.directory).addToQueue(entry, ctx.settings.maxParallel);
      if (currentId() !== p.id) return;
      queue = fresh;
      shown = p.id;
    } catch (e) {
      fail(`Could not queue “${task.title}”: ${errorText(e)}`);
      return;
    }
    deps.draw();
    await drain();
    if (queue.some((e) => e.taskId === task.id)) {
      info(`“${task.title}” is queued; it starts when fewer than ${ctx.settings.maxParallel} agents are running`);
    }
  };

  /** A drop on In Progress: resolve the start options, ask first when "Start automatically" is off, then launch or queue. */
  const onStart = async (task: Task): Promise<void> => {
    // A sub-task of a running orchestrator gets no session of its own.
    if (ledByOrchestrator(task, deps.sessions(), links, deps.detached())) {
      info('The orchestrator leads this task');
      return;
    }
    const ctx = deps.context();
    if (ctx === null) {
      info('Settings are loading, try again in a moment');
      return;
    }
    if (isStarting.has(task.id) || hasLiveSession(task.id)) {
      info(`“${task.title}” already has an agent working on it`);
      return;
    }
    if (queuedIds().has(task.id)) {
      info(`“${task.title}” is already queued`);
      return;
    }
    let card: Partial<StartOptions>;
    try {
      card = await deps.loadCard(ctx.projectId, task.id);
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
    if (currentId() !== ctx.projectId) return;
    if (queuedIds().size > 0 || occupied() >= ctx.settings.maxParallel) {
      await enqueue(task, opts, ctx);
      return;
    }
    const pending = launcher.launch(task, opts);
    deps.draw(); // the card shows in In Progress while it starts
    report(task, await pending);
    deps.draw();
  };

  /**
   * Before a queued card moves to another column: take it out of the queue. False when that
   * failed (the move is not made, so the card cannot start later behind the user's back).
   */
  const leaveQueue = async (taskId: string): Promise<boolean> => {
    const p = deps.project();
    if (p === null || !queuedIds().has(taskId)) return true;
    try {
      const fresh = await createApi(host, p.directory).removeFromQueue(taskId);
      if (currentId() === p.id) queue = fresh;
      deps.draw();
      return true;
    } catch (e) {
      fail(`Could not take the card out of the queue: ${errorText(e)}`);
      return false;
    }
  };

  /** Links and queue of the project, read with every load. */
  const refresh = async (projectId: string, directory: string): Promise<void> => {
    const api = createApi(host, directory);
    const [freshLinks, freshQueue] = await Promise.all([api.listLinks().catch(() => null), api.listQueue().catch(() => null)]);
    if (currentId() !== projectId) return;
    if (shown !== projectId) {
      links = [];
      queue = [];
    }
    shown = projectId;
    if (freshLinks !== null) links = freshLinks;
    if (freshQueue !== null) queue = freshQueue;
    settleNow();
  };

  /** A sessions snapshot of the shown project arrived (main has stored it), or the tasks were (re)loaded. */
  const onSnapshot = (): void => {
    settleNow();
    void drain();
  };

  /** Project switch: nothing in flight or listed belongs to the new project's board. */
  const reset = (): void => {
    launcher.reset();
    links = [];
    queue = [];
    shown = null;
  };

  return {
    isStarting: isStarting as ReadonlySet<string>,
    links: (): SessionLink[] => (shown === currentId() ? links : []),
    queuedIds,
    queueErrors,
    hasLiveSession,
    onStart,
    leaveQueue,
    refresh,
    onSnapshot,
    reset,
  };
};

export type Starter = ReturnType<typeof createStarter>;
