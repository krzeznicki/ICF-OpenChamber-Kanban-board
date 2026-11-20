// Several sources on one board (ADR 0001): each task is handled the way its own source works
// (local files vs GitHub issues), not the way the primary source does. Pure, so it runs under node:test.
import type { Task } from '../core/types.ts';
import type { TrackerKind } from './addTask.ts';

/** The kind of the source `task` lives in; `fallback` (the primary source) for a source the panel does not know. */
export const sourceKind = (task: Task, fallback: TrackerKind): TrackerKind =>
  task.source === 'local' || task.source === 'github' ? task.source : fallback;
