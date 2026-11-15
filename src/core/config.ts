// Project config in Matt Pocock's format: `docs/agents/issue-tracker.md` picks the tracker,
// `docs/agents/triage-labels.md` maps the triage roles to the label strings used in the repo.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TEMPLATES } from './templates/index.ts';
import type { TaskState } from './types.ts';
import { TrackerError } from './types.ts';

export type TrackerKind = 'local' | 'github';
export type LabelRole = Exclude<TaskState, 'done'>;
export type ProjectConfig = { tracker: TrackerKind; labels: Record<LabelRole, string> };

const DIR = 'docs/agents';
const ISSUE_TRACKER = `${DIR}/issue-tracker.md`;
const TRIAGE_LABELS = `${DIR}/triage-labels.md`;
const ROLES: readonly LabelRole[] = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix'];
const HEADING = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

const isNotFound = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'ENOENT';

const readOptional = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
};

const firstHeading = (text: string): string | null => {
  for (const line of text.split(/\r?\n/)) {
    const m = HEADING.exec(line);
    if (m) return m[1]!;
  }
  return null;
};

const detect = (text: string): TrackerKind => {
  const heading = firstHeading(text);
  if (heading === null) {
    throw new TrackerError('UNSUPPORTED', `${ISSUE_TRACKER} has no heading naming the tracker`);
  }
  if (/local markdown/i.test(heading)) return 'local';
  if (/github/i.test(heading)) return 'github';
  throw new TrackerError(
    'UNSUPPORTED',
    `Unsupported issue tracker "${heading}" in ${ISSUE_TRACKER}: ICF-kanban supports Local Markdown and GitHub`,
  );
};

const cell = (s: string): string => s.trim().replace(/^`+|`+$/g, '').trim();

/** Rows of any markdown table: first cell is the role, second the label. Unknown roles are ignored. */
export const parseLabels = (text: string | null): Record<LabelRole, string> => {
  const labels = Object.fromEntries(ROLES.map((r) => [r, r])) as Record<LabelRole, string>;
  if (text === null) return labels;
  for (const line of text.split(/\r?\n/)) {
    const row = line.trim();
    if (!row.startsWith('|')) continue;
    const cells = row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell);
    if (cells.length < 2) continue;
    const role = cells[0] as LabelRole;
    const label = cells[1]!;
    if (ROLES.includes(role) && label !== '') labels[role] = label;
  }
  return labels;
};

/** The label strings of `root`: triage-labels.md when present, else the role names. */
export const readLabels = async (root: string): Promise<Record<LabelRole, string>> =>
  parseLabels(await readOptional(join(root, TRIAGE_LABELS)));

export const readConfig = async (root: string): Promise<ProjectConfig> => {
  const tracker = await readOptional(join(root, ISSUE_TRACKER));
  if (tracker === null) {
    throw new TrackerError('NOT_CONFIGURED', `No ${ISSUE_TRACKER}: choose a tracker (Local Markdown or GitHub) first`);
  }
  return { tracker: detect(tracker), labels: await readLabels(root) };
};

/** Writes `path` only when it does not exist yet. */
const writeNew = async (path: string, text: string): Promise<void> => {
  try {
    await writeFile(path, text, { flag: 'wx' });
  } catch (e) {
    if ((e as { code?: unknown }).code !== 'EEXIST') throw e;
  }
};

/** Seeds Matt's issue-tracker template for `tracker`; an existing file is never overwritten. */
export const writeConfig = async (root: string, tracker: TrackerKind): Promise<void> => {
  if (tracker !== 'local' && tracker !== 'github') {
    throw new TrackerError('INVALID', `Unknown tracker "${String(tracker)}": use local or github`);
  }
  await mkdir(join(root, DIR), { recursive: true });
  await writeNew(join(root, ISSUE_TRACKER), tracker === 'local' ? TEMPLATES.local : TEMPLATES.github);
  // triage-labels.md is not written: the spec writes it only when the user keeps the triage skill.
};
