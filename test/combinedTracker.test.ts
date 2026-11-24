// The combined tracker over several sources (ADR 0001): a real local source in a temp dir plus
// GitHub on the fake gh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withAdditionalSources } from '../src/core/config.ts';
import { createLocalTracker } from '../src/core/localTracker.ts';
import { openTracker } from '../src/core/openTracker.ts';
import { createCombinedTracker, createGithubSource, createLocalSource, type SourceAdapter } from '../src/core/sources.ts';
import { TEMPLATES } from '../src/core/templates/index.ts';
import type { Exec } from '../src/core/types.ts';
import { TrackerError } from '../src/core/types.ts';
import { fakeGh, type FakeGhOptions, type FakeIssue } from './fakeGh.ts';

type T = { after: (fn: () => Promise<void>) => void };

const noExec: Exec = async () => {
  throw new Error('exec must not be called');
};

const project = async (t: T, primary: 'local' | 'github', additional: ('local' | 'github')[]): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'icf-combined-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'docs/agents'), { recursive: true });
  await writeFile(join(root, 'docs/agents/issue-tracker.md'), withAdditionalSources(TEMPLATES[primary], additional));
  return root;
};

/** Local primary with one feature and its ticket, plus GitHub with issues #5 and #6 (#6 under #5). */
const both = async (t: T, issues?: FakeIssue[], options?: FakeGhOptions) => {
  const root = await project(t, 'local', ['github']);
  const local = createLocalTracker(root);
  const spec = await local.create({ title: 'Private feature' });
  const ticket = await local.create({ title: 'Private ticket', parentId: spec.id, state: 'ready-for-agent' });
  const gh = fakeGh(issues ?? [{ number: 5, title: 'Public epic' }, { number: 6, title: 'Public ticket', parent: 5 }], options);
  return { root, gh, spec, ticket, tracker: await openTracker(root, gh.exec) };
};

const rejectsWith = async (p: Promise<unknown>, code: string, message?: RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof TrackerError, String(e));
    assert.equal(e.code, code, e.message);
    if (message) assert.match(e.message, message);
    return true;
  });

test('list shows the tasks of every source, each marked with its source', async (t) => {
  const { tracker, spec, ticket } = await both(t);
  const tasks = (await tracker.list()).map((x) => [x.id, x.source]).sort();
  assert.deepEqual(tasks, [['#5', 'github'], ['#6', 'github'], [spec.id, 'local'], [ticket.id, 'local']].sort());
});

test('a project with one source behaves as before; its tasks carry that source', async (t) => {
  const root = await project(t, 'local', []);
  const tracker = await openTracker(root, noExec);
  const created = await tracker.create({ title: 'Only local' });
  assert.equal(created.source, 'local');
  assert.deepEqual((await tracker.list()).map((x) => [x.id, x.source]), [[created.id, 'local']]);
  assert.deepEqual(tracker.sources.map((s) => s.id), ['local']);
});

test('every operation on an id goes to the source that owns it', async (t) => {
  const { root, tracker, gh, spec, ticket } = await both(t);

  assert.equal((await tracker.get('#6')).title, 'Public ticket');
  assert.equal((await tracker.get(ticket.id)).title, 'Private ticket');

  assert.equal((await tracker.setState('#6', 'ready-for-agent')).state, 'ready-for-agent');
  assert.ok(gh.calls.some((c) => c[1] === 'issue' && c[2] === 'edit' && c.includes('ready-for-agent')));
  assert.equal((await tracker.setState(ticket.id, 'needs-info')).state, 'needs-info');
  assert.match(await readFile(join(root, ticket.id), 'utf8'), /Status:\*\* needs-info/);

  assert.equal((await tracker.setType('#6', 'bug')).type, 'bug');
  assert.equal((await tracker.edit(ticket.id, { title: 'Renamed' })).title, 'Renamed');
  assert.equal((await tracker.claim('#6')).claimed, true);

  const other = await tracker.create({ title: 'Another feature' });
  const moved = await tracker.setParent(other.id, spec.id);
  assert.equal(moved.parentId, spec.id);
  assert.equal(moved.source, 'local');
  const unlinked = await tracker.removeParent('#6');
  assert.equal(unlinked.parentId, null);

  const closed = await tracker.close('#5', { withChildren: false });
  assert.deepEqual(closed.map((x) => [x.id, x.state, x.source]), [['#5', 'done', 'github']]);
  assert.deepEqual(await tracker.remove(moved.id, { withChildren: false }), [moved.id]);
});

test('an id no source owns is NOT_FOUND', async (t) => {
  const { tracker } = await both(t);
  await rejectsWith(tracker.get('jira:ENG-12'), 'NOT_FOUND', /jira:ENG-12/);
});

test('create without a source goes to the primary source', async (t) => {
  const { tracker, gh } = await both(t);
  const created = await tracker.create({ title: 'New' });
  assert.equal(created.source, 'local');
  assert.ok(!gh.calls.some((c) => c[2] === 'create'), 'nothing created on GitHub');

  const root = await project(t, 'github', ['local']);
  const gh2 = fakeGh([]);
  const onGithub = await (await openTracker(root, gh2.exec)).create({ title: 'Shared' });
  assert.equal(onGithub.source, 'github');
  assert.equal(onGithub.id, '#1');
});

test('a failing source does not hide the others: listAll returns its error beside their tasks', async (t) => {
  const { tracker, spec, ticket } = await both(t, [], { authed: false });
  const result = await tracker.listAll();
  assert.deepEqual(result.tasks.map((x) => x.id).sort(), [spec.id, ticket.id].sort());
  assert.equal(result.errors.length, 1);
  const [error] = result.errors;
  assert.equal(error!.source, 'github');
  assert.equal(error!.code, 'GH_AUTH');
  assert.equal(error!.availability, 'needs-login');
  assert.match(error!.message, /gh auth login/);
  assert.deepEqual((await tracker.list()).map((x) => x.id).sort(), [spec.id, ticket.id].sort());
});

