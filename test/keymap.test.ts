import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_CONTEXTS,
  bindingOf,
  bindingToString,
  createKeymap,
  formatBinding,
  isReloadKey,
  parseBinding,
  parseOverrides,
  platformOf,
  pressFromEvent,
  resetOverride,
  setOverride,
  type KeyInput,
  type Overrides,
} from '../src/panel/keymap.ts';

/** A keydown as the dispatcher reports it; Cmd on mac unless said otherwise. */
const key = (k: string, more: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  meta: false,
  ctrl: false,
  shift: false,
  alt: false,
  context: 'board',
  inTextField: false,
  composing: false,
  platform: 'mac',
  ...more,
});
const cmd = (k: string, more: Partial<KeyInput> = {}): KeyInput => key(k, { meta: true, ...more });
const ctrl = (k: string, more: Partial<KeyInput> = {}): KeyInput => key(k, { ctrl: true, platform: 'other', ...more });

test('resolve: the default Shortcuts of each context, with Cmd on macOS', () => {
  const km = createKeymap();
  assert.equal(km.resolve(cmd('a')), 'board.addTask');
  assert.equal(km.resolve(cmd('s')), 'board.toggleSubtasks');
  assert.equal(km.resolve(cmd('ArrowLeft', { shift: true })), 'board.moveCardPrev');
  assert.equal(km.resolve(cmd('ArrowRight', { shift: true })), 'board.moveCardNext');
  assert.equal(km.resolve(cmd('k')), 'board.projects');
  assert.equal(km.resolve(cmd(',')), 'board.settings');
  assert.equal(km.resolve(cmd('R', { shift: true })), 'board.refresh');
  assert.equal(km.resolve(cmd('f')), 'board.search');
  const task = { context: 'task' } as const;
  assert.equal(km.resolve(cmd('ArrowUp', task)), 'task.prev');
  assert.equal(km.resolve(cmd('ArrowDown', task)), 'task.next');
  assert.equal(km.resolve(cmd('e', task)), 'task.edit');
  assert.equal(km.resolve(cmd('Enter', task)), 'task.saveEdit');
  assert.equal(km.resolve(cmd('s', task)), 'task.addSubtask');
  assert.equal(km.resolve(cmd('p', task)), 'task.pickParent');
  assert.equal(km.resolve(cmd('1', task)), 'task.state1');
  assert.equal(km.resolve(cmd('5', task)), 'task.state5');
  assert.equal(km.resolve(cmd('o', task)), 'task.openSession');
  assert.equal(km.resolve(cmd('Backspace', task)), 'task.delete');
  assert.equal(km.resolve(cmd('Enter', { context: 'add' })), 'add.create');
});

test('resolve: the same key means what its context says, and nothing outside it', () => {
  const km = createKeymap();
  assert.equal(km.resolve(cmd('a', { context: 'task' })), null);
  assert.equal(km.resolve(cmd('Enter')), null);
  assert.equal(km.resolve(cmd('a', { context: null })), null);
  // Extra or missing modifiers do not match.
  assert.equal(km.resolve(cmd('a', { shift: true })), null);
  assert.equal(km.resolve(cmd('a', { alt: true })), null);
  assert.equal(km.resolve(cmd('R')), null);
  assert.equal(km.resolve(key('a')), null);
});

test('resolve: Ctrl is Mod on Windows and Linux; Cmd is not, and Ctrl is not Mod on macOS', () => {
  const km = createKeymap();
  assert.equal(km.resolve(ctrl('a')), 'board.addTask');
  assert.equal(km.resolve(ctrl('Enter', { context: 'add' })), 'add.create');
  assert.equal(km.resolve(ctrl('R', { shift: true })), 'board.refresh');
  assert.equal(km.resolve(key('a', { meta: true, platform: 'other' })), null);
  assert.equal(km.resolve(key('a', { ctrl: true, platform: 'mac' })), null);
  assert.equal(km.resolve(key('a', { ctrl: true, meta: true, platform: 'mac' })), null);
});

test('resolve: Mod+A is left to the text field (select all); other Mod Shortcuts work there', () => {
  const km = createKeymap();
  assert.equal(km.resolve(cmd('a', { inTextField: true })), null);
  assert.equal(km.resolve(ctrl('a', { inTextField: true })), null);
  assert.equal(km.resolve(cmd('Enter', { context: 'add', inTextField: true })), 'add.create');
  assert.equal(km.resolve(cmd('e', { context: 'task', inTextField: true })), 'task.edit');
  // Even when Mod+A is rebound to another action.
  const moved = createKeymap({ 'board.search': 'Mod+a', 'board.addTask': 'Mod+j' });
  assert.equal(moved.resolve(cmd('a', { inTextField: true })), null);
  assert.equal(moved.resolve(cmd('a')), 'board.search');
});

