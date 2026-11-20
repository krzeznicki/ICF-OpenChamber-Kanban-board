import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SourceInfo } from '../src/panel/api.ts';
import type { SourceId, Task } from '../src/core/types.ts';
import { currentSourceView, sourceBadge, sourceSwitcher, tasksInView } from '../src/panel/sourceView.ts';

const CAPS = { create: true, subtasks: true, blockedBy: true, claim: true, delete: true };
const local: SourceInfo = { id: 'local', label: 'Local', capabilities: CAPS };
const github: SourceInfo = { id: 'github', label: 'GitHub', capabilities: CAPS };

test('sourceSwitcher: a project with one source has no switcher', () => {
  assert.equal(sourceSwitcher([local]), null);
  assert.equal(sourceSwitcher([github]), null);
  assert.equal(sourceSwitcher([]), null);
});

test('sourceSwitcher: two sources give segments All, then each source in config order with its label', () => {
  assert.deepEqual(sourceSwitcher([github, local]), {
    kind: 'segments',
    options: [
      { value: 'all', label: 'All' },
      { value: 'github', label: 'GitHub' },
      { value: 'local', label: 'Local' },
    ],
  });
});

test('sourceSwitcher: more than three sources become a dropdown', () => {
  const extra = (id: string): SourceInfo => ({ id, label: id.toUpperCase(), capabilities: CAPS }) as unknown as SourceInfo;
  const three = sourceSwitcher([local, github, extra('jira')]);
  assert.equal(three?.kind, 'segments');
  const four = sourceSwitcher([local, github, extra('jira'), extra('linear')]);
  assert.equal(four?.kind, 'dropdown');
  assert.deepEqual(four?.options.map((o) => o.value), ['all', 'local', 'github', 'jira', 'linear']);
});

const config = (sources: SourceInfo[]) => ({ primary: sources[0]!.id, sources });

test('currentSourceView: first opening shows the primary source', () => {
  assert.equal(currentSourceView(undefined, config([github, local])), 'github');
  assert.equal(currentSourceView(null, config([local, github])), 'local');
});

test('currentSourceView: a stored choice the project still has wins, All included', () => {
  assert.equal(currentSourceView('local', config([github, local])), 'local');
  assert.equal(currentSourceView('all', config([github, local])), 'all');
});

test('currentSourceView: a stored source the project no longer has, or junk, falls back to the primary', () => {
  assert.equal(currentSourceView('github', config([local])), 'local');
  assert.equal(currentSourceView('jira', config([local, github])), 'local');
  assert.equal(currentSourceView(42, config([local, github])), 'local');
});

test('currentSourceView: a project with one source always shows it, also after All was stored', () => {
  assert.equal(currentSourceView('all', config([github])), 'github');
});

const task = (id: string, source: SourceId): Task => ({
  id, kind: 'ticket', title: id, body: '', state: 'ready-for-agent', type: null, parentId: null,
  blockedBy: [], url: null, updatedAt: 0, claimed: false, source,
});

test('tasksInView: All keeps every task; a source keeps only its own tasks', () => {
  const tasks = [task('.scratch/a/spec.md', 'local'), task('#1', 'github'), task('.scratch/a/issues/01.md', 'local')];
  assert.deepEqual(tasksInView(tasks, 'all'), tasks);
  assert.deepEqual(tasksInView(tasks, 'github').map((t) => t.id), ['#1']);
  assert.deepEqual(tasksInView(tasks, 'local').map((t) => t.id), ['.scratch/a/spec.md', '.scratch/a/issues/01.md']);
});

test('sourceBadge: the card names its source only in the All view', () => {
  assert.equal(sourceBadge(task('#1', 'github'), 'all', [local, github]), 'GitHub');
  assert.equal(sourceBadge(task('.scratch/a/spec.md', 'local'), 'all', [local, github]), 'Local');
  assert.equal(sourceBadge(task('#1', 'github'), 'github', [local, github]), null);
  // One source: no switcher, so no badges either.
  assert.equal(sourceBadge(task('#1', 'github'), 'github', [github]), null);
  // A source the panel has no label for shows its id.
  assert.equal(sourceBadge(task('jira:X-1', 'jira' as SourceId), 'all', [local, github]), 'jira');
});
