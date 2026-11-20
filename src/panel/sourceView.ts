// The toolbar's source switcher (ADR 0001): with several sources the board shows All of them or one.
// Pure, so it runs under node:test; main.ts keeps the choice per project (settings.ts sourceView).
import type { Task } from '../core/types.ts';
import type { ProjectConfig, SourceInfo } from './api.ts';

/** What the board shows: every source (`all`) or one source by its id. */
export type SourceView = 'all' | SourceInfo['id'];

export type SourceOption = { value: SourceView; label: string };
export type SourceSwitcher = { kind: 'segments' | 'dropdown'; options: SourceOption[] };

/** Up to this many sources the switcher is a row of segments; more make it a dropdown. */
const MAX_SEGMENT_SOURCES = 3;

/**
 * The switcher next to the project switcher: All, then every source in config order (the primary
 * first). Null with one source: such a project looks as it did before several sources.
 */
export const sourceSwitcher = (sources: readonly SourceInfo[]): SourceSwitcher | null => {
  if (sources.length < 2) return null;
  return {
    kind: sources.length > MAX_SEGMENT_SOURCES ? 'dropdown' : 'segments',
    options: [{ value: 'all', label: 'All' }, ...sources.map((s) => ({ value: s.id, label: s.label }))],
  };
};

/**
 * The view the board opens on: the stored choice when the project still has that source (or All
 * with several sources), else the primary source, also on first opening. `stored` is read from
 * storage as is, so anything else counts as no choice.
 */
export const currentSourceView = (stored: unknown, config: Pick<ProjectConfig, 'primary' | 'sources'>): SourceView => {
  const several = config.sources.length > 1;
  if (stored === 'all') return several ? 'all' : config.primary;
  return config.sources.some((s) => s.id === stored) ? (stored as SourceView) : config.primary;
};

/** The tasks the board draws in `view`: every task in All, else only that source's. */
export const tasksInView = (tasks: readonly Task[], view: SourceView): Task[] =>
  view === 'all' ? [...tasks] : tasks.filter((t) => t.source === view);

/**
 * The source badge on a card: its source's label in the All view of a project with several
 * sources, else null (a single source, or one source shown, needs no badge).
 */
export const sourceBadge = (task: Task, view: SourceView, sources: readonly SourceInfo[]): string | null => {
  if (view !== 'all' || sources.length < 2) return null;
  return sources.find((s) => s.id === task.source)?.label ?? task.source;
};
