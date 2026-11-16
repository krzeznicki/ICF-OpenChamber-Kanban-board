// The Selected card (GLOSSARY.md) on the Board: kept by task id across every redraw (polling,
// session events, settings), marked with .is-selected and given focus again after a render that
// took the focus away from it. Where an arrow key moves it is navigation.ts; this is the DOM side.
// - A card that gets focus (Tab, a click) becomes the Selected card.
// - After a render, focus returns to the Selected card only when focus was on a card (or lost to
//   the body) before it and `canFocus` allows it (no dialog open), so a poll never pulls focus out
//   of the search field, a modal or the host.
import { keepSelected, locate, nextSelected, type Direction, type Layout, type Selected } from '../navigation.ts';

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
  dispose: () => void;
};

const activeElement = (): Element | null => document.activeElement;

export const createSelection = (container: HTMLElement, options: { canFocus: () => boolean }): Selection => {
  let selected: Selected | null = null;
  let layout: Layout = [];
  let refocus = false;

  const cardOf = (id: string): HTMLElement | null =>
    container.querySelector<HTMLElement>(`.kb-card[data-task-id="${CSS.escape(id)}"]`);

  const mark = (): void => {
    for (const el of container.querySelectorAll('.kb-card.is-selected')) el.classList.remove('is-selected');
    if (selected !== null) cardOf(selected.id)?.classList.add('is-selected');
  };

  const focus = (scroll: boolean): void => {
    if (selected === null || !options.canFocus()) return;
    const el = cardOf(selected.id);
    if (el === null) return;
    el.focus({ preventScroll: true });
    if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const focusOnBoard = (): boolean => {
    const el = activeElement();
    return el === null || el === document.body || el === document.documentElement || (el instanceof HTMLElement && el.classList.contains('kb-card') && container.contains(el));
  };

  const onFocusIn = (e: FocusEvent): void => {
    if (!(e.target instanceof HTMLElement) || !e.target.classList.contains('kb-card')) return;
    const id = e.target.dataset.taskId;
    if (id === undefined || id === selected?.id) return;
    selected = locate(layout, id) ?? { id, column: 0, row: 0 };
    mark();
  };
  container.addEventListener('focusin', onFocusIn);

  return {
    get: () => selected?.id ?? null,
    set: (id, opts) => {
      if (id === null) selected = null;
      // Not drawn (yet): kept by id at the old place, so the next render can still fall back near it.
      else selected = locate(layout, id) ?? { id, column: selected?.column ?? 0, row: selected?.row ?? 0 };
      mark();
      if (opts?.focus === true) focus(true);
    },
    layout: () => layout,
    step: (direction) => {
      const next = nextSelected(layout, selected, direction);
      if (next === null) return false;
      selected = next;
      mark();
      focus(true);
      return true;
    },
    beforeRender: () => {
      const el = activeElement();
      refocus = document.hasFocus() && (el === null || el === document.body || (el instanceof HTMLElement && el.classList.contains('kb-card') && container.contains(el)));
    },
    rendered: (next) => {
      layout = next;
      selected = keepSelected(layout, selected);
      mark();
      if (refocus) focus(false);
      refocus = false;
    },
    focusOnBoard,
    dispose: () => container.removeEventListener('focusin', onFocusIn),
  };
};
