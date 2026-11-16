// Navigation: where the Selected card (GLOSSARY.md) goes on an arrow key. Pure, so it runs under
// node:test. It works on the Board's layout as drawn: the columns in Board order, each with the ids
// of its visible cards in drawn order (after hide-sub-tasks and the search filter), so a key never
// lands on a card the user cannot see. main.ts keeps the Selected card and asks this module; Mod+↑/↓
// in an Open task and ↓ from the search field use the same layout and steps.
// - Nothing wraps: at the end of a column, or at the first or last column with cards, it stays put.
// - ←/→ skip empty columns, keep the row and take the last card of a shorter column.
// - A Selected card that is no longer drawn (moved away, deleted, filtered out, a hidden sub-task)
//   falls back to the card now at its row in its column, or the column's last; an emptied column
//   hands over to the nearest column with cards (the earlier one on a tie).
import { COLUMNS, type BoardModel } from './columns.ts';

/** The drawn Board: one list of task ids per column, in COLUMNS order. */
export type Layout = readonly (readonly string[])[];
export type Direction = 'up' | 'down' | 'left' | 'right';
/** The Selected card and where it was last drawn (column and row index into the layout). */
export type Selected = { id: string; column: number; row: number };

/** The layout of a Board model as it is drawn (pass the model after search filtering). */
export const layoutOf = (board: BoardModel): Layout => COLUMNS.map(({ id }) => board[id].map((c) => c.task.id));

/** Where `id` is drawn, or null. */
export const locate = (layout: Layout, id: string): Selected | null => {
  for (let column = 0; column < layout.length; column++) {
    const row = layout[column]!.indexOf(id);
    if (row !== -1) return { id, column, row };
  }
  return null;
};

const cell = (layout: Layout, column: number, row: number): Selected => {
  const cards = layout[column]!;
  const r = Math.min(row, cards.length - 1);
  return { id: cards[r]!, column, row: r };
};

const firstCard = (layout: Layout): Selected | null => {
  const column = layout.findIndex((cards) => cards.length > 0);
  return column === -1 ? null : cell(layout, column, 0);
};

/**
 * The Selected card still drawn: at its current place, or the nearest card when it is gone.
 * null when nothing was selected or the Board has no cards.
 */
export const keepSelected = (layout: Layout, selected: Selected | null): Selected | null => {
  if (selected === null) return null;
  const found = locate(layout, selected.id);
  if (found !== null) return found;
  for (let d = 0; d < layout.length; d++) {
    for (const column of [selected.column - d, selected.column + d]) {
      if (column >= 0 && column < layout.length && layout[column]!.length > 0) return cell(layout, column, selected.row);
    }
  }
  return null;
};

/**
 * The Selected card after an arrow key. Nothing selected (or nothing left of it): the first card of
 * the first column with cards. null only when the Board has no cards.
 */
export const nextSelected = (layout: Layout, selected: Selected | null, direction: Direction): Selected | null => {
  const from = keepSelected(layout, selected);
  if (from === null) return firstCard(layout);
  // A vanished card's fallback is the step itself: the user sees where the selection went.
  if (from.id !== selected?.id) return from;
  const cards = layout[from.column]!;
  switch (direction) {
    case 'up':
      return from.row === 0 ? from : cell(layout, from.column, from.row - 1);
    case 'down':
      return from.row === cards.length - 1 ? from : cell(layout, from.column, from.row + 1);
    case 'left':
    case 'right': {
      const by = direction === 'left' ? -1 : 1;
      for (let column = from.column + by; column >= 0 && column < layout.length; column += by) {
        if (layout[column]!.length > 0) return cell(layout, column, from.row);
      }
      return from;
    }
  }
};
