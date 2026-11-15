// Pure decisions behind the setup wizard and the error notices, kept free of DOM so they are tested.
import type { ConfigResult } from './api.ts';

export type TrackerChoice = 'local' | 'github';
export type NoticeTone = 'info' | 'warning' | 'error';
export type NoticeModel = { tone: NoticeTone; title: string; body: string; action: string };
export type ApiFailure = { code: string; message: string };

const TRACKER_NAMES: Record<TrackerChoice, string> = { local: 'local Markdown files', github: 'GitHub Issues' };

export const trackerName = (tracker: TrackerChoice): string => TRACKER_NAMES[tracker];

/** GitHub is preselected when the project has a github.com remote. */
export const defaultChoice = (remote: string | null): TrackerChoice => (remote === null ? 'local' : 'github');

/** The wizard's GitHub choice: disabled when no github.com remote was found (setting it up would be refused). */
export const githubChoice = (remote: string | null): { subtitle: string; disabled: boolean } =>
  remote === null
    ? { subtitle: 'Issues of the repository’s GitHub remote: no GitHub remote found; add one first or choose Local', disabled: true }
    : { subtitle: `Issues of ${remote}; creates the missing labels, needs the gh CLI`, disabled: false };

const TITLES: Record<string, string> = {
  UNSUPPORTED: 'This project’s tracker is not supported',
  GH_MISSING: 'GitHub CLI is not installed',
  GH_OLD: 'GitHub CLI is too old',
  GH_AUTH: 'GitHub CLI is not logged in',
  NO_SERVICE: 'The Kanban Board service is not allowed or not running',
};

/** The notice for a failed load: the error's message with a Retry button. */
export const loadNotice = (e: ApiFailure): NoticeModel => ({
  tone: e.code === 'UNSUPPORTED' ? 'warning' : 'error',
  title: TITLES[e.code] ?? 'Could not load the board',
  body: e.message,
  action: 'Retry',
});

export type SetupOutcome = { kind: 'board' } | { kind: 'notice'; notice: NoticeModel };

/**
 * What to show after the wizard called initConfig (which may have failed) and then readConfig.
 * The config on disk wins: a project already set up for the other tracker is reported, not changed.
 */
export const setupOutcome = (choice: TrackerChoice, initError: ApiFailure | null, read: ConfigResult): SetupOutcome => {
  if ('error' in read) {
    // Nothing was written (e.g. the gh preflight failed): show why; Retry brings the wizard back.
    const notice = initError === null ? loadNotice(read.error) : { ...loadNotice(initError), title: 'Could not set up the board' };
    return { kind: 'notice', notice };
  }
  const tracker = read.config.tracker;
  if (tracker !== choice) {
    return {
      kind: 'notice',
      notice: {
        tone: 'info',
        title: `This project is already set up for ${trackerName(tracker)}`,
        body: `docs/agents/issue-tracker.md already names ${trackerName(tracker)}, so it was left unchanged. The board uses it.`,
        action: 'Open board',
      },
    };
  }
  if (initError !== null) {
    // The config was written but a later step (creating the GitHub labels) failed.
    return {
      kind: 'notice',
      notice: {
        tone: 'warning',
        title: `Set up for ${trackerName(tracker)}, with a problem`,
        body: initError.message,
        action: 'Open board',
      },
    };
  }
  return { kind: 'board' };
};
