// Tracker over Matt Pocock's local format: `.scratch/<feature>/spec.md` is the parent,
// `.scratch/<feature>/issues/NN-slug.md` are its tickets. Ids are POSIX paths relative to root.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { issueFileName, parseIssue, parseSpec, patchLine, renderIssue } from './localFormat.ts';
import type { NewTask, Task, TaskState, Tracker } from './types.ts';
import { TrackerError } from './types.ts';

const SCRATCH = '.scratch';
const DONE_WINDOW_MS = 30 * 24 * 3600 * 1000;
const ID = /^\.scratch\/([^/]+)\/(spec\.md|issues\/([^/]+\.md))$/;
const NN = /^(\d+)/;

type Ref = { feature: string; kind: 'parent' | 'ticket'; file: string | null };

const specId = (feature: string): string => `${SCRATCH}/${feature}/spec.md`;
const ticketId = (feature: string, file: string): string => `${SCRATCH}/${feature}/issues/${file}`;
const statusWord = (state: TaskState): string => (state === 'done' ? 'resolved' : state);

const parseId = (id: string): Ref => {
  if (typeof id !== 'string' || id.includes('\\') || id.includes('\0') || posix.isAbsolute(id)) {
    throw new TrackerError('INVALID', `Invalid task id: ${String(id)}`);
  }
  const m = ID.exec(posix.normalize(id));
  if (!m || m[1] === '.' || m[1] === '..' || m[3] === '.md') {
    throw new TrackerError('INVALID', `Task id must be .scratch/<feature>/spec.md or .scratch/<feature>/issues/<file>.md: ${id}`);
  }
  return m[3] === undefined
    ? { feature: m[1]!, kind: 'parent', file: null }
    : { feature: m[1]!, kind: 'ticket', file: m[3] };
};

const isNotFound = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'ENOENT';

