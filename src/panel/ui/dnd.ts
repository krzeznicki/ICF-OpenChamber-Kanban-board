// Pointer-based drag and drop for cards (HTML5 drag events are unreliable in the sandboxed frame).
// Listeners sit on the persistent columns container, so redraws during a drag do not break it:
// the pointer is captured by the container and a clone follows the pointer. A press that moves
// less than THRESHOLD pixels is a click and opens the card; Enter or Space on a focused card does too.
// The press/drag transitions live in ../drag.ts (pure, tested); this file only does the DOM side.
import type { Column } from '../columns.ts';
import { step, type DragEffect, type DragInput, type Press } from '../drag.ts';

const COLUMNS: readonly string[] = ['backlog', 'ready', 'in_progress', 'review', 'done'];

export type DragCallbacks = {
  /** False while the card's last move is in flight: the press is ignored. */
  canDrag: (taskId: string) => boolean;
  onDrop: (taskId: string, from: Column, to: Column) => void;
  onOpen: (taskId: string) => void;
};

/** DOM side of the current press: the card, its ghost while dragging, the highlighted column. */
type Dom = { card: HTMLElement; ghost: HTMLElement | null; dx: number; dy: number; width: number; over: HTMLElement | null };

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

  const setOver = (col: HTMLElement | null): void => {
    if (dom === null || dom.over === col) return;
    dom.over?.classList.remove('is-drop-target');
    dom.over = col;
    col?.classList.add('is-drop-target');
  };

  /** Remove every trace of a drag: ghost, highlight, dimmed card, capture. */
  const cleanup = (pointerId: number | null, taskId: string | null): void => {
    const d = dom;
    dom = null;
    if (d !== null) {
      d.over?.classList.remove('is-drop-target');
      d.ghost?.remove();
      d.card.classList.remove('is-dragging');
    }
    // A redraw may have replaced the card; clear the current one too.
    if (taskId !== null) container.querySelector(`.kb-card[data-task-id="${CSS.escape(taskId)}"]`)?.classList.remove('is-dragging');
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
    setOver(columnOf(document.elementFromPoint(x, y)));
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
    else if (effect.kind === 'drop') callbacks.onDrop(effect.taskId, effect.from, effect.to);
    return effect;
  };

  const onDown = (e: PointerEvent): void => {
    const target = e.target instanceof Element ? e.target : null;
    const card = target?.closest<HTMLElement>('.kb-card') ?? null;
    const col = columnOf(card);
    const ok = card !== null && target !== null && col !== null && card.dataset.taskId !== undefined && !interactive(target, card);
    const before = press;
    feed({
      type: 'down',
      pointerId: e.pointerId,
      button: e.button,
      taskId: ok ? (card.dataset.taskId as string) : null,
      from: (col?.dataset.column ?? 'backlog') as Column,
      x: e.clientX,
      y: e.clientY,
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
    const to = press?.dragging === true ? columnOf(document.elementFromPoint(e.clientX, e.clientY)) : null;
    feed({ type: 'up', pointerId: e.pointerId, to: (to?.dataset.column as Column | undefined) ?? null });
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
