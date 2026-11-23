import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertionBefore, linksAt, step, THRESHOLD, type Press } from '../src/panel/drag.ts';

const down = { type: 'down', pointerId: 1, button: 0, taskId: 't', from: 'backlog', x: 0, y: 0 } as const;
const pressed: Press = { pointerId: 1, taskId: 't', from: 'backlog', x: 0, y: 0, dragging: false };
const dragging: Press = { ...pressed, dragging: true };
const move = (x: number, buttons = 1, canDrag = true) => ({ type: 'move', pointerId: 1, x, y: 0, buttons, canDrag }) as const;

test('primary press on a card arms; other buttons and non-cards do not', () => {
  assert.deepEqual(step(null, down), { press: pressed, effect: { kind: 'none' } });
  assert.equal(step(null, { ...down, button: 2 }).press, null);
  assert.equal(step(null, { ...down, taskId: null }).press, null);
});

test('a new press replaces a stale one, armed or dragging', () => {
  const fresh = { ...down, pointerId: 2, taskId: 'u', x: 5 };
  assert.deepEqual(step(pressed, fresh).press, { ...pressed, pointerId: 2, taskId: 'u', x: 5 });
  assert.deepEqual(step(dragging, fresh), { press: { ...pressed, pointerId: 2, taskId: 'u', x: 5 }, effect: { kind: 'cancel' } });
  assert.deepEqual(step(dragging, { ...down, button: 2 }), { press: null, effect: { kind: 'cancel' } });
});

test('movement under the threshold stays a press; past it starts a drag', () => {
  assert.deepEqual(step(pressed, move(THRESHOLD - 1)), { press: pressed, effect: { kind: 'none' } });
  assert.deepEqual(step(pressed, move(THRESHOLD)), { press: dragging, effect: { kind: 'start' } });
  assert.deepEqual(step(dragging, move(50)), { press: dragging, effect: { kind: 'follow' } });
});

test('a busy card does not start a drag', () => {
  assert.deepEqual(step(pressed, move(THRESHOLD, 1, false)), { press: null, effect: { kind: 'none' } });
});

test('movement with no primary button held ends the press or drag (missed pointerup)', () => {
  assert.deepEqual(step(pressed, move(50, 0)), { press: null, effect: { kind: 'none' } });
  assert.deepEqual(step(dragging, move(50, 0)), { press: null, effect: { kind: 'cancel' } });
  assert.deepEqual(step(dragging, move(50, 2)), { press: null, effect: { kind: 'cancel' } });
  // The phantom case: a stuck press, a later click's pointerup is then ignored.
  const after = step(pressed, move(50, 0)).press;
  assert.deepEqual(step(after, { type: 'up', pointerId: 1, to: 'done' }), { press: null, effect: { kind: 'none' } });
});

test('pointerup opens after a click and drops after a drag', () => {
  assert.deepEqual(step(pressed, { type: 'up', pointerId: 1, to: null }), { press: null, effect: { kind: 'open', taskId: 't' } });
  assert.deepEqual(step(dragging, { type: 'up', pointerId: 1, to: 'done' }), {
    press: null,
    effect: { kind: 'drop', taskId: 't', from: 'backlog', to: 'done' },
  });
  assert.deepEqual(step(dragging, { type: 'up', pointerId: 1, to: null }), { press: null, effect: { kind: 'cancel' } });
});

test('abort (lost capture, context menu, pointercancel, Escape) ends any press', () => {
  assert.deepEqual(step(dragging, { type: 'abort' }), { press: null, effect: { kind: 'cancel' } });
  assert.deepEqual(step(pressed, { type: 'abort' }), { press: null, effect: { kind: 'none' } });
  assert.deepEqual(step(null, { type: 'abort' }), { press: null, effect: { kind: 'none' } });
  // Pointer-specific aborts ignore other pointers.
  assert.deepEqual(step(dragging, { type: 'abort', pointerId: 9 }), { press: dragging, effect: { kind: 'none' } });
});

test('events of another pointer are ignored', () => {
  assert.deepEqual(step(dragging, { ...move(50), pointerId: 9 }), { press: dragging, effect: { kind: 'none' } });
  assert.deepEqual(step(pressed, { type: 'up', pointerId: 9, to: 'done' }), { press: pressed, effect: { kind: 'none' } });
});

test('pointerup over an accepting card links the dragged task under it', () => {
  assert.deepEqual(step(dragging, { type: 'up', pointerId: 1, to: 'ready', onto: 'p' }), {
    press: null,
    effect: { kind: 'link', taskId: 't', parentId: 'p' },
  });
  // Even outside any column (the card is what was hit).
  assert.deepEqual(step(dragging, { type: 'up', pointerId: 1, to: null, onto: 'p' }).effect, { kind: 'link', taskId: 't', parentId: 'p' });
});

