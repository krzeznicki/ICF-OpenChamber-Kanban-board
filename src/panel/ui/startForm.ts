// The start form shown on a drop on In Progress when "Start automatically" is off: preset, location,
// model and agent, prefilled with what the card resolves to, and Start / Cancel. Drawn in the panel
// like ui/confirm.ts. Resolves to the chosen options, or null on Cancel, Escape or a backdrop click.
// What is picked here is used for this start only; the card's stored options are not changed.
import { mountButton, mountSelect, mountTextField } from '@openchamber/sdk/ui';
import type { Preset } from '../presets.ts';
import type { Location, StartOptions } from '../settings.ts';
import { LOCATION_LABELS } from './settingsView.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const askStart = (title: string, initial: StartOptions, presets: readonly Preset[]): Promise<StartOptions | null> =>
  new Promise((resolve) => {
    const options: StartOptions = { ...initial };
    const backdrop = el('div', 'kb-backdrop kb-confirm-backdrop');
    const box = el('div', 'kb-confirm');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.append(el('h2', 'kb-confirm-title', `Start an agent on “${title}”`));
    box.append(el('p', 'kb-confirm-body', 'Empty model or agent uses your current selection in OpenChamber.'));
    const row1 = el('div', 'kb-fields');
    const row2 = el('div', 'kb-fields');
    const cells = [0, 1, 2, 3].map(() => el('div', 'kb-field'));
    row1.append(cells[0]!, cells[1]!);
    row2.append(cells[2]!, cells[3]!);
    const actions = el('div', 'kb-actions');
    box.append(row1, row2, actions);
    backdrop.append(box);

    const disposers: Array<() => void> = [];
    const preset = mountSelect(cells[0]!, {
      label: 'Preset',
      value: options.presetId,
      options: presets.map((p) => ({ id: p.id, label: p.name })),
      onChange: (id) => {
        options.presetId = id;
        preset.update({ value: id });
      },
    });
    const location = mountSelect(cells[1]!, {
      label: 'Location',
      value: options.location,
      options: (Object.keys(LOCATION_LABELS) as Location[]).map((id) => ({ id, label: LOCATION_LABELS[id] })),
      onChange: (id) => {
        options.location = id as Location;
        location.update({ value: id });
      },
    });
    const text = (slot: HTMLElement, label: string, key: 'model' | 'agent', placeholder: string): void => {
      const field = mountTextField(slot, {
        label,
        value: options[key] ?? '',
        placeholder,
        mono: true,
        onChange: (v) => {
          field.update({ value: v });
          options[key] = v.trim() === '' ? null : v.trim();
        },
      });
      disposers.push(field.dispose);
    };
    text(cells[2]!, 'Model', 'model', 'Your current model');
    text(cells[3]!, 'Agent', 'agent', 'Your current agent');
    disposers.push(preset.dispose, location.dispose);

    const done = (answer: StartOptions | null): void => {
      document.removeEventListener('keydown', onKey);
      for (const d of disposers) d();
      backdrop.remove();
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent): void => {
      // An open select popup closes itself first and marks the event handled.
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      done(null);
    };
    disposers.push(mountButton(actions, { label: 'Start', size: 'sm', onClick: () => done({ ...options }) }).dispose);
    disposers.push(mountButton(actions, { label: 'Cancel', variant: 'outline', size: 'sm', onClick: () => done(null) }).dispose);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) done(null);
    });
    // Bubble phase: a select's popup sees Escape first.
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    actions.querySelector('button')?.focus();
  });
