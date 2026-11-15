// The press/drag state machine behind ui/dnd.ts. Pure: no DOM, so it runs under node:test.
// dnd.ts feeds it pointer events and performs the returned effect (draw the ghost, clean up,
// open the card, report the drop or the link: released over a card that accepts the dragged task as
// a sub-task, the task is linked under it; anywhere else it is the column move).
//
// It must never let a press outlive its button: a missed pointerup (macOS Ctrl-click opens a
// context menu and swallows it), a lost capture or a context menu would otherwise leave the press
// armed, and later plain mouse movement plus the next click would drop the card somewhere.
import type { Column } from './columns.ts';

export const THRESHOLD = 6;

export type Press = { pointerId: number; taskId: string; from: Column; x: number; y: number; dragging: boolean };

export type DragInput =
  /** taskId null: the press was not on a draggable card. */
  | { type: 'down'; pointerId: number; button: number; taskId: string | null; from: Column; x: number; y: number }
  /** buttons: PointerEvent.buttons; canDrag: false while the card's move is in flight. */
  | { type: 'move'; pointerId: number; x: number; y: number; buttons: number; canDrag: boolean }
  /** to: the column under the pointer, or null; onto: the card under it that accepts the dragged task as a sub-task (link.ts), or null. */
  | { type: 'up'; pointerId: number; to: Column | null; onto?: string | null }
  /** pointercancel / lostpointercapture (with pointerId), contextmenu / Escape (without). */
  | { type: 'abort'; pointerId?: number };

export type DragEffect =
  | { kind: 'none' }
  /** Draw the ghost and capture the pointer. */
  | { kind: 'start' }
  /** Move the ghost, highlight the column under the pointer. */
  | { kind: 'follow' }
  /** Remove the ghost and highlight; no move. */
  | { kind: 'cancel' }
  | { kind: 'open'; taskId: string }
  | { kind: 'drop'; taskId: string; from: Column; to: Column }
  /** Released over an accepting card: make taskId a sub-task of parentId. */
  | { kind: 'link'; taskId: string; parentId: string };

export type DragStep = { press: Press | null; effect: DragEffect };

const NONE: DragEffect = { kind: 'none' };
/** End a press: a drag needs its ghost removed, an armed press needs nothing. */
const end = (press: Press | null): DragStep => ({ press: null, effect: press?.dragging === true ? { kind: 'cancel' } : NONE });

export const step = (press: Press | null, input: DragInput): DragStep => {
  switch (input.type) {
    case 'down': {
      // Any earlier press is stale: its pointerup never reached us.
      const stale = end(press);
      if (input.button !== 0 || input.taskId === null) return stale;
      const next: Press = { pointerId: input.pointerId, taskId: input.taskId, from: input.from, x: input.x, y: input.y, dragging: false };
      return { press: next, effect: stale.effect };
    }
    case 'move': {
      if (press === null || input.pointerId !== press.pointerId) return { press, effect: NONE };
      if ((input.buttons & 1) === 0) return end(press);
      if (press.dragging) return { press, effect: { kind: 'follow' } };
      if (Math.hypot(input.x - press.x, input.y - press.y) < THRESHOLD) return { press, effect: NONE };
      if (!input.canDrag) return { press: null, effect: NONE };
      return { press: { ...press, dragging: true }, effect: { kind: 'start' } };
    }
    case 'up': {
      if (press === null || input.pointerId !== press.pointerId) return { press, effect: NONE };
      if (!press.dragging) return { press: null, effect: { kind: 'open', taskId: press.taskId } };
      const onto = input.onto ?? null;
      if (onto !== null && onto !== press.taskId) return { press: null, effect: { kind: 'link', taskId: press.taskId, parentId: onto } };
      if (input.to === null) return end(press);
      return { press: null, effect: { kind: 'drop', taskId: press.taskId, from: press.from, to: input.to } };
    }
    case 'abort': {
      if (press === null) return { press, effect: NONE };
      if (input.pointerId !== undefined && input.pointerId !== press.pointerId) return { press, effect: NONE };
      return end(press);
    }
  }
};
