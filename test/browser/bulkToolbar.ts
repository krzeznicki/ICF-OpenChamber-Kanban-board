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
let projectsPicked = 0;
const board = createBoard(root, {
  onProject() { projectsPicked++; }, onSource() {}, onHideSubtasks() {}, onSearch() {}, suggest: () => [], onSearchExit() {},
  onSearchDown: () => false, onRefresh() {}, onAdd() {}, onSettings() { settingsOpened++; },
  onArchiveDone() {}, onShowArchived() {}, onClearArchive() {},
});
board.setProjects([{ id: 'one', label: 'Project one' }, { id: 'two', label: 'Project two' }], 'one');
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
let copied = '';
const archived = new Set<string>();
const ui = mountBulkToolbar(board.bulkSlot, {
  actions: {
    tasks: () => tasks,
    preview: action => controller.actionPreview(action),
    submit: (action, ids) => controller.executeAction(action, ids),
  },
  onDraft: change => controller.setDraft(change),
  onApply: () => void controller.apply().then(() => finish?.()),
  onClear: () => controller.clear(), onSelectAll: () => selection.selectAll(),
});
const get = async (id: string): Promise<Task> => {
  if (release === null && saving) await new Promise<void>(resolve => { release = resolve; });
  return { ...tasks.find(t => t.id === id)! };
};
const controller = createBulkToolbar({
  actions: () => ({
    tasks: () => tasks,
    context: () => ({ sources: [{ id: 'local', label: 'Local', capabilities: { create: true, subtasks: true, blockedBy: true, claim: true, delete: true } }], archived, busy: new Set(), complete: true }),
    api: {
      get,
      changeLabel: async () => { throw new Error('Unsupported'); },
      addBlocker: async id => get(id), setParent: async id => get(id), removeParent: async id => get(id),
      remove: async id => [id],
    },
    move: async id => ({ kind: 'success', id }), start: async id => ({ kind: 'success', id }),
    archive: async () => {}, remap: async () => {}, deleted: async () => {},
    copy: async text => { copied = text; },
  }),
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
  const found = [...board.bulkSlot.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label);
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
  window.scrollTo(0, 700);
  const scrollBeforeMark = window.scrollY;
  check(scrollBeforeMark > 0, 'Regression fixture must scroll before selecting a lower card');
  selection.mark('task-15', 'toggle');
  check(window.scrollY === scrollBeforeMark, 'First mark must not replace page scrolling or jump to the top');
  selection.clearMarks();
  check(window.scrollY === scrollBeforeMark, 'Clearing marks must keep the scroll position');
  window.scrollTo(0, 0);
  selection.mark('task-0', 'toggle');
  check(!board.bulkSlot.hidden, 'A mark should show the toolbar');
  check(!board.bulkSlot.querySelector('button[aria-label="Add to queue"]'), 'Start Task is the single agent-start action');
  for (const label of ['Move to column', 'Labels', 'Set parent', 'Unlink parent', 'Add blocker', 'Start Task', 'Archive', 'Restore', 'Copy', 'Delete']) {
    check(!!button(label).querySelector('svg'), `${label} must have a compact icon`);
    check(button(label).getAttribute('aria-label') === label, `${label} must be accessible`);
  }
  check(button('Apply').disabled, 'No change should disable Apply');
  check(button('Archive').disabled && button('Restore').disabled, 'Open unarchived tasks cannot be archived or restored');
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
  root.querySelector<HTMLButtonElement>('.kb-project button')!.click();
  check(root.querySelector('.kb-project [role="option"]') === null && projectsPicked === 0, 'Project switch must stay locked');
  board.columns.querySelector('.kb-card')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  check(opened === 0, 'Enter must not open a task during a save');
  selection.clearMarks();
  check(selection.marked().length === 1, 'Escape/clear must not change a running group');
  selection.rendered([['task-1']]);
  check(selection.marked()[0] === 'task-0', 'A poll/filter redraw must preserve the running target');
  selection.rendered([tasks.map(t => t.id)]);
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
  check(footer.left >= 0 && footer.right <= window.innerWidth, 'Floating panel must fit horizontally');
  check(footer.width <= 640, 'Panel must not stretch across the full page');
  window.scrollTo(0, document.documentElement.scrollHeight);
  check(board.columns.getBoundingClientRect().bottom <= footer.top, 'Last card must scroll above the floating panel');
  check(board.bulkSlot.getBoundingClientRect().top === footer.top, 'Scrolling cards must keep the footer in place');
  check(button('Labels').disabled, 'Local-only groups must disable labels immediately');
  check(button('Labels').parentElement!.title.includes('does not support labels'), 'Disabled labels explain the source limitation');
  button('Set parent').click();
  const focused = document.activeElement;
  ui.update(controller.model(), ['enhancement', 'bug', 'chore']);
  check(document.activeElement === focused, 'Poll must not steal action-form focus');
  const popup = board.bulkSlot.querySelector<HTMLElement>('.kb-bulk-popover')!.getBoundingClientRect();
  check(popup.top >= 0 && popup.right <= window.innerWidth, 'Action form must fit viewport');
  board.bulkSlot.querySelector<HTMLButtonElement>('.kb-bulk-popover [aria-haspopup="listbox"]')!.click();
  const optionsPopup = board.bulkSlot.querySelector<HTMLElement>('.kb-bulk-popover .oc-sdk-popup')!.getBoundingClientRect();
  check(optionsPopup.top >= 0 && optionsPopup.bottom <= window.innerHeight, 'SDK task picker must stay in viewport inside the floating panel');
  board.bulkSlot.querySelector<HTMLElement>('.kb-bulk-popover [role="listbox"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  button('Close action').click();
  button('Copy').click();
  board.bulkSlot.querySelector<HTMLButtonElement>('.kb-bulk-popover [aria-haspopup="listbox"]')!.click();
  [...board.bulkSlot.querySelectorAll<HTMLElement>('[role="option"]')].find(o => o.textContent?.trim() === 'Links / local paths')!.click();
  const submitCopy = [...board.bulkSlot.querySelectorAll<HTMLButtonElement>('.kb-bulk-popover button')].find(b => b.textContent === 'Copy')!;
  submitCopy.click();
  // The service/clipboard fixture resolves in microtasks; wait on the actual controller lock.
  for (let i = 0; i < 100 && controller.model().locked; i++) await Promise.resolve();
  check(copied.startsWith('task-0\ntask-1'), 'Copy must reach the clipboard adapter');
  check(selection.marked().length === 30, 'Copy must keep marks');
  button('Copy').click();
  check(board.bulkSlot.querySelector('.kb-bulk-popover [aria-haspopup="listbox"]')!.textContent!.includes('Links / local paths'), 'Reopening an action must keep its last parameters');
  button('Close action').click();
  tasks[0]!.state = 'done';
  ui.update(controller.model(), ['enhancement', 'bug', 'chore']);
  check(!button('Archive').disabled && button('Restore').disabled, 'A completed unarchived task enables only Archive');
  archived.add('task-0');
  ui.update(controller.model(), ['enhancement', 'bug', 'chore']);
  check(button('Archive').disabled && !button('Restore').disabled, 'An archived task enables only Restore');
  tasks[1]!.state = 'done';
  ui.update(controller.model(), ['enhancement', 'bug', 'chore']);
  check(!button('Archive').disabled && !button('Restore').disabled, 'Mixed groups allow both actions for their eligible subsets');
  report.textContent = 'PASS: bulk toolbar integration checks';
  report.dataset.result = 'pass';
} catch (e) {
  report.textContent = `FAIL: ${String(e)}`;
  report.dataset.result = 'fail';
  throw e;
}
