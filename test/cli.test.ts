import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { main } from '../src/cli/main.ts';
import type { CliIO } from '../src/cli/main.ts';
import { writeConfig } from '../src/core/config.ts';
import { createLocalTracker } from '../src/core/localTracker.ts';
import type { Exec, Task } from '../src/core/types.ts';

type Run = { code: number; out: string; err: string };
type T = { after: (fn: () => Promise<void>) => void };

const noExec: Exec = async () => {
  throw new Error('exec must not be called');
};

const run = async (argv: string[], cwd: string, stdin?: CliIO['stdin']): Promise<Run> => {
  let out = '';
  let err = '';
  const code = await main(argv, {
    stdout: (s) => void (out += s),
    stderr: (s) => void (err += s),
    stdin,
    cwd,
    exec: noExec,
  });
  return { code, out, err };
};

const tmp = async (t: T): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'icf-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};

/** Local project with one feature: 01 ready, 02 ready but blocked by 01, 03 ready and unblocked. */
const project = async (t: T): Promise<{ root: string; spec: string; ids: string[] }> => {
  const root = await tmp(t);
  await writeConfig(root, 'local');
  const tracker = createLocalTracker(root);
  const spec = (await tracker.create({ title: 'Feature', body: 'Spec.' })).id;
  const a = await tracker.create({ title: 'First', parentId: spec, state: 'needs-info' });
  const b = await tracker.create({ title: 'Second', parentId: spec, state: 'ready-for-agent', blockedBy: [a.id] });
  const c = await tracker.create({ title: 'Third', parentId: spec, state: 'ready-for-agent' });
  return { root, spec, ids: [a.id, b.id, c.id] };
};

const json = <V>(r: Run): V => JSON.parse(r.out) as V;

test('create then list --json shows the new task', async (t) => {
  const root = await tmp(t);
  await writeConfig(root, 'local');
  const parent = await run(['create', '--title', 'My feature', '--json'], root);
  assert.equal(parent.code, 0, parent.err);
  const spec = json<Task>(parent);
  assert.equal(spec.kind, 'parent');

  const child = await run(
    ['create', '--title', 'Do it', '--parent', spec.id, '--type', 'bug', '--state', 'ready-for-agent', '--body-file', '-', '--json'],
    root,
    () => 'What to build: it.\n\n- [ ] works\n',
  );
  assert.equal(child.code, 0, child.err);
  const ticket = json<Task>(child);
  assert.equal(ticket.title, 'Do it');
  assert.equal(ticket.type, 'bug');
  assert.equal(ticket.state, 'ready-for-agent');
  assert.match(ticket.body, /- \[ \] works/);

  const list = await run(['list', '--json'], root);
  assert.equal(list.code, 0);
  assert.deepEqual(json<Task[]>(list).map((x) => x.id), [spec.id, ticket.id]);
});

test('--dir points at another project and human output is one line per task', async (t) => {
  const { root, spec, ids } = await project(t);
  const elsewhere = await tmp(t);
  const r = await run(['list', '--dir', root], elsewhere);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.out.trimEnd().split('\n'), [
    `${spec}  [needs-triage]  Feature`,
    `${ids[0]}  [needs-info]  First`,
    `${ids[1]}  [ready-for-agent]  Second`,
    `${ids[2]}  [ready-for-agent]  Third`,
  ]);
});

test('body file is read relative to cwd and stdin may be a stream', async (t) => {
  const { root, spec } = await project(t);
  await writeFile(join(root, 'body.md'), 'From a file.\n');
  const fromFile = await run(['create', '--title', 'F', '--parent', spec, '--body-file', 'body.md', '--json'], root);
  assert.equal(fromFile.code, 0, fromFile.err);
  assert.match(json<Task>(fromFile).body, /From a file\./);
  const fromStream = await run(
    ['create', '--title', 'S', '--parent', spec, '--body-file', '-', '--json'],
    root,
    Readable.from(['From ', 'stdin.\n']),
  );
  assert.equal(fromStream.code, 0, fromStream.err);
  assert.match(json<Task>(fromStream).body, /From stdin\./);
});

