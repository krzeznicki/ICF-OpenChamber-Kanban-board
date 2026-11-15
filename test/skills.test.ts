import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MATT_SKILLS } from '../src/core/skills.ts';
import { createSkillDetector, detectSkills, SKILLS_TTL_MS, skillRoots } from '../src/service/skills.ts';
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
    ['grill-with-docs', 'to-spec', 'to-tickets', 'prototype', 'handoff', 'implement', 'implement-spec', 'tdd', 'code-review', 'diagnosing-bugs', 'triage'],
  );
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
  assert.deepEqual(await detectSkills(home, project), ['grill-with-docs', 'implement', 'tdd', 'code-review', 'triage']);
});

test('detectSkills with no skill folders at all finds nothing', async (t) => {
  const home = await tmp(t, 'icf-home-');
  const project = await tmp(t, 'icf-proj-');
  assert.deepEqual(await detectSkills(home, project), []);
});

test('the detector caches per directory for SKILLS_TTL_MS', async (t) => {
  const home = await tmp(t, 'icf-home-');
  const a = await tmp(t, 'icf-a-');
  const b = await tmp(t, 'icf-b-');
  let now = 1000;
  const detect = createSkillDetector(home, () => now);
  assert.deepEqual(await detect(a), { found: [] });
  await skill(join(home, '.claude/skills'), 'tdd');
  assert.deepEqual(await detect(a), { found: [] }, 'cached');
  assert.deepEqual(await detect(b), { found: ['tdd'] }, 'another directory is its own entry');
  now += SKILLS_TTL_MS;
  assert.deepEqual(await detect(a), { found: ['tdd'] }, 'expired');
  assert.ok(SKILLS_TTL_MS >= 60_000 && SKILLS_TTL_MS <= 10 * 60_000);
});

test('POST /skills/detect answers { found } for the project, with the injected detector', async (t) => {
  const home = await tmp(t, 'icf-home-');
  const directory = await tmp(t, 'icf-proj-');
  await skill(join(home, '.config/opencode/skills'), 'prototype');
  await skill(join(directory, '.claude/skills'), 'handoff');
  const r = await handle('POST', '/skills/detect', { directory }, { exec: noExec, skills: createSkillDetector(home) });
  assert.deepEqual(r, { status: 200, json: { found: ['prototype', 'handoff'] } });
  const bad = await handle('POST', '/skills/detect', { directory: 'relative' }, { exec: noExec, skills: createSkillDetector(home) });
  assert.equal(bad.status, 400);
});
