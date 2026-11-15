---
name: icf-kanban-start
description: Start work on a specific task from the project's task board (ICF-kanban) - show it, claim it, do it and mark it done with the task-board CLI. Use when the user names a task, ticket or issue id to work on, or after icf-kanban-next picked one.
---

# Work on a specific task

`task-board` below means `node "<path>"`, the task-board CLI path given in your instructions (fallback: `node <ICF-kanban extension folder>/build/cli/task-board.mjs`). Run it in the project root or add `--dir <root>`.

If `docs/agents/issue-tracker.md` is missing, ask the user which tracker they want (local `.scratch/` files or GitHub Issues), then run `task-board init local` or `task-board init github`. Never run `init` without asking.

## Steps

1. Read it: `task-board show <id>` (body, state, blockers; `--json` for fields).
2. Claim it before any work: `task-board claim <id>`.
   - Only a `ready-for-agent` ticket can be claimed. Exit code 4 with "Only a ready-for-agent task can be claimed" or "not a feature/parent": stop and tell the user; do not change the state yourself to get around it.
   - Already `claimed` by someone else: ask the user before going on.
3. Do the work the body describes, including its acceptance criteria and tests.
4. Finish:
   - Done: `task-board state <id> done` (for a feature with all tickets finished: `task-board close <id> --with-children`).
   - Needs a person's decision or input: `task-board state <id> needs-info` or `ready-for-human`, and say why in your reply.
5. Tell the user the id and the new state; the ICF-kanban board shows the same.

Exit codes: 0 ok, 2 usage, 3 nothing found, 4 tracker error (message on stderr).
