// A source that fails to list (gh logged out, no network) does not take the board down (ADR 0001):
// the board shows the other sources and a banner per failed source. Pure, so it runs under node:test.
import type { SourceId, Task } from '../core/types.ts';
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

/**
 * A `/tasks/list` answer for the board: the tasks of the sources that listed, the errors of those
 * that failed, and `unlisted(id)`, true for an id of a failed source. Pruning the archive marks and
 * order skips those ids: their tasks are missing from the list only because the source did not answer.
 * The panel never reads a source from an id: `seen(id)` is the source of a task an earlier load
 * listed (its task.source); an id never seen counts as unlisted while any source failed, so it is
 * kept until a load where every source answers. (When every source fails the service answers an
 * error, and the load fails as with one tracker.)
 */
export const listedBoard = (
  r: { tasks: Task[]; errors?: SourceError[] },
  seen: (id: string) => SourceId | undefined = () => undefined,
): { tasks: Task[]; errors: SourceError[]; unlisted: (id: string) => boolean } => {
  const errors = r.errors ?? [];
  const failed = new Set(errors.map((e) => e.source));
  const listed = new Set(r.tasks.map((t) => t.id));
  return {
    tasks: r.tasks,
    errors,
    unlisted: (id) => {
      if (failed.size === 0 || listed.has(id)) return false;
      const source = seen(id);
      return source === undefined || failed.has(source);
    },
  };
};
