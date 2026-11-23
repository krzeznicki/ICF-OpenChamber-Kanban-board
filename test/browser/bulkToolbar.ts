// Browser integration check: bundle with esbuild (SDK controls require a real DOM).
// npx esbuild test/browser/bulkToolbar.ts --bundle --format=esm --outfile=<served-dir>/check.js
// Serve an HTML page with <div id="root"></div><script type="module" src="check.js"></script>.
import { createBoard } from '../../src/panel/ui/board.ts';
import { createSelection } from '../../src/panel/ui/selection.ts';
import { injectStyles } from '../../src/panel/ui/styles.ts';
import { mountBulkToolbar } from '../../src/panel/ui/bulkToolbar.ts';
import { createBulkToolbar } from '../../src/panel/bulkToolbar.ts';
import type { Task, TaskState } from '../../src/core/types.ts';
import { attachDrag } from '../../src/panel/ui/dnd.ts';

injectStyles();
document.documentElement.style.cssText = '--oc-bg:#fafafa;--oc-fg:#222;--oc-muted:#666;--oc-muted-surface:#f1f1f1;--oc-elevated:#fff;--oc-elevated-fg:#222;--oc-border:#ddd;--oc-radius:6px;--oc-primary:#6258cc;--oc-focus:#6258cc;--oc-font:system-ui';
const check = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
const root = document.getElementById('root')!;
let settingsOpened = 0;
const board = createBoard(root, {
  onProject() {}, onSource() {}, onHideSubtasks() {}, onSearch() {}, suggest: () => [], onSearchExit() {},
  onSearchDown: () => false, onRefresh() {}, onAdd() {}, onSettings() { settingsOpened++; },
  onArchiveDone() {}, onShowArchived() {}, onClearArchive() {},
});
const tasks: Task[] = Array.from({ length: 30 }, (_, i) => ({
  id: `task-${i}`, title: `Task ${i + 1}`, type: 'enhancement', state: 'needs-triage', source: 'local',
  parentId: null, kind: 'ticket', body: '', blockedBy: [], claimed: false, url: null, updatedAt: 0,
}));
for (const t of tasks) {
  const card = document.createElement('div');
  card.className = 'kb-card';
  card.dataset.taskId = t.id;
  card.textContent = t.title;
  card.tabIndex = 0;
  board.columns.append(card);
}
board.columns.style.flexDirection = 'column';
const selection = createSelection(board.columns, { canFocus: () => true, onMarksChanged: ids => controller.selectionChanged(ids) });
selection.rendered([tasks.map(t => t.id)]);
let release: (() => void) | null = null;
let saving = false;
let finish: (() => void) | null = null;
const ui = mountBulkToolbar(board.bulkSlot, {
  onDraft: change => controller.setDraft(change),
  onApply: () => void controller.apply().then(() => finish?.()),
  onClear: () => controller.clear(), onSelectAll: () => selection.selectAll(),
});
const get = async (id: string): Promise<Task> => {
  if (release === null && saving) await new Promise<void>(resolve => { release = resolve; });
  return { ...tasks.find(t => t.id === id)! };
};
const controller = createBulkToolbar({
  api: () => ({
    get, setType: async (id, type) => { const t = tasks.find(t => t.id === id)!; t.type = type; return t; },
    setState: async (id, state: TaskState) => { const t = tasks.find(t => t.id === id)!; t.state = state; return t; },
  }),
  tasks: () => tasks, visible: () => selection.layout().flat(), busy: () => new Set(), complete: () => true,
  replace: selection.setMarked, retain: selection.retain,
  lock: value => { saving = value; selection.setLocked(value); board.setInteractionLocked(value); },
  reload: async () => {},
  changed: () => ui.update(controller.model(), ['enhancement', 'bug', 'chore']),
});
let opened = 0;
attachDrag(board.columns, {
  locked: () => controller.model().locked,
  canDrag: () => !controller.model().locked, group: id => selection.group(id, new Set()),
  onDrop() {}, onMark: selection.mark, onClearMarks: selection.clearMarks,
  canLink: () => false, onLink() {}, onReorder() {}, onOpen: () => { opened++; },
});
ui.update(controller.model(), ['enhancement', 'bug', 'chore']);
const button = (label: string): HTMLButtonElement => {
  const found = [...board.bulkSlot.querySelectorAll('button')].find(b => b.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
};
const select = (field: string, value: string): void => {
  board.bulkSlot.querySelector<HTMLButtonElement>(`[data-bulk-field="${field}"] button`)!.click();
  const option = [...board.bulkSlot.querySelectorAll<HTMLElement>('[role="option"]')].find(o => o.textContent?.trim() === value);
  check(!!option, `Missing option ${value}`);
  option!.click();
};

const report = document.createElement('p');
report.id = 'test-result';
report.style.cssText = 'position:fixed;top:0;right:0;margin:0;font-size:10px;pointer-events:none;z-index:100';
root.before(report);
try {
  check(Boolean(board.bulkSlot.hidden), 'No marks should hide the toolbar');
  selection.mark('task-0', 'toggle');
  check(!board.bulkSlot.hidden, 'A mark should show the toolbar');
  check(button('Apply').disabled, 'No change should disable Apply');
  select('type', 'bug');
  check(selection.marked().length === 1, 'Picking an SDK option must retain marks');
  check(!button('Apply').disabled, 'Picking a type should enable Apply');
  // A poll must preserve the active control.
  const active = document.activeElement;
  ui.update(controller.model(), ['enhancement', 'bug', 'chore']);
  check(document.activeElement === active, 'Updating must preserve focus');
  const finished = new Promise<void>(resolve => { finish = resolve; });
  button('Apply').click();
  check(controller.model().locked, 'Apply should lock the form synchronously');
  check(button('Clear').disabled, 'Clear must be disabled while saving');
  [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Settings')!.click();
  check(settingsOpened === 0, 'Board controls must not act during a save');
  board.columns.querySelector('.kb-card')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  check(opened === 0, 'Enter must not open a task during a save');
  selection.clearMarks();
  check(selection.marked().length === 1, 'Escape/clear must not change a running group');
  check(release !== null, 'Save must reach the service');
  (release as unknown as () => void)();
  await finished;
  check(tasks[0]!.type === 'bug', 'Apply must write the selected type');
  check(tasks[1]!.type === 'enhancement', 'Apply must leave unselected tasks alone');
  check(Boolean(board.bulkSlot.hidden), 'Success should clear selection and hide the toolbar');
  selection.mark('task-0', 'toggle');
  button('Select all').click();
  check(selection.marked().length === 30, 'Select all must include offscreen cards');
  select('state', 'done');
  check(board.bulkSlot.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true', 'Close sub-tasks defaults on');
  const footer = board.bulkSlot.getBoundingClientRect();
  check(footer.bottom <= window.innerHeight, 'Footer must fit the viewport');
  check(board.columns.getBoundingClientRect().bottom <= footer.top, 'Footer must not cover the cards');
  board.columns.scrollTop = board.columns.scrollHeight;
  check(board.bulkSlot.getBoundingClientRect().top === footer.top, 'Scrolling cards must keep the footer in place');
  report.textContent = 'PASS: bulk toolbar integration checks';
  report.dataset.result = 'pass';
} catch (e) {
  report.textContent = `FAIL: ${String(e)}`;
  report.dataset.result = 'fail';
  throw e;
}
