# ICF-kanban (ICF OpenChamber Kanban board): design (draft)

Status: draft, waiting for approval.

## Intent

A Kanban board for OpenChamber that works with the same task files as Matt Pocock's skills, so Kamil sees and moves the same work the agents see. Per project the user picks the tracker: local files (`.scratch/`) or GitHub Issues. Dragging a card to In Progress starts an agent session with preset settings, without a dialog. Agents get their own skills to create tasks, change status, take the next task and start it.

Goals:
- One source of truth per project: the tracker (local files or GitHub). The board stores no task data of its own.
- Compatible with Matt's `setup-matt-pocock-skills` format (`docs/agents/issue-tracker.md`, `triage-labels.md`, `.scratch/<feature>/issues/NN-slug.md`, GitHub labels and sub-issues).
- Agent skills work without Matt's skills installed, and the same format is written either way.
- Settings in three layers: global defaults, per-project override, choice on the card.
- Short summary at the top of each task, in the language and style the user sets. Each user has their own summary, so several people on one project don't clash.

Non-goals (v1):
- All-projects view (Q6).
- A tracker other than Local and GitHub. The adapter interface leaves room for GitLab (Q22).
- Automatic pickup of ready tasks (Q4). Only tasks the user moves start.
- Automatic merge or worktree cleanup (Q14).
- Creating Matt's triage categories or states beyond the defaults.
- Task templates per type and custom prompt structure for the body of tasks (Q12, postponed). Only the summary is configurable.

Anti-goals:
- Writing to OpenChamber's internal files (goals, storage). Only the official SDK and the extension's own storage.
- Hiding the source format from the user. Anyone can open the `.scratch` file or the GitHub issue and see the same thing as on the board.

## Constraints

- OpenChamber `>=2.7.1` (needed for `contributes.skills`, the companion plugin and `sessionControl`). Installed here: 2.7.1.
- Extension sandbox: the panel can read and write only the open project (`files`) and talks to the outside only through the service. The service runs with the user's full access.
- `startSession` in the SDK accepts `worktree` (`true`, `{kind:'new', name?, baseBranch?}`, `{kind:'existing', directory}`), `projectId`, text, and model/agent.
- Starting sessions while the window is closed (needed for the queue, Q20) requires `sessionControl` in the service. That is a separate, approved capability.
- `gh` CLI 2.94+ for `--parent` and sub-issues. Dependencies use the GitHub API (as Matt describes them).
- Licence: MIT, open source. The kanban it is based on has no LICENSE file, so the code is written from scratch and nothing is copied from it.

## Approaches

1. **Panel + service, with a core library (chosen).** One TypeScript core with two adapters (local, GitHub). The core is used by three things: the panel (through the service), a CLI for agents (`task-board`), and the service that starts sessions and runs the queue. Pro: one format implementation, agents don't need OpenChamber running to create or move a task. Con: more code to write.
2. Forking the kanban and swapping the storage layer. Rejected: its storage is OpenChamber's internal file (Kamil rejected that in the kanban case), it has no licence, and the core flow (auto-Review, session tracking) would have to be rewritten anyway.
3. Using the SDK `tracker` role (SDK 2.7). Rejected for v1: that role is for item trackers with accounts such as Linear. Local `.scratch` files aren't a tracker. The GitHub adapter could use it, but then GitHub gets a different path from local, and the board's behaviour would depend on OpenChamber's tracker support.

Chosen: option 1.

## Design

### Project configuration (shared, in the repo)

- `docs/agents/issue-tracker.md`: written by the project setup wizard, in Matt's format. Records `local` or `github`.
- `docs/agents/triage-labels.md`: written only if the user keeps the `triage` skill. Defaults as in Matt's skill.
- Local format: `.scratch/<feature>/spec.md` (the parent) and `.scratch/<feature>/issues/NN-slug.md` (children), following `issue-tracker-local.md`. Status line: `Status:` with `ready-for-agent`, `resolved` etc. Blocking line: `Blocked by:`.
- Type: the category role `bug` or `enhancement` as in Matt's skill. Added types (Chore, Research, and others) are written as a `Type:` line in the file, and as a label on GitHub. Feature = `enhancement`.

### Board columns (mapping to Matt)

| Column | Local file | GitHub |
|---|---|---|
| Backlog | `needs-triage`, `needs-info`, no state yet | label `needs-triage` / `needs-info` / no label |
| Ready | `Status: ready-for-agent` | label `ready-for-agent` |
| In Progress | session linked and running, stored in the extension | same; session link in the extension storage |
| Review | session finished or asks a question, stored in the extension | same |
| Done | `Status: resolved` | issue closed |

