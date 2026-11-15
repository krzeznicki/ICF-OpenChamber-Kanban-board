// What a session runs on: the model (searchable, by name), its thinking level and the agent, each
// a select whose first option is the default (null). Used by every set of start options: the
// card's, the Add task modal's, the start form and Settings (global and This project).
//
// The lists come from the service (models.ts StartLists): models load the first time the model or
// thinking select is used, or at once when a model is in force (the thinking select needs its
// levels); agents load the first time the agent select is used. Until then, and after a failure,
// a stored value shows as its own option so it is never lost; the status row retries.
import { mountSelect, type SelectHandle } from '@openchamber/sdk/ui';
import {
  DEFAULT_MODEL_ID,
  agentOptions,
  defaultLabel,
  keptVariant,
  modelOptions,
  pickedModel,
  thinkingDefaultLabel,
  thinkingField,
  type AgentInfo,
  type ModelInfo,
  type StartLists,
} from '../models.ts';

export type StartTarget = { model: string | null; variant: string | null; agent: string | null };

export type StartTargetProps = {
  /** Set here; null fields inherit. */
  value: StartTarget;
  /** What the null fields resolve to (null: OpenChamber's current selection / OpenCode's default). */
  inherited: StartTarget;
  /** "Default", or "Use global" in the This project tab. */
  inheritWord?: string;
  lists: StartLists;
  onChange: (value: StartTarget) => void;
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Mounts the three selects into their cells; returns the disposer. */
export const mountStartTarget = (
  cells: { model: HTMLElement; thinking: HTMLElement; agent: HTMLElement },
  props: StartTargetProps,
): (() => void) => {
  const word = props.inheritWord ?? 'Default';
  const value: StartTarget = { ...props.value };
  const { inherited } = props;
  let models: ModelInfo[] | null = null;
  let modelError: string | undefined;
  let modelsLoading = false;
  let agents: AgentInfo[] | null = null;
  let agentError: string | undefined;
  let agentsLoading = false;
  let disposed = false;

  const effectiveModel = (): string | null => value.model ?? inherited.model;
  const modelName = (id: string): string => models?.find((m) => m.id === id)?.name ?? id;
  const agentName = (id: string): string => agents?.find((a) => a.id === id)?.name ?? id;
  const inheritedVariant = (): string | null => (effectiveModel() === null ? null : inherited.variant);
  const err = (e: string | undefined): { error?: string } => (e !== undefined ? { error: e } : {});

  const modelOpts = () =>
    modelOptions({
      models,
      value: value.model,
      defaultLabel: defaultLabel(inherited.model === null ? null : modelName(inherited.model), word),
      ...err(modelError),
    });
  const thinkingOpts = () =>
    thinkingField({
      model: effectiveModel(),
      models,
      value: value.variant,
      defaultLabel: thinkingDefaultLabel(inheritedVariant(), effectiveModel() !== null, word),
      ...err(modelError),
    });
  const agentOpts = () =>
    agentOptions({
      agents,
      value: value.agent,
      defaultLabel: defaultLabel(inherited.agent === null ? null : agentName(inherited.agent), word),
      ...err(agentError),
    });

  const drawThinking = (): void => {
    const f = thinkingOpts();
    thinking.update({ value: value.variant ?? DEFAULT_MODEL_ID, options: f.options, disabled: f.disabled });
    if (f.reason !== undefined && f.disabled) cells.thinking.title = f.reason;
    else cells.thinking.removeAttribute('title');
  };
  const drawModels = (): void => {
    model.update({ value: value.model ?? DEFAULT_MODEL_ID, options: modelOpts() });
    drawThinking();
  };
  const drawAgents = (): void => agent.update({ value: value.agent ?? DEFAULT_MODEL_ID, options: agentOpts() });

  const loadModels = (): void => {
    if (models !== null || modelsLoading) return;
    modelsLoading = true;
    modelError = undefined;
    props.lists.models().then(
      (list) => {
        modelsLoading = false;
        if (disposed) return;
        models = list;
        drawModels();
      },
      (e: unknown) => {
        modelsLoading = false;
        if (disposed) return;
        modelError = message(e);
        drawModels();
      },
    );
    drawModels();
  };
  const loadAgents = (): void => {
    if (agents !== null || agentsLoading) return;
    agentsLoading = true;
    agentError = undefined;
    props.lists.agents().then(
      (list) => {
        agentsLoading = false;
        if (disposed) return;
        agents = list;
        drawAgents();
      },
      (e: unknown) => {
        agentsLoading = false;
        if (disposed) return;
        agentError = message(e);
        drawAgents();
      },
    );
    drawAgents();
  };

  const emit = (): void => props.onChange({ ...value });

  const model: SelectHandle = mountSelect(cells.model, {
    label: 'Model',
    value: value.model ?? DEFAULT_MODEL_ID,
    options: modelOpts(),
    searchable: true,
    searchPlaceholder: 'Filter models',
    onChange: (id) => {
      const picked = pickedModel(id);
      if (picked === null) {
        // The loading / failure row: keep the value; after a failure, try again.
        drawModels();
        loadModels();
        return;
      }
      value.model = picked.value;
      // A level the new model does not offer is dropped (kept while its levels are unknown), and
      // with no model in force at all there is nothing to think with (resolveStart drops it too).
      value.variant = effectiveModel() === null ? null : keptVariant(value.variant, value.model, models);
      drawModels();
      emit();
    },
  });
  const thinkingInit = thinkingOpts();
  const thinking: SelectHandle = mountSelect(cells.thinking, {
    label: 'Thinking',
    value: value.variant ?? DEFAULT_MODEL_ID,
    options: thinkingInit.options,
    disabled: thinkingInit.disabled,
    onChange: (id) => {
      const picked = pickedModel(id);
      if (picked === null) {
        drawThinking();
        loadModels();
        return;
      }
      value.variant = picked.value;
      drawThinking();
      emit();
    },
  });
  const agent: SelectHandle = mountSelect(cells.agent, {
    label: 'Agent',
    value: value.agent ?? DEFAULT_MODEL_ID,
    options: agentOpts(),
    onChange: (id) => {
      const picked = pickedModel(id);
      if (picked === null) {
        drawAgents();
        loadAgents();
        return;
      }
      value.agent = picked.value;
      drawAgents();
      emit();
    },
  });
  drawThinking();

  // The first press on a picker (pointer or key) loads its list; the popup repaints when it arrives.
  const onModelUse = (): void => loadModels();
  const onAgentUse = (): void => loadAgents();
  const listen = (root: HTMLElement, fn: () => void): (() => void) => {
    root.addEventListener('pointerdown', fn, true);
    root.addEventListener('keydown', fn, true);
    return () => {
      root.removeEventListener('pointerdown', fn, true);
      root.removeEventListener('keydown', fn, true);
    };
  };
  const unlisten = [listen(cells.model, onModelUse), listen(cells.thinking, onModelUse), listen(cells.agent, onAgentUse)];
  // With a model in force the thinking select needs its levels (and the default's label its name) now.
  if (effectiveModel() !== null) loadModels();
  if (value.agent !== null || inherited.agent !== null) loadAgents();

  return () => {
    disposed = true;
    for (const u of unlisten) u();
    model.dispose();
    thinking.dispose();
    agent.dispose();
  };
};