test('next skips a ticket blocked by an open one', async (t) => {
  const { root, ids } = await project(t);
  const r = await run(['next', '--json'], root);
  assert.equal(r.code, 0, r.err);
  assert.equal(json<Task>(r).id, ids[2]);
  const human = await run(['next'], root);
  assert.equal(human.out, `${ids[2]}  Third\n`);
});

test('a blocker that is done no longer blocks; next exits 3 when nothing is ready', async (t) => {
  const { root, ids } = await project(t);
  assert.equal((await run(['state', ids[0]!, 'done'], root)).code, 0);
  assert.equal(json<Task>(await run(['next', '--json'], root)).id, ids[1]);
  assert.equal((await run(['state', ids[1]!, 'ready-for-human'], root)).code, 0);
  assert.equal((await run(['state', ids[2]!, 'wontfix'], root)).code, 0);
  const none = await run(['next'], root);
  assert.equal(none.code, 3);
  assert.equal(none.out, '');
  assert.match(none.err, /no ready/i);
});

test('state x done then list --ready omits it', async (t) => {
  const { root, ids } = await project(t);
  const before = await run(['list', '--ready', '--json'], root);
  assert.deepEqual(json<Task[]>(before).map((x) => x.id), [ids[2]]);
  const st = await run(['state', ids[2]!, 'done', '--json'], root);
  assert.equal(st.code, 0, st.err);
  assert.equal(json<Task>(st).state, 'done');
  const after = await run(['list', '--ready', '--json'], root);
  assert.deepEqual(json<Task[]>(after), []);
});

test('list --state filters by state', async (t) => {
  const { root, ids } = await project(t);
  const r = await run(['list', '--state', 'ready-for-agent', '--json'], root);
  assert.deepEqual(json<Task[]>(r).map((x) => x.id), [ids[1], ids[2]]);
});

test('list --state ready-for-agent --ready judges blockers against the unfiltered list', async (t) => {
  const { root, ids } = await project(t);
  const r = await run(['list', '--state', 'ready-for-agent', '--ready', '--json'], root);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(json<Task[]>(r).map((x) => x.id), [ids[2]]);
});

test('create --blocked-by (repeatable, comma-separated) is skipped by next while a blocker is open', async (t) => {
  const { root, spec, ids } = await project(t);
  assert.equal((await run(['state', ids[2]!, 'wontfix'], root)).code, 0);
  const r = await run(
    ['create', '--title', 'Fourth', '--parent', spec, '--state', 'ready-for-agent',
      '--blocked-by', `${ids[0]},${ids[1]}`, '--blocked-by', ids[2]!, '--json'],
    root,
  );
  assert.equal(r.code, 0, r.err);
  const created = json<Task>(r);
  assert.deepEqual(created.blockedBy, [ids[0], ids[1], ids[2]]);
  assert.equal((await run(['next'], root)).code, 3);

  // Only blockers that are done stop blocking: 01 done frees 02; 02 done (03 wontfix still open) keeps Fourth blocked.
  assert.equal((await run(['state', ids[0]!, 'done'], root)).code, 0);
  assert.equal(json<Task>(await run(['next', '--json'], root)).id, ids[1]);
  assert.equal((await run(['state', ids[1]!, 'done'], root)).code, 0);
  assert.equal((await run(['next'], root)).code, 3);
  assert.equal((await run(['state', ids[2]!, 'done'], root)).code, 0);
  assert.equal(json<Task>(await run(['next', '--json'], root)).id, created.id);
});

test('create --blocked-by with a ticket of another feature exits 4 INVALID', async (t) => {
  const { root, spec } = await project(t);
  const other = json<Task>(await run(['create', '--title', 'Other', '--json'], root));
  const ticket = json<Task>(await run(['create', '--title', 'Elsewhere', '--parent', other.id, '--json'], root));
  const r = await run(['create', '--title', 'X', '--parent', spec, '--blocked-by', ticket.id, '--json'], root);
  assert.equal(r.code, 4);
  assert.equal(json<{ error: { code: string } }>(r).error.code, 'INVALID');
});

test('a title starting with "-" is passed as --title=-x', async (t) => {
  const { root, spec } = await project(t);
  const r = await run(['create', '--title=-dash', '--parent', spec, '--json'], root);
  assert.equal(r.code, 0, r.err);
  assert.equal(json<Task>(r).title, '-dash');
});