const readText = async (path: string): Promise<{ text: string; mtime: number } | null> => {
  try {
    const [text, s] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return { text, mtime: s.mtimeMs };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
};

const dirNames = async (path: string): Promise<string[]> => {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
};

const issueFiles = async (path: string): Promise<string[]> => {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .map((e) => e.name)
      .sort((a, b) => fileNumber(a) - fileNumber(b) || a.localeCompare(b));
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
};

const fileNumber = (file: string): number => {
  const m = NN.exec(file);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
};

const isRecent = (t: Task, now: number): boolean => t.state !== 'done' || now - t.updatedAt <= DONE_WINDOW_MS;

export const createLocalTracker = (root: string): Tracker => {
  const abs = (id: string): string => join(root, ...id.split('/'));
  const featureDir = (feature: string): string => join(root, SCRATCH, feature);
  const issuesDir = (feature: string): string => join(featureDir(feature), 'issues');

  const featureExists = async (feature: string): Promise<boolean> => {
    try {
      return (await stat(featureDir(feature))).isDirectory();
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  };

  const loadParent = async (feature: string): Promise<Task | null> => {
    const file = await readText(abs(specId(feature)));
    if (file === null) {
      if (!(await featureExists(feature))) return null;
      const s = await stat(featureDir(feature));
      return {
        id: specId(feature),
        kind: 'parent',
        title: feature,
        body: '',
        state: 'needs-triage',
        type: null,
        parentId: null,
        blockedBy: [],
        url: null,
        updatedAt: s.mtimeMs,
      };
    }
    const p = parseSpec(file.text, feature);
    return {
      id: specId(feature),
      kind: 'parent',
      title: p.title,
      body: file.text,
      state: p.state,
      type: p.type,
      parentId: null,
      blockedBy: [],
      url: null,
      updatedAt: file.mtime,
    };
  };

  /** Maps blocker numbers to ticket ids of the same feature; numbers without a file are dropped. */
  const resolveBlockers = (feature: string, numbers: number[], files: string[]): string[] => {
    const out: string[] = [];
    for (const n of numbers) {
      const file = files.find((f) => fileNumber(f) === n);
      if (file !== undefined) {
        const id = ticketId(feature, file);
        if (!out.includes(id)) out.push(id);
      }
    }
    return out;
  };

  const loadTicket = async (feature: string, file: string, files?: string[]): Promise<Task | null> => {
    const id = ticketId(feature, file);
    const data = await readText(abs(id));
    if (data === null) return null;
    const p = parseIssue(data.text, file);
    const siblings = files ?? (await issueFiles(issuesDir(feature)));
    return {
      id,
      kind: 'ticket',
      title: p.title,
      body: data.text,
      state: p.state,
      type: p.type,
      parentId: specId(feature),
      blockedBy: resolveBlockers(feature, p.blockedBy, siblings),
      url: null,
      updatedAt: data.mtime,
    };
  };

  const get = async (id: string): Promise<Task> => {
    const ref = parseId(id);
    const task =
      ref.kind === 'parent' ? await loadParent(ref.feature) : await loadTicket(ref.feature, ref.file!);
    if (task === null) throw new TrackerError('NOT_FOUND', `Task not found: ${id}`);
    return task;
  };

  const patch = async (id: string, field: 'Status' | 'Type', value: string): Promise<Task> => {
    const task = await get(id);
    const ref = parseId(task.id);
    // A synthesized parent (no spec.md yet) is written on its first edit.
    const base = task.body === '' && ref.kind === 'parent' ? `# ${task.title}\n\n` : task.body;
    await writeFile(abs(task.id), patchLine(base, field, value));
    return get(task.id);
  };

  const setState = (id: string, state: TaskState): Promise<Task> => patch(id, 'Status', statusWord(state));

  const slugOf = (title: string): string => issueFileName(0, title).slice(3, -3);

  const createParent = async (input: NewTask): Promise<Task> => {
    const slug = slugOf(input.title);
    await mkdir(join(root, SCRATCH), { recursive: true });
    for (let i = 1; ; i++) {
      const feature = i === 1 ? slug : `${slug}-${i}`;
      try {
        await mkdir(featureDir(feature));
      } catch (e) {
        if ((e as { code?: unknown }).code === 'EEXIST') continue;
        throw e;
      }
      const parts = [`# ${input.title.trim()}`];
      const fields: string[] = [];
      if (input.type !== undefined && input.type.trim() !== '') fields.push(`**Type:** ${input.type.trim()}`);
      if (input.state !== undefined) fields.push(`**Status:** ${statusWord(input.state)}`);
      if (fields.length > 0) parts.push(fields.join('\n'));
      const body = (input.body ?? '').replace(/\r\n/g, '\n').trim();
      if (body !== '') parts.push(body);
      await writeFile(abs(specId(feature)), parts.join('\n\n') + '\n', { flag: 'wx' });
      return get(specId(feature));
    }
  };

  const createTicket = async (input: NewTask, parentId: string): Promise<Task> => {
    const ref = parseId(parentId);
    if (ref.kind !== 'parent') throw new TrackerError('INVALID', `Parent must be a spec.md id: ${parentId}`);
    if (!(await featureExists(ref.feature))) throw new TrackerError('NOT_FOUND', `Parent not found: ${parentId}`);
    await mkdir(issuesDir(ref.feature), { recursive: true });
    for (;;) {
      const files = await issueFiles(issuesDir(ref.feature));
      const highest = files.map(fileNumber).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
      const n = highest + 1;
      const file = issueFileName(n, input.title);
      try {
        await writeFile(join(issuesDir(ref.feature), file), renderIssue(n, input), { flag: 'wx' });
      } catch (e) {
        if ((e as { code?: unknown }).code === 'EEXIST') continue;
        throw e;
      }
      return get(ticketId(ref.feature, file));
    }
  };

  return {
    async list() {
      const now = Date.now();
      const out: Task[] = [];
      for (const feature of await dirNames(join(root, SCRATCH))) {
        const files = await issueFiles(issuesDir(feature));
        const parent = await loadParent(feature);
        if (parent !== null && isRecent(parent, now)) out.push(parent);
        for (const file of files) {
          const t = await loadTicket(feature, file, files);
          if (t !== null && isRecent(t, now)) out.push(t);
        }
      }
      return out;
    },

    get,

    create(input) {
      if (typeof input.title !== 'string' || input.title.trim() === '') {
        return Promise.reject(new TrackerError('INVALID', 'Title is required'));
      }
      return input.parentId === undefined ? createParent(input) : createTicket(input, input.parentId);
    },

    setState,

    setType(id, type) {
      return patch(id, 'Type', type.trim());
    },

    async close(id, opts) {
      const task = await get(id);
      const closed = [await setState(task.id, 'done')];
      if (opts.withChildren && task.kind === 'parent') {
        const { feature } = parseId(task.id);
        for (const file of await issueFiles(issuesDir(feature))) {
          const child = await loadTicket(feature, file);
          if (child !== null && child.state !== 'done') closed.push(await setState(child.id, 'done'));
        }
      }
      return closed;
    },
  };
};
