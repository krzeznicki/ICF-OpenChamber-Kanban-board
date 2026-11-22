import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConfigResult } from '../src/panel/api.ts';
import { defaultChoice, githubChoice, loadNotice, setupOutcome } from '../src/panel/setup.ts';

const labels = {};
const ALL = { create: true, subtasks: true, blockedBy: true, claim: true, delete: true };
const configured = (tracker: 'local' | 'github'): ConfigResult => ({
  config: { primary: tracker, sources: [{ id: tracker, label: tracker, capabilities: ALL }], known: [], labels },
});
const notConfigured: ConfigResult = { error: { code: 'NOT_CONFIGURED', message: 'No docs/agents/issue-tracker.md' } };

test('GitHub is preselected only when a github.com remote was detected', () => {
  assert.equal(defaultChoice('git@github.com:o/r.git'), 'github');
  assert.equal(defaultChoice(null), 'local');
});

test('wizard: without a GitHub remote the GitHub choice says so and is disabled', () => {
  const none = githubChoice(null);
  assert.equal(none.disabled, true);
  assert.match(none.subtitle, /no GitHub remote found/);
  const found = githubChoice('https://github.com/o/r.git');
  assert.equal(found.disabled, false);
  assert.ok(found.subtitle.includes('https://github.com/o/r.git'));
});

test('load errors become a notice with the message and a Retry button', () => {
  for (const code of ['UNSUPPORTED', 'GH_MISSING', 'GH_OLD', 'GH_AUTH', 'NO_SERVICE', 'FAILED']) {
    const n = loadNotice({ code, message: `msg ${code}` });
    assert.equal(n.body, `msg ${code}`);
    assert.equal(n.action, 'Retry');
    assert.ok(n.title.length > 0);
  }
  assert.equal(loadNotice({ code: 'UNSUPPORTED', message: '' }).tone, 'warning');
  assert.equal(loadNotice({ code: 'GH_AUTH', message: '' }).tone, 'error');
  assert.match(loadNotice({ code: 'GH_AUTH', message: '' }).title, /not logged in/);
});

test('setup succeeded: show the board', () => {
  assert.deepEqual(setupOutcome('local', null, configured('local')), { kind: 'board' });
  assert.deepEqual(setupOutcome('github', null, configured('github')), { kind: 'board' });
});

test('project already set up for the other tracker: an info notice naming it', () => {
  const invalid = { code: 'INVALID', message: 'already configures the local tracker' };
  const o = setupOutcome('github', invalid, configured('local'));
  assert.equal(o.kind, 'notice');
  if (o.kind !== 'notice') return;
  assert.equal(o.notice.tone, 'info');
  assert.match(o.notice.title, /already set up for local Markdown/);
  assert.equal(o.notice.action, 'Open board');
  // Same result when init did not report it (file appeared in between).
  assert.match((setupOutcome('local', null, configured('github')) as { notice: { title: string } }).notice.title, /GitHub Issues/);
});

test('gh preflight failed: nothing written, the gh message with Retry', () => {
  const o = setupOutcome('github', { code: 'GH_AUTH', message: 'run `gh auth login`' }, notConfigured);
  assert.equal(o.kind, 'notice');
  if (o.kind !== 'notice') return;
  assert.equal(o.notice.body, 'run `gh auth login`');
  assert.equal(o.notice.action, 'Retry');
  assert.equal(o.notice.tone, 'error');
});

test('config written but label creation failed: warning, then the board', () => {
  const o = setupOutcome('github', { code: 'FAILED', message: 'gh label list failed' }, configured('github'));
  assert.equal(o.kind, 'notice');
  if (o.kind !== 'notice') return;
  assert.equal(o.notice.tone, 'warning');
  assert.equal(o.notice.body, 'gh label list failed');
  assert.equal(o.notice.action, 'Open board');
});
