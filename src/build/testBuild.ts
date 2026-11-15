// Pure parts of `npm run build:test` (scripts/build-test.mjs): turning the production package
// into the local test build "Kanban TEST" (id icf-kanban-test), and the guard that keeps the
// output-folder wipe from ever removing a folder this script did not write.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';

export const TEST_ID = 'icf-kanban-test';
export const TEST_NAME = 'Kanban TEST';
export const TEST_ICON = 'assets/kanban-test.svg';
/** Written into every output folder; its presence is what allows the next build to wipe it. */
export const MARKER = '.kanban-test-build';

type Json = Record<string, unknown>;

const obj = (v: unknown, what: string): Json => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`build:test: package.json has no ${what}`);
  return v as Json;
};

/**
 * The test build's package.json: own id, name, icon and a prerelease version (`<v>-test.g<sha>`), plus
 * `kanbanBuild.variant`. Development-only fields (scripts, devDependencies) are dropped.
 * The input is not modified.
 */
export const testManifest = (pkg: Json, sha: string): Json => {
  const out = structuredClone(pkg);
  if (typeof out.version !== 'string' || out.version === '') throw new Error('build:test: package.json has no version');
  if (!/^[0-9a-f]{4,40}$/.test(sha)) throw new Error(`build:test: "${sha}" is not a git sha`);
  out.name = TEST_ID;
  // `g` keeps the prerelease identifier alphanumeric: an all-digit sha with a leading 0 is not valid semver.
  out.version = `${out.version}-test.g${sha}`;
  if (typeof out.description === 'string') out.description = `${TEST_NAME} (local development build). ${out.description}`;
  delete out.scripts;
  delete out.devDependencies;
  const contributes = obj(obj(out.openchamber, 'openchamber').contributes, 'openchamber.contributes');
  const panel = obj(contributes.panel, 'contributes.panel');
  panel.id = TEST_ID;
  panel.name = TEST_NAME;
  panel.icon = TEST_ICON;
  if (contributes.page !== undefined) obj(contributes.page, 'contributes.page').title = TEST_NAME;
  out.kanbanBuild = { variant: 'test' };
  return out;
};

const SKILL_PREFIX = 'icf-kanban-';
const TEST_SKILL_PREFIX = 'kanban-test-';
const DESCRIPTION_PREFIX = 'Kanban TEST (development build) — only when the user asks for the TEST board.';

/**
 * One SKILL.md of the test build: folder and `name` become kanban-test-<x>, the description
 * starts with the TEST notice, mentions of the sibling skills point at their test names, and the
 * CLI fallback names the Kanban TEST extension folder.
 */
export const testSkill = (folder: string, text: string): { folder: string; text: string } => {
  if (!folder.startsWith(SKILL_PREFIX)) throw new Error(`build:test: skill folder "${folder}" does not start with ${SKILL_PREFIX}`);
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!front) throw new Error(`build:test: ${folder}/SKILL.md has no frontmatter`);
  const lines = front[1]!.split('\n');
  const nameAt = lines.findIndex((l) => l.startsWith('name:'));
  const descAt = lines.findIndex((l) => l.startsWith('description:'));
  if (nameAt < 0 || lines[nameAt]!.slice(5).trim() !== folder) throw new Error(`build:test: ${folder}/SKILL.md name does not match its folder`);
  if (descAt < 0) throw new Error(`build:test: ${folder}/SKILL.md has no description`);
  const renamed = `${TEST_SKILL_PREFIX}${folder.slice(SKILL_PREFIX.length)}`;
  const siblings = (t: string): string => t.replace(/\bicf-kanban-(create|next|start|status)\b/g, `${TEST_SKILL_PREFIX}$1`);
  lines[nameAt] = `name: ${renamed}`;
  lines[descAt] = `description: ${DESCRIPTION_PREFIX} ${siblings(lines[descAt]!.slice('description:'.length).trim())}`;
  const body = siblings(text.slice(front[0].length)).replaceAll('ICF-kanban extension folder', 'Kanban TEST extension folder');
  return { folder: renamed, text: `---\n${lines.join('\n')}\n---\n${body}` };
};

