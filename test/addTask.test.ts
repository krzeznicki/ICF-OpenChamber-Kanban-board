import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NewTask, Task } from '../src/core/types.ts';
import {
  CREATE_STATES,
  blockerChoices,
  canAddSubtask,
  canHaveSubtasks,
  createWithSubtasks,
  draftKind,
  emptyDraft,
  keepOffered,
  parentChoices,
  partialMessage,
  subtaskTitles,
  toNewTask,
  validateDraft,
  type AddDraft,
} from '../src/panel/addTask.ts';

const task = (over: Partial<Task> = {}): Task => ({
  id: '.scratch/f/issues/01-a.md',
  kind: 'ticket',
  title: 'A',
  body: '',
  state: 'needs-triage',
  type: null,
  parentId: '.scratch/f/spec.md',
  blockedBy: [],
  url: null,
  updatedAt: 0,
  claimed: false,
  ...over,
});

const draft = (over: Partial<AddDraft> = {}): AddDraft => ({ ...emptyDraft(), ...over });

const LOCAL: Task[] = [
  task({ id: '.scratch/f/spec.md', kind: 'parent', title: 'Feature F', parentId: null }),
  task({ id: '.scratch/g/spec.md', kind: 'parent', title: 'Feature G', parentId: null }),
  task({ id: '.scratch/old/spec.md', kind: 'parent', title: 'Old', parentId: null, state: 'done' }),
  task({ id: '.scratch/f/issues/01-a.md', title: 'F1' }),
  task({ id: '.scratch/f/issues/02-b.md', title: 'F2', state: 'done' }),
  task({ id: '.scratch/f/issues/03-c.md', title: 'F3', state: 'ready-for-agent' }),
  task({ id: '.scratch/g/issues/01-a.md', title: 'G1', parentId: '.scratch/g/spec.md' }),
];

const GITHUB: Task[] = [
  task({ id: '#1', kind: 'parent', title: 'Epic', parentId: null }),
  task({ id: '#2', title: 'Child', parentId: '#1' }),
  task({ id: '#3', title: 'Loose', parentId: null }),
  task({ id: '#4', title: 'Closed', parentId: null, state: 'done' }),
];

test('emptyDraft starts in needs-triage with nothing chosen', () => {
  assert.deepEqual(emptyDraft(), { title: '', type: '', parentId: '', state: 'needs-triage', blockedBy: [], body: '', subtasks: [], start: {} });
});

