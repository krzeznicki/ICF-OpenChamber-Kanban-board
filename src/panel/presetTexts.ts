// The texts of the three built-in preset sets (presets.ts holds the sets and their editing).
// Plain: instructions without any skill set (0.2's plain texts). Matt: the same steps run with Matt
// Pocock's skills (0.2's skills texts). Superpowers: the same steps run with the Superpowers skills.
// Every preset keeps its id across the sets, so presetByType and card choices work in any of them.
// A text may use {cli}, {root}, {tracker}, {id} and {note}; buildPrompt fills them in (prompt.ts).
// `skills` (named in the text) and `requires` (loaded by those skills themselves) say what a set
// needs installed; listPresets adds each one's SKILL.md for the prompt.
import type { Preset } from './presets.ts';

/**
 * Closes every Matt text. The session usually runs in a fresh worktree, where docs/agents/ and
 * .scratch/ are missing or a copy the board never reads, so the skills are pointed at the root and
 * every tracker write goes through the task-board CLI ({cli} carries --dir).
 */
const MATT_NOTE = [
  'About the skills: load each skill named here with your skill tool; if it cannot be loaded, read its SKILL.md (listed below) and follow it.',
  'The tracker lives at the project root {root}, not in your worktree, where docs/agents/ and .scratch/ are missing or a copy the board never reads. When a skill asks for the issue tracker, it is {tracker}; never run /setup-matt-pocock-skills.',
  "Matt's skills and the task-board CLI write the same format, so make every tracker write through the CLI at the root instead of the skills' own publishing: new issues with `{cli} create`, states with `{cli} state` (and `{cli} claim` for sub-tasks). For a note on this task, {note}. The board then follows.",
].join('\n');

/**
 * Closes every Superpowers text: a worktree the board made is used as is (on main/master the skill's
 * ask-first rule applies), what
 * happens to the branch is the user's call, and tracker writes go through the CLI at the root.
 */
const SUPERPOWERS_NOTE = [
  'About the skills: these are Superpowers skills. Load each one named here with your skill tool (it may list them as superpowers:<name>); if it cannot be loaded, read its SKILL.md (listed below) and follow it.',
  "If the board made a worktree for this session, work in it and do not create another (skip using-git-worktrees); if you are on main/master, follow the skill's rule and ask before building there. Do not run finishing-a-development-branch, and do not merge, push or open a pull request: what happens to the branch is the user's call. Never run a setup skill.",
  'The tracker lives at the project root {root}, not in your worktree, where docs/agents/ and .scratch/ are missing or a copy the board never reads; {tracker} describes it. Make every tracker write through the task-board CLI at the root: new tasks with `{cli} create`, states with `{cli} state` (and `{cli} claim` for sub-tasks). For a note on this task, {note}. The board then follows.',
].join('\n');

const withMattSkills = (lines: string[]): string => [...lines, MATT_NOTE].join('\n');
const withSuperpowers = (lines: string[]): string => [...lines, SUPERPOWERS_NOTE].join('\n');

/** Plain instructions, no skill set: 0.2's built-in texts. */
export const PLAIN_PRESETS: readonly Preset[] = [
  {
    id: 'plan',
    name: 'Plan',
    builtin: true,
    text: [
      'Plan this task before changing any code.',
      '- Read the task and the code it touches.',
      '- Write a short plan: the steps, the files to change, how you will test it, and the open questions.',
      '- Ask the user to approve the plan and answer the questions. Do not write code until they do.',
    ].join('\n'),
  },
  {
    id: 'prototype',
    name: 'Prototype',
    builtin: true,
    text: [
      'Build a quick, throwaway prototype that answers the question in this task.',
      '- Keep it small and apart from production code.',
      '- Skip polish, tests and edge cases unless the question is about them.',
      '- Finish with the answer, what the prototype shows, and what a real implementation would need.',
    ].join('\n'),
  },
  {
    id: 'implement',
    name: 'Implement',
    builtin: true,
    text: [
      'Implement this task.',
      '- Read the task and the code it touches first.',
      '- Write or update tests with the change and run them until they pass.',
      '- Keep the change focused on the task; note anything else you find instead of fixing it.',
      '- When a decision is unclear, ask the user before going on.',
      '- Finish with a short summary of what changed and how you tested it.',
    ].join('\n'),
  },
  {
    id: 'implement-no-questions',
    name: 'Implement without questions',
    builtin: true,
    text: [
      'Implement this task without stopping to ask questions.',
      '- Read the task and the code it touches first.',
      '- Write or update tests with the change and run them until they pass.',
      '- When a decision is unclear, choose the simplest reasonable option and go on.',
      '- Finish with a short summary of what changed, how you tested it, and every assumption you made.',
    ].join('\n'),
  },
  {
    id: 'orchestrate',
    name: 'Break down and orchestrate',
    builtin: true,
    text: [
      'Break this task down and orchestrate the work.',
      '- If it has no sub-tasks yet, split it into small tickets and create them with the task-board CLI, with `--parent <this task id> --state ready-for-agent`.',
      '- Claim each ticket before work starts on it; claim needs ready-for-agent, so move a sub-task to ready-for-agent first if needed.',
      '- Hand each ticket to a subagent; start a ticket only when the tickets blocking it are done.',
      '- Move each ticket with the task-board CLI as it starts and finishes.',
      '- Keep working until all sub-tasks are done, then summarise the result.',
    ].join('\n'),
  },
  {
    id: 'diagnose',
    name: 'Diagnose',
    builtin: true,
    text: [
      'Diagnose this bug, then fix it.',
      '- Reproduce it first: a test or command that fails on this bug.',
      '- Find the cause before changing code; check one guess at a time.',
      '- Fix it with a regression test, and run the tests until they pass.',
      '- Finish with the cause, the fix and how you checked it.',
    ].join('\n'),
  },
  {
    id: 'triage',
    name: 'Triage',
    builtin: true,
    text: [
      'Triage this task; do not implement it.',
      '- Read it and the code it touches; check whether it is already done, a duplicate, or was rejected before.',
      '- For a bug, try to reproduce it.',
      '- Decide its state: ready-for-agent with a short brief (what to build, how to check it), needs-info with specific questions, ready-for-human with the reason, or wontfix with the reason.',
      '- Write the brief, questions or reason on the task, and set the state with the task-board CLI.',
    ].join('\n'),
  },
];

