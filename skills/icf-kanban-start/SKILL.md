---
name: icf-kanban-start
description: Start work on a specific task from the project's task board (ICF-kanban) - show it, claim it, do it and mark it done with the task-board CLI. Use when the user names a task, ticket or issue id to work on, or after icf-kanban-next picked one.
---

# Work on a specific task

`task-board` below means `node "<path>"`, the task-board CLI path given in your instructions (fallback: `node <ICF-kanban extension folder>/build/cli/task-board.mjs`). Always pass `--dir <project root>` (the main checkout of the project, where `docs/agents/issue-tracker.md` lives), even in a worktree: there the CLI would miss the tracker or write to a copy the board never reads.

If `docs/agents/issue-tracker.md` is missing, ask the user which tracker they want (local `.scratch/` files or GitHub Issues), then run `task-board init local` or `task-board init github`. Never run `init` without asking.

## Steps

1. Read it: `task-board show <id>` (body, state, blockers; `--json` for fields). The first line reads `[<state>, claimed]` when someone already claimed it (`"claimed": true` in `--json`).
2. If it is already claimed, stop and ask the user before going on. If the board started this session and its prompt says you don't need to claim it, skip to step 3. Otherwise claim it before any work: `task-board claim <id>`.
   - Only a `ready-for-agent` ticket can be claimed. On exit code 4, stop and tell the user (the reason is on stderr); do not change the state yourself to get around it.
3. Do the work the body describes, including its acceptance criteria and tests.
4. Finish:
   - Done: `task-board state <id> done` (for a feature with all tickets finished: `task-board close <id> --with-children`).
   - Needs a person's decision or input: `task-board state <id> needs-info` or `ready-for-human`, and say why in your reply.
5. Tell the user the id and the new state; the ICF-kanban board shows the same.

Exit codes: 0 ok, 2 usage, 3 nothing found, 4 tracker error (message on stderr).