test('CREATE_STATES offers the open states, needs-triage first', () => {
  assert.deepEqual(CREATE_STATES, ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human']);
});

test('parentChoices: open parents only, with the id as hint', () => {
  assert.deepEqual(parentChoices(LOCAL), [
    { id: '.scratch/f/spec.md', label: 'Feature F', hint: '.scratch/f/spec.md' },
    { id: '.scratch/g/spec.md', label: 'Feature G', hint: '.scratch/g/spec.md' },
  ]);
  assert.deepEqual(parentChoices(GITHUB), [{ id: '#1', label: 'Epic', hint: '#1' }]);
});

test('blockerChoices local: no parent (a new feature) takes no blockers', () => {
  assert.deepEqual(blockerChoices(LOCAL, 'local', ''), []);
});

test('blockerChoices local: open tickets of the chosen feature only', () => {
  assert.deepEqual(
    blockerChoices(LOCAL, 'local', '.scratch/f/spec.md').map((c) => c.id),
    ['.scratch/f/issues/01-a.md', '.scratch/f/issues/03-c.md'],
  );
  assert.deepEqual(
    blockerChoices(LOCAL, 'local', '.scratch/g/spec.md').map((c) => c.id),
    ['.scratch/g/issues/01-a.md'],
  );
});

test('blockerChoices github: every open issue, whatever the parent', () => {
  assert.deepEqual(blockerChoices(GITHUB, 'github', '').map((c) => c.id), ['#1', '#2', '#3']);
  assert.deepEqual(blockerChoices(GITHUB, 'github', '#1').map((c) => c.id), ['#1', '#2', '#3']);
  assert.deepEqual(blockerChoices(GITHUB, 'github', '')[0], { id: '#1', label: 'Epic', hint: '#1' });
});

test('keepOffered drops blockers that are no longer offered (parent changed)', () => {
  assert.deepEqual(keepOffered(['a', 'b', 'c'], [{ id: 'c', label: '' }, { id: 'a', label: '' }]), ['a', 'c']);
  assert.deepEqual(keepOffered(['a'], []), []);
});

test('canHaveSubtasks: local only for a new feature; github always', () => {
  assert.equal(canHaveSubtasks('local', ''), true);
  assert.equal(canHaveSubtasks('local', '.scratch/f/spec.md'), false);
  assert.equal(canHaveSubtasks('github', ''), true);
  assert.equal(canHaveSubtasks('github', '#1'), true);
});

test('canAddSubtask: local only on an open feature; github on any open issue', () => {
  assert.equal(canAddSubtask(LOCAL[0]!, 'local'), true);
  assert.equal(canAddSubtask(LOCAL[2]!, 'local'), false); // done feature
  assert.equal(canAddSubtask(LOCAL[3]!, 'local'), false); // ticket
  assert.equal(canAddSubtask(GITHUB[0]!, 'github'), true);
  assert.equal(canAddSubtask(GITHUB[2]!, 'github'), true); // becomes a parent
  assert.equal(canAddSubtask(GITHUB[1]!, 'github'), true);
  assert.equal(canAddSubtask(GITHUB[3]!, 'github'), false); // closed
});

test('draftKind: what the new task will be, for the inherited start preset', () => {
  assert.equal(draftKind(draft(), 'local'), 'parent');
  assert.equal(draftKind(draft({ parentId: '.scratch/f/spec.md' }), 'local'), 'ticket');
  assert.equal(draftKind(draft(), 'github'), 'ticket');
  assert.equal(draftKind(draft({ subtasks: ['  ', 'x'] }), 'github'), 'parent');
  assert.equal(draftKind(draft({ subtasks: ['  '] }), 'github'), 'ticket');
});

test('subtaskTitles trims and drops empty rows', () => {
  assert.deepEqual(subtaskTitles([' a ', '', '   ', 'b']), ['a', 'b']);
});

test('validateDraft: a title is required', () => {
  assert.deepEqual(validateDraft(draft()), { title: 'A title is required' });
  assert.deepEqual(validateDraft(draft({ title: '   ' })), { title: 'A title is required' });
  assert.deepEqual(validateDraft(draft({ title: 'x' })), {});
});

test('toNewTask: trims, leaves out what is unset', () => {
  assert.deepEqual(toNewTask(draft({ title: ' T ' }), 'local'), { title: 'T', state: 'needs-triage' });
  assert.deepEqual(
    toNewTask(draft({ title: 'T', type: 'bug', body: ' Why \n', state: 'ready-for-agent', parentId: '#1', blockedBy: ['#3'] }), 'github'),
    { title: 'T', state: 'ready-for-agent', type: 'bug', body: 'Why', parentId: '#1', blockedBy: ['#3'] },
  );
});

test('toNewTask local: a new feature takes no blockers', () => {
  assert.deepEqual(toNewTask(draft({ title: 'T', blockedBy: ['.scratch/f/issues/01-a.md'] }), 'local'), { title: 'T', state: 'needs-triage' });
  assert.deepEqual(
    toNewTask(draft({ title: 'T', parentId: '.scratch/f/spec.md', blockedBy: ['.scratch/f/issues/01-a.md'] }), 'local'),
    { title: 'T', state: 'needs-triage', parentId: '.scratch/f/spec.md', blockedBy: ['.scratch/f/issues/01-a.md'] },
  );
});

test('createWithSubtasks: parent first, then each sub-task in order under it', async () => {
  const calls: NewTask[] = [];
  let n = 10;
  const create = async (input: NewTask): Promise<Task> => {
    calls.push(input);
    return task({ id: `#${n++}`, title: input.title });
  };
  const r = await createWithSubtasks(create, { title: 'P', state: 'needs-triage' }, ['a', 'b']);
  assert.equal(r.task.id, '#10');
  assert.deepEqual(r.failed, []);
  assert.deepEqual(calls, [
    { title: 'P', state: 'needs-triage' },
    { title: 'a', state: 'needs-triage', parentId: '#10' },
    { title: 'b', state: 'needs-triage', parentId: '#10' },
  ]);
});

test('createWithSubtasks: a failing sub-task is collected, the rest still run', async () => {
  const create = async (input: NewTask): Promise<Task> => {
    if (input.title === 'bad') throw new Error('boom');
    return task({ id: input.parentId === undefined ? 'P' : `c-${input.title}` });
  };
  const r = await createWithSubtasks(create, { title: 'P' }, ['a', 'bad', 'c']);
  assert.equal(r.task.id, 'P');
  assert.deepEqual(r.failed, [{ title: 'bad', message: 'boom' }]);
});

test('createWithSubtasks: the parent failing rejects, no sub-task is tried', async () => {
  let calls = 0;
  const create = async (): Promise<Task> => {
    calls++;
    throw new Error('no');
  };
  await assert.rejects(createWithSubtasks(create, { title: 'P' }, ['a']), /no/);
  assert.equal(calls, 1);
});

test('partialMessage names the created task and each missing sub-task', () => {
  assert.equal(
    partialMessage('#10', [
      { title: 'a', message: 'boom' },
      { title: 'b', message: 'bang' },
    ]),
    'Created #10, but 2 sub-tasks were not created: “a” (boom); “b” (bang).',
  );
  assert.equal(partialMessage('#10', [{ title: 'a', message: 'boom' }]), 'Created #10, but 1 sub-task was not created: “a” (boom).');
});