/**
 * The board icon with a "T" badge in the bottom-right corner: the board is cut away under the
 * badge, the badge is a filled circle with the T cut out, so it reads in any currentColor.
 */
export const testIcon = (svg: string): string => {
  const open = /^<svg\b[^>]*>/.exec(svg.trim());
  const close = svg.trim().lastIndexOf('</svg>');
  if (!open || close < 0) throw new Error('build:test: the icon is not an <svg> element');
  const inner = svg.trim().slice(open[0].length, close);
  return (
    open[0] +
    '<defs>' +
    '<mask id="kt-cut"><rect width="24" height="24" fill="#fff"/><circle cx="18" cy="18" r="6.4" fill="#000"/></mask>' +
    '<mask id="kt-t"><rect width="24" height="24" fill="#fff"/><path d="M15.3 15.6h5.4M18 15.6v5" stroke="#000" stroke-width="1.6" stroke-linecap="round" fill="none"/></mask>' +
    '</defs>' +
    `<g mask="url(#kt-cut)">${inner}</g>` +
    '<circle cx="18" cy="18" r="5.4" fill="currentColor" stroke="none" mask="url(#kt-t)"/>' +
    '</svg>\n'
  );
};

/**
 * The output folder: --out, else $KANBAN_TEST_OUT (empty counts as unset), else
 * ~/openchamber-extensions/icf-kanban-test. A leading `~/` (or a lone `~`) is the home folder.
 */
export const resolveOutDir = (argOut: string | undefined, envOut: string | undefined, home: string): string => {
  const given = [argOut, envOut].find((v) => v !== undefined && v.trim() !== '');
  if (given === undefined) return join(home, 'openchamber-extensions', TEST_ID);
  const expanded = given === '~' ? home : given.startsWith('~/') ? join(home, given.slice(2)) : given;
  return resolve(expanded);
};

const inside = (child: string, parent: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/**
 * Whether `out` may be used, without touching it: missing, empty, or marked by a previous
 * build:test. Throws for a folder with someone else's files, a file, or a path overlapping the repo.
 */
export const checkOutDir = (out: string, repoRoot: string): 'missing' | 'empty' | 'marked' => {
  const dir = resolve(out);
  if (inside(dir, resolve(repoRoot)) || inside(resolve(repoRoot), dir)) {
    throw new Error(`build:test: refusing to write to ${dir}: it overlaps the repository ${repoRoot}; choose a folder outside it`);
  }
  if (!existsSync(dir)) return 'missing';
  if (!statSync(dir).isDirectory()) throw new Error(`build:test: ${dir} exists and is not a folder`);
  const entries = readdirSync(dir);
  if (entries.length === 0) return 'empty';
  if (!entries.includes(MARKER)) {
    throw new Error(`build:test: refusing to wipe ${dir}: it has files but no ${MARKER} (it was not written by build:test)`);
  }
  return 'marked';
};

/**
 * Makes `out` an empty folder ready for the build (see checkOutDir for what is refused). The
 * folder itself is kept, so an installed extension keeps watching the same path.
 */
export const prepareOutDir = (out: string, repoRoot: string): void => {
  const dir = resolve(out);
  const state = checkOutDir(dir, repoRoot);
  if (state === 'missing') mkdirSync(dir, { recursive: true });
  if (state === 'marked') for (const name of readdirSync(dir)) rmSync(join(dir, name), { recursive: true, force: true });
};

/** Marks a finished output folder as written by build:test. */
export const writeMarker = (out: string, info: { version: string; branch: string; sha: string }): void => {
  writeFileSync(join(out, MARKER), `${JSON.stringify({ ...info, note: 'Written by npm run build:test; the next build wipes this folder.' }, null, 2)}\n`);
};
