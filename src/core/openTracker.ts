// Picks the tracker named in `docs/agents/issue-tracker.md`.
import { readConfig } from './config.ts';
import { createLocalTracker } from './localTracker.ts';
import type { Exec, Tracker } from './types.ts';
import { TrackerError } from './types.ts';

export const openTracker = async (root: string, exec: Exec): Promise<Tracker> => {
  const config = await readConfig(root);
  if (config.tracker === 'local') return createLocalTracker(root);
  // TODO(Task 6): replace with the GitHub tracker, e.g. createGithubTracker(root, exec, config.labels).
  void exec;
  throw new TrackerError('UNSUPPORTED', 'GitHub Issues tracker is not available in this build yet');
};