`ready-for-human` and `wontfix` are shown as badges on the card, not as columns (Q3).

In Progress and Review are not written to the repo, because Matt's format has no such states. They come from the session link. This keeps the repo format compatible.

### Parents and children

- A parent is a feature: `spec.md` locally, a parent issue on GitHub (sub-issues). A child is a ticket.
- The parent is a card too. It shows the number of children and progress (done / total).
- Dragging the parent to In Progress starts one orchestrator session, with the preset set to "Break down and orchestrate" by default. The orchestrator creates children if there are none, takes them through the CLI, and delegates to subagents. Child cards show their status and a "orchestrator leads" badge. Children don't get their own sessions on the board.
- Closing the parent (Done) also closes all children (`resolved` locally, closed on GitHub). The user can also hide child cards on the board (Q16).
- Goal: not set. The initial prompt says to work until all children are done (Q17).

### Presets and start settings

- A preset is a named block of instructions added to the start prompt. Built-in: Plan, Prototype, Implement, Implement without questions, Break down and orchestrate (Q13). The user can edit them and create their own.
- Each card has: preset, model, agent, location, and optional summary language. Location defaults to a new worktree (`worktree: true`, to be checked against OpenChamber's "Quick worktree").
- Three layers: global defaults (per user) → project override (per user) → choice on the card. Settings are stored in the extension's storage, not in the repo (Q19).
- Default preset per type: Feature → Implement, Bug → Implement, Research → Plan.
- Auto-start is on by default. Moving a card to In Progress starts the session at once, with the card's settings. It can be turned off in settings, in which case the card opens a small start form (Q5).

### Queue

- Per project, a limit on running sessions (default 3, editable). Cards moved over the limit wait in In Progress, marked "queued", and start when a slot frees up (Q20).
- The queue covers only cards the user moved, not tasks picked up on their own.
- The service runs the queue, so it keeps working with the window closed (`sessionControl`).

### Summaries

- Generated with `host.generate` (the user's small model). Prompt editable in settings, with a default. Language per user setting (default Polish, as the user asked).
- Stored in the extension storage per user, keyed by task id plus a hash of the body. A changed body means the summary is regenerated.
- Generated automatically when a card first appears or its body changes. Can be turned off, leaving only a "Summarise" button (Q18).
- Not written to the repo. Agents don't see summaries, they read the full task.

### Agent skills and CLI

- The extension ships skills with `contributes.skills`: `task-board-create`, `task-board-status`, `task-board-next`, `task-board-start`. Names are distinct from Matt's skills to avoid clashes.
- They call the CLI `task-board` (in the extension folder). It implements the same core as the panel, using the local adapter or `gh`.
- Agents use these skills whenever Matt's skills aren't installed. When both are installed, both write the same format (Q8).
- The CLI doesn't need OpenChamber running, so agents can use it in any session.

### Tracker adapters

- Interface: list, get, create, set state, add child, set blocked-by, close (with children).
- Local: reads and writes the files (format above).
- GitHub: `gh issue ...`, `gh issue edit --add-sub-issue`, `gh api` for dependencies. Auth uses the user's own `gh` login (Q21). The setup wizard runs `gh auth status` and says what to do if it fails.
- Both adapters are tested with the same test suite. The GitHub adapter is tested against a fake `gh` script.

### Setup wizard

- On first open of a project without `docs/agents/issue-tracker.md`: pick Local or GitHub. Writes the file in Matt's format. Creates the GitHub labels that are missing. Does not start a session (the "setup" skill is not needed).

## What is left to the builder

- Layout of the board (columns, drag, filter by type, child-card hiding).
- Summary prompt default text (Polish, a few sentences, plain style).
- Built-in preset texts.
- Error handling for `gh` failures and for a file the board can't parse (skip with a warning, as the kanban does).

## Decided after the grilling

1. Name: ICF-kanban, extension id `icf-kanban`. Repo: `krzeznicki/ICF-OpenChamber-Kanban-board`, private until Kamil is happy with a version, then public.
2. Licence: MIT.
3. Minimum OpenChamber version: 2.7.1.
4. Which SDK worktree option matches "Quick worktree": verified by the builder before the start code is written.
5. The README is written during the work, with screenshots, as a deliverable of the project.

## Prior art (for the record)

- OpenChamber Kanban (mannu150). Our starting point: auto-Review and session tracking. Not forked (no licence, storage in OpenChamber's internals).
- GitHub Task Board (Workflows-Accelerator). GitHub only, and it didn't see repos in our setup.
