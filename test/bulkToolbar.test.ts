import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBulkToolbar } from '../src/panel/bulkToolbar.ts';
import type { Task, TaskState } from '../src/core/types.ts';

const task = (id: string, parentId: string | null = null): Task => ({
  id, parentId, kind: 'ticket', title: id, body: '', state: 'needs-triage',
  type: 'enhancement', blockedBy: [], url: null, updatedAt: 0, claimed: false, source: 'local',
});
const setup = (tasks = [task('a'), task('b')]) => {
  const data = new Map(tasks.map(t => [t.id, { ...t }]));
  let visible = tasks.map(t => t.id);
  let marked: readonly string[] = [];
  let locked = false;
  let complete = true;
  let reloadError = false;
  const busy = new Set<string>();
  const failures = new Set<string>();
  const get = async (id: string): Promise<Task> => {
    if (failures.has(`${id}:read`)) throw new Error('Read failed');
    const t = data.get(id);
    if (!t) throw new Error('Missing');
    return { ...t };
  };
  const write = async (id: string, field: 'type' | 'state', value: string) => {
    if (failures.has(`${id}:${field}`)) throw new Error('Write failed');
    const t = await get(id);
    Object.assign(t, { [field]: value });
    data.set(id, t);
    return t;
  };
  const controller = createBulkToolbar({
    api: () => ({ get, setType: (id: string, type: string) => write(id, 'type', type),
      setState: (id: string, state: TaskState) => write(id, 'state', state) }),
    tasks: () => [...data.values()], visible: () => visible, busy: () => busy,
    complete: () => complete, changed: () => {},
    replace: (ids: readonly string[]) => { marked = ids; },
    retain: () => {}, lock: (value: boolean) => { locked = value; },
    reload: async () => { if (reloadError) throw new Error('Reload failed'); },
  });
  return { controller, data, busy, failures, get, marks: () => marked, locked: () => locked,
    visible: (ids: string[]) => { visible = ids; }, complete: (value: boolean) => { complete = value; },
    failReload: () => { reloadError = true; } };
};

test('toolbar requires marks and a chosen change before Apply', () => {
  const { controller: c } = setup();
  assert.equal(c.model().count, 0);
  c.selectionChanged(['a']);
  assert.equal(c.model().count, 1);
  assert.equal(c.model().canApply, false);
  c.setDraft({ type: 'bug' });
  assert.equal(c.model().canApply, true);
});

test('selection changes keep the draft, clearing resets it and successful Apply hides the toolbar', async () => {
  const s = setup();
  const c = s.controller;
  c.selectionChanged(['a']);
  c.setDraft({ type: 'bug', withChildren: false });
  c.selectionChanged(['a', 'b']);
  assert.equal(c.model().draft.type, 'bug');
  await c.apply();
  assert.equal((await s.get('b')).type, 'bug');
  assert.equal(c.model().count, 0);
  assert.deepEqual(s.marks(), []);
  c.selectionChanged(['a']);
  c.setDraft({ state: 'done' });
  c.clear();
  assert.deepEqual(c.model().draft, { state: null, type: null, withChildren: true });
});

test('failed hidden child is retained for retry without acquiring the selected parent type', async () => {
  const s = setup([task('p'), task('c', 'p')]);
  const c = s.controller;
  c.selectionChanged(['p']);
  c.setDraft({ type: 'bug', state: 'done' });
  assert.equal(c.model().extraCloseCount, 1);
  s.failures.add('c:state');
  await c.apply();
  assert.deepEqual(s.marks(), ['c', 'p']);
  s.visible(['p']);
  assert.equal(c.model().hiddenCount, 1);
  assert.equal(c.model().draft.type, 'bug');
  s.failures.clear();
  await c.apply();
  assert.equal((await s.get('c')).type, 'enhancement');
  assert.equal((await s.get('p')).state, 'done');
  assert.equal(c.model().count, 0);
});

