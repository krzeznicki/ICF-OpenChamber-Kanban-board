// The task detail: a side sheet over the board with the full body as plain text, state and type
// selects, "Move to" buttons (the keyboard path for drag and drop) and Close / Close with sub-tasks.
// It draws what it is given and reports choices; the editor (edit.ts) runs them and asks to confirm.
import { mountBadge, mountButton, mountSelect, mountSpinner } from '@openchamber/sdk/ui';
import type { Task, TaskState } from '../../core/types.ts';
import type { Column } from '../columns.ts';

export const STATES: readonly TaskState[] = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix', 'done'];

export type DetailModel = {
  task: Task;
  column: Column;
  openChildren: number;
  types: string[];
  /** Role -> label in the repo (triage-labels.md); shown as a hint when it differs. */
  labels: Record<string, string>;
  /** Targets whose move does something, in board order. */
  moves: { to: Column; label: string }[];
  busy: boolean;
};

export type DetailCallbacks = {
  onMove: (to: Column) => void;
  onState: (state: TaskState) => void;
  onType: (type: string) => void;
  onClose: (withChildren: boolean) => void;
  onOpenUrl: (url: string) => void;
  onDismiss: () => void;
};

export type DetailHandle = { update: (model: DetailModel) => void; dispose: () => void };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const openDetail = (initial: DetailModel, callbacks: DetailCallbacks): DetailHandle => {
  const backdrop = el('div', 'kb-backdrop');
  const sheet = el('aside', 'kb-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.tabIndex = -1;
  backdrop.append(sheet);
  document.body.append(backdrop);

  let disposers: Array<() => void> = [];
  const clear = (): void => {
    for (const d of disposers) d();
    disposers = [];
    sheet.replaceChildren();
  };

  const draw = (m: DetailModel): void => {
    clear();
    const { task } = m;
    sheet.setAttribute('aria-label', task.title);
    sheet.setAttribute('aria-busy', String(m.busy));

    const head = el('div', 'kb-sheet-head');
    const titles = el('div', 'kb-sheet-titles');
    titles.append(el('h2', 'kb-sheet-title', task.title), el('div', 'kb-card-id', task.id));
    const closeSlot = el('div', 'kb-sheet-x');
    head.append(titles, closeSlot);
    disposers.push(mountButton(closeSlot, { label: 'Done', variant: 'ghost', size: 'sm', onClick: callbacks.onDismiss }).dispose);
    sheet.append(head);

    const badges = el('div', 'kb-badges');
    if (task.kind === 'parent') disposers.push(mountBadge(badges, { label: 'parent', tone: 'primary' }).dispose);
    if (m.busy) {
      const spin = el('span', 'kb-inline-spin');
      badges.append(spin);
      disposers.push(mountSpinner(spin, { size: 'sm', label: 'Saving' }).dispose);
    }
    sheet.append(badges);

    const meta = el('dl', 'kb-meta');
    const row = (term: string, value: string): void => {
      meta.append(el('dt', '', term), el('dd', '', value));
    };
    if (task.parentId !== null) row('Parent', task.parentId);
    if (task.blockedBy.length > 0) row('Blocked by', task.blockedBy.join(', '));
    if (m.openChildren > 0) row('Open sub-tasks', String(m.openChildren));
    if (meta.childElementCount > 0) sheet.append(meta);

    const fields = el('div', 'kb-fields');
    const stateSlot = el('div', 'kb-field');
    const typeSlot = el('div', 'kb-field');
    fields.append(stateSlot, typeSlot);
    sheet.append(fields);
    disposers.push(
      mountSelect(stateSlot, {
        label: 'State',
        value: task.state,
        options: STATES.map((s) => {
          const label = m.labels[s];
          return { id: s, label: s, ...(label !== undefined && label !== s ? { hint: label } : {}) };
        }),
        disabled: m.busy,
        onChange: (id) => {
          if (id !== task.state) callbacks.onState(id as TaskState);
        },
      }).dispose,
    );
    const types = task.type !== null && !m.types.includes(task.type) ? [...m.types, task.type] : m.types;
    disposers.push(
      mountSelect(typeSlot, {
        label: 'Type',
        value: task.type,
        placeholder: 'No type',
        options: types.map((t) => ({ id: t, label: t })),
        disabled: m.busy,
        onChange: (id) => {
          if (id !== task.type) callbacks.onType(id);
        },
      }).dispose,
    );

    if (m.moves.length > 0) {
      const moveRow = el('div', 'kb-actions kb-actions-start');
      moveRow.append(el('span', 'kb-actions-label', 'Move to'));
      for (const { to, label } of m.moves) {
        disposers.push(
          mountButton(moveRow, { label, variant: 'outline', size: 'xs', disabled: m.busy, onClick: () => callbacks.onMove(to) }).dispose,
        );
      }
      sheet.append(moveRow);
    }

    const actions = el('div', 'kb-actions kb-actions-start');
    if (task.state !== 'done') {
      disposers.push(
        mountButton(actions, { label: 'Close', variant: 'secondary', size: 'sm', disabled: m.busy, onClick: () => callbacks.onClose(false) })
          .dispose,
      );
      if (m.openChildren > 0) {
        disposers.push(
          mountButton(actions, {
            label: 'Close with sub-tasks',
            variant: 'destructive',
            size: 'sm',
            disabled: m.busy,
            onClick: () => callbacks.onClose(true),
          }).dispose,
        );
      }
    }
    const url = task.url;
    if (url !== null) {
      disposers.push(
        mountButton(actions, { label: 'Open on GitHub', variant: 'ghost', size: 'sm', onClick: () => callbacks.onOpenUrl(url) }).dispose,
      );
    }
    if (actions.childElementCount > 0) sheet.append(actions);

    // Plain text: textContent never interprets the markdown or any HTML in it.
    const body = el('pre', 'kb-detail-body', task.body.trim() === '' ? 'No description.' : task.body);
    if (task.body.trim() === '') body.classList.add('is-empty');
    sheet.append(body);
  };

  const onKey = (e: KeyboardEvent): void => {
    // A confirm on top handles its own Escape first (capture phase) and stops it; an open select
    // popup closes itself and marks the event handled.
    if (e.key === 'Escape' && !e.defaultPrevented) callbacks.onDismiss();
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) callbacks.onDismiss();
  });
  document.addEventListener('keydown', onKey);

  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  draw(initial);
  sheet.focus();

  return {
    update: draw,
    dispose: () => {
      document.removeEventListener('keydown', onKey);
      clear();
      backdrop.remove();
      if (previous?.isConnected) previous.focus();
    },
  };
};
