// A fake `gh` for the GitHub tracker tests: an `Exec` over an in-memory issue list that records
// every call. It routes on argv and answers with the JSON shapes the real gh 2.103 prints.
import type { Exec } from '../src/core/types.ts';

export type FakeIssue = {
  number: number;
  title: string;
  body?: string;
  labels?: string[];
  state?: 'OPEN' | 'CLOSED';
  updatedAt?: string;
  closedAt?: string | null;
  parent?: number | null;
  blockedBy?: number[];
  /** Assignee logins; `--add-assignee @me` adds "me". */
  assignees?: string[];
};

export type FakeGhOptions = {
  /** `gh --version` number; null = gh is not installed (exit 127). */
  version?: string | null;
  authed?: boolean;
  issuesDisabled?: boolean;
  /** Labels that exist in the repo. */
  labels?: string[];
  /** The `origin` URL `git remote -v` prints; null = no remote. Default https://github.com/o/r.git. */
  remote?: string | null;
  /** The user is not a repo admin: `gh issue delete` fails the way GitHub refuses it. */
  notAdmin?: boolean;
  /** `gh issue create` fails for the titles this returns true for (a publish that stops half way). */
  failCreate?: (title: string) => boolean;
  /** `gh issue close` fails for the issue numbers this returns true for. */
  failClose?: (n: number) => boolean;
};

const URL = 'https://github.com/o/r/issues/';
const NOW = new Date().toISOString();

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const fail = (stderr: string, code = 1, stdout = '') => ({ code, stdout, stderr });

/** Values of a repeatable flag; gh also splits each value on commas. */
const flagValues = (args: string[], flag: string): string[] =>
  args.flatMap((a, i) => (a === flag && i + 1 < args.length ? args[i + 1]!.split(',') : [])).filter((v) => v !== '');
const flag = (args: string[], name: string): string | undefined => flagValues(args, name)[0];

