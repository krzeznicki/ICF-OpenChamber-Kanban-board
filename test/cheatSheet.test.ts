import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheatSheetGroups } from '../src/panel/cheatSheet.ts';
import { createKeymap } from '../src/panel/keymap.ts';

test('groups every Shortcut by Shortcut context, in table order, fixed keys included', () => {
  const groups = cheatSheetGroups(createKeymap(), 'mac');
  assert.deepEqual(
    groups.map((g) => g.title),
    ['Board', 'Open task', 'Add task'],
  );
  const board = groups[0]!.rows;
  assert.deepEqual(board[0], { id: 'board.addTask', label: 'Add task', keys: '⌘A' });
  assert.ok(board.some((r) => r.id === 'board.cheatSheet' && r.keys === '?'));
  assert.ok(board.some((r) => r.id === 'board.selectUp' && r.keys === '↑'));
  assert.deepEqual(groups[2]!.rows, [{ id: 'add.create', label: 'Create task', keys: '⌘↩' }]);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  assert.equal(total, createKeymap().all().length);
});

test('shows Ctrl on Windows and Linux', () => {
  const [board] = cheatSheetGroups(createKeymap(), 'other');
  assert.equal(board!.rows[0]!.keys, 'Ctrl+A');
});

test('a rebinding shows in the cheat sheet', () => {
  const [board] = cheatSheetGroups(createKeymap({ 'board.addTask': 'Mod+Shift+N' }), 'mac');
  assert.equal(board!.rows.find((r) => r.id === 'board.addTask')!.keys, '⇧⌘N');
});
