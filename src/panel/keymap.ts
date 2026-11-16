// The Keymap: which Shortcut (GLOSSARY.md) a key press means. Pure, so it runs under node:test; the
// one keydown listener that feeds it is shortcuts.ts. It holds the default table (spec
// .scratch/skroty-klawiaturowe-2) with the user's overrides layered on top, resolves a key press in
// a Shortcut context to an action id, validates a new binding and formats one for display.
// - Bindings are platform-neutral: "Mod" is Cmd on macOS and Ctrl on Windows and Linux. As text
//   they read "Mod+Shift+ArrowLeft" (the form overrides are stored in).
// - Action ids are stable: settings store overrides under them and later code registers handlers
//   for them, so an id is never renamed.
// - Fixed keys (arrows, Enter, Esc and `?` on the Board) are in the table so the cheat sheet and
//   Settings can list them, but they cannot be rebound and never fire in a text field. Esc is listed
//   only: resolve never returns it, so the search field's, the modal's and a confirm's own Escape
//   handling stays as it is.

export type Platform = 'mac' | 'other';
/** Where a Shortcut applies: the Board, an Open task (the task modal) or Add task. */
export type ShortcutContext = 'board' | 'task' | 'add';

export type ActionId =
  | 'board.addTask'
  | 'board.toggleSubtasks'
  | 'board.moveCardPrev'
  | 'board.moveCardNext'
  | 'board.projects'
  | 'board.settings'
  | 'board.refresh'
  | 'board.search'
  | 'board.selectUp'
  | 'board.selectDown'
  | 'board.selectLeft'
  | 'board.selectRight'
  | 'board.openSelected'
  | 'board.escape'
  | 'board.cheatSheet'
  | 'task.prev'
  | 'task.next'
  | 'task.edit'
  | 'task.saveEdit'
  | 'task.addSubtask'
  | 'task.pickParent'
  | 'task.state1'
  | 'task.state2'
  | 'task.state3'
  | 'task.state4'
  | 'task.state5'
  | 'task.openSession'
  | 'task.delete'
  | 'add.create';

/**
 * One key combination. `key` is a KeyboardEvent.key, normalised: letters lower case, named keys as
 * the browser spells them (ArrowLeft, Enter, Backspace). A printable symbol such as `?` or `,`
 * carries no Shift of its own (the symbol already says it).
 */
export type Binding = { key: string; mod: boolean; shift: boolean; alt: boolean };

export type ShortcutDef = {
  id: ActionId;
  context: ShortcutContext;
  /** What the action does, as Settings and the cheat sheet show it. */
  label: string;
  binding: Binding;
  /** Not rebindable and not listed as such; fires only outside text fields. */
  fixed: boolean;
  /** Listed for the user only: resolve never returns it (Esc keeps its own handling). */
  listedOnly?: boolean;
};

/** A key press as the dispatcher reports it. `context` null: no Shortcuts (a confirm or Settings is open). */
export type KeyInput = {
  key: string;
  /** KeyboardEvent.code, used when `key` is not a plain letter or digit (Option on macOS changes it). */
  code?: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  context: ShortcutContext | null;
  /** Focus is in a text input, a textarea or an editable element. */
  inTextField: boolean;
  /** An IME composition is active (KeyboardEvent.isComposing, or keyCode 229). */
  composing: boolean;
  platform: Platform;
};

/** Action id -> binding as text ("Mod+Shift+R"); what Settings stores. Only the changed ones. */
export type Overrides = Partial<Record<ActionId, string>>;

const mod = (key: string, shift = false): Binding => ({ key, mod: true, shift, alt: false });
const plain = (key: string): Binding => ({ key, mod: false, shift: false, alt: false });

const def = (id: ActionId, context: ShortcutContext, label: string, binding: Binding, fixed = false): ShortcutDef => ({
  id,
  context,
  label,
  binding,
  fixed,
});
/** A fixed key the table lists but never resolves. */
const listed = (id: ActionId, context: ShortcutContext, label: string, binding: Binding): ShortcutDef => ({
  ...def(id, context, label, binding, true),
  listedOnly: true,
});

