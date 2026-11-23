import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickMarks, dragGroup, keepMarks, NO_MARKS } from '../src/panel/marks.ts';

// backlog: a b c · ready: (empty) · in progress: d e
const layout = [['a', 'b', 'c'], [], ['d', 'e'], [], []];

test('Mod+click toggles one card and makes it the anchor', () => {
  const one = clickMarks(NO_MARKS, layout, 'b', 'toggle');
  assert.deepEqual(one, { ids: ['b'], anchor: 'b', base: ['b'] });
  const two = clickMarks(one, layout, 'd', 'toggle');
  assert.deepEqual(two, { ids: ['b', 'd'], anchor: 'd', base: ['b', 'd'] });
  assert.deepEqual(clickMarks(two, layout, 'b', 'toggle'), { ids: ['d'], anchor: 'b', base: ['d'] });
});

test('Shift+click marks every card from the anchor to the clicked one, in board order, both ways', () => {
  const from = clickMarks(NO_MARKS, layout, 'b', 'toggle');
  assert.deepEqual(clickMarks(from, layout, 'd', 'range').ids, ['b', 'c', 'd']);
  const back = clickMarks(clickMarks(NO_MARKS, layout, 'e', 'toggle'), layout, 'b', 'range');
  assert.deepEqual(back, { ids: ['b', 'c', 'd', 'e'], anchor: 'e', base: ['e'] });
});

test('Shift+click adds the range to cards marked before; the anchor stays', () => {
  const marks = clickMarks(clickMarks(NO_MARKS, layout, 'e', 'toggle'), layout, 'a', 'toggle');
  assert.deepEqual(clickMarks(marks, layout, 'c', 'range'), { ids: ['a', 'b', 'c', 'e'], anchor: 'a', base: ['e', 'a'] });
});

test('Shift+click without an anchor starts from the fallback (the Selected card), or marks just the card', () => {
  assert.deepEqual(clickMarks(NO_MARKS, layout, 'c', 'range', 'a').ids, ['a', 'b', 'c']);
  assert.deepEqual(clickMarks(NO_MARKS, layout, 'c', 'range'), { ids: ['c'], anchor: 'c', base: [] });
});

test('keepMarks drops cards no longer drawn, and an anchor that went', () => {
  const marks = { ids: ['a', 'x', 'd'], anchor: 'x', base: ['x'] };
  assert.deepEqual(keepMarks(marks, layout), { ids: ['a', 'd'], anchor: null, base: [] });
  const same = { ids: ['a'], anchor: 'a', base: ['a'] };
  assert.equal(keepMarks(same, layout), same);
});

test('dragGroup: a marked card drags every marked card that is not busy, in board order; an unmarked card only itself', () => {
  const marks = { ids: ['d', 'a', 'c'], anchor: 'c', base: ['d', 'a', 'c'] };
  assert.deepEqual(dragGroup(marks, layout, 'c', new Set()), ['a', 'c', 'd']);
  assert.deepEqual(dragGroup(marks, layout, 'c', new Set(['a'])), ['c', 'd']);
  assert.deepEqual(dragGroup(marks, layout, 'b', new Set()), ['b']);
});

test('a second Shift+click replaces the range from the same anchor (it can shrink); Mod-marked cards stay', () => {
  const start = clickMarks(clickMarks(NO_MARKS, layout, 'e', 'toggle'), layout, 'a', 'toggle');
  const wide = clickMarks(start, layout, 'c', 'range');
  assert.deepEqual(wide.ids, ['a', 'b', 'c', 'e']);
  const narrow = clickMarks(wide, layout, 'b', 'range');
  assert.deepEqual(narrow.ids, ['a', 'b', 'e']);
  // A Mod+click after a range keeps that range and starts a new anchor.
  const next = clickMarks(narrow, layout, 'd', 'toggle');
  assert.deepEqual(clickMarks(next, layout, 'e', 'range').ids, ['a', 'b', 'd', 'e']);
});