test('a failed task stays marked even when hidden, with the draft kept, and a retry writes only what is left', async () => {
  const s = setup();
  const c = s.controller;
  c.selectionChanged(['a', 'b']);
  c.setDraft({ type: 'bug', state: 'needs-info' });
  s.failures.add('b:state');
  await c.apply();
  // b's type was saved, its state was not; the Backlog filter no longer draws it.
  s.visible(['a']);
  c.selectionChanged(s.marks());
  assert.deepEqual(s.marks(), ['b']);
  assert.equal(c.model().count, 1);
  assert.equal(c.model().hiddenCount, 1);
  assert.deepEqual(c.model().failures.map(f => [f.id, f.field]), [['b', 'state']]);
  assert.equal(c.model().draft.type, 'bug');
  assert.equal((await s.get('a')).state, 'needs-info');
  assert.equal((await s.get('b')).type, 'bug');
  s.failures.clear();
  await c.apply();
  assert.equal((await s.get('b')).state, 'needs-info');
  assert.equal(c.model().count, 0);
  assert.deepEqual(c.model().failures, []);
});

test('busy targets block Apply; saving locks mutations and duplicate Apply until completion', async () => {
  const s = setup();
  const c = s.controller;
  c.selectionChanged(['a']);
  c.setDraft({ type: 'bug' });
  s.busy.add('a');
  assert.equal(c.model().canApply, false);
  assert.match(c.model().blockReason ?? '', /being changed/i);
  await c.apply();
  assert.equal((await s.get('a')).type, 'enhancement');
  s.busy.clear();
  const pending = c.apply();
  assert.equal(s.locked(), true);
  assert.equal(c.model().locked, true);
  c.selectionChanged(['b']);
  c.setDraft({ type: 'chore' });
  c.clear();
  c.reset();
  await c.apply();
  await pending;
  assert.equal((await s.get('a')).type, 'bug');
  assert.equal((await s.get('b')).type, 'enhancement');
  assert.equal(s.locked(), false);
});

test('incomplete source lists and missing targets block changes without crashing the model', async () => {
  const s = setup();
  s.controller.selectionChanged(['a']);
  s.controller.setDraft({ state: 'done' });
  s.complete(false);
  assert.equal(s.controller.model().canApply, false);
  await s.controller.apply();
  assert.equal((await s.get('a')).state, 'needs-triage');
  s.complete(true);
  s.controller.selectionChanged(['missing']);
  assert.equal(s.controller.model().canApply, false);
  assert.match(s.controller.model().blockReason ?? '', /not found/i);
});

test('read and reload failures unlock the board and remain visible to the user', async () => {
  const s = setup();
  s.controller.selectionChanged(['a']);
  s.controller.setDraft({ type: 'bug' });
  s.failures.add('a:read');
  await s.controller.apply();
  assert.equal(s.locked(), false);
  assert.equal(s.controller.model().failures[0]?.field, 'read');
  s.failures.clear();
  s.failReload();
  await s.controller.apply();
  assert.equal(s.locked(), false);
  assert.match(s.controller.model().notice ?? '', /Reload failed/);
  assert.equal((await s.get('a')).type, 'bug');
});

test('editing the draft after failure starts a fresh explicit selection', async () => {
  const s = setup();
  s.controller.selectionChanged(['a', 'b']);
  s.controller.setDraft({ type: 'bug' });
  s.failures.add('a:type');
  await s.controller.apply();
  s.failures.clear();
  s.controller.setDraft({ type: 'chore' });
  await s.controller.apply();
  assert.equal((await s.get('a')).type, 'chore');
  assert.equal((await s.get('b')).type, 'bug');
});

test('a save of an ancestor blocks editing its descendants until it finishes', async () => {
  const s = setup([task('p'), task('c', 'p'), task('g', 'c')]);
  s.busy.add('p');
  const c = s.controller;
  c.selectionChanged(['g']);
  c.setDraft({ state: 'needs-info' });
  assert.equal(c.model().canApply, false);
  assert.match(c.model().blockReason ?? '', /being changed/i);
  await c.apply();
  assert.equal((await s.get('g')).state, 'needs-triage');
  s.busy.clear();
  assert.equal(c.model().canApply, true);
  await c.apply();
  assert.equal((await s.get('g')).state, 'needs-info');
});
