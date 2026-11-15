// Tracker over GitHub Issues in Matt Pocock's format, through the `gh` CLI. Ids are "#<number>".
// State is a triage label (strings from triage-labels.md), closed = done. Type is the `bug` /
// `enhancement` label or a `type:<x>` label. Parents are issues with sub-issues.
import type { LabelRole, ProjectConfig } from './config.ts';
import type { Exec, NewTask, Task, TaskState, Tracker } from './types.ts';
import { TrackerError } from './types.ts';

const MIN_GH: [number, number] = [2, 94];
const DONE_WINDOW_MS = 30 * 24 * 3600 * 1000;
const ROLES: readonly LabelRole[] = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix'];
const CATEGORIES = ['bug', 'enhancement'];
const TYPE_PREFIX = 'type:';
const LIST_FIELDS = 'number,title,body,labels,state,updatedAt,url,closedAt,assignees';
const ROLE_DESCRIPTIONS: Record<LabelRole, string> = {
  'needs-triage': 'Maintainer needs to evaluate this issue',
  'needs-info': 'Waiting on reporter for more information',
  'ready-for-agent': 'Fully specified, ready for an AFK agent',
  'ready-for-human': 'Requires human implementation',
  wontfix: 'Will not be actioned',
};

/** One issue's fields as gh prints them; relations come from GraphQL. */
type Issue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  updatedAt: string;
  url: string;
  closedAt: string | null;
  /** assignee logins; any assignee means the issue is claimed */
  assignees: string[];
};
type Relations = {
  parent: number | null;
  children: { number: number; open: boolean }[];
  childCount: number;
  /** native blockers; null when the issue has none recorded */
  blockedBy: number[] | null;
};

type GraphIssue = {
  number: number;
  title?: string;
  body?: string;
  state?: string;
  url?: string;
  updatedAt?: string;
  closedAt?: string | null;
  labels?: { nodes: { name: string }[] };
  assignees?: { nodes: { login: string }[] };
  parent: { number: number } | null;
  subIssues: { totalCount: number; nodes: { number: number; state: string }[] } | null;
  issueDependenciesSummary: { totalBlockedBy: number } | null;
  blockedBy: { nodes: { number: number }[] } | null;
};

const RELATION_FIELDS =
  'number parent { number } subIssues(first: 100) { totalCount nodes { number state } } ' +
  'issueDependenciesSummary { totalBlockedBy } blockedBy(first: 100) { nodes { number } }';
const ISSUE_FIELDS = `title body state url updatedAt closedAt labels(first: 100) { nodes { name } } assignees(first: 10) { nodes { login } } ${RELATION_FIELDS}`;

export const parseNumber = (id: string): number => {
  const m = typeof id === 'string' ? /^\s*#?(\d+)\s*$/.exec(id) : null;
  if (m === null || Number(m[1]) === 0) throw new TrackerError('INVALID', `GitHub task id must be "#<number>": ${String(id)}`);
  return Number(m[1]);
};

const idOf = (n: number): string => `#${n}`;

/** Issue numbers in a `## Blocked by` section or on a `Blocked by:` line of the body. */
export const bodyBlockers = (body: string): number[] => {
  const out: number[] = [];
  const take = (text: string): void => {
    for (const m of text.matchAll(/#(\d+)\b/g)) {
      const n = Number(m[1]);
      if (!out.includes(n)) out.push(n);
    }
  };
  let inSection = false;
  for (const line of body.split(/\r?\n/)) {
    const heading = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      inSection = /^blocked by:?$/i.test(heading[1]!.replace(/[*_]/g, '').trim());
      continue;
    }
    if (inSection) {
      take(line);
      continue;
    }
    const m = /^\s*[-*]?\s*[*_]*blocked by:?[*_]*:?\s*(.*)$/i.exec(line);
    if (m) take(m[1]!);
  }
  return out;
};

/** Descriptions GitHub gives its default category labels. */
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  bug: "Something isn't working",
  enhancement: 'New feature or request',
};

