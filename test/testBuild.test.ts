import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifestJson } from '@openchamber/sdk/schemas';
import { MARKER, checkOutDir, prepareOutDir, resolveOutDir, testIcon, testManifest, testSkill, writeMarker } from '../src/build/testBuild.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, any>;

test('testManifest: own id, name, icon, prerelease version and variant; input untouched', () => {
  const before = JSON.stringify(pkg);
  const out = testManifest(pkg, 'abc1234') as Record<string, any>;
  assert.equal(JSON.stringify(pkg), before);
  assert.equal(out.name, 'icf-kanban-test');
  assert.equal(out.version, `${pkg.version}-test.gabc1234`);
  assert.equal(out.openchamber.contributes.panel.id, 'icf-kanban-test');
  assert.equal(out.openchamber.contributes.panel.name, 'Kanban TEST');
  assert.equal(out.openchamber.contributes.panel.icon, 'assets/kanban-test.svg');
  assert.equal(out.openchamber.contributes.page.title, 'Kanban TEST');
  assert.deepEqual(out.kanbanBuild, { variant: 'test' });
  assert.equal(out.scripts, undefined);
  assert.equal(out.devDependencies, undefined);
  // Everything else the host reads is the same as production.
  for (const key of ['capabilities', 'service', 'sessionControl', 'sessionEvents', 'instructions', 'skills']) {
    assert.deepEqual(out.openchamber.contributes[key], pkg.openchamber.contributes[key], key);
  }
  assert.equal(out.openchamber.contributes.panel.entry, pkg.openchamber.contributes.panel.entry);
});

test('testManifest output is a valid OpenChamber manifest', () => {
  const parsed = parseManifestJson(JSON.stringify(testManifest(pkg, 'abc1234')));
  assert.ok(parsed.ok, JSON.stringify(parsed));
});

test('testManifest rejects a bad sha or a manifest without a panel', () => {
  assert.throws(() => testManifest(pkg, 'not-a-sha'), /not a git sha/);
  assert.throws(() => testManifest({ version: '1.0.0', openchamber: { contributes: {} } }, 'abc1234'), /contributes\.panel/);
});

const SKILL = `---
name: icf-kanban-start
description: Start work on a task. Use after icf-kanban-next picked one.
---

# Start

Run icf-kanban-status first; the folder icf-kanban-extension stays.
Fallback: \`node <ICF-kanban extension folder>/build/cli/task-board.mjs\`.
`;

test('testSkill: renames folder and name, prefixes the description, points sibling skills at test names', () => {
  const { folder, text } = testSkill('icf-kanban-start', SKILL);
  assert.equal(folder, 'kanban-test-start');
  assert.equal(
    text,
    `---
name: kanban-test-start
description: Kanban TEST (development build) — only when the user asks for the TEST board. Start work on a task. Use after kanban-test-next picked one.
---

# Start

Run kanban-test-status first; the folder icf-kanban-extension stays.
Fallback: \`node <Kanban TEST extension folder>/build/cli/task-board.mjs\`.
`,
  );
});

test('testSkill rejects a mismatched name, missing frontmatter or a foreign folder', () => {
  assert.throws(() => testSkill('icf-kanban-next', SKILL), /does not match/);
  assert.throws(() => testSkill('icf-kanban-start', '# no frontmatter\n'), /no frontmatter/);
  assert.throws(() => testSkill('other', SKILL), /does not start with/);
});

test('testSkill works on every real skill and keeps the frontmatter single-line', () => {
  for (const folder of readdirSync(join(root, 'skills'))) {
    const { folder: renamed, text } = testSkill(folder, readFileSync(join(root, 'skills', folder, 'SKILL.md'), 'utf8'));
    assert.match(renamed, /^kanban-test-(create|next|start|status)$/);
    assert.ok(text.startsWith(`---\nname: ${renamed}\ndescription: Kanban TEST (development build)`), renamed);
    assert.doesNotMatch(text, /icf-kanban-(create|next|start|status)/, renamed);
    assert.doesNotMatch(text, /ICF-kanban extension folder/, renamed);
    assert.match(text, /<Kanban TEST extension folder>\/build\/cli\/task-board\.mjs/, renamed);
  }
});

test('testIcon keeps the board and adds a masked T badge', () => {
  const svg = readFileSync(join(root, 'assets/kanban.svg'), 'utf8');
  const out = testIcon(svg);
  assert.ok(out.startsWith(svg.slice(0, svg.indexOf('>') + 1)));
  assert.ok(out.includes('<rect x="2.5" y="3" width="19" height="18" rx="2"/>'));
  assert.match(out, /<g mask="url\(#kt-cut\)">/);
  assert.match(out, /<circle cx="18" cy="18" r="5.4" fill="currentColor" stroke="none" mask="url\(#kt-t\)"\/><\/svg>\n$/);
  assert.throws(() => testIcon('<png/>'), /not an <svg>/);
});

