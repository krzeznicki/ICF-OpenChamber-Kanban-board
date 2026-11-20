// Project config in Matt Pocock's format: `docs/agents/issue-tracker.md` picks the primary source
// (its first heading, Matt's template) and may end with a `## Additional sources` section listing the
// project's other sources (ADR 0001); `docs/agents/triage-labels.md` maps the triage roles to the
// label strings used in the repo.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TEMPLATES } from './templates/index.ts';
import type { TaskState } from './types.ts';
import { TrackerError } from './types.ts';

export type TrackerKind = 'local' | 'github';
export type LabelRole = Exclude<TaskState, 'done'>;
/** A Source's id; today the same as its kind. A future source with colliding task ids prefixes them (`jira:ENG-12`). */
export type SourceId = TrackerKind;
export const SOURCE_IDS: readonly SourceId[] = ['local', 'github'];
export type ProjectConfig = {
  /** The primary source's kind; always equal to `primary` (kept for callers that predate several sources). */
  tracker: TrackerKind;
  /** Where a new task goes when nobody names a source. */
  primary: SourceId;
  /** Every source of the project, the primary first; one entry when there is no Additional sources section. */
  sources: SourceId[];
  labels: Record<LabelRole, string>;
};

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

const ADDITIONAL = 'Additional sources';
const ADDITIONAL_HEADING = /^ {0,3}##\s+additional sources\s*#*\s*$/i;
/** A heading that ends the section: level 1 or 2. */
const SECTION_END = /^ {0,3}#{1,2}\s/;
const SOURCE_ITEM = /^\s*[-*+]\s+`?([A-Za-z][\w.-]*)`?/;

/** The Additional sources section's line range in `lines` (end exclusive), or null. */
const additionalRange = (lines: string[]): { start: number; end: number } | null => {
  const start = lines.findIndex((l) => ADDITIONAL_HEADING.test(l));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !SECTION_END.test(lines[end]!)) end++;
  return { start, end };
};

/** The ids listed (one `- \`<id>\`` item each) in the Additional sources section; an unknown id is UNSUPPORTED. */
const additionalSources = (text: string): SourceId[] => {
  const lines = text.split(/\r?\n/);
  const range = additionalRange(lines);
  if (range === null) return [];
  const out: SourceId[] = [];
  for (const line of lines.slice(range.start + 1, range.end)) {
    const m = SOURCE_ITEM.exec(line);
    if (m === null) continue;
    const id = m[1]!.toLowerCase();
    if (!(SOURCE_IDS as readonly string[]).includes(id)) {
      throw new TrackerError(
        'UNSUPPORTED',
        `Unsupported source "${m[1]}" under ## ${ADDITIONAL} in ${ISSUE_TRACKER}: ICF-kanban supports ${SOURCE_IDS.join(' and ')}`,
      );
    }
    if (!out.includes(id as SourceId)) out.push(id as SourceId);
  }
  return out;
};

const SOURCE_TEXT: Record<SourceId, string> = {
  local: 'markdown files under `.scratch/` in this repository (private: they stay with the repository checkout)',
  github: "this repository's GitHub Issues (shared with the team)",
};

/** The Additional sources section for `ids`, as written to issue-tracker.md. */
export const additionalSourcesSection = (ids: readonly SourceId[]): string =>
  [
    `## ${ADDITIONAL}`,
    '',
    'The Kanban board also shows tasks from the sources below. Everything above describes the primary source: a new task goes there unless you name another source.',
    '',
    ...ids.map((id) => `- \`${id}\`: ${SOURCE_TEXT[id]}. Publish there with \`task-board create --source ${id} ...\`.`),
    '',
    "A sub-task always goes to its parent's source. Tasks of different sources are never linked: no parent or blocker across sources.",
    '',
  ].join('\n');

/**
 * `text` (issue-tracker.md) with its Additional sources section replaced by one for `ids`, at the
 * end of the file; `[]` removes the section. Other sections, also ones after it, are kept.
 */
export const withAdditionalSources = (text: string, ids: readonly SourceId[]): string => {
  const lines = text.split('\n');
  const range = additionalRange(lines);
  const before = range === null ? text : lines.slice(0, range.start).join('\n');
  const after = range === null ? '' : lines.slice(range.end).join('\n').replace(/\s+$/, '');
  let out = `${before.replace(/\s+$/, '')}\n`;
  if (after !== '') out += `\n${after}\n`;
  if (ids.length > 0) out += `\n${additionalSourcesSection(ids)}`;
  return out;
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
  const primary = detect(tracker);
  const sources = [primary, ...additionalSources(tracker).filter((id) => id !== primary)];
  return { tracker: primary, primary, sources, labels: await readLabels(root) };
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
