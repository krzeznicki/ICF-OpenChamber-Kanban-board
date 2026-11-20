// The toolbar's search: which tasks match the words typed. Words look at the title and the
// description as the edit form shows it (a local file without its heading and field lines, so
// "ready" does not match every Status line); `type:`, `state:`, `column:`, `status:` and `source:` filter on the
// task's fields and column, and searchSuggestions completes them. Pure: no DOM, so it runs under node:test.
import type { Task } from '../core/types.ts';
import { TASK_STATES } from '../core/types.ts';
import { foldText } from '../core/localFormat.ts';
import { COLUMNS, type BoardModel, type Column } from './columns.ts';
import { editableText } from './taskEdit.ts';

/** The filter keys a query understands, as `key:value` or `key=value`. */
export const FILTER_KEYS = ['type', 'state', 'status', 'column', 'source'] as const;
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
    const key = m?.[1] ?? '';
    if (m === null || !isFilterKey(key)) {
      parsed.words.push(token);
      continue;
    }
    if (m[2] === '') continue;
    parsed.filters.set(key, [...(parsed.filters.get(key) ?? []), m[2]!]);
  }
  return parsed;
};

const isBlank = (q: ParsedQuery): boolean => q.words.length === 0 && q.filters.size === 0;

/** The value, or one of its words (split on `-`, `_` and spaces), starts with what was typed. */
const valueMatches = (value: string, wanted: string): boolean => {
  const v = foldText(value);
  return v.startsWith(wanted) || v.split(/[-_\s]+/).some((part) => part.startsWith(wanted));
};

const anyMatches = (values: readonly string[], wanted: string): boolean => values.some((v) => valueMatches(v, wanted));

/** A column's id and title ("in_progress", "In Progress"); none for a task not drawn. */
const columnNames = (column: Column | null): string[] => {
  const c = COLUMNS.find((x) => x.id === column);
  return c === undefined ? [] : [c.id, c.title];
};

/** `status:` names a column ("ready", "prog") or else a tracker state ("info", "human"). */
const namesColumn = (wanted: string): boolean => COLUMNS.some((c) => anyMatches(columnNames(c.id), wanted));

/** What the board knows that a filter offers values from: its task types and the project's source ids. */
type Offers = { types: readonly string[]; sources: readonly string[] };

/**
 * Per key: whether a task (drawn in `column`, null: not drawn, as a sub-task hidden by "Hide
 * sub-tasks") matches one typed value, and the values searchSuggestions offers.
 */
type FilterSpec = { holds: (task: Task, column: Column | null, wanted: string) => boolean; offers: (board: Offers) => string[] };

const typeFilter: FilterSpec = { holds: (t, _c, w) => t.type !== null && valueMatches(t.type, w), offers: ({ types }) => [...types] };
const stateFilter: FilterSpec = { holds: (t, _c, w) => valueMatches(t.state, w), offers: () => [...TASK_STATES] };
const columnFilter: FilterSpec = { holds: (_t, c, w) => anyMatches(columnNames(c), w), offers: () => COLUMNS.map((c) => c.id) };

const FILTERS: Record<FilterKey, FilterSpec> = {
  type: typeFilter,
  state: stateFilter,
  column: columnFilter,
  status: {
    holds: (t, c, w) => (namesColumn(w) ? columnFilter : stateFilter).holds(t, c, w),
    offers: (board) => [...new Set([...columnFilter.offers(board), ...stateFilter.offers(board)])],
  },
  source: { holds: (t, _c, w) => valueMatches(t.source, w), offers: ({ sources }) => [...sources] },
};

const matchesParsed = (task: Task, q: ParsedQuery, column: Column | null): boolean => {
  // The same key twice means either; different keys must all hold.
  for (const [key, wanted] of q.filters) if (!wanted.some((w) => FILTERS[key].holds(task, column, w))) return false;
  if (q.words.length === 0) return true;
  const { title, body } = editableText(task.source, task);
  const text = foldText(`${title}\n${body}`);
  return q.words.every((w) => text.includes(w));
};

/**
 * Every word of the query appears in the title or the description, and every filter on the task's
 * own fields holds (`type:`, `state:`). Column filters need the board: see filterBoard. A blank
 * query matches all.
 */
export const matchesQuery = (task: Task, query: string): boolean => matchesParsed(task, parseQuery(query), null);

/**
 * The board with only the cards that match (matchesQuery, `column:` against the column each card is
 * drawn in; a sub-task hidden by "Hide sub-tasks" has none), plus the parent of every matching
 * sub-task for context. Runs on groupTasks' result, so progress, blockers and the Review badge
 * still count every task. A kept sub-task always has its parent kept, so its indent holds.
 */
export const filterBoard = (board: BoardModel, tasks: readonly Task[], query: string): BoardModel => {
  const q = parseQuery(query);
  if (isBlank(q)) return board;
  const drawnIn = new Map<string, Column>();
  for (const { id } of COLUMNS) for (const card of board[id]) drawnIn.set(card.task.id, id);
  const keep = new Set<string>();
  for (const t of tasks) {
    if (!matchesParsed(t, q, drawnIn.get(t.id) ?? null)) continue;
    keep.add(t.id);
    if (t.parentId !== null) keep.add(t.parentId);
  }
  const out = { ...board };
  for (const { id: column } of COLUMNS) out[column] = board[column].filter((c) => keep.has(c.task.id));
  return out;
};

/** A completion for the search field: its label, the whole new text, and where the caret goes. */
export type Suggestion = { label: string; text: string; caret: number };

/**
 * What to offer for the word that ends at the caret: the keys it starts (`st` -> `state:`, `status:`), or
 * after `key:` (or `key=`) the values matching what follows (as filters match them). Picking a key
 * leaves the caret after it; picking a value ends the word with a space. `types`: the board's types;
 * `sources`: the project's source ids (`source:` is offered only with several, though it filters always).
 * Nothing when the only match is what is already typed.
 */
export const searchSuggestions = (text: string, caret: number, types: readonly string[], sources: readonly string[] = []): Suggestion[] => {
  // Only at the end of a word: completing inside one would leave or swallow the rest of it.
  if (/^\S/.test(text.slice(caret))) return [];
  const start = text.slice(0, caret).search(/\S*$/);
  const word = text.slice(start, caret);
  if (word === '') return [];
  const replace = (label: string, closed: boolean): Suggestion => {
    const after = text.slice(caret);
    if (!closed) return { label, text: text.slice(0, start) + label + after, caret: start + label.length };
    const spaced = /^\s/.test(after) ? after : ` ${after}`;
    return { label, text: text.slice(0, start) + label + spaced, caret: start + label.length + 1 };
  };
  const m = /^([a-zA-Z]+)([:=])(.*)$/.exec(word);
  if (m === null) {
    const typed = foldText(word);
    const keys = sources.length > 1 ? FILTER_KEYS : FILTER_KEYS.filter((k) => k !== 'source');
    return keys.filter((k) => k.startsWith(typed)).map((k) => replace(`${k}:`, false));
  }
  const key = foldText(m[1]!);
  if (!isFilterKey(key)) return [];
  const typed = foldText(m[3]!);
  const values = FILTERS[key].offers({ types, sources }).filter((v) => typed === '' || valueMatches(v, typed));
  if (values.every((v) => foldText(v) === typed)) return [];
  return values.map((v) => replace(`${m[1]}${m[2]}${v}`, true));
};
