// Pure parser/patcher for one local issue file in Matt Pocock's `.scratch/` format:
// `.scratch/<feature>/spec.md` (parent) and `.scratch/<feature>/issues/NN-slug.md` (tickets),
// with `**Status:**`, `**Blocked by:**` and the optional `**Type:**` line
// (the bare `Status: x` form from issue-tracker-local.md is read and kept too).
import type { NewTask, TaskState } from './types.ts';

export type ParsedIssue = {
  title: string;
  state: TaskState;
  type: string | null;
  blockedBy: number[];
  /** The Status word is `claimed` (state stays ready-for-agent). */
  claimed: boolean;
  /** full markdown as stored */
  body: string;
};

export type Field = 'Status' | 'Type' | 'Blocked by';

const BOLD_FIELD = /^\*\*(Status|Type|Blocked by):\*\*\s*(.*)$/;
const BARE_FIELD = /^(Status|Type|Blocked by):\s*(.*)$/;
const HEADING = /^# (.*)$/;
const NONE_BLOCKERS = 'None (can start immediately)';

type FieldLine = { field: Field; value: string; bare: boolean };

/** Lines split on "\n"; a trailing "\r" (CRLF) stays on each line and is removed only for matching. */
const splitLines = (text: string): string[] => text.split('\n');
const content = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line);

const matchField = (line: string): FieldLine | null => {
  const c = content(line);
  const bold = BOLD_FIELD.exec(c);
  if (bold) return { field: bold[1] as Field, value: bold[2]!.trim(), bare: false };
  const bare = BARE_FIELD.exec(c);
  if (bare) return { field: bare[1] as Field, value: bare[2]!.trim(), bare: true };
  return null;
};

const FENCE = /^\s{0,3}(```|~~~)/;
const SECTION = /^## /;

/**
 * Lines outside fenced code blocks, with their index. With `headerOnly`, stops at the first
 * `## ` heading, so `## Comments` / `## Answer` sections never count as fields.
 */
const plainLines = (lines: string[], headerOnly: boolean): Array<[number, string]> => {
  const out: Array<[number, string]> = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const c = content(lines[i]!);
    const f = FENCE.exec(c);
    if (fence !== null) {
      if (f && f[1] === fence) fence = null;
      continue;
    }
    if (f) {
      fence = f[1]!;
      continue;
    }
    if (headerOnly && SECTION.test(c)) break;
    out.push([i, c]);
  }
  return out;
};

/** Field lines of the header region (before the first `## `, outside fences). */
const headerFields = (lines: string[]): Array<{ index: number } & FieldLine> => {
  const out: Array<{ index: number } & FieldLine> = [];
  for (const [index, c] of plainLines(lines, true)) {
    const m = matchField(c);
    if (m) out.push({ index, ...m });
  }
  return out;
};

const readFields = (text: string): Partial<Record<Field, string>> => {
  const out: Partial<Record<Field, string>> = {};
  for (const m of headerFields(splitLines(text))) {
    if (out[m.field] === undefined) out[m.field] = m.value;
  }
  return out;
};

const headingIndex = (lines: string[]): number => {
  for (const [i, c] of plainLines(lines, false)) if (HEADING.test(c)) return i;
  return -1;
};

const readHeading = (text: string): string | null => {
  const lines = splitLines(text);
  const i = headingIndex(lines);
  return i < 0 ? null : HEADING.exec(content(lines[i]!))![1]!.trim();
};

const toState = (word: string | undefined): TaskState => {
  const w = (word ?? '').trim().toLowerCase();
  switch (w) {
    case 'resolved':
    case 'closed':
    case 'done':
      return 'done';
    case 'claimed':
      return 'ready-for-agent';
    case 'needs-info':
    case 'ready-for-agent':
    case 'ready-for-human':
    case 'wontfix':
    case 'needs-triage':
      return w;
    default:
      return 'needs-triage';
  }
};

const isClaimed = (word: string | undefined): boolean => (word ?? '').trim().toLowerCase() === 'claimed';

const fromState = (state: TaskState): string => (state === 'done' ? 'resolved' : state);

const toType = (value: string | undefined): string | null => {
  const v = (value ?? '').trim().toLowerCase();
  return v === '' ? null : v;
};

const toBlockers = (value: string | undefined): number[] => {
  const v = (value ?? '').trim();
  if (v === '' || /^none\b/i.test(v)) return [];
  return [...v.matchAll(/\d+/g)].map((m) => Number(m[0]));
};

export const parseIssue = (text: string, fileName: string): ParsedIssue => {
  const fields = readFields(text);
  const heading = readHeading(text);
  const title = heading !== null ? heading.replace(/^\d+:\s*/, '') : fileName.replace(/\.md$/i, '');
  return {
    title,
    state: toState(fields.Status),
    type: toType(fields.Type),
    blockedBy: toBlockers(fields['Blocked by']),
    claimed: isClaimed(fields.Status),
    body: text,
  };
};

