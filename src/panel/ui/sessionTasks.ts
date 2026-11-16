// "Tasks in this session": the board was opened from the rail panel of a chat whose session works on
// several tasks (sessionFocus.ts). One row per task with its column (or state); a click opens it.
import { mountList } from '@openchamber/sdk/ui';
import type { Tone } from '@openchamber/sdk/ui';
import { mountCloseButton } from './closeButton.ts';
import { openModalShell } from './modal.ts';

export type SessionTaskRow = { id: string; title: string; status: string; tone: Tone };

/** Opens the list over the board; a row's click closes it and opens that task. Returns close. */
export const openSessionTasks = (rows: readonly SessionTaskRow[], onOpen: (taskId: string) => void): (() => void) => {
  const disposers: Array<() => void> = [];
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    for (const d of disposers) d();
    shell.dispose();
  };
  const shell = openModalShell({ label: 'Tasks in this session', onDismiss: close, className: 'kb-session-tasks' });
  const head = document.createElement('header');
  head.className = 'kb-modal-head';
  const top = document.createElement('div');
  top.className = 'kb-sheet-head';
  const titles = document.createElement('div');
  titles.className = 'kb-sheet-titles';
  const title = document.createElement('h2');
  title.className = 'kb-sheet-title';
  title.textContent = 'Tasks in this session';
  const note = document.createElement('p');
  note.className = 'kb-muted';
  note.textContent = `This session works on ${rows.length} tasks on the board. Open one:`;
  titles.append(title, note);
  const closeSlot = document.createElement('div');
  closeSlot.className = 'kb-sheet-x';
  top.append(titles, closeSlot);
  head.append(top);
  const list = document.createElement('div');
  list.className = 'kb-session-task-list';
  shell.modal.append(head, list);
  disposers.push(
    mountCloseButton(closeSlot, close),
    mountList(list, {
      items: rows.map((r) => ({ id: r.id, title: r.title, subtitle: r.id, badge: { label: r.status, tone: r.tone } })),
      onSelect: (id) => {
        close();
        onOpen(id);
      },
      ariaLabel: 'Tasks in this session',
    }).dispose,
  );
  shell.modal.focus();
  return close;
};
