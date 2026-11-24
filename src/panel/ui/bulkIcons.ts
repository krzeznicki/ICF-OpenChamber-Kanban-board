// Small outline icons for actions not supplied by the SDK's primitives.
const shapes = {
  all: '<rect x="7" y="7" width="13" height="13" rx="2"/><path d="M16 4H5a1 1 0 0 0-1 1v11m6-3 3 3 4-5"/>',
  clear: '<path d="m6 6 12 12M18 6 6 18"/>',
  move: '<path d="M4 5h5v14H4zm11 0h5v14h-5M8 12h8m-3-3 3 3-3 3"/>',
  label: '<path d="M20 13 11 22 2 13V3h10l8 8z"/><circle cx="7" cy="8" r="1"/>',
  parent: '<rect x="8" y="2" width="8" height="5" rx="1"/><path d="M12 7v5M5 16v-4h14v4"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/>',
  unparent: '<path d="m9 15-2 2a4 4 0 0 1-6-6l3-3m11 1 2-2a4 4 0 0 1 6 6l-3 3M8 12l8-8M3 2l19 20"/>',
  blocker: '<path d="M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l2-2"/>',
  start: '<path d="m7 4 14 8-14 8z"/>',
  queue: '<path d="M4 5h16M4 11h9M4 17h9m5-4v8m-4-4h8"/>',
  archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8M9 12h6"/>',
  restore: '<path d="M5 9a8 8 0 1 1-1 8M5 3v6h6M12 8v5l3 2"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
} as const;
let next = 0;
export const bulkIconButton = (root: HTMLElement, name: keyof typeof shapes, label: string, onClick: () => void) => {
  const wrap = document.createElement('span');
  wrap.className = 'kb-bulk-icon-wrap';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `kb-bulk-icon${name === 'delete' ? ' is-danger' : ''}`;
  button.setAttribute('aria-label', label);
  const tip = document.createElement('span');
  tip.className = 'kb-bulk-tip';
  tip.id = `bulk-tip-${++next}`;
  tip.setAttribute('role', 'tooltip');
  tip.textContent = label;
  button.setAttribute('aria-describedby', tip.id);
  button.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]}</svg>`;
  button.addEventListener('click', onClick);
  wrap.append(button, tip);
  root.append(wrap);
  return {
    button,
    update: (disabled: boolean, reason?: string) => {
      button.disabled = disabled;
      tip.textContent = reason ? `${label} — ${reason}` : label;
      wrap.title = tip.textContent;
    },
  };
};
