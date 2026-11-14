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

const readFields = (text: string): Partial<Record<Field, string>> => {
  const out: Partial<Record<Field, string>> = {};
  for (const line of splitLines(text)) {
    const m = matchField(line);
    if (m && out[m.field] === undefined) out[m.field] = m.value;
  }
  return out;
};

const readHeading = (text: string): string | null => {
  for (const line of splitLines(text)) {
    const m = HEADING.exec(content(line));
    if (m) return m[1]!.trim();
  }
  return null;
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
 * and its line ending. A missing line is inserted after the title's blank line (or right after
 * the title, or at the top when there is no title), in the form the file already uses.
 */
export const patchLine = (text: string, field: Field, value: string): string => {
  const lines = splitLines(text);
  let usesBare = false;
  let anyField = false;
  for (let i = 0; i < lines.length; i++) {
    const m = matchField(lines[i]!);
    if (!m) continue;
    if (!anyField) {
      anyField = true;
      usesBare = m.bare;
    }
    if (m.field === field) {
      const cr = lines[i]!.endsWith('\r') ? '\r' : '';
      lines[i] = formatField(field, value, m.bare) + cr;
      return lines.join('\n');
    }
  }

  const crlf = text.includes('\r\n');
  const newLine = formatField(field, value, anyField && usesBare) + (crlf ? '\r' : '');
  const titleAt = lines.findIndex((l) => HEADING.test(content(l)));
  let at = 0;
  if (titleAt >= 0) {
    at = titleAt + 1;
    if (at < lines.length && content(lines[at]!).trim() === '') at++;
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

/** Renders a new ticket in the shape of Matt's local-ticket-template (to-tickets skill). */
export const renderIssue = (n: number, input: NewTask): string => {
  const blockers = (input.blockedBy ?? []).map(blockerRef);
  const parts = [`# ${pad(n)}: ${input.title.trim()}`];
  const body = (input.body ?? '').replace(/\s+$/, '');
  if (body !== '') parts.push(body);
  parts.push(`**Blocked by:** ${blockers.length > 0 ? blockers.join(', ') : NONE_BLOCKERS}`);
  if (input.type !== undefined && input.type.trim() !== '') parts.push(`**Type:** ${input.type.trim()}`);
  parts.push(`**Status:** ${fromState(input.state ?? 'needs-triage')}`);
  return parts.join('\n\n') + '\n';
};

const slugify = (title: string): string => {
  const slug = title
    .replace(/[łŁ]/g, 'l')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug === '' ? 'issue' : slug;
};

export const issueFileName = (n: number, title: string): string => `${pad(n)}-${slugify(title)}.md`;