export const fakeGh = (seed: FakeIssue[], options: FakeGhOptions = {}) => {
  const issues = seed.map((i) => ({
    body: '',
    labels: [] as string[],
    state: 'OPEN' as 'OPEN' | 'CLOSED',
    updatedAt: NOW,
    closedAt: null as string | null,
    parent: null as number | null,
    blockedBy: [] as number[],
    assignees: [] as string[],
    ...i,
  }));
  const labels = new Set(options.labels ?? []);
  const calls: string[][] = [];
  const version = options.version === undefined ? '2.103.3' : options.version;

  const find = (n: string | number) => issues.find((i) => i.number === Number(String(n).replace('#', '')));
  const listJson = (i: (typeof issues)[number]) => ({
    number: i.number,
    title: i.title,
    body: i.body,
    labels: i.labels.map((name) => ({ id: `L_${name}`, name, description: '', color: 'ededed' })),
    state: i.state,
    updatedAt: i.updatedAt,
    url: `${URL}${i.number}`,
    closedAt: i.closedAt,
    assignees: i.assignees.map((login) => ({ id: `U_${login}`, login, name: login })),
  });
  const graphJson = (i: (typeof issues)[number]) => {
    const children = issues.filter((c) => c.parent === i.number);
    return {
      ...listJson(i),
      labels: { nodes: i.labels.map((name) => ({ name })) },
      assignees: { nodes: i.assignees.map((login) => ({ login })) },
      parent: i.parent === null ? null : { number: i.parent },
      subIssues: { totalCount: children.length, nodes: children.map((c) => ({ number: c.number, state: c.state })) },
      issueDependenciesSummary: { totalBlockedBy: i.blockedBy.length },
      blockedBy: { nodes: i.blockedBy.map((number) => ({ number })) },
    };
  };
  const touch = (i: (typeof issues)[number]) => {
    i.updatedAt = NOW;
  };

  const exec: Exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'git' && args[0] === 'remote' && args[1] === '-v') {
      const url = options.remote === undefined ? 'https://github.com/o/r.git' : options.remote;
      return ok(url === null ? '' : `origin\t${url} (fetch)\norigin\t${url} (push)\n`);
    }
    if (cmd !== 'gh') return fail(`${cmd}: unexpected command`, 127);
    if (version === null) return fail('gh: command not found', 127);
    const [a, b] = args;
    if (a === '--version') return ok(`gh version ${version} (2026-10-26)\nhttps://github.com/cli/cli/releases/tag/v${version}\n`);
    if (a === 'auth' && b === 'status') {
      return options.authed === false ? fail('You are not logged into any GitHub hosts. To log in, run: gh auth login\n') : ok();
    }
    if (a === 'label' && b === 'list') return ok(JSON.stringify([...labels].map((name) => ({ name }))));
    if (a === 'label' && b === 'create') {
      labels.add(args[2]!);
      return ok();
    }
    if (options.issuesDisabled && (a === 'issue' || a === 'api')) {
      return fail("the 'o/r' repository has disabled issues\n");
    }
    if (a === 'api' && b === 'graphql') {
      const query = args.find((x) => x.startsWith('query='))!;
      const data: Record<string, unknown> = {};
      const errors: unknown[] = [];
      for (const m of query.matchAll(/i(\d+): issue\(number: ?(\d+)\)/g)) {
        const i = find(m[2]!);
        data[`i${m[1]}`] = i === undefined ? null : graphJson(i);
        if (i === undefined) errors.push({ type: 'NOT_FOUND', message: `Could not resolve to an Issue with the number of ${m[2]}.` });
      }
      const out = JSON.stringify({ data: { repository: data }, ...(errors.length ? { errors } : {}) });
      return errors.length ? fail('gh: Could not resolve to an Issue\n', 1, out) : ok(out);
    }
    if (a === 'issue' && b === 'list') return ok(JSON.stringify(issues.map(listJson)));
    if (a === 'issue' && b === 'create') {
      const missing = flagValues(args, '--label').find((l) => !labels.has(l));
      if (missing !== undefined) return fail(`could not add label: '${missing}' not found\n`);
      if (options.failCreate?.(flag(args, '--title') ?? '')) return fail('HTTP 502: Bad Gateway\n');
      const number = Math.max(0, ...issues.map((i) => i.number)) + 1;
      const parent = flag(args, '--parent');
      issues.push({
        number,
        title: flag(args, '--title') ?? '',
        body: args[args.indexOf('--body') + 1] ?? '',
        labels: flagValues(args, '--label'),
        state: 'OPEN',
        updatedAt: NOW,
        closedAt: null,
        parent: parent === undefined ? null : Number(parent),
        blockedBy: flagValues(args, '--blocked-by').map(Number),
        assignees: [],
      });
      return ok(`${URL}${number}\n`);
    }
    const issue = find(args[2] ?? '');
    if (a === 'issue' && issue === undefined) return fail(`could not find issue ${args[2]}\n`);
    if (a === 'issue' && b === 'edit') {
      const add = flagValues(args, '--add-label');
      for (const n of flagValues(args, '--add-blocked-by').map(Number)) {
        if (!issue!.blockedBy.includes(n)) issue!.blockedBy.push(n);
      }
      const missing = add.find((l) => !labels.has(l));
      if (missing !== undefined) return fail(`'${missing}' not found\n`);
      const remove = new Set(flagValues(args, '--remove-label'));
      issue!.labels = [...issue!.labels.filter((l) => !remove.has(l)), ...add.filter((l) => !issue!.labels.includes(l))];
      for (const login of flagValues(args, '--add-assignee').map((a) => (a === '@me' ? 'me' : a))) {
        if (!issue!.assignees.includes(login)) issue!.assignees.push(login);
      }
      const unassign = new Set(flagValues(args, '--remove-assignee').map((a) => (a === '@me' ? 'me' : a)));
      issue!.assignees = issue!.assignees.filter((l) => !unassign.has(l));
      const title = args.indexOf('--title');
      if (title >= 0) issue!.title = args[title + 1]!;
      const body = args.indexOf('--body');
      if (body >= 0) issue!.body = args[body + 1]!;
      const parent = flag(args, '--parent');
      if (parent !== undefined) {
        if (find(parent) === undefined) return fail(`resolving --parent reference "${parent}": could not find issue\n`);
        issue!.parent = Number(parent);
      }
      if (args.includes('--remove-parent')) {
        if (issue!.parent === null) return fail(`issue #${issue!.number} has no parent issue\n`);
        issue!.parent = null;
      }
      touch(issue!);
      return ok(`${URL}${issue!.number}\n`);
    }
    if (a === 'issue' && b === 'close') {
      if (options.failClose?.(issue!.number)) return fail('HTTP 502: Bad Gateway\n');
      issue!.state = 'CLOSED';
      issue!.closedAt = NOW;
      touch(issue!);
      return ok();
    }
    if (a === 'issue' && b === 'delete') {
      if (!args.includes('--yes')) return fail('--yes required when not running interactively\n');
      if (options.notAdmin) return fail('GraphQL: me does not have the correct permissions to execute `DeleteIssue` (deleteIssue)\n');
      issues.splice(issues.indexOf(issue!), 1);
      for (const i of issues) if (i.parent === issue!.number) i.parent = null;
      return ok(`✓ Deleted issue o/r#${issue!.number} (${issue!.title}).\n`);
    }
    if (a === 'issue' && b === 'reopen') {
      issue!.state = 'OPEN';
      issue!.closedAt = null;
      touch(issue!);
      return ok();
    }
    return fail(`fake gh: unhandled ${args.join(' ')}`);
  };

  /** Calls other than the preflight and label listing, as "gh issue edit 3 ..." strings. */
  const commands = () =>
    calls
      .map((c) => c.join(' '))
      .filter((c) => c !== 'gh --version' && c !== 'gh auth status' && !c.startsWith('gh api graphql') && !c.startsWith('gh label list'));

  return { exec, calls, commands, issues, labels };
};
