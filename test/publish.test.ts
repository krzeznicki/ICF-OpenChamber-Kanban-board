// Publish a local task to GitHub (ticket 07): a real local source in a temp dir plus GitHub on the fake gh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withAdditionalSources } from '../src/core/config.ts';
import { createLocalTracker } from '../src/core/localTracker.ts';
import { openTracker } from '../src/core/openTracker.ts';
import { publishTask } from '../src/core/publish.ts';
import { TEMPLATES } from '../src/core/templates/index.ts';
import { TrackerError } from '../src/core/types.ts';
import { fakeGh, type FakeGhOptions } from './fakeGh.ts';

type T = { after: (fn: () => Promise<void>) => void };

const project = async (t: T, primary: 'local' | 'github', additional: ('local' | 'github')[]): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'icf-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'docs/agents'), { recursive: true });
  await writeFile(join(root, 'docs/agents/issue-tracker.md'), withAdditionalSources(TEMPLATES[primary], additional));
  return root;
};

/** A local feature with two tickets (the second blocked by the first) and a GitHub source with issue #1. */
const setup = async (t: T, options?: FakeGhOptions) => {
  const root = await project(t, 'local', ['github']);
  const local = createLocalTracker(root);
  const spec = await local.create({ title: 'Login page', body: 'Users log in with email.', type: 'enhancement', state: 'ready-for-human' });
  const first = await local.create({ title: 'Form', body: 'The form.', parentId: spec.id, state: 'ready-for-agent', type: 'enhancement' });
  const second = await local.create({ title: 'Errors', body: 'Show errors.', parentId: spec.id, blockedBy: [first.id] });
  const gh = fakeGh([{ number: 1, title: 'Existing' }], { labels: ['ready-for-agent', 'ready-for-human', 'needs-triage', 'enhancement'], ...options });
  return { root, gh, spec, first, second, tracker: await openTracker(root, gh.exec) };
};

const rejectsWith = async (p: Promise<unknown>, code: string, message?: RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof TrackerError, String(e));
    assert.equal(e.code, code, e.message);
    if (message) assert.match(e.message, message);
    return true;
  });

test('publishing a local feature creates the issue and its tickets as sub-issues, with state, type and description', async (t) => {
  const { root, gh, spec, first, second, tracker } = await setup(t);
  const result = await publishTask(root, tracker, spec.id);

  assert.equal(result.issue.id, '#2');
  assert.equal(result.issue.source, 'github');
  assert.deepEqual(result.subIssues.map((x) => [x.from, x.task.id]), [[first.id, '#3'], [second.id, '#4']]);

  const issue = gh.issues.find((i) => i.number === 2)!;
  assert.equal(issue.title, 'Login page');
  assert.equal(issue.body, 'Users log in with email.');
  assert.deepEqual(issue.labels.sort(), ['enhancement', 'ready-for-human']);
  const form = gh.issues.find((i) => i.number === 3)!;
  assert.equal(form.title, 'Form');
  assert.equal(form.body, 'The form.');
  assert.equal(form.parent, 2);
  assert.deepEqual(form.labels.sort(), ['enhancement', 'ready-for-agent']);
  const errors = gh.issues.find((i) => i.number === 4)!;
  assert.equal(errors.parent, 2);
  assert.deepEqual(errors.blockedBy, [3], 'a blocker inside the published feature points at its new issue');
  assert.deepEqual(errors.labels, ['needs-triage']);
});

test('after publishing, the local files are done with a comment linking their issue', async (t) => {
  const { root, spec, first, second, tracker } = await setup(t);
  const result = await publishTask(root, tracker, spec.id);

  assert.deepEqual(result.closed.map((x) => [x.id, x.state]).sort(), [[spec.id, 'done'], [first.id, 'done'], [second.id, 'done']].sort());
  for (const [id, n] of [[spec.id, 2], [first.id, 3], [second.id, 4]] as const) {
    const text = await readFile(join(root, id), 'utf8');
    assert.match(text, /Status:\*\* resolved/, id);
    assert.match(text, new RegExp(`## Comments\\n\\nPublished to GitHub: https://github\\.com/o/r/issues/${n}\\n?$`), id);
  }
});

test('a done ticket becomes a closed sub-issue', async (t) => {
  const { root, gh, spec, first, tracker } = await setup(t);
  await tracker.setState(first.id, 'done');
  await publishTask(root, tracker, spec.id);
  assert.equal(gh.issues.find((i) => i.number === 3)!.state, 'CLOSED');
});

test('publishing a single ticket creates one issue without a parent or local blockers', async (t) => {
  const { root, gh, spec, second, tracker } = await setup(t);
  const result = await publishTask(root, tracker, second.id);
  assert.equal(result.issue.id, '#2');
  assert.deepEqual(result.subIssues, []);
  const issue = gh.issues.find((i) => i.number === 2)!;
  assert.equal(issue.parent, null);
  assert.deepEqual(issue.blockedBy, []);
  assert.equal((await tracker.get(second.id)).state, 'done');
  assert.notEqual((await tracker.get(spec.id)).state, 'done', 'the local parent stays open');
});

