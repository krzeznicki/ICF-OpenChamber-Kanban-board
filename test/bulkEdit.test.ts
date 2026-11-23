import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskState } from '../src/core/types.ts';
import { planBulk, runBulk } from '../src/panel/bulkEdit.ts';

const task = (id: string, parentId: string | null = null): Task => ({
  id, parentId, kind: 'ticket', title: id, body: '', state: 'needs-triage',
  type: 'enhancement', blockedBy: [], url: null, updatedAt: 0, claimed: false, source: 'local',
});

// The external service boundary: mutable storage with public reads and injectable write failures.
const store = (tasks: Task[]) => {
  const rows = new Map(tasks.map(t => [t.id, { ...t }]));
  const failures = new Set<string>();
  const writes: string[] = [];
  const get = async (id: string): Promise<Task> => {
    const t = rows.get(id);
    if (!t) throw new Error('Task not found');
    return { ...t };
  };
  const write = async (id: string, field: 'type' | 'state', value: string): Promise<Task> => {
    if (failures.has(`${id}:${field}`)) throw new Error('Write refused');
    const t = await get(id);
    writes.push(`${id}:${field}`);
    Object.assign(t, { [field]: value });
    rows.set(id, t);
    return t;
  };
  return { failures, writes, api: { get, setType: (id: string, type: string) => write(id, 'type', type),
    setState: (id: string, state: TaskState) => write(id, 'state', state) } };
};

test('applies selected type and state to each marked task', async () => {
  const tasks = [task('a'), task('b')];
  const s = store(tasks);
  const plan = planBulk(tasks, ['a', 'b'], { type: 'bug', state: 'needs-info', withChildren: true });
  const result = await runBulk(plan, s.api, () => {});
  assert.deepEqual(result, { succeeded: ['a', 'b'], failures: [] });
  for (const id of ['a', 'b']) {
    const saved = await s.api.get(id);
    assert.equal(saved.type, 'bug');
    assert.equal(saved.state, 'needs-info');
  }
});

test('a failed type keeps that task state unchanged while other tasks succeed', async () => {
  const tasks = [task('a'), task('b')];
  const s = store(tasks);
  s.failures.add('a:type');
  const plan = planBulk(tasks, ['a', 'b'], { type: 'bug', state: 'done', withChildren: false });
  const result = await runBulk(plan, s.api, () => {});
  assert.deepEqual(result.succeeded, ['b']);
  assert.deepEqual(result.failures.map(f => [f.id, f.field]), [['a', 'type']]);
  assert.equal((await s.api.get('a')).state, 'needs-triage');
  assert.equal((await s.api.get('b')).state, 'done');
});

test('state failure preserves type and retry skips successful fields and tasks', async () => {
  const tasks = [task('a'), task('b')];
  const s = store(tasks);
  const plan = planBulk(tasks, ['a', 'b'], { type: 'bug', state: 'needs-info', withChildren: false });
  s.failures.add('a:state');
  const first = await runBulk(plan, s.api, () => {});
  assert.equal((await s.api.get('a')).type, 'bug');
  assert.deepEqual(first.failures.map(f => f.field), ['state']);
  s.failures.clear();
  // Successful writes must not be repeated even if they would now be refused.
  s.failures.add('a:type');
  s.failures.add('b:type');
  s.failures.add('b:state');
  const result = await runBulk(plan, s.api, () => {}, ['a']);
  assert.deepEqual(result, { succeeded: ['a'], failures: [] });
  assert.equal((await s.api.get('a')).state, 'needs-info');
});

test('recursive close reaches grandchildren once and never changes implicit child types', async () => {
  const tasks = [task('p'), task('c', 'p'), task('g', 'c'), task('other')];
  const s = store(tasks);
  const plan = planBulk(tasks, ['p', 'c', 'p'], { type: 'bug', state: 'done', withChildren: true });
  assert.deepEqual(plan.closeIds, ['g', 'c', 'p']);
  const result = await runBulk(plan, s.api, () => {});
  assert.deepEqual(result, { succeeded: ['g', 'c', 'p'], failures: [] });
  assert.equal((await s.api.get('g')).type, 'enhancement');
  assert.equal((await s.api.get('c')).type, 'bug');
  assert.equal((await s.api.get('p')).state, 'done');
  assert.equal((await s.api.get('other')).state, 'needs-triage');
  assert.deepEqual(s.writes, ['g:state', 'c:type', 'c:state', 'p:type', 'p:state']);
});

test('failed descendant leaves ancestors open and can be retried without changing its type', async () => {
  const tasks = [task('p'), task('c', 'p'), task('g', 'c'), task('other')];
  const s = store(tasks);
  s.failures.add('g:state');
  const plan = planBulk(tasks, ['p', 'other'], { type: 'bug', state: 'done', withChildren: true });
  const result = await runBulk(plan, s.api, () => {});
  assert.deepEqual(result.succeeded, ['other']);
  assert.deepEqual(result.failures.map(f => f.id), ['g', 'c', 'p']);
  assert.equal((await s.api.get('p')).state, 'needs-triage');
  assert.equal((await s.api.get('c')).state, 'needs-triage');
  assert.equal((await s.api.get('p')).type, 'bug');
  s.failures.clear();
  const retry = await runBulk(plan, s.api, () => {}, result.failures.map(f => f.id));
  assert.equal(retry.failures.length, 0);
  assert.equal((await s.api.get('g')).type, 'enhancement');
  assert.equal((await s.api.get('p')).state, 'done');
});

test('refuses unknown targets and cyclic trees rather than promising an incomplete close', () => {
  const draft = { state: 'done' as const, type: null, withChildren: true };
  assert.throws(() => planBulk([task('a')], ['missing'], draft), /not found/i);
  assert.throws(() => planBulk([task('a', 'b'), task('b', 'a')], ['a'], draft), /cycle/i);
});
