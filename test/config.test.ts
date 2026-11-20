import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changeSources, readConfig, withAdditionalSources, writeConfig } from '../src/core/config.ts';
import { openTracker } from '../src/core/openTracker.ts';
import { TEMPLATES } from '../src/core/templates/index.ts';
import type { Exec } from '../src/core/types.ts';
import { TrackerError } from '../src/core/types.ts';
import { fakeGh } from './fakeGh.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/config/', import.meta.url));
const TEMPLATE_DIR = fileURLToPath(new URL('../src/core/templates/', import.meta.url));
const fixture = (name: string): Promise<string> => readFile(join(FIXTURES, name), 'utf8');

const DEFAULT_LABELS = {
  'needs-triage': 'needs-triage',
  'needs-info': 'needs-info',
  'ready-for-agent': 'ready-for-agent',
  'ready-for-human': 'ready-for-human',
  wontfix: 'wontfix',
};

const noExec: Exec = async () => {
  throw new Error('exec must not be called');
};

const repo = async (
  t: { after: (fn: () => Promise<void>) => void },
  files: Record<string, string> = {},
): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'icf-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(root, 'docs/agents'), { recursive: true });
    await writeFile(join(root, 'docs/agents', name), text);
  }
  return root;
};

const rejectsWith = async (p: Promise<unknown>, code: string, msg?: RegExp): Promise<void> => {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof TrackerError, `expected TrackerError, got ${String(e)}`);
    assert.equal(e.code, code);
    if (msg) assert.match(e.message, msg);
    return true;
  });
};

test('embedded templates are byte-identical to the .md copies and to Matt\'s seed fixtures', async () => {
  const pairs = [
    [TEMPLATES.local, 'issue-tracker-local.md'],
    [TEMPLATES.github, 'issue-tracker-github.md'],
    [TEMPLATES.triageLabels, 'triage-labels.md'],
  ] as const;
  for (const [text, name] of pairs) {
    assert.equal(text, await readFile(join(TEMPLATE_DIR, name), 'utf8'), `src/core/templates/${name}`);
    assert.equal(text, await fixture(name), `test/fixtures/config/${name}`);
  }
});

test('local fixture is detected as local with default labels', async (t) => {
  const root = await repo(t, {
    'issue-tracker.md': await fixture('issue-tracker-local.md'),
    'triage-labels.md': await fixture('triage-labels.md'),
  });
  assert.deepEqual(await readConfig(root), { primary: 'local', sources: ['local'], labels: DEFAULT_LABELS, warnings: [] });
});

test('github fixture is detected as github', async (t) => {
  const root = await repo(t, { 'issue-tracker.md': await fixture('issue-tracker-github.md') });
  assert.deepEqual(await readConfig(root), { primary: 'github', sources: ['github'], labels: DEFAULT_LABELS, warnings: [] });
});

test('gitlab fixture is UNSUPPORTED and names the heading', async (t) => {
  const root = await repo(t, { 'issue-tracker.md': await fixture('issue-tracker-gitlab.md') });
  await rejectsWith(readConfig(root), 'UNSUPPORTED', /Issue tracker: GitLab/);
});

test('file without a heading is UNSUPPORTED', async (t) => {
  const root = await repo(t, { 'issue-tracker.md': 'Issues live somewhere.\n' });
  await rejectsWith(readConfig(root), 'UNSUPPORTED');
});

test('first heading decides, even after leading blank lines', async (t) => {
  const root = await repo(t, {
    'issue-tracker.md': '\n\n# Issue tracker: Local Markdown\n\n## GitHub mirror\n',
  });
  assert.equal((await readConfig(root)).primary, 'local');
});

test('missing issue-tracker.md is NOT_CONFIGURED', async (t) => {
  const root = await repo(t);
  await rejectsWith(readConfig(root), 'NOT_CONFIGURED');
  await rejectsWith(openTracker(root, noExec), 'NOT_CONFIGURED');
});

test('missing triage-labels.md falls back to role names', async (t) => {
  const root = await repo(t, { 'issue-tracker.md': await fixture('issue-tracker-local.md') });
  assert.deepEqual((await readConfig(root)).labels, DEFAULT_LABELS);
});

