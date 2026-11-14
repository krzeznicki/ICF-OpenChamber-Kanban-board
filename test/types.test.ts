import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrackerError } from '../src/core/types.ts';

test('TrackerError keeps its code and is an Error', () => {
  const err = new TrackerError('NOT_FOUND', 'no such task');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof TrackerError);
  assert.equal(err.code, 'NOT_FOUND');
  assert.equal(err.message, 'no such task');
  assert.equal(err.name, 'TrackerError');
});
