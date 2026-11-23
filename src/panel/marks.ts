// Marked cards (GLOSSARY.md): the cards picked with Mod+click (one at a time) or Shift+click (a
// range) to be moved together, as in a desktop file list. Pure, so it runs under node:test;
// ui/selection.ts keeps them across redraws and draws them, ui/dnd.ts reports the clicks.
// - Board order is the drawn layout read column by column, top to bottom (navigation.ts Layout),
//   so a range may run over several columns.
// - Mod+click toggles a card and makes it the anchor; Shift+click marks every card from the anchor
//   to the clicked one and keeps the anchor. A later Shift+click replaces that range (it can shrink),
//   as in Finder: the cards marked before the range (`base`) stay. Without an anchor the range
//   starts at the fallback (the Selected card), or is just the clicked card.
// - A plain click clears the marks (main.ts / ui/dnd.ts), Escape too.
import type { Layout } from './navigation.ts';

/**
 * The Marked cards' ids (in the order marked; a range in board order), the card a Shift+click range
 * starts from, and the cards marked before that range (a new Shift+click replaces only the range).
 */
export type Marks = { readonly ids: readonly string[]; readonly anchor: string | null; readonly base: readonly string[] };
/** toggle: Mod+click, one card; range: Shift+click, from the anchor to the clicked card. */
export type MarkHow = 'toggle' | 'range';

/** Nothing marked. */
export const NO_MARKS: Marks = { ids: [], anchor: null, base: [] };

const order = (layout: Layout): string[] => layout.flat();

/** `ids` in board order (ids not drawn are dropped). */
const inOrder = (layout: Layout, ids: ReadonlySet<string>): string[] => order(layout).filter((id) => ids.has(id));

/** The marks after a Mod- or Shift-click on `id`; `fallback` starts a range when there is no anchor (the Selected card). */
export const clickMarks = (marks: Marks, layout: Layout, id: string, how: MarkHow, fallback: string | null = null): Marks => {
  if (how === 'toggle') {
    const ids = marks.ids.includes(id) ? marks.ids.filter((m) => m !== id) : [...marks.ids, id];
    return { ids, anchor: id, base: ids };
  }
  const flat = order(layout);
  const anchor = [marks.anchor, fallback].find((a) => a !== null && flat.includes(a)) ?? id;
  const [i, j] = [flat.indexOf(anchor), flat.indexOf(id)];
  const range = i === -1 || j === -1 ? [id] : flat.slice(Math.min(i, j), Math.max(i, j) + 1);
  return { ids: inOrder(layout, new Set([...marks.base, ...range])), anchor, base: marks.base };
};

/** The marks still drawn after a redraw; the same object when nothing changed. */
export const keepMarks = (marks: Marks, layout: Layout): Marks => {
  const flat = new Set(order(layout));
  const ids = marks.ids.filter((id) => flat.has(id));
  const base = marks.base.filter((id) => flat.has(id));
  const anchor = marks.anchor !== null && flat.has(marks.anchor) ? marks.anchor : null;
  return ids.length === marks.ids.length && base.length === marks.base.length && anchor === marks.anchor ? marks : { ids, anchor, base };
};

/** What a drag of `pressed` carries: every marked card not busy, in board order, when it is marked; else just it. */
export const dragGroup = (marks: Marks, layout: Layout, pressed: string, busy: ReadonlySet<string>): string[] => {
  if (!marks.ids.includes(pressed)) return [pressed];
  return inOrder(layout, new Set(marks.ids.filter((id) => id === pressed || !busy.has(id))));
};
