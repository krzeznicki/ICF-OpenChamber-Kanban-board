// The model picker: the SDK's searchable select over `opencode models` (type to filter, arrows and
// Enter to pick), with "Default (…)" first meaning null. The list is fetched lazily the first time
// a picker is opened (`loadModels` keeps it for the panel session); until then, and after a
// failure, the stored model shows as its own option so the value is never lost.
import { mountSelect } from '@openchamber/sdk/ui';
import { DEFAULT_MODEL_ID, defaultModelLabel, modelOptions, pickedModel } from '../models.ts';

export type ModelPickerProps = {
  value: string | null;
  onChange: (value: string | null) => void;
  /** Resolves to the `provider/model` list; rejects with the reason on failure. */
  loadModels: () => Promise<string[]>;
  label?: string;
  /** The first option's text; defaults to "Default (current selection)". */
  defaultLabel?: string;
};

/** Mounts the picker in `root`; returns its disposer. */
export const mountModelPicker = (root: HTMLElement, props: ModelPickerProps): (() => void) => {
  let value = props.value === DEFAULT_MODEL_ID ? null : props.value;
  let models: string[] | null = null;
  let error: string | undefined;
  let loading = false;
  let disposed = false;
  const defaultLabel = props.defaultLabel ?? defaultModelLabel(null);

  const options = () => modelOptions({ models, value, defaultLabel, ...(error !== undefined ? { error } : {}) });

  const load = (): void => {
    if (models !== null || loading) return;
    loading = true;
    error = undefined;
    select.update({ options: options() });
    props.loadModels().then(
      (list) => {
        loading = false;
        if (disposed) return;
        models = list;
        select.update({ options: options() });
      },
      (e: unknown) => {
        loading = false;
        if (disposed) return;
        error = e instanceof Error ? e.message : String(e);
        select.update({ options: options() });
      },
    );
  };

  const select = mountSelect(root, {
    ...(props.label !== undefined ? { label: props.label } : {}),
    value: value ?? DEFAULT_MODEL_ID,
    options: options(),
    searchable: true,
    searchPlaceholder: 'Filter models',
    onChange: (id) => {
      const picked = pickedModel(id);
      if (picked === null) {
        // The loading / failure row: keep the value; after a failure, try again.
        select.update({ value: value ?? DEFAULT_MODEL_ID });
        load();
        return;
      }
      value = picked.value;
      select.update({ value: value ?? DEFAULT_MODEL_ID, options: options() });
      props.onChange(value);
    },
  });

  // The first press on the picker (pointer or key) loads the list; the popup repaints when it arrives.
  const onFirstUse = (): void => load();
  root.addEventListener('pointerdown', onFirstUse, true);
  root.addEventListener('keydown', onFirstUse, true);

  return () => {
    disposed = true;
    root.removeEventListener('pointerdown', onFirstUse, true);
    root.removeEventListener('keydown', onFirstUse, true);
    select.dispose();
  };
};
