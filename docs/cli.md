# Agent skills and the `task-board` CLI

The extension installs four agent skills. Their names start with `icf-kanban-`, so they can be installed next to Matt Pocock's skills:

| Skill | For |
|---|---|
| `icf-kanban-create` | Add a task, bug, feature or ticket. |
| `icf-kanban-status` | Report the board, or change a task's state. |
| `icf-kanban-next` | Take the next ready ticket and work on it. |
| `icf-kanban-start` | Work on a named task: show it, claim it, do it, mark it done. |

The skills call the `task-board` CLI, which ships with the extension at `build/cli/task-board.mjs`. Every agent session is told its full path. The CLI needs Node, and `gh` for GitHub; OpenChamber does not have to be running. Matt Pocock's skills (`to-tickets`, `triage` and others) write the same format, so the board shows their tasks too.

```sh
node <extension folder>/build/cli/task-board.mjs <command> [options]
```

## Commands

| Command | What it does |
|---|---|
| `list [--state <s>] [--ready] [--source <id>]` | Tasks, one per line. |
| `show <id>` | One task with its description. |
| `create --title <t> [--type <x>] [--body-file <f>\|-] [--parent <id>] [--state <s>] [--blocked-by <id>,…] [--source <id>]` | Create a task. It goes to the primary source, to `--source`, or with `--parent` always to the parent's source. |
| `state <id> <state>` | Set the state; `done` closes the task. |
| `edit <id> [--title <t>] [--body-file <f>\|-]` | Change the title or description. The id stays. |
| `claim <id>` | Take a `ready-for-agent` sub-task before working on it. |
| `parent <id> <parentId>` | Move an existing task under another parent. Prints the task's id, which changes for a local task because its file moves. |
| `next [--source <id>]` | The first `ready-for-agent` ticket with no open blocker. |
| `close <id> [--with-children]` | Close a task, and a feature's tickets with `--with-children`. |
| `delete <id> [--with-children]` | Delete a task for good. A local feature with tickets needs `--with-children`. On GitHub only repository admins can delete; without `--with-children` sub-issues become top-level issues. |
| `publish <id> [--to github]` | Turn a local task into a GitHub issue (a feature's tickets become sub-issues), then close the local files with a link. |
| `init <local\|github>` | Write `docs/agents/issue-tracker.md` for the primary source. |
| `init --add <id> \| --remove <id> \| --primary <id> [--force]` | Add a source, remove one (nothing is deleted) or make one primary. `--force` replaces a template edited by hand. |

Every command takes `--dir <path>` (the project root, default: the current directory) and `--json` for machine-readable output. A value starting with `-` is written with `=`, as in `--title=-x`. `node build/cli/task-board.mjs --help` prints the full reference.

States: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, `done`.

Exit codes: `0` ok, `2` usage error, `3` nothing found, `4` tracker error.

## Ids

Locally an id is the task's path, such as `.scratch/login/spec.md` (a feature) or `.scratch/login/issues/01-empty-password.md` (a ticket). A task created without `--parent` becomes a feature. On GitHub an id is `#<number>`.

## Sources

`list` and `next` read every source in `issue-tracker.md`, the primary one and any under `## Additional sources`; `--source local` or `--source github` reads only one. Commands on an id go to the source that owns it. A failing source is reported on stderr and the others still list. A parent or blocker in another source is refused.

## Agents in worktrees

An agent usually works in its own git worktree, where `.scratch/` is missing or is a copy the board never reads. Always pass `--dir` with the project root. Sessions started from the board are told this, and the skills do it.