test('a source that fails to list is asked for its availability: a lost login shows as needs-login', async (t) => {
  const root = await project(t, 'local', []);
  const local = createLocalSource(root);
  let asked = 0;
  const expired: SourceAdapter = {
    ...createGithubSource(root, noExec, { 'needs-triage': 'needs-triage', 'needs-info': 'needs-info', 'ready-for-agent': 'ready-for-agent', 'ready-for-human': 'ready-for-human', wontfix: 'wontfix' }),
    list: async () => {
      throw new TrackerError('FAILED', 'gh issue list failed: HTTP 401: Bad credentials');
    },
    availability: async () => {
      asked++;
      return { status: 'needs-login', message: 'gh is not logged in to GitHub: run `gh auth login`' };
    },
  };
  const result = await createCombinedTracker('local', [local, expired]).listAll();
  assert.equal(asked, 1);
  assert.equal(result.errors[0]!.availability, 'needs-login');
  assert.equal(result.errors[0]!.code, 'FAILED');
  assert.match(result.errors[0]!.message, /Bad credentials/);
});

test('a source that fails while still available stays unavailable', async (t) => {
  const root = await project(t, 'local', []);
  const offline: SourceAdapter = { ...createLocalSource(root), id: 'github', owns: () => false, list: async () => { throw new Error('could not resolve host'); } };
  const result = await createCombinedTracker('local', [createLocalSource(root), offline]).listAll();
  assert.equal(result.errors[0]!.availability, 'unavailable');
});

test('when every source fails, list throws as a single tracker did', async (t) => {
  const root = await project(t, 'github', []);
  const tracker = await openTracker(root, fakeGh([], { authed: false }).exec);
  await rejectsWith(tracker.list(), 'GH_AUTH');
  await rejectsWith(tracker.listAll(), 'GH_AUTH');
});

test('listAll({ source }) reads only that source', async (t) => {
  const { tracker, gh, spec, ticket } = await both(t);
  const local = await tracker.listAll({ source: 'local' });
  assert.deepEqual(local.tasks.map((x) => x.id).sort(), [spec.id, ticket.id].sort());
  assert.deepEqual(local.errors, []);
  assert.ok(!gh.calls.some((c) => c[0] === 'gh'), 'gh not called');
  const github = await tracker.listAll({ source: 'github' });
  assert.deepEqual(github.tasks.map((x) => x.id).sort(), ['#5', '#6']);
  await rejectsWith(tracker.listAll({ source: 'jira' as never }), 'INVALID', /jira/);
});

test('sources declare capabilities and availability', async (t) => {
  const { tracker } = await both(t, [], { authed: false });
  assert.equal(tracker.primary, 'local');
  const [local, github] = tracker.sources;
  assert.equal(local!.id, 'local');
  assert.equal(github!.id, 'github');
  for (const s of [local!, github!]) {
    assert.deepEqual(s.capabilities, { create: true, subtasks: true, blockedBy: true, claim: true, delete: true, ...(s.id === 'github' ? { labels: true } : {}) });
  }
  assert.deepEqual(await local!.availability(), { status: 'ok' });
  const gh = await github!.availability();
  assert.equal(gh.status, 'needs-login');
  assert.match((gh as { message: string }).message, /gh auth login/);

  const missing = await (await both(t, [], { version: null })).tracker.sources[1]!.availability();
  assert.equal(missing.status, 'unavailable');
});

test('create --source puts the task in that source; an unknown source is INVALID', async (t) => {
  const { tracker, gh } = await both(t);
  const shared = await tracker.create({ title: 'Shared', source: 'github' });
  assert.equal(shared.source, 'github');
  assert.equal(shared.id, '#7');
  assert.ok(gh.calls.some((c) => c[1] === 'issue' && c[2] === 'create'));
  assert.equal((await tracker.create({ title: 'Private', source: 'local' })).source, 'local');
  await rejectsWith(tracker.create({ title: 'X', source: 'jira' as never }), 'INVALID', /jira.*local or github/);
});

test('create with a parent goes to the parent\'s source; a different --source is INVALID', async (t) => {
  const { tracker, gh, spec } = await both(t);
  const sub = await tracker.create({ title: 'Public sub', parentId: '#5' });
  assert.equal(sub.source, 'github');
  assert.equal(sub.parentId, '#5');
  const local = await tracker.create({ title: 'Private sub', parentId: spec.id, source: 'local' });
  assert.equal(local.source, 'local');
  assert.equal(local.parentId, spec.id);

  const before = gh.calls.length;
  await rejectsWith(tracker.create({ title: 'X', parentId: spec.id, source: 'github' }), 'INVALID', /parent.*local/i);
  assert.equal(gh.calls.length, before, 'gh not called');
});

test('blockers and parents across sources are INVALID with a readable message', async (t) => {
  const { tracker, gh, spec, ticket } = await both(t);
  const before = gh.calls.length;
  await rejectsWith(
    tracker.create({ title: 'X', parentId: '#5', blockedBy: [ticket.id] }),
    'INVALID',
    /source/,
  );
  await rejectsWith(tracker.create({ title: 'Y', blockedBy: ['#6'] }), 'INVALID', /#6.*github/);
  await rejectsWith(tracker.setParent('#6', spec.id), 'INVALID', /different sources|another source/);
  await rejectsWith(tracker.setParent(ticket.id, '#5'), 'INVALID', /different sources|another source/);
  assert.equal(gh.calls.length, before, 'gh not called');
  assert.equal((await tracker.get(ticket.id)).parentId, spec.id);
});