/** The default table, in the order Settings and the cheat sheet list it. */
export const DEFAULT_SHORTCUTS: readonly ShortcutDef[] = [
  def('board.addTask', 'board', 'Add task', mod('a')),
  def('board.toggleSubtasks', 'board', 'Hide/show sub-tasks', mod('s')),
  def('board.moveCardPrev', 'board', 'Move card to previous column', mod('ArrowLeft', true)),
  def('board.moveCardNext', 'board', 'Move card to next column', mod('ArrowRight', true)),
  def('board.projects', 'board', 'Project switcher', mod('k')),
  def('board.settings', 'board', 'Settings', mod(',')),
  def('board.refresh', 'board', 'Refresh', mod('r', true)),
  def('board.search', 'board', 'Search', mod('f')),
  def('board.selectUp', 'board', 'Select card above', plain('ArrowUp'), true),
  def('board.selectDown', 'board', 'Select card below', plain('ArrowDown'), true),
  def('board.selectLeft', 'board', 'Select card in previous column', plain('ArrowLeft'), true),
  def('board.selectRight', 'board', 'Select card in next column', plain('ArrowRight'), true),
  def('board.openSelected', 'board', 'Open selected card', plain('Enter'), true),
  listed('board.escape', 'board', 'Leave search / close dialog', plain('Escape')),
  def('board.cheatSheet', 'board', 'Show keyboard shortcuts', plain('?'), true),
  def('task.prev', 'task', 'Previous task', mod('ArrowUp')),
  def('task.next', 'task', 'Next task', mod('ArrowDown')),
  def('task.edit', 'task', 'Edit', mod('e')),
  def('task.saveEdit', 'task', 'Save edit', mod('Enter')),
  def('task.addSubtask', 'task', 'Add sub-task', mod('s')),
  def('task.pickParent', 'task', 'Pick parent', mod('p')),
  def('task.state1', 'task', 'Set state to column 1', mod('1')),
  def('task.state2', 'task', 'Set state to column 2', mod('2')),
  def('task.state3', 'task', 'Set state to column 3', mod('3')),
  def('task.state4', 'task', 'Set state to column 4', mod('4')),
  def('task.state5', 'task', 'Set state to column 5', mod('5')),
  def('task.openSession', 'task', 'Open session', mod('o')),
  def('task.delete', 'task', 'Delete (with confirm)', mod('Backspace')),
  def('add.create', 'add', 'Create task', mod('Enter')),
];

/** The Shortcut contexts in the order Settings and the cheat sheet list them, with their names. */
export const SHORTCUT_CONTEXTS: readonly { context: ShortcutContext; label: string }[] = [
  { context: 'board', label: 'Board' },
  { context: 'task', label: 'Open task' },
  { context: 'add', label: 'Add task' },
];

export const CONTEXT_LABELS = Object.fromEntries(SHORTCUT_CONTEXTS.map((c) => [c.context, c.label])) as Record<ShortcutContext, string>;

/** Mod+<key> the app (or the OS) may take before the panel sees them: recording one warns. */
export const RESERVED_KEYS: readonly string[] = ['w', 'q', 'r', 't', 'n'];

/**
 * Mod+<key> the browser owns in a text field (select all, clipboard, undo): never a Shortcut there,
 * whatever it is bound to, and refused when recording (except Add task's own default Mod+A). The
 * spec names Mod+A; the clipboard and undo keys follow the same reason.
 */
const TEXT_FIELD_KEYS: readonly string[] = ['a', 'c', 'v', 'x', 'z'];

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'Fn', 'OS', 'Dead', 'Process', 'Unidentified']);

const isAlnum = (k: string): boolean => /^[a-z0-9]$/i.test(k);
/** One printable symbol (not a letter or digit): Shift is part of the symbol, not of the binding. */
const isSymbol = (k: string): boolean => [...k].length === 1 && !isAlnum(k) && k !== ' ';

/** The key a press means: `key` when it is a plain letter or digit, else the physical one from `code`. */
const pressedKey = (key: string, code: string | undefined): string => {
  if (isAlnum(key)) return key.toLowerCase();
  const fromCode = code === undefined ? null : (/^Key([A-Z])$/.exec(code) ?? /^Digit([0-9])$/.exec(code));
  // Option (macOS) or a dead key turns a letter into another character; the physical key is meant.
  if (fromCode !== null && fromCode !== undefined && ([...key].length === 1 || key === 'Dead')) return fromCode[1]!.toLowerCase();
  return key === ' ' ? 'Space' : key;
};

/**
 * The binding a key press makes, or null for a lone modifier. On macOS only Cmd is Mod (Ctrl is
 * not, so Ctrl+A makes a binding without a modifier); elsewhere only Ctrl is, and Win/Super is not.
 */
export const bindingOf = (input: Pick<KeyInput, 'key' | 'code' | 'meta' | 'ctrl' | 'shift' | 'alt' | 'platform'>): Binding | null =>
  pressOf(input)?.binding ?? null;

