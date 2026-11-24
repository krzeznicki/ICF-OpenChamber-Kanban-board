import { mountButton, mountSelect, mountSwitch, mountTextField } from '@openchamber/sdk/ui';
import type { Task } from '../../core/types.ts';
import { COLUMNS } from '../columns.ts';
import type { ActionPreview, BulkAction } from '../bulkActions.ts';
import { bulkIconButton } from './bulkIcons.ts';

export const ACTION_LABELS: Record<BulkAction['kind'], string> = {
  move: 'Move to column', label: 'Labels', parent: 'Set parent', unparent: 'Unlink parent',
  blocker: 'Add blocker', start: 'Start Task', queue: 'Add to queue', archive: 'Archive',
  restore: 'Restore', copy: 'Copy', delete: 'Delete',
};
export type ActionFormDeps = {
  tasks(): readonly Task[];
  preview(action: BulkAction): ActionPreview;
  submit(action: BulkAction, ids: readonly string[]): Promise<void>;
  dismiss(): void;
};
export const mountBulkActionForm = (root: HTMLElement, deps: ActionFormDeps) => {
  root.className = 'kb-bulk-popover';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  let action: BulkAction | null = null;
  let locked = false;
  let opener: HTMLElement | null = null;
  let handles: { dispose(): void; update(props: { disabled: boolean }): void }[] = [];
  let submit: ReturnType<typeof mountButton> | null = null;
  let controlsLocked: boolean | null = null;
  const head = document.createElement('div');
  head.className = 'kb-bulk-popover-head';
  const title = document.createElement('strong');
  const close = bulkIconButton(head, 'clear', 'Close action', () => dismiss());
  head.prepend(title);
  const form = document.createElement('div');
  form.className = 'kb-bulk-form-fields';
  const preview = document.createElement('div');
  preview.className = 'kb-bulk-preview';
  preview.setAttribute('aria-live', 'polite');
  const footer = document.createElement('div');
  root.append(head, form, preview, footer);
  const dismiss = () => {
    if (locked) return;
    action = null;
    root.hidden = true;
    opener?.focus({ preventScroll: true });
    deps.dismiss();
  };
  const slot = () => { const div = document.createElement('div'); form.append(div); return div; };
  const refresh = () => {
    if (!action) return;
    const p = deps.preview(action);
    const invalid = (action.kind === 'label' && !action.label.trim()) ||
      (action.kind === 'parent' && !action.parentId) || (action.kind === 'blocker' && !action.blockerId);
    preview.textContent = `${p.eligible.length} eligible${p.additional.length ? ` + ${p.additional.length} sub-tasks` : ''}${p.excluded.length ? ` · ${p.excluded.length} excluded` : ''}`;
    if (p.excluded.length) {
      const why = document.createElement('div');
      why.className = 'kb-muted';
      why.textContent = [...new Set(p.excluded.map(t => t.reason))].join(' ');
      preview.append(why);
    }
    submit?.update({ disabled: locked || invalid || !p.eligible.length, loading: locked });
    close.update(locked);
    if (controlsLocked !== locked) {
      controlsLocked = locked;
      for (const h of handles) h.update({ disabled: locked });
    }
  };
  return {
    open: (kind: BulkAction['kind'], trigger: HTMLElement, previous: BulkAction | null = null) => {
      if (locked) return;
      opener = trigger;
      handles.forEach(h => h.dispose()); handles = [];
      controlsLocked = null;
      submit?.dispose(); form.replaceChildren(); footer.replaceChildren();
      const initial: BulkAction = previous?.kind === kind ? { ...previous } : kind === 'move' ? { kind, to: 'ready' }
        : kind === 'label' ? { kind, label: '', mode: 'add' }
        : kind === 'parent' ? { kind, parentId: '' }
        : kind === 'blocker' ? { kind, blockerId: '' }
        : kind === 'delete' ? { kind, withChildren: false }
        : kind === 'copy' ? { kind, format: 'titles' } : { kind };
      action = initial;
      root.hidden = false;
      root.setAttribute('aria-label', ACTION_LABELS[kind]);
      title.textContent = ACTION_LABELS[kind];
      const select = (label: string, value: string, options: { id: string; label: string }[], change: (value: string) => void) => {
        handles.push(mountSelect(slot(), { label, value, options, onChange: value => { change(value); refresh(); } }));
      };
      if (kind === 'move') select('Destination', initial.kind === 'move' ? initial.to : 'ready', COLUMNS.map(c => ({ id: c.id, label: c.title })), to => { action = { kind, to: to as typeof COLUMNS[number]['id'] }; });
      if (kind === 'label') {
        select('Operation', initial.kind === 'label' ? initial.mode : 'add', [{ id: 'add', label: 'Add label' }, { id: 'remove', label: 'Remove label' }], mode => { if (action?.kind === kind) action = { ...action, mode: mode as 'add' | 'remove' }; });
        handles.push(mountTextField(slot(), { label: 'Label', value: initial.kind === 'label' ? initial.label : '', placeholder: 'e.g. urgent', onChange: label => { if (action?.kind === kind) action = { ...action, label }; refresh(); } }));
      }
      if (kind === 'parent' || kind === 'blocker') {
        select(kind === 'parent' ? 'Parent task' : 'Blocking task', initial.kind === 'parent' ? initial.parentId : initial.kind === 'blocker' ? initial.blockerId : '', [
          { id: '', label: 'Choose a task…' },
          ...deps.tasks().map(t => ({ id: t.id, label: `${t.title} · ${t.id}` })),
        ], id => { action = kind === 'parent' ? { kind, parentId: id } : { kind, blockerId: id }; });
      }
      if (kind === 'copy') select('Format', initial.kind === 'copy' ? initial.format : 'titles', [{ id: 'titles', label: 'Titles' }, { id: 'links', label: 'Links / local paths' }], format => { action = { kind, format: format as 'titles' | 'links' }; });
      if (kind === 'delete') {
        const warning = document.createElement('p');
        warning.className = 'kb-muted';
        warning.textContent = 'Permanently deletes tasks from their source. This cannot be undone.';
        form.append(warning);
        handles.push(mountSwitch(slot(), { label: 'Also delete sub-tasks', checked: initial.kind === 'delete' && initial.withChildren, onChange: withChildren => { action = { kind, withChildren }; refresh(); } }));
      }
      if (kind === 'start' || kind === 'queue') {
        const note = document.createElement('p');
        note.className = 'kb-muted';
        note.textContent = 'Uses each task’s start settings and the project’s agent limit. Queued tasks may start as soon as a slot is available.';
        form.append(note);
      }
      submit = mountButton(footer, {
        label: kind === 'delete' ? 'Delete eligible tasks' : kind === 'copy' ? 'Copy' : 'Apply to eligible tasks',
        variant: kind === 'delete' ? 'destructive' : 'default', size: 'sm',
        onClick: () => {
          if (!action || locked) return;
          const chosen = action;
          const p = deps.preview(chosen);
          if (!p.eligible.length) return;
          locked = true; refresh();
          void deps.submit(chosen, p.eligible).finally(() => { locked = false; dismiss(); });
        },
      });
      refresh();
      (form.querySelector<HTMLElement>('input, button') ?? footer.querySelector<HTMLElement>('button'))?.focus();
    },
    update: (saving: boolean) => { locked = saving; refresh(); },
    dismiss,
    isOpen: () => action !== null,
    dispose: () => { handles.forEach(h => h.dispose()); submit?.dispose(); root.replaceChildren(); },
  };
};
