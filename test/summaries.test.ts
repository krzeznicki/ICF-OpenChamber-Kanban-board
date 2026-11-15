import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { DEFAULT_SUMMARY_PROMPT as FROM_SETTINGS, parseCardOptions, type SummarySettings } from '../src/panel/settings.ts';
import {
  DEFAULT_SUMMARY_PROMPT,
  PROMPT_MAX,
  SUMMARY_SYSTEM,
  buildPrompt,
  createSummaries,
  summaryKey,
  type GenerateRequest,
  type SummaryStorage,
} from '../src/panel/summaries.ts';

const task = (body: string, id = '#42', extra: Partial<Task> = {}): Task => ({
  id,
  kind: 'ticket',
  title: 'Export to CSV',
  body,
  state: 'ready-for-agent',
  type: 'enhancement',
  parentId: null,
  blockedBy: [],
  url: null,
  updatedAt: 0,
  claimed: false,
  ...extra,
});

const S: SummarySettings = { auto: true, language: 'Polish', prompt: DEFAULT_SUMMARY_PROMPT };

const fakeStorage = (): SummaryStorage & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (k) => data.get(k),
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
    keys: async () => [...data.keys()].sort(),
  };
};

type Call = { req: GenerateRequest; resolve: (text: string) => void; reject: (e: unknown) => void };

/** A generate whose answers the test hands out by hand. */
const fakeGenerate = () => {
  const calls: Call[] = [];
  const generate = (req: GenerateRequest): Promise<{ text: string }> =>
    new Promise((resolve, reject) => calls.push({ req, resolve: (text) => resolve({ text }), reject }));
  return { calls, generate };
};

