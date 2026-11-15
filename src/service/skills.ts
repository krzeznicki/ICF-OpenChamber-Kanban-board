// Which of Matt Pocock's skills are installed: `<root>/<name>/SKILL.md` in the user's skill folders
// (OpenCode, Claude, agents) or the project's. Read-only; never reads ~/.config/openchamber. Kept in
// memory for a few minutes per project directory, so opening the board does not walk the disk each time.
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MATT_SKILLS } from '../core/skills.ts';

export const SKILLS_TTL_MS = 5 * 60 * 1000;

/** The folders searched, user folders first. */
export const skillRoots = (home: string, project: string): string[] => [
  join(home, '.config', 'opencode', 'skills'),
  join(home, '.claude', 'skills'),
  join(home, '.agents', 'skills'),
  join(project, '.opencode', 'skills'),
  join(project, '.claude', 'skills'),
];

const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

/** The names of `names` that have a SKILL.md file in any root, in the order of `names`. */
export const detectSkills = async (home: string, project: string, names: readonly string[] = MATT_SKILLS): Promise<string[]> => {
  const roots = skillRoots(home, project);
  const found = await Promise.all(names.map(async (name) => (await Promise.all(roots.map((r) => isFile(join(r, name, 'SKILL.md'))))).some(Boolean)));
  return names.filter((_, i) => found[i]);
};

export type SkillsResult = { found: string[] };

/** A cached detectSkills per project directory. `home` defaults to the user's home folder. */
export const createSkillDetector = (home: string = homedir(), now: () => number = Date.now) => {
  const cache = new Map<string, { at: number; found: string[] }>();
  return async (directory: string): Promise<SkillsResult> => {
    const hit = cache.get(directory);
    if (hit !== undefined && now() - hit.at < SKILLS_TTL_MS) return { found: [...hit.found] };
    const found = await detectSkills(home, directory);
    cache.set(directory, { at: now(), found });
    return { found: [...found] };
  };
};

export type SkillDetector = ReturnType<typeof createSkillDetector>;
