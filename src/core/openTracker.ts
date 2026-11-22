// Opens the project's sources named in `docs/agents/issue-tracker.md` (the primary one and any under
// `## Additional sources`) as one combined tracker.
import { readConfig } from './config.ts';
import { type CombinedTracker, createCombinedTracker, createGithubSource, createLocalSource } from './sources.ts';
import type { Exec } from './types.ts';

export const openTracker = async (root: string, exec: Exec): Promise<CombinedTracker> => {
  const config = await readConfig(root);
  const sources = config.sources.map((id) =>
    id === 'local' ? createLocalSource(root) : createGithubSource(root, exec, config.labels),
  );
  return createCombinedTracker(config.primary, sources);
};