test('custom label table overrides roles; unknown roles ignored; missing roles default', async (t) => {
  const triage = [
    '# Triage Labels',
    '',
    '| Label in mattpocock/skills | Label in our tracker | Meaning |',
    '| --- | --- | --- |',
    '| `needs-triage` | `triage: new` | x |',
    '|`ready-for-agent`|  `afk`  | y |',
    '| ready-for-human | human | z |',
    '| `bug` | `kind: bug` | not a state role |',
    '| `wontfix` | | empty label keeps the default |',
    '',
  ].join('\n');
  const root = await repo(t, {
    'issue-tracker.md': await fixture('issue-tracker-local.md'),
    'triage-labels.md': triage,
  });
  assert.deepEqual((await readConfig(root)).labels, {
    'needs-triage': 'triage: new',
    'needs-info': 'needs-info',
    'ready-for-agent': 'afk',
    'ready-for-human': 'human',
    wontfix: 'wontfix',
  });
});

test('writeConfig writes Matt\'s templates for a fresh repo', async (t) => {
  const root = await repo(t);
  await writeConfig(root, 'local');
  assert.equal(await readFile(join(root, 'docs/agents/issue-tracker.md'), 'utf8'), await fixture('issue-tracker-local.md'));
  assert.equal(existsSync(join(root, 'docs/agents/triage-labels.md')), false, 'triage-labels.md must not be created');
  assert.deepEqual(await readConfig(root), { primary: 'local', sources: ['local'], labels: DEFAULT_LABELS, warnings: [] });

  const gh = await repo(t);
  await writeConfig(gh, 'github');
  assert.equal(await readFile(join(gh, 'docs/agents/issue-tracker.md'), 'utf8'), await fixture('issue-tracker-github.md'));
  assert.equal(existsSync(join(gh, 'docs/agents/triage-labels.md')), false, 'triage-labels.md must not be created');
  assert.equal((await readConfig(gh)).primary, 'github');
});

test('writeConfig twice leaves the first file untouched', async (t) => {
  const root = await repo(t);
  await writeConfig(root, 'local');
  await writeConfig(root, 'github');
  assert.equal(await readFile(join(root, 'docs/agents/issue-tracker.md'), 'utf8'), await fixture('issue-tracker-local.md'));
  assert.equal((await readConfig(root)).primary, 'local');
});

test('writeConfig never overwrites existing user files', async (t) => {
  const root = await repo(t, { 'issue-tracker.md': '# Custom\n', 'triage-labels.md': 'mine\n' });
  await writeConfig(root, 'local');
  assert.equal(await readFile(join(root, 'docs/agents/issue-tracker.md'), 'utf8'), '# Custom\n');
  assert.equal(await readFile(join(root, 'docs/agents/triage-labels.md'), 'utf8'), 'mine\n');
});

test('writeConfig rejects an unknown tracker kind', async (t) => {
  const root = await repo(t);
  await rejectsWith(writeConfig(root, 'gitlab' as never), 'INVALID');
  assert.equal(existsSync(join(root, 'docs/agents/issue-tracker.md')), false);
});

test('openTracker returns a working local tracker', async (t) => {
  const root = await repo(t, { 'issue-tracker.md': await fixture('issue-tracker-local.md') });
  const tracker = await openTracker(root, noExec);
  assert.deepEqual(await tracker.list(), []);
});

test('openTracker for github returns the GitHub tracker, using the triage labels', async (t) => {
  const root = await repo(t, {
    'issue-tracker.md': await fixture('issue-tracker-github.md'),
    'triage-labels.md': '| `ready-for-agent` | `afk` | x |\n',
  });
  const gh = fakeGh([{ number: 5, title: 'A', labels: ['afk'] }]);
  const tracker = await openTracker(root, gh.exec);
  assert.deepEqual((await tracker.list()).map((x) => [x.id, x.state]), [['#5', 'ready-for-agent']]);
  assert.ok(gh.calls.every((c) => c[0] === 'gh'));
});

test('openTracker for gitlab is UNSUPPORTED', async (t) => {
  const root = await repo(t, { 'issue-tracker.md': await fixture('issue-tracker-gitlab.md') });
  await rejectsWith(openTracker(root, noExec), 'UNSUPPORTED');
});

test('an Additional sources section adds sources after the primary one', async (t) => {
  const text = `${TEMPLATES.local}\n## Additional sources\n\n- \`github\`: GitHub Issues of this repository.\n`;
  const root = await repo(t, { 'issue-tracker.md': text });
  const config = await readConfig(root);
  assert.equal(config.primary, 'local');
  assert.deepEqual(config.sources, ['local', 'github']);
});

test('the primary source listed again under Additional sources counts once', async (t) => {
  const text = `${TEMPLATES.github}\n## Additional sources\n\n- \`github\`\n- \`local\`\n`;
  const root = await repo(t, { 'issue-tracker.md': text });
  assert.deepEqual((await readConfig(root)).sources, ['github', 'local']);
});