type PressInput = Pick<KeyInput, 'key' | 'code' | 'meta' | 'ctrl' | 'shift' | 'alt' | 'platform'>;

/** The fields of a KeyboardEvent the Keymap reads. */
export type KeyEventLike = { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };

/** A keydown read into a press (resolve adds the context; bindingOf takes it as is). */
export const pressFromEvent = (e: KeyEventLike, platform: Platform): PressInput => ({
  key: e.key,
  code: e.code,
  meta: e.metaKey,
  ctrl: e.ctrlKey,
  shift: e.shiftKey,
  alt: e.altKey,
  platform,
});

/** Plain Mod+<key>: no Shift, no Alt. */
const plainMod = (b: Binding): boolean => b.mod && !b.shift && !b.alt;

/** The binding of a press; `foreign`: the non-Mod one of Cmd/Ctrl is held, so no Shortcut matches. */
const pressOf = (input: PressInput): { binding: Binding; foreign: boolean } | null => {
  if (MODIFIER_KEYS.has(input.key)) return null;
  const key = pressedKey(input.key, input.code);
  const isMod = input.platform === 'mac' ? input.meta : input.ctrl;
  const foreign = input.platform === 'mac' ? input.ctrl : input.meta;
  return { binding: { key, mod: isMod && !foreign, shift: isSymbol(key) ? false : input.shift, alt: input.alt }, foreign };
};

/** The browser's reload (Mod+R, Mod+Shift+R): it would reload the panel's frame. */
export const isReloadKey = (b: Binding): boolean => b.mod && !b.alt && b.key === 'r';

export const sameBinding = (a: Binding, b: Binding): boolean =>
  a.key === b.key && a.mod === b.mod && a.shift === b.shift && a.alt === b.alt;

// --- text form ---

/** "Mod+Shift+ArrowLeft": the platform-neutral text an override is stored as. */
export const bindingToString = (b: Binding): string =>
  [b.mod ? 'Mod' : '', b.alt ? 'Alt' : '', b.shift ? 'Shift' : '', b.key === '+' ? 'Plus' : b.key].filter((p) => p !== '').join('+');

/** The text form read back, or null when it is not one (a stored value is never trusted). */
export const parseBinding = (text: unknown): Binding | null => {
  if (typeof text !== 'string' || text === '' || text.length > 40) return null;
  const parts = text.split('+');
  const last = parts.pop();
  if (last === undefined || last === '') return null;
  const flags = new Set(parts);
  if (flags.size !== parts.length || [...flags].some((f) => f !== 'Mod' && f !== 'Shift' && f !== 'Alt')) return null;
  const key = last === 'Plus' ? '+' : isAlnum(last) ? last.toLowerCase() : last;
  if (MODIFIER_KEYS.has(key)) return null;
  return { key, mod: flags.has('Mod'), shift: flags.has('Shift') && !isSymbol(key), alt: flags.has('Alt') };
};

// --- display ---

const MAC_KEYS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '↩',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: 'Esc',
  Tab: '⇥',
  Space: 'Space',
};
const OTHER_KEYS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
};

const keyName = (key: string, platform: Platform): string =>
  (platform === 'mac' ? MAC_KEYS[key] : OTHER_KEYS[key]) ?? ([...key].length === 1 ? key.toUpperCase() : key);

/** A binding as the user reads it: "⌘⇧R" on macOS, "Ctrl+Shift+R" elsewhere. */
export const formatBinding = (b: Binding, platform: Platform): string =>
  platform === 'mac'
    ? `${b.alt ? '⌥' : ''}${b.shift ? '⇧' : ''}${b.mod ? '⌘' : ''}${keyName(b.key, platform)}`
    : [b.mod ? 'Ctrl' : '', b.alt ? 'Alt' : '', b.shift ? 'Shift' : '', keyName(b.key, platform)].filter((p) => p !== '').join('+');

// --- overrides ---

const DEFAULTS = new Map(DEFAULT_SHORTCUTS.map((s) => [s.id, s]));

export const isActionId = (id: unknown): id is ActionId => typeof id === 'string' && DEFAULTS.has(id as ActionId);

/** Stored overrides read defensively: known, rebindable actions with a readable binding. */
export const parseOverrides = (raw: unknown): Overrides => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Overrides = {};
  for (const [id, text] of Object.entries(raw as Record<string, unknown>)) {
    if (!isActionId(id) || DEFAULTS.get(id)!.fixed) continue;
    const b = parseBinding(text);
    if (b !== null) out[id] = bindingToString(b);
  }
  return out;
};

