// Project config in Matt Pocock's format: `docs/agents/issue-tracker.md` picks the primary source
// (its first heading, Matt's template) and may end with a `## Additional sources` section listing the
// project's other sources (ADR 0001); `docs/agents/triage-labels.md` maps the triage roles to the
// label strings used in the repo.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TEMPLATES } from './templates/index.ts';
import { isSourceId, SOURCE_IDS, type SourceId, type TaskState, TrackerError, unknownSource } from './types.ts';

export { isSourceId, SOURCE_IDS, type SourceId };
export type LabelRole = Exclude<TaskState, 'done'>;
export type ProjectConfig = {
  /** Where a new task goes when nobody names a source. */
  primary: SourceId;
  /** Every source of the project, the primary first; one entry when there is no Additional sources section. */
  sources: SourceId[];
  labels: Record<LabelRole, string>;
  /** Problems that do not stop the board, such as an unknown source under Additional sources (skipped). */
  warnings: string[];
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
/**
 * A source line: a list item that starts with a backticked id (`` - `github`: ... ``) or is only an
 * id (`- github`). Any other item (`- Ask Ola before closing`) is a hand-written note.
 */
const SOURCE_ITEM = /^\s*[-*+]\s+(?:`([A-Za-z][\w.-]*)`(?=[\s:.,;]|$)|([A-Za-z][\w.-]*)\s*$)/;

/** The id a source line names (lower case), or null for any other line. */
const sourceItem = (line: string): string | null => {
  const m = SOURCE_ITEM.exec(line);
  return m === null ? null : (m[1] ?? m[2]!).toLowerCase();
};

/** The Additional sources section's line range in `lines` (end exclusive), or null. */
const additionalRange = (lines: string[]): { start: number; end: number } | null => {
  const start = lines.findIndex((l) => ADDITIONAL_HEADING.test(l));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !SECTION_END.test(lines[end]!)) end++;
  return { start, end };
};

/** The message for a source line naming a source ICF-kanban does not know; that line is skipped. */
const unknownSourceWarning = (id: string): string =>
  `Unknown source "${id}" under ## ${ADDITIONAL} in ${ISSUE_TRACKER} is skipped: ICF-kanban supports ${SOURCE_IDS.join(' and ')}`;

/**
 * The ids listed (one source line each) in the Additional sources section, and a warning per
 * source line naming an unknown source. Other lines are notes and are ignored.
 */
const additionalSources = (text: string): { ids: SourceId[]; warnings: string[] } => {
  const lines = text.split(/\r?\n/);
  const range = additionalRange(lines);
  const ids: SourceId[] = [];
  const warnings: string[] = [];
  if (range === null) return { ids, warnings };
  for (const line of lines.slice(range.start + 1, range.end)) {
    const id = sourceItem(line);
    if (id === null) continue;
    if (!isSourceId(id)) warnings.push(unknownSourceWarning(id));
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, warnings };
};

/** What each source is, for agents; its line in the Additional sources section. */
const SOURCE_TEXT: Record<SourceId, string> = {
  local: 'markdown files under `.scratch/` in this repository (private: they stay with the repository checkout; ids look like `.scratch/<feature>/spec.md`)',
  github: "this repository's GitHub Issues (shared with the team; ids look like `#42`)",
};

/**
 * The Additional sources section for `ids`, as written to issue-tracker.md: the agent instructions
 * for publishing in each source and the rules that tie tasks to one source (ADR 0001). Settings and
 * the CLI both write it through withAdditionalSources, so this is the one place the text lives.
 */
export const additionalSourcesSection = (ids: readonly SourceId[]): string =>
  [
    `## ${ADDITIONAL}`,
    '',
    'The Kanban board also shows tasks from the sources below. Everything above describes the primary source: a new task goes there unless you name another source.',
    '',
    ...ids.map((id) => `- \`${id}\`: ${SOURCE_TEXT[id]}. Publish there with \`task-board create --source ${id} --title <title> ...\`.`),
    '',
    "A sub-task (`task-board create --parent <id>`) always goes to its parent's source; naming another source is refused. Tasks of different sources are never linked: no parent or blocker across sources.",
    'Every other command (`show`, `state`, `edit`, `claim`, `parent`, `close`, `delete`) works on an id from any source. `list` and `next` read every source and name each task\'s source; `--source <id>` reads only that one.',
    '',
  ].join('\n');

/** Every line additionalSourcesSection writes besides the source lines (to tell them from hand-written ones). */
const GENERATED = new Set(
  additionalSourcesSection(SOURCE_IDS)
    .split('\n')
    .filter((l) => l.trim() !== '' && sourceItem(l) === null),
);

/**
 * issue-tracker.md split around its Additional sources section: the text before and after it, and
 * the section's hand-written lines (notes, unknown sources): everything but the lines
 * additionalSourcesSection writes and the known sources' lines.
 */
