// Which of the known skills (Matt Pocock's and Superpowers', core/skills.ts) are installed:
// `<root>/<name>/SKILL.md` in the user's skill folders (OpenCode, Claude, agents), the project's,
// then OpenCode's plugin cache (`~/.cache/opencode/npm/*/*/node_modules/superpowers/skills`, where the
// Superpowers plugin keeps its skills). Read-only; never reads ~/.config/openchamber. Kept in memory
// for a few minutes per project directory, so opening the board does not walk the disk each time.
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { KNOWN_SKILLS } from '../core/skills.ts';

export const SKILLS_TTL_MS = 5 * 60 * 1000;

/** The skill folders searched, user folders first. */
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

const isDir = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

const dirs = async (path: string): Promise<string[]> => {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
};

/**
 * The glob `<home>/.cache/opencode/npm/<plugin>/<version>/node_modules/superpowers/skills`, existing
 * folders only, in reverse name order (the version folders are timestamps: newest first).
 */
export const pluginSkillRoots = async (home: string): Promise<string[]> => {
  const npm = join(home, '.cache', 'opencode', 'npm');
  const candidates: string[] = [];
  for (const plugin of await dirs(npm))
    for (const version of await dirs(join(npm, plugin))) candidates.push(join(npm, plugin, version, 'node_modules', 'superpowers', 'skills'));
  const ok = await Promise.all(candidates.map(isDir));
  return candidates.filter((_, i) => ok[i]).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
};

export type FoundSkill = { name: string; path: string };

/**
 * The names of `names` that have a SKILL.md file in any root, in the order of `names`, each with
 * the SKILL.md of the first root that has it: skillRoots order, then the plugin cache.
 */
export const detectSkills = async (home: string, project: string, names: readonly string[] = KNOWN_SKILLS): Promise<FoundSkill[]> => {
  const roots = [...skillRoots(home, project), ...(await pluginSkillRoots(home))];
  const hits = await Promise.all(
    names.map(async (name) => {
      const files = roots.map((r) => join(r, name, 'SKILL.md'));
      const ok = await Promise.all(files.map(isFile));
      return files.find((_, i) => ok[i]);
    }),
  );
  return names.flatMap((name, i) => (hits[i] === undefined ? [] : [{ name, path: hits[i] }]));
};

/** `found` in KNOWN_SKILLS order; `paths` gives each found skill's SKILL.md (the prompt names it as a fallback). */
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
