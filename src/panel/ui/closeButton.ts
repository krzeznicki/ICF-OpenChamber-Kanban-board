// The icon-only × that closes a sheet (detail, Settings). The kit's button has no icon-only form,
// so the mounted <button> gets its accessible name and tooltip here; the kit's repaint leaves them alone.
import { mountButton } from '@openchamber/sdk/ui';

export const mountCloseButton = (slot: Element, onClick: () => void): (() => void) => {
  const handle = mountButton(slot, { label: '×', variant: 'ghost', size: 'sm', onClick });
  const button = slot.querySelector('button');
  if (button !== null) {
    button.setAttribute('aria-label', 'Close');
    button.title = 'Close';
    button.classList.add('kb-icon-close');
  }
  return handle.dispose;
};
