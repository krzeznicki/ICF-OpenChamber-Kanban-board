// The Selected card (GLOSSARY.md) on the Board: kept by task id across every redraw (polling,
// session events, settings), marked with .is-selected and given focus again after a render that
// took the focus away from it. Where an arrow key moves it is navigation.ts; this is the DOM side.
// - A card that gets focus (Tab, a click) becomes the Selected card.
// - After a render, focus returns to the Selected card only when focus was on a card (or lost to
//   the body) before it and `canFocus` allows it (no dialog open), so a poll never pulls focus out
//   of the search field, a modal or the host.
// - It also keeps the Marked cards (../marks.ts, GLOSSARY.md) the same way, marked with .is-marked.
// - dispose removes the focusin listener; the panel has no teardown today, so main.ts never calls it.
import { keepSelected, locate, nextSelected, type Direction, type Layout, type Selected } from '../navigation.ts';
import { activeElement } from '../shortcuts.ts';
import { createMarks, type MarkHow } from '../marks.ts';

export type Selection = {
  /** The Selected card's task id, or null. */
  get: () => string | null;
  /** Selects `id` (null: nothing). `focus`: also move focus to it and scroll it into view. */
  set: (id: string | null, options?: { focus?: boolean }) => void;
  /** The Board as last drawn (navigation.ts Layout). */
  layout: () => Layout;
  /** An arrow key: the next Selected card gets focus. False when the Board has no cards. */
  step: (direction: Direction) => boolean;
  /** Call right before the board redraws its cards (remembers whether a card had focus). */
  beforeRender: () => void;
  /** Call right after it: the drawn layout. */
  rendered: (layout: Layout) => void;
  /** Whether focus is on a card or nowhere (the body), where the Board's arrows and Enter apply. */
  focusOnBoard: () => boolean;
  /** The Marked cards' ids, in the order they were marked (a range: board order). */
  marked: () => readonly string[];
  /** A Mod- or Shift-click on `id` (a range without an anchor starts at the Selected card). */
  mark: (id: string, how: MarkHow) => void;
  /** Unmark every card (a plain click, a press on the background, Escape). */
  clearMarks: () => void;
  setMarked: (ids: readonly string[]) => void;
  selectAll: () => void;
  retain: (ids: readonly string[]) => void;
  setLocked: (locked: boolean) => void;
  /** What a drag of `id` carries (marks.ts dragGroup). */
  group: (id: string, busy: ReadonlySet<string>) => readonly string[];
  dispose: () => void;
};

export const createSelection = (container: HTMLElement, options: { canFocus: () => boolean; onMarksChanged?: (ids: readonly string[]) => void }): Selection => {
  let selected: Selected | null = null;
  let layout: Layout = [];
  let refocus = false;
  const marks = createMarks(ids => { paint(); options.onMarksChanged?.(ids); });

  const cardOf = (id: string): HTMLElement | null =>
    container.querySelector<HTMLElement>(`.kb-card[data-task-id="${CSS.escape(id)}"]`);

  /** Draw the Selected card and the Marked cards. */
  const paint = (): void => {
    for (const el of container.querySelectorAll('.kb-card.is-selected')) el.classList.remove('is-selected');
    if (selected !== null) cardOf(selected.id)?.classList.add('is-selected');
    for (const el of container.querySelectorAll('.kb-card.is-marked')) el.classList.remove('is-marked');
    for (const id of marks.get().ids) cardOf(id)?.classList.add('is-marked');
  };

  const focus = (scroll: boolean): void => {
    if (selected === null || !options.canFocus()) return;
    const el = cardOf(selected.id);
    if (el === null) return;
    el.focus({ preventScroll: true });
    if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  /** Focus is on a card of this Board or nowhere (the body, the document). */
  const focusOnBoard = (): boolean => {
    const el = activeElement();
    return el === null || el === document.body || el === document.documentElement || (el instanceof HTMLElement && el.classList.contains('kb-card') && container.contains(el));
  };

  const onFocusIn = (e: FocusEvent): void => {
    if (!(e.target instanceof HTMLElement) || !e.target.classList.contains('kb-card')) return;
    const id = e.target.dataset.taskId;
    if (id === undefined || id === selected?.id) return;
    selected = locate(layout, id) ?? { id, column: 0, row: 0 };
    paint();
  };
  container.addEventListener('focusin', onFocusIn);

  return {
    get: () => selected?.id ?? null,
    set: (id, opts) => {
      if (id === null) selected = null;
      // Not drawn (yet): kept by id at the old place, so the next render can still fall back near it.
      else selected = locate(layout, id) ?? { id, column: selected?.column ?? 0, row: selected?.row ?? 0 };
      paint();
      if (opts?.focus === true) focus(true);
    },
    layout: () => layout,
    step: (direction) => {
      const next = nextSelected(layout, selected, direction);
      if (next === null) return false;
      selected = next;
      paint();
      focus(true);
      return true;
    },
    beforeRender: () => {
      refocus = document.hasFocus() && focusOnBoard();
    },
    rendered: (next) => {
      layout = next;
      selected = keepSelected(layout, selected);
      marks.rendered(layout);
      paint();
      if (refocus) focus(false);
      refocus = false;
    },
    focusOnBoard,
    marked: () => marks.get().ids,
    mark: (id, how) => {
      marks.mark(id, how, selected?.id ?? null);
      // The clicked card is the Selected card too, so the keyboard goes on from it.
      selected = locate(layout, id) ?? selected;
      paint();
    },
    clearMarks: marks.clear,
    setMarked: marks.set,
    selectAll: marks.selectAll,
    retain: marks.retain,
    setLocked: marks.setLocked,
    group: marks.group,
    dispose: () => container.removeEventListener('focusin', onFocusIn),
  };
};
