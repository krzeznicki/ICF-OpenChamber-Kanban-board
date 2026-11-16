// The toolbar's search: which tasks match the words typed. Matching looks at the title and the
// description as the edit form shows it (a local file without its heading and field lines, so
// "ready" does not match every Status line). Pure: no DOM, so it runs under node:test.
import type { Task } from '../core/types.ts';
import type { TrackerKind } from './addTask.ts';
import { COLUMNS, type BoardModel } from './columns.ts';
import { editableText } from './taskEdit.ts';

/** Lower case without accents: "Żądanie" and "zadanie" read alike. `ł` has no decomposition of its own. */
const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ł/g, 'l');

const COLUMN_IDS = COLUMNS.map((c) => c.id);

const words = (query: string): string[] => fold(query).split(/\s+/).filter((w) => w !== '');

/** Every word of the query appears in the title or the description; a blank query matches all. */
export const matchesQuery = (task: Task, query: string, tracker: TrackerKind): boolean => {
  const wanted = words(query);
  if (wanted.length === 0) return true;
  const { title, body } = editableText(tracker, task);
  const text = fold(`${title}\n${body}`);
  return wanted.every((w) => text.includes(w));
};

/**
 * The board with only the cards that match (a blank query returns `board` itself), plus the parent of every matching sub-task (also of
 * one hidden by "Hide sub-tasks") for context. Runs on groupTasks' result, so progress, blockers
 * and the Review badge still count every task. A kept sub-task always has its parent kept, so its
 * indent under that parent holds.
 */
export const filterBoard = (board: BoardModel, tasks: readonly Task[], query: string, tracker: TrackerKind): BoardModel => {
  if (words(query).length === 0) return board;
  const keep = new Set<string>();
  for (const t of tasks) {
    if (!matchesQuery(t, query, tracker)) continue;
    keep.add(t.id);
    if (t.parentId !== null) keep.add(t.parentId);
  }
  const out = { ...board };
  for (const column of COLUMN_IDS) out[column] = board[column].filter((c) => keep.has(c.task.id));
  return out;
};
