// A card's start options (preset, location, model, thinking, agent, summary language), each unset field
// showing what it inherits. Used in the task modal's Settings and in the Add task modal; it reports
// the whole CardOptions on every change.
import type { Preset } from '../presets.ts';
import type { CardOptions, Location, StartOptions } from '../settings.ts';
import { START_PATH_NOTE, type StartLists } from '../models.ts';
import { LOCATION_LABELS, mountInheritSelect, mountInheritText } from './settingsView.ts';
import { mountStartTarget } from './startTarget.ts';

export type StartOptionsProps = {
  presets: readonly Preset[];
  card: CardOptions;
  /** What the card would start with if it set nothing. */
  inherited: StartOptions;
  /** The summary language from the settings, shown when the card sets none. */
  summaryLanguage: string;
  lists: StartLists;
  onChange: (card: CardOptions) => void;
};

const div = (className: string): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = className;
  return d;
};

/** Appends the fields to `box`; returns their disposer (the caller clears `box`). */
export const mountStartOptions = (box: HTMLElement, props: StartOptionsProps): (() => void) => {
  const disposers: Array<() => void> = [];
  const card: CardOptions = { ...props.card };
  const emit = (): void => props.onChange({ ...card });
  const name = (id: string): string => props.presets.find((p) => p.id === id)?.name ?? id;
  const row1 = div('kb-fields');
  const row2 = div('kb-fields');
  const row3 = div('kb-fields');
  const cells = [0, 1, 2, 3, 4, 5].map(() => div('kb-field'));
  row1.append(cells[0]!, cells[1]!);
  row2.append(cells[2]!, cells[3]!);
  row3.append(cells[4]!, cells[5]!);
  const note = div('kb-muted kb-start-note');
  note.textContent = START_PATH_NOTE;
  box.append(row1, row2, row3, note);
  mountInheritSelect(cells[0]!, disposers, {
    label: 'Preset',
    value: card.presetId,
    inheritLabel: `Default (${name(props.inherited.presetId)})`,
    options: props.presets.map((p) => ({ id: p.id, label: p.name })),
    onChange: (v) => {
      card.presetId = v;
      emit();
    },
  });
  mountInheritSelect(cells[1]!, disposers, {
    label: 'Location',
    value: card.location,
    inheritLabel: `Default (${LOCATION_LABELS[props.inherited.location]})`,
    options: (Object.keys(LOCATION_LABELS) as Location[]).map((id) => ({ id, label: LOCATION_LABELS[id] })),
    onChange: (v) => {
      card.location = v as Location | undefined;
      emit();
    },
  });
  disposers.push(
    mountStartTarget(
      { model: cells[2]!, thinking: cells[3]!, agent: cells[4]! },
      {
        value: { model: card.model ?? null, variant: card.variant ?? null, agent: card.agent ?? null },
        inherited: { model: props.inherited.model, variant: props.inherited.variant, agent: props.inherited.agent },
        lists: props.lists,
        onChange: (v) => {
          card.model = v.model;
          card.variant = v.variant;
          card.agent = v.agent;
          emit();
        },
      },
    ),
  );
  mountInheritText(cells[5]!, disposers, {
    label: 'Summary language',
    value: card.summaryLanguage,
    placeholder: props.summaryLanguage,
    resetLabel: 'Default',
    onChange: (v) => {
      if (v === undefined) delete card.summaryLanguage;
      else card.summaryLanguage = v;
      emit();
    },
  });
  return () => {
    for (const d of disposers) d();
  };
};
