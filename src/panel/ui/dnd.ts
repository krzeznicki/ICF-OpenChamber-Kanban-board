// Pointer-based drag and drop for cards (HTML5 drag events are unreliable in the sandboxed frame).
// Listeners sit on the persistent columns container, so redraws during a drag do not break it:
// the pointer is captured by the container and a clone follows the pointer. A press that moves
// less than THRESHOLD pixels is a click and opens the card; Enter or Space on a focused card does too.
// Released over another card that accepts the dragged task (canLink, from ../link.ts), the task is
// linked under it instead: such a card is highlighted while the pointer is over it, and the column
// is not. In the card's own column only an accepting card's middle half links: elsewhere there a line
// shows where the card goes, and the drop reorders it (../order.ts). Anywhere else the drop is the column move.
// Mod+click (Cmd on macOS, Ctrl elsewhere) marks a card and Shift+click a range (../marks.ts)
// instead of opening it; a press elsewhere on the board clears the marks. Dragging a Marked card
// carries every Marked card: they all look dragged, the ghost shows how many, and the drop moves
// them to a column (no link, no reorder).
// The press/drag transitions live in ../drag.ts (pure, tested); this file only does the DOM side.
import type { Column } from '../columns.ts';
import { insertionBefore, linksAt, step, type DragEffect, type DragInput, type Press } from '../drag.ts';
import type { MarkHow } from '../marks.ts';

const COLUMNS: readonly string[] = ['backlog', 'ready', 'in_progress', 'review', 'done'];

export type DragCallbacks = {
  /** False while the card's last move is in flight: the press is ignored. */
  canDrag: (taskId: string) => boolean;
  /** What a drag of taskId carries: the Marked cards when it is one of them, else just it (../marks.ts dragGroup). */
  group: (taskId: string) => readonly string[];
  /** group: several Marked cards were dropped (taskId among them). */
  onDrop: (taskId: string, from: Column, to: Column, group?: readonly string[]) => void;
  /** A Mod- or Shift-click on a card. */
  onMark: (taskId: string, how: MarkHow) => void;
  /** A plain press on the board outside every card. */
  onClearMarks: () => void;
  /** Whether the card parentId accepts taskId as its sub-task (link.ts canLinkUnder). */
  canLink: (taskId: string, parentId: string) => boolean;
  /** Released over an accepting card. */
  onLink: (taskId: string, parentId: string) => void;
  /** Released in its own column: put it before `before` (null: last). */
  onReorder: (taskId: string, column: Column, before: string | null) => void;
  onOpen: (taskId: string) => void;
};

/** DOM side of the current press: the card, its ghost while dragging, the highlighted column, accepting card or insertion point. */
type Dom = { card: HTMLElement; ghost: HTMLElement | null; dx: number; dy: number; width: number; over: HTMLElement | null };

type Mark = 'is-drop-target' | 'is-link-target' | 'is-insert-before' | 'is-insert-end';
const OVER: Mark[] = ['is-drop-target', 'is-link-target', 'is-insert-before', 'is-insert-end'];

/** The column's cards as drawn, with their on-screen extent. */
const cardsOf = (column: HTMLElement): { id: string; top: number; bottom: number; node: HTMLElement }[] =>
  [...column.querySelectorAll<HTMLElement>('.kb-card')].flatMap((node) => {
    const id = node.dataset.taskId;
    if (id === undefined) return [];
    const r = node.getBoundingClientRect();
    return [{ id, top: r.top, bottom: r.bottom, node }];
  });

const columnOf = (node: Element | null): HTMLElement | null => {
  const col = node?.closest<HTMLElement>('.kb-column') ?? null;
  return col !== null && COLUMNS.includes(col.dataset.column ?? '') ? col : null;
};

/** Interactive children (badges are not) keep their own clicks. */
const interactive = (target: Element, card: Element): boolean => {
  const hit = target.closest('button, a, input, select, textarea, [role="button"]');
  return hit !== null && hit !== card && card.contains(hit);
};

