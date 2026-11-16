// The search field's completions (search.ts searchSuggestions): a list under the field for the word
// that ends at the caret. Arrow keys select a row, then Enter or Tab picks it (with no row selected
// both keep their usual meaning); Escape closes the list first (a second Escape clears the field, as
// the kit's search field does); a click picks too.
import type { Suggestion } from '../search.ts';

export type SuggestDeps = {
  /** What to offer for the text and caret. */
  suggest: (text: string, caret: number) => Suggestion[];
  /** A pick: the new text (the field and the board follow it). */
  apply: (text: string) => void;
};

/** `slot` holds the kit's search field; its input is found inside. Returns dispose. */
export const mountSearchSuggest = (slot: HTMLElement, deps: SuggestDeps): (() => void) => {
  const input = slot.querySelector('input');
  if (input === null) return () => {};
  const list = document.createElement('div');
  list.className = 'kb-search-suggest';
  list.id = 'kb-search-suggest';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  slot.append(list);
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-autocomplete', 'list');

  let items: Suggestion[] = [];
  let active = -1;

  const paint = (): void => {
    list.replaceChildren();
    list.hidden = items.length === 0;
    input.setAttribute('aria-expanded', String(items.length > 0));
    if (active >= 0) input.setAttribute('aria-activedescendant', `kb-search-option-${active}`);
    else input.removeAttribute('aria-activedescendant');
    items.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'kb-search-option';
      row.id = `kb-search-option-${i}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === active));
      row.textContent = s.label;
      // Keep the focus in the field.
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', () => pick(s));
      list.append(row);
    });
  };

  const close = (): void => {
    items = [];
    active = -1;
    paint();
  };

  const refresh = (): void => {
    if (document.activeElement !== input) return close();
    items = deps.suggest(input.value, input.selectionStart ?? input.value.length);
    // A new list starts with no row selected, so Enter and Tab are not taken over by a word.
    active = -1;
    paint();
  };

  const pick = (s: Suggestion): void => {
    deps.apply(s.text);
    input.setSelectionRange(s.caret, s.caret);
    active = -1;
    refresh();
  };

  // Capturing on the slot: runs before the kit's own Escape handler on the input.
  const onKey = (e: KeyboardEvent): void => {
    if (items.length === 0 || e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      active = active < 0 ? (step > 0 ? 0 : items.length - 1) : (active + step + items.length) % items.length;
      paint();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const s = items[active];
      if (s === undefined) return;
      e.preventDefault();
      pick(s);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  // The caret moved (arrows left/right, click) or the text changed: offer again on the next frame,
  // after the input holds the new value.
  const later = (): void => void requestAnimationFrame(refresh);
  const onKeyUp = (e: KeyboardEvent): void => {
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) later();
  };

  slot.addEventListener('keydown', onKey, true);
  input.addEventListener('input', later);
  input.addEventListener('keyup', onKeyUp);
  input.addEventListener('click', later);
  input.addEventListener('focus', later);
  input.addEventListener('blur', close);
  return () => {
    slot.removeEventListener('keydown', onKey, true);
    input.removeEventListener('input', later);
    input.removeEventListener('keyup', onKeyUp);
    input.removeEventListener('click', later);
    input.removeEventListener('focus', later);
    input.removeEventListener('blur', close);
    list.remove();
  };
};
