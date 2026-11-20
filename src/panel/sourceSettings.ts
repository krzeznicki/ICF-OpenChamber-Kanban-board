// Settings → Sources (ADR 0001): the project's sources, adding and removing one and choosing the
// primary. The service rewrites docs/agents/issue-tracker.md (POST /config/sources), the same file
// `task-board init --add/--remove/--primary` writes. Pure, so it runs under node:test.
import type { ProjectConfig, SourceInfo } from './api.ts';

type SourceId = SourceInfo['id'];

/** Mirrors core/config.ts's SourceChange. */
export type SourceChange = { add: SourceId } | { remove: SourceId } | { primary: SourceId };

/** The sources the panel knows, in the order they are offered. */
const KNOWN: ReadonlyArray<{ id: SourceId; label: string }> = [
  { id: 'local', label: 'Local' },
  { id: 'github', label: 'GitHub' },
];

export type SourceRow = { id: SourceId; label: string; primary: boolean; canRemove: boolean; canMakePrimary: boolean };

/** The Sources tab: one row per source (the primary first) and the sources that can still be added. */
export const sourcesView = (config: ProjectConfig): { rows: SourceRow[]; addable: Array<{ id: SourceId; label: string }> } => ({
  rows: config.sources.map((s) => {
    const primary = s.id === config.primary;
    return { id: s.id, label: s.label, primary, canRemove: !primary, canMakePrimary: !primary };
  }),
  addable: KNOWN.filter((k) => !config.sources.some((s) => s.id === k.id)),
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
