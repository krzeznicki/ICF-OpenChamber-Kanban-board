// The shell the task modal and the Add task modal share: a centred box over a backdrop, a dialog
// role, Escape and a backdrop click to dismiss, and focus kept inside. What was on the page before
// it (the board) is inert while it is open; layers opened on top later (a confirm) are appended
// after it and stay usable. Disposing restores the board and the focus it had.
/** A select or checkbox list with more choices than this gets a search box (task modal and Add task). */
export const FILTER_OVER = 8;

export type ModalShell = {
  backdrop: HTMLDivElement;
  modal: HTMLDivElement;
  dispose: () => void;
};

export const openModalShell = (options: { label: string; onDismiss: () => void; className?: string }): ModalShell => {
  // Taken before the board goes inert (which drops its focus); focused again on close.
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const backdrop = document.createElement('div');
  backdrop.className = 'kb-backdrop kb-modal-backdrop';
  const modal = document.createElement('div');
  modal.className = options.className === undefined ? 'kb-modal' : `kb-modal ${options.className}`;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', options.label);
  modal.tabIndex = -1;
  backdrop.append(modal);
  const inerted = [...document.body.children].filter((n): n is HTMLElement => n instanceof HTMLElement && !n.inert);
  for (const n of inerted) n.inert = true;
  document.body.append(backdrop);

  const onKey = (e: KeyboardEvent): void => {
    // A confirm on top handles its own Escape first (capture phase) and stops it; an open select
    // popup closes itself and marks the event handled.
    if (e.key === 'Escape' && !e.defaultPrevented) options.onDismiss();
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) options.onDismiss();
  });
  document.addEventListener('keydown', onKey);

  return {
    backdrop,
    modal,
    dispose: () => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      for (const n of inerted) n.inert = false;
      if (previous?.isConnected) previous.focus();
    },
  };
};