test('an unknown additional source is skipped and named in the warnings; the known ones still count', async (t) => {
  const text = `${TEMPLATES.local}\n## Additional sources\n\n- \`jira\`: Jira.\n- \`github\`\n`;
  const root = await repo(t, { 'issue-tracker.md': text });
  const config = await readConfig(root);
  assert.deepEqual(config.sources, ['local', 'github']);
  assert.equal(config.warnings.length, 1);
  assert.match(config.warnings[0]!, /jira/);
});

test('hand-written notes under Additional sources are not sources and give no warning', async (t) => {
  const text = `${TEMPLATES.local}\n## Additional sources\n\n- \`github\`\n- Ask Ola before closing GitHub issues.\n* note: the bot labels issues\n`;
  const root = await repo(t, { 'issue-tracker.md': text });
  const config = await readConfig(root);
  assert.deepEqual(config.sources, ['local', 'github']);
  assert.deepEqual(config.warnings, []);
});

test('a project without unknown sources has no warnings', async (t) => {
  const root = await repo(t, { 'issue-tracker.md': withAdditionalSources(TEMPLATES.local, ['github']) });
  assert.deepEqual((await readConfig(root)).warnings, []);
});

test('rewriting the Additional sources keeps hand-written lines in it, also an unknown source', () => {
  const text = `${withAdditionalSources(TEMPLATES.local, ['github'])}\nOur GitHub board is triaged on Mondays.\n- \`jira\`: later\n`;
  const again = withAdditionalSources(text, ['github']);
  assert.match(again, /Our GitHub board is triaged on Mondays\./);
  assert.match(again, /- `jira`: later/);
  assert.equal(withAdditionalSources(again, ['github']), again, 'stable on a second rewrite');
  const removed = withAdditionalSources(text, []);
  assert.match(removed, /## Additional sources/, 'the section stays while it holds hand-written text');
  assert.match(removed, /triaged on Mondays/);
  assert.doesNotMatch(removed, /--source github/);
});

test('withAdditionalSources writes a section readConfig reads back, and [] removes it', async (t) => {
  const text = withAdditionalSources(TEMPLATES.local, ['github']);
  assert.ok(text.startsWith(TEMPLATES.local), 'the primary template stays as it is');
  assert.match(text, /^## Additional sources$/m);
  assert.match(text, /task-board create --source github/);
  const root = await repo(t, { 'issue-tracker.md': text });
  assert.deepEqual((await readConfig(root)).sources, ['local', 'github']);
  // Rewriting replaces the section instead of adding a second one.
  assert.equal(withAdditionalSources(text, ['github']), text);
  assert.equal(withAdditionalSources(text, []), TEMPLATES.local);
});

test('withAdditionalSources keeps sections written after it by hand', () => {
  const text = `${withAdditionalSources(TEMPLATES.github, ['local'])}\n## Notes\n\nMine.\n`;
  const again = withAdditionalSources(text, []);
  assert.match(again, /## Notes\n\nMine\.\n$/);
  assert.doesNotMatch(again, /Additional sources/);
});

test('the Additional sources section tells agents how to publish in each source and the linking rules', () => {
  const text = withAdditionalSources(TEMPLATES.github, ['local']);
  const section = text.slice(text.indexOf('## Additional sources'));
  assert.match(section, /a new task goes there unless you name another source/);
  assert.match(section, /^- `local`: .*`task-board create --source local --title <title>/m);
  assert.match(section, /`\.scratch\/`/);
  assert.match(section, /--parent.*parent's source/);
  assert.match(section, /never linked/);
  assert.match(section, /list.*next.*--source/);
});

// --- Changing the sources (Settings → Sources and `task-board init --add/--remove/--primary`) ---

const trackerFile = (root: string): Promise<string> => readFile(join(root, 'docs/agents/issue-tracker.md'), 'utf8');

test('adding github to a local project writes the Additional sources section; removing it takes it out', async (t) => {
  const root = await repo(t, { 'issue-tracker.md': TEMPLATES.local });
  const added = await changeSources(root, { add: 'github' });
  assert.deepEqual(added.sources, ['local', 'github']);
  assert.equal(await trackerFile(root), withAdditionalSources(TEMPLATES.local, ['github']));
  // Adding it again changes nothing.
  await changeSources(root, { add: 'github' });
  assert.equal(await trackerFile(root), withAdditionalSources(TEMPLATES.local, ['github']));

  const removed = await changeSources(root, { remove: 'github' });
  assert.deepEqual(removed.sources, ['local']);
  assert.equal(await trackerFile(root), TEMPLATES.local);
});

test('the primary source cannot be removed, and an unknown source is INVALID', async (t) => {
  const root = await repo(t, { 'issue-tracker.md': withAdditionalSources(TEMPLATES.local, ['github']) });
  await rejectsWith(changeSources(root, { remove: 'local' }), 'INVALID', /primary/);
  await rejectsWith(changeSources(root, { add: 'jira' as never }), 'INVALID', /jira/);
  assert.equal(await trackerFile(root), withAdditionalSources(TEMPLATES.local, ['github']));
});

test('a new primary source rewrites the file: its template plus the others under Additional sources', async (t) => {
  const root = await repo(t, { 'issue-tracker.md': withAdditionalSources(TEMPLATES.local, ['github']) });
  const config = await changeSources(root, { primary: 'github' });
  assert.equal(config.primary, 'github');
  assert.deepEqual(config.sources, ['github', 'local']);
  assert.equal(await trackerFile(root), withAdditionalSources(TEMPLATES.github, ['local']));
  // And back: the same file as a local project that added github.
  await changeSources(root, { primary: 'local' });
  assert.equal(await trackerFile(root), withAdditionalSources(TEMPLATES.local, ['github']));
});

test('a primary source that was not a source yet is added; the old primary stays as an additional one', async (t) => {
  const root = await repo(t, { 'issue-tracker.md': TEMPLATES.local });
  const config = await changeSources(root, { primary: 'github' });
  assert.deepEqual(config.sources, ['github', 'local']);
});

test('text added by hand after the template and other sections survive a primary change', async (t) => {
  const text = `${TEMPLATES.local}\n## Our notes\n\nKeep PRs small.\n\n## Additional sources\n\n- \`github\`\n\n## Later\n\nMine too.\n`;
  const root = await repo(t, { 'issue-tracker.md': text });
  await changeSources(root, { primary: 'github' });
  const out = await trackerFile(root);
  assert.ok(out.startsWith(TEMPLATES.github), out);
  assert.match(out, /## Our notes\n\nKeep PRs small\./);
  assert.match(out, /## Later\n\nMine too\./);
  assert.doesNotMatch(out, /Local Markdown/);
  assert.deepEqual((await readConfig(root)).sources, ['github', 'local']);
});

test('a primary template edited by hand is not replaced without force; with force it is', async (t) => {
  const edited = TEMPLATES.local.replace('one file per ticket', 'one file per ticket (we number from 10)');
  const root = await repo(t, { 'issue-tracker.md': edited });
  await rejectsWith(changeSources(root, { primary: 'github' }), 'INVALID', /edited by hand.*force/s);
  assert.equal(await trackerFile(root), edited, 'nothing written');
  // Adding and removing keep the template as it is, so they need no force.
  await changeSources(root, { add: 'github' });
  assert.ok((await trackerFile(root)).startsWith(edited));

  const config = await changeSources(root, { primary: 'github' }, { force: true });
  assert.equal(config.primary, 'github');
  assert.equal(await trackerFile(root), withAdditionalSources(TEMPLATES.github, ['local']));
});

test('with force an edited template is replaced, but sections added after it are kept, and the warning says so', async (t) => {
  const edited = TEMPLATES.local.replace('one file per ticket', 'one file per ticket (we number from 10)');
  const text = `${edited}\n## Our notes\n\nKeep PRs small.\n\n## Additional sources\n\n- \`github\`\nTriaged on Mondays.\n`;
  const root = await repo(t, { 'issue-tracker.md': text });
  await rejectsWith(changeSources(root, { primary: 'github' }), 'INVALID', /local template.*sections added after it are kept/s);
  await changeSources(root, { primary: 'github' }, { force: true });
  const out = await trackerFile(root);
  assert.ok(out.startsWith(TEMPLATES.github), out);
  assert.doesNotMatch(out, /we number from 10/);
  assert.match(out, /## Our notes\n\nKeep PRs small\./);
  assert.match(out, /Triaged on Mondays\./);
  assert.deepEqual((await readConfig(root)).sources, ['github', 'local']);
});

test('changing the sources of an unconfigured project is NOT_CONFIGURED', async (t) => {
  const root = await repo(t);
  await rejectsWith(changeSources(root, { add: 'github' }), 'NOT_CONFIGURED');
});
