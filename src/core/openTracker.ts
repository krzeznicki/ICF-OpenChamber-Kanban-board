// Picks the tracker named in `docs/agents/issue-tracker.md`.
import { readConfig } from './config.ts';
import { createGithubTracker } from './githubTracker.ts';
import { createLocalTracker } from './localTracker.ts';
import type { Exec, Tracker } from './types.ts';

export const openTracker = async (root: string, exec: Exec): Promise<Tracker> => {
  const config = await readConfig(root);
  if (config.tracker === 'local') return createLocalTracker(root);
  return createGithubTracker(root, exec, config.labels);
};
