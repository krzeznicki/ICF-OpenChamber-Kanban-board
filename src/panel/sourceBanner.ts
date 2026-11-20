// A source that fails to list (gh logged out, no network) does not take the board down (ADR 0001):
// the board shows the other sources and a banner per failed source. Pure, so it runs under node:test.
import type { Task } from '../core/types.ts';
import type { SourceError, SourceInfo } from './api.ts';

/** One failed source's banner above the columns; `action` retries the load. */
export type SourceBanner = { source: string; tone: 'warning'; title: string; body: string; action: string };

/**
 * The banner of each failed source, in the order the service reported them, then one per config
 * warning (/config/read's `warnings`: an unknown source under Additional sources, skipped).
 */
export const sourceBanners = (errors: readonly SourceError[], sources: readonly SourceInfo[], warnings: readonly string[] = []): SourceBanner[] => [
  ...errors.map((e): SourceBanner => {
    const label = sources.find((s) => s.id === e.source)?.label ?? e.source;
    return e.availability === 'needs-login'
      ? { source: e.source, tone: 'warning', title: `${label} needs a login`, body: `Log in, then try again: ${e.message}`, action: 'Try again' }
      : { source: e.source, tone: 'warning', title: `${label} unavailable`, body: e.message, action: 'Try again' };
  }),
  ...warnings.map((w): SourceBanner => ({ source: '', tone: 'warning', title: 'A source in issue-tracker.md was skipped', body: w, action: 'Try again' })),
];

/** The source an id belongs to, as core/sources.ts's adapters `owns` it; null for an id of no known source. */
const sourceOfId = (id: string): string | null => {
  if (id.startsWith('.scratch/')) return 'local';
  if (/^\s*#?\d+\s*$/.test(id)) return 'github';
  return null;
};

/**
 * A `/tasks/list` answer for the board: the tasks of the sources that listed, the errors of those
 * that failed, and `unlisted(id)`, true for an id of a failed source. Pruning the archive marks and
 * order skips those ids: their tasks are missing from the list only because the source did not answer.
 * (When every source fails the service answers an error, and the load fails as with one tracker.)
 */
export const listedBoard = (r: { tasks: Task[]; errors?: SourceError[] }): { tasks: Task[]; errors: SourceError[]; unlisted: (id: string) => boolean } => {
  const errors = r.errors ?? [];
  const failed = new Set(errors.map((e) => e.source));
  return {
    tasks: r.tasks,
    errors,
    unlisted: (id) => {
      const source = sourceOfId(id);
      return source !== null && failed.has(source);
    },
  };
};
