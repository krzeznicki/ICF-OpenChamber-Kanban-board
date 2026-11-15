import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KNOWN_SKILLS, MATT_SKILLS, SUPERPOWERS_SKILLS } from '../src/core/skills.ts';
import { createSkillDetector, detectSkills, pluginSkillRoots, SKILLS_TTL_MS, skillRoots } from '../src/service/skills.ts';
import { handle } from '../src/service/routes.ts';

type T = { after: (fn: () => Promise<void>) => void };

const tmp = async (t: T, prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};

/** `<root>/<name>/SKILL.md`, with a body so it is a real file. */
const skill = async (root: string, name: string): Promise<void> => {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
};

const noExec = async () => {
  throw new Error('exec must not be called');
};

test('MATT_SKILLS lists every skill a preset may name', () => {
  assert.deepEqual(
    [...MATT_SKILLS],
    ['grill-with-docs', 'grilling', 'domain-modeling', 'to-spec', 'to-tickets', 'prototype', 'implement', 'implement-spec', 'tdd', 'code-review', 'diagnosing-bugs', 'triage'],
  );
});

test('SUPERPOWERS_SKILLS lists the Superpowers skills a preset may name; KNOWN_SKILLS is both lists', () => {
  assert.deepEqual(
    [...SUPERPOWERS_SKILLS],
    ['brainstorming', 'writing-plans', 'test-driven-development', 'verification-before-completion', 'requesting-code-review', 'subagent-driven-development', 'systematic-debugging'],
  );
  assert.deepEqual([...KNOWN_SKILLS], [...MATT_SKILLS, ...SUPERPOWERS_SKILLS]);
});

test("pluginSkillRoots: OpenCode's plugin cache, ~/.cache/opencode/npm/*/*/node_modules/superpowers/skills, newest first", async (t) => {
  const home = await tmp(t, 'icf-home-');
  assert.deepEqual(await pluginSkillRoots(home), [], 'no cache at all');
  const npm = join(home, '.cache/opencode/npm');
  await mkdir(join(npm, 'git-superpowers-aaa/100/node_modules/superpowers/skills'), { recursive: true });
  await mkdir(join(npm, 'git-superpowers-aaa/200/node_modules/superpowers/skills'), { recursive: true });
  await mkdir(join(npm, 'other-plugin/1/node_modules/other/skills'), { recursive: true });
  await writeFile(join(npm, 'stray-file'), '');
  assert.deepEqual(await pluginSkillRoots(home), [
    join(npm, 'git-superpowers-aaa/200/node_modules/superpowers/skills'),
    join(npm, 'git-superpowers-aaa/100/node_modules/superpowers/skills'),
  ]);
});

test('detectSkills finds Superpowers skills in the plugin cache, after the skill folders', async (t) => {
  const home = await tmp(t, 'icf-home-');
  const project = await tmp(t, 'icf-proj-');
  const cache = join(home, '.cache/opencode/npm/git-superpowers-x/1794601882804/node_modules/superpowers/skills');
  await skill(cache, 'brainstorming');
  await skill(cache, 'writing-plans');
  await skill(join(home, '.claude/skills'), 'writing-plans');
  await skill(join(home, '.claude/skills'), 'tdd');
  const found = await detectSkills(home, project);
  assert.deepEqual(found, [
    { name: 'tdd', path: join(home, '.claude/skills/tdd/SKILL.md') },
    { name: 'brainstorming', path: join(cache, 'brainstorming/SKILL.md') },
    { name: 'writing-plans', path: join(home, '.claude/skills/writing-plans/SKILL.md') },
  ]);
});

test('skillRoots: the three user folders and the two project folders, never ~/.config/openchamber', () => {
  const roots = skillRoots('/home/u', '/work/p');
  assert.deepEqual(roots, [
    '/home/u/.config/opencode/skills',
    '/home/u/.claude/skills',
    '/home/u/.agents/skills',
    '/work/p/.opencode/skills',
    '/work/p/.claude/skills',
  ]);
  assert.ok(roots.every((r) => !r.includes('openchamber')));
});