/** Matt Pocock's skills: 0.2's skills texts. */
export const MATT_PRESETS: readonly Preset[] = [
  {
    id: 'plan',
    name: 'Plan',
    builtin: true,
    text: withMattSkills([
      "Plan this task with Matt Pocock's skills before changing any code.",
      '- Run /grill-with-docs to sharpen the task with the user, a round of questions at a time; it keeps the terms in GLOSSARY.md and the decisions as ADRs.',
      '- If a question needs a runnable answer, do not build it here: suggest a Prototype task for it.',
      "- If this is a multi-session build, stay in this context: write the spec with /to-spec and draft the tickets with /to-tickets (its review with the user included), but publish them with the CLI: the spec as a feature with `{cli} create --title <title> --state ready-for-agent --body-file -`, then each ticket in dependency order with `{cli} create --title <title> --parent <feature id> --blocked-by <ticket ids> --state ready-for-agent --body-file -` (leave out --blocked-by when it has none).",
      '- Then record the feature id on this task: {note}. If the feature fully replaces this task, close it with `{cli} state {id} done`; otherwise leave its state and keep the link.',
      '- Otherwise finish with the sharpened plan and ask the user to approve it. Do not write code.',
    ]),
    skills: ['grill-with-docs', 'to-spec', 'to-tickets'],
    requires: ['grilling', 'domain-modeling'],
  },
  {
    id: 'prototype',
    name: 'Prototype',
    builtin: true,
    text: withMattSkills([
      "Answer this task's design question with Matt Pocock's skills.",
      '- In your session\'s worktree, create a `prototype/<name>` branch (`git switch -c prototype/<name>`) and run /prototype there: throwaway code that answers the one question in this task. Commit it on that branch.',
      '- Record the answer on this task (the verdict, the question it settled and the branch): {note}.',
      '- Finish with the answer and what a real implementation would need.',
    ]),
    skills: ['prototype'],
  },
  {
    id: 'implement',
    name: 'Implement',
    builtin: true,
    text: withMattSkills([
      "Implement this task with Matt Pocock's skills.",
      '- Run /implement with this task as its ticket (`{cli} show {id}` reads it). It drives /tdd (agree the seams, then one red-green slice at a time) and closes with /code-review of your diff against the branch you started from.',
      '- When a decision is unclear, ask the user before going on.',
      '- Finish with a short summary of what changed and how you tested it.',
    ]),
    skills: ['implement', 'tdd', 'code-review'],
  },
  {
    id: 'implement-no-questions',
    name: 'Implement without questions',
    builtin: true,
    text: withMattSkills([
      "Implement this task with Matt Pocock's skills, without stopping to ask questions.",
      '- Run /implement with this task as its ticket (`{cli} show {id}` reads it); it drives /tdd and closes with /code-review.',
      '- Where a skill would ask the user (the seams for /tdd, the fixed point for /code-review, an unclear decision), decide yourself: choose the simplest reasonable option and go on.',
      '- Finish with a short summary of what changed, how you tested it, and every assumption you made.',
    ]),
    skills: ['implement', 'tdd', 'code-review'],
  },
  {
    id: 'orchestrate',
    name: 'Break down and orchestrate',
    builtin: true,
    text: withMattSkills([
      "Break this task down and orchestrate the work with Matt Pocock's skills.",
      '- If it has no sub-tasks yet, draft tracer-bullet tickets with /to-tickets, then publish them with the CLI in dependency order: `{cli} create --title <title> --parent {id} --blocked-by <ticket ids> --state ready-for-agent --body-file -` (leave out --blocked-by when it has none).',
      '- Then run /implement-spec over the sub-tasks: it reads them as a task graph, runs implementer subagents (each driving /tdd) across the ready frontier on one integration branch, and ends with one /code-review. Give each implementer the CLI line with its --dir.',
      '- Claim each sub-task with `{cli} claim <id>` as its implementer starts, and resolve it with `{cli} state <id> done` once merged.',
      '- Keep working until all sub-tasks are done, then summarise the result and name the integration branch.',
    ]),
    skills: ['to-tickets', 'implement-spec', 'tdd', 'code-review'],
  },
  {
    id: 'diagnose',
    name: 'Diagnose',
    builtin: true,
    text: withMattSkills([
      "Diagnose and fix this bug with Matt Pocock's skills.",
      '- Run /diagnosing-bugs: build a tight feedback loop that goes red on this bug before any theory, reproduce and minimise, rank hypotheses, instrument.',
      '- Once the cause is found, make the fix through /implement: the minimised repro is the first /tdd slice, as a regression test, and it closes with /code-review. If no correct seam exists for that test, that is itself the finding: say so rather than write a shallow test.',
      '- Before calling it done: re-run the original loop, remove every [DEBUG-…] log, and delete throwaway prototypes (or move them to a clearly marked debug location).',
      '- Finish with the cause (the hypothesis that held), the fix, and the command that went red before and green after.',
    ]),
    skills: ['diagnosing-bugs', 'implement', 'tdd', 'code-review'],
  },
  {
    id: 'triage',
    name: 'Triage',
    builtin: true,
    text: withMattSkills([
      "Triage this task with Matt Pocock's skills; it arrived raw and nobody has evaluated it yet.",
      '- Run /triage on this task: gather context, check it is not already implemented or rejected, recommend a category and state, verify the claim (reproduce a bug), and grill it into shape if needed.',
      '- Write the outcome as /triage says (an agent brief, triage notes, or the reason for ready-for-human or wontfix, each starting with its AI disclaimer): {note}.',
      '- Then set the state with `{cli} state {id} <state>`, wontfix included. Do not change labels or close the issue yourself.',
      '- Do not implement it.',
    ]),
    skills: ['triage'],
    requires: ['grilling', 'domain-modeling'],
  },
];