test('a feature folder without spec.md publishes with an empty description', async (t) => {
  const root = await project(t, 'local', ['github']);
  await mkdir(join(root, '.scratch/bare'), { recursive: true });
  const gh = fakeGh([]);
  const tracker = await openTracker(root, gh.exec);
  const result = await publishTask(root, tracker, '.scratch/bare/spec.md');
  assert.equal(gh.issues[0]!.title, 'bare');
  assert.equal(gh.issues[0]!.body, '');
  assert.match(await readFile(join(root, '.scratch/bare/spec.md'), 'utf8'), /Published to GitHub: https:\/\/github\.com\/o\/r\/issues\/1/);
  assert.equal(result.closed[0]!.state, 'done');
});

test('only a local task can be published, and only when the project has a GitHub source', async (t) => {
  const { root, gh, tracker } = await setup(t);
  const before = gh.commands().length;
  await rejectsWith(publishTask(root, tracker, '#1'), 'INVALID', /local/i);
  assert.equal(gh.commands().length, before, 'nothing created');

  const onlyLocal = await project(t, 'local', []);
  const spec = await createLocalTracker(onlyLocal).create({ title: 'Alone' });
  await rejectsWith(publishTask(onlyLocal, await openTracker(onlyLocal, gh.exec), spec.id), 'INVALID', /GitHub source/);
});

test('a logged-out gh fails before anything is created and leaves the local task open', async (t) => {
  const { root, gh, spec, tracker } = await setup(t, { authed: false });
  await rejectsWith(publishTask(root, tracker, spec.id), 'GH_AUTH');
  assert.equal(gh.issues.length, 1);
  assert.notEqual((await tracker.get(spec.id)).state, 'done');
});

test('a done task whose new issue cannot be closed still reports the issue as created', async (t) => {
  // The feature becomes #2, its tickets #3 (Form) and #4 (Errors, done: created open, then closed).
  const { root, gh, spec, second, tracker } = await setup(t, { failClose: (n) => n === 4 });
  await tracker.setState(second.id, 'done');
  await assert.rejects(publishTask(root, tracker, spec.id), (e: unknown) => {
    assert.ok(e instanceof TrackerError, String(e));
    assert.equal(e.code, 'FAILED');
    assert.match(e.message, /#4 \(Errors\)/);
    return true;
  });
  assert.equal(gh.issues.find((i) => i.number === 4)?.title, 'Errors');
  assert.doesNotMatch(await readFile(join(root, second.id), 'utf8'), /Published to GitHub/);
});

test('a link comment that cannot be written leaves that file open and says so; the files before it are closed with their link', async (t) => {
  const { root, spec, first, second, tracker } = await setup(t);
  await chmod(join(root, second.id), 0o444);
  await assert.rejects(publishTask(root, tracker, spec.id), (e: unknown) => {
    assert.ok(e instanceof TrackerError, String(e));
    assert.equal(e.code, 'FAILED');
    assert.match(e.message, /Published to GitHub as #2 \(Login page\), #3 \(Form\), #4 \(Errors\)/);
    assert.match(e.message, new RegExp(`link comment could not be written to ${second.id.replace(/\./g, '\\.')}`));
    assert.doesNotMatch(e.message, /could not be closed/);
    return true;
  });
  for (const id of [spec.id, first.id]) {
    assert.equal((await tracker.get(id)).state, 'done', id);
    assert.match(await readFile(join(root, id), 'utf8'), /Published to GitHub/, id);
  }
  assert.notEqual((await tracker.get(second.id)).state, 'done', 'not closed without its link');
});

test('a partial failure says what was created and leaves every local file open', async (t) => {
  const { root, gh, spec, first, second, tracker } = await setup(t, { failCreate: (title) => title === 'Errors' });
  await assert.rejects(publishTask(root, tracker, spec.id), (e: unknown) => {
    assert.ok(e instanceof TrackerError, String(e));
    assert.equal(e.code, 'FAILED');
    assert.match(e.message, /#2 \(Login page\)/);
    assert.match(e.message, /#3 \(Form\)/);
    assert.match(e.message, /Errors/);
    assert.match(e.message, /left open/);
    return true;
  });
  assert.deepEqual(gh.issues.map((i) => i.number), [1, 2, 3]);
  for (const id of [spec.id, first.id, second.id]) {
    assert.notEqual((await tracker.get(id)).state, 'done', id);
    assert.doesNotMatch(await readFile(join(root, id), 'utf8'), /Published to GitHub/, id);
  }
});

test('a done local task (for example one already published) is not published again', async (t) => {
  const { root, gh, spec, tracker } = await setup(t);
  await publishTask(root, tracker, spec.id);
  const issues = gh.issues.length;
  await rejectsWith(publishTask(root, tracker, spec.id), 'INVALID', /done/i);
  assert.equal(gh.issues.length, issues, 'no duplicate issues');
});
