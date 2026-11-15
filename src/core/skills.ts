// Matt Pocock's skills (github.com/mattpocock/skills) that the built-in presets can drive. The
// service looks for these names in the user's and the project's skill folders; a preset switches to
// its skills text only when every skill it names is found (src/panel/presets.ts).
export const MATT_SKILLS = [
  'grill-with-docs',
  'to-spec',
  'to-tickets',
  'prototype',
  'handoff',
  'implement',
  'implement-spec',
  'tdd',
  'code-review',
  'diagnosing-bugs',
  'triage',
] as const;

export type MattSkill = (typeof MATT_SKILLS)[number];
