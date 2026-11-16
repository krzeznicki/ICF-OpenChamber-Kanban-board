// What the cheat sheet (`?` on the Board) lists: every Shortcut of the current Keymap, grouped by
// Shortcut context in table order, fixed keys included, each with its key as the user reads it.
// Pure, so it runs under node:test; ui/cheatSheet.ts draws it. Built from the Keymap at the time the
// sheet opens, so a rebinding shows.
import { CONTEXT_LABELS, formatBinding, type ActionId, type Keymap, type Platform, type ShortcutContext } from './keymap.ts';

export type CheatSheetRow = { id: ActionId; label: string; keys: string };
export type CheatSheetGroup = { context: ShortcutContext; title: string; rows: CheatSheetRow[] };

const CONTEXTS: readonly ShortcutContext[] = ['board', 'task', 'add'];

export const cheatSheetGroups = (keymap: Keymap, platform: Platform): CheatSheetGroup[] =>
  CONTEXTS.map((context) => ({
    context,
    title: CONTEXT_LABELS[context],
    rows: keymap.list(context).map((s) => ({ id: s.id, label: s.label, keys: formatBinding(s.binding, platform) })),
  })).filter((g) => g.rows.length > 0);
