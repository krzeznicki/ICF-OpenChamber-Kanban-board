// Key hints in button tooltips: "Add task (⌘A)". A button is marked once with its Shortcut's action
// id and its name; its `title` is built from the current Keymap (keymap.ts), and setHintKeymap,
// called whenever the user's bindings change, rewrites every marked tooltip on the page. Marks live
// on the elements (data attributes), so a redrawn button is simply marked again and nothing leaks.
import { createKeymap, type ActionId, type Keymap, type Platform } from '../keymap.ts';
import { detectPlatform } from '../shortcuts.ts';

const ID = 'kbShortcut';
const LABEL = 'kbShortcutLabel';
const SELECTOR = '[data-kb-shortcut]';

let current: { keymap: Keymap; platform: Platform } | null = null;
const source = (): { keymap: Keymap; platform: Platform } => (current ??= { keymap: createKeymap(), platform: detectPlatform() });

/** The tooltip text: the name with the current key, "Add task (⌘A)". */
export const hintText = (label: string, id: ActionId, keymap: Keymap, platform: Platform): string =>
  `${label} (${keymap.label(id, platform)})`;

const paint = (node: HTMLElement): void => {
  const id = node.dataset[ID] as ActionId | undefined;
  if (id === undefined) return;
  const { keymap, platform } = source();
  node.title = hintText(node.dataset[LABEL] ?? '', id, keymap, platform);
};

/** Marks `target` (a button, or the slot a kit control sits in) with the Shortcut `id`; null is ignored. */
export const hintShortcut = (target: Element | null | undefined, id: ActionId, label: string): void => {
  if (!(target instanceof HTMLElement)) return;
  target.dataset[ID] = id;
  target.dataset[LABEL] = label;
  paint(target);
};

/** Marks the control just mounted into `container` (the kit's mount functions append it last). */
export const hintLastChild = (container: Element, id: ActionId, label: string): void =>
  hintShortcut(container.lastElementChild, id, label);

/** The Keymap changed: every marked tooltip on the page shows the new key. */
export const setHintKeymap = (keymap: Keymap, platform: Platform): void => {
  current = { keymap, platform };
  for (const node of document.querySelectorAll<HTMLElement>(SELECTOR)) paint(node);
};