/** Lets queued promise chains run. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const hostError = (code: string): Error => Object.assign(new Error(code), { code });

const setup = (summary: SummarySettings = S, languages: Record<string, string> = {}) => {
  const storage = fakeStorage();
  const gen = fakeGenerate();
  const changes: string[] = [];
  const notices: string[] = [];
  const settings = { summary };
  const s = createSummaries({
    generate: gen.generate,
    storage,
    context: () => ({ projectId: 'p1', summary: settings.summary }),
    loadLanguage: async (_projectId, taskId) => languages[taskId],
    onChange: (id) => changes.push(id),
    onUnavailable: (code) => notices.push(code),
    now: () => 1000,
  });
  return { s, storage, gen, changes, notices, settings };
};

// --- keys and prompt ---

test('settings re-export the one default prompt; it names language, title and body', () => {
  assert.equal(FROM_SETTINGS, DEFAULT_SUMMARY_PROMPT);
  for (const p of ['{language}', '{title}', '{body}']) assert.ok(DEFAULT_SUMMARY_PROMPT.includes(p), p);
  assert.match(DEFAULT_SUMMARY_PROMPT, /2.{1,6}4/);
});

test('summaryKey: same input same key; body, language or prompt change it', () => {
  const a = summaryKey('p1', task('body'), S);
  assert.equal(a, summaryKey('p1', task('body'), S));
  assert.ok(a.startsWith('summary:p1:#42:'));
  assert.ok(a.length <= 128);
  assert.notEqual(a, summaryKey('p1', task('body!'), S));
  assert.notEqual(a, summaryKey('p1', task('body'), { ...S, language: 'English' }));
  assert.notEqual(a, summaryKey('p1', task('body'), { ...S, prompt: 'x {body}' }));
  assert.notEqual(a, summaryKey('p2', task('body'), S));
  assert.equal(a, summaryKey('p1', task('body'), { ...S, auto: false }), 'auto is not part of the key');
});

test('summaryKey fits 128 characters for long ids and stays distinct per task', () => {
  const long = `.scratch/${'feature-'.repeat(20)}/issues/01-a.md`;
  const a = summaryKey('p1', task('b', long), S);
  const b = summaryKey('p1', task('b', `${long}x`), S);
  assert.ok(a.length <= 128 && b.length <= 128);
  assert.notEqual(a, b);
  assert.ok(a.startsWith('summary:'));
});

test('buildPrompt fills the placeholders and caps the body under the SDK limit', () => {
  const p = buildPrompt(task('Do $& the thing'), { ...S, language: 'English' });
  assert.ok(p.includes('English') && p.includes('Export to CSV') && p.includes('Do $& the thing'));
  assert.ok(!p.includes('{body}'));
  const huge = buildPrompt(task('x'.repeat(200_000)), S);
  assert.ok(huge.length <= PROMPT_MAX);
  // A prompt without {body} still gets the task.
  const bare = buildPrompt(task('the body'), { ...S, prompt: 'Summarise in {language}.' });
  assert.ok(bare.includes('the body') && bare.includes('Export to CSV'));
});

// --- the cache ---

test('same body: cached, one generate call, stored with createdAt', async () => {
  const { s, storage, gen, changes } = setup();
  const t = task('Add a CSV export.');
  const first = s.ensure(t);
  const dup = s.ensure(t); // in flight: deduped
  await settle();
  assert.equal(gen.calls.length, 1);
  assert.equal(gen.calls[0]!.req.system?.startsWith(SUMMARY_SYSTEM), true);
  gen.calls[0]!.resolve('  Users can export.  ');
  assert.equal(await first, 'Users can export.');
  assert.equal(await dup, 'Users can export.');
  assert.equal(s.get(t), 'Users can export.');
  assert.equal(await s.ensure(t), 'Users can export.');
  assert.equal(gen.calls.length, 1);
  assert.deepEqual(storage.data.get(summaryKey('p1', t, S)), { text: 'Users can export.', createdAt: 1000 });
  assert.ok(changes.includes('#42'));
});

test('a stored summary is read back without generating (new page session)', async () => {
  const one = setup();
  const t = task('Body');
  const p = one.s.ensure(t);
  await settle();
  one.gen.calls[0]!.resolve('Cached.');
  await p;
  const two = setup();
  for (const [k, v] of one.storage.data) two.storage.data.set(k, v);
  assert.equal(two.s.get(t), null, 'nothing in memory yet');
  assert.equal(await two.s.load(t), 'Cached.');
  assert.equal(two.s.get(t), 'Cached.');
  assert.equal(await two.s.ensure(t), 'Cached.');
  assert.equal(two.gen.calls.length, 0);
});

test('changed body: new key, the old text is never returned for it', async () => {
  const { s, gen, storage } = setup();
  const p = s.ensure(task('Old body'));
  await settle();
  gen.calls[0]!.resolve('Old summary.');
  await p;
  const changed = task('New body, edited on GitHub');
  assert.equal(s.get(changed), null);
  assert.equal(await s.load(changed), null);
  const next = s.ensure(changed);
  await settle();
  assert.equal(gen.calls.length, 2);
  assert.ok(gen.calls[1]!.req.prompt.includes('New body'));
  assert.equal(s.get(changed), null, 'still null while generating');
  gen.calls[1]!.resolve('New summary.');
  assert.equal(await next, 'New summary.');
  assert.equal(s.get(changed), 'New summary.');
  // The old task's entry was pruned when the new one was stored.
  assert.deepEqual([...storage.data.keys()], [summaryKey('p1', changed, S)]);
});

test('an answer for the old body that lands after the change is not shown for the new body', async () => {
  const { s, gen } = setup();
  const p = s.ensure(task('Old body'));
  await settle();
  const changed = task('New body');
  void s.ensure(changed);
  await settle();
  gen.calls[0]!.resolve('Old summary.');
  await p;
  assert.equal(s.get(changed), null);
  assert.equal(s.status(changed), 'pending');
});

test('changed language (settings or the card) means a new key', async () => {
  const env = setup(S, { '#7': 'German' });
  const t = task('Body');
  const p = env.s.ensure(t);
  await settle();
  env.gen.calls[0]!.resolve('Polski.');
  await p;
  env.settings.summary = { ...S, language: 'English' };
  assert.equal(env.s.get(t), null);
  const q = env.s.ensure(t);
  await settle();
  assert.equal(env.gen.calls.length, 2);
  assert.ok(env.gen.calls[1]!.req.prompt.includes('English'));
  env.gen.calls[1]!.resolve('English.');
  assert.equal(await q, 'English.');
  // The card's own language wins over the settings.
  const card = task('Body', '#7');
  const r = env.s.ensure(card);
  await settle();
  assert.ok(env.gen.calls[2]!.req.prompt.includes('German'));
  env.gen.calls[2]!.resolve('Deutsch.');
  assert.equal(await r, 'Deutsch.');
  assert.equal(env.s.get(card), 'Deutsch.');
  env.s.setLanguage('p1', '#7', undefined);
  assert.equal(env.s.get(card), null, 'back on the settings language: the German text does not show');
});

test('parseCardOptions keeps a summary language', () => {
  assert.deepEqual(parseCardOptions({ summaryLanguage: ' English ', presetId: 'plan' }), { presetId: 'plan', summaryLanguage: 'English' });
  assert.deepEqual(parseCardOptions({ summaryLanguage: '  ' }), {});
});

test('at most two generations at once; the rest wait', async () => {
  const { s, gen } = setup();
  const ps = [1, 2, 3, 4].map((n) => s.ensure(task(`Body ${n}`, `#${n}`)));
  await settle();
  assert.equal(gen.calls.length, 2);
  gen.calls[0]!.resolve('one');
  await settle();
  assert.equal(gen.calls.length, 3);
  // A new caller cannot jump in while a slot is handed over.
  gen.calls[1]!.resolve('two');
  void s.ensure(task('Body 5', '#5'));
  await settle();
  assert.equal(gen.calls.length, 4);
  gen.calls[2]!.resolve('three');
  gen.calls[3]!.resolve('four');
  assert.deepEqual(await Promise.all(ps), ['one', 'two', 'three', 'four']);
  await settle();
  assert.equal(gen.calls.length, 5);
});

test('NO_MODEL: null, one notice, auto off for the session, no retry storm', async () => {
  const { s, gen, notices } = setup();
  const ps = [1, 2, 3].map((n) => s.ensure(task(`Body ${n}`, `#${n}`)));
  await settle();
  assert.equal(gen.calls.length, 2);
  gen.calls[0]!.reject(hostError('NO_MODEL'));
  gen.calls[1]!.reject(hostError('NO_MODEL'));
  assert.deepEqual(await Promise.all(ps), [null, null, null]);
  assert.equal(gen.calls.length, 2, 'the queued third never asked');
  assert.deepEqual(notices, ['NO_MODEL']);
  assert.equal(s.auto(), false);
  for (let n = 1; n <= 5; n++) assert.equal(await s.ensure(task(`Body ${n}`, `#${n}`)), null);
  assert.equal(gen.calls.length, 2);
  assert.equal(s.status(task('Body 1', '#1')), 'unavailable');
  // The user's button still tries once more; a second NO_MODEL adds no notice.
  const again = s.summarise(task('Body 1', '#1'));
  await settle();
  assert.equal(gen.calls.length, 3);
  gen.calls[2]!.reject(hostError('NO_MODEL'));
  assert.equal(await again, null);
  assert.deepEqual(notices, ['NO_MODEL']);
});

test('auto follows the settings until the model is missing', () => {
  const env = setup({ ...S, auto: false });
  assert.equal(env.s.auto(), false);
  env.settings.summary = S;
  assert.equal(env.s.auto(), true);
});

test('another failure: null, no automatic retry until the body changes or Summarise', async () => {
  const { s, gen, notices } = setup();
  const t = task('Body');
  const p = s.ensure(t);
  await settle();
  gen.calls[0]!.reject(hostError('MODEL_FAILED'));
  assert.equal(await p, null);
  assert.equal(s.status(t), 'failed');
  assert.equal(await s.ensure(t), null);
  assert.equal(gen.calls.length, 1);
  assert.deepEqual(notices, []);
  assert.equal(s.auto(), true);
  const edited = s.ensure(task('Body 2'));
  await settle();
  assert.equal(gen.calls.length, 2);
  gen.calls[1]!.resolve('ok');
  await edited;
  const retry = s.summarise(t);
  await settle();
  assert.equal(gen.calls.length, 3);
  gen.calls[2]!.resolve('Now it works.');
  assert.equal(await retry, 'Now it works.');
  assert.equal(s.status(t), 'ready');
});

test('an empty answer counts as a failure', async () => {
  const { s, gen } = setup();
  const t = task('Body');
  const p = s.ensure(t);
  await settle();
  gen.calls[0]!.resolve('   ');
  assert.equal(await p, null);
  assert.equal(s.status(t), 'failed');
});

test('storage errors do not break a summary', async () => {
  const env = setup();
  env.storage.get = async () => {
    throw new Error('read failed');
  };
  env.storage.set = async () => {
    throw new Error('write failed');
  };
  const t = task('Body');
  const p = env.s.ensure(t);
  await settle();
  env.gen.calls[0]!.resolve('Still shown.');
  assert.equal(await p, 'Still shown.');
  assert.equal(env.s.get(t), 'Still shown.');
});

test('a late answer with our reference is stored under its key; others are ignored', async () => {
  const { s, gen, storage, changes } = setup();
  const t = task('Body');
  const p = s.ensure(t);
  await settle();
  const request = gen.calls[0]!.req;
  // Pretend this frame is a fresh one that receives the answer late.
  const env = setup();
  assert.equal(env.s.acceptLate({ request, ok: true, result: { text: 'Late summary.' } }), true);
  await settle();
  assert.equal(await env.s.load(t), 'Late summary.');
  assert.equal(env.s.get(t), 'Late summary.');
  assert.deepEqual(env.storage.data.get(summaryKey('p1', t, S)), { text: 'Late summary.', createdAt: 1000 });
  assert.ok(env.changes.includes('#42'));
  assert.equal(env.s.acceptLate({ request: { prompt: 'other', system: 'someone else' }, ok: true, result: { text: 'x' } }), false);
  assert.equal(env.s.acceptLate({ request, ok: false, code: 'MODEL_FAILED', error: 'x' }), true);
  gen.calls[0]!.resolve('Mine.');
  await p;
  void storage;
  void changes;
});
