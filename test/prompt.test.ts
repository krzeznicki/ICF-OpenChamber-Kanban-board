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
  source: extra.id?.startsWith('#') ? 'github' : 'local',
  ...extra,
});
const implement = BUILTIN_PRESETS.find((p) => p.id === 'implement')!;
const CLI = '/home/u/.oc/ext/icf-kanban/build/cli/task-board.mjs';
const DIR = '/home/u/projects/board';
const TB = `node ${CLI} --dir ${DIR}`;

test('prompt: title and id, body, tracker and CLI line, then the preset text, in that order', () => {
  const p = buildPrompt(task(), implement, CLI, DIR, []);
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
    at(`${TB} state .scratch/board/issues/03-drag.md <state>`),
    at(implement.text),
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(!p.includes('Sub-tasks'));
});

test('prompt: a GitHub issue says so and quotes its #id for the shell', () => {
  const p = buildPrompt(task({ id: '#42', url: 'https://github.com/o/r/issues/42' }), implement, CLI, DIR, []);
  assert.match(p, /GitHub issue/);
  assert.ok(p.includes(`${TB} state '#42' <state>`));
  assert.ok(p.includes('URL: https://github.com/o/r/issues/42'));
});

test('prompt: a parent lists its sub-tasks with states and says to work until all are done', () => {
  const kids = [task({ id: 'a', title: 'First', state: 'done' }), task({ id: 'b', title: 'Second', state: 'ready-for-agent' })];
  const p = buildPrompt(task({ kind: 'parent' }), implement, CLI, DIR, kids);
  assert.ok(p.includes('- a: First (done)'));
  assert.ok(p.includes('- b: Second (ready-for-agent)'));
  assert.ok(p.includes('Work until every sub-task is done; move each sub-task with the CLI as you go.'));
  assert.ok(p.indexOf('Sub-tasks') < p.indexOf(implement.text));
});

test('prompt: a huge body is cut to stay within the limit, with the CLI show line; the preset survives', () => {
  const body = 'x'.repeat(PROMPT_MAX * 2);
  const p = buildPrompt(task({ body }), implement, CLI, DIR, []);
  assert.equal(PROMPT_MAX, 16000);
  assert.ok(p.length <= PROMPT_MAX, `length ${p.length}`);
  assert.ok(p.includes(`read the full task with the CLI: ${TB} show .scratch/board/issues/03-drag.md`));
  assert.ok(p.endsWith(implement.text));
  assert.ok(p.indexOf('xxxx') < p.indexOf('read the full task'));
});

test('prompt: a short body is kept whole and has no cut line', () => {
  const p = buildPrompt(task(), implement, CLI, DIR, []);
  assert.ok(!p.includes('read the full task'));
});

test('shellWord quotes only what needs it', () => {
  assert.equal(shellWord('/a/b-c_d.mjs'), '/a/b-c_d.mjs');
  assert.equal(shellWord('/My Dir/x'), `'/My Dir/x'`);
  assert.equal(shellWord(`it's`), `'it'\\''s'`);
});

test('prompt: a parent tells the orchestrator to claim each sub-task first and move it with state when done', () => {
  const kids = [task({ id: '#5', title: 'Kid', state: 'ready-for-agent' })];
  const p = buildPrompt(task({ id: '#4', kind: 'parent', url: 'https://github.com/o/r/issues/4' }), implement, CLI, DIR, kids);
  assert.ok(p.includes(`${TB} claim <sub-task id>`), p);
  assert.ok(p.includes(`${TB} state <sub-task id> done`), p);
  assert.ok(p.indexOf('claim <sub-task id>') < p.indexOf(implement.text));
});

test('prompt: a parent with no sub-tasks yet still gets the claim instructions; a ticket does not', () => {
  const p = buildPrompt(task({ kind: 'parent' }), implement, CLI, DIR, []);
  assert.ok(p.includes('## Sub-tasks'));
  assert.ok(p.includes('No sub-tasks yet'));
  assert.ok(p.includes(`${TB} claim <sub-task id>`));
  assert.ok(!buildPrompt(task(), implement, CLI, DIR, []).includes('claim <'));
});

