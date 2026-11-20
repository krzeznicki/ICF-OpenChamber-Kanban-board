// Publish a local task to GitHub (spec: "Opublikuj w GitHub"). One direction only: local -> GitHub.
// The task becomes an issue (title, description, state and type labels through the GitHub source's
// label map); a feature's tickets become its sub-issues, and blockers between them point at the new
// issues. Once every issue exists, each local file gets a comment linking its issue and is closed
// (done). When GitHub fails half way the error names what was created and the local files stay open.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { issueDescription, withComment } from './localFormat.ts';
import type { CombinedTracker } from './sources.ts';
import type { Published, Task } from './types.ts';
import { TrackerError, errorMessage } from './types.ts';

export type { Published };

/** The comment left on a published local file. */
export const publishedComment = (url: string): string => `Published to GitHub: ${url}`;

const named = (t: Task): string => `${t.id} (${t.title})`;

/** Tickets ordered so a blocker inside the feature is created before the tickets it blocks. */
const blockersFirst = (tickets: Task[]): Task[] => {
  const ids = new Set(tickets.map((t) => t.id));
  const done = new Set<string>();
  const out: Task[] = [];
  const rest = [...tickets];
  while (rest.length > 0) {
    // A cycle (no ticket free) takes the first one anyway; its unmet blocker is dropped.
    const i = Math.max(0, rest.findIndex((t) => t.blockedBy.every((b) => !ids.has(b) || done.has(b))));
    const [next] = rest.splice(i, 1);
    out.push(next!);
    done.add(next!.id);
  }
  return out;
};

export const publishTask = async (root: string, tracker: CombinedTracker, id: string): Promise<Published> => {
  if (!tracker.sources.some((s) => s.id === 'github')) {
    throw new TrackerError('INVALID', 'This project has no GitHub source; add one in Settings → Sources first');
  }
  const task = await tracker.get(id);
  if (task.source !== 'local') {
    throw new TrackerError('INVALID', `Only a local task can be published to GitHub; ${task.id} is in ${task.source}`);
  }
  const tickets =
    task.kind === 'parent'
      ? blockersFirst(
          (await tracker.listAll({ source: 'local' })).tasks
            .filter((t) => t.parentId === task.id)
            .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })),
        )
      : [];

  const created: Task[] = [];
  const issueOf = new Map<string, Task>();
  const localOf = new Map<string, Task>();
  const publishOne = async (t: Task, parentId?: string): Promise<Task> => {
    const blockedBy = t.blockedBy.flatMap((b) => {
      const to = issueOf.get(b);
      return to === undefined ? [] : [to.id];
    });
    // A done task is created open and closed after, so an issue whose close fails still counts as created.
    const made = await tracker.create({
      title: t.title,
      body: issueDescription(t.body),
      ...(t.state !== 'done' ? { state: t.state } : {}),
      ...(t.type !== null ? { type: t.type } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      ...(blockedBy.length > 0 ? { blockedBy } : {}),
      source: parentId === undefined ? 'github' : undefined,
    });
    created.push(made);
    issueOf.set(t.id, made);
    localOf.set(t.id, t);
    return t.state === 'done' ? tracker.setState(made.id, 'done') : made;
  };

  let issue: Task;
  const subIssues: Published['subIssues'] = [];
  let at: Task = task;
  try {
    issue = await publishOne(task);
    for (const ticket of tickets) {
      at = ticket;
      subIssues.push({ from: ticket.id, task: await publishOne(ticket, issue.id) });
    }
  } catch (e) {
    // Nothing exists on GitHub yet: the error is the plain one (a logged-out gh, say).
    if (created.length === 0) throw e;
    throw new TrackerError(
      'FAILED',
      `Publishing stopped at ${named(at)}: ${errorMessage(e)}. Created on GitHub: ${created.map(named).join(', ')}. ` +
        'The local task was left open; delete those issues or finish the rest by hand before publishing again',
    );
  }

  // Each local file gets its link comment first and is closed right after, so no file is closed
  // without its link. A file missing on disk (a feature folder without spec.md) is closed first,
  // which writes it, and then gets the comment.
  const closed: Task[] = [];
  const published = `Published to GitHub as ${created.map(named).join(', ')}`;
  for (const [from, to] of issueOf) {
    const path = join(root, ...from.split('/'));
    const comment = async (): Promise<void> => {
      try {
        await writeFile(path, withComment(await readFile(path, 'utf8'), publishedComment(to.url ?? to.id)));
      } catch (e) {
        throw new TrackerError('FAILED', `${published}, but the link comment could not be written to ${from}: ${errorMessage(e)}. ${progress(closed, issueOf, from)}`);
      }
    };
    const close = async (): Promise<void> => {
      const local = localOf.get(from)!;
      if (local.state === 'done') return;
      try {
        closed.push(await tracker.setState(from, 'done'));
      } catch (e) {
        throw new TrackerError('FAILED', `${published}, but ${from} could not be closed: ${errorMessage(e)}. ${progress(closed, issueOf, from)}`);
      }
    };
    if (existsSync(path)) {
      await comment();
      await close();
    } else {
      await close();
      await comment();
    }
  }
  return { from: task.id, issue, subIssues, closed };
};

/** What is done and what is left of the local side when a link comment or a close fails at `at`. */
const progress = (closed: readonly Task[], issueOf: ReadonlyMap<string, Task>, at: string): string => {
  const ids = [...issueOf.keys()];
  const left = ids.slice(ids.indexOf(at));
  const done = closed.length === 0 ? 'No local file was closed' : `Closed with their link: ${closed.map((t) => t.id).join(', ')}`;
  return `${done}; still open: ${left.join(', ')}. Close them by hand with a comment linking their issue`;
};
