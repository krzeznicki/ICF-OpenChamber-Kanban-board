// Settings: a side sheet over the board (like the task detail) with three tabs. "Global" and
// "This project" draw the same form over one stored layer each; a field left unset inherits (the
// built-in default for Global, the global value for a project) and shows what it inherits as its
// placeholder or as the "Use …" option; both pick the preset set. "Presets" edits the sets: their
// preset texts, the user's own presets and sets. Every change is reported at once with the whole new
// layer or stored sets; the caller saves it. The sheet redraws a tab only when the tab is switched, a
// set is chosen, or a preset or set is added or deleted, so a text field keeps its focus while typing.
import { mountButton, mountEmpty, mountSelect, mountTabs, mountTextField } from '@openchamber/sdk/ui';
import type { SelectOption } from '@openchamber/sdk/ui';
import {
  addPreset,
  addSet,
  defaultSetId,
  deletePreset,
  deleteSet,
  isEdited,
  listPresets,
  listSets,
  presetSkillsNote,
  renamePreset,
  renameSet,
  resetPreset,
  setOptionLabel,
  setPresetText,
  setStatusLine,
  type Preset,
  type StoredSets,
} from '../presets.ts';
import {
  MAX_PARALLEL_MAX,
  MAX_PARALLEL_MIN,
  parseSettings,
  presetSetOf,
  resolveSettings,
  type Location,
  type Settings,
  type SettingsLayer,
} from '../settings.ts';
import { START_PATH_NOTE, type StartLists } from '../models.ts';
import { mountCloseButton } from './closeButton.ts';
import { askChoice } from './confirm.ts';
import { mountStartTarget } from './startTarget.ts';

export type SettingsTab = 'global' | 'project' | 'presets';

export type SettingsModel = {
  tab: SettingsTab;
  global: SettingsLayer;
  /** Null when no project is open. */
  project: { name: string; layer: SettingsLayer } | null;
  presets: StoredSets;
  /** The known skills found for the open project; null when no project is open or the check failed. */
  skills: string[] | null;
  /** The set the Presets tab shows; null: the open project's (else the global) set. */
  editSet?: string | null;
};

