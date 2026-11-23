// The press/drag state machine behind ui/dnd.ts. Pure: no DOM, so it runs under node:test.
// dnd.ts feeds it pointer events and performs the returned effect (draw the ghost, clean up,
// open the card, report the drop or the link: released over a card that accepts the dragged task as
// a sub-task, the task is linked under it; in its own column it is reordered; anywhere else it is the column move).
//
// It must never let a press outlive its button: a missed pointerup (macOS Ctrl-click opens a
// context menu and swallows it), a lost capture or a context menu would otherwise leave the press
// armed, and later plain mouse movement plus the next click would drop the card somewhere.
import type { Column } from './columns.ts';
import type { MarkHow } from './marks.ts';

export const THRESHOLD = 6;

/**
 * mark: the press was a Mod- or Shift-click (marks.ts), so a click marks the card instead of opening it.
 * group: the Marked cards a drag carries (marks.ts dragGroup), when more than this one.
 */
export type Press = { pointerId: number; taskId: string; from: Column; x: number; y: number; dragging: boolean; mark?: MarkHow; group?: readonly string[] };

export type DragInput =
  /** taskId null: the press was not on a draggable card. mark: Mod or Shift held; group: what a drag carries (marks.ts dragGroup). */
  | { type: 'down'; pointerId: number; button: number; taskId: string | null; from: Column; x: number; y: number; mark?: MarkHow; group?: readonly string[] }
  /** buttons: PointerEvent.buttons; canDrag: false while the card's move is in flight. */
  | { type: 'move'; pointerId: number; x: number; y: number; buttons: number; canDrag: boolean }
  /**
   * to: the column under the pointer, or null; onto: the card under it that accepts the dragged task as a sub-task (link.ts), or null;
   * before: in the card's own column, the card it would be inserted before (null: last); undefined: no insertion point.
   */
  | { type: 'up'; pointerId: number; to: Column | null; onto?: string | null; before?: string | null }
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
  /** A Mod- or Shift-click: toggle the card's mark, or mark the range up to it (marks.ts clickMarks). */
  | { kind: 'mark'; taskId: string; how: MarkHow }
  /** group: a drag of several Marked cards (taskId among them), each moved to `to` from its own column. */
  | { kind: 'drop'; taskId: string; from: Column; to: Column; group?: readonly string[] }
  /** Released over an accepting card: make taskId a sub-task of parentId. */
  | { kind: 'link'; taskId: string; parentId: string }
  /** Released in its own column: put taskId before `before` (null: last) in the manual order (order.ts). */
  | { kind: 'reorder'; taskId: string; column: Column; before: string | null };

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
      const next: Press = {
        pointerId: input.pointerId,
        taskId: input.taskId,
        from: input.from,
        x: input.x,
        y: input.y,
        dragging: false,
        ...(input.mark !== undefined ? { mark: input.mark } : {}),
        ...(input.group !== undefined && input.group.length > 1 ? { group: input.group } : {}),
      };
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
      if (!press.dragging) {
        const effect: DragEffect = press.mark !== undefined ? { kind: 'mark', taskId: press.taskId, how: press.mark } : { kind: 'open', taskId: press.taskId };
        return { press: null, effect };
      }
      // A group only moves between columns: no link under a card, no place in a column.
      if (press.group !== undefined) {
        if (input.to === null) return end(press);
        return { press: null, effect: { kind: 'drop', taskId: press.taskId, from: press.from, to: input.to, group: press.group } };
      }
      const onto = input.onto ?? null;
      if (onto !== null && onto !== press.taskId) return { press: null, effect: { kind: 'link', taskId: press.taskId, parentId: onto } };
      if (input.to === null) return end(press);
      if (input.to === press.from && input.before !== undefined) {
        return { press: null, effect: { kind: 'reorder', taskId: press.taskId, column: input.to, before: input.before } };
      }
      return { press: null, effect: { kind: 'drop', taskId: press.taskId, from: press.from, to: input.to } };
    }
    case 'abort': {
      if (press === null) return { press, effect: NONE };
      if (input.pointerId !== undefined && input.pointerId !== press.pointerId) return { press, effect: NONE };
      return end(press);
    }
  }
};

/** A card's vertical extent on screen. */
export type Span = { top: number; bottom: number };

/**
 * Where a card dropped at height `y` goes in its column: before the first other card whose middle is
 * below the pointer (null: last). `cards` is the column as drawn, the dragged card included.
 */
export const insertionBefore = (y: number, cards: readonly (Span & { id: string })[], dragged: string): string | null =>
  cards.find((c) => c.id !== dragged && y < (c.top + c.bottom) / 2)?.id ?? null;

/**
 * Whether the pointer over an accepting card means "link under it". In the dragged card's own
 * column only the middle half does, so the edges stay free for reordering; elsewhere the whole card.
 */
export const linksAt = (y: number, card: Span, sameColumn: boolean): boolean => {
  if (!sameColumn) return true;
  const quarter = (card.bottom - card.top) / 4;
  return y >= card.top + quarter && y <= card.bottom - quarter;
};
