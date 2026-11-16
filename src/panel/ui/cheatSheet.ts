// The cheat sheet `?` opens on the Board: the groups from cheatSheet.ts in a dialog over the board.
// Esc (capture phase, like a confirm), the Close button or a click on the backdrop closes it. While
// it is open main.ts reports no Shortcut context, so Board Shortcuts do not fire.
import { mountButton } from '@openchamber/sdk/ui';
import type { CheatSheetGroup } from '../cheatSheet.ts';

/** Draws the sheet; `onClose` runs once when it closes. Returns a function that closes it. */
export const openCheatSheet = (groups: CheatSheetGroup[], onClose: () => void): (() => void) => {
  const backdrop = document.createElement('div');
  backdrop.className = 'kb-backdrop kb-confirm-backdrop kb-cheat-backdrop';
  const box = document.createElement('div');
  box.className = 'kb-confirm kb-cheat';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'kb-cheat-title');
  const head = document.createElement('h2');
  head.className = 'kb-confirm-title';
  head.id = 'kb-cheat-title';
  head.textContent = 'Keyboard shortcuts';
  const body = document.createElement('div');
  body.className = 'kb-cheat-body';
  for (const g of groups) {
    const section = document.createElement('section');
    section.className = 'kb-cheat-group';
    const title = document.createElement('h3');
    title.className = 'kb-settings-heading';
    title.textContent = g.title;
    const list = document.createElement('dl');
    list.className = 'kb-cheat-list';
    for (const r of g.rows) {
      const dt = document.createElement('dt');
      dt.textContent = r.label;
      const dd = document.createElement('dd');
      const kbd = document.createElement('kbd');
      kbd.className = 'kb-kbd';
      kbd.textContent = r.keys;
      dd.append(kbd);
      list.append(dt, dd);
    }
    section.append(title, list);
    body.append(section);
  }
  const actions = document.createElement('div');
  actions.className = 'kb-actions';
  box.append(head, body, actions);
  backdrop.append(box);

  let closed = false;
  const disposers: Array<() => void> = [];
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    for (const d of disposers) d();
    backdrop.remove();
    onClose();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  disposers.push(mountButton(actions, { label: 'Close', variant: 'outline', size: 'sm', onClick: close }).dispose);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  actions.querySelector('button')?.focus();
  return close;
};
