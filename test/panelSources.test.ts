import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceOr } from '../src/panel/sources.ts';

test('sourceOr: a chosen source stands; none or an unknown one falls back to the primary', () => {
  assert.equal(sourceOr('github', 'local'), 'github');
  assert.equal(sourceOr('', 'github'), 'github');
  assert.equal(sourceOr('jira', 'github'), 'github');
});