test('resolve: fixed keys on the Board, but never in a text field', () => {
  const km = createKeymap();
  assert.equal(km.resolve(key('ArrowDown')), 'board.selectDown');
  assert.equal(km.resolve(key('ArrowLeft')), 'board.selectLeft');
  assert.equal(km.resolve(key('Enter')), 'board.openSelected');
  // `?` is Shift+/ on most layouts; Shift belongs to the symbol.
  assert.equal(km.resolve(key('?', { shift: true })), 'board.cheatSheet');
  assert.equal(km.resolve(key('ArrowDown', { inTextField: true })), null);
  assert.equal(km.resolve(key('?', { shift: true, inTextField: true })), null);
  assert.equal(km.resolve(key('Enter', { context: 'task' })), null);
  // A plain letter is never a Shortcut.
  assert.equal(km.resolve(key('a')), null);
});

test('resolve: nothing fires during an IME composition', () => {
  const km = createKeymap();
  assert.equal(km.resolve(cmd('a', { composing: true })), null);
  assert.equal(km.resolve(cmd('Enter', { context: 'add', composing: true, inTextField: true })), null);
  assert.equal(km.resolve(key('Enter', { composing: true })), null);
});

test('resolve: Option on macOS changes the character; the physical key is matched', () => {
  const km = createKeymap({ 'board.search': 'Mod+Alt+f' });
  assert.equal(km.resolve(cmd('ƒ', { alt: true, code: 'KeyF' })), 'board.search');
  assert.equal(km.resolve(cmd('f')), null);
});

test('overrides replace the default; the old key is free; reset brings the default back', () => {
  let overrides = setOverride({}, 'board.addTask', { key: 'j', mod: true, shift: false, alt: false });
  assert.deepEqual(overrides, { 'board.addTask': 'Mod+j' });
  const km = createKeymap(overrides);
  assert.equal(km.resolve(cmd('j')), 'board.addTask');
  assert.equal(km.resolve(cmd('a')), null);
  assert.equal(km.overridden('board.addTask'), true);
  assert.equal(km.overridden('board.search'), false);
  overrides = resetOverride(overrides, 'board.addTask');
  assert.deepEqual(overrides, {});
  assert.equal(createKeymap(overrides).resolve(cmd('a')), 'board.addTask');
  // Binding back to the default stores nothing.
  assert.deepEqual(setOverride({ 'board.addTask': 'Mod+j' }, 'board.addTask', { key: 'a', mod: true, shift: false, alt: false }), {});
});

test('overrides read defensively: unknown actions, fixed keys and unreadable bindings are dropped', () => {
  assert.deepEqual(parseOverrides(null), {});
  assert.deepEqual(parseOverrides(['Mod+a']), {});
  assert.deepEqual(
    parseOverrides({ 'board.addTask': 'Mod+Shift+J', 'nope.action': 'Mod+x', 'board.selectUp': 'Mod+u', 'task.edit': 42, 'task.next': 'Mod+Hyper+x', 'add.create': 'Mod+' }),
    { 'board.addTask': 'Mod+Shift+j' },
  );
  // A fixed key cannot be overridden through the Keymap either.
  assert.equal(createKeymap({ 'board.selectUp': 'Mod+u' } as Overrides).resolve(key('ArrowUp')), 'board.selectUp');
});

test('bindings round-trip through their stored text', () => {
  for (const s of DEFAULT_SHORTCUTS) assert.deepEqual(parseBinding(bindingToString(s.binding)), s.binding, s.id);
  assert.equal(bindingToString({ key: '+', mod: true, shift: false, alt: true }), 'Mod+Alt+Plus');
  assert.deepEqual(parseBinding('Mod+Alt+Plus'), { key: '+', mod: true, shift: false, alt: true });
  assert.equal(parseBinding('Mod+Mod+a'), null);
  assert.equal(parseBinding('Mod+Shift'), null);
});

test('validate: a modifier is required', () => {
  const km = createKeymap();
  assert.deepEqual(km.validate('board.addTask', { key: 'j', mod: false, shift: false, alt: false }), { ok: false, reason: 'no-modifier' });
  assert.deepEqual(km.validate('board.addTask', { key: 'j', mod: false, shift: true, alt: true }), { ok: false, reason: 'no-modifier' });
  assert.deepEqual(km.validate('board.addTask', { key: 'j', mod: true, shift: false, alt: false }), { ok: true, warning: null });
  // Recording Ctrl+J on macOS makes no Mod binding, so it is refused the same way.
  const recorded = bindingOf({ key: 'j', meta: false, ctrl: true, shift: false, alt: false, platform: 'mac' });
  assert.deepEqual(km.validate('board.addTask', recorded!), { ok: false, reason: 'no-modifier' });
});

