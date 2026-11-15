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

export const buildPrompt = (task: Task, preset: Preset, cliPath: string, children: Task[]): string => {
  const cli = `node ${shellWord(cliPath)}`;
  const id = shellWord(task.id);
  const head = [`# Task: ${task.title}`, `Id: ${task.id}`, ...(task.url !== null ? [`URL: ${task.url}`] : [])].join('\n');
  const tracker = [
    '## Tracker',
    isGithub(task)
      ? 'This task is a GitHub issue of this repository.'
      : 'This task is a local issue file under .scratch/ in this repository.',
    `Move it with the task-board CLI: ${cli} state ${id} <state>`,
    `States: ${STATES}. Set "done" only when the work is finished.`,
  ].join('\n');
  const kids =
    children.length === 0
      ? ''
      : [
          '## Sub-tasks',
          ...children.map((c) => `- ${c.id}: ${c.title} (${c.state})`),
          '',
          'Work until every sub-task is done; move each sub-task with the CLI as you go.',
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
