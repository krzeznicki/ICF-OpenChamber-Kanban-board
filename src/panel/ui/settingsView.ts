// Settings: a side sheet over the board (like the task detail) with three tabs. "Global" and
// "This project" draw the same form over one stored layer each; a field left unset inherits (the
// built-in default for Global, the global value for a project) and shows what it inherits as its
// placeholder or as the "Use …" option. "Presets" edits the preset texts. Every change is reported
// at once with the whole new layer; the caller saves it. The sheet redraws a tab only when the tab
// is switched or a preset is added or deleted, so a text field keeps its focus while typing.
import { mountButton, mountEmpty, mountSelect, mountTabs, mountTextField } from '@openchamber/sdk/ui';
import type { SelectOption } from '@openchamber/sdk/ui';
import {
  addPreset,
  deletePreset,
  isEdited,
  listPresets,
  presetSkillsNote,
  renamePreset,
  resetPreset,
  setPresetText,
  skillsFoundLine,
  type Preset,
  type SkillUse,
  type StoredPresets,
} from '../presets.ts';
import {
  DEFAULT_SETTINGS,
  MAX_PARALLEL_MAX,
  MAX_PARALLEL_MIN,
  parseSettings,
  resolveSettings,
  skillUse,
  type Location,
  type Settings,
  type SettingsLayer,
} from '../settings.ts';
import { defaultModelLabel } from '../models.ts';
import { mountCloseButton } from './closeButton.ts';
import { mountModelPicker } from './modelPicker.ts';
import { askChoice } from './confirm.ts';

export type SettingsTab = 'global' | 'project' | 'presets';

export type SettingsModel = {
  tab: SettingsTab;
  global: SettingsLayer;
  /** Null when no project is open. */
  project: { name: string; layer: SettingsLayer } | null;
  presets: StoredPresets;
  /** Matt Pocock's skills found for the open project; null when no project is open or the check failed. */
  skills: string[] | null;
};

export type SettingsCallbacks = {
  onGlobal: (layer: SettingsLayer) => void;
  onProject: (layer: SettingsLayer) => void;
  onPresets: (stored: StoredPresets) => void;
  onDismiss: () => void;
  /** The model picker's list (loaded once per panel session). */
  loadModels: () => Promise<string[]>;
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
const presetName = (presets: readonly Preset[], id: string): string => presets.find((p) => p.id === id)?.name ?? id;
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
    presets: readonly Preset[];
    loadModels: () => Promise<string[]>;
    /** Global only: the "Use Matt Pocock's skills" toggle, with this line saying what was found. */
    skillsLine?: string;
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
  disposers.push(
    mountModelPicker(cell(r3), {
      label: 'Model',
      value: layer.defaults?.model ?? null,
      defaultLabel: defaultModelLabel(base.defaults.model, inheritWord),
      loadModels: opts.loadModels,
      onChange: (v) => {
        defaults().model = v;
        emit();
      },
    }),
  );
  mountInheritText(cell(r3), disposers, {
    label: 'Agent',
    value: layer.defaults?.agent ?? undefined,
    placeholder: base.defaults.agent ?? 'Your current agent',
    resetLabel: inheritWord,
    helper: 'e.g. build or plan',
    mono: true,
    onChange: (v) => {
      defaults().agent = v ?? null;
      emit();
    },
  });

  if (opts.skillsLine !== undefined) {
    const skills = section(
      "Matt Pocock's skills",
      'When on, a built-in preset whose skills are all installed tells the agent to run them (Settings → Presets shows which), and a bug starts with Diagnose.',
    );
    bool(row(skills), "Use Matt Pocock's skills when installed", () => layer.useMattSkills, (v) => (layer.useMattSkills = v), base.useMattSkills);
    skills.append(el('p', 'kb-settings-hint', opts.skillsLine));
  }

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
};

const drawPresets = (
  root: HTMLElement,
  disposers: Disposers,
  getStored: () => StoredPresets,
  setStored: (s: StoredPresets) => void,
  redraw: () => void,
  skills: { use: SkillUse; line: string },
): void => {
  root.append(
    el('p', 'kb-settings-hint', 'A preset is a block of instructions added to the agent’s start prompt. Built-ins can be edited and reset.'),
    el('p', 'kb-settings-hint', skills.line),
  );
  for (const preset of listPresets(getStored(), skills.use)) {
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
          setStored(renamePreset(getStored(), preset.id, v));
        },
      });
      disposers.push(name.dispose);
    }
    const buttons = el('div', 'kb-actions');
    head.append(buttons);
    const note = presetSkillsNote(preset, skills.use, isEdited(getStored(), preset.id));
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
        const next = setPresetText(getStored(), preset.id, v);
        setStored(next);
        reset?.update({ disabled: !isEdited(next, preset.id) });
        if (noteLine !== null) noteLine.textContent = presetSkillsNote(preset, skills.use, isEdited(next, preset.id)) ?? '';
      },
    });
    disposers.push(text.dispose);
    if (preset.builtin) {
      reset = mountButton(buttons, {
        label: 'Reset',
        variant: 'ghost',
        size: 'xs',
        disabled: !isEdited(getStored(), preset.id),
        onClick: () => {
          setStored(resetPreset(getStored(), preset.id));
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
              setStored(deletePreset(getStored(), preset.id));
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
        setStored(addPreset(getStored(), 'New preset').stored);
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
    const use = skillUse(resolveSettings(m.global, {}, found), found);
    const skillsLine = skillsFoundLine(m.skills);
    const presets = listPresets(m.presets, use);
    if (m.tab === 'global') {
      drawLayerForm(body, disposers, {
        layer: m.global,
        // The built-in defaults, with the toggle as set here (a bug's default follows it).
        base: resolveSettings({ useMattSkills: m.global.useMattSkills ?? DEFAULT_SETTINGS.useMattSkills }, {}, found),
        inheritWord: 'Default',
        presets,
        loadModels: callbacks.loadModels,
        skillsLine,
        onChange: (layer) => {
          const toggled = (layer.useMattSkills ?? DEFAULT_SETTINGS.useMattSkills) !== (m.global.useMattSkills ?? DEFAULT_SETTINGS.useMattSkills);
          m.global = layer;
          callbacks.onGlobal(layer);
          // The bug type's default preset shown in this form follows the toggle.
          if (toggled) queueMicrotask(draw);
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
          presets,
          loadModels: callbacks.loadModels,
          onChange: (layer) => {
            project.layer = layer;
            callbacks.onProject(layer);
          },
        });
      }
    } else {
      drawPresets(
        body,
        disposers,
        () => m.presets,
        (s) => {
          m.presets = s;
          callbacks.onPresets(s);
        },
        draw,
        { use, line: skillsLine },
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
