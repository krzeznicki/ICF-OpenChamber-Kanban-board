// Settings → Sources (ADR 0001): the project's sources, adding and removing one and choosing the
// primary. The service rewrites docs/agents/issue-tracker.md (POST /config/sources), the same file
// `task-board init --add/--remove/--primary` writes. Pure, so it runs under node:test.
import type { SourceId } from '../core/types.ts';
import type { ProjectConfig } from './api.ts';

/** Mirrors core/config.ts's SourceChange. */
export type SourceChange = { add: SourceId } | { remove: SourceId } | { primary: SourceId };

export type SourceRow = { id: SourceId; label: string; primary: boolean; canRemove: boolean; canMakePrimary: boolean };

/** The Sources tab: one row per source (the primary first) and the sources that can still be added (of /config/read's `known`). */
export const sourcesView = (config: ProjectConfig): { rows: SourceRow[]; addable: Array<{ id: SourceId; label: string }> } => ({
  rows: config.sources.map((s) => {
    const primary = s.id === config.primary;
    return { id: s.id, label: s.label, primary, canRemove: !primary, canMakePrimary: !primary };
  }),
  addable: config.known.filter((k) => !config.sources.some((s) => s.id === k.id)).map((k) => ({ id: k.id, label: k.label })),
});

/** What /config/sources answers: the new config, or a question when the change would drop hand edits. */
export type SourcesAnswer = { config: ProjectConfig } | { confirm: string };

/**
 * Sends `change`. When the service asks to confirm (a primary template edited by hand), `ask` shows
 * the message; yes sends it again with force. Null: the user said no, nothing changed.
 */
export const changeSource = async (
  service: { changeSources: (change: SourceChange, force: boolean) => Promise<SourcesAnswer> },
  change: SourceChange,
  ask: (message: string) => Promise<boolean>,
): Promise<ProjectConfig | null> => {
  const first = await service.changeSources(change, false);
  if ('config' in first) return first.config;
  if (!(await ask(first.confirm))) return null;
  const forced = await service.changeSources(change, true);
  return 'config' in forced ? forced.config : null;
};