export const parseSpec = (
  text: string,
  featureSlug: string,
): { title: string; state: TaskState; type: string | null } => {
  const fields = readFields(text);
  return {
    title: readHeading(text) ?? featureSlug,
    state: toState(fields.Status),
    type: toType(fields.Type),
  };
};

/**
 * Sets one field line. An existing line is replaced in place, keeping its form (bold or bare)
 * and its line ending. Only the header region counts (before the first `## `, outside fences).
 *
 * A missing line is inserted as exactly one line, in the form the file's fields already use:
 * directly above the `Status` line when there is one, else directly below the last field line,
 * so it never merges into a prose paragraph. With no field line at all it goes after the title's
 * blank line (or right after the title, or at the top when there is no title).
 */
export const patchLine = (text: string, field: Field, value: string): string => {
  const lines = splitLines(text);
  const fields = headerFields(lines);
  const existing = fields.find((f) => f.field === field);
  if (existing) {
    const cr = lines[existing.index]!.endsWith('\r') ? '\r' : '';
    lines[existing.index] = formatField(field, value, existing.bare) + cr;
    return lines.join('\n');
  }

  const crlf = text.includes('\r\n');
  const newLine = formatField(field, value, fields[0]?.bare ?? false) + (crlf ? '\r' : '');
  let at: number;
  const status = fields.find((f) => f.field === 'Status');
  if (status) {
    at = status.index;
  } else if (fields.length > 0) {
    at = fields[fields.length - 1]!.index + 1;
  } else {
    const titleAt = headingIndex(lines);
    at = 0;
    if (titleAt >= 0) {
      at = titleAt + 1;
      if (at < lines.length && content(lines[at]!).trim() === '') at++;
    }
  }
  lines.splice(at, 0, newLine);
  return lines.join('\n');
};

const formatField = (field: Field, value: string, bare: boolean): string =>
  bare ? `${field}: ${value}` : `**${field}:** ${value}`;

const pad = (n: number): string => String(n).padStart(2, '0');

/** "01", ".scratch/f/issues/01-x.md", "01-x.md" -> "01"; anything else is kept as written. */
const blockerRef = (id: string): string => {
  const base = id.split('/').pop() ?? id;
  const m = /^(\d+)(?:-|\.md$|$)/.exec(base);
  return m ? pad(Number(m[1])) : id;
};

/** The `Blocked by` value for these ticket numbers; none -> "None (can start immediately)". */
export const blockersValue = (numbers: number[]): string =>
  numbers.length > 0 ? numbers.map(pad).join(', ') : NONE_BLOCKERS;

/**
 * Sets the heading to `# NN: <title>` (a ticket moved to another feature gets that feature's next
 * number), keeping its line ending. A file with no heading gets one at the top.
 */
export const renumberIssue = (text: string, n: number, title: string): string => {
  const heading = `# ${pad(n)}: ${title.trim()}`;
  const lines = splitLines(text);
  const i = headingIndex(lines);
  if (i < 0) return text.trim() === '' ? `${heading}\n` : `${heading}${text.includes('\r\n') ? '\r\n\r\n' : '\n\n'}${text}`;
  lines[i] = heading + (lines[i]!.endsWith('\r') ? '\r' : '');
  return lines.join('\n');
};

/**
 * Sets the heading's title, keeping its line ending and (`keepNumber`, tickets) its `NN: ` prefix.
 * A file with no heading gets `# <title>` at the top.
 */
