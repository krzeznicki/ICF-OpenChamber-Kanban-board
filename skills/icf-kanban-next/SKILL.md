---
name: icf-kanban-next
description: Pick the next ready task from the project's task board (ICF-kanban) and work on it, using the task-board CLI. Use when the user says "take the next task", "what should I work on", "work through the board" or "continue with the backlog".
---

# Take the next ready task

`task-board` below means `node "<path>"`, the task-board CLI path given in your instructions (fallback: `node <ICF-kanban extension folder>/build/cli/task-board.mjs`). Always pass `--dir <project root>` (the main checkout of the project, where `docs/agents/issue-tracker.md` lives), even in a worktree: there the CLI would miss the tracker or write to a copy the board never reads.

If `docs/agents/issue-tracker.md` is missing, ask the user which tracker they want (local `.scratch/` files or GitHub Issues), then run `task-board init local` or `task-board init github`. Never run `init` without asking.

## Steps

1. Find the ready tickets (ready-for-agent, no open blocker), lowest id first:
   ```sh
   task-board list --ready
   ```
   With several sources each line names its source (`local`, `github`); `--source <id>` reads only that one. Skip lines marked `claimed`: another agent has them. `task-board next` prints the first ready ticket, claimed or not. Exit code 3 means nothing is ready: tell the user and stop.
2. Take the first unclaimed one exactly as the `icf-kanban-start` skill says: `task-board show <id>`, `task-board claim <id>`, do the work, then `task-board state <id> done`.
3. Take another only if the user asked you to work through the board.

To put a task under another feature or parent issue, use `task-board parent <id> <parentId>` and go on with the id it prints (in a local tracker the id changes).

Never pick a `needs-triage`, `needs-info` or `ready-for-human` task: those wait for a person.
