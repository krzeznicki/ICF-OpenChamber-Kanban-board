// A checkbox per offered choice, with a Filter field over FILTER_OVER of them: the Add task modal's
// "Blocked by" and "Existing sub-tasks", and the task modal's "Add sub-task" → "Existing tasks".
// Checked ones stay visible whatever the filter says; picks keep their order.
import { filterSelectOptions, mountCheckbox, mountSearchField } from '@openchamber/sdk/ui';
import { FILTER_OVER } from './modal.ts';

export type CheckChoice = { id: string; label: string; hint?: string };

export type CheckListOptions = {
  offered: readonly CheckChoice[];
  /** The filter field's accessible label. */
  filterLabel: string;
  /** The filter as last typed (kept by the caller across redraws). */
  filter: string;
  onFilter: (value: string) => void;
  selected: () => readonly string[];
  onSelected: (ids: string[]) => void;
  disabled?: boolean;
};

/** Mounts the list (and its filter) at the end of `box`; returns the disposers. */
export const mountCheckList = (box: HTMLElement, o: CheckListOptions): Array<() => void> => {
  const out: Array<() => void> = [];
  let filter = o.filter;
  const list = document.createElement('div');
  list.className = 'kb-add-checks';
  const drawList = (): void => {
    const shown = new Set(filterSelectOptions(o.offered, filter).map((c) => c.id));
    for (const node of list.children) {
      const id = (node as HTMLElement).dataset.id ?? '';
      (node as HTMLElement).hidden = !shown.has(id) && !o.selected().includes(id);
    }
  };
  if (o.offered.length > FILTER_OVER) {
    const filterSlot = document.createElement('div');
    filterSlot.className = 'kb-add-filter';
    box.append(filterSlot);
    const search = mountSearchField(filterSlot, {
      value: filter,
      label: o.filterLabel,
      placeholder: 'Filter',
      onChange: (v) => {
        filter = v;
        o.onFilter(v);
        search.update({ value: v });
        drawList();
      },
    });
    out.push(search.dispose);
  }
  for (const c of o.offered) {
    const cell = document.createElement('div');
    cell.className = 'kb-add-check';
    cell.dataset.id = c.id;
    list.append(cell);
    const check = mountCheckbox(cell, {
      label: c.label,
      description: c.hint ?? c.id,
      checked: o.selected().includes(c.id),
      disabled: o.disabled ?? false,
      onChange: (checked) => {
        const rest = o.selected().filter((b) => b !== c.id);
        o.onSelected(checked ? [...rest, c.id] : rest);
        check.update({ checked });
      },
    });
    out.push(check.dispose);
  }
  box.append(list);
  drawList();
  return out;
};
