# Permissions and stored data

OpenChamber asks you to approve these permissions when you install the board.

| Permission | What the board uses it for |
|---|---|
| `sessions` | Reads session lists to place cards in In Progress and Review, and opens a task's session. |
| `prompt` | Starts an agent session through OpenChamber. |
| `model` | Writes card summaries and suggests a type and state for new tasks with your model. |
| Service (`service/main.js`, runs on your machine) | Reads and writes the tracker files (`docs/agents/issue-tracker.md` and `.scratch/**`) and keeps its own files in `~/.icf-kanban/`. |
| Service programs `git`, `gh`, `opencode` | `git` finds the GitHub remote and the project of a worktree, and creates worktrees for sessions the extension starts. `gh` does everything on GitHub Issues. `opencode` lists models, thinking levels and agents (read only). |
| Session control | Lets the service start sessions and read their status, also while the board is closed. |
| Session events | When a session finishes or fails a turn, the service starts the next queued card. |
| Instructions | Adds one paragraph to every agent session: where the `task-board` CLI is and its main commands. |
| Skills | Installs the four `icf-kanban-*` agent skills. |

## Where data is kept

| What | Where |
|---|---|
| Tasks | Your tracker only: `.scratch/` files or GitHub Issues. |
| Which session works on which card | `~/.icf-kanban/links.json` |
| The start queue | `~/.icf-kanban/queue.json` |
| Settings, presets, card options, summaries, card order, archive marks | The extension's storage in OpenChamber, per user |

The board never reads or writes OpenChamber's own files. Worktrees created by the extension go in `<parent>/<repo>-worktrees/`, next to your project folder, on `icf/*` branches.
