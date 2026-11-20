import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NewTask, Task } from '../src/core/types.ts';
import {
  CREATE_STATES,
  blockerChoices,
  canAddSubtask,
  subtaskModes,
  canHaveSubtasks,
  createWithSubtasks,
  draftSubtasks,
  draftType,
  emptyDraft,
  existingSubtaskChoices,
  existingToLink,
  MODEL_PICK,
  isDirty,
  keepOffered,
  parentChoices,
  partialMessage,
  subtaskTitles,
  subtasksToCreate,
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
  source: over.id?.startsWith('#') ? 'github' : 'local',
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
  assert.deepEqual(emptyDraft(), { title: '', type: '', parentId: '', state: 'needs-triage', blockedBy: [], body: '', subtasks: [], existing: [], start: {} });
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

test('blockerChoices github: every open issue', () => {
  assert.deepEqual(blockerChoices(GITHUB, 'github', '').map((c) => c.id), ['#1', '#2', '#3']);
  assert.deepEqual(blockerChoices(GITHUB, 'github', '')[0], { id: '#1', label: 'Epic', hint: '#1' });
});

test('blockerChoices github: the chosen parent is not offered as a blocker', () => {
  assert.deepEqual(blockerChoices(GITHUB, 'github', '#1').map((c) => c.id), ['#2', '#3']);
});

test('subtasksToCreate: the rows, trimmed, when the new task may have sub-tasks', () => {
  assert.deepEqual(subtasksToCreate(draft({ subtasks: [' a ', ''] }), 'local'), ['a']);
  assert.deepEqual(subtasksToCreate(draft({ parentId: '#1', subtasks: ['a'] }), 'github'), ['a']);
});

test('subtasksToCreate: none for a local ticket (parent chosen), even with rows left from before', () => {
  assert.deepEqual(subtasksToCreate(draft({ parentId: '.scratch/f/spec.md', subtasks: ['a', 'b'] }), 'local'), []);
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

test('draftSubtasks: whether the new task will have sub-tasks, for the inherited start preset', () => {
  assert.equal(draftSubtasks(draft(), 'local'), false);
  assert.equal(draftSubtasks(draft({ subtasks: ['x'] }), 'local'), true);
  assert.equal(draftSubtasks(draft({ existing: ['.scratch/g/spec.md'] }), 'local'), true);
  assert.equal(draftSubtasks(draft({ parentId: '.scratch/f/spec.md', subtasks: ['x'] }), 'local'), false);
  assert.equal(draftSubtasks(draft({ parentId: '.scratch/f/spec.md', existing: ['x'] }), 'local'), false);
  assert.equal(draftSubtasks(draft(), 'github'), false);
  assert.equal(draftSubtasks(draft({ subtasks: ['  ', 'x'] }), 'github'), true);
  assert.equal(draftSubtasks(draft({ subtasks: ['  '] }), 'github'), false);
  assert.equal(draftSubtasks(draft({ existing: ['#3'] }), 'github'), true);
});

test('existingSubtaskChoices local: a new feature takes open tickets and features without tickets', () => {
  assert.deepEqual(
    existingSubtaskChoices(LOCAL, 'local', '').map((c) => c.id),
    ['.scratch/f/issues/01-a.md', '.scratch/f/issues/03-c.md', '.scratch/g/issues/01-a.md'],
  );
  const lone = task({ id: '.scratch/h/spec.md', kind: 'parent', title: 'H', parentId: null });
  assert.deepEqual(existingSubtaskChoices([...LOCAL, lone], 'local', '').at(-1), { id: lone.id, label: 'H', hint: lone.id });
});

test('existingSubtaskChoices local: a ticket (parent chosen) takes none', () => {
  assert.deepEqual(existingSubtaskChoices(LOCAL, 'local', '.scratch/f/spec.md'), []);
});

test('existingSubtaskChoices github: open issues, not the chosen parent or above it', () => {
  assert.deepEqual(existingSubtaskChoices(GITHUB, 'github', '').map((c) => c.id), ['#1', '#2', '#3']);
  assert.deepEqual(existingSubtaskChoices(GITHUB, 'github', '#1').map((c) => c.id), ['#2', '#3']);
});

test('existingToLink: the picked ids still offered, in pick order; none when the new task may not have sub-tasks', () => {
  const F1 = '.scratch/f/issues/01-a.md';
  const G1 = '.scratch/g/issues/01-a.md';
  assert.deepEqual(existingToLink(draft({ existing: [G1, F1] }), 'local', LOCAL), [G1, F1]);
  assert.deepEqual(existingToLink(draft({ parentId: '.scratch/f/spec.md', existing: [F1] }), 'local', LOCAL), []);
  assert.deepEqual(existingToLink(draft({ parentId: '#1', existing: ['#3'] }), 'github', GITHUB), ['#3']);
});

test('existingToLink drops a stale pick: done since, gone, or above the chosen parent', () => {
  // F2 is done, a vanished id is not listed, #1 is the chosen parent (a cycle).
  assert.deepEqual(existingToLink(draft({ existing: ['.scratch/f/issues/02-b.md', '.scratch/gone/spec.md'] }), 'local', LOCAL), []);
  assert.deepEqual(existingToLink(draft({ parentId: '#2', existing: ['#1', '#3'] }), 'github', GITHUB), ['#3']);
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

test('toNewTask: "Let the model pick" creates the task as needs-triage with no type', () => {
  assert.deepEqual(toNewTask(draft({ title: 'T', type: MODEL_PICK, state: MODEL_PICK }), 'github'), { title: 'T', state: 'needs-triage' });
  assert.deepEqual(toNewTask(draft({ title: 'T', type: 'bug', state: MODEL_PICK }), 'github'), { title: 'T', state: 'needs-triage', type: 'bug' });
  assert.deepEqual(toNewTask(draft({ title: 'T', type: MODEL_PICK, state: 'needs-info' }), 'github'), { title: 'T', state: 'needs-info' });
});

test('emptyDraft(true): Type and State start on "Let the model pick"', () => {
  assert.deepEqual(emptyDraft(true), { ...emptyDraft(), type: MODEL_PICK, state: MODEL_PICK });
  assert.equal(isDirty(emptyDraft(true), emptyDraft(true)), false);
  assert.equal(isDirty({ ...emptyDraft(true), state: 'needs-triage' }, emptyDraft(true)), true);
});

test('draftType: the type a draft would have now (the model\'s pick counts as none yet)', () => {
  assert.equal(draftType(draft({ type: MODEL_PICK })), null);
  assert.equal(draftType(draft({ type: '' })), null);
  assert.equal(draftType(draft({ type: 'bug' })), 'bug');
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
  assert.deepEqual(r.failed, [{ title: 'bad', message: 'boom', kind: 'create' }]);
});

test('createWithSubtasks: picked existing tasks are linked under the new task after the creates', async () => {
  const calls: string[] = [];
  const create = async (input: NewTask): Promise<Task> => {
    calls.push(`create ${input.title}`);
    return task({ id: input.parentId === undefined ? '#10' : '#11' });
  };
  const setParent = async (id: string, parentId: string): Promise<Task> => {
    calls.push(`link ${id} ${parentId}`);
    return task({ id, parentId });
  };
  const r = await createWithSubtasks(create, { title: 'P' }, ['a'], {
    existing: [{ id: '#3', label: 'Loose' }, { id: '#2', label: 'Child' }],
    setParent,
  });
  assert.deepEqual(r.failed, []);
  assert.deepEqual(calls, ['create P', 'create a', 'link #3 #10', 'link #2 #10']);
});

test('createWithSubtasks: a failing link is collected, the task stays, the rest still run', async () => {
  const create = async (): Promise<Task> => task({ id: '#10' });
  const linked: string[] = [];
  const setParent = async (id: string): Promise<Task> => {
    if (id === '#3') throw new Error('nope');
    linked.push(id);
    return task({ id });
  };
  const r = await createWithSubtasks(create, { title: 'P' }, [], {
    existing: [{ id: '#3', label: 'Loose' }, { id: '#2', label: 'Child' }],
    setParent,
  });
  assert.equal(r.task.id, '#10');
  assert.deepEqual(r.failed, [{ title: 'Loose', message: 'nope', kind: 'link' }]);
  assert.deepEqual(linked, ['#2']);
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
      { title: 'a', message: 'boom', kind: 'create' },
      { title: 'b', message: 'bang', kind: 'create' },
    ]),
    'Created #10, but 2 sub-tasks were not created: “a” (boom); “b” (bang).',
  );
  assert.equal(partialMessage('#10', [{ title: 'a', message: 'boom', kind: 'create' }]), 'Created #10, but 1 sub-task was not created: “a” (boom).');
});

test('partialMessage names existing tasks that were not linked', () => {
  assert.equal(
    partialMessage('#10', [{ title: 'L', message: 'nope', kind: 'link' }]),
    'Created #10, but 1 existing task was not linked under it: “L” (nope).',
  );
  assert.equal(
    partialMessage('#10', [
      { title: 'a', message: 'boom', kind: 'create' },
      { title: 'L', message: 'nope', kind: 'link' },
      { title: 'M', message: 'no', kind: 'link' },
    ]),
    'Created #10, but 1 sub-task was not created: “a” (boom); 2 existing tasks were not linked under it: “L” (nope); “M” (no).',
  );
});

test('isDirty: an untouched form (or one changed back, or only blank text) is clean', () => {
  assert.equal(isDirty(emptyDraft()), false);
  const initial = draft({ type: 'enhancement' });
  assert.equal(isDirty(draft({ type: 'enhancement' }), initial), false);
  assert.equal(isDirty(draft({ title: '   ', body: '\n', subtasks: ['', '  '] })), false);
  assert.equal(isDirty(draft({ start: { model: undefined } })), false);
});

test('isDirty: any typed text or changed choice makes the form dirty', () => {
  const initial = draft({ type: 'enhancement' });
  for (const over of [
    { title: 'x' },
    { body: 'why' },
    { subtasks: ['', 'a'] },
    { type: 'bug' },
    { parentId: 'p' },
    { state: 'ready-for-agent' as const },
    { blockedBy: ['b'] },
    { existing: ['#3'] },
    { start: { model: 'm' } },
  ]) {
    assert.equal(isDirty(draft({ type: 'enhancement', ...over }), initial), true, JSON.stringify(over));
  }
});

test('subtaskModes: "Add sub-task" offers a new task and/or the existing tasks that may be linked; none hides it', () => {
  assert.deepEqual(subtaskModes(true, 3), ['new', 'existing']);
  assert.deepEqual(subtaskModes(true, 0), ['new']);
  assert.deepEqual(subtaskModes(false, 2), ['existing']);
  assert.deepEqual(subtaskModes(false, 0), []);
});