/** `id` bound to `binding`; a binding equal to the default drops the override. */
export const setOverride = (overrides: Overrides, id: ActionId, binding: Binding): Overrides => {
  const { [id]: _, ...rest } = overrides;
  const base = DEFAULTS.get(id);
  return base === undefined || base.fixed || sameBinding(base.binding, binding) ? rest : { ...rest, [id]: bindingToString(binding) };
};

/** `id` back to its default. Resetting all is the empty object. */
export const resetOverride = (overrides: Overrides, id: ActionId): Overrides => {
  const { [id]: _, ...rest } = overrides;
  return rest;
};

// --- validation ---

export type Validation =
  | { ok: true; warning: 'reserved' | null }
  | { ok: false; reason: 'fixed' }
  | { ok: false; reason: 'no-modifier' }
  /** One of the keys a text field keeps (select all, copy, paste, cut, undo). */
  | { ok: false; reason: 'text-field' }
  | { ok: false; reason: 'duplicate'; holder: ShortcutDef };

// --- the Keymap ---

export type Keymap = {
  /** The action a key press means, or null (no Shortcut, or the browser keeps the key). */
  resolve: (input: KeyInput) => ActionId | null;
  /** Every Shortcut with its current binding, in table order. */
  all: () => ShortcutDef[];
  /** The Shortcuts of one context, in table order (fixed keys included; check `fixed`). */
  list: (context: ShortcutContext) => ShortcutDef[];
  /** One Shortcut with its current binding. */
  get: (id: ActionId) => ShortcutDef;
  /** The current binding of `id` as the user reads it ("⌘A", "Ctrl+A"). */
  label: (id: ActionId, platform: Platform) => string;
  /** Whether `id` may be bound to `binding` here (a warning still allows it). */
  validate: (id: ActionId, binding: Binding) => Validation;
  /** Whether `id` differs from its default. */
  overridden: (id: ActionId) => boolean;
};

/** The default table with `overrides` on top (unreadable ones are ignored). */
export const createKeymap = (overrides: Overrides = {}): Keymap => {
  const clean = parseOverrides(overrides);
  const table: ShortcutDef[] = DEFAULT_SHORTCUTS.map((s) => {
    const text = clean[s.id];
    const b = text === undefined ? null : parseBinding(text);
    return b === null ? { ...s, binding: { ...s.binding } } : { ...s, binding: b };
  });
  const byId = new Map(table.map((s) => [s.id, s]));
  const get = (id: ActionId): ShortcutDef => {
    const s = byId.get(id);
    if (s === undefined) throw new Error(`Unknown Shortcut: ${id}`);
    return { ...s, binding: { ...s.binding } };
  };

  const resolve = (input: KeyInput): ActionId | null => {
    if (input.composing || input.context === null) return null;
    const press = pressOf(input);
    if (press === null || press.foreign) return null;
    const pressed = press.binding;
    if (input.inTextField && plainMod(pressed) && TEXT_FIELD_KEYS.includes(pressed.key)) return null;
    for (const s of table) {
      if (s.listedOnly === true || s.context !== input.context || !sameBinding(s.binding, pressed)) continue;
      if (s.fixed && input.inTextField) return null;
      return s.id;
    }
    return null;
  };

  const validate = (id: ActionId, binding: Binding): Validation => {
    const self = get(id);
    if (self.fixed) return { ok: false, reason: 'fixed' };
    if (!binding.mod) return { ok: false, reason: 'no-modifier' };
    const holder = table.find((s) => s.id !== id && s.context === self.context && sameBinding(s.binding, binding));
    if (holder !== undefined) return { ok: false, reason: 'duplicate', holder: { ...holder, binding: { ...holder.binding } } };
    if (plainMod(binding) && TEXT_FIELD_KEYS.includes(binding.key) && !sameBinding(DEFAULTS.get(id)!.binding, binding)) {
      return { ok: false, reason: 'text-field' };
    }
    const reserved = plainMod(binding) && RESERVED_KEYS.includes(binding.key);
    return { ok: true, warning: reserved ? 'reserved' : null };
  };

  return {
    resolve,
    all: () => table.map((s) => get(s.id)),
    list: (context) => table.filter((s) => s.context === context).map((s) => get(s.id)),
    get,
    label: (id, platform) => formatBinding(get(id).binding, platform),
    validate,
    overridden: (id) => clean[id] !== undefined,
  };
};

/** The platform from navigator.platform / userAgentData.platform: macOS and iOS use Cmd. */
export const platformOf = (navigatorPlatform: string): Platform => (/mac|iphone|ipad|ipod/i.test(navigatorPlatform) ? 'mac' : 'other');