test('show prints one task; close --with-children closes the feature', async (t) => {
  const { root, spec, ids } = await project(t);
  const show = await run(['show', ids[0]!], root);
  assert.equal(show.code, 0, show.err);
  assert.match(show.out, new RegExp(`^${ids[0]!.replace(/\./g, '\\.')}  \\[needs-info\\]  First\n`));
  assert.match(show.out, /\*\*Status:\*\* needs-info/);

  const closed = await run(['close', spec, '--with-children', '--json'], root);
  assert.equal(closed.code, 0, closed.err);
  assert.deepEqual(json<Task[]>(closed).map((x) => x.id), [spec, ...ids]);
  assert.match(await readFile(join(root, ids[2]!), 'utf8'), /\*\*Status:\*\* resolved/);
});

test('unknown command exits 2 with usage on stderr', async (t) => {
  const root = await tmp(t);
  const r = await run(['frobnicate'], root);
  assert.equal(r.code, 2);
  assert.equal(r.out, '');
  assert.match(r.err, /Usage: task-board/);
});

test('usage errors: missing args, unknown option, bad state, option of another command', async (t) => {
  const { root, ids } = await project(t);
  for (const argv of [
    [],
    ['show'],
    ['create'],
    ['state', ids[0]!],
    ['state', ids[0]!, 'in-progress'],
    ['list', '--state', 'nope'],
    ['list', '--bogus'],
    ['next', '--title', 'x'],
    ['init', 'gitlab'],
    ['show', ids[0]!, 'extra'],
    ['create', '--title', 'x', '--blocked-by', `${ids[0]},`],
    ['list', '--blocked-by', ids[0]!],
  ]) {
    const r = await run(argv, root);
    assert.equal(r.code, 2, `${argv.join(' ')} -> ${r.code} ${r.err}`);
    assert.match(r.err, /Usage: task-board/);
  }
});

test('--help prints usage on stdout and exits 0', async (t) => {
  const r = await run(['--help'], await tmp(t));
  assert.equal(r.code, 0);
  assert.match(r.out, /Usage: task-board/);
});

test('unconfigured dir exits 4 with NOT_CONFIGURED', async (t) => {
  const root = await tmp(t);
  const human = await run(['list'], root);
  assert.equal(human.code, 4);
  assert.match(human.err, /NOT_CONFIGURED/);
  const machine = await run(['list', '--json'], root);
  assert.equal(machine.code, 4);
  const body = json<{ error: { code: string; message: string } }>(machine);
  assert.equal(body.error.code, 'NOT_CONFIGURED');
  assert.ok(body.error.message.length > 0);
});

test('tracker errors exit 4: unknown id is NOT_FOUND', async (t) => {
  const { root } = await project(t);
  const r = await run(['show', '.scratch/feature/issues/99-nope.md', '--json'], root);
  assert.equal(r.code, 4);
  assert.equal(json<{ error: { code: string } }>(r).error.code, 'NOT_FOUND');
});

test('init local configures a fresh dir; init with a different existing tracker exits 4 INVALID', async (t) => {
  const root = await tmp(t);
  const first = await run(['init', 'local'], root);
  assert.equal(first.code, 0, first.err);
  assert.match(await readFile(join(root, 'docs/agents/issue-tracker.md'), 'utf8'), /Local Markdown/);
  assert.equal((await run(['list', '--json'], root)).out, '[]\n');

  assert.equal((await run(['init', 'local'], root)).code, 0);

  const other = await run(['init', 'github', '--json'], root);
  assert.equal(other.code, 4);
  assert.equal(json<{ error: { code: string } }>(other).error.code, 'INVALID');
  const human = await run(['init', 'github'], root);
  assert.equal(human.code, 4);
  assert.match(human.err, /already.*local/i);
});

test('init on a dir with an unsupported tracker file exits 4', async (t) => {
  const root = await tmp(t);
  await mkdir(join(root, 'docs/agents'), { recursive: true });
  await writeFile(join(root, 'docs/agents/issue-tracker.md'), '# Issue tracker: GitLab\n');
  const r = await run(['init', 'local', '--json'], root);
  assert.equal(r.code, 4);
  assert.equal(json<{ error: { code: string } }>(r).error.code, 'UNSUPPORTED');
});
