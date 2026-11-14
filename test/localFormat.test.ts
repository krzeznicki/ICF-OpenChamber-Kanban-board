import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  issueFileName,
  parseIssue,
  parseSpec,
  patchLine,
  renderIssue,
} from '../src/core/localFormat.ts';

const fixture = (rel: string): string =>
  readFileSync(new URL(`./fixtures/scratch/${rel}`, import.meta.url), 'utf8');

const TICKET = fixture('example-feature/issues/01-ticket-title.md');
const SPEC = fixture('example-feature/spec.md');

test('parses Matt\'s local-ticket-template fixture', () => {
  const p = parseIssue(TICKET, '01-ticket-title.md');
  // The template's placeholder "<NN>" is not a number, so nothing is stripped.
  assert.equal(p.title, '<NN>: <Ticket title>');
  assert.equal(p.state, 'ready-for-agent');
  assert.equal(p.type, null);
  // Placeholder text without numbers -> no blockers.
  assert.deepEqual(p.blockedBy, []);
  assert.equal(p.body, TICKET);
});

test('template fixture round-trips: patching a field to its current value is a no-op', () => {
  assert.equal(patchLine(TICKET, 'Status', 'ready-for-agent'), TICKET);
});

test('renderIssue output follows the template and parses back to the input', () => {
  const text = renderIssue(3, {
    title: 'Add login',
    body: '**What to build:** a login form.\n\n- [ ] Criterion 1\n',
    type: 'bug',
    state: 'ready-for-agent',
    blockedBy: ['.scratch/auth/issues/01-setup.md', '02'],
  });
  assert.match(text, /^# 03: Add login\n\n/);
  assert.match(text, /^\*\*Blocked by:\*\* 01, 02$/m);
  assert.match(text, /^\*\*Status:\*\* ready-for-agent$/m);
  assert.match(text, /^\*\*Type:\*\* bug$/m);
  assert.match(text, /^\*\*What to build:\*\* a login form\.$/m);
  const p = parseIssue(text, '03-add-login.md');
  assert.equal(p.title, 'Add login');
  assert.equal(p.state, 'ready-for-agent');
  assert.equal(p.type, 'bug');
  assert.deepEqual(p.blockedBy, [1, 2]);
  // Re-patching a rendered field to the same value changes nothing.
  assert.equal(patchLine(text, 'Status', 'ready-for-agent'), text);
});

test('renderIssue with no blockers writes Matt\'s "None" phrase and done as resolved', () => {
  const text = renderIssue(1, { title: 'Ship it', state: 'done' });
  assert.match(text, /^\*\*Blocked by:\*\* None \(can start immediately\)$/m);
  assert.match(text, /^\*\*Status:\*\* resolved$/m);
  assert.doesNotMatch(text, /Type:/);
  const p = parseIssue(text, '01-ship-it.md');
  assert.equal(p.state, 'done');
  assert.deepEqual(p.blockedBy, []);
});

test('renderIssue defaults state to needs-triage', () => {
  const p = parseIssue(renderIssue(2, { title: 'X' }), '02-x.md');
  assert.equal(p.state, 'needs-triage');
});

test('file with no Status line parses as needs-triage', () => {
  const p = parseIssue('# 02: Something\n\nJust text.\n', '02-something.md');
  assert.equal(p.state, 'needs-triage');
  assert.equal(p.title, 'Something');
});

test('title falls back to the file name without heading', () => {
  const p = parseIssue('No heading here.\n', '05-fallback-name.md');
  assert.equal(p.title, '05-fallback-name');
});

test('status words map to states', () => {
  const cases: Array<[string, string]> = [
    ['resolved', 'done'],
    ['closed', 'done'],
    ['done', 'done'],
    ['Resolved', 'done'],
    ['claimed', 'ready-for-agent'],
    ['ready-for-agent', 'ready-for-agent'],
    ['ready-for-human', 'ready-for-human'],
    ['needs-info', 'needs-info'],
    ['wontfix', 'wontfix'],
    ['needs-triage', 'needs-triage'],
    ['something-else', 'needs-triage'],
    ['', 'needs-triage'],
  ];
  for (const [word, state] of cases) {
    assert.equal(parseIssue(`# T\n\n**Status:** ${word}\n`, 'a.md').state, state, `bold ${word}`);
    assert.equal(parseIssue(`# T\n\nStatus: ${word}\n`, 'a.md').state, state, `bare ${word}`);
  }
});

test('bare "Blocked by: 01, 03" -> [1, 3]; Type bare form is read', () => {
  const p = parseIssue('# 04: T\n\nType: research\nStatus: claimed\nBlocked by: 01, 03\n', '04-t.md');
  assert.deepEqual(p.blockedBy, [1, 3]);
  assert.equal(p.type, 'research');
  assert.equal(p.state, 'ready-for-agent');
});

test('"None..." blocked-by -> []', () => {
  const p = parseIssue('# T\n\n**Blocked by:** None (can start immediately)\n', 'a.md');
  assert.deepEqual(p.blockedBy, []);
});

test('CRLF file patched keeps CRLF and changes exactly one line', () => {
  const lf = renderIssue(7, { title: 'Crlf', state: 'ready-for-agent', blockedBy: ['01'] });
  const crlf = lf.replace(/\n/g, '\r\n');
  const out = patchLine(crlf, 'Status', 'resolved');
  assert.ok(!/(^|[^\r])\n/.test(out), 'every newline is still CRLF');
  const before = crlf.split('\r\n');
  const after = out.split('\r\n');
  assert.equal(after.length, before.length);
  const changed = before.map((l, i) => (l === after[i] ? -1 : i)).filter((i) => i >= 0);
  assert.equal(changed.length, 1);
  assert.equal(after[changed[0]!], '**Status:** resolved');
  assert.equal(parseIssue(out, '07-crlf.md').state, 'done');
});

test('patchLine keeps the bare form of an existing line', () => {
  const text = '# 01: T\n\nStatus: claimed\nBlocked by: 02\n\nBody\n';
  assert.equal(patchLine(text, 'Status', 'resolved'), '# 01: T\n\nStatus: resolved\nBlocked by: 02\n\nBody\n');
});

test('patchLine on a file without Type inserts one line after the title\'s blank line', () => {
  const out = patchLine(TICKET, 'Type', 'chore');
  const before = TICKET.split('\n');
  const after = out.split('\n');
  assert.equal(after.length, before.length + 1);
  assert.equal(after[2], '**Type:** chore');
  assert.deepEqual([...after.slice(0, 2), ...after.slice(3)], before);
  assert.equal(parseIssue(out, '01-ticket-title.md').type, 'chore');
});

test('patchLine inserts in the bare form when the file uses bare fields', () => {
  const out = patchLine('# T\n\nStatus: claimed\n', 'Type', 'task');
  assert.equal(out, '# T\n\nType: task\nStatus: claimed\n');
});

test('patchLine inserts at the top when there is no title', () => {
  assert.equal(patchLine('Text\n', 'Status', 'needs-info'), '**Status:** needs-info\nText\n');
});

test('issueFileName pads and slugifies', () => {
  assert.equal(issueFileName(3, 'Add Login!'), '03-add-login.md');
  assert.equal(issueFileName(12, '  Zażółć gęślą jaźń  '), '12-zazolc-gesla-jazn.md');
  assert.equal(issueFileName(1, '!!!'), '01-issue.md');
});

test('parseSpec: Matt\'s spec-template fixture has no heading -> feature slug, needs-triage', () => {
  assert.deepEqual(parseSpec(SPEC, 'example-feature'), {
    title: 'example-feature',
    state: 'needs-triage',
    type: null,
  });
});

test('parseSpec reads heading, Status and Type', () => {
  const spec = '# Login flow\n\n**Status:** resolved\n**Type:** enhancement\n\n## Problem Statement\n';
  assert.deepEqual(parseSpec(spec, 'login'), { title: 'Login flow', state: 'done', type: 'enhancement' });
});