test('no accepting card under the pointer (or the card itself) falls back to the column move', () => {
  assert.deepEqual(step(dragging, { type: 'up', pointerId: 1, to: 'done', onto: null }).effect, {
    kind: 'drop',
    taskId: 't',
    from: 'backlog',
    to: 'done',
  });
  assert.deepEqual(step(dragging, { type: 'up', pointerId: 1, to: 'done', onto: 't' }).effect.kind, 'drop');
});

test('a click on a card still opens it, whatever is under the pointer', () => {
  assert.deepEqual(step(pressed, { type: 'up', pointerId: 1, to: null, onto: 'p' }).effect, { kind: 'open', taskId: 't' });
});

test('released in its own column at an insertion point: the card is reordered, not moved', () => {
  assert.deepEqual(step(dragging, { type: 'up', pointerId: 1, to: 'backlog', before: 'u' }), {
    press: null,
    effect: { kind: 'reorder', taskId: 't', column: 'backlog', before: 'u' },
  });
  assert.deepEqual(step(dragging, { type: 'up', pointerId: 1, to: 'backlog', before: null }).effect, {
    kind: 'reorder',
    taskId: 't',
    column: 'backlog',
    before: null,
  });
  // Another column ignores the insertion point (the column move, as before); a link still wins.
  assert.deepEqual(step(dragging, { type: 'up', pointerId: 1, to: 'ready', before: 'u' }).effect.kind, 'drop');
  assert.deepEqual(step(dragging, { type: 'up', pointerId: 1, to: 'backlog', before: 'u', onto: 'p' }).effect.kind, 'link');
});

test('insertionBefore: the first other card whose middle is below the pointer; none: last', () => {
  const cards = [
    { id: 'a', top: 0, bottom: 40 },
    { id: 't', top: 50, bottom: 90 },
    { id: 'b', top: 100, bottom: 140 },
  ];
  assert.equal(insertionBefore(10, cards, 't'), 'a');
  assert.equal(insertionBefore(30, cards, 't'), 'b');
  // Over the dragged card itself: before the next one, i.e. where it already is.
  assert.equal(insertionBefore(70, cards, 't'), 'b');
  assert.equal(insertionBefore(130, cards, 't'), null);
  assert.equal(insertionBefore(10, [], 't'), null);
});

test('linksAt: a card of another column links anywhere; in its own column only its middle half, the edges reorder', () => {
  const card = { top: 100, bottom: 200 };
  assert.equal(linksAt(105, card, false), true);
  assert.equal(linksAt(105, card, true), false);
  assert.equal(linksAt(150, card, true), true);
  assert.equal(linksAt(130, card, true), true);
  assert.equal(linksAt(190, card, true), false);
});

test('a Mod- or Shift-click marks the card instead of opening it; a plain click opens it', () => {
  const marking = step(null, { ...down, mark: 'toggle' }).press;
  assert.deepEqual(step(marking, { type: 'up', pointerId: 1, to: null }).effect, { kind: 'mark', taskId: 't', how: 'toggle' });
  const ranging = step(null, { ...down, mark: 'range' }).press;
  assert.deepEqual(step(ranging, { type: 'up', pointerId: 1, to: null }).effect, { kind: 'mark', taskId: 't', how: 'range' });
});

test('a drag of marked cards moves the whole group to a column, never links or reorders it', () => {
  const group = step(step(null, { ...down, group: ['s', 't', 'u'] }).press, move(THRESHOLD)).press;
  const drop = { kind: 'drop', taskId: 't', from: 'backlog', to: 'done', group: ['s', 't', 'u'] };
  assert.deepEqual(step(group, { type: 'up', pointerId: 1, to: 'done' }).effect, drop);
  assert.deepEqual(step(group, { type: 'up', pointerId: 1, to: 'done', onto: 'p' }).effect, drop);
  // In its own column there is nothing to do; outside every column it is cancelled.
  assert.deepEqual(step(group, { type: 'up', pointerId: 1, to: 'backlog', before: 'v' }).effect, { ...drop, to: 'backlog' });
  assert.deepEqual(step(group, { type: 'up', pointerId: 1, to: null, onto: 'p' }).effect, { kind: 'cancel' });
  // A group of one is the plain drag.
  const one = step(step(null, { ...down, group: ['t'] }).press, move(THRESHOLD)).press;
  assert.deepEqual(step(one, { type: 'up', pointerId: 1, to: 'done' }).effect, { kind: 'drop', taskId: 't', from: 'backlog', to: 'done' });
});
