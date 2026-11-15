import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step, THRESHOLD, type Press } from '../src/panel/drag.ts';

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
