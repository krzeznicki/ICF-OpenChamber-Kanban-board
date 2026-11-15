import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { realExec } from '../src/core/exec.ts';

const cwd = tmpdir();

test('realExec returns stdout and exit code 0', async () => {
  const r = await realExec(process.execPath, ['-e', 'process.stdout.write("hi")'], { cwd });
  assert.deepEqual(r, { code: 0, stdout: 'hi', stderr: '' });
});

test('realExec does not throw on a non-zero exit and keeps stderr', async () => {
  const r = await realExec(process.execPath, ['-e', 'process.stderr.write("bad"); process.exit(3)'], { cwd });
  assert.equal(r.code, 3);
  assert.equal(r.stderr, 'bad');
});

test('realExec stops a program that runs past timeoutMs and reports a failure', async () => {
  const r = await realExec(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { cwd, timeoutMs: 200 });
  assert.notEqual(r.code, 0);
});

test('realExec maps a missing program to 127', async () => {
  const r = await realExec('icf-kanban-no-such-program', [], { cwd });
  assert.equal(r.code, 127);
  assert.match(r.stderr, /icf-kanban-no-such-program/);
});
