import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, withAdditionalSources, writeConfig } from '../src/core/config.ts';
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
  assert.deepEqual(await readConfig(root), { tracker: 'local', primary: 'local', sources: ['local'], labels: DEFAULT_LABELS });
});

test('github fixture is detected as github', async (t) => {
  const root = await repo(t, { 'issue-tracker.md': await fixture('issue-tracker-github.md') });
  assert.deepEqual(await readConfig(root), { tracker: 'github', primary: 'github', sources: ['github'], labels: DEFAULT_LABELS });
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
  assert.equal((await readConfig(root)).tracker, 'local');
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
  assert.deepEqual(await readConfig(root), { tracker: 'local', primary: 'local', sources: ['local'], labels: DEFAULT_LABELS });

  const gh = await repo(t);
  await writeConfig(gh, 'github');
  assert.equal(await readFile(join(gh, 'docs/agents/issue-tracker.md'), 'utf8'), await fixture('issue-tracker-github.md'));
  assert.equal(existsSync(join(gh, 'docs/agents/triage-labels.md')), false, 'triage-labels.md must not be created');
  assert.equal((await readConfig(gh)).tracker, 'github');
});

test('writeConfig twice leaves the first file untouched', async (t) => {
  const root = await repo(t);
  await writeConfig(root, 'local');
  await writeConfig(root, 'github');
  assert.equal(await readFile(join(root, 'docs/agents/issue-tracker.md'), 'utf8'), await fixture('issue-tracker-local.md'));
  assert.equal((await readConfig(root)).tracker, 'local');
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
  assert.equal(config.tracker, 'local');
  assert.deepEqual(config.sources, ['local', 'github']);
});

test('the primary source listed again under Additional sources counts once', async (t) => {
  const text = `${TEMPLATES.github}\n## Additional sources\n\n- \`github\`\n- \`local\`\n`;
  const root = await repo(t, { 'issue-tracker.md': text });
  assert.deepEqual((await readConfig(root)).sources, ['github', 'local']);
});

test('an unknown additional source is UNSUPPORTED and named', async (t) => {
  const text = `${TEMPLATES.local}\n## Additional sources\n\n- \`jira\`: Jira.\n`;
  const root = await repo(t, { 'issue-tracker.md': text });
  await rejectsWith(readConfig(root), 'UNSUPPORTED', /jira/);
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
