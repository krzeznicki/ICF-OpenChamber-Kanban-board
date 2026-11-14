// `task-board`: the CLI agents call from any session to read and update the project's tasks.
// Exit codes: 0 ok, 2 usage, 3 nothing found, 4 TrackerError.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readConfig, writeConfig } from '../core/config.ts';
import { realExec } from '../core/exec.ts';
import { openTracker } from '../core/openTracker.ts';
import type { Exec, Task, TaskState } from '../core/types.ts';
import { TrackerError } from '../core/types.ts';

export type CliIO = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Read for `--body-file -`: a readable stream or a function returning the text. */
  stdin?: AsyncIterable<string | Uint8Array> | (() => string | Promise<string>);
  cwd: string;
  /** Defaults to the real `execFile`-based runner. */
  exec?: Exec;
};

export const USAGE = `Usage: task-board <command> [options]

Commands:
  list [--state <state>] [--ready]      tasks, one per line
  show <id>                             one task with its body
  create --title <t> [--type <x>] [--body-file <f>|-] [--parent <id>] [--state <state>]
         [--blocked-by <id>[,<id>...]]...   blockers: repeat the option or separate ids with commas
  state <id> <state>                    set the state ('done' closes)
  next                                  first ready-for-agent ticket with no open blocker
  close <id> [--with-children]          close a task (and a feature's tickets)
  init <local|github>                   write docs/agents/issue-tracker.md

Options for every command:
  --dir <path>   project root (default: current directory)
  --json         machine-readable output

A value starting with '-' is written with '=': --title=-x

States: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix, done
Exit codes: 0 ok, 2 usage, 3 nothing found, 4 tracker error
`;

const STATES: readonly TaskState[] = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix', 'done'];

const OPTIONS = {
  dir: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  state: { type: 'string' },
  ready: { type: 'boolean' },
  title: { type: 'string' },
  type: { type: 'string' },
  'body-file': { type: 'string' },
  parent: { type: 'string' },
  'blocked-by': { type: 'string', multiple: true },
  'with-children': { type: 'boolean' },
} as const;

type Option = keyof typeof OPTIONS;
type Values = {
  [K in Option]?: (typeof OPTIONS)[K] extends { multiple: true }
    ? string[]
    : (typeof OPTIONS)[K]['type'] extends 'string'
      ? string
      : boolean;
};

/** Command -> its positional count and the options it accepts besides --dir, --json and --help. */
const COMMANDS: Record<string, { positionals: number; options: Option[] }> = {
  list: { positionals: 0, options: ['state', 'ready'] },
  show: { positionals: 1, options: [] },
  create: { positionals: 0, options: ['title', 'type', 'body-file', 'parent', 'state', 'blocked-by'] },
  state: { positionals: 2, options: [] },
  next: { positionals: 0, options: [] },
  close: { positionals: 1, options: ['with-children'] },
  init: { positionals: 1, options: [] },
};
const GLOBAL: Option[] = ['dir', 'json', 'help'];

class UsageError extends Error {}

const usage = (message: string): never => {
  throw new UsageError(message);
};

const toState = (value: string, what: string): TaskState =>
  (STATES as readonly string[]).includes(value) ? (value as TaskState) : usage(`Unknown ${what} "${value}"`);

/** Natural order, so "02-x" < "10-x" and "#7" < "#42". */
const byId = (a: Task, b: Task): number => a.id.localeCompare(b.id, 'en', { numeric: true });

/** A ticket is ready when it is ready-for-agent and every blocker in the list is done. */
const readyTickets = (tasks: Task[]): Task[] => {
  const state = new Map(tasks.map((t) => [t.id, t.state]));
  const open = (id: string): boolean => state.has(id) && state.get(id) !== 'done';
  return tasks
    .filter((t) => t.kind === 'ticket' && t.state === 'ready-for-agent' && !t.blockedBy.some(open))
    .sort(byId);
};

const line = (t: Task): string => `${t.id}  [${t.state}]  ${t.title}\n`;

const readStdin = async (stdin: CliIO['stdin']): Promise<string> => {
  if (stdin === undefined) return '';
  if (typeof stdin === 'function') return stdin();
  let text = '';
  const decoder = new TextDecoder();
  for await (const chunk of stdin) text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
};

const parse = (argv: string[]): { command: string | null; args: string[]; values: Values } => {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    return usage((e as Error).message);
  }
  const values = parsed.values as Values;
  const [command = null, ...args] = parsed.positionals;
  if (values.help) return { command: null, args, values };
  if (command === null) return usage('Missing command');
  const spec = COMMANDS[command];
  if (spec === undefined) return usage(`Unknown command "${command}"`);
  for (const key of Object.keys(values) as Option[]) {
    if (!GLOBAL.includes(key) && !spec.options.includes(key)) usage(`Option --${key} does not apply to ${command}`);
  }
  if (args.length !== spec.positionals) {
    usage(`${command} takes ${spec.positionals} argument${spec.positionals === 1 ? '' : 's'}, got ${args.length}`);
  }
  return { command, args, values };
};

