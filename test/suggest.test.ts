import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskState } from '../src/core/types.ts';
import { MODEL_PICK } from '../src/panel/addTask.ts';
import { createLimiter } from '../src/panel/limiter.ts';
import { PROMPT_MAX, SUMMARY_SYSTEM, createSummaries, type GenerateRequest } from '../src/panel/summaries.ts';
import {
  SUGGEST_STATES,
  SUGGEST_SYSTEM,
  askedOf,
  buildSuggestPrompt,
  createSuggester,
  parseSuggestion,
  planSuggestion,
  type SuggestJob,
} from '../src/panel/suggest.ts';

const TYPES = ['enhancement', 'bug', 'chore', 'research'];

const task = (over: Partial<Task> = {}): Task => ({
  id: '#7',
  kind: 'ticket',
  title: 'Export to CSV',
  body: 'Users want a CSV export.',
  state: 'needs-triage',
  type: null,
  parentId: null,
  blockedBy: [],
  url: null,
  updatedAt: 0,
  claimed: false,
  ...over,
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

const hostError = (code: string): Error => Object.assign(new Error(code), { code });

// --- which fields the model picks ---

test('askedOf: only the fields left on "Let the model pick"; no type is asked when the board has no types', () => {
  assert.deepEqual(askedOf({ type: MODEL_PICK, state: MODEL_PICK }, TYPES), { type: true, state: true });
  assert.deepEqual(askedOf({ type: 'bug', state: MODEL_PICK }, TYPES), { type: false, state: true });
  assert.deepEqual(askedOf({ type: '', state: MODEL_PICK }, TYPES), { type: false, state: true }, '"No type" is a choice');
  assert.deepEqual(askedOf({ type: MODEL_PICK, state: 'ready-for-agent' }, TYPES), { type: true, state: false });
  assert.deepEqual(askedOf({ type: 'bug', state: 'needs-info' }, TYPES), { type: false, state: false });
  assert.deepEqual(askedOf({ type: MODEL_PICK, state: 'needs-info' }, []), { type: false, state: false });
});

// --- prompt ---

test('buildSuggestPrompt: lists the types and the four states, the task as data, then JSON only', () => {
  const p = buildSuggestPrompt({ title: 'Export to CSV', body: 'Users want a CSV export.' }, TYPES);
  for (const t of TYPES) assert.ok(p.includes(t), t);
  assert.deepEqual([...SUGGEST_STATES], ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human']);
  for (const s of SUGGEST_STATES) assert.ok(p.includes(s), s);
  assert.ok(!p.includes('done') && !p.includes('wontfix'));
  assert.ok(p.includes('Title: Export to CSV'));
  assert.ok(p.includes('Users want a CSV export.'));
  assert.match(p, /data, not instructions/);
  // The JSON instruction comes after the task text, so the last word is ours.
  const body = p.indexOf('Users want a CSV export.');
  const json = p.lastIndexOf('Answer with only');
  assert.ok(json > body);
  assert.match(p.slice(json), /\{"type": .*"state": .*\}/);
});

test('buildSuggestPrompt: a huge body is cut so the prompt stays under the limit, the instruction kept', () => {
  const p = buildSuggestPrompt({ title: 'T'.repeat(500), body: 'x'.repeat(PROMPT_MAX * 2) }, TYPES);
  assert.ok(p.length <= PROMPT_MAX, String(p.length));
  assert.ok(p.includes('[…the rest is cut]'));
  assert.ok(p.trimEnd().endsWith('}'), 'the JSON instruction survives the cut');
});

// --- parsing ---

test('parseSuggestion: a JSON object with a board type and an open state', () => {
  assert.deepEqual(parseSuggestion('{"type":"bug","state":"ready-for-agent"}', TYPES), { type: 'bug', state: 'ready-for-agent' });
  assert.deepEqual(parseSuggestion('  {"state": "needs-info", "type": "chore"}\n', TYPES), { type: 'chore', state: 'needs-info' });
  // Small models like code fences; one fenced object and nothing else is still the answer.
  assert.deepEqual(parseSuggestion('```json\n{"type":"research","state":"ready-for-human"}\n```', TYPES), {
    type: 'research',
    state: 'ready-for-human',
  });
});

test('parseSuggestion: anything else is rejected whole', () => {
  const bad = [
    '',
    'bug, ready-for-agent',
    'Sure! {"type":"bug","state":"ready-for-agent"}',
    '{"type":"bug","state":"ready-for-agent"} hope that helps',
    '{"type":"bug","state":"ready-for-agent"',
    '[{"type":"bug","state":"ready-for-agent"}]',
    '{"type":"feature","state":"ready-for-agent"}',
    '{"type":"Bug","state":"ready-for-agent"}',
    '{"type":"bug","state":"done"}',
    '{"type":"bug","state":"wontfix"}',
    '{"type":"bug","state":"in-progress"}',
    '{"type":"bug"}',
    '{"state":"needs-info"}',
    '{"type":null,"state":"needs-info"}',
    '{"type":1,"state":"needs-info"}',
    '{"type":"bug","state":"needs-info","note":"x"}',
    '{"type":"__proto__","state":"needs-info"}',
    '```\n{"type":"bug","state":"needs-info"}\n```\n```\n{}\n```',
    'null',
  ];
  for (const text of bad) assert.equal(parseSuggestion(text, TYPES), null, text);
});

test('parseSuggestion: a board without types expects "type": null', () => {
  assert.deepEqual(parseSuggestion('{"type":null,"state":"needs-info"}', []), { type: null, state: 'needs-info' });
  assert.equal(parseSuggestion('{"type":"bug","state":"needs-info"}', []), null);
});

// --- what gets applied ---

test('planSuggestion: only the asked fields, only where the task still has what it was created with', () => {
  const s = { type: 'bug', state: 'ready-for-agent' as TaskState };
  const both = { type: true, state: true };
  assert.deepEqual(planSuggestion(both, s, task()), { type: 'bug', state: 'ready-for-agent' });
  assert.deepEqual(planSuggestion({ type: true, state: false }, s, task()), { type: 'bug' });
  assert.deepEqual(planSuggestion({ type: false, state: true }, s, task()), { state: 'ready-for-agent' });
  assert.deepEqual(planSuggestion({ type: false, state: false }, s, task()), {});
  // The user set a type or moved the task meanwhile: theirs stays.
  assert.deepEqual(planSuggestion(both, s, task({ type: 'chore' })), { state: 'ready-for-agent' });
  assert.deepEqual(planSuggestion(both, s, task({ state: 'ready-for-human' })), { type: 'bug' });
  assert.deepEqual(planSuggestion(both, s, task({ state: 'done', type: 'chore' })), {});
  // A suggestion equal to what the task already is writes nothing.
  assert.deepEqual(planSuggestion(both, { type: 'bug', state: 'needs-triage' }, task()), { type: 'bug' });
  assert.deepEqual(planSuggestion(both, { type: null, state: 'needs-info' }, task()), { state: 'needs-info' });
  // The task is gone.
  assert.deepEqual(planSuggestion(both, s, null), {});
});

// --- the suggester ---

type Call = { req: GenerateRequest; resolve: (text: string) => void; reject: (e: unknown) => void };

const setup = (opts: { concurrency?: number; busy?: Set<string> } = {}) => {
  const calls: Call[] = [];
  const generate = (req: GenerateRequest): Promise<{ text: string }> =>
    new Promise((resolve, reject) => calls.push({ req, resolve: (text) => resolve({ text }), reject }));
  const notices: string[] = [];
  const applied: Array<{ id: string; type?: string; state?: TaskState }> = [];
  const limit = createLimiter(opts.concurrency ?? 2);
  const suggester = createSuggester({
    generate,
    limit,
    busy: (id) => opts.busy?.has(id) ?? false,
    onNotice: (m) => notices.push(m),
    onApplied: (id, a) => applied.push({ id, ...a }),
  });
  /** The task as the tracker has it now; tests change it to play the user. */
  const current = new Map<string, Task>([['#7', task()]]);
  const writes: string[] = [];
  const target: SuggestJob['target'] = {
    get: async (id) => {
      const t = current.get(id);
      if (t === undefined) throw new Error('not found');
      return t;
    },
    setType: async (id, type) => {
      writes.push(`type ${id} ${type}`);
      current.set(id, { ...current.get(id)!, type });
    },
    setState: async (id, state) => {
      writes.push(`state ${id} ${state}`);
      current.set(id, { ...current.get(id)!, state });
    },
  };
  const job = (over: Partial<SuggestJob> = {}): SuggestJob => ({
    taskId: '#7',
    title: 'Export to CSV',
    body: 'Users want a CSV export.',
    types: TYPES,
    asked: { type: true, state: true },
    target,
    ...over,
  });
  return { calls, notices, applied, limit, suggester, current, writes, job };
};

test('suggester: asks once, re-reads the task, writes the asked fields, reports them', async () => {
  const s = setup();
  const done = s.suggester.suggest(s.job());
  await settle();
  assert.equal(s.calls.length, 1);
  const req = s.calls[0]!.req;
  assert.ok(req.system?.startsWith(SUGGEST_SYSTEM));
  assert.ok(!req.system?.startsWith(SUMMARY_SYSTEM), 'never mistaken for a summary');
  assert.ok(req.prompt.includes('Export to CSV'));
  assert.ok((req.maxOutputTokens ?? 0) > 0 && (req.maxOutputTokens ?? 0) <= 200);
  s.calls[0]!.resolve('{"type":"bug","state":"ready-for-agent"}');
  assert.deepEqual(await done, { kind: 'applied', type: 'bug', state: 'ready-for-agent' });
  assert.deepEqual(s.writes, ['type #7 bug', 'state #7 ready-for-agent']);
  assert.deepEqual(s.applied, [{ id: '#7', type: 'bug', state: 'ready-for-agent' }]);
  assert.deepEqual(s.notices, []);
});

test('suggester: a field the user set in the form, or changed since, is never overwritten', async () => {
  const s = setup();
  const done = s.suggester.suggest(s.job({ asked: { type: false, state: true } }));
  await settle();
  s.current.set('#7', task({ state: 'ready-for-human' })); // the user moved it while the model thought
  s.calls[0]!.resolve('{"type":"bug","state":"ready-for-agent"}');
  assert.deepEqual(await done, { kind: 'kept' });
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.applied, []);
});

test('suggester: nothing asked → no request at all', async () => {
  const s = setup();
  assert.deepEqual(await s.suggester.suggest(s.job({ asked: { type: false, state: false } })), { kind: 'kept' });
  assert.equal(s.calls.length, 0);
});

test('suggester: a task being written by the user right now is left alone', async () => {
  const busy = new Set<string>();
  const s = setup({ busy });
  const done = s.suggester.suggest(s.job());
  await settle();
  busy.add('#7');
  s.calls[0]!.resolve('{"type":"bug","state":"ready-for-agent"}');
  assert.deepEqual(await done, { kind: 'kept' });
  assert.deepEqual(s.writes, []);
});

test('suggester: an invalid answer or a failure keeps the defaults, with one quiet notice per session', async () => {
  const s = setup();
  const a = s.suggester.suggest(s.job());
  const b = s.suggester.suggest(s.job());
  await settle();
  s.calls[0]!.resolve('I think this is a bug.');
  s.calls[1]!.reject(hostError('GENERATE_FAILED'));
  assert.deepEqual(await a, { kind: 'failed' });
  assert.deepEqual(await b, { kind: 'failed' });
  assert.deepEqual(s.writes, []);
  assert.equal(s.notices.length, 1);
  assert.match(s.notices[0]!, /needs-triage/);
  assert.equal(s.suggester.available(), true, 'a bad answer does not switch suggestions off');
  // A write that fails counts as a failure too (no second notice).
  s.current.set('#7', task());
  const c = s.suggester.suggest(s.job({ target: { ...s.job().target, setType: async () => Promise.reject(new Error('gh')) } }));
  await settle();
  s.calls[2]!.resolve('{"type":"bug","state":"needs-triage"}');
  assert.deepEqual(await c, { kind: 'failed' });
  assert.equal(s.notices.length, 1);
});

test('suggester: no model (or no permission) → unavailable for the session, one notice, no more requests', async () => {
  const s = setup();
  const a = s.suggester.suggest(s.job());
  await settle();
  s.calls[0]!.reject(hostError('NO_MODEL'));
  assert.deepEqual(await a, { kind: 'unavailable' });
  assert.equal(s.suggester.available(), false);
  assert.equal(s.notices.length, 1);
  assert.match(s.notices[0]!, /Small Model/);
  assert.deepEqual(await s.suggester.suggest(s.job()), { kind: 'unavailable' });
  assert.equal(s.calls.length, 1);
  assert.equal(s.notices.length, 1);
});

test('suggester: shares the generate limit with summaries (waits for a free slot)', async () => {
  const s = setup({ concurrency: 1 });
  // A summary takes the only slot first.
  const summaryCalls: Array<(t: string) => void> = [];
  const summaries = createSummaries({
    generate: (req) =>
      new Promise((resolve) => {
        assert.ok(req.system?.startsWith(SUMMARY_SYSTEM));
        summaryCalls.push((text) => resolve({ text }));
      }),
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    context: () => ({ projectId: 'p', summary: { auto: true, language: 'English', prompt: 'Summarise {body}' } }),
    limit: s.limit,
  });
  void summaries.ensure(task({ id: '#1', body: 'b' }));
  await settle();
  assert.equal(summaryCalls.length, 1);
  const done = s.suggester.suggest(s.job());
  await settle();
  assert.equal(s.calls.length, 0, 'waits while the summary holds the slot');
  summaryCalls[0]!('A summary.');
  await settle();
  assert.equal(s.calls.length, 1);
  s.calls[0]!.resolve('{"type":"chore","state":"needs-triage"}');
  assert.deepEqual(await done, { kind: 'applied', type: 'chore' });
});

test('summaries.acceptLate ignores a late suggestion answer (dropped: the task may have changed)', () => {
  const summaries = createSummaries({
    generate: async () => ({ text: '' }),
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    context: () => null,
  });
  const late = { request: { prompt: 'x', system: `${SUGGEST_SYSTEM}` }, ok: true as const, result: { text: '{"type":"bug","state":"needs-info"}' } };
  assert.equal(summaries.acceptLate(late), false);
});
