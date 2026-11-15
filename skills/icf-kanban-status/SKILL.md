---
name: icf-kanban-status
description: Report the state of the project's task board (ICF-kanban) or change a task's state with the task-board CLI. Use when the user asks what tasks there are, what is ready, blocked or done, or to move, triage, reopen or close a task.
---

# Board status and state changes

`task-board` below means `node "<path>"`, the task-board CLI path given in your instructions (fallback: `node <ICF-kanban extension folder>/build/cli/task-board.mjs`). Run it in the project root or add `--dir <root>`.

If `docs/agents/issue-tracker.md` is missing, ask the user which tracker they want (local `.scratch/` files or GitHub Issues), then run `task-board init local` or `task-board init github`. Never run `init` without asking.

## Read

```sh
task-board list                        # every open task: <id>  [state, claimed]  title
task-board list --state needs-triage   # one state
task-board list --ready                # ready-for-agent tickets with no open blocker
task-board show <id>                   # one task with its body
```

Summarise by state for the user: ready, claimed (in progress), waiting (needs-info, ready-for-human), needs-triage. Add `--json` to read fields such as `blockedBy`, `parentId` and `url`.

## Change

```sh
task-board state <id> ready-for-agent   # needs-triage | needs-info | ready-for-agent | ready-for-human | wontfix | done
task-board close <id> --with-children   # close a feature and all its tickets
```

`done` closes the task. Change a state only when the user asked for it or the work you did justifies it, and say what you changed. The ICF-kanban board in OpenChamber shows the same tasks.

Exit codes: 0 ok, 2 usage, 3 nothing found, 4 tracker error (message on stderr).