test('detectSkills finds a skill in any root, only with a SKILL.md, in MATT_SKILLS order', async (t) => {
  const home = await tmp(t, 'icf-home-');
  const project = await tmp(t, 'icf-proj-');
  await skill(join(home, '.config/opencode/skills'), 'tdd');
  await skill(join(home, '.claude/skills'), 'implement');
  await skill(join(home, '.agents/skills'), 'triage');
  await skill(join(project, '.opencode/skills'), 'code-review');
  await skill(join(project, '.claude/skills'), 'grill-with-docs');
  // A folder without SKILL.md, a SKILL.md that is a folder, and an unrelated skill do not count.
  await mkdir(join(home, '.config/opencode/skills/to-spec'), { recursive: true });
  await mkdir(join(home, '.config/opencode/skills/to-tickets/SKILL.md'), { recursive: true });
  await skill(join(home, '.config/opencode/skills'), 'not-matt');
  // ~/.config/openchamber is never read.
  await skill(join(home, '.config/openchamber/skills'), 'prototype');
  const found = await detectSkills(home, project);
  assert.deepEqual(found.map((f) => f.name), ['grill-with-docs', 'implement', 'tdd', 'code-review', 'triage']);
  // Each with the SKILL.md it was found at.
  assert.equal(found.find((f) => f.name === 'implement')?.path, join(home, '.claude/skills/implement/SKILL.md'));
  assert.equal(found.find((f) => f.name === 'code-review')?.path, join(project, '.opencode/skills/code-review/SKILL.md'));
});

test('detectSkills with no skill folders at all finds nothing', async (t) => {
  const home = await tmp(t, 'icf-home-');
  const project = await tmp(t, 'icf-proj-');
  assert.deepEqual(await detectSkills(home, project), []);
});

test('a skill in several roots is reported once, with the first root in skillRoots order', async (t) => {
  const home = await tmp(t, 'icf-home-');
  const project = await tmp(t, 'icf-proj-');
  await skill(join(project, '.claude/skills'), 'tdd');
  await skill(join(home, '.agents/skills'), 'tdd');
  assert.deepEqual(await detectSkills(home, project), [{ name: 'tdd', path: join(home, '.agents/skills/tdd/SKILL.md') }]);
});

test('the detector caches per directory for SKILLS_TTL_MS', async (t) => {
  const home = await tmp(t, 'icf-home-');
  const a = await tmp(t, 'icf-a-');
  const b = await tmp(t, 'icf-b-');
  let now = 1000;
  const detect = createSkillDetector(home, () => now);
  const tdd = { found: ['tdd'], paths: { tdd: join(home, '.claude/skills/tdd/SKILL.md') } };
  assert.deepEqual(await detect(a), { found: [], paths: {} });
  await skill(join(home, '.claude/skills'), 'tdd');
  assert.deepEqual(await detect(a), { found: [], paths: {} }, 'cached');
  assert.deepEqual(await detect(b), tdd, 'another directory is its own entry');
  now += SKILLS_TTL_MS;
  assert.deepEqual(await detect(a), tdd, 'expired');
  assert.ok(SKILLS_TTL_MS >= 60_000 && SKILLS_TTL_MS <= 10 * 60_000);
});

test('POST /skills/detect answers { found } for the project, with the injected detector', async (t) => {
  const home = await tmp(t, 'icf-home-');
  const directory = await tmp(t, 'icf-proj-');
  await skill(join(home, '.config/opencode/skills'), 'prototype');
  await skill(join(directory, '.claude/skills'), 'triage');
  const r = await handle('POST', '/skills/detect', { directory }, { exec: noExec, skills: createSkillDetector(home) });
  assert.deepEqual(r, {
    status: 200,
    json: {
      found: ['prototype', 'triage'],
      paths: { prototype: join(home, '.config/opencode/skills/prototype/SKILL.md'), triage: join(directory, '.claude/skills/triage/SKILL.md') },
    },
  });
  const bad = await handle('POST', '/skills/detect', { directory: 'relative' }, { exec: noExec, skills: createSkillDetector(home) });
  assert.equal(bad.status, 400);
});