export const attachDrag = (container: HTMLElement, callbacks: DragCallbacks): (() => void) => {
  let press: Press | null = null;
  let dom: Dom | null = null;

  /** The card under the pointer that accepts the dragged task (in its own column: under its middle half), or null. */
  const linkTarget = (node: Element | null, p: Press, y: number): HTMLElement | null => {
    const card = node?.closest<HTMLElement>('.kb-card') ?? null;
    const id = card?.dataset.taskId;
    if (card === null || id === undefined || id === p.taskId || !container.contains(card)) return null;
    const rect = card.getBoundingClientRect();
    if (!linksAt(y, rect, columnOf(card)?.dataset.column === p.from)) return null;
    return callbacks.canLink(p.taskId, id) ? card : null;
  };

  /**
   * In the dragged card's own column: the card it would go before (null: last), and the node that
   * shows the line, or null where the drop changes nothing (right where the card already is).
   */
  const insertion = (column: HTMLElement, p: Press, y: number): { before: string | null; mark: { node: HTMLElement; kind: Mark } | null } => {
    const cards = cardsOf(column);
    const before = insertionBefore(y, cards, p.taskId);
    const at = cards.findIndex((c) => c.id === p.taskId);
    const next = cards.slice(at + 1).find((c) => c.id !== p.taskId)?.id ?? null;
    if (at !== -1 && next === before) return { before, mark: null };
    const target = cards.find((c) => c.id === before)?.node;
    const list = column.querySelector<HTMLElement>('.kb-cards');
    const mark = target !== undefined ? { node: target, kind: 'is-insert-before' as const } : list !== null ? { node: list, kind: 'is-insert-end' as const } : null;
    return { before, mark };
  };

  const setOver = (node: HTMLElement | null, kind: Mark): void => {
    if (dom === null || (dom.over === node && node?.classList.contains(kind) === true)) return;
    dom.over?.classList.remove(...OVER);
    dom.over = node;
    node?.classList.add(kind);
  };

  /** Remove every trace of a drag: ghost, highlight, dimmed card, capture. */
  const cleanup = (pointerId: number | null, taskId: string | null): void => {
    const d = dom;
    dom = null;
    if (d !== null) {
      d.over?.classList.remove(...OVER);
      d.ghost?.remove();
      d.card.classList.remove('is-dragging');
    }
    // A redraw may have replaced the cards (and a group dims several); clear the current ones too.
    if (taskId !== null) for (const el of container.querySelectorAll('.kb-card.is-dragging')) el.classList.remove('is-dragging');
    document.documentElement.classList.remove('kb-dragging');
    if (pointerId !== null && container.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId);
  };

  const startGhost = (p: Press, x: number, y: number): void => {
    if (dom === null) return;
    const ghost = dom.card.cloneNode(true) as HTMLElement;
    ghost.classList.add('kb-ghost');
    ghost.removeAttribute('tabindex');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = `${dom.width}px`;
    if (p.group !== undefined) {
      ghost.classList.add('kb-ghost-group');
      const count = document.createElement('span');
      count.className = 'kb-ghost-count';
      count.textContent = String(p.group.length);
      ghost.append(count);
      for (const id of p.group) container.querySelector(`.kb-card[data-task-id="${CSS.escape(id)}"]`)?.classList.add('is-dragging');
    }
    document.body.append(ghost);
    dom.ghost = ghost;
    dom.card.classList.add('is-dragging');
    document.documentElement.classList.add('kb-dragging');
    container.setPointerCapture(p.pointerId);
    follow(x, y);
  };

  const follow = (x: number, y: number): void => {
    if (dom?.ghost == null) return;
    dom.ghost.style.transform = `translate(${x - dom.dx}px, ${y - dom.dy}px)`;
    const hit = document.elementFromPoint(x, y);
    const card = press === null ? null : linkTarget(hit, press, y);
    const column = columnOf(hit);
    if (card !== null) setOver(card, 'is-link-target');
    else if (press !== null && column !== null && column.dataset.column === press.from) {
      const { mark } = insertion(column, press, y);
      setOver(mark?.node ?? null, mark?.kind ?? 'is-insert-before');
    } else setOver(column, 'is-drop-target');
  };

  /** Feed one event to the machine and perform its effect. */
  const feed = (input: DragInput, at?: { x: number; y: number }): DragEffect => {
    const before = press;
    const { press: next, effect } = step(press, input);
    // Set before any DOM work: releasing capture fires lostpointercapture, which must find no press.
    press = next;
    // The old press ended, or a new press replaced it: clear its DOM traces first.
    if (before !== null && (next === null || input.type === 'down')) cleanup(before.pointerId, before.taskId);
    if (effect.kind === 'start' && next !== null && at !== undefined) startGhost(next, at.x, at.y);
    else if (effect.kind === 'follow' && at !== undefined) follow(at.x, at.y);
    else if (effect.kind === 'open') callbacks.onOpen(effect.taskId);
    else if (effect.kind === 'mark') callbacks.onMark(effect.taskId, effect.how);
    else if (effect.kind === 'drop') callbacks.onDrop(effect.taskId, effect.from, effect.to, effect.group);
    else if (effect.kind === 'link') callbacks.onLink(effect.taskId, effect.parentId);
    else if (effect.kind === 'reorder') callbacks.onReorder(effect.taskId, effect.column, effect.before);
    return effect;
  };

  const onDown = (e: PointerEvent): void => {
    const target = e.target instanceof Element ? e.target : null;
    const card = target?.closest<HTMLElement>('.kb-card') ?? null;
    const col = columnOf(card);
    const ok = card !== null && target !== null && col !== null && card.dataset.taskId !== undefined && !interactive(target, card);
    const mark: MarkHow | null = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : null;
    // A plain press on the board's background (not a control, not a card) clears the marks.
    if (card === null && mark === null && e.button === 0 && target !== null && target.closest('button, a, input, select, textarea, [role="button"]') === null) {
      callbacks.onClearMarks();
    }
    // Shift+click would otherwise select the text between the two clicks.
    if (ok && mark !== null) e.preventDefault();
    const before = press;
    const taskId = ok ? (card.dataset.taskId as string) : null;
    feed({
      type: 'down',
      pointerId: e.pointerId,
      button: e.button,
      taskId,
      from: (col?.dataset.column ?? 'backlog') as Column,
      x: e.clientX,
      y: e.clientY,
      ...(mark !== null ? { mark } : {}),
      ...(taskId !== null ? { group: callbacks.group(taskId) } : {}),
    });
    if (press !== null && press !== before && ok) {
      const rect = card.getBoundingClientRect();
      dom = { card, ghost: null, dx: e.clientX - rect.left, dy: e.clientY - rect.top, width: rect.width, over: null };
    }
  };

  const onMove = (e: PointerEvent): void => {
    const effect = feed(
      {
        type: 'move',
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        buttons: e.buttons,
        canDrag: press === null || callbacks.canDrag(press.taskId),
      },
      { x: e.clientX, y: e.clientY },
    );
    if (effect.kind === 'start' || effect.kind === 'follow') e.preventDefault();
  };

  const onUp = (e: PointerEvent): void => {
    const hit = press?.dragging === true ? document.elementFromPoint(e.clientX, e.clientY) : null;
    const to = columnOf(hit);
    const onto = press !== null && hit !== null ? (linkTarget(hit, press, e.clientY)?.dataset.taskId ?? null) : null;
    // Only a real change reorders: a drop right where the card is stays a no-op.
    const slot = press !== null && to !== null && to.dataset.column === press.from ? insertion(to, press, e.clientY) : null;
    const before = slot?.mark != null ? slot.before : undefined;
    feed({ type: 'up', pointerId: e.pointerId, to: (to?.dataset.column as Column | undefined) ?? null, onto, ...(before !== undefined ? { before } : {}) });
  };

  const onPointerAbort = (e: PointerEvent): void => void feed({ type: 'abort', pointerId: e.pointerId });
  const onContextMenu = (): void => void feed({ type: 'abort' });
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && press !== null) feed({ type: 'abort' });
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!(e.target instanceof HTMLElement) || !e.target.classList.contains('kb-card')) return;
    const id = e.target.dataset.taskId;
    if (id === undefined) return;
    e.preventDefault();
    callbacks.onOpen(id);
  };

  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onPointerAbort);
  container.addEventListener('lostpointercapture', onPointerAbort);
  container.addEventListener('contextmenu', onContextMenu);
  container.addEventListener('keydown', onKey);
  document.addEventListener('keydown', onEscape);
  return () => {
    feed({ type: 'abort' });
    container.removeEventListener('pointerdown', onDown);
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('pointerup', onUp);
    container.removeEventListener('pointercancel', onPointerAbort);
    container.removeEventListener('lostpointercapture', onPointerAbort);
    container.removeEventListener('contextmenu', onContextMenu);
    container.removeEventListener('keydown', onKey);
    document.removeEventListener('keydown', onEscape);
  };
};