const tmp = (): string => mkdtempSync(join(tmpdir(), 'kanban-test-guard-'));

test('prepareOutDir: creates a missing folder and accepts an empty one', () => {
  const base = tmp();
  const missing = join(base, 'a', 'b');
  prepareOutDir(missing, '/nonexistent/repo');
  assert.ok(existsSync(missing));
  prepareOutDir(missing, '/nonexistent/repo');
  assert.deepEqual(readdirSync(missing), []);
});

test('prepareOutDir: refuses a folder with files and no marker, and leaves it alone', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'precious.txt'), 'keep');
  assert.throws(() => prepareOutDir(dir, '/nonexistent/repo'), /refusing to wipe .* no \.kanban-test-build/);
  assert.deepEqual(readdirSync(dir), ['precious.txt']);
});

test('prepareOutDir: empties a folder a previous build marked, keeping the folder itself', () => {
  const dir = tmp();
  writeMarker(dir, { version: '0.3.0-test.abc1234', branch: 'feat/x', sha: 'abc1234' });
  mkdirSync(join(dir, 'panel'));
  writeFileSync(join(dir, 'panel', 'main.js'), 'old');
  writeFileSync(join(dir, '.hidden'), 'old');
  assert.ok(JSON.parse(readFileSync(join(dir, MARKER), 'utf8')).sha === 'abc1234');
  prepareOutDir(dir, '/nonexistent/repo');
  assert.ok(existsSync(dir));
  assert.deepEqual(readdirSync(dir), []);
});

test('prepareOutDir: refuses a folder inside the repository or one containing it', () => {
  assert.throws(() => prepareOutDir(join(root, 'out-test'), root), /overlaps the repository/);
  assert.throws(() => prepareOutDir(root, root), /overlaps the repository/);
  assert.throws(() => prepareOutDir(join(root, '..'), root), /overlaps the repository/);
  assert.ok(!existsSync(join(root, 'out-test')));
});

test('prepareOutDir: refuses a path that is a file', () => {
  const file = join(tmp(), 'f');
  writeFileSync(file, 'x');
  assert.throws(() => prepareOutDir(file, '/nonexistent/repo'), /not a folder/);
});

test('checkOutDir reports missing, empty or marked without changing anything', () => {
  const dir = tmp();
  assert.equal(checkOutDir(join(dir, 'nope'), '/nonexistent/repo'), 'missing');
  assert.ok(!existsSync(join(dir, 'nope')));
  assert.equal(checkOutDir(dir, '/nonexistent/repo'), 'empty');
  writeMarker(dir, { version: 'v', branch: 'b', sha: 'abc1234' });
  writeFileSync(join(dir, 'x'), 'x');
  assert.equal(checkOutDir(dir, '/nonexistent/repo'), 'marked');
  assert.deepEqual(readdirSync(dir).sort(), [MARKER, 'x']);
});

test('testManifest: an all-digit sha with a leading zero still gives a valid semver prerelease', () => {
  const out = testManifest(pkg, '0123456') as Record<string, any>;
  assert.equal(out.version, `${pkg.version}-test.g0123456`);
  assert.match(out.version, /^\d+\.\d+\.\d+-test\.g[0-9a-f]+$/);
  assert.ok(parseManifestJson(JSON.stringify(out)).ok);
});

test('resolveOutDir: --out, then KANBAN_TEST_OUT (empty is unset), then the default; ~/ is the home folder', () => {
  const home = '/Users/u';
  assert.equal(resolveOutDir(undefined, undefined, home), '/Users/u/openchamber-extensions/icf-kanban-test');
  assert.equal(resolveOutDir(undefined, '', home), '/Users/u/openchamber-extensions/icf-kanban-test');
  assert.equal(resolveOutDir(undefined, '  ', home), '/Users/u/openchamber-extensions/icf-kanban-test');
  assert.equal(resolveOutDir(undefined, '~/x/kt', home), '/Users/u/x/kt');
  assert.equal(resolveOutDir('~/a', '/env/b', home), '/Users/u/a');
  assert.equal(resolveOutDir('/abs/a', '/env/b', home), '/abs/a');
  assert.equal(resolveOutDir(undefined, '/env/b', home), '/env/b');
  assert.equal(resolveOutDir(undefined, '~', home), '/Users/u');
  assert.equal(resolveOutDir(undefined, '~other/x', home), resolve('~other/x'));
});
