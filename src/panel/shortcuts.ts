// The one keydown listener for the whole panel: works out the Shortcut context, asks the Keymap
// (keymap.ts) what the press means and runs the handler registered for that action id.
// - Context: layers are asked in order and the first answer wins. A layer answers a context, 'none'
//   (no Shortcuts at all: a confirm, Settings, later the cheat sheet) or null (not mine, ask the
//   next). Nothing answered: no Shortcuts. main.ts adds the panel's layers; later overlays add theirs
//   with addLayer, in front of the others when they sit on top.
// - Bubble phase on document, and a press something already handled (defaultPrevented: a confirm's
//   Escape in the capture phase, an open select popup, a field's own Enter) is left alone. Escape is
//   never bound, so the modal's and Settings' own Escape handling is unchanged.
// - A handler returns false when it could not act (nothing selected, a form busy): the key then
//   keeps its usual meaning. Otherwise the press is taken (preventDefault).
import { createKeymap, platformOf, type ActionId, type Keymap, type Platform, type ShortcutContext } from './keymap.ts';

export type ContextLayer = () => ShortcutContext | 'none' | null;
export type ShortcutHandler = (e: KeyboardEvent) => boolean | void;

export type Shortcuts = {
  /** Runs `handler` for `id`; one handler per action (a later one replaces it). Returns a disposer. */
  on: (id: ActionId, handler: ShortcutHandler) => () => void;
  /** A context layer; `front` puts it before the others (an overlay on top). Returns a disposer. */
  addLayer: (layer: ContextLayer, options?: { front?: boolean }) => () => void;
  /** The Shortcut context right now (null: no Shortcuts). */
  context: () => ShortcutContext | null;
  /** The current Keymap (overrides applied), for tooltips, Settings and the cheat sheet. */
  keymap: () => Keymap;
  /** Replaces the Keymap (the user's overrides changed). */
  setKeymap: (keymap: Keymap) => void;
  platform: Platform;
  dispose: () => void;
};

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week', '']);

/** Focus is where typing goes: a text-like input, a textarea or an editable element. */
export const isTextField = (el: Element | null): boolean =>
  (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type)) ||
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLElement && el.isContentEditable);

/** The element with focus, looking into shadow roots (the SDK's fields may live in one). */
const activeElement = (): Element | null => {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
};

export const detectPlatform = (): Platform => {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return platformOf(nav.userAgentData?.platform ?? nav.platform ?? '');
};

export const createShortcuts = (options: { keymap?: Keymap; platform?: Platform } = {}): Shortcuts => {
  let keymap = options.keymap ?? createKeymap();
  const platform = options.platform ?? detectPlatform();
  const handlers = new Map<ActionId, ShortcutHandler>();
  const layers: ContextLayer[] = [];

  const context = (): ShortcutContext | null => {
    for (const layer of layers) {
      const answer = layer();
      if (answer !== null) return answer === 'none' ? null : answer;
    }
    return null;
  };

  const onKey = (e: KeyboardEvent): void => {
    // keyCode 229: some browsers report an IME press that way without isComposing.
    const composing = e.isComposing || e.keyCode === 229;
    if (e.defaultPrevented || composing) return;
    const id = keymap.resolve({
      key: e.key,
      code: e.code,
      meta: e.metaKey,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      context: context(),
      inTextField: isTextField(activeElement()),
      composing,
      platform,
    });
    if (id === null) return;
    const handler = handlers.get(id);
    if (handler === undefined || handler(e) === false) return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  return {
    on: (id, handler) => {
      handlers.set(id, handler);
      return () => {
        if (handlers.get(id) === handler) handlers.delete(id);
      };
    },
    addLayer: (layer, opts) => {
      if (opts?.front === true) layers.unshift(layer);
      else layers.push(layer);
      return () => {
        const i = layers.indexOf(layer);
        if (i !== -1) layers.splice(i, 1);
      };
    },
    context,
    keymap: () => keymap,
    setKeymap: (next) => {
      keymap = next;
    },
    platform,
    dispose: () => {
      document.removeEventListener('keydown', onKey);
      handlers.clear();
      layers.length = 0;
    },
  };
};
