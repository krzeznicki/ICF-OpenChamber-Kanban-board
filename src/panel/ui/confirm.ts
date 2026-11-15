// A question drawn inside the panel (the sandbox has no window.confirm): a dimmed backdrop, a title,
// a body and one button per answer. Resolves to the chosen id, or null on Cancel, Escape or a click
// on the backdrop.
import { mountButton } from '@openchamber/sdk/ui';
import type { ButtonVariant } from '@openchamber/sdk/ui';

export type Choice = { id: string; label: string; variant?: ButtonVariant };

export const askChoice = (title: string, body: string, choices: Choice[]): Promise<string | null> =>
  new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'kb-backdrop kb-confirm-backdrop';
    const box = document.createElement('div');
    box.className = 'kb-confirm';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const head = document.createElement('h2');
    head.className = 'kb-confirm-title';
    head.textContent = title;
    const text = document.createElement('p');
    text.className = 'kb-confirm-body';
    text.textContent = body;
    const actions = document.createElement('div');
    actions.className = 'kb-actions';
    box.append(head, text, actions);
    backdrop.append(box);

    const disposers: Array<() => void> = [];
    const done = (answer: string | null): void => {
      document.removeEventListener('keydown', onKey, true);
      for (const d of disposers) d();
      backdrop.remove();
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      done(null);
    };
    for (const c of choices) {
      disposers.push(mountButton(actions, { label: c.label, variant: c.variant ?? 'default', size: 'sm', onClick: () => done(c.id) }).dispose);
    }
    disposers.push(mountButton(actions, { label: 'Cancel', variant: 'outline', size: 'sm', onClick: () => done(null) }).dispose);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) done(null);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    actions.querySelector('button')?.focus();
  });
