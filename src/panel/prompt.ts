// The first message an agent gets when a card starts. Pure: no DOM, no host, so it runs under node:test.
// Order: the task (title, id, link), its full body, how to move it (tracker and task-board CLI line),
// for a parent its sub-tasks, then the preset's instructions (placeholders filled, then the SKILL.md
// paths of the skills a skills text uses). The whole text stays within the
// host's attach text limit; a long body is cut and the agent is told how to read the rest.
import { GUEST_ATTACH_TEXT_MAX } from '@openchamber/sdk';
import { TASK_STATES, type Task } from '../core/types.ts';
import type { Preset } from './presets.ts';

export const PROMPT_MAX = GUEST_ATTACH_TEXT_MAX;

const STATES = TASK_STATES.join(', ');

/** A shell word: kept bare when it is plainly safe, else single-quoted (a GitHub id starts with #). */
export const shellWord = (s: string): string => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

const isGithub = (task: Task): boolean => task.url !== null || /^#\d+$/.test(task.id);

/** The project root without a trailing slash ("/" stays "/"). */
const rootOf = (projectDir: string): string => projectDir.replace(/\/+$/, '') || '/';
const under = (projectDir: string, rel: string): string => `${rootOf(projectDir).replace(/\/$/, '')}/${rel}`;

/** How to put a note on the task: at the root's issue file (never a worktree copy), or a GitHub comment. */
const noteHow = (task: Task, projectDir: string): string => {
  const n = /^#(\d+)$/.exec(task.id)?.[1] ?? /\/issues\/(\d+)/.exec(task.url ?? '')?.[1];
  if (isGithub(task) && n !== undefined) return `post it with \`gh issue comment ${n} --body-file -\``;
  return `append it to the issue file \`${shellWord(under(projectDir, task.id))}\``;
};

/**
 * A preset text with its placeholders filled: {cli} (the task-board command with --dir), {root}
 * (the project root), {tracker} (the root's docs/agents/issue-tracker.md), {id} (this task) and
 * {note} (how to add a note to this task). Every path and id is one shell word (shellWord), so a
 * root with a space or a quote survives being pasted into a command.
 */
export const fillPreset = (text: string, task: Task, cli: string, projectDir: string): string =>
  text.replace(/\{(cli|root|tracker|id|note)\}/g, (_, key: string) => {
    if (key === 'cli') return cli;
    if (key === 'root') return shellWord(rootOf(projectDir));
    if (key === 'tracker') return shellWord(under(projectDir, 'docs/agents/issue-tracker.md'));
    if (key === 'id') return shellWord(task.id);
    return noteHow(task, projectDir);
  });

/**
 * `projectDir` is the project root (the main checkout). Every CLI line passes it with --dir: the
 * agent usually runs in its own worktree, where the tracker config is missing (GitHub) or the
 * `.scratch/` files are a copy the board never reads (local).
 */
export const buildPrompt = (task: Task, preset: Preset, cliPath: string, projectDir: string, children: Task[]): string => {
  const cli = `node ${shellWord(cliPath)} --dir ${shellWord(projectDir)}`;
  const id = shellWord(task.id);
  const leads = children.length > 0 || task.kind === 'parent';
  const head = [`# Task: ${task.title}`, `Id: ${task.id}`, ...(task.url !== null ? [`URL: ${task.url}`] : [])].join('\n');
  const tracker = [
    '## Tracker',
    isGithub(task)
      ? 'This task is a GitHub issue of this repository.'
      : 'This task is a local issue file under .scratch/ in this repository.',
    `Move it with the task-board CLI: ${cli} state ${id} <state>`,
    'Always pass --dir exactly as shown (the project root), even in a worktree: without it the CLI misses the tracker or writes to a copy the board never reads.',
    `States: ${STATES}. Set "done" only when the work is finished.`,
    ...(leads ? [] : ["This task was started from the board; you don't need to claim it."]),
  ].join('\n');
  const kids = !leads
    ? ''
    : [
        '## Sub-tasks',
        ...(children.length === 0
          ? ['No sub-tasks yet.']
          : children.map((c) => `- ${c.id}: ${c.title} (${c.state})`)),
        '',
        'Work until every sub-task is done; move each sub-task with the CLI as you go.',
        `Create missing sub-tasks ready for work: ${cli} create --title <title> --parent ${id} --state ready-for-agent`,
        `Before working on a sub-task, claim it (the board then shows it In Progress): ${cli} claim <sub-task id>`,
        'claim needs ready-for-agent: move a sub-task to ready-for-agent first if needed.',
        `When a sub-task is finished, move it: ${cli} state <sub-task id> done`,
      ].join('\n');
  const files = preset.skillFiles ?? [];
  const skillFiles =
    files.length === 0 ? '' : `\n\nSkill files, for a skill your skill tool cannot load:\n${files.map((f) => `- ${f.name}: ${f.path}`).join('\n')}`;
  const instructions =
    preset.text.trim() === '' ? '' : `## Instructions (${preset.name})\n${fillPreset(preset.text.trim(), task, cli, projectDir)}${skillFiles}`;

  const body = task.body.trim() === '' ? 'No description.' : task.body.trim();
  const compose = (b: string): string => [head, b, tracker, kids, instructions].filter((part) => part !== '').join('\n\n');

  const full = compose(body);
  if (full.length <= PROMPT_MAX) return full;

  const note = `[…] The description is cut here; read the full task with the CLI: ${cli} show ${id}`;
  const room = PROMPT_MAX - compose(`\n\n${note}`).length;
  const cut = room > 0 ? `${body.slice(0, room).trimEnd()}\n\n${note}` : note;
  // Huge sub-task lists or preset texts could still overflow; the end is then cut too.
  return compose(cut).slice(0, PROMPT_MAX);
};
