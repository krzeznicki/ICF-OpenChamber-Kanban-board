import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { SERVICE_HOST_PATH, SERVICE_INSTRUCTIONS_MAX } from '@openchamber/sdk';
import { instructionsText, publishInstructions } from '../src/service/instructions.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKILLS = ['icf-kanban-create', 'icf-kanban-next', 'icf-kanban-start', 'icf-kanban-status'];
const CLI = '/opt/ext/icf kanban/build/cli/task-board.mjs';

test('package.json contributes the skills folder and instructions', () => {
  const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { openchamber: { contributes: Record<string, unknown> } };
  assert.equal(pkg.openchamber.contributes.skills, 'skills');
  assert.equal(pkg.openchamber.contributes.instructions, true);
});

test('the four skills exist with matching name/description frontmatter and under 40 lines', () => {
  assert.deepEqual(readdirSync(`${root}skills`).sort(), SKILLS);
  for (const name of SKILLS) {
    const text = readFileSync(`${root}skills/${name}/SKILL.md`, 'utf8');
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(front, `${name}: frontmatter`);
    const fields = Object.fromEntries(front[1]!.split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
    assert.equal(fields.name, name);
    assert.ok((fields.description ?? '').length > 40, `${name}: description`);
    assert.ok(text.trimEnd().split('\n').length < 40, `${name}: under 40 lines`);
    assert.match(text, /docs\/agents\/issue-tracker\.md/, `${name}: missing-config rule`);
    assert.match(text, /ask the user/, `${name}: init only after asking`);
  }
});

test('instructions text names the CLI by absolute path, is short and fits the host limit', () => {
  const text = instructionsText(CLI);
  assert.ok(text.includes(`node "${CLI}"`));
  for (const cmd of ['list --ready', 'next', 'claim <id>', 'state <id>', 'create --title']) assert.ok(text.includes(cmd), cmd);
  assert.ok(text.length < 700 && text.length <= SERVICE_INSTRUCTIONS_MAX, `length ${text.length}`);
  assert.ok(!text.includes('\n'));
});

test('instructions: always pass --dir with the project root (main checkout, not a worktree); claim only for list --ready/next picks', () => {
  const text = instructionsText(CLI);
  assert.match(text, /--dir <the project root, i\.e\. the main checkout, not a worktree>/);
  assert.match(text, /claim applies to sub-tasks you take from `list --ready`\/`next`; skip lines marked claimed/);
});

test('every skill tells the agent to always pass --dir with the project root, even in a worktree', () => {
  for (const name of SKILLS) {
    const text = readFileSync(`${root}skills/${name}/SKILL.md`, 'utf8');
    assert.match(text, /always pass `--dir <project root>`/i, name);
    assert.match(text, /even in a worktree/i, name);
  }
});

test('icf-kanban-start reads claimed from show before claim and stops when already claimed', () => {
  const text = readFileSync(`${root}skills/icf-kanban-start/SKILL.md`, 'utf8');
  assert.ok(text.indexOf('claimed') < text.indexOf('task-board claim <id>'), 'claimed is checked before claim');
  assert.match(text, /already claimed.*stop and ask the user/i);
  assert.match(text, /exit code 4/i);
  assert.doesNotMatch(text, /"Only a ready-for-agent task can be claimed"/);
});

test('publishInstructions calls setInstructions(null, text) once; a failure is logged, not thrown', async () => {
  const calls: Array<[string | null, string]> = [];
  const logs: string[] = [];
  const ok = await publishInstructions({ setInstructions: async (d, t) => void calls.push([d, t]) }, CLI, (l) => logs.push(l));
  assert.equal(ok, true);
  assert.deepEqual(calls, [[null, instructionsText(CLI)]]);

  const failed = await publishInstructions({ setInstructions: async () => Promise.reject(new Error('NOT_GRANTED')) }, CLI, (l) => logs.push(l));
  assert.equal(failed, false);
  assert.ok(logs.some((l) => l.includes('setInstructions failed: NOT_GRANTED')));
});

test('the service sets instructions once at start, with the CLI path, and keeps serving', async (t) => {
  const calls: Array<{ method: string; input: { directory: string | null; text: string } }> = [];
  const fakeHost = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => {
      assert.equal(req.url, SERVICE_HOST_PATH);
      calls.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"result":{}}');
    });
  });
  await new Promise<void>((r) => fakeHost.listen(0, '127.0.0.1', r));
  t.after(() => fakeHost.close());

  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));

  const child = spawn(process.execPath, ['--experimental-strip-types', `${root}src/service/main.ts`], {
    env: {
      ...process.env,
      OPENCHAMBER_SERVICE_PORT: String(port),
      OPENCHAMBER_SERVICE_TOKEN: 'tok',
      OPENCHAMBER_HOST_CALLBACK_URL: `http://127.0.0.1:${(fakeHost.address() as AddressInfo).port}`,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  let stderr = '';
  child.stderr.on('data', (c: Buffer) => (stderr += c));

  let health = 0;
  for (let i = 0; i < 100 && (health !== 200 || calls.length === 0); i++) {
    await new Promise((r) => setTimeout(r, 50));
    health = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: 'Bearer tok' } }).then((r) => r.status, () => 0);
  }
  assert.equal(health, 200, stderr);

  const set = calls.filter((c) => c.method === 'instructions.set');
  assert.equal(set.length, 1, JSON.stringify(calls));
  assert.equal(set[0]!.input.directory, null);
  assert.match(set[0]!.input.text, /node ".*task-board\.mjs"/);
  assert.match(stderr, /setting agent instructions/);
});