export const main = async (argv: string[], io: CliIO): Promise<number> => {
  let command: string | null;
  let args: string[];
  let values: Values;
  try {
    ({ command, args, values } = parse(argv));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.stderr(`task-board: ${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (command === null) {
    io.stdout(USAGE);
    return 0;
  }

  const json = values.json === true;
  const root = resolve(io.cwd, values.dir ?? '.');
  const exec = io.exec ?? realExec;
  const print = (value: unknown, human: string): void => io.stdout(json ? `${JSON.stringify(value, null, 2)}\n` : human);

  try {
    switch (command) {
      case 'list': {
        const state = values.state === undefined ? undefined : toState(values.state, 'state');
        const all = await (await openTracker(root, exec)).list();
        // Readiness is judged on the full list, so a blocker hidden by --state still counts.
        const ready = values.ready ? new Set(readyTickets(all).map((t) => t.id)) : null;
        const tasks = all.filter((t) => (state === undefined || t.state === state) && (ready === null || ready.has(t.id)));
        print(tasks, tasks.map(line).join(''));
        return 0;
      }
      case 'show': {
        const task = await (await openTracker(root, exec)).get(args[0]!);
        const extra = task.url === null ? '' : `${task.url}\n`;
        print(task, `${line(task)}${extra}\n${task.body.replace(/\s*$/, '\n')}`);
        return 0;
      }
      case 'create': {
        if (values.title === undefined || values.title.trim() === '') usage('create needs --title');
        const state = values.state === undefined ? undefined : toState(values.state, 'state');
        const blockedBy = (values['blocked-by'] ?? []).flatMap((v) => v.split(',')).map((v) => v.trim());
        if (blockedBy.some((id) => id === '')) usage('--blocked-by needs non-empty ids');
        let body: string | undefined;
        const file = values['body-file'];
        if (file === '-') body = await readStdin(io.stdin);
        else if (file !== undefined) {
          try {
            body = await readFile(resolve(io.cwd, file), 'utf8');
          } catch (e) {
            throw new TrackerError('INVALID', `Cannot read body file ${file}: ${(e as Error).message}`);
          }
        }
        const task = await (await openTracker(root, exec)).create({
          title: values.title!,
          ...(body === undefined ? {} : { body }),
          ...(values.type === undefined ? {} : { type: values.type }),
          ...(values.parent === undefined ? {} : { parentId: values.parent }),
          ...(blockedBy.length === 0 ? {} : { blockedBy }),
          ...(state === undefined ? {} : { state }),
        });
        print(task, line(task));
        return 0;
      }
      case 'state': {
        const state = toState(args[1]!, 'state');
        const task = await (await openTracker(root, exec)).setState(args[0]!, state);
        print(task, line(task));
        return 0;
      }
      case 'next': {
        const [task] = readyTickets(await (await openTracker(root, exec)).list());
        if (task === undefined) {
          io.stderr('task-board: no ready ticket (ready-for-agent with no open blocker)\n');
          return 3;
        }
        print(task, `${task.id}  ${task.title}\n`);
        return 0;
      }
      case 'close': {
        const closed = await (await openTracker(root, exec)).close(args[0]!, { withChildren: values['with-children'] === true });
        print(closed, closed.map(line).join(''));
        return 0;
      }
      case 'init': {
        const kind = args[0];
        if (kind !== 'local' && kind !== 'github') return usage(`Unknown tracker "${kind}": use local or github`);
        await writeConfig(root, kind);
        const config = await readConfig(root);
        if (config.tracker !== kind) {
          throw new TrackerError(
            'INVALID',
            `docs/agents/issue-tracker.md already configures the ${config.tracker} tracker; it was left unchanged`,
          );
        }
        print({ tracker: config.tracker }, `Tracker: ${config.tracker} (docs/agents/issue-tracker.md)\n`);
        return 0;
      }
      default:
        return usage(`Unknown command "${command}"`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`task-board: ${e.message}\n\n${USAGE}`);
      return 2;
    }
    const error = e instanceof TrackerError ? e : new TrackerError('FAILED', e instanceof Error ? e.message : String(e));
    // The message always goes to stderr; with --json stdout also carries it as JSON for callers that parse stdout.
    io.stderr(`task-board: ${error.code}: ${error.message}\n`);
    if (json) io.stdout(`${JSON.stringify({ error: { code: error.code, message: error.message } }, null, 2)}\n`);
    return 4;
  }
};