const splitAdditional = (text: string): { before: string; after: string; notes: string } => {
  const lines = text.split('\n');
  const range = additionalRange(lines);
  if (range === null) return { before: text, after: '', notes: '' };
  const kept = lines.slice(range.start + 1, range.end).filter((l) => {
    const id = sourceItem(l);
    return !GENERATED.has(l) && (id === null || !isSourceId(id));
  });
  return {
    before: lines.slice(0, range.start).join('\n'),
    after: lines.slice(range.end).join('\n'),
    notes: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
};

/** `head`, `after` and an Additional sources section for `ids` plus the hand-written `notes`, at the end. */
const assemble = (head: string, after: string, ids: readonly SourceId[], notes: string): string => {
  let out = `${head.replace(/\s+$/, '')}\n`;
  const rest = after.replace(/\s+$/, '');
  if (rest.trim() !== '') out += `\n${rest.replace(/^\n+/, '')}\n`;
  if (ids.length > 0) out += `\n${additionalSourcesSection(ids)}`;
  else if (notes !== '') out += `\n## ${ADDITIONAL}\n`;
  if (notes !== '') out += `\n${notes}\n`;
  return out;
};

/**
 * `text` (issue-tracker.md) with its Additional sources section replaced by one for `ids`, at the
 * end of the file; `[]` removes the section. Other sections, also ones after it, are kept, and so
 * are hand-written lines inside the section (notes, a source ICF-kanban does not know): with `[]`
 * the section then stays with only those.
 */
export const withAdditionalSources = (text: string, ids: readonly SourceId[]): string => {
  const { before, after, notes } = splitAdditional(text);
  return assemble(before, after, ids, notes);
};

const detect = (text: string): SourceId => {
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
  const additional = additionalSources(tracker);
  const sources = [primary, ...additional.ids.filter((id) => id !== primary)];
  return { primary, sources, labels: await readLabels(root), warnings: additional.warnings };
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
export const writeConfig = async (root: string, tracker: SourceId): Promise<void> => {
  if (tracker !== 'local' && tracker !== 'github') {
    throw new TrackerError('INVALID', `Unknown tracker "${String(tracker)}": use local or github`);
  }
  await mkdir(join(root, DIR), { recursive: true });
  await writeNew(join(root, ISSUE_TRACKER), tracker === 'local' ? TEMPLATES.local : TEMPLATES.github);
  // triage-labels.md is not written: the spec writes it only when the user keeps the triage skill.
};

/** One change of the project's sources: Settings → Sources and `task-board init --add/--remove/--primary`. */
export type SourceChange = { add: SourceId } | { remove: SourceId } | { primary: SourceId };

/**
 * A primary change would drop a primary template that was edited by hand (the file does not start
 * with Matt's template for it). The caller asks the user and retries with `force`.
 */
export class EditedTemplateError extends TrackerError {
  /** The primary source whose edited template would be replaced. */
  public primary: SourceId;

  constructor(primary: SourceId) {
    super(
      'INVALID',
      `The ${primary} template in ${ISSUE_TRACKER} was edited by hand; changing the primary source replaces that template (its own sections) with the new one, and the edits in it are lost. The sections added after it are kept, and so is ## ${ADDITIONAL}. Run it again with force (--force) to go ahead.`,
    );
    this.name = 'EditedTemplateError';
    this.primary = primary;
  }
}

const sourceOf = (change: SourceChange): SourceId => ('add' in change ? change.add : 'remove' in change ? change.remove : change.primary);

/**
 * The issue-tracker.md text after `change`. Adding or removing rewrites only the Additional sources
 * section. A new primary source swaps the template: text after the old template (sections added by
 * hand) is kept; a template edited by hand is replaced only with `force`, else EditedTemplateError.
 */
const changedText = (text: string, config: ProjectConfig, change: SourceChange, force: boolean): string => {
  const others = config.sources.filter((id) => id !== config.primary);
  if ('add' in change) return withAdditionalSources(text, others.includes(change.add) || change.add === config.primary ? others : [...others, change.add]);
  if ('remove' in change) {
    if (change.remove === config.primary) {
      throw new TrackerError('INVALID', `${change.remove} is the primary source; make another source primary before removing it`);
    }
    return withAdditionalSources(text, others.filter((id) => id !== change.remove));
  }
  const primary = change.primary;
  if (primary === config.primary) return text;
  const rest = [config.primary, ...others].filter((id) => id !== primary);
  const { before, after, notes } = splitAdditional(text);
  const base = assemble(before, after, [], '');
  const old = TEMPLATES[config.primary];
  if (!base.startsWith(old) && !force) throw new EditedTemplateError(config.primary);
  const kept = base.startsWith(old) ? base.slice(old.length) : `\n${base.slice(templateEnd(base, old))}`;
  return assemble(`${TEMPLATES[primary]}${kept}`, '', rest, notes);
};

/** Level 1-2 heading lines of a markdown text, as their titles. */
const sectionTitles = (text: string): Set<string> =>
  new Set(text.split('\n').flatMap((l) => (SECTION_END.test(l) ? [HEADING.exec(l)?.[1] ?? l] : [])));

/**
 * Where a hand-edited copy of `template` ends in `text`: at the first level 1-2 heading the template
 * does not have (a section added after it), else at the end.
 */
const templateEnd = (text: string, template: string): number => {
  const own = sectionTitles(template);
  let at = 0;
  for (const line of text.split('\n')) {
    if (at > 0 && SECTION_END.test(line) && !own.has(HEADING.exec(line)?.[1] ?? line)) return at;
    at += line.length + 1;
  }
  return text.length;
};

/**
 * Applies `change` to `root`'s issue-tracker.md and answers the new config. Removing a source deletes
 * nothing: its files or issues stay, the board only stops showing them.
 */
export const changeSources = async (root: string, change: SourceChange, opts: { force?: boolean } = {}): Promise<ProjectConfig> => {
  const id = sourceOf(change);
  if (!isSourceId(id)) throw unknownSource(String(id));
  const config = await readConfig(root);
  const path = join(root, ISSUE_TRACKER);
  const text = await readFile(path, 'utf8');
  const next = changedText(text, config, change, opts.force === true);
  if (next !== text) await writeFile(path, next);
  return readConfig(root);
};
