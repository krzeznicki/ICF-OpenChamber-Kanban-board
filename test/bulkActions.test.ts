import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewAction, runAction, type ActionDeps } from '../src/panel/bulkActions.ts';
import type { Task } from '../src/core/types.ts';

const t = (id: string, parentId: string | null = null): Task => ({
  id, parentId, title: id, kind: parentId ? 'ticket' : 'parent', state: 'needs-triage',
  source: 'local', body: '', type: null, blockedBy: [], url: null, claimed: false, updatedAt: 0,
});
const context = { archived: new Set<string>(), busy: new Set<string>(), complete: true, sources: [
  { id: 'local' as const, label: 'Local', capabilities: { create: true, subtasks: true, blockedBy: true, claim: true, delete: true } },
  { id: 'github' as const, label: 'GitHub', capabilities: { create: true, subtasks: true, blockedBy: true, claim: true, delete: true, labels: true } },
] };
const setup = (tasks: Task[]) => {
  const data = new Map(tasks.map(t => [t.id, t]));
  let clipboard = '';
  const deps: ActionDeps = {
    tasks: () => [...data.values()],
    context: () => context,
    api: {
      get: async id => { const value = data.get(id); if (!value) throw new Error('Missing'); return value; },
      changeLabel: async id => data.get(id)!,
      addBlocker: async id => data.get(id)!,
      setParent: async (id, parentId) => {
        if (id === 'bad') throw new Error('Denied');
        const task = { ...data.get(id)!, parentId, id: `new-${id}` };
        data.delete(id); data.set(task.id, task); return task;
      },
      removeParent: async id => data.get(id)!,
      remove: async id => { data.delete(id); return [id]; },
    },
    move: async id => ({ kind: 'success', id }),
    start: async id => ({ kind: 'pending', id, message: 'Uncertain start' }),
    archive: async () => {},
    remap: async () => {},
    deleted: async () => {},
    copy: async text => { clipboard = text; },
  };
  return { data, deps, clipboard: () => clipboard };
};
test('mixed label selection explains exclusions and never executes an unconfirmed target', async () => {
  const tasks = [t('local'), { ...t('#1'), source: 'github' as const }];
  const a = { kind: 'label' as const, label: 'urgent', mode: 'add' as const };
  const p = previewAction(a, tasks, ['local', '#1'], context);
  assert.deepEqual(p.eligible, ['#1']);
  assert.match(p.excluded[0]!.reason, /label/i);
  const s = setup(tasks);
  const r = await runAction(a, ['local'], s.deps);
  assert.equal(r.succeeded.length, 0);
  assert.equal(r.failures.length, 1);
});
test('parent changes return new IDs, preserve failures and reject selected destination/cycles', async () => {
  const tasks = [t('a', 'old'), t('bad', 'old'), t('p')];
  const s = setup(tasks);
  const r = await runAction({ kind: 'parent', parentId: 'p' }, ['a', 'bad'], s.deps);
  assert.deepEqual(r.remapped, [{ from: 'a', to: 'new-a' }]);
  assert.deepEqual(r.failures.map(f => f.id), ['bad']);
  assert.equal(previewAction({ kind: 'parent', parentId: 'p' }, tasks, ['a', 'p'], context).eligible.length, 0);
  assert.equal(previewAction({ kind: 'parent', parentId: 'child' }, [t('p'), t('child', 'p')], ['p'], context).eligible.length, 0);
});

test('an empty local feature can become a sub-task but a feature with children cannot', () => {
  const action = { kind: 'parent' as const, parentId: 'destination' };
  assert.deepEqual(previewAction(action, [t('empty'), t('destination')], ['empty'], context).eligible, ['empty']);
  assert.equal(previewAction(action, [t('p'), t('child', 'p'), t('destination')], ['p'], context).eligible.length, 0);
});
test('recursive deletion deduplicates parent and child and blocks ancestors after a child failure', async () => {
  const s = setup([t('p'), t('c', 'p'), t('g', 'c')]);
  const deleted: string[] = [];
  s.deps.api.remove = async id => {
    if (id === 'c') throw new Error('Denied');
    deleted.push(id); s.data.delete(id); return [id];
  };
  const r = await runAction({ kind: 'delete', withChildren: true }, ['p', 'c'], s.deps);
  assert.deepEqual(deleted, ['g']);
  assert.deepEqual(r.failures.map(f => f.id), ['c', 'p']);
  const incomplete = previewAction({ kind: 'delete', withChildren: true }, [{ ...t('#1'), source: 'github', childCount: 1 }], ['#1'], context);
  assert.equal(incomplete.eligible.length, 0);
});
test('copy preserves order and uses paths for local tasks; errors and uncertain starts remain explicit', async () => {
  const s = setup([t('local'), { ...t('#1'), source: 'github', url: 'https://github.com/o/r/issues/1' }]);
  await runAction({ kind: 'copy', format: 'links' }, ['#1', 'local'], s.deps);
  assert.equal(s.clipboard(), 'https://github.com/o/r/issues/1\nlocal');
  s.deps.copy = async () => { throw new Error('Clipboard unavailable'); };
  assert.equal((await runAction({ kind: 'copy', format: 'titles' }, ['local'], s.deps)).failures.length, 1);
  assert.equal((await runAction({ kind: 'start' }, ['local'], s.deps)).pending.length, 1);
});
