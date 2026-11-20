---
name: icf-kanban-create
description: Add a task, bug, feature or ticket to the project's task board (ICF-kanban, local .scratch/ files or GitHub Issues) with the task-board CLI. Use when the user asks to add, file, log or create a task, bug, issue or ticket.
---

# Create a task on the board

`task-board` below means `node "<path>"`, the task-board CLI path given in your instructions (fallback: `node <ICF-kanban extension folder>/build/cli/task-board.mjs`). Always pass `--dir <project root>` (the main checkout of the project, where `docs/agents/issue-tracker.md` lives), even in a worktree: there the CLI would miss the tracker or write to a copy the board never reads.

If `docs/agents/issue-tracker.md` is missing, ask the user which tracker they want (local `.scratch/` files or GitHub Issues), then run `task-board init local` or `task-board init github`. Never run `init` without asking.

## Steps

1. Write a short title. Put the description in a body (what, why, acceptance criteria).
2. Create it:
   ```sh
   task-board create --title "Login fails on empty password" --type bug --body-file - <<'EOF'
   What happens, how to reproduce, what should happen.
   EOF
   ```
   - `--type bug` or `--type enhancement`.
   - `--parent <id>` makes it a ticket of that feature. Only tickets are picked up by `next`/`claim`; in a local tracker a task without `--parent` becomes a feature (`spec.md`). Find the feature id with `task-board list`, or create the feature first.
   - `--state ready-for-agent` only when it is fully specified; the default is `needs-triage`.
   - `--blocked-by <id>[,<id>...]` for tickets that must finish first (local: same feature).
   - `--source <id>` (`local` or `github`) when the project has several sources (`## Additional sources` in `docs/agents/issue-tracker.md`). Without it the task goes to the primary source; with `--parent` it always goes to the parent's source. Tasks of different sources are never linked: a parent or blocker in another source is refused (exit code 4).
   - To put an **existing** task under a feature instead of creating a new one: `task-board parent <id> <parentId>`. In a local tracker the id changes (the file moves into the feature); use the id it prints from then on.
3. The command prints `<id>  [state]  title` (with several sources: `<id>  <source>  [state]  title`). Tell the user the id; the card appears on the ICF-kanban board.

Add `--json` when you need the result as data. Exit codes: 0 ok, 2 usage, 4 tracker error (message on stderr).

If Matt Pocock's skills (`to-tickets`, `triage`) are installed, they write the same format; either tool may be used and the board shows both.
