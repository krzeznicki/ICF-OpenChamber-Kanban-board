import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectConfig, SourceInfo } from '../src/panel/api.ts';
import { changeSource, sourcesView, type SourceChange } from '../src/panel/sourceSettings.ts';

const CAPS = { create: true, subtasks: true, blockedBy: true, claim: true, delete: true };
const info = (id: 'local' | 'github'): SourceInfo => ({ id, label: id === 'local' ? 'Local' : 'GitHub', capabilities: CAPS });
const config = (primary: 'local' | 'github', ...others: Array<'local' | 'github'>): ProjectConfig => ({
  primary,
  sources: [primary, ...others].map(info),
  known: [info('local'), info('github')],
  labels: {},
});

test('sourcesView: the primary first and marked; only the others can be removed or made primary', () => {
  assert.deepEqual(sourcesView(config('local', 'github')), {
    rows: [
      { id: 'local', label: 'Local', primary: true, canRemove: false, canMakePrimary: false },
      { id: 'github', label: 'GitHub', primary: false, canRemove: true, canMakePrimary: true },
    ],
    addable: [],
  });
});

test('sourcesView: a source the project does not have yet can be added', () => {
  assert.deepEqual(sourcesView(config('github')).addable, [{ id: 'local', label: 'Local' }]);
  assert.deepEqual(sourcesView(config('local')).addable, [{ id: 'github', label: 'GitHub' }]);
});

/** A fake /config/sources: answers from `replies` in order and records each call. */
const fakeService = (replies: Array<{ config: ProjectConfig } | { confirm: string } | Error>) => {
  const calls: Array<{ change: SourceChange; force: boolean }> = [];
  return {
    calls,
    changeSources: async (change: SourceChange, force: boolean) => {
      calls.push({ change, force });
      const r = replies.shift()!;
      if (r instanceof Error) throw r;
      return r;
    },
  };
};

test('changeSource: a plain change answers the new config without asking', async () => {
  const service = fakeService([{ config: config('local', 'github') }]);
  const asked: string[] = [];
  const r = await changeSource(service, { add: 'github' }, async (m) => (asked.push(m), true));
  assert.deepEqual(r, config('local', 'github'));
  assert.deepEqual(asked, []);
  assert.deepEqual(service.calls, [{ change: { add: 'github' }, force: false }]);
});

test('changeSource: a hand-edited template asks first; yes sends it again with force', async () => {
  const service = fakeService([{ confirm: 'edited by hand' }, { config: config('github', 'local') }]);
  const asked: string[] = [];
  const r = await changeSource(service, { primary: 'github' }, async (m) => (asked.push(m), true));
  assert.deepEqual(r, config('github', 'local'));
  assert.deepEqual(asked, ['edited by hand']);
  assert.deepEqual(service.calls.map((c) => c.force), [false, true]);
});

test('changeSource: no to the question changes nothing and answers null', async () => {
  const service = fakeService([{ confirm: 'edited by hand' }]);
  assert.equal(await changeSource(service, { primary: 'github' }, async () => false), null);
  assert.equal(service.calls.length, 1);
});
