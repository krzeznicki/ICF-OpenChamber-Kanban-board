import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/types.ts';
import { deleteConfirm } from '../src/panel/taskDelete.ts';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  kind: 'ticket',
  title: id,
  body: '',
  state: 'needs-triage',
  type: null,
  parentId: null,
  blockedBy: [],
  url: null,
  updatedAt: 0,
  claimed: false,
  source: id.startsWith('#') ? 'github' : 'local',
  ...over,
});

const SPEC = '.scratch/f/spec.md';
const T1 = '.scratch/f/issues/01-a.md';

test('local ticket: one Delete; a local feature deletes its whole folder with its sub-tasks', () => {
  const t1 = task(T1, { title: 'A', parentId: SPEC });
  const one = deleteConfirm('local', t1, [t1]);
  assert.equal(one.title, 'Delete “A”?');
  assert.match(one.body, /\.scratch\/f\/issues\/01-a\.md/);
  assert.deepEqual(one.choices.map((c) => [c.id, c.label]), [['one', 'Delete']]);
  const spec = task(SPEC, { kind: 'parent', title: 'F' });
  const all = deleteConfirm('local', spec, [spec, t1]);
  assert.match(all.body, /folder \.scratch\/f\/ .*1 sub-task/);
  assert.deepEqual(all.choices.map((c) => [c.id, c.label]), [['all', 'Delete with sub-tasks']]);
});

test('GitHub: admins only; a parent may keep its sub-issues', () => {
  const parent = task('#1', { kind: 'parent', title: 'P' });
  const child = task('#2', { parentId: '#1' });
  const c = deleteConfirm('github', parent, [parent, child]);
  assert.match(c.body, /admin/);
  assert.match(c.body, /1 sub-issue/);
  assert.deepEqual(c.choices.map((x) => x.id), ['all', 'one']);
  assert.deepEqual(deleteConfirm('github', child, [parent, child]).choices.map((x) => x.id), ['one']);
});