const versionOf = (stdout: string): [number, number, number] | null => {
  const m = /gh version (\d+)\.(\d+)(?:\.(\d+))?/.exec(stdout.split('\n')[0] ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
};

/** The tracker plus what the setup wizard needs: the gh preflight and label creation. */
export type GithubTracker = Tracker & {
  /** Checks gh is installed, new enough and logged in (GH_MISSING / GH_OLD / GH_AUTH). */
  preflight(): Promise<void>;
  /** Creates the state-role labels and `bug` / `enhancement` the repo does not have yet. */
  setupLabels(): Promise<void>;
};

export const createGithubTracker = (root: string, exec: Exec, labels: ProjectConfig['labels']): GithubTracker => {
  const stateLabels = ROLES.map((r) => labels[r]);
  let preflight: Promise<void> | null = null;
  let known: Promise<Set<string>> | null = null;

  const missing = (): TrackerError =>
    new TrackerError('GH_MISSING', 'GitHub CLI (gh) is not installed: install it with `brew install gh`, then run `gh auth login`');

  const check = async (): Promise<void> => {
    const v = await exec('gh', ['--version'], { cwd: root });
    if (v.code === 127) throw missing();
    const version = versionOf(v.stdout);
    if (v.code !== 0 || version === null) {
      throw new TrackerError('FAILED', `Cannot read the gh version: ${(v.stderr || v.stdout).trim()}`);
    }
    if (version[0] < MIN_GH[0] || (version[0] === MIN_GH[0] && version[1] < MIN_GH[1])) {
      throw new TrackerError(
        'GH_OLD',
        `gh ${version.join('.')} is too old: ICF-kanban needs gh ${MIN_GH.join('.')} or later; update it with \`brew upgrade gh\``,
      );
    }
    const auth = await exec('gh', ['auth', 'status'], { cwd: root });
    if (auth.code === 127) throw missing();
    if (auth.code !== 0) {
      const detail = (auth.stderr || auth.stdout).trim();
      throw new TrackerError('GH_AUTH', `gh is not logged in to GitHub: run \`gh auth login\`${detail ? ` (${detail})` : ''}`);
    }
  };

  const ready = (): Promise<void> => {
    if (preflight === null) {
      preflight = check();
      // A failed check is retried on the next call, so installing or logging in fixes it without a restart.
      preflight.catch(() => {
        preflight = null;
      });
    }
    return preflight;
  };

  /** Runs gh after the preflight; a non-zero exit becomes FAILED with gh's own message. */
  const failed = (args: string[], r: { code: number; stdout: string; stderr: string }): TrackerError =>
    new TrackerError('FAILED', `gh ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout).trim() || `exit code ${r.code}`}`);

  const run = async (args: string[], allowFailure = false): Promise<{ code: number; stdout: string; stderr: string }> => {
    await ready();
    const r = await exec('gh', args, { cwd: root });
    if (r.code === 127) throw missing();
    if (r.code !== 0 && !allowFailure) throw failed(args, r);
    return r;
  };

  const parseJson = <T>(text: string, what: string): T => {
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new TrackerError('FAILED', `gh returned invalid JSON for ${what}`);
    }
  };

  /** One GraphQL call for the given issue numbers; a missing issue maps to null. */
  const graph = async (numbers: number[], full: boolean): Promise<Map<number, GraphIssue | null>> => {
    const fields = full ? ISSUE_FIELDS : RELATION_FIELDS;
    const aliases = numbers.map((n) => `i${n}: issue(number: ${n}) { ${fields} }`).join(' ');
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${aliases} } }`;
    // A missing issue makes gh exit 1 but still print the data for the others.
    const args = ['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}', '-f', `query=${query}`];
    const r = await run(args, true);
    let data: { data?: { repository?: Record<string, GraphIssue | null> | null } } | null = null;
    try {
      data = JSON.parse(r.stdout);
    } catch {
      data = null;
    }
    const repo = data?.data?.repository;
    if (r.code !== 0 && (repo === undefined || repo === null)) throw failed(args, r);
    if (repo === undefined || repo === null) throw new TrackerError('FAILED', 'gh api graphql returned no repository');
    return new Map(numbers.map((n) => [n, repo[`i${n}`] ?? null]));
  };

  const relationsOf = (g: GraphIssue | null): Relations => ({
    parent: g?.parent?.number ?? null,
    children: (g?.subIssues?.nodes ?? []).map((c) => ({ number: c.number, open: c.state === 'OPEN' })),
    childCount: g?.subIssues?.totalCount ?? 0,
    blockedBy:
      g?.issueDependenciesSummary && g.issueDependenciesSummary.totalBlockedBy > 0 && g.blockedBy
        ? g.blockedBy.nodes.map((b) => b.number)
        : null,
  });

  const stateOf = (issue: Issue): TaskState => {
    if (issue.state !== 'OPEN') return 'done';
    return ROLES.find((r) => issue.labels.includes(labels[r])) ?? 'needs-triage';
  };

  const typeOf = (names: string[]): string | null => {
    const category = CATEGORIES.find((c) => names.includes(c));
    if (category !== undefined) return category;
    const custom = names.find((l) => l.toLowerCase().startsWith(TYPE_PREFIX));
    return custom === undefined ? null : custom.slice(TYPE_PREFIX.length).trim() || null;
  };

  const toTask = (issue: Issue, rel: Relations): Task => ({
    id: idOf(issue.number),
    kind: rel.childCount > 0 ? 'parent' : 'ticket',
    title: issue.title,
    body: issue.body,
    state: stateOf(issue),
    type: typeOf(issue.labels),
    parentId: rel.parent === null ? null : idOf(rel.parent),
    blockedBy: (rel.blockedBy ?? bodyBlockers(issue.body)).map(idOf),
    url: issue.url,
    updatedAt: Date.parse(issue.updatedAt) || 0,
    claimed: issue.assignees.length > 0,
  });

  const load = async (n: number): Promise<{ task: Task; issue: Issue; rel: Relations }> => {
    const g = (await graph([n], true)).get(n) ?? null;
    if (g === null) throw new TrackerError('NOT_FOUND', `Issue not found: #${n}`);
    const issue: Issue = {
      number: g.number,
      title: g.title ?? '',
      body: g.body ?? '',
      labels: (g.labels?.nodes ?? []).map((l) => l.name),
      state: g.state ?? 'OPEN',
      updatedAt: g.updatedAt ?? '',
      url: g.url ?? '',
      closedAt: g.closedAt ?? null,
      assignees: (g.assignees?.nodes ?? []).map((a) => a.login),
    };
    const rel = relationsOf(g);
    return { task: toTask(issue, rel), issue, rel };
  };

  const get = async (id: string): Promise<Task> => (await load(parseNumber(id))).task;

  const typeLabel = (type: string): string => (CATEGORIES.includes(type) ? type : `${TYPE_PREFIX}${type}`);
  const isTypeLabel = (l: string): boolean => CATEGORIES.includes(l) || l.toLowerCase().startsWith(TYPE_PREFIX);

  /** Creates the labels the repo does not have yet. */
  const ensureLabels = async (names: string[]): Promise<void> => {
    if (known === null) {
      known = run(['label', 'list', '--limit', '1000', '--json', 'name']).then(
        (r) => new Set(parseJson<{ name: string }[]>(r.stdout, 'label list').map((l) => l.name)),
      );
      known.catch(() => {
        known = null;
      });
    }
    const have = await known;
    for (const name of names) {
      if (have.has(name)) continue;
      const role = ROLES.find((r) => labels[r] === name);
      const description = role !== undefined ? ROLE_DESCRIPTIONS[role] : (CATEGORY_DESCRIPTIONS[name] ?? 'Task type');
      await run(['label', 'create', name, '--description', description]);
      have.add(name);
    }
  };

  /** One `gh issue edit` that adds `add` and removes `remove`; nothing to do -> no call. */
  const swapLabels = async (n: number, add: string | null, remove: string[]): Promise<void> => {
    if (add === null && remove.length === 0) return;
    if (add !== null) await ensureLabels([add]);
    const args = ['issue', 'edit', String(n)];
    if (add !== null) args.push('--add-label', add);
    for (const l of remove) args.push('--remove-label', l);
    await run(args);
  };

  const setState = async (id: string, state: TaskState): Promise<Task> => {
    const { issue } = await load(parseNumber(id));
    const open = issue.state === 'OPEN';
    if (state === 'done') {
      if (open) await run(['issue', 'close', String(issue.number)]);
      return get(idOf(issue.number));
    }
    if (!(ROLES as readonly string[]).includes(state)) throw new TrackerError('INVALID', `Unknown state: ${String(state)}`);
    if (!open) await run(['issue', 'reopen', String(issue.number)]);
    const label = labels[state as LabelRole];
    const remove = issue.labels.filter((l) => stateLabels.includes(l) && l !== label);
    await swapLabels(issue.number, issue.labels.includes(label) ? null : label, remove);
    return get(idOf(issue.number));
  };

  return {
    preflight: ready,
    setupLabels: () => ensureLabels([...stateLabels, ...CATEGORIES]),

    async list() {
      const r = await run(['issue', 'list', '--state', 'all', '--limit', '500', '--json', LIST_FIELDS]);
      const raw = parseJson<(Omit<Issue, 'labels' | 'assignees'> & { labels: { name: string }[]; assignees?: { login: string }[] })[]>(
        r.stdout,
        'issue list',
      );
      const now = Date.now();
      const issues: Issue[] = raw
        .map((i) => ({
          ...i,
          body: i.body ?? '',
          labels: (i.labels ?? []).map((l) => l.name),
          assignees: (i.assignees ?? []).map((a) => a.login),
        }))
        .filter((i) => i.state === 'OPEN' || (i.closedAt !== null && now - Date.parse(i.closedAt) <= DONE_WINDOW_MS))
        .sort((a, b) => a.number - b.number);
      if (issues.length === 0) return [];
      const rel = await graph(issues.map((i) => i.number), false);
      return issues.map((i) => toTask(i, relationsOf(rel.get(i.number) ?? null)));
    },

    get,

    async create(input: NewTask) {
      if (typeof input.title !== 'string' || input.title.trim() === '') throw new TrackerError('INVALID', 'Title is required');
      const parent = input.parentId === undefined ? null : parseNumber(input.parentId);
      const blockers = (input.blockedBy ?? []).map(parseNumber);
      const type = input.type?.trim() ? typeLabel(input.type.trim()) : null;
      const state = input.state === undefined || input.state === 'done' ? null : labels[input.state as LabelRole];
      if (input.state !== undefined && input.state !== 'done' && state === undefined) {
        throw new TrackerError('INVALID', `Unknown state: ${String(input.state)}`);
      }
      const add = [state, type].filter((l): l is string => l !== null);
      await ensureLabels(add);
      const args = ['issue', 'create', '--title', input.title.trim(), '--body', input.body ?? ''];
      for (const l of add) args.push('--label', l);
      if (parent !== null) args.push('--parent', String(parent));
      if (blockers.length > 0) args.push('--blocked-by', blockers.join(','));
      const r = await run(args);
      const m = /\/issues\/(\d+)\s*$/.exec(r.stdout.trim());
      if (m === null) throw new TrackerError('FAILED', `gh issue create printed no issue URL: ${r.stdout.trim()}`);
      const n = Number(m[1]);
      if (input.state === 'done') await run(['issue', 'close', String(n)]);
      return get(idOf(n));
    },

    setState,

    async setType(id, type) {
      const value = typeof type === 'string' ? type.trim() : '';
      if (value === '') throw new TrackerError('INVALID', 'Type is required');
      const { issue } = await load(parseNumber(id));
      const label = typeLabel(value);
      const remove = issue.labels.filter((l) => isTypeLabel(l) && l !== label);
      await swapLabels(issue.number, issue.labels.includes(label) ? null : label, remove);
      return get(idOf(issue.number));
    },

    async claim(id) {
      const { task, issue } = await load(parseNumber(id));
      if (task.kind === 'parent') throw new TrackerError('INVALID', `Only a sub-task can be claimed, not a parent issue: ${task.id}`);
      if (task.state === 'done') throw new TrackerError('INVALID', `A closed issue cannot be claimed; reopen it first: ${task.id}`);
      // The state label is left as it is; an assignee stays on later state changes too.
      await run(['issue', 'edit', String(issue.number), '--add-assignee', '@me']);
      return get(task.id);
    },

    async close(id, opts) {
      const { issue, rel } = await load(parseNumber(id));
      const closed: number[] = [];
      if (opts.withChildren) {
        for (const child of rel.children.filter((c) => c.open)) {
          await run(['issue', 'close', String(child.number)]);
          closed.push(child.number);
        }
      }
      if (issue.state === 'OPEN') await run(['issue', 'close', String(issue.number)]);
      const out = [await get(idOf(issue.number))];
      for (const n of closed) out.push(await get(idOf(n)));
      return out;
    },
  };
};