test('prompt: every CLI line passes --dir with the project root, so an agent in a worktree reaches the tracker', () => {
  const kids = [task({ id: 'k', title: 'Kid' })];
  const p = buildPrompt(task({ kind: 'parent', body: 'x'.repeat(PROMPT_MAX * 2) }), implement, CLI, '/My Projects/board', kids);
  const lines = p.split('\n').filter((l) => l.includes(CLI));
  assert.ok(lines.length >= 4, p);
  for (const l of lines) assert.ok(l.includes(`node ${CLI} --dir '/My Projects/board' `), l);
  assert.match(p, /always pass --dir/i);
  assert.match(p, /even in a worktree/i);
});

test('prompt: a parent says how to create sub-tasks ready-for-agent and that claim needs ready-for-agent', () => {
  const p = buildPrompt(task({ kind: 'parent' }), implement, CLI, DIR, []);
  assert.ok(p.includes('--state ready-for-agent'), p);
  assert.match(p, /claim needs ready-for-agent/);
  assert.match(p, /move a sub-task to ready-for-agent first if needed/);
});

test('prompt: a ticket started from the board is told it need not be claimed', () => {
  const p = buildPrompt(task(), implement, CLI, DIR, []);
  assert.match(p, /this task was started from the board; you don't need to claim it/i);
  assert.doesNotMatch(buildPrompt(task({ kind: 'parent' }), implement, CLI, DIR, []), /don't need to claim it/);
});

test('orchestrate preset: sub-tasks are created ready-for-agent and claim needs ready-for-agent', () => {
  const o = BUILTIN_PRESETS.find((x) => x.id === 'orchestrate')!;
  assert.ok(o.text.includes('--state ready-for-agent'), o.text);
  assert.match(o.text, /claim needs ready-for-agent/);
  assert.match(o.text, /move a sub-task to ready-for-agent first if needed/);
});

test("prompt: the Matt set's Implement runs its skills text, the user edit when edited", async () => {
  const { listPresets, EMPTY_SETS, setPresetText, BUILTIN_SETS } = await import('../src/panel/presets.ts');
  const pick = (stored: typeof EMPTY_SETS) => listPresets(stored, 'matt').find((p) => p.id === 'implement')!;
  const mattImplement = BUILTIN_SETS.find((x) => x.id === 'matt')!.presets.find((x) => x.id === 'implement')!;
  const p = buildPrompt(task(), pick(EMPTY_SETS), CLI, DIR, []);
  const { fillPreset } = await import('../src/panel/prompt.ts');
  assert.ok(p.includes(fillPreset(mattImplement.text.trim(), task(), TB, DIR)));
  assert.ok(p.includes(`(\`${TB} show .scratch/board/issues/03-drag.md\` reads it)`));
  assert.ok(p.includes('Run /implement'));
  assert.ok(p.includes(`${TB} state .scratch/board/issues/03-drag.md <state>`), 'the CLI line stays');
  assert.ok(!p.includes(implement.text));
  const edited = buildPrompt(task(), pick(setPresetText(EMPTY_SETS, 'matt', 'implement', 'My way.')), CLI, DIR, []);
  assert.ok(edited.endsWith('## Instructions (Implement)\nMy way.'));
});

test('prompt: {cli}, {root}, {id} and {note} are filled in; skills texts reach the root tracker through the CLI', async () => {
  const { listPresets, EMPTY_SETS } = await import('../src/panel/presets.ts');
  const { KNOWN_SKILLS } = await import('../src/core/skills.ts');
  const paths = Object.fromEntries(KNOWN_SKILLS.map((n) => [n, `/home/u/.config/opencode/skills/${n}/SKILL.md`]));
  const presets = listPresets(EMPTY_SETS, 'matt', paths);
  const get = (id: string) => presets.find((p) => p.id === id)!;
  for (const preset of [...presets, ...listPresets(EMPTY_SETS, 'superpowers', paths).filter((p) => p.id !== 'triage')]) {
    const p = buildPrompt(task(), preset, CLI, DIR, []);
    assert.doesNotMatch(p, /\{(cli|root|id|note)\}/, preset.id);
    assert.ok(p.includes(`${DIR}/docs/agents/issue-tracker.md`), preset.id);
  }
  const orchestrate = buildPrompt(task({ kind: 'parent', id: '.scratch/board/spec.md' }), get('orchestrate'), CLI, DIR, []);
  assert.ok(orchestrate.includes(`${TB} create --title <title> --parent .scratch/board/spec.md --blocked-by`));
  assert.ok(buildPrompt(task(), get('plan'), CLI, DIR, []).includes(`${TB} create --title`));
  assert.ok(buildPrompt(task(), get('triage'), CLI, DIR, []).includes(`${TB} state .scratch/board/issues/03-drag.md <state>`));
  // {note}: the issue file at the root locally, gh issue comment on GitHub.
  assert.ok(buildPrompt(task(), get('triage'), CLI, DIR, []).includes(`${DIR}/.scratch/board/issues/03-drag.md`));
  const gh = buildPrompt(task({ id: '#42', url: 'https://github.com/o/r/issues/42' }), get('triage'), CLI, DIR, []);
  assert.ok(gh.includes('gh issue comment 42 --body-file -'));
  // The SKILL.md of every skill the preset uses, hidden dependencies included.
  const plan = buildPrompt(task(), get('plan'), CLI, DIR, []);
  for (const n of ['grill-with-docs', 'to-spec', 'to-tickets', 'grilling', 'domain-modeling']) assert.ok(plan.includes(`- ${n}: ${paths[n]}`), n);
  assert.ok(!plan.includes(paths['tdd']!));
  // Superpowers' Plan lists its two skills; plain texts list no skill files.
  const spPlan = buildPrompt(task(), listPresets(EMPTY_SETS, 'superpowers', paths).find((p) => p.id === 'plan')!, CLI, DIR, []);
  for (const n of ['brainstorming', 'writing-plans']) assert.ok(spPlan.includes(`- ${n}: ${paths[n]}`), n);
  assert.ok(spPlan.includes(`${TB} create --title <title> --state ready-for-agent --body-file -`));
  const plain = listPresets(EMPTY_SETS, 'plain', paths).find((p) => p.id === 'plan')!;
  assert.doesNotMatch(buildPrompt(task(), plain, CLI, DIR, []), /SKILL\.md/);
});

test("prompt: {root}, {tracker} and {note} are shell-quoted for a root with a space and a '", async () => {
  const { listPresets, EMPTY_SETS } = await import('../src/panel/presets.ts');
  const { fillPreset } = await import('../src/panel/prompt.ts');
  const root = "/home/u/Kamil's Projects/board";
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const t = task();
  assert.equal(fillPreset('cd {root}', t, TB, root), `cd ${q(root)}`);
  assert.equal(fillPreset('cat {tracker}', t, TB, `${root}/`), `cat ${q(`${root}/docs/agents/issue-tracker.md`)}`);
  assert.equal(
    fillPreset('{note}', t, TB, root),
    `append it to the issue file \`${q(`${root}/.scratch/board/issues/03-drag.md`)}\``,
  );
  // A plain root stays bare.
  assert.equal(fillPreset('{root} {tracker}', t, TB, DIR), `${DIR} ${DIR}/docs/agents/issue-tracker.md`);
  const presets = [...listPresets(EMPTY_SETS, 'matt'), ...listPresets(EMPTY_SETS, 'superpowers').filter((p) => p.id !== 'triage')];
  for (const preset of presets) {
    const p = buildPrompt(t, preset, CLI, root, []);
    assert.doesNotMatch(p, /\{(cli|root|id|note|tracker)\}/, preset.id);
    assert.ok(p.includes(q(`${root}/docs/agents/issue-tracker.md`)), preset.id);
    assert.ok(!p.includes(`${root}/docs`), `${preset.id}: unquoted root`);
  }
});

test('prompt: a task outside the primary source gets the tracker of its own source', () => {
  // Local primary, the task is a GitHub issue: new tasks for it go to GitHub, not to .scratch/.
  const gh = buildPrompt(task({ id: '#42', url: 'https://github.com/o/r/issues/42' }), implement, CLI, DIR, [], 'local');
  assert.match(gh, /GitHub issue/);
  assert.ok(gh.includes(`${TB} create --source github --title <title>`), gh);
  assert.match(gh, /primary source is local/);
  assert.match(gh, /parent's source/);
  assert.ok(gh.indexOf('--source github') < gh.indexOf(implement.text));

  // GitHub primary, the task is a local file: new tasks go to local.
  const local = buildPrompt(task(), implement, CLI, DIR, [], 'github');
  assert.match(local, /local issue file/);
  assert.ok(local.includes(`${TB} create --source local --title <title>`), local);
  assert.match(local, /primary source is github/);
});

test('prompt: a task in the primary source (or with no primary known) has no source note', () => {
  for (const p of [buildPrompt(task(), implement, CLI, DIR, [], 'local'), buildPrompt(task(), implement, CLI, DIR, [])]) {
    assert.ok(!p.includes('--source'));
    assert.ok(!p.includes('primary source'));
  }
});
