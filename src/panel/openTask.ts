// The Open task's (GLOSSARY.md) Shortcuts that need a decision, not a control: which task Mod+↑/↓
// opens and which column Mod+1…5 sets. Pure, so it runs under node:test; ui/detail.ts and main.ts
// wire the keys.
// - Mod+↑/↓ walk the open task's column in the Board's drawn order (navigation.ts Layout: after
//   hide-sub-tasks and the search filter). Nothing wraps; a task that is not drawn (a hidden
//   sub-task opened from its parent) has no neighbours.
// - Mod+N sets the state to Board column N, through the same path as the modal's "Move to" buttons:
//   only a column a button is shown for (one whose move does something) counts.
import { COLUMNS, type Column } from './columns.ts';
import { locate, type Layout } from './navigation.ts';

/** The task drawn just above (`prev`) or below (`next`) `id` in its column, or null at the end or when `id` is not drawn. */
export const columnNeighbour = (layout: Layout, id: string, direction: 'prev' | 'next'): string | null => {
  const at = locate(layout, id);
  if (at === null) return null;
  return layout[at.column]![at.row + (direction === 'prev' ? -1 : 1)] ?? null;
};

/** Board column `n` (1-based) when the modal offers a move there, else null. */
export const columnForDigit = (n: number, moves: readonly Column[]): Column | null => {
  const column = COLUMNS[n - 1]?.id;
  return column !== undefined && Number.isInteger(n) && moves.includes(column) ? column : null;
};
