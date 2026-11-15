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
