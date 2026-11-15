# Changelog

## 0.1.0 (unreleased)

First version.

- Kanban board (rail panel and full-screen page) over local `.scratch/` files or GitHub Issues, in Matt Pocock's skill format, with a setup wizard for new projects.
- Columns Backlog, Ready, In Progress, Review, Done; In Progress and Review come from linked sessions and are never written to the repository.
- Drag to In Progress starts an agent session: path A through OpenChamber, or path B through the service (model or agent set on the card, or a queued start), which makes its own git worktree under `<repo>-worktrees/` when the location is a new worktree.
- Parents start one orchestrator session; sub-tasks show progress and "led by orchestrator".
- Presets (five built-in, editable, plus your own) and settings in three layers: global, project, card.
- Start queue with a per-project limit, kept in `~/.icf-kanban/queue.json` and drained after session events while the board is closed.
- Personal card summaries written by your model, in your language (default Polish).
- Agent skills `icf-kanban-create`, `icf-kanban-status`, `icf-kanban-next`, `icf-kanban-start`, the `task-board` CLI, and an instructions paragraph for every session.

Fixed before release (final review):

- Agents in a worktree reach the tracker: the first message, the instructions and the skills always pass `--dir <project root>` to the CLI.
- Claim wording: sub-tasks are created `ready-for-agent`, claim needs `ready-for-agent`, a ticket started from the board is not claimed, and `icf-kanban-start` checks `claimed` before claiming.
- A failed path B start removes the worktree and `icf/*` branch it created; a queued card stops being retried after three failed starts; a start whose link could not be saved counts as started (no duplicate session).
- GitHub setup needs a github.com remote (the wizard disables GitHub without one); remote URLs are shown without credentials.
- Dragging a card with a session to Backlog or Ready detaches it from that session instead of snapping back.
- `THIRD_PARTY_LICENSES` with `@openchamber/sdk`'s MIT licence.
