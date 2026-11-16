import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnForDigit, columnNeighbour } from '../src/panel/openTask.ts';
import type { Layout } from '../src/panel/navigation.ts';

// Backlog a b c | Ready (empty) | In Progress x | Review p q | Done (empty)
const board: Layout = [['a', 'b', 'c'], [], ['x'], ['p', 'q'], []];

test('Mod+↑/↓ step within the open task’s column in Board order', () => {
  assert.equal(columnNeighbour(board, 'b', 'prev'), 'a');
  assert.equal(columnNeighbour(board, 'b', 'next'), 'c');
  assert.equal(columnNeighbour(board, 'p', 'next'), 'q');
});

test('Mod+↑/↓ do nothing at the ends of the column (no wrapping)', () => {
  assert.equal(columnNeighbour(board, 'a', 'prev'), null);
  assert.equal(columnNeighbour(board, 'c', 'next'), null);
  assert.equal(columnNeighbour(board, 'x', 'prev'), null);
  assert.equal(columnNeighbour(board, 'x', 'next'), null);
});

test('Mod+↑/↓ never cross into another column', () => {
  assert.equal(columnNeighbour(board, 'q', 'next'), null);
  assert.equal(columnNeighbour(board, 'p', 'prev'), null);
});

test('a task that is not drawn (hidden sub-task, filtered out) has no neighbours', () => {
  assert.equal(columnNeighbour(board, 'hidden', 'next'), null);
  assert.equal(columnNeighbour(board, 'hidden', 'prev'), null);
});

test('Mod+N maps to Board column N when the modal offers that move', () => {
  const all = ['backlog', 'ready', 'in_progress', 'review', 'done'] as const;
  assert.equal(columnForDigit(1, all), 'backlog');
  assert.equal(columnForDigit(2, all), 'ready');
  assert.equal(columnForDigit(3, all), 'in_progress');
  assert.equal(columnForDigit(4, all), 'review');
  assert.equal(columnForDigit(5, all), 'done');
});

test('Mod+N does nothing for a column without a Move to button (its own, or one that cannot be moved to)', () => {
  assert.equal(columnForDigit(1, ['ready', 'done']), null);
  assert.equal(columnForDigit(4, ['ready', 'done']), null);
  assert.equal(columnForDigit(5, ['ready', 'done']), 'done');
});

test('Mod+N outside 1…5 maps to nothing', () => {
  const all = ['backlog', 'ready', 'in_progress', 'review', 'done'] as const;
  assert.equal(columnForDigit(0, all), null);
  assert.equal(columnForDigit(6, all), null);
  assert.equal(columnForDigit(1.5, all), null);
});
