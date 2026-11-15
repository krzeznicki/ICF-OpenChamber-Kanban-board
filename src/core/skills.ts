// The skills the built-in preset sets drive (src/panel/presetTexts.ts). The service looks for these
// names in the user's and the project's skill folders and in OpenCode's plugin cache
// (src/service/skills.ts); Settings shows, per set, which were found.

/** Matt Pocock's skills (github.com/mattpocock/skills), with the ones they load themselves (grilling, domain-modeling). */
export const MATT_SKILLS = [
  'grill-with-docs',
  'grilling',
  'domain-modeling',
  'to-spec',
  'to-tickets',
  'prototype',
  'implement',
  'implement-spec',
  'tdd',
  'code-review',
  'diagnosing-bugs',
  'triage',
] as const;

/** The Superpowers skills (the `superpowers` OpenCode plugin) the Superpowers set names. */
export const SUPERPOWERS_SKILLS = [
  'brainstorming',
  'writing-plans',
  'test-driven-development',
  'verification-before-completion',
  'requesting-code-review',
  'subagent-driven-development',
  'systematic-debugging',
] as const;

/** Every name the service looks for: Matt's, then Superpowers'. */
export const KNOWN_SKILLS: readonly string[] = [...MATT_SKILLS, ...SUPERPOWERS_SKILLS];

export type MattSkill = (typeof MATT_SKILLS)[number];
