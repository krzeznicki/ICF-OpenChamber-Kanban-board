import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { createLauncher, SETTLE_MS, type LauncherDeps } from '../src/panel/launcher.ts';
import type { StartOptions } from '../src/panel/settings.ts';

const task: Task = {
  id: '#7',
  kind: 'ticket',
  title: 'Seven',
  body: '',
  state: 'ready-for-agent',
  type: null,
  parentId: null,
  blockedBy: [],
  url: 'https://github.com/o/r/issues/7',
  updatedAt: 0,
  claimed: false,
  source: 'github',
};
const opts: StartOptions = { presetId: 'implement', model: null, agent: null, variant: null, location: 'worktree' };

const setup = (over: Partial<LauncherDeps> = {}) => {
  const calls: Array<{ task: Task; opts: StartOptions; prompt: string }> = [];
  const errors: unknown[] = [];
  let clock = 0;
  const isStarting = new Set<string>();
  const launcher = createLauncher({
    isStarting,
    hasLiveSession: () => false,
    prompt: async (t) => `prompt for ${t.id}`,
    start: async (t, o, prompt) => {
      calls.push({ task: t, opts: o, prompt });
      return { sessionId: 'ses_1' };
    },
    onError: (_t, e) => errors.push(e),
    now: () => clock,
    ...over,
  });
  return { launcher, calls, errors, isStarting, tick: (ms: number) => (clock += ms) };
};

test('two launches of one task start one session', async () => {
  const { launcher, calls, isStarting } = setup();
  const [a, b] = await Promise.all([launcher.launch(task, opts), launcher.launch(task, opts)]);
  assert.deepEqual([a, b].sort(), ['already', 'started']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.prompt, 'prompt for #7');
  // Still marked until the session shows up in a snapshot.
  assert.ok(isStarting.has('#7'));
  assert.equal(await launcher.launch(task, opts), 'already');
  assert.equal(calls.length, 1);
});

test('a task with a live session is already started', async () => {
  const { launcher, calls } = setup({ hasLiveSession: (id) => id === '#7' });
  assert.equal(await launcher.launch(task, opts), 'already');
  assert.equal(calls.length, 0);
});

test('a failed start clears isStarting and returns failed', async () => {
  const { launcher, isStarting, errors } = setup({
    start: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(await launcher.launch(task, opts), 'failed');
  assert.equal(isStarting.size, 0);
  assert.equal((errors[0] as Error).message, 'boom');
});

test('a sessionId null answer is a failure too, and a retry may start again', async () => {
  let answer: string | null = null;
  const { launcher, isStarting, calls } = setup({
    start: async (t, o, prompt) => {
      calls.push({ task: t, opts: o, prompt });
      return { sessionId: answer };
    },
  });
  assert.equal(await launcher.launch(task, opts), 'failed');
  assert.equal(isStarting.size, 0);
  answer = 'ses_2';
  assert.equal(await launcher.launch(task, opts), 'started');
  assert.equal(calls.length, 2);
});

test('a failed prompt never calls start', async () => {
  const { launcher, calls, isStarting } = setup({
    prompt: async () => {
      throw new Error('no service');
    },
  });
  assert.equal(await launcher.launch(task, opts), 'failed');
  assert.equal(calls.length, 0);
  assert.equal(isStarting.size, 0);
});

test('settle releases a task once its session is known, or after SETTLE_MS', async () => {
  const { launcher, isStarting, tick } = setup();
  await launcher.launch(task, opts);
  assert.equal(launcher.settle(() => false), false);
  assert.ok(isStarting.has('#7'));
  assert.equal(launcher.settle((id) => id === 'ses_1'), true);
  assert.equal(isStarting.size, 0);

  await launcher.launch(task, opts);
  tick(SETTLE_MS);
  assert.equal(launcher.settle(() => false), true);
  assert.equal(isStarting.size, 0);
});

test('a pending start (timed-out path B) keeps the task starting until a session for it shows up', async () => {
  const { launcher, isStarting, tick } = setup({ start: async () => ({ sessionId: null, pending: true }) });
  tick(100);
  assert.equal(await launcher.launch(task, opts), 'pending');
  assert.ok(isStarting.has('#7'));
  // A second drop does not start a second session.
  assert.equal(await launcher.launch(task, opts), 'already');
  assert.equal(launcher.settle(() => true), false, 'a session id check alone cannot release it');
  assert.equal(launcher.settle(() => false, (id, since) => id === '#7' && since === 100), true);
  assert.equal(isStarting.size, 0);
});

test('a given prompt (a queued entry) is used as is; starting() lists starts in flight', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const { launcher, calls } = setup({
    prompt: async () => assert.fail('not asked'),
    start: async (t, o, prompt) => {
      calls.push({ task: t, opts: o, prompt });
      await gate;
      return { sessionId: 'ses_9' };
    },
  });
  const pending = launcher.launch(task, opts, 'queued prompt');
  await Promise.resolve();
  assert.deepEqual(launcher.starting(), ['#7']);
  release();
  assert.equal(await pending, 'started');
  assert.deepEqual(launcher.starting(), []);
  assert.equal(calls[0]?.prompt, 'queued prompt');
});
