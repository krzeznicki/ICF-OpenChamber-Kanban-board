// npm run build:test [-- --out <dir>]: builds the local test extension "Kanban TEST" (id
// icf-kanban-test) from the checked-out branch into a folder outside the repo, by default
// ~/openchamber-extensions/icf-kanban-test (or $KANBAN_TEST_OUT). Install that folder once in
// OpenChamber; every rebuild rewrites it and the installed extension reloads. Production (the
// committed bundles, id icf-kanban, ~/.icf-kanban) is never touched.
// The bundles are built with --variant test into a temporary folder first, so a failed build
// leaves the installed test build as it was.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { TEST_ICON, checkOutDir, prepareOutDir, testIcon, testManifest, testSkill, writeMarker } from '../src/build/testBuild.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: { out: { type: 'string' } } });
const out = resolve(args.out ?? process.env.KANBAN_TEST_OUT ?? join(homedir(), 'openchamber-extensions', 'icf-kanban-test'));

// Refuse a bad output folder before spending time on the build.
checkOutDir(out, root);

const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
const sha = git('rev-parse', '--short', 'HEAD');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const dirty = git('status', '--porcelain').length > 0;

const stage = mkdtempSync(join(tmpdir(), 'icf-kanban-test-build-'));
try {
  execFileSync(process.execPath, [join(root, 'scripts/build.mjs'), '--variant', 'test', '--out', stage], { stdio: 'inherit' });

  // Runtime files only: no sources, tests, docs or node_modules (the bundles are self-contained).
  for (const file of ['LICENSE', 'THIRD_PARTY_LICENSES', 'README.md']) cpSync(join(root, file), join(stage, file));
  cpSync(join(root, 'assets'), join(stage, 'assets'), { recursive: true });
  for (const file of readdirSync(join(root, 'panel'))) {
    if (file !== 'main.js') cpSync(join(root, 'panel', file), join(stage, 'panel', file), { recursive: true });
  }
  writeFileSync(join(stage, TEST_ICON), testIcon(readFileSync(join(root, 'assets/kanban.svg'), 'utf8')));

  const pkg = testManifest(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), sha);
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

  for (const folder of readdirSync(join(root, 'skills'))) {
    const skill = testSkill(folder, readFileSync(join(root, 'skills', folder, 'SKILL.md'), 'utf8'));
    mkdirSync(join(stage, 'skills', skill.folder), { recursive: true });
    writeFileSync(join(stage, 'skills', skill.folder, 'SKILL.md'), skill.text);
  }

  // Swap in: empty the output folder (only one build:test wrote) and copy the finished build.
  // The marker goes first, so a copy that fails half-way still leaves a folder the next build may wipe.
  prepareOutDir(out, root);
  writeMarker(out, { version: String(pkg.version), branch, sha: dirty ? `${sha} (uncommitted changes)` : sha });
  cpSync(stage, out, { recursive: true });
} finally {
  rmSync(stage, { recursive: true, force: true });
}

console.log(`\nKanban TEST ${branch}@${sha}${dirty ? ' (uncommitted changes included)' : ''} -> ${out}`);
console.log(`Install once: Settings → Extensions → add folder ${out}`);
console.log(`  or open openchamber://extensions/install?path=${encodeURIComponent(out)}`);