export const setTitle = (text: string, title: string, keepNumber: boolean): string => {
  const lines = splitLines(text);
  const i = headingIndex(lines);
  if (i < 0) return text.trim() === '' ? `# ${title.trim()}\n` : `# ${title.trim()}${text.includes('\r\n') ? '\r\n\r\n' : '\n\n'}${text}`;
  const prefix = keepNumber ? (/^# (\d+:\s*)/.exec(content(lines[i]!))?.[1] ?? '') : '';
  lines[i] = `# ${prefix}${title.trim()}` + (lines[i]!.endsWith('\r') ? '\r' : '');
  return lines.join('\n');
};

/** A first body block that is a list, heading, fence, quote or table is not a leading paragraph. */
const NOT_PARAGRAPH = /^\s*(?:[-+]\s|\*\s|\d+[.)]\s|#|```|~~~|>|\|)/;

/**
 * Splits a body (LF, trimmed) into its leading paragraph ("What to build") and the rest. A first
 * block that is not a plain paragraph, or that holds a field-like or `#` line (it would be read as a
 * field or end the header region before the fields), is no lead.
 */
const splitLead = (body: string): { lead: string; rest: string } => {
  if (body === '' || NOT_PARAGRAPH.test(body)) return { lead: '', rest: body };
  const cut = body.search(/\n[ \t]*\n/);
  const lead = cut < 0 ? body : body.slice(0, cut);
  if (lead.split('\n').some((l) => matchField(l) !== null || /^\s{0,3}(#|```|~~~)/.test(l))) return { lead: '', rest: body };
  return { lead, rest: cut < 0 ? '' : body.slice(cut).replace(/^\s*\n/, '') };
};

const normalizeBody = (body: string): string => body.replace(/\r\n/g, '\n').replace(/^\s*\n/, '').replace(/\s+$/, '');

/**
 * Renders a new ticket in the shape of Matt's local-ticket-template (to-tickets skill):
 * heading, leading paragraph ("What to build"), Blocked by, Type (optional), Status, then the
 * rest of the body (acceptance criteria). With no leading paragraph the fields follow the heading.
 */
export const renderIssue = (n: number, input: NewTask): string => {
  const blockers = (input.blockedBy ?? []).map(blockerRef);
  const { lead, rest } = splitLead(normalizeBody(input.body ?? ''));
  const parts = [`# ${pad(n)}: ${input.title.trim()}`];
  if (lead !== '') parts.push(lead);
  parts.push(`**Blocked by:** ${blockers.length > 0 ? blockers.join(', ') : NONE_BLOCKERS}`);
  if (input.type !== undefined && input.type.trim() !== '') parts.push(`**Type:** ${input.type.trim()}`);
  parts.push(`**Status:** ${fromState(input.state ?? 'needs-triage')}`);
  if (rest !== '') parts.push(rest);
  return parts.join('\n\n') + '\n';
};

/** Sections agents append at the bottom (issue-tracker-local.md); they are not part of the description. */
const TAIL = /^## (?:Comments|Answer)\s*$/i;

type Parts = { heading: string | null; fields: string[]; description: string; tail: string | null };

/** The file cut into its heading line, header field lines, description (LF, trimmed) and appended tail. */
const splitParts = (text: string): Parts => {
  const lines = splitLines(text).map(content);
  const tailAt = plainLines(lines, false).find(([, c]) => TAIL.test(c))?.[0] ?? lines.length;
  const head = headingIndex(lines);
  const fieldAt = new Set(headerFields(lines).filter((f) => f.index < tailAt).map((f) => f.index));
  const kept: string[] = [];
  let removed = false;
  for (let i = 0; i < tailAt; i++) {
    if (i === head || fieldAt.has(i)) {
      removed = true;
      continue;
    }
    const blank = lines[i]!.trim() === '';
    // A blank line next to a removed line would leave a double gap.
    if (blank && (kept.length === 0 || (removed && kept[kept.length - 1]!.trim() === ''))) continue;
    kept.push(lines[i]!);
    if (!blank) removed = false;
  }
  return {
    heading: head >= 0 && head < tailAt ? lines[head]! : null,
    fields: [...fieldAt].sort((a, b) => a - b).map((i) => lines[i]!),
    description: kept.join('\n').replace(/\s+$/, ''),
    tail: tailAt < lines.length ? lines.slice(tailAt).join('\n').replace(/\s+$/, '') : null,
  };
};

/** The editable description of a local issue or spec: no heading, no header field lines, no `## Comments` / `## Answer`. */
export const issueDescription = (text: string): string => splitParts(text).description;

/**
 * Replaces the description, keeping the heading, every header field line (as written) and the
 * appended tail. Laid out like renderIssue: heading, leading paragraph, fields, rest, tail. CRLF
 * files stay CRLF.
 */
export const withDescription = (text: string, description: string): string => {
  const p = splitParts(text);
  const { lead, rest } = splitLead(normalizeBody(description));
  const parts: string[] = [];
  if (p.heading !== null) parts.push(p.heading);
  if (lead !== '') parts.push(lead);
  // Field lines stay together as they were; ones that sat apart get a blank line between them.
  if (p.fields.length > 0) parts.push(p.fields.join(fieldsTight(text) ? '\n' : '\n\n'));
  if (rest !== '') parts.push(rest);
  if (p.tail !== null) parts.push(p.tail);
  const out = parts.join('\n\n') + '\n';
  return text.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out;
};

/** The file's field lines sit on consecutive lines (createParent writes them so). */
const fieldsTight = (text: string): boolean => {
  const f = headerFields(splitLines(text));
  return f.length > 1 && f.every((x, i) => i === 0 || x.index === f[i - 1]!.index + 1);
};

const slugify = (title: string): string => {
  const slug = title
    .replace(/[łŁ]/g, 'l')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug === '' ? 'issue' : slug;
};

export const issueFileName = (n: number, title: string): string => `${pad(n)}-${slugify(title)}.md`;
