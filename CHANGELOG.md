# Changelog

## 0.2.0 (unreleased)

- Shown as **Kanban Board** (rail panel and full-screen page), with its own icon (`assets/kanban.svg`). The extension id stays `icf-kanban`, so settings and storage are kept.
- The detail and Settings sheets close with an × at the top right (or Escape) instead of a "Done" button.
- The model is picked from a searchable list of the available models (`opencode models`, through the service's new `/models/list`, cached 10 minutes) in the card's start options, the start form and Settings, instead of typed. The first entry, "Default (…)", keeps the inherited model; a stored model that is no longer listed still shows as "not in the list".
- **Permissions change:** the service may now also run `opencode` (`service.permissions.exec`: `git`, `gh`, `opencode`), which the approval dialog lists (Settings → Extensions). It only lists the models.
- The detail sheet's Close / Close with sub-tasks buttons are gone: close a task by dragging it to Done or with Move to → Done, which still asks about open sub-tasks.
- A click on any card opens the task as a large modal (it fills the rail panel): header with **Open session** or "Session archived", then collapsible Summary, Task (the body as formatted markdown via `markdown-it`, raw HTML shown as text, only http(s) links, images not loaded, read-only task-list checkboxes), Sub-tasks and Settings (collapsed by default: state, type, Move to, Open on GitHub, start options). Open sections are remembered on the device. The cards' Details button is gone.
- Fixed: a click on a Review or Done card whose session had been archived opened an unrelated session of another project. A click no longer opens a session; **Open session** opens only a session listed by OpenChamber and not archived (a session known only from `links.json` is looked up in every project first; one no project lists shows "Session not listed in OpenChamber"). A card whose link-only session is found archived leaves Review for its tracker state's column; found ids are kept per project in storage. The board behind the modal is inert while it is open.
- **Add task** opens a modal (on the task modal's shell) instead of the inline form: title, type, state, parent, blocked by (only valid choices: open tickets of the chosen feature locally, open issues on GitHub), markdown description, the card's start options, and sub-tasks created in order under the new task. Errors show in the modal; a partial failure names the sub-tasks that were not created. Escape, a backdrop click, × or Cancel on a filled form asks "Discard this task?" first.
- The task modal's Sub-tasks section has **Add sub-task** (local: open features; GitHub: any open issue, which becomes a parent).
- Presets use Matt Pocock's skills when they are installed: each built-in has a skills version (Plan → `/grill-with-docs`, `/to-spec`, `/to-tickets`; Prototype → `/prototype` on a `prototype/<name>` branch; Implement and Implement without questions → `/implement` with `/tdd` and `/code-review`; Break down and orchestrate → `/to-tickets`, `/implement-spec`), used when every skill it names (and, for Plan and Triage, `grilling` and `domain-modeling`) is found. The skills text points the skills at the tracker at the project root and makes every tracker write go through the `task-board` CLI with `--dir` (the session's worktree has no tracker the board reads), and the prompt lists each skill's SKILL.md. Preset texts may use `{cli}`, `{root}`, `{tracker}`, `{id}` and `{note}`; every path and id is quoted for the shell when it holds a space or a quote. New built-ins **Diagnose** (`/diagnosing-bugs`, then `/implement`) and **Triage** (`/triage`), each with plain instructions too. A bug defaults to Diagnose when its skills are installed. The service's new `/skills/detect` (names and SKILL.md paths) looks in `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` and the project's `.opencode/skills` and `.claude/skills` (cached 5 minutes). **Settings → Global → Use Matt Pocock's skills when installed** (on by default) turns it off; Settings lists the skills found and what each built-in runs with. An edited built-in keeps your text.
- **Archive done** in the Done header (with an in-panel confirm showing the count) hides every done task from the board; **Show archived (N)** draws them again muted, and their modal offers **Unarchive**. Only the extension's storage changes (`archivedTasks:<projectId>`); a reopened task is unarchived automatically and ids the tracker no longer lists are pruned on load. A parent's progress still counts archived sub-tasks.
- The panel bundle now includes `markdown-it` and its dependencies (see THIRD_PARTY_LICENSES).

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
