// Matt Pocock's skills (github.com/mattpocock/skills) that the built-in presets can drive, and the
// ones those load themselves (grilling, domain-modeling). The service looks for these names in the
// user's and the project's skill folders; a preset switches to its skills text only when every skill
// it names or requires is found (src/panel/presets.ts).
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

export type MattSkill = (typeof MATT_SKILLS)[number];
