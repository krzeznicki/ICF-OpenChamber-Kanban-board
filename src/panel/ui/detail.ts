// The task detail: a side sheet over the board with the full body as plain text, state and type
// selects, "Move to" buttons (the keyboard path for drag and drop) and Close / Close with sub-tasks.
// Below them, the card's start options (preset, model, agent, location), each unset field showing
// what it inherits from the settings. It draws what it is given and reports choices; the editor (edit.ts) runs them and asks to confirm.
import { mountBadge, mountButton, mountSelect, mountSpinner } from '@openchamber/sdk/ui';
import type { Task, TaskState } from '../../core/types.ts';
import type { Column } from '../columns.ts';
import type { Preset } from '../presets.ts';
import type { Location, StartOptions } from '../settings.ts';
import { LOCATION_LABELS, mountInheritSelect, mountInheritText } from './settingsView.ts';

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
  /** The card's start options; null hides the section (e.g. a done task). */
  start: StartModel | null;
};

export type StartModel = {
  presets: Preset[];
  /** What the card itself sets (stored under card:<projectId>:<taskId>). */
  card: Partial<StartOptions>;
  /** What the card would start with if it set nothing. */
  inherited: StartOptions;
  /** Bumped when the stored card options were (re)loaded; the section then redraws. */
  version: number;
};

export type DetailCallbacks = {
  onStartOptions: (card: Partial<StartOptions>) => void;
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
  // Three parts: the top and the body redraw on every update; the start options only when what
  // they show changes from outside, so a text field there keeps its focus across a reload.
  const top = el('div', 'kb-sheet-part');
  const startBox = el('section', 'kb-sheet-part kb-start');
  const bodyBox = el('div', 'kb-sheet-part');
  sheet.append(top, startBox, bodyBox);
  backdrop.append(sheet);
  document.body.append(backdrop);

  let disposers: Array<() => void> = [];
  const clear = (): void => {
    for (const d of disposers) d();
    disposers = [];
    top.replaceChildren();
    bodyBox.replaceChildren();
  };
  let startDisposers: Array<() => void> = [];
  let startKey: string | null = null;
  const clearStart = (): void => {
    for (const d of startDisposers) d();
    startDisposers = [];
    startBox.replaceChildren();
  };

  const drawStart = (taskId: string, start: StartModel | null): void => {
    const key =
      start === null
        ? null
        : JSON.stringify([taskId, start.version, start.inherited, start.presets.map((p) => [p.id, p.name])]);
    if (key === startKey) return;
    startKey = key;
    clearStart();
    startBox.hidden = start === null;
    if (start === null) return;
    const card: Partial<StartOptions> = { ...start.card };
    const emit = (): void => callbacks.onStartOptions({ ...card });
    const name = (id: string): string => start.presets.find((p) => p.id === id)?.name ?? id;
    startBox.append(el('h3', 'kb-settings-heading', 'Start options'));
    const row1 = el('div', 'kb-fields');
    const row2 = el('div', 'kb-fields');
    const cells = [0, 1, 2, 3].map(() => el('div', 'kb-field'));
    row1.append(cells[0]!, cells[1]!);
    row2.append(cells[2]!, cells[3]!);
    startBox.append(row1, row2);
    mountInheritSelect(cells[0]!, startDisposers, {
      label: 'Preset',
      value: card.presetId,
      inheritLabel: `Default (${name(start.inherited.presetId)})`,
      options: start.presets.map((p) => ({ id: p.id, label: p.name })),
      onChange: (v) => {
        card.presetId = v;
        emit();
      },
    });
    mountInheritSelect(cells[1]!, startDisposers, {
      label: 'Location',
      value: card.location,
      inheritLabel: `Default (${LOCATION_LABELS[start.inherited.location]})`,
      options: (Object.keys(LOCATION_LABELS) as Location[]).map((id) => ({ id, label: LOCATION_LABELS[id] })),
      onChange: (v) => {
        card.location = v as Location | undefined;
        emit();
      },
    });
    mountInheritText(cells[2]!, startDisposers, {
      label: 'Model',
      value: card.model ?? undefined,
      placeholder: start.inherited.model ?? 'Your current model',
      resetLabel: 'Default',
      mono: true,
      onChange: (v) => {
        card.model = v ?? null;
        emit();
      },
    });
    mountInheritText(cells[3]!, startDisposers, {
      label: 'Agent',
      value: card.agent ?? undefined,
      placeholder: start.inherited.agent ?? 'Your current agent',
      resetLabel: 'Default',
      mono: true,
      onChange: (v) => {
        card.agent = v ?? null;
        emit();
      },
    });
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
    top.append(head);

    const badges = el('div', 'kb-badges');
    if (task.kind === 'parent') disposers.push(mountBadge(badges, { label: 'parent', tone: 'primary' }).dispose);
    if (m.busy) {
      const spin = el('span', 'kb-inline-spin');
      badges.append(spin);
      disposers.push(mountSpinner(spin, { size: 'sm', label: 'Saving' }).dispose);
    }
    top.append(badges);

    const meta = el('dl', 'kb-meta');
    const row = (term: string, value: string): void => {
      meta.append(el('dt', '', term), el('dd', '', value));
    };
    if (task.parentId !== null) row('Parent', task.parentId);
    if (task.blockedBy.length > 0) row('Blocked by', task.blockedBy.join(', '));
    if (m.openChildren > 0) row('Open sub-tasks', String(m.openChildren));
    if (meta.childElementCount > 0) top.append(meta);

    const fields = el('div', 'kb-fields');
    const stateSlot = el('div', 'kb-field');
    const typeSlot = el('div', 'kb-field');
    fields.append(stateSlot, typeSlot);
    top.append(fields);
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
      top.append(moveRow);
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
    if (actions.childElementCount > 0) top.append(actions);
    drawStart(task.id, m.start);

    // Plain text: textContent never interprets the markdown or any HTML in it.
    const body = el('pre', 'kb-detail-body', task.body.trim() === '' ? 'No description.' : task.body);
    if (task.body.trim() === '') body.classList.add('is-empty');
    bodyBox.append(body);
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
      clearStart();
      backdrop.remove();
      if (previous?.isConnected) previous.focus();
    },
  };
};
