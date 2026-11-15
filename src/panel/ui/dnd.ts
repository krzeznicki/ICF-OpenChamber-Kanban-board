// Pointer-based drag and drop for cards (HTML5 drag events are unreliable in the sandboxed frame).
// Listeners sit on the persistent columns container, so redraws during a drag do not break it:
// the pointer is captured by the container and a clone follows the pointer. A press that moves
// less than THRESHOLD pixels is a click and opens the card; Enter or Space on a focused card does too.
import type { Column } from '../columns.ts';

const THRESHOLD = 6;
const COLUMNS: readonly string[] = ['backlog', 'ready', 'in_progress', 'review', 'done'];

export type DragCallbacks = {
  /** False while the card's last move is in flight: the press is ignored. */
  canDrag: (taskId: string) => boolean;
  onDrop: (taskId: string, from: Column, to: Column) => void;
  onOpen: (taskId: string) => void;
};

type Press = {
  pointerId: number;
  taskId: string;
  from: Column;
  card: HTMLElement;
  x: number;
  y: number;
  ghost: HTMLElement | null;
  dx: number;
  dy: number;
  width: number;
  over: HTMLElement | null;
};

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

  const setOver = (col: HTMLElement | null): void => {
    if (press === null || press.over === col) return;
    press.over?.classList.remove('is-drop-target');
    press.over = col;
    col?.classList.add('is-drop-target');
  };

  const finish = (): void => {
    if (press === null) return;
    press.over?.classList.remove('is-drop-target');
    press.ghost?.remove();
    press.card.classList.remove('is-dragging');
    // A redraw may have replaced the card; mark the current one too.
    container.querySelector(`.kb-card[data-task-id="${CSS.escape(press.taskId)}"]`)?.classList.remove('is-dragging');
    document.documentElement.classList.remove('kb-dragging');
    if (container.hasPointerCapture(press.pointerId)) container.releasePointerCapture(press.pointerId);
    press = null;
  };

  const onDown = (e: PointerEvent): void => {
    // A press released outside the container never saw its pointerup; a new press replaces it.
    if (press !== null && press.ghost === null) press = null;
    if (press !== null || e.button !== 0 || !(e.target instanceof Element)) return;
    const card = e.target.closest<HTMLElement>('.kb-card');
    const taskId = card?.dataset.taskId;
    const col = columnOf(card ?? null);
    if (card == null || taskId === undefined || col === null || interactive(e.target, card)) return;
    const rect = card.getBoundingClientRect();
    press = {
      pointerId: e.pointerId,
      taskId,
      from: col.dataset.column as Column,
      card,
      x: e.clientX,
      y: e.clientY,
      ghost: null,
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      width: rect.width,
      over: null,
    };
  };

  const onMove = (e: PointerEvent): void => {
    if (press === null || e.pointerId !== press.pointerId) return;
    if (press.ghost === null) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < THRESHOLD) return;
      if (!callbacks.canDrag(press.taskId)) {
        press = null;
        return;
      }
      const ghost = press.card.cloneNode(true) as HTMLElement;
      ghost.classList.add('kb-ghost');
      ghost.removeAttribute('tabindex');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = `${press.width}px`;
      document.body.append(ghost);
      press.ghost = ghost;
      press.card.classList.add('is-dragging');
      document.documentElement.classList.add('kb-dragging');
      container.setPointerCapture(press.pointerId);
    }
    e.preventDefault();
    press.ghost.style.transform = `translate(${e.clientX - press.dx}px, ${e.clientY - press.dy}px)`;
    setOver(columnOf(document.elementFromPoint(e.clientX, e.clientY)));
  };

  const onUp = (e: PointerEvent): void => {
    if (press === null || e.pointerId !== press.pointerId) return;
    const { taskId, from, ghost } = press;
    const target = ghost === null ? null : columnOf(document.elementFromPoint(e.clientX, e.clientY));
    finish();
    if (ghost === null) callbacks.onOpen(taskId);
    else if (target !== null) callbacks.onDrop(taskId, from, target.dataset.column as Column);
  };

  const onEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && press !== null) finish();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!(e.target instanceof HTMLElement) || !e.target.classList.contains('kb-card')) return;
    const id = e.target.dataset.taskId;
    if (id === undefined) return;
    e.preventDefault();
    callbacks.onOpen(id);
  };

  const onCancel = (e: PointerEvent): void => {
    if (press !== null && e.pointerId === press.pointerId) finish();
  };

  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onCancel);
  container.addEventListener('keydown', onKey);
  document.addEventListener('keydown', onEscape);
  return () => {
    finish();
    container.removeEventListener('pointerdown', onDown);
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('pointerup', onUp);
    container.removeEventListener('pointercancel', onCancel);
    container.removeEventListener('keydown', onKey);
    document.removeEventListener('keydown', onEscape);
  };
};
