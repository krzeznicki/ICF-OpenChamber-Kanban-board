import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskState } from '../src/core/types.ts';
import { groupTasks } from '../src/panel/columns.ts';
import { filterBoard } from '../src/panel/search.ts';
import { keepSelected, layoutOf, locate, nextSelected, type Layout, type Selected } from '../src/panel/navigation.ts';

// Backlog a b c | Ready (empty) | In Progress x | Review p q r s | Done (empty)
const board: Layout = [['a', 'b', 'c'], [], ['x'], ['p', 'q', 'r', 's'], []];

const at = (layout: Layout, id: string): Selected => {
  const s = locate(layout, id);
  assert.ok(s !== null, `${id} is drawn`);
  return s;
};
const step = (id: string | null, dir: 'up' | 'down' | 'left' | 'right', layout: Layout = board): string | null =>
  nextSelected(layout, id === null ? null : at(layout, id), dir)?.id ?? null;

test('locate: column and row of a drawn card; null when it is not drawn', () => {
  assert.deepEqual(locate(board, 'r'), { id: 'r', column: 3, row: 2 });
  assert.equal(locate(board, 'gone'), null);
});

test('up and down move within the column and stop at its ends', () => {
  assert.equal(step('a', 'down'), 'b');
  assert.equal(step('b', 'down'), 'c');
  assert.equal(step('c', 'down'), 'c');
  assert.equal(step('b', 'up'), 'a');
  assert.equal(step('a', 'up'), 'a');
  assert.equal(step('x', 'down'), 'x');
});

test('left and right move between columns, skip empty ones and stop at the edges', () => {
  assert.equal(step('a', 'right'), 'x'); // Ready is empty
  assert.equal(step('x', 'left'), 'a');
  assert.equal(step('x', 'right'), 'p');
  assert.equal(step('a', 'left'), 'a');
  assert.equal(step('q', 'right'), 'q'); // Done is empty: nothing further right
});

test('left and right keep the row, or take the last card of a shorter column', () => {
  assert.equal(step('c', 'right'), 'x');
  assert.equal(step('s', 'left'), 'x');
  const wide: Layout = [['a', 'b', 'c'], ['d', 'e'], ['f', 'g', 'h', 'i']];
  assert.equal(step('b', 'right', wide), 'e');
  assert.equal(step('h', 'left', wide), 'e');
  assert.equal(step('e', 'right', wide), 'g');
});

test('nothing selected: any arrow selects the first card of the first column with cards', () => {
  assert.equal(step(null, 'down'), 'a');
  assert.equal(step(null, 'left'), 'a');
  assert.equal(nextSelected([[], ['k']], null, 'up')?.id, 'k');
  assert.equal(nextSelected([[], []], null, 'down'), null);
});

test('hidden sub-tasks and the search filter: only drawn cards are stepped through', () => {
  const t = (id: string, state: TaskState, parentId: string | null = null): Task => ({
    id,
    kind: 'ticket',
    title: id,
    body: '',
    state,
    type: null,
    parentId,
    blockedBy: [],
    url: null,
    updatedAt: 0,
    claimed: false,
  });
  const tasks = [t('p', 'needs-triage'), t('k', 'needs-triage', 'p'), t('n', 'needs-triage'), t('apple', 'ready-for-agent')];
  const shown = layoutOf(groupTasks(tasks, [], new Set(), false));
  assert.equal(step('p', 'down', shown), 'k');
  const hidden = layoutOf(groupTasks(tasks, [], new Set(), true));
  assert.equal(step('p', 'down', hidden), 'n');
  const searched = layoutOf(filterBoard(groupTasks(tasks, [], new Set(), false), tasks, 'apple', 'local'));
  assert.deepEqual(searched[0], []);
  assert.equal(step('apple', 'left', searched), 'apple');
  assert.equal(nextSelected(searched, null, 'down')?.id, 'apple');
});

test('keepSelected: a card still drawn keeps its selection at its new place (moved to another column)', () => {
  const before = at(board, 'b');
  const after: Layout = [['a', 'c'], [], ['x', 'b'], ['p', 'q', 'r', 's'], []];
  assert.deepEqual(keepSelected(after, before), { id: 'b', column: 2, row: 1 });
});

test('keepSelected: a vanished card falls back to the nearest card in its column', () => {
  const after: Layout = [['a', 'c'], [], ['x'], ['p', 'q', 'r', 's'], []];
  assert.equal(keepSelected(after, at(board, 'b'))?.id, 'c'); // the card that took its row
  const shorter: Layout = [['a', 'b'], [], ['x'], ['p', 'q', 'r', 's'], []];
  assert.equal(keepSelected(shorter, at(board, 'c'))?.id, 'b'); // it was last: the new last
});

test('keepSelected: its column emptied, the nearest column with cards takes over; an empty board selects nothing', () => {
  assert.equal(keepSelected([['a', 'b', 'c'], [], [], ['p', 'q', 'r', 's'], []], at(board, 'x'))?.id, 'p');
  // Backlog and Done are both two columns away: the earlier one wins.
  assert.equal(keepSelected([['a', 'b', 'c'], [], [], [], ['z']], at(board, 'x'))?.id, 'a');
  const nearer: Layout = [['a'], [], [], ['p', 'q'], ['z']];
  assert.equal(keepSelected(nearer, at(board, 's'))?.id, 'q');
  assert.equal(keepSelected([[], [], [], [], []], at(board, 'x')), null);
  assert.equal(keepSelected(board, null), null);
});

test('an arrow while the Selected card is gone lands on its fallback first', () => {
  const after: Layout = [['a', 'c'], [], ['x'], ['p', 'q', 'r', 's'], []];
  assert.equal(nextSelected(after, at(board, 'b'), 'down')?.id, 'c');
});
