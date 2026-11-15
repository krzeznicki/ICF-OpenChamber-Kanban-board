// The first message an agent gets when a card starts. Pure: no DOM, no host, so it runs under node:test.
// Order: the task (title, id, link), its full body, how to move it (tracker and task-board CLI line),
// for a parent its sub-tasks, then the preset's instructions. The whole text stays within the
// host's attach text limit; a long body is cut and the agent is told how to read the rest.
import { GUEST_ATTACH_TEXT_MAX } from '@openchamber/sdk';
import type { Task } from '../core/types.ts';
import type { Preset } from './presets.ts';

export const PROMPT_MAX = GUEST_ATTACH_TEXT_MAX;

const STATES = 'needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix, done';

/** A shell word: kept bare when it is plainly safe, else single-quoted (a GitHub id starts with #). */
export const shellWord = (s: string): string => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

const isGithub = (task: Task): boolean => task.url !== null || /^#\d+$/.test(task.id);

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
  const instructions = preset.text.trim() === '' ? '' : `## Instructions (${preset.name})\n${preset.text.trim()}`;

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
