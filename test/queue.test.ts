import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextToStart } from '../src/panel/queue.ts';

test('nextToStart: limit 3, 2 running, 3 queued -> the first one', () => {
  assert.deepEqual(nextToStart(['a', 'b', 'c'], 2, 3), ['a']);
});

test('nextToStart: limit 3, 0 running -> the first three', () => {
  assert.deepEqual(nextToStart(['a', 'b', 'c', 'd'], 0, 3), ['a', 'b', 'c']);
});

test('nextToStart: order is kept; nothing starts at or over the limit', () => {
  assert.deepEqual(nextToStart(['z', 'a', 'm'], 1, 3), ['z', 'a']);
  assert.deepEqual(nextToStart(['a'], 3, 3), []);
  assert.deepEqual(nextToStart(['a'], 5, 3), []);
  assert.deepEqual(nextToStart([], 0, 3), []);
});
