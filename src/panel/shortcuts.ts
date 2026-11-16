// The one keydown listener for the whole panel: works out the Shortcut context, asks the Keymap
// (keymap.ts) what the press means and runs the handler registered for that action id.
// - Context: layers are asked in order and the first answer wins. A layer answers a context, 'none'
//   (no Shortcuts at all: a confirm, Settings, the cheat sheet) or null (not mine, ask the next).
//   Nothing answered: no Shortcuts. main.ts adds the panel's layers; an overlay adds its own with
//   addLayer, in front of the others when it sits on top.
// - Bubble phase on document, and a press something already handled (defaultPrevented: a confirm's
//   Escape in the capture phase, an open select popup, a field's own Enter) is left alone. Escape is
//   never bound, so the modal's and Settings' own Escape handling is unchanged.
// - A handler returns false when it could not act (nothing selected, a form busy): the key then
//   keeps its usual meaning. Otherwise the press is taken (preventDefault).
// - A reserved action (reserve) has its key taken in every context, even with no Shortcuts or a
//   handler that declined, while that key is the browser's reload (Mod+R, Mod+Shift+R): Refresh's
//   key never reloads the panel.
import {
  bindingOf,
  createKeymap,
  isReloadKey,
  platformOf,
  pressFromEvent,
  sameBinding,
  type ActionId,
  type Keymap,
  type Platform,
  type ShortcutContext,
} from './keymap.ts';

export type ContextLayer = () => ShortcutContext | 'none' | null;
export type ShortcutHandler = (e: KeyboardEvent) => boolean | void;

export type Shortcuts = {
  /** Runs `handler` for `id`; one handler per action (a later one replaces it). Returns a disposer. */
  on: (id: ActionId, handler: ShortcutHandler) => () => void;
  /** `id`'s key is taken everywhere while it is the browser's reload key (see the header). Returns a disposer. */
  reserve: (id: ActionId) => () => void;
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
export const activeElement = (): Element | null => {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
};

/** Focus is in a text field now: where the dispatcher keeps fixed keys and Mod+A away. */
export const focusInTextField = (): boolean => isTextField(activeElement());

export const detectPlatform = (): Platform => {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return platformOf(nav.userAgentData?.platform ?? nav.platform ?? '');
};

export const createShortcuts = (options: { keymap?: Keymap; platform?: Platform } = {}): Shortcuts => {
  let keymap = options.keymap ?? createKeymap();
  const platform = options.platform ?? detectPlatform();
  const handlers = new Map<ActionId, ShortcutHandler>();
  const reserved = new Set<ActionId>();
  const layers: ContextLayer[] = [];

  const context = (): ShortcutContext | null => {
    for (const layer of layers) {
      const answer = layer();
      if (answer !== null) return answer === 'none' ? null : answer;
    }
    return null;
  };

  /** Whether the press is a reserved action's key while that key is the browser's reload. */
  const isReserved = (e: KeyboardEvent): boolean => {
    if (reserved.size === 0) return false;
    const pressed = bindingOf(pressFromEvent(e, platform));
    if (pressed === null || !isReloadKey(pressed)) return false;
    return [...reserved].some((id) => sameBinding(keymap.get(id).binding, pressed));
  };

  const onKey = (e: KeyboardEvent): void => {
    const handled = e.defaultPrevented;
    if (isReserved(e)) e.preventDefault();
    // keyCode 229: some browsers report an IME press that way without isComposing.
    const composing = e.isComposing || e.keyCode === 229;
    if (handled || composing) return;
    const id = keymap.resolve({
      ...pressFromEvent(e, platform),
      context: context(),
      inTextField: focusInTextField(),
      composing,
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
    reserve: (id) => {
      reserved.add(id);
      return () => {
        reserved.delete(id);
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
      reserved.clear();
      layers.length = 0;
    },
  };
};