test('validate: a key held by another Shortcut in the same context is refused, naming it', () => {
  const km = createKeymap();
  const v = km.validate('board.addTask', { key: 'k', mod: true, shift: false, alt: false });
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.reason === 'duplicate' && v.holder.label, 'Project switcher');
  // The same key in another context is fine (Mod+S means different things on the Board and in a task).
  assert.deepEqual(km.validate('task.edit', { key: 'k', mod: true, shift: false, alt: false }), { ok: true, warning: null });
  // Its own current key is not a duplicate.
  assert.deepEqual(km.validate('board.addTask', { key: 'a', mod: true, shift: false, alt: false }), { ok: true, warning: null });
  // An override counts: Mod+J taken by the Project switcher is refused for Search.
  const moved = createKeymap({ 'board.projects': 'Mod+j' });
  const w = moved.validate('board.search', { key: 'j', mod: true, shift: false, alt: false });
  assert.equal(!w.ok && w.reason === 'duplicate' && w.holder.id, 'board.projects');
  // and the freed default is available.
  assert.deepEqual(moved.validate('board.search', { key: 'k', mod: true, shift: false, alt: false }), { ok: true, warning: null });
});

test('validate: Mod+W, Q, R, T and N warn that the app may take them first', () => {
  const km = createKeymap();
  for (const k of ['w', 'q', 'r', 't', 'n']) {
    assert.deepEqual(km.validate('board.search', { key: k, mod: true, shift: false, alt: false }), { ok: true, warning: 'reserved' }, k);
  }
  assert.deepEqual(km.validate('board.search', { key: 'r', mod: true, shift: true, alt: false }), { ok: false, reason: 'duplicate', holder: km.get('board.refresh') });
  // Only a plain Mod+letter is what the app takes: with Shift or Alt it does not warn.
  assert.deepEqual(km.validate('task.edit', { key: 'r', mod: true, shift: true, alt: false }), { ok: true, warning: null });
  assert.deepEqual(km.validate('board.search', { key: 'w', mod: true, shift: false, alt: true }), { ok: true, warning: null });
});

test('validate: the keys a text field keeps (select all, clipboard, undo) are refused', () => {
  const km = createKeymap();
  for (const k of ['c', 'v', 'x', 'z']) {
    assert.deepEqual(km.validate('task.edit', { key: k, mod: true, shift: false, alt: false }), { ok: false, reason: 'text-field' }, k);
  }
  assert.deepEqual(km.validate('task.edit', { key: 'a', mod: true, shift: false, alt: false }), { ok: false, reason: 'text-field' });
  // With Shift or Alt the field has no meaning for it.
  assert.deepEqual(km.validate('task.edit', { key: 'z', mod: true, shift: true, alt: false }), { ok: true, warning: null });
  assert.deepEqual(km.validate('task.edit', { key: 'c', mod: true, shift: false, alt: true }), { ok: true, warning: null });
  // Add task's own default Mod+A stays allowed, also back from another key.
  const moved = createKeymap({ 'board.addTask': 'Mod+j' });
  assert.deepEqual(moved.validate('board.addTask', { key: 'a', mod: true, shift: false, alt: false }), { ok: true, warning: null });
});

test('Esc on the Board is listed as a fixed key but never resolved, so its own handling stays', () => {
  const km = createKeymap();
  const esc = km.list('board').find((s) => s.binding.key === 'Escape');
  assert.equal(esc?.fixed, true);
  assert.equal(esc?.label, 'Leave search / close dialog');
  for (const context of ['board', 'task', 'add'] as const) {
    assert.equal(km.resolve(key('Escape', { context })), null, context);
    assert.equal(km.resolve(key('Escape', { context, inTextField: true })), null, context);
  }
  assert.equal(km.label(esc!.id, 'mac'), 'Esc');
  assert.deepEqual(km.validate(esc!.id, { key: 'j', mod: true, shift: false, alt: false }), { ok: false, reason: 'fixed' });
});

test('pressFromEvent: a keydown read into what the Keymap takes', () => {
  const e = { key: 'R', code: 'KeyR', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false };
  assert.deepEqual(pressFromEvent(e, 'mac'), { key: 'R', code: 'KeyR', meta: true, ctrl: false, shift: true, alt: false, platform: 'mac' });
  assert.deepEqual(bindingOf(pressFromEvent(e, 'mac')), { key: 'r', mod: true, shift: true, alt: false });
});

