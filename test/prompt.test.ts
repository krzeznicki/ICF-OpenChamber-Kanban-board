import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { BUILTIN_PRESETS } from '../src/panel/presets.ts';
import { buildPrompt, PROMPT_MAX, shellWord } from '../src/panel/prompt.ts';

const task = (extra: Partial<Task> = {}): Task => ({
  id: '.scratch/board/issues/03-drag.md',
  kind: 'ticket',
  title: 'Drag cards',
  body: 'Cards move between columns.',
  state: 'ready-for-agent',
  type: 'enhancement',
  parentId: null,
  blockedBy: [],
  url: null,
  updatedAt: 0,
  claimed: false,
  ...extra,
});
const implement = BUILTIN_PRESETS.find((p) => p.id === 'implement')!;
const CLI = '/home/u/.oc/ext/icf-kanban/build/cli/task-board.mjs';

test('prompt: title and id, body, tracker and CLI line, then the preset text, in that order', () => {
  const p = buildPrompt(task(), implement, CLI, []);
  const at = (s: string): number => {
    const i = p.indexOf(s);
    assert.notEqual(i, -1, `missing ${JSON.stringify(s)}`);
    return i;
  };
  const order = [
    at('Drag cards'),
    at('.scratch/board/issues/03-drag.md'),
    at('Cards move between columns.'),
    at('local issue file'),
    at(`node ${CLI} state .scratch/board/issues/03-drag.md <state>`),
    at(implement.text),
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(!p.includes('Sub-tasks'));
});

test('prompt: a GitHub issue says so and quotes its #id for the shell', () => {
  const p = buildPrompt(task({ id: '#42', url: 'https://github.com/o/r/issues/42' }), implement, CLI, []);
  assert.match(p, /GitHub issue/);
  assert.ok(p.includes(`node ${CLI} state '#42' <state>`));
  assert.ok(p.includes('URL: https://github.com/o/r/issues/42'));
});

test('prompt: a parent lists its sub-tasks with states and says to work until all are done', () => {
  const kids = [task({ id: 'a', title: 'First', state: 'done' }), task({ id: 'b', title: 'Second', state: 'ready-for-agent' })];
  const p = buildPrompt(task({ kind: 'parent' }), implement, CLI, kids);
  assert.ok(p.includes('- a: First (done)'));
  assert.ok(p.includes('- b: Second (ready-for-agent)'));
  assert.ok(p.includes('Work until every sub-task is done; move each sub-task with the CLI as you go.'));
  assert.ok(p.indexOf('Sub-tasks') < p.indexOf(implement.text));
});

test('prompt: a huge body is cut to stay within the limit, with the CLI show line; the preset survives', () => {
  const body = 'x'.repeat(PROMPT_MAX * 2);
  const p = buildPrompt(task({ body }), implement, CLI, []);
  assert.equal(PROMPT_MAX, 16000);
  assert.ok(p.length <= PROMPT_MAX, `length ${p.length}`);
  assert.ok(p.includes(`read the full task with the CLI: node ${CLI} show .scratch/board/issues/03-drag.md`));
  assert.ok(p.endsWith(implement.text));
  assert.ok(p.indexOf('xxxx') < p.indexOf('read the full task'));
});

test('prompt: a short body is kept whole and has no cut line', () => {
  const p = buildPrompt(task(), implement, CLI, []);
  assert.ok(!p.includes('read the full task'));
});

test('shellWord quotes only what needs it', () => {
  assert.equal(shellWord('/a/b-c_d.mjs'), '/a/b-c_d.mjs');
  assert.equal(shellWord('/My Dir/x'), `'/My Dir/x'`);
  assert.equal(shellWord(`it's`), `'it'\\''s'`);
});

test('prompt: a parent tells the orchestrator to claim each sub-task first and move it with state when done', () => {
  const kids = [task({ id: '#5', title: 'Kid', state: 'ready-for-agent' })];
  const p = buildPrompt(task({ id: '#4', kind: 'parent', url: 'https://github.com/o/r/issues/4' }), implement, CLI, kids);
  assert.ok(p.includes(`node ${CLI} claim <sub-task id>`), p);
  assert.ok(p.includes(`node ${CLI} state <sub-task id> done`), p);
  assert.ok(p.indexOf('claim <sub-task id>') < p.indexOf(implement.text));
});

test('prompt: a parent with no sub-tasks yet still gets the claim instructions; a ticket does not', () => {
  const p = buildPrompt(task({ kind: 'parent' }), implement, CLI, []);
  assert.ok(p.includes('## Sub-tasks'));
  assert.ok(p.includes('No sub-tasks yet'));
  assert.ok(p.includes(`node ${CLI} claim <sub-task id>`));
  assert.ok(!buildPrompt(task(), implement, CLI, []).includes('claim'));
});
