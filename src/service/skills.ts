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

export type FoundSkill = { name: string; path: string };

/**
 * The names of `names` that have a SKILL.md file in any root, in the order of `names`, each with
 * the SKILL.md of the first root (skillRoots order) that has it.
 */
export const detectSkills = async (home: string, project: string, names: readonly string[] = MATT_SKILLS): Promise<FoundSkill[]> => {
  const roots = skillRoots(home, project);
  const hits = await Promise.all(
    names.map(async (name) => {
      const files = roots.map((r) => join(r, name, 'SKILL.md'));
      const ok = await Promise.all(files.map(isFile));
      return files.find((_, i) => ok[i]);
    }),
  );
  return names.flatMap((name, i) => (hits[i] === undefined ? [] : [{ name, path: hits[i] }]));
};

/** `found` in MATT_SKILLS order; `paths` gives each found skill's SKILL.md (the prompt names it as a fallback). */
export type SkillsResult = { found: string[]; paths: Record<string, string> };

/** A cached detectSkills per project directory. `home` defaults to the user's home folder. */
export const createSkillDetector = (home: string = homedir(), now: () => number = Date.now) => {
  const cache = new Map<string, { at: number; found: FoundSkill[] }>();
  const result = (found: FoundSkill[]): SkillsResult => ({
    found: found.map((f) => f.name),
    paths: Object.fromEntries(found.map((f) => [f.name, f.path])),
  });
  return async (directory: string): Promise<SkillsResult> => {
    const hit = cache.get(directory);
    if (hit !== undefined && now() - hit.at < SKILLS_TTL_MS) return result(hit.found);
    const found = await detectSkills(home, directory);
    cache.set(directory, { at: now(), found });
    return result(found);
  };
};

export type SkillDetector = ReturnType<typeof createSkillDetector>;