export type SettingsCallbacks = {
  onGlobal: (layer: SettingsLayer) => void;
  onProject: (layer: SettingsLayer) => void;
  onPresets: (stored: StoredSets) => void;
  onDismiss: () => void;
  /** The model and agent lists of the start pickers (loaded once per project). */
  lists: StartLists;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const LOCATION_LABELS: Record<Location, string> = { worktree: 'New worktree', project: 'Project folder' };
const INHERIT = '';

type Disposers = Array<() => void>;

/** A select whose first option ("Use global (…)") means "not set here". */
export const mountInheritSelect = (
  slot: HTMLElement,
  disposers: Disposers,
  props: { label: string; value: string | undefined; inheritLabel: string; options: SelectOption[]; onChange: (v: string | undefined) => void },
): void => {
  const select = mountSelect(slot, {
    label: props.label,
    value: props.value ?? INHERIT,
    options: [{ id: INHERIT, label: props.inheritLabel }, ...props.options],
    onChange: (id) => {
      select.update({ value: id });
      props.onChange(id === INHERIT ? undefined : id);
    },
  });
  disposers.push(select.dispose);
};

/** A text field where empty means "not set here", with the inherited value as placeholder and a reset button. */
export const mountInheritText = (
  slot: HTMLElement,
  disposers: Disposers,
  props: {
    label: string;
    value: string | undefined;
    placeholder: string;
    resetLabel: string;
    helper?: string;
    multiline?: boolean;
    mono?: boolean;
    onChange: (v: string | undefined) => void;
  },
): void => {
  const fieldSlot = el('div', 'kb-inherit-field');
  const resetSlot = el('div', 'kb-inherit-reset');
  const wrap = el('div', 'kb-inherit');
  wrap.append(fieldSlot, resetSlot);
  slot.append(wrap);
  const report = (v: string): void => {
    field.update({ value: v });
    reset.update({ disabled: v === '' });
    props.onChange(v.trim() === '' ? undefined : v);
  };
  const field = mountTextField(fieldSlot, {
    label: props.label,
    value: props.value ?? '',
    placeholder: props.placeholder,
    ...(props.helper !== undefined ? { helper: props.helper } : {}),
    ...(props.multiline === true ? { multiline: true, rows: 6 } : {}),
    ...(props.mono === true ? { mono: true } : {}),
    onChange: report,
  });
  const reset = mountButton(resetSlot, {
    label: props.resetLabel,
    variant: 'ghost',
    size: 'xs',
    disabled: (props.value ?? '') === '',
    onClick: () => report(''),
  });
  disposers.push(field.dispose, reset.dispose);
};

const onOff = (b: boolean): string => (b ? 'On' : 'Off');
/** A preset's name in the layer's set; one the set lacks starts as Implement (resolveStart), and says so. */
const presetName = (presets: readonly Preset[], id: string): string =>
  presets.find((p) => p.id === id)?.name ?? `${presets.find((p) => p.id === 'implement')?.name ?? 'Implement'} (the set has no ${id})`;
const presetOptions = (presets: readonly Preset[]): SelectOption[] => presets.map((p) => ({ id: p.id, label: p.name }));

/** One stored layer as a form; `base` is what the layer inherits from. */
const drawLayerForm = (
  root: HTMLElement,
  disposers: Disposers,
  opts: {
    layer: SettingsLayer;
    base: Settings;
    /** "Default" for the global layer, "Use global" for a project. */
    inheritWord: string;
    /** The presets of the set this layer ends up with. */
    presets: readonly Preset[];
    lists: StartLists;
    /** The preset set picker: the sets, the label of its inherit option, and the line under it. */
    sets: { options: SelectOption[]; inheritLabel: string; line: string };
    /** The global layer: also shows the global-only "Suggest type and state for new tasks". */
    global?: boolean;
    onChange: (layer: SettingsLayer) => void;
  },
): void => {
  // A working copy: each control writes into it, then the whole cleaned layer is reported.
  const layer: SettingsLayer = structuredClone(parseSettings(opts.layer));
  const { base, inheritWord, presets } = opts;
  const emit = (): void => opts.onChange(parseSettings(layer));
  const inherit = (shown: string): string => `${inheritWord} (${shown})`;
  const section = (title: string, hint?: string): HTMLElement => {
    const s = el('section', 'kb-settings-section');
    s.append(el('h3', 'kb-settings-heading', title));
    if (hint !== undefined) s.append(el('p', 'kb-settings-hint', hint));
    root.append(s);
    return s;
  };
  const row = (parent: HTMLElement): HTMLElement => {
    const r = el('div', 'kb-fields');
    parent.append(r);
    return r;
  };
  const cell = (parent: HTMLElement): HTMLElement => {
    const c = el('div', 'kb-field');
    parent.append(c);
    return c;
  };
  const bool = (parent: HTMLElement, label: string, get: () => boolean | undefined, set: (v: boolean | undefined) => void, b: boolean) =>
    mountInheritSelect(cell(parent), disposers, {
      label,
      value: get() === undefined ? undefined : get() ? 'on' : 'off',
      inheritLabel: inherit(onOff(b)),
      options: [
        { id: 'on', label: 'On' },
        { id: 'off', label: 'Off' },
      ],
      onChange: (v) => {
        set(v === undefined ? undefined : v === 'on');
        emit();
      },
    });
  const defaults = (): Partial<Settings['defaults']> => (layer.defaults ??= {});
  const summary = (): Partial<Settings['summary']> => (layer.summary ??= {});

  const setSection = section('Preset set', 'The presets cards start with: built-in sets run Matt Pocock\'s skills, the Superpowers skills, or plain instructions; edit them or add your own in Presets.');
  mountInheritSelect(cell(row(setSection)), disposers, {
    label: 'Preset set',
    value: layer.presetSet,
    inheritLabel: opts.sets.inheritLabel,
    options: opts.sets.options,
    onChange: (v) => {
      layer.presetSet = v;
      emit();
    },
  });
  setSection.append(el('p', 'kb-settings-hint', opts.sets.line));

  const start = section('Starting agents', 'Moving a card to In Progress starts a session with these options unless the card sets its own.');
  const r1 = row(start);
  bool(r1, 'Start at once', () => layer.autoStart, (v) => (layer.autoStart = v), base.autoStart);
  mountInheritSelect(cell(r1), disposers, {
    label: 'Sessions at a time',
    value: layer.maxParallel === undefined ? undefined : String(layer.maxParallel),
    inheritLabel: inherit(String(base.maxParallel)),
    options: Array.from({ length: MAX_PARALLEL_MAX - MAX_PARALLEL_MIN + 1 }, (_, i) => {
      const n = String(MAX_PARALLEL_MIN + i);
      return { id: n, label: n };
    }),
    onChange: (v) => {
      layer.maxParallel = v === undefined ? undefined : Number(v);
      emit();
    },
  });
  const r2 = row(start);
  mountInheritSelect(cell(r2), disposers, {
    label: 'Default preset',
    value: layer.defaults?.presetId,
    inheritLabel: inherit(presetName(presets, base.defaults.presetId)),
    options: presetOptions(presets),
    onChange: (v) => {
      defaults().presetId = v;
      emit();
    },
  });
  mountInheritSelect(cell(r2), disposers, {
    label: 'Location',
    value: layer.defaults?.location,
    inheritLabel: inherit(LOCATION_LABELS[base.defaults.location]),
    options: (Object.keys(LOCATION_LABELS) as Location[]).map((id) => ({ id, label: LOCATION_LABELS[id] })),
    onChange: (v) => {
      defaults().location = v as Location | undefined;
      emit();
    },
  });
  const r3 = row(start);
  const modelCell = cell(r3);
  const thinkingCell = cell(r3);
  const agentCell = cell(row(start));
  disposers.push(
    mountStartTarget(
      { model: modelCell, thinking: thinkingCell, agent: agentCell },
      {
        value: { model: layer.defaults?.model ?? null, variant: layer.defaults?.variant ?? null, agent: layer.defaults?.agent ?? null },
        inherited: { model: base.defaults.model, variant: base.defaults.variant, agent: base.defaults.agent },
        inheritWord,
        lists: opts.lists,
        onChange: (v) => {
          defaults().model = v.model;
          defaults().variant = v.variant;
          defaults().agent = v.agent;
          emit();
        },
      },
    ),
  );
  start.append(el('p', 'kb-settings-hint', START_PATH_NOTE));

  const types = layer.types ?? base.types;
  const byType = section('Preset per type', 'Used when a card sets no preset. Unset types use the default preset.');
  const r4 = row(byType);
  for (const type of types) {
    const inherited = base.presetByType[type];
    mountInheritSelect(cell(r4), disposers, {
      label: type,
      value: layer.presetByType?.[type],
      inheritLabel: inherit(inherited !== undefined ? presetName(presets, inherited) : 'default preset'),
      options: presetOptions(presets),
      onChange: (v) => {
        const map = { ...layer.presetByType };
        if (v === undefined) delete map[type];
        else map[type] = v;
        layer.presetByType = map;
        emit();
      },
    });
  }

  const board = section('Board');
  const r5 = row(board);
  bool(r5, 'Hide sub-tasks', () => layer.hideChildren, (v) => (layer.hideChildren = v), base.hideChildren);
  mountInheritText(cell(r5), disposers, {
    label: 'Types',
    value: layer.types?.join(', '),
    placeholder: base.types.join(', '),
    resetLabel: inheritWord,
    helper: 'Comma-separated. Applies the next time this sheet opens.',
    onChange: (v) => {
      const list = v
        ?.split(',')
        .map((t) => t.trim())
        .filter((t) => t !== '');
      layer.types = list === undefined || list.length === 0 ? undefined : list;
      emit();
    },
  });

  const sum = section('Summaries');
  const r6 = row(sum);
  bool(r6, 'Summarise automatically', () => layer.summary?.auto, (v) => (summary().auto = v), base.summary.auto);
  mountInheritText(cell(r6), disposers, {
    label: 'Language',
    value: layer.summary?.language,
    placeholder: base.summary.language,
    resetLabel: inheritWord,
    onChange: (v) => {
      summary().language = v;
      emit();
    },
  });
  mountInheritText(sum, disposers, {
    label: 'Prompt',
    value: layer.summary?.prompt,
    placeholder: base.summary.prompt,
    resetLabel: inheritWord,
    multiline: true,
    onChange: (v) => {
      summary().prompt = v;
      emit();
    },
  });
  if (opts.global === true) {
    const fresh = section(
      'New tasks',
      'Add task offers "Let the model pick" for Type and State: your Small Model suggests them from the title and description once the task is created. Only the fields left to it change. Applies to every project.',
    );
    bool(row(fresh), 'Suggest type and state for new tasks', () => layer.suggestFields, (v) => (layer.suggestFields = v), base.suggestFields);
  }
};

/** The Presets tab: a set picker with set actions, then the chosen set's presets. */
const drawPresets = (
  root: HTMLElement,
  disposers: Disposers,
  getStored: () => StoredSets,
  setStored: (s: StoredSets) => void,
  redraw: () => void,
  view: { setId: string; pick: (setId: string) => void; found: string[] | null; projectOpen: boolean },
): void => {
  const { setId } = view;
  const sets = listSets(getStored());
  const current = sets.find((x) => x.id === setId) ?? sets[0]!;
  root.append(
    el('p', 'kb-settings-hint', 'A preset is a block of instructions added to the agent’s start prompt; a preset set is a list of them. Choose the set a project uses in Global or This project.'),
  );
  const head = el('div', 'kb-preset-head');
  root.append(head);
  const pickSlot = el('div', 'kb-field');
  head.append(pickSlot);
  const picker = mountSelect(pickSlot, {
    label: 'Set',
    value: current.id,
    options: sets.map((x) => ({ id: x.id, label: setOptionLabel(x, view.found, getStored()) })),
    onChange: (id) => {
      picker.update({ value: id });
      view.pick(id);
      redraw();
    },
  });
  disposers.push(picker.dispose);
  const setButtons = el('div', 'kb-actions');
  head.append(setButtons);
  disposers.push(
    mountButton(setButtons, {
      label: 'New set',
      variant: 'outline',
      size: 'xs',
      onClick: () => {
        void askChoice('New preset set', `Start from a copy of “${current.name}” (its texts as they read now), or empty.`, [
          { id: 'empty', label: 'Empty', variant: 'outline' },
          { id: 'copy', label: `Copy “${current.name}”` },
        ]).then((answer) => {
          if (answer === null) return;
          const added = answer === 'copy' ? addSet(getStored(), `${current.name} (copy)`, current.id) : addSet(getStored(), 'New set', null);
          setStored(added.stored);
          view.pick(added.id);
          redraw();
        });
      },
    }).dispose,
  );
  if (!current.builtin) {
    disposers.push(
      mountButton(setButtons, {
        label: 'Delete set',
        variant: 'ghost',
        size: 'xs',
        onClick: () => {
          void askChoice(`Delete “${current.name}”?`, 'Settings that chose it use the default set instead.', [
            { id: 'delete', label: 'Delete', variant: 'destructive' },
          ]).then((answer) => {
            if (answer !== 'delete') return;
            setStored(deleteSet(getStored(), current.id));
            view.pick(sets[0]!.id);
            redraw();
          });
        },
      }).dispose,
    );
    const nameSlot = el('div', 'kb-field');
    root.append(nameSlot);
    const name = mountTextField(nameSlot, {
      label: 'Set name',
      value: current.name,
      onChange: (v) => {
        name.update({ value: v });
        setStored(renameSet(getStored(), current.id, v));
      },
    });
    disposers.push(name.dispose);
  }
  root.append(el('p', 'kb-settings-hint', setStatusLine(current.id, view.found, view.projectOpen, getStored())));

  const presets = listPresets(getStored(), current.id);
  if (presets.length === 0) root.append(el('p', 'kb-settings-hint', 'This set has no presets yet: cards that use it start with the Plain Implement text.'));
  for (const preset of presets) {
    const box = el('section', 'kb-preset');
    root.append(box);
    const head = el('div', 'kb-preset-head');
    box.append(head);
    if (preset.builtin) {
      head.append(el('h3', 'kb-settings-heading', preset.name));
    } else {
      const nameSlot = el('div', 'kb-field');
      head.append(nameSlot);
      const name = mountTextField(nameSlot, {
        label: 'Name',
        value: preset.name,
        onChange: (v) => {
          name.update({ value: v });
          setStored(renamePreset(getStored(), current.id, preset.id, v));
        },
      });
      disposers.push(name.dispose);
    }
    const buttons = el('div', 'kb-actions');
    head.append(buttons);
    const note = presetSkillsNote(preset, current.id, isEdited(getStored(), current.id, preset.id));
    const noteLine = note === null ? null : el('p', 'kb-settings-hint', note);
    if (noteLine !== null) box.append(noteLine);
    const textSlot = el('div', '');
    box.append(textSlot);
    let reset: ReturnType<typeof mountButton> | null = null;
    const text = mountTextField(textSlot, {
      ...(preset.builtin ? {} : { label: 'Instructions' }),
      value: preset.text,
      multiline: true,
      rows: 5,
      onChange: (v) => {
        text.update({ value: v });
        const next = setPresetText(getStored(), current.id, preset.id, v);
        setStored(next);
        reset?.update({ disabled: !isEdited(next, current.id, preset.id) });
        if (noteLine !== null) noteLine.textContent = presetSkillsNote(preset, current.id, isEdited(next, current.id, preset.id)) ?? '';
      },
    });
    disposers.push(text.dispose);
    if (preset.builtin) {
      reset = mountButton(buttons, {
        label: 'Reset',
        variant: 'ghost',
        size: 'xs',
        disabled: !isEdited(getStored(), current.id, preset.id),
        onClick: () => {
          setStored(resetPreset(getStored(), current.id, preset.id));
          redraw();
        },
      });
      disposers.push(reset.dispose);
    } else {
      disposers.push(
        mountButton(buttons, {
          label: 'Delete',
          variant: 'ghost',
          size: 'xs',
          onClick: () => {
            void askChoice(`Delete “${preset.name}”?`, 'Cards that use it start with Implement instead.', [
              { id: 'delete', label: 'Delete', variant: 'destructive' },
            ]).then((answer) => {
              if (answer !== 'delete') return;
              setStored(deletePreset(getStored(), current.id, preset.id));
              redraw();
            });
          },
        }).dispose,
      );
    }
  }
  const add = el('div', 'kb-actions kb-actions-start');
  root.append(add);
  disposers.push(
    mountButton(add, {
      label: 'Add preset',
      variant: 'outline',
      size: 'sm',
      onClick: () => {
        setStored(addPreset(getStored(), current.id, 'New preset').stored);
        redraw();
      },
    }).dispose,
  );
};

export const openSettings = (initial: SettingsModel, callbacks: SettingsCallbacks): { dispose: () => void } => {
  const backdrop = el('div', 'kb-backdrop');
  const sheet = el('aside', 'kb-sheet kb-settings');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Settings');
  sheet.tabIndex = -1;
  const head = el('div', 'kb-sheet-head');
  const titles = el('div', 'kb-sheet-titles');
  titles.append(el('h2', 'kb-sheet-title', 'Settings'));
  const closeSlot = el('div', 'kb-sheet-x');
  head.append(titles, closeSlot);
  const tabsSlot = el('div', 'kb-settings-tabs');
  const body = el('div', 'kb-settings-body');
  sheet.append(head, tabsSlot, body);
  backdrop.append(sheet);
  document.body.append(backdrop);

  const m = structuredClone(initial);
  const fixed: Disposers = [];
  let disposers: Disposers = [];
  fixed.push(mountCloseButton(closeSlot, callbacks.onDismiss));

  const draw = (): void => {
    for (const d of disposers) d();
    disposers = [];
    body.replaceChildren();
    const found = m.skills ?? [];
    const projectOpen = m.project !== null;
    const sets = listSets(m.presets);
    const setName = (id: string): string => sets.find((x) => x.id === id)?.name ?? id;
    const setOptions = sets.map((x) => ({ id: x.id, label: setOptionLabel(x, m.skills, m.presets) }));
    /** The set a layer stack ends up with (a deleted set reads as the default). */
    const setOf = (project: SettingsLayer): string => presetSetOf(m.global, project, m.presets, found);
    const globalSet = setOf({});
    const projectSet = m.project === null ? globalSet : setOf(m.project.layer);
    /** A layer saved with another set redraws the tab: its preset lists and the line under the picker follow. */
    const redrawOnSet = (before: SettingsLayer, after: SettingsLayer): void => {
      if (before.presetSet !== after.presetSet) queueMicrotask(draw);
    };
    if (m.tab === 'global') {
      const fallback = defaultSetId(found);
      drawLayerForm(body, disposers, {
        layer: m.global,
        base: resolveSettings({}, {}, found),
        inheritWord: 'Default',
        global: true,
        presets: listPresets(m.presets, globalSet),
        lists: callbacks.lists,
        sets: {
          options: setOptions,
          inheritLabel: m.skills === null ? 'Default (by the skills installed)' : `Default (${setName(fallback)})`,
          line: `${setName(globalSet)}: ${setStatusLine(globalSet, m.skills, projectOpen, m.presets)}${m.skills === null ? '' : ' Without a choice: Matt Pocock\'s skills when all are found, else Superpowers when found, else Plain.'}`,
        },
        onChange: (layer) => {
          const before = m.global;
          m.global = layer;
          callbacks.onGlobal(layer);
          redrawOnSet(before, layer);
        },
      });
    } else if (m.tab === 'project') {
      const project = m.project;
      if (project === null) {
        disposers.push(mountEmpty(body, { title: 'No project', body: 'Open a project to change its settings.' }).dispose);
      } else {
        body.append(el('p', 'kb-settings-hint', `Only for ${project.name}. Unset fields use the global settings.`));
        drawLayerForm(body, disposers, {
          layer: project.layer,
          base: resolveSettings(m.global, {}, found),
          inheritWord: 'Use global',
          presets: listPresets(m.presets, projectSet),
          lists: callbacks.lists,
          sets: {
            options: setOptions,
            inheritLabel: `Use global (${setName(globalSet)})`,
            line: `${setName(projectSet)}: ${setStatusLine(projectSet, m.skills, true, m.presets)}`,
          },
          onChange: (layer) => {
            const before = project.layer;
            project.layer = layer;
            callbacks.onProject(layer);
            redrawOnSet(before, layer);
          },
        });
      }
    } else {
      const shown = m.editSet !== undefined && m.editSet !== null && sets.some((x) => x.id === m.editSet) ? m.editSet : projectSet;
      drawPresets(
        body,
        disposers,
        () => m.presets,
        (s) => {
          m.presets = s;
          callbacks.onPresets(s);
        },
        draw,
        { setId: shown, pick: (id) => (m.editSet = id), found: m.skills, projectOpen },
      );
    }
  };

  const tabs = mountTabs(tabsSlot, {
    items: [
      { id: 'global', label: 'Global' },
      { id: 'project', label: 'This project' },
      { id: 'presets', label: 'Presets' },
    ],
    activeId: m.tab,
    onChange: (id) => {
      m.tab = id as SettingsTab;
      tabs.update({ activeId: id });
      draw();
    },
  });
  fixed.push(tabs.dispose);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !e.defaultPrevented) callbacks.onDismiss();
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) callbacks.onDismiss();
  });
  document.addEventListener('keydown', onKey);
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  draw();
  sheet.focus();

  return {
    dispose: () => {
      document.removeEventListener('keydown', onKey);
      for (const d of [...disposers, ...fixed]) d();
      backdrop.remove();
      if (previous?.isConnected) previous.focus();
    },
  };
};