const SP_IMPLEMENT = ['test-driven-development', 'verification-before-completion', 'requesting-code-review'];
const plainTriage = PLAIN_PRESETS.find((p) => p.id === 'triage') as Preset;

/** The Superpowers skills (read each SKILL.md before changing a text). Triage has no skill: the plain text. */
export const SUPERPOWERS_PRESETS: readonly Preset[] = [
  {
    id: 'plan',
    name: 'Plan',
    builtin: true,
    text: withSuperpowers([
      'Plan this task with the Superpowers skills before changing any code.',
      '- Run brainstorming with this task as the request (`{cli} show {id}` reads it): read the code it touches, ask the user one question at a time, lay out the approaches for them to pick, and get the design doc approved. Commit it where the skill says (docs/superpowers/specs/).',
      '- Then run writing-plans on the approved design and commit the plan (docs/superpowers/plans/). Stop at its execution handoff: do not implement the plan in this session.',
      '- Publish the plan to the tracker, so a session in any worktree can run it: the design as a feature with `{cli} create --title <title> --state ready-for-agent --body-file -`, then each plan task in order with `{cli} create --title <task title> --parent <feature id> --blocked-by <ticket ids> --state ready-for-agent --body-file -`, its full text from the plan as the body (leave out --blocked-by when it has none).',
      '- Then record the feature id, the design doc and the plan on this task: {note}. If the feature fully replaces this task, close it with `{cli} state {id} done`; otherwise leave its state and keep the link.',
      '- Finish by telling the user the feature is ready for Break down and orchestrate. Do not write code.',
    ]),
    skills: ['brainstorming', 'writing-plans'],
  },
  {
    id: 'prototype',
    name: 'Prototype',
    builtin: true,
    text: withSuperpowers([
      "Answer this task's design question with a throwaway spike.",
      '- Use brainstorming only to pin down the one question the spike must answer (`{cli} show {id}` reads the task): read the code it touches and ask the user one question at a time until the question is sharp. This task already approves the spike, so write no design doc and no plan.',
      "- In your session's worktree, create a `prototype/<name>` branch (`git switch -c prototype/<name>`) and build throwaway code there that answers the question; a throwaway spike skips test-driven-development. Commit it on that branch.",
      '- Record the answer on this task (the verdict, the question it settled and the branch): {note}.',
      '- Finish with the answer and what a real implementation would need.',
    ]),
    skills: ['brainstorming'],
  },
  {
    id: 'implement',
    name: 'Implement',
    builtin: true,
    text: withSuperpowers([
      'Implement this task with the Superpowers skills.',
      '- Read it with `{cli} show {id}`: it is the spec. When something that would change what gets built is unclear, ask the user before going on, one question at a time; this needs no full brainstorming round or design doc.',
      '- Note the commit you start from (`git rev-parse HEAD`), then build it with test-driven-development: for each behaviour write the failing test, watch it fail for the right reason, write the minimal code, watch it pass, refactor. Commit as you go.',
      '- Before calling anything done, follow verification-before-completion: run the full test suite (and the build, if any) fresh and read the result.',
      '- Then run requesting-code-review on your diff from that start commit to HEAD; fix every Critical and Important finding and verify again.',
      '- Finish with a short summary of what changed and how you tested it, with the verification output.',
    ]),
    skills: SP_IMPLEMENT,
  },
  {
    id: 'implement-no-questions',
    name: 'Implement without questions',
    builtin: true,
    text: withSuperpowers([
      'Implement this task with the Superpowers skills, without stopping to ask questions.',
      '- Read it with `{cli} show {id}`: it is the spec. Do not run brainstorming: where something is unclear, choose the simplest reasonable option, note it as an assumption and go on.',
      '- Note the commit you start from (`git rev-parse HEAD`), then build it with test-driven-development: for each behaviour write the failing test, watch it fail for the right reason, write the minimal code, watch it pass, refactor. Commit as you go.',
      '- Before calling anything done, follow verification-before-completion: run the full test suite (and the build, if any) fresh and read the result.',
      '- Then run requesting-code-review on your diff from that start commit to HEAD and act on it yourself: fix every Critical and Important finding, note the Minor ones, and verify again.',
      '- Finish with a short summary of what changed, how you tested it, and every assumption you made.',
    ]),
    skills: SP_IMPLEMENT,
  },
  {
    id: 'orchestrate',
    name: 'Break down and orchestrate',
    builtin: true,
    text: withSuperpowers([
      'Break this task down and orchestrate the work with the Superpowers skills.',
      '- If it has no sub-tasks yet, run writing-plans with this task as the spec (`{cli} show {id}` reads it) and commit the plan, then publish each plan task as a sub-task, in order: `{cli} create --title <task title> --parent {id} --blocked-by <ticket ids> --state ready-for-agent --body-file -`, its full text from the plan as the body (leave out --blocked-by when it has none). Skip the plan\'s question about the execution method: it runs subagent-driven.',
      '- If this worktree has no plan file for these sub-tasks, write one first under docs/superpowers/plans/ from `{cli} show <id>` of each sub-task (one plan task per sub-task, in dependency order), commit it, and use it as the plan.',
      "- Then run subagent-driven-development over the sub-tasks in dependency order (`{cli} show <id>` reads each): a fresh implementer subagent per sub-task, a task review after each, one whole-branch review at the end, all on this worktree's branch. Give each implementer the CLI line with its --dir.",
      '- Claim each sub-task with `{cli} claim <id>` as its implementer starts, and resolve it with `{cli} state <id> done` once its review is clean.',
      '- Keep working until all sub-tasks are done, then summarise the result and name the branch.',
    ]),
    skills: ['writing-plans', 'subagent-driven-development'],
  },
  {
    id: 'diagnose',
    name: 'Diagnose',
    builtin: true,
    text: withSuperpowers([
      'Diagnose and fix this bug with the Superpowers skills.',
      '- Run systematic-debugging (`{cli} show {id}` reads the bug): find the root cause before any fix. Read the errors, reproduce it reliably, check recent changes, trace the bad value back to its source, and test one hypothesis at a time.',
      '- Fix it with test-driven-development: the reproduction becomes a failing regression test first; watch it fail for the right reason, then make one fix at the root cause and watch it pass.',
      '- If three fixes have failed, stop and tell the user: systematic-debugging treats that as a question about the design, not another fix to try.',
      '- Follow verification-before-completion: re-run the original reproduction and the full test suite fresh, and remove any diagnostic logging you added.',
      '- Finish with the root cause, the fix, and the command that failed before and passes now.',
    ]),
    skills: ['systematic-debugging', 'test-driven-development', 'verification-before-completion'],
  },
  plainTriage,
];
