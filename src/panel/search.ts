// The toolbar's search: which tasks match the words typed. Words look at the title and the
// description as the edit form shows it (a local file without its heading and field lines, so
// "ready" does not match every Status line); `type:`, `state:`, `column:` and `status:` filter on the
// task's fields and column, and searchSuggestions completes them. Pure: no DOM, so it runs under node:test.
import type { Task, TaskState } from '../core/types.ts';
import type { TrackerKind } from './addTask.ts';
import { foldText } from '../core/localFormat.ts';
import { COLUMNS, type BoardModel, type Column } from './columns.ts';
import { editableText } from './taskEdit.ts';


/** The filter keys a query understands, as `key:value` or `key=value`. */
export const FILTER_KEYS = ['type', 'state', 'status', 'column'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

type ParsedQuery = { words: string[]; filters: Map<FilterKey, string[]> };

const FILTER = /^([a-z]+)[:=](.*)$/;

const isFilterKey = (key: string): key is FilterKey => (FILTER_KEYS as readonly string[]).includes(key);

/** Plain words and `key:value` filters; an unknown key is a plain word, an empty value (still typing) no condition. */
const parseQuery = (query: string): ParsedQuery => {
  const parsed: ParsedQuery = { words: [], filters: new Map() };
  for (const token of foldText(query).split(/\s+/)) {
    if (token === '') continue;
    const m = FILTER.exec(token);
    if (m === null || !isFilterKey(m[1]!)) {
      parsed.words.push(token);
      continue;
    }
    if (m[2] === '') continue;
    parsed.filters.set(m[1] as FilterKey, [...(parsed.filters.get(m[1] as FilterKey) ?? []), m[2]!]);
  }
  return parsed;
};

const isBlank = (q: ParsedQuery): boolean => q.words.length === 0 && q.filters.size === 0;

/** The value, or one of its words (split on `-`, `_` and spaces), starts with what was typed. */
const valueMatches = (value: string, wanted: string): boolean => {
  const v = foldText(value);
  return v.startsWith(wanted) || v.split(/[-_\s]+/).some((part) => part.startsWith(wanted));
};

/** Each filter key holds when any of its values matches (OR); the task's values per key. */
const filterHolds = (values: readonly string[], wanted: readonly string[]): boolean =>
  wanted.some((w) => values.some((v) => valueMatches(v, w)));

/** A column's id and title ("in_progress", "In Progress"); none for a task not drawn. */
const columnValues = (column: Column | null): string[] => {
  const c = COLUMNS.find((x) => x.id === column);
  return c === undefined ? [] : [c.id, c.title];
};

const filterValues = (key: FilterKey, task: Task, column: Column | null): string[] => {
  switch (key) {
    case 'type':
      return task.type === null ? [] : [task.type];
    case 'state':
      return [task.state];
    case 'column':
      return columnValues(column);
    case 'status':
      return [...columnValues(column), task.state];
  }
};

const matchesParsed = (task: Task, q: ParsedQuery, tracker: TrackerKind, column: Column | null): boolean => {
  for (const [key, wanted] of q.filters) if (!filterHolds(filterValues(key, task, column), wanted)) return false;
  if (q.words.length === 0) return true;
  const { title, body } = editableText(tracker, task);
  const text = foldText(`${title}\n${body}`);
  return q.words.every((w) => text.includes(w));
};

/**
 * Every word of the query appears in the title or the description, and every filter holds:
 * `type:`, `state:` (the tracker state), `column:` (the board column the task is drawn in, `column`;
 * null: not drawn, so no column filter holds) and `status:` (the column or the state). The same key
 * twice means either. A blank query matches all.
 */
export const matchesQuery = (task: Task, query: string, tracker: TrackerKind, column: Column | null = null): boolean =>
  matchesParsed(task, parseQuery(query), tracker, column);

/**
 * The board with only the cards that match (matchesQuery, `column:` against the column each card is
 * drawn in; a sub-task hidden by "Hide sub-tasks" has none), plus the parent of every matching
 * sub-task for context. Runs on groupTasks' result, so progress, blockers and the Review badge
 * still count every task. A kept sub-task always has its parent kept, so its indent holds.
 */
export const filterBoard = (board: BoardModel, tasks: readonly Task[], query: string, tracker: TrackerKind): BoardModel => {
  const q = parseQuery(query);
  if (isBlank(q)) return board;
  const drawnIn = new Map<string, Column>();
  for (const { id } of COLUMNS) for (const card of board[id]) drawnIn.set(card.task.id, id);
  const keep = new Set<string>();
  for (const t of tasks) {
    if (!matchesParsed(t, q, tracker, drawnIn.get(t.id) ?? null)) continue;
    keep.add(t.id);
    if (t.parentId !== null) keep.add(t.parentId);
  }
  const out = { ...board };
  for (const { id: column } of COLUMNS) out[column] = board[column].filter((c) => keep.has(c.task.id));
  return out;
};

const STATES: readonly TaskState[] = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix', 'done'];

/** A completion for the search field: its label, the whole new text, and where the caret goes. */
export type Suggestion = { label: string; text: string; caret: number };

const candidates = (key: FilterKey, types: readonly string[]): string[] => {
  const columns = COLUMNS.map((c) => c.id);
  switch (key) {
    case 'type':
      return [...types];
    case 'state':
      return [...STATES];
    case 'column':
      return columns;
    case 'status':
      return [...new Set<string>([...columns, ...STATES])];
  }
};

/**
 * What to offer for the word under the caret: the keys it starts (`st` -> `state:`, `status:`), or
 * after `key:` (or `key=`) the values matching what follows (as filters match them). Picking a key
 * leaves the caret after it; picking a value ends the word with a space. `types`: the board's types.
 * Nothing when the only match is what is already typed.
 */
export const searchSuggestions = (text: string, caret: number, types: readonly string[]): Suggestion[] => {
  const start = text.slice(0, caret).search(/\S*$/);
  const rest = text.slice(caret).search(/\s|$/);
  const end = caret + rest;
  const word = text.slice(start, caret);
  if (word === '') return [];
  const replace = (label: string, closed: boolean): Suggestion => {
    const after = text.slice(end);
    if (!closed) return { label, text: text.slice(0, start) + label + after, caret: start + label.length };
    const spaced = /^\s/.test(after) ? after : ` ${after}`;
    return { label, text: text.slice(0, start) + label + spaced, caret: start + label.length + 1 };
  };
  const m = /^([a-zA-Z]+)([:=])(.*)$/.exec(word);
  if (m === null) {
    const typed = foldText(word);
    return FILTER_KEYS.filter((k) => k.startsWith(typed)).map((k) => replace(`${k}:`, false));
  }
  const key = foldText(m[1]!);
  if (!isFilterKey(key)) return [];
  const typed = foldText(m[3]!);
  const values = candidates(key, types).filter((v) => typed === '' || valueMatches(v, typed));
  if (values.every((v) => foldText(v) === typed)) return [];
  return values.map((v) => replace(`${m[1]}${m[2]}${v}`, true));
};