test('SHORTCUT_CONTEXTS: the contexts in listing order, with their names', () => {
  assert.deepEqual(SHORTCUT_CONTEXTS, [
    { context: 'board', label: 'Board' },
    { context: 'task', label: 'Open task' },
    { context: 'add', label: 'Add task' },
  ]);
});

test('validate: fixed keys cannot be rebound', () => {
  assert.deepEqual(createKeymap().validate('board.selectUp', { key: 'u', mod: true, shift: false, alt: false }), { ok: false, reason: 'fixed' });
});

test('formatBinding: ⌘ symbols on macOS, Ctrl+… elsewhere', () => {
  const km = createKeymap();
  assert.equal(km.label('board.addTask', 'mac'), '⌘A');
  assert.equal(km.label('board.addTask', 'other'), 'Ctrl+A');
  assert.equal(km.label('board.refresh', 'mac'), '⇧⌘R');
  assert.equal(km.label('board.refresh', 'other'), 'Ctrl+Shift+R');
  assert.equal(km.label('board.moveCardNext', 'other'), 'Ctrl+Shift+→');
  assert.equal(km.label('add.create', 'mac'), '⌘↩');
  assert.equal(km.label('add.create', 'other'), 'Ctrl+Enter');
  assert.equal(km.label('task.delete', 'mac'), '⌘⌫');
  assert.equal(km.label('task.delete', 'other'), 'Ctrl+Backspace');
  assert.equal(km.label('board.settings', 'mac'), '⌘,');
  assert.equal(km.label('board.cheatSheet', 'mac'), '?');
  assert.equal(formatBinding({ key: 'f', mod: true, shift: false, alt: true }, 'mac'), '⌥⌘F');
  assert.equal(formatBinding({ key: 'f', mod: true, shift: false, alt: true }, 'other'), 'Ctrl+Alt+F');
  assert.equal(createKeymap({ 'board.addTask': 'Mod+j' }).label('board.addTask', 'mac'), '⌘J');
});

test('list: the Shortcuts of one context in table order, with current bindings', () => {
  const km = createKeymap({ 'add.create': 'Mod+Shift+Enter' });
  assert.deepEqual(km.list('add').map((s) => [s.id, s.label, bindingToString(s.binding), s.fixed]), [['add.create', 'Create task', 'Mod+Shift+Enter', false]]);
  const board = km.list('board');
  assert.equal(board[0]!.id, 'board.addTask');
  assert.ok(board.every((s) => s.context === 'board'));
  assert.deepEqual(board.filter((s) => s.fixed).map((s) => s.id), ['board.selectUp', 'board.selectDown', 'board.selectLeft', 'board.selectRight', 'board.openSelected', 'board.escape', 'board.cheatSheet']);
  assert.equal(km.list('task').length, 13);
  assert.equal(km.all().length, DEFAULT_SHORTCUTS.length);
  // Ids are unique, and no two Shortcuts share a key in one context.
  assert.equal(new Set(km.all().map((s) => s.id)).size, km.all().length);
  for (const c of ['board', 'task', 'add'] as const) {
    const keys = km.list(c).map((s) => bindingToString(s.binding));
    assert.equal(new Set(keys).size, keys.length, c);
  }
  // A returned list cannot change the Keymap.
  board[0]!.binding.key = 'z';
  assert.equal(km.resolve(cmd('a')), 'board.addTask');
});

test('platformOf: macOS and iOS use Cmd', () => {
  assert.equal(platformOf('MacIntel'), 'mac');
  assert.equal(platformOf('macOS'), 'mac');
  assert.equal(platformOf('iPad'), 'mac');
  assert.equal(platformOf('Win32'), 'other');
  assert.equal(platformOf('Linux x86_64'), 'other');
  assert.equal(platformOf(''), 'other');
});

test('isReloadKey: Mod+R and Mod+Shift+R are the browser reload; nothing else is', () => {
  assert.equal(isReloadKey({ key: 'r', mod: true, shift: false, alt: false }), true);
  assert.equal(isReloadKey({ key: 'r', mod: true, shift: true, alt: false }), true);
  assert.equal(isReloadKey({ key: 'r', mod: true, shift: false, alt: true }), false);
  assert.equal(isReloadKey({ key: 'r', mod: false, shift: true, alt: false }), false);
  assert.equal(isReloadKey({ key: 'j', mod: true, shift: true, alt: false }), false);
});
