// DEBUG harness, not part of the build or of `npm test`: see run.sh.
// Draws the real board styles and the real drag code (ui/dnd.ts) with plain cards, drives a drag with
// pointer events, and writes PASS or FAIL into #result. The node tests have no layout, and this bug is layout.
import { attachDrag } from '../../../src/panel/ui/dnd.ts';
import { injectStyles } from '../../../src/panel/ui/styles.ts';

injectStyles();
const el = (className: string, parent: HTMLElement): HTMLElement => {
  const node = document.createElement('div');
  node.className = className;
  parent.append(node);
  return node;
};
const shell = el('kb', document.body);
el('kb-toolbar', shell).textContent = 'toolbar';
const columns = el('kb-columns', shell);
// Synthetic pointers cannot be captured.
columns.setPointerCapture = () => {};
columns.hasPointerCapture = () => false;

const log: string[] = [];
/** The Marked cards the harness pretends to have (a drag of one of them carries them all). */
let markedIds: string[] = [];
attachDrag(columns, {
  canDrag: () => true,
  group: (task) => (markedIds.includes(task) ? markedIds : [task]),
  onMark: (task, how) => log.push(`mark ${task} ${how}`),
  onClearMarks: () => log.push('clear'),
  canLink: () => false,
  onLink: () => {},
  onOpen: () => {},
  onReorder: (task) => log.push(`reorder ${task}`),
  onDrop: (task, from, to, group) => log.push(`drop ${group?.join(',') ?? task} ${from}->${to}`),
});

const draw = (backlog: number): void => {
  columns.replaceChildren();
  for (const [id, count] of [['backlog', backlog], ['ready', 1], ['in_progress', 0], ['review', 0], ['done', 0]] as const) {
    const column = el('kb-column', columns);
    column.dataset.column = id;
    el('kb-column-head', column).textContent = id;
    const list = el('kb-cards', column);
    for (let i = 0; i < count; i++) {
      const card = el('kb-card', list);
      card.dataset.taskId = `${id}${i}`;
      card.textContent = `${id}${i}`;
      card.style.height = '60px';
    }
  }
};

/** Drag `taskId` sideways into Ready and release at height `dropY(card top)`; what was highlighted and reported. */
const drag = (name: string, taskId: string, dropY: (cardTop: number) => number, carried = taskId): string => {
  log.length = 0;
  const card = columns.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
  const ready = columns.querySelector<HTMLElement>('[data-column="ready"]');
  if (card === null || ready === null) return `FAIL ${name}: not drawn`;
  card.scrollIntoView({ block: 'center' });
  const from = card.getBoundingClientRect();
  const to = ready.getBoundingClientRect();
  const x = to.left + to.width / 2;
  const y = dropY(from.top);
  const fire = (target: HTMLElement, type: string, clientX: number, clientY: number, buttons: number): void =>
    void target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, buttons, clientX, clientY }));
  fire(card, 'pointerdown', from.left + 10, from.top + 10, 1);
  fire(columns, 'pointermove', from.left + 30, from.top + 10, 1);
  fire(columns, 'pointermove', x, y, 1);
  const marked = document.querySelector('.is-drop-target')?.getAttribute('data-column') ?? 'none';
  const count = document.querySelector('.kb-ghost-count')?.textContent ?? null;
  fire(columns, 'pointerup', x, y, 0);
  const ok = marked === 'ready' && log.length === 1 && log[0] === `drop ${carried} backlog->ready` && (carried === taskId) === (count === null);
  return `${ok ? 'PASS' : 'FAIL'} ${name}: highlighted=${marked} reported=${JSON.stringify(log)} count=${count}`;
};

/** A click on `taskId` with the modifiers of `init`: what attachDrag reported. */
const click = (name: string, taskId: string, init: PointerEventInit, want: string[]): string => {
  log.length = 0;
  const card = columns.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
  if (card === null) return `FAIL ${name}: not drawn`;
  const r = card.getBoundingClientRect();
  const at = { bubbles: true, pointerId: 1, button: 0, clientX: r.left + 10, clientY: r.top + 10, ...init };
  card.dispatchEvent(new PointerEvent('pointerdown', { ...at, buttons: 1 }));
  columns.dispatchEvent(new PointerEvent('pointerup', { ...at, buttons: 0 }));
  const ok = JSON.stringify(log) === JSON.stringify(want);
  return `${ok ? 'PASS' : 'FAIL'} ${name}: reported=${JSON.stringify(log)}`;
};

const lines: string[] = [];
// The reported bug: the last card of a long column, dragged straight sideways, far below where Ready's own card ends.
draw(30);
lines.push(drag('end of a long column', 'backlog29', (top) => top + 10));
// Every column short: released under the cards, in the empty part of the board.
draw(1);
lines.push(drag('under short columns', 'backlog0', () => window.innerHeight - 40));
// Control: released right beside the card, where the columns always were.
lines.push(drag('beside the card (control)', 'backlog0', (top) => top + 10));

// Marked cards: Cmd/Ctrl+click toggles, Shift+click ranges, a plain click opens; a marked card's drag carries the group.
draw(3);
lines.push(click('Cmd+click marks', 'backlog1', { metaKey: true }, ['mark backlog1 toggle']));
lines.push(click('Ctrl+click marks', 'backlog1', { ctrlKey: true }, ['mark backlog1 toggle']));
lines.push(click('Shift+click marks a range', 'backlog2', { shiftKey: true }, ['mark backlog2 range']));
markedIds = ['backlog0', 'backlog2'];
lines.push(drag('a marked card drags the group', 'backlog2', (top) => top + 10, 'backlog0,backlog2'));
lines.push(drag('an unmarked card drags alone', 'backlog1', (top) => top + 10));
markedIds = [];
{
  log.length = 0;
  const empty = columns.querySelector<HTMLElement>('[data-column="review"] .kb-cards');
  empty?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, buttons: 1 }));
  columns.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, buttons: 0 }));
  lines.push(`${JSON.stringify(log) === '["clear"]' ? 'PASS' : 'FAIL'} a press on the background clears the marks: reported=${JSON.stringify(log)}`);
}

const out = document.createElement('pre');
out.id = 'result';
out.textContent = lines.join('\n');
document.body.append(out);
