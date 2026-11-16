# Kanban Board (ICF-kanban)

A Kanban board for [OpenChamber](https://github.com/openchamber/openchamber) over your project's own task files. It reads and writes the format used by Matt Pocock's agent skills: local Markdown files in `.scratch/`, or GitHub Issues. You and your agents work on the same tasks.

- One source of truth per project: the tracker. The board keeps no task data of its own.
- Drag a card to **In Progress** and an agent session starts with the card's preset, model, thinking level, agent and location. No dialog unless you want one.
- Parents (features) start one orchestrator session that works through their sub-tasks.
- A limit on agents running at once, with a queue that keeps draining while the board is closed.
- A short personal summary at the top of each card, in your language (default English).
- Agent skills and a `task-board` CLI, so agents create, take and close tasks in the same format.

Requires OpenChamber 2.7.1 or later. Licence: MIT.

## Screenshots

Not taken yet: the extension has to be running in OpenChamber. To do, saved in [`docs/screenshots/`](docs/screenshots/):

- [ ] `rail-icon.png`: the **Kanban Board** icon in the side rail
- [ ] `board.png`: the board with cards in every column
- [ ] `card-detail.png`: the task modal: state, type and Move to under the header, summary, the task as formatted markdown, Settings collapsed, **Open session** at the top
- [ ] `settings.png`: the Settings sheet
- [ ] `wizard.png`: the setup wizard (Local or GitHub)

## Install

The repository is private for now.

**From a local folder.** Clone the repository, then in OpenChamber open **Settings → Extensions** and install from that folder. A link with the folder's absolute path also works, but only inside an OpenChamber chat, where it is drawn as an install button:

```
openchamber://extensions/install?path=/absolute/path/to/ICF-OpenChamber-Kanban-board
```

Install from a separate clone, not from the folder of a project you use the board on. A folder install runs from the folder itself, and any write inside the package reloads the extension.

**From the git URL** (once the repository is published): in **Settings → Extensions**, install from `https://github.com/krzeznicki/ICF-OpenChamber-Kanban-board`. OpenChamber copies it into its own extensions folder. This link works from anywhere (OpenChamber asks before it installs):

```
openchamber://extensions/install?url=https://github.com/krzeznicki/ICF-OpenChamber-Kanban-board
```

Nothing is built on install: the built files (`panel/main.js`, `service/main.js`, `build/cli/task-board.mjs`) are committed.

OpenChamber asks you to approve the permissions below. The board opens from the **Kanban Board** icon in the side rail, or full screen as **Kanban Board** from the sidebar's Extension pages menu.

## Permissions

| Permission | What Kanban Board uses it for |
|---|---|
| `sessions` | Reads the session lists to place cards in In Progress and Review, and opens a task's session from its modal. |
| `prompt` | Starts an agent session from a card (path A, see [Starting agents](#starting-agents)). |
| `model` | Writes the card summaries with your model (`generate`). |
| Service (`service/main.js`, runs on your machine) | Reads and writes the project's tracker files: `docs/agents/issue-tracker.md` and `.scratch/**`. Keeps its own files in `~/.icf-kanban/`: `links.json` (which session works on which card) and `queue.json` (the start queue). |
| Service programs: `git`, `gh`, `opencode` | `git remote -v` to suggest GitHub in the wizard (and to refuse GitHub setup without a github.com remote); `git worktree add` for path B starts, which creates a `<parent>/<repo>-worktrees/` folder next to the project and `icf/*` branches in the repository (a start that fails removes its worktree and branch again with `git worktree remove` and `git branch -D`). `gh` for everything on GitHub Issues: issues, labels, sub-issues, dependencies. `opencode api GET /api/model` and `GET /api/agent` (read only; `opencode models` as a fallback) to list the models, thinking levels and agents the pickers offer. |
| Session control (`sessionControl`) | The service starts sessions itself (path B) and reads their status, also while the board is closed. |
| Session events (`turn-finished`, `turn-failed`) | When a session finishes or fails a turn, the service starts the next queued card. |
| Instructions | One paragraph added to every agent session: where the `task-board` CLI is and its main commands. |
| Skills | Four agent skills: `icf-kanban-create`, `icf-kanban-status`, `icf-kanban-next`, `icf-kanban-start`. |

Settings, presets, per-card options and summaries are kept in the extension's storage in OpenChamber, per user, never in the repository. Kanban Board never reads or writes OpenChamber's own files.

## Tracker setup

When you open a project that has no `docs/agents/issue-tracker.md`, the board shows a setup wizard: pick **Local** or **GitHub** (GitHub is preselected when the project has a github.com remote, and cannot be picked without one) and press **Set up board**.

- **Local** writes `docs/agents/issue-tracker.md` for local Markdown. Tasks live in `.scratch/<feature>/spec.md` (the feature, a parent) and `.scratch/<feature>/issues/NN-slug.md` (its tickets), with `**Status:**`, `**Blocked by:**` and an optional `**Type:**` line.
- **GitHub** first checks that the folder has a github.com remote, and that `gh` is installed, version 2.94 or later, and logged in; if not, nothing is written and the board says what to fix. Then it writes `docs/agents/issue-tracker.md` for GitHub and creates the triage labels and the `bug` / `enhancement` labels the repository does not have yet. Parents are issues with sub-issues; blockers are GitHub issue dependencies.

An existing `issue-tracker.md` is never overwritten. If the project already uses Matt Pocock's `setup-matt-pocock-skills`, the board reads its files as they are, including the label names in `docs/agents/triage-labels.md`. Kanban Board does not write `triage-labels.md`.

Types: `bug` and `enhancement` (a feature), plus your own (`chore` and `research` by default). Locally a type is the `**Type:**` line; on GitHub it is the `bug` / `enhancement` label or a `type:<name>` label.

## Columns and Matt's states

| Column | Local file | GitHub | Dropping a card here |
|---|---|---|---|
| Backlog | `Status:` `needs-triage`, `needs-info`, `ready-for-human`, `wontfix` or none | the same labels, or no state label | sets `needs-triage` |
| Ready | `Status: ready-for-agent` | label `ready-for-agent` | sets `ready-for-agent` |
| In Progress | a linked session is running, or the card is queued or starting | the same | starts an agent (or queues it) |
| Review | the linked session finished, or waits for a permission or an answer | the same | not allowed: set by the session |
| Done | `Status: resolved` | issue closed (shown for 30 days) | closes the task |

- In Progress and Review are never written to the repository: Matt's format has no such states. They come from the session linked to the card.
- `ready-for-human` and `wontfix` show as badges on the card in Backlog.
- A claimed ticket (`Status: claimed` locally, an assignee on GitHub) stays `ready-for-agent`.
- To start a Done card, move it back to Backlog or Ready first.
- To close a task, drag it to Done or use **Move to → Done** under its modal's header (the × at the top right only closes the modal, as does Escape).
- A drop on Backlog or Ready changes one line of the task file (local) or swaps the state label (GitHub). The rest of the file is left as it is.
- Dragging a card out of In Progress or Review to Backlog or Ready detaches it from its session: the card follows its state again, and the session keeps running (open it from the session list). Starting the card again later links it to the new session.
- Drag a card up or down its own column to reorder it: a line shows where it goes. The order is kept in the board's own storage per project (nothing changes in the repository or on GitHub); cards never reordered keep the tracker's order, below the reordered ones. Deleted tasks, and tasks the tracker no longer lists, drop out of it. Sub-tasks stay right under their parent. In its own column, only the middle of a card makes the dragged card its sub-task; the top and bottom edges reorder.

### Archiving done tasks

**Archive done** in the Done column's header clears the column: after an in-panel confirm with the count, every done task (sub-tasks hidden by **Hide sub-tasks** too) leaves the board. Nothing changes in the repository or on GitHub — done tasks are already resolved or closed; the board only remembers the archived ids per project in the extension's storage (`archivedTasks:<projectId>`, `{ id, archivedAt }[]`, the newest 400 kept).

- **Show archived (N)** in the Done header draws them again, muted and marked `archived` (until the panel reloads). Their modal has **Unarchive**, which puts the task back in Done.
- A task that leaves Done (reopened by hand, by the CLI or on GitHub) is unarchived on its own; ids the tracker no longer lists (e.g. issues closed more than 30 days ago) are dropped on the next load. Such a task loses its archive mark: if the tracker lists it again and it is still done, it shows in Done again.
- A parent's progress (`3/5 sub-tasks done`) still counts its archived done sub-tasks.

## Adding tasks

**Add task** in the toolbar opens a modal with everything a task can carry:

- **Title** (required), **Type**, **State** (the open states only) and **Parent** (none, or an open parent). Locally, no parent creates a feature (`.scratch/<feature>/spec.md`); a parent creates a ticket under it.
- **Blocked by**: tick the tasks it waits for. Locally only open tickets of the chosen feature are offered (the format resolves blockers within a feature), so a new feature takes none; on GitHub any open issue except the chosen parent. A filter appears when the list is long.
- **Description**: markdown.
- **Start options**: preset, location, model, thinking, agent and summary language for this card, each showing what it would inherit. They are stored with the card (`card:<projectId>:<taskId>`) as soon as the task exists, as if set in its modal. They appear once the project's settings have loaded.
- **Sub-tasks**: rows of titles (Enter adds the next row), created in order under the new task right after it: tickets of the new feature locally, sub-issues on GitHub. Locally the list is hidden when a parent is chosen, because a ticket cannot have sub-tasks.

The service's error shows inside the modal and nothing is lost. If the task was created but some sub-tasks were not, the modal names the ones that failed (with the reason) and offers only Close; add them later from the task's **Sub-tasks** section. The board reloads once at the end.

Closing a form you have filled in (Escape, a click beside it, × or Cancel) first asks **Discard this task?**; an untouched form closes at once.

### Type and state suggested by your Small Model

**Type** and **State** start on **Let the model pick**. A field left there is filled in by your Small Model (OpenChamber's `host.generate`, `model` permission; extensions cannot reach OpenChamber's decision model): the task is created as `needs-triage` with no type, then the board sends the title and description once, as data, asking for one JSON object `{"type", "state"}`: a type from the board's types and one of `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`. When the board has the `research` type, the model is told to pick it for a task that is not described completely enough to implement; research starts with Plan, and once it has added sub-tasks the task defaults to Break down and orchestrate. An answer that is anything else (prose around it, another value, an extra key) is ignored whole. Pick a type, **No type** or a state yourself and the model leaves that field alone.

Right before writing, the board reads the task again and only sets a field the task still has as created (no type; `needs-triage`): if you changed it meanwhile (or are moving the card just then), yours stays. Sub-tasks created in the same form keep their state; a type is picked for them, and for tasks made elsewhere (the CLI, agents, GitHub), only when their summary is generated (see [Summaries](#summaries)). The request shares the summaries' limit (two model requests at a time from the panel) and is not cached. If no Small Model is set, the permission is missing, or the answer is unusable, the fields keep their defaults and one quiet notice per panel session says so. Suggestions and summaries share what is known about the model: once either finds it missing (or not granted) there is one notice for both, automatic summaries stop and the form stops offering **Let the model pick** until a model answers again (press **Summarise** in a task after choosing one) or the panel reopens. An answer that arrives after the panel was closed is dropped, since the task may have changed by then. **Settings → Global → Suggest type and state for new tasks** (on by default, for every project) turns it off; the form then starts on `enhancement` (when the board has it) and `needs-triage`, as before.

## The task modal

A click on any card (or Enter on a focused card) opens the task in a modal, in every column; a click never jumps to a session. Reading comes first:

- **Header**: title, id, state and type badges and the × close. **Open session** opens the task's agent session (running, waiting or finished) when it has one that is not archived; **Session archived** says that its only session was archived; **Session not listed in OpenChamber** that the board knows a session for it that no project lists (it is never opened). **Edit** turns the Task section into a form for the title and the description (markdown); locally the heading's number, the `Type` / `Status` / `Blocked by` lines and the `## Comments` / `## Answer` sections are kept and not shown in it, and the file keeps its name (the id stays). Save writes only the fields you changed, and only if they still read as when the form opened: when an agent changed the title or description meanwhile, the form says so and keeps your text (copy it, cancel and edit again) instead of overwriting theirs. **Delete** asks first and deletes the task for good: locally its file (a ticket's number is dropped from the `Blocked by` lines of its feature), and for a feature the whole folder with `spec.md` and every ticket (refused while the folder holds other files); on GitHub `gh issue delete`, which only repository admins may run (close the issue otherwise), either keeping its sub-issues as top-level issues or deleting the whole tree under it (closed sub-issues and their sub-issues too, deepest first). The task's session links, queued start, start options and place in the card order go with it. While the board is open, the rest of the page is inactive: Tab stays in the modal.
- **State, Type, Parent and Move to**: a compact row right under the header, always shown (not a section): the state and type selects and the **Move to** buttons (the keyboard path for drag and drop; **Done** asks about open sub-tasks). The selects sit side by side and wrap under each other in a narrow rail panel. **Parent** (shown when the task has a parent or may move under one) moves the task under another open parent; **No parent** unlinks it, so it becomes a top-level task. On GitHub the issue keeps its number. Locally a ticket cannot stay a ticket without a feature, so it moves out into a feature of its own (`.scratch/<slug>/spec.md`, a suffix when the name is taken): it gets a new id, its `Blocked by` line and its feature's blockers on it are dropped, and a claimed ticket becomes `ready-for-agent`. Its session links, queued start, start options and card position follow the new id, and the open modal follows it.
- **Summary**: the personal summary (see [Summaries](#summaries)), or a **Summarise** button.
- **Task**: the full body as formatted markdown: headings, lists, task-list checkboxes (read-only), code, quotes, tables, links. Raw HTML in a body is shown as text; only `http` and `https` links are links, opened in your browser; images are not loaded but shown as links.
- **Sub-tasks**: the children with their states (a click opens that task); **Unlink** next to one asks first, then removes it from this parent as **No parent** does. Below, one **Add sub-task** button opens the adder with two tabs: **New task** (a title and an optional type; Enter adds, the form stays open for the next one) and **Existing tasks** (a list of the open tasks that may be linked under this one, with checkboxes and a **Filter** field when there are more than 8; **Link selected** links the checked ones one after another and names any that failed; only what the tracker accepts is offered). Only the tab that applies shows when the other has nothing to offer; **Cancel** folds it back to the button. New sub-tasks are offered locally on open features (`spec.md`), since a ticket cannot have tickets, and on GitHub on any open issue, which then becomes a parent.
- **Settings**, collapsed by default: **Open on GitHub** and the card's start options. It is hidden when it would be empty (a local task with no start options, such as a done one).

Sections fold open and shut; which ones are open is remembered for every task in the extension's storage (key `detail-sections`, the default instance storage kept on the connected OpenChamber server, so every browser connected to it shares it).

The session behind **Open session** is checked before it opens. A session the board knows only from `~/.icf-kanban/links.json` (path B) is looked up in every project's session list first and opens only when it is there and not archived. (In 0.1 a click on a Review or Done card whose session had been archived opened an unrelated session of another project: the link's live status reads `idle` for an archived session too, and OpenChamber was asked to open an id it no longer listed.) The board also looks up such finished link-only sessions on its own (once per panel session): one found archived no longer places its card, which leaves Review for the column of its tracker state. Those ids are remembered per project in the extension's storage (`archivedSessions:<projectId>`, only while a link still names them).

### The rail panel opens this chat's task

Opened from the **Kanban Board** icon beside a chat, the board shows what that chat's session works on, once it has loaded:

- one task: its modal opens;
- several tasks: a **Tasks in this session** list with each task's column (or state); a click opens the task;
- none: an info banner above the board, **No task on this board is being worked on in this session**, with **Dismiss**.

A task counts when the session was started from its card (OpenChamber's start, or the service's in `links.json`), unless the card was dragged away from it to Backlog or Ready afterwards. It happens once per opening of the panel; switching chats while the panel stays open changes nothing. The full-screen page and a panel with no session open the board as before. When the chat runs in a worktree outside every registered project, the board shows the project the session belongs to.

## Parents and orchestration

A parent (a feature with sub-tasks) is a card too, with its progress (`2/5 sub-tasks done`). Sub-tasks are drawn indented under their parent when both sit in the same column; **Hide sub-tasks** in the toolbar hides them.

**Search tasks** in the toolbar narrows the board to cards whose title or description holds every word typed (case and accents ignored; a local file is searched without its field lines). A matching sub-task keeps its parent on the board for context. Only this panel session remembers the search; Escape clears it.

The field also takes filters: `type:` (the task's type), `state:` (its tracker state), `column:` (the board column) and `status:` (the column when the value names one, as `status:ready`, otherwise the state, as `status:info`), with `:` or `=`. A value matches from its start or the start of one of its words, so `state:info` finds `needs-info` and `column:prog` finds In Progress. Repeating a key means either (`type:bug type:research`); everything else must all hold (`type:research status:backlog login`). A list under the field completes keys and values as you type: arrows select, Enter or Tab picks.

Dragging a parent that has sub-tasks to In Progress starts one orchestrator session with the **Break down and orchestrate** preset (unless the card picks another; a parent without sub-tasks starts with its type's preset, or pick orchestrate on its card to have it broken down). The orchestrator creates sub-tasks if there are none, claims them through the CLI and hands them to subagents. While it runs, its sub-tasks show **led by orchestrator**, a claimed one sits in In Progress, and dropping one of them on In Progress starts nothing. Moving a parent with open sub-tasks to Done asks whether to close them too.

## Starting agents

A card starts with its **preset**, **model**, **thinking** level, **agent** and **location** (a new worktree, the default, or the project folder). There are two ways the start happens:

- **Path A** (no model, thinking level or agent set, on the card or in the settings): the board calls OpenChamber's own start. OpenChamber makes the worktree (when the location is a new worktree), the session is linked to the card, and it runs on the model, thinking level and agent currently selected in your composer. That is what the pickers' **Default — OpenChamber's current selection** means.
- **Path B** (any of model, thinking level or agent set, and every queued card the service starts; also a task whose id is longer than 128 characters, too long to link to the session the path A way): when the location is a new worktree, the service creates it itself with `git worktree add -b icf/<slug> <parent>/<repo>-worktrees/<slug>` (with the project folder it makes none); it then starts the session with that model, thinking level (OpenCode's `variant`) and agent, and records the link in `~/.icf-kanban/links.json`. If the session cannot be started, the new worktree and branch are removed again.

The first message tells the agent how to move the task with the `task-board` CLI, always with `--dir <project root>`: the agent usually works in its own worktree, where the CLI would otherwise not find the tracker (GitHub) or would write to a copy of `.scratch/` the board never reads (local). A ticket started from the board does not need to be claimed; an orchestrator claims each sub-task it takes, which needs the sub-task to be `ready-for-agent`.

With **Start at once** off, dropping a card on In Progress opens a small form to adjust the options before it starts.

## Presets

A preset is a block of instructions added to the agent's first message; a **preset set** is a named list of presets. Three sets are built in, each with the same seven presets (same ids, so a card's choice and the preset per type work in any set):

| Preset | Plain | Matt Pocock's skills | Superpowers |
|---|---|---|---|
| Plan | Plan first; write no code until you approve the plan. | `/grill-with-docs` to sharpen the task; for a multi-session build `/to-spec` and `/to-tickets` drafts, published with `task-board create` as a feature with sub-tasks; the feature id is noted on the task, which is set done if the feature replaces it. | `brainstorming` (one question at a time, the approaches, an approved design doc), then `writing-plans`; stops at the plan's handoff and publishes the design as a feature and each plan task as a ticket with `task-board create`; the feature id, design and plan are noted on the task. |
| Prototype | A quick, throwaway prototype that answers the task's question. | `/prototype` on a `prototype/<name>` branch made in the session's worktree; the answer is noted on the task. | `brainstorming` only to sharpen the one question (no design doc or plan), throwaway code on a `prototype/<name>` branch; the answer is noted on the task. |
| Implement | Implement with tests; ask when a decision is unclear. The default. | `/implement`, which drives `/tdd` and closes with `/code-review`. | `test-driven-development`, then `verification-before-completion` and `requesting-code-review` of the diff since the start commit; asks the user when something unclear would change what gets built. |
| Implement without questions | The same, choosing the simplest option instead of asking, listing every assumption. | `/implement`, deciding the skills' questions itself and listing every assumption. | The same skills, no `brainstorming`; unclear points decided and listed as assumptions, review findings acted on without asking. |
| Break down and orchestrate | Split into tickets, hand them to subagents, work until all are done. The default for tasks with sub-tasks. | `/to-tickets` drafts published with `task-board create --parent` if there are no sub-tasks, then `/implement-spec` over them as a task graph (`/tdd` per ticket, one `/code-review`); `claim` and `state … done` through the CLI. | `writing-plans` if there are no sub-tasks (each plan task published with `task-board create --parent`), then `subagent-driven-development` over the sub-tasks on the session's branch (with existing sub-tasks and no plan file, it first writes one under `docs/superpowers/plans/` from the sub-tasks, one plan task each); `claim` and `state … done` through the CLI. |
| Diagnose | Reproduce the bug, find the cause, fix it with a regression test. The default for bugs. | `/diagnosing-bugs`, then the fix through `/implement` (`/tdd`, `/code-review`); no correct seam for the test is reported as the finding; debug logs and throwaway code removed. | `systematic-debugging` to the root cause, the fix through `test-driven-development` (the repro as a regression test), `verification-before-completion`; three failed fixes stop and go to the user. |
| Triage | Evaluate a raw task: reproduce, decide its state, write a brief or questions. No code. | `/triage`, the brief or notes on the task, then `task-board state` (wontfix too); no direct relabel or close. | The plain text. |

**Which set.** Settings → Global → **Preset set** picks it for every project, and Settings → This project → **Preset set** for one project. Without a choice the set follows what is installed: Matt Pocock's skills when all of them are found, else Superpowers when all of its skills are found, else Plain. A set whose skills are missing can still be chosen: it is marked "(skills missing)", the line under the picker names the missing ones, and sessions are still told to run them. A chosen set that was deleted is skipped: a project's choice falls back to the global one, the global one to that default. This replaces 0.2's "Use Matt Pocock's skills when installed" switch: switched off, it reads as the Plain set.

**Where skills are found.** The service looks for `<name>/SKILL.md` in `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills`, the project's `.opencode/skills` and `.claude/skills`, then OpenCode's plugin cache `~/.cache/opencode/npm/*/*/node_modules/superpowers/skills` (where the Superpowers plugin keeps its skills; newest version folder first). It only reads, the first folder in that order wins, results are cached 5 minutes per project, and it never reads `~/.config/openchamber`. The board checks when a project opens. Matt's set needs `grill-with-docs`, `grilling`, `domain-modeling`, `to-spec`, `to-tickets`, `prototype`, `implement`, `implement-spec`, `tdd`, `code-review`, `diagnosing-bugs` and `triage`; Superpowers needs `brainstorming`, `writing-plans`, `test-driven-development`, `verification-before-completion`, `requesting-code-review`, `subagent-driven-development` and `systematic-debugging`. The prompt lists the SKILL.md of each skill the preset uses, for a harness that cannot load a skill by name.

The agent usually runs in a fresh worktree, where `docs/agents/` and `.scratch/` are missing or a copy the board never reads. So every skills text tells it that the tracker lives at the project root (`<root>/docs/agents/issue-tracker.md`), never to run a setup skill (such as `/setup-matt-pocock-skills`), and to make every tracker write through the `task-board` CLI with `--dir` (`create` for new tasks, `state`, `claim`); a note on the task goes to the root's issue file (local) or `gh issue comment` (GitHub), so the board follows. The Superpowers texts also say to work in the worktree the board made for the session, if any (skip `using-git-worktrees`, do not create another; on main/master the skill's rule applies: ask before building there) and not to run `finishing-a-development-branch` or merge, push or open a pull request: what happens to the branch is your call.

A preset text (built-in or your own) may use `{cli}` (the `task-board` command with `--dir`), `{root}` (the project root), `{tracker}` (the root's `docs/agents/issue-tracker.md`), `{id}` (the task) and `{note}` (how to add a note to the task); they are filled in when the session starts, each path and id quoted for the shell when it holds a space or a quote.

**Settings → Presets** shows one set at a time (the **Set** picker; it opens on the project's set). You can edit any preset of any set (**Reset** brings a built-in's shipped text back), add, rename and delete your own presets in a set, and add your own sets with **New set**: a copy of the shown set (its texts as they read now, edits included; each preset keeps the skills it runs, so its session is still told where each SKILL.md is and the line under the picker checks those skills) or an empty one. Your own sets can be renamed (**Set name**) and deleted (**Delete set**); every preset in them is yours to rename and delete. A card whose preset is not in the project's set (deleted, or a set that lacks it) starts with the set's Implement, or Plain's Implement when the set has none.

Edits and your own sets are kept in the extension's storage under `presetSets`. 0.2's `presets` value is moved there once: its edits and own presets go to every built-in set (Matt Pocock's skills, Superpowers and Plain), since in 0.2 they applied whichever text was in use. So whichever set a project uses — the default still follows what is installed; no set is chosen for you — a session runs the text you wrote and your own presets are there.

Which preset a card gets: the card's own choice, else Break down and orchestrate for a task that has sub-tasks, else the preset for its type (`enhancement` → Implement, `bug` → Diagnose, `research` → Plan), else the default preset; a preset the project's set does not have becomes Implement. A task without sub-tasks gets its type's preset even when it is a parent (in the local tracker every top-level task is one), so a research task starts with Plan and switches to orchestrate by itself once it has added sub-tasks.

## Settings

Three layers, each overriding the one before, field by field:

1. **Global** (Settings → Global): your defaults for every project.
2. **This project** (Settings → This project): overrides for the open project; a field left at **Use global** inherits.
3. **The card** (its modal, Settings → Start options): preset, location, model, thinking, agent and summary language for that card.

All of them are per user and stored in the extension's storage.

**Model**, **Thinking** and **Agent** are picked from lists, not typed, in every place start options are set (the card, Add task, the start form, Settings → Global and This project). The lists are what OpenCode's server reports for the project (`opencode api GET /api/model` and `GET /api/agent`; when the model request fails, `opencode models`, which has no names or thinking levels). Each list is fetched the first time a picker needs it in that project, then kept for the panel session, one list per project; the service caches it for 10 minutes.

- **Model** shows the models by name (the `provider/model` id beside it); type to filter by name or id, arrows and Enter to pick.
- **Thinking** offers the chosen model's thinking levels (OpenCode's variants, e.g. low, high, max). It is disabled until a model is set here or inherited, for a model without levels, and when the levels are unknown (the `opencode models` fallback: "Thinking levels unavailable"). A layer (or card) that sets a model also owns the thinking level: its own, or none, never a level inherited from another model. Changing the model (or going back to the default, which brings the inherited model back) drops a level the model then in force does not offer, the start form clears such a stale level when it opens, and a level without any model is ignored. A level set on a card over an inherited model is checked again when the card starts: if that model is known not to offer it (the inherited model changed since), the session starts without it and a notice says so.
- **Agent** offers the session agents (primary, not hidden, e.g. Build and Plan).

The first entry of each, **Default (…)**, means "not set here" and names what it falls back to; when nothing is set anywhere it reads **Default — OpenChamber's current selection** (for Thinking with a model set: the model's default). A line under the start options says it: a set model, thinking level or agent makes the extension start the session itself (path B, its own worktree), none set leaves it to OpenChamber (path A). To use a model or agent for one project only, set it in **This project**. A stored value that is no longer listed still shows, marked "not in the list" (a thinking level the model lacks: "not offered by this model"). If a list cannot be loaded, the picker says why and tries again the next time it opens.

| Setting | Default |
|---|---|
| Start at once | on |
| Sessions at a time | 3 (1 to 10) |
| Default preset | Implement |
| Location | New worktree |
| Model / Thinking / Agent | OpenChamber's current selection (path A) |
| Preset set | Matt Pocock's skills if all are installed, else Superpowers if all are installed, else Plain |
| Preset per type | `enhancement` → Implement, `bug` → Diagnose, `research` → Plan |
| Hide sub-tasks | off |
| Types | `enhancement`, `bug`, `chore`, `research` |
| Summarise automatically | on |
| Summary language | English |
| Summary prompt | a built-in prompt (2 to 4 plain sentences); `{language}`, `{title}` and `{body}` are filled in |
| Suggest type and state for new tasks (Global only) | on |

## Queue

**Sessions at a time** limits how many agents run in a project at once. A card dropped on In Progress over the limit waits there with a **Queued** badge and starts when a slot frees up, oldest first. Only cards you move are queued; nothing is picked up on its own.

The queue lives in `~/.icf-kanban/queue.json`. While the board is open it drains on every change of the session list. With the board closed, the service drains it when a session in that project finishes or fails a turn, and starts those cards by path B. A start OpenChamber refuses with 503 (a new worktree's folder is not loaded yet) is tried again in the same worktree after 1, 3 and 6 seconds. A start that still fails puts the card back at the front of the queue with the reason shown on the card; it is tried again on the next drain. After three failed starts it stays queued with the error but is no longer tried on its own: move it out of In Progress and back to try again. A queued card's first message is built when it is queued, so edits to the task or its preset made while it waits are not included. A linked session that was deleted, or a link older than a day whose status cannot be read, never holds a slot.

## Summaries

Each card can show a few plain sentences at the top, written by your model through OpenChamber (`model` permission). They are personal: stored in the extension's storage per user, never in the repository, and agents never see them. A summary is regenerated when the task's body, the language or the prompt changes. With **Summarise automatically** off, use the **Summarise** button in the task modal. The language can be set per card. Without a Small Model (or the `model` permission) automatic summaries stop after the first try, with one notice shared with the type and state suggestions.

When a summary is generated (not read back from storage) for an open task with no type, the board also asks the Small Model for its type in a separate request, the one **Let the model pick** sends (the summary prompt is not changed): `research` when the task is not described completely enough to implement, otherwise the board type that fits best. Only the type is written, and only if the task still has none right before the write; the state stays. Never for a done or `wontfix` task, a board without types, or a task you created with **No type** in Add task (remembered per project in the extension's storage, `noType:<projectId>:<taskId>`, following the task to a new id and dropped when it is deleted). At most once per description in a panel session, and quiet: an unusable answer just leaves the task without a type. A type cannot be cleared in the task modal, so a type you set is never replaced. **Suggest type and state for new tasks** turns this off too.

## Agent skills and the `task-board` CLI

The extension ships four skills, named apart from Matt Pocock's so both can be installed:

| Skill | For |
|---|---|
| `icf-kanban-create` | Add a task, bug, feature or ticket. |
| `icf-kanban-status` | Report the board or change a task's state. |
| `icf-kanban-next` | Take the next ready ticket and work on it. |
| `icf-kanban-start` | Work on a named task: show, claim, do, mark done. |

They call the CLI at `build/cli/task-board.mjs` inside the extension folder; the instructions paragraph gives agents its full path. It needs Node and, for GitHub, `gh`; OpenChamber does not have to be running. When Matt's skills (`to-tickets`, `triage`) are installed too, both write the same format and the board shows both.

```
node <extension folder>/build/cli/task-board.mjs <command> [options]
```

```
Usage: task-board <command> [options]

Commands:
  list [--state <state>] [--ready]      tasks, one per line
  show <id>                             one task with its body
  create --title <t> [--type <x>] [--body-file <f>|-] [--parent <id>] [--state <state>]
         [--blocked-by <id>[,<id>...]]...   blockers: repeat the option or separate ids with commas
  state <id> <state>                    set the state ('done' closes)
  edit <id> [--title <t>] [--body-file <f>|-]
                                        change the title and/or the description (local: the
                                        heading number, Status/Type/Blocked by and ## Comments stay)
  claim <id>                            take a sub-task before working on it (orchestrator)
  parent <id> <parentId>                make an existing task a sub-task of another (prints its id,
                                        which changes in a local tracker: the file moves)
  next                                  first ready-for-agent ticket with no open blocker
  close <id> [--with-children]          close a task (and a feature's tickets)
  init <local|github>                   write docs/agents/issue-tracker.md

Options for every command:
  --dir <path>   project root (default: current directory)
  --json         machine-readable output

A value starting with '-' is written with '=': --title=-x

States: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix, done
Exit codes: 0 ok, 2 usage, 3 nothing found, 4 tracker error
```

Ids are paths locally (`.scratch/login/issues/01-empty-password.md`, `.scratch/login/spec.md`) and `#<number>` on GitHub. Locally, a task created without `--parent` becomes a feature (`spec.md`). Only a `ready-for-agent` ticket can be claimed.

`parent <id> <parentId>` links an existing task under an existing parent. On GitHub it sets the native parent (`gh issue edit --parent`, replacing an old one) and the number stays. Locally the file moves: a ticket of another feature becomes the parent feature's next ticket (renumbered; its `Blocked by` numbers are dropped, and its old feature's tickets that listed it lose that blocker), and a feature with no tickets becomes a ticket and its folder is removed. A feature with tickets or with other files in its folder, a ticket as the parent, the task itself, its current parent or (GitHub) one of its own descendants are refused (exit 4). The new id is printed; the board's session links and queued start follow it.

`edit <id>` changes the title (`--title`) and/or the description (`--body-file`, `-` for stdin). The id stays, also locally (the file is not renamed); locally the description replaces only the text under the heading, so the heading's number, the `Type` / `Status` / `Blocked by` lines and the `## Comments` / `## Answer` sections stay.

## Limits

Found while building it (see [the session-start findings](docs/superpowers/specs/2026-11-15-session-start-findings.md)):

- **Path A uses your current model.** OpenChamber's own start has no model, thinking or agent field: a card with none of them set runs on whatever your composer has selected when it starts.
- **Path B makes its own worktree.** A card with a model, thinking level or agent set (and every card the service starts from the queue) whose location is a new worktree gets a worktree made with `git` under `<parent>/<repo>-worktrees/`, on a branch `icf/<slug>`, not by OpenChamber's Quick worktree. Such sessions may look different in the sidebar.
- **With the board closed, the queue drains only by path B.** Queued cards then run with the model, thinking level and agent they were queued with, or OpenCode's default when none is set.
- Worktrees of started sessions are never merged or removed for you (only the worktree of a path B start that failed is removed).
- The open live checks below have not been done yet.

## Manual checks before first release

Not done yet; each needs the extension installed in OpenChamber:

1. Install from a folder and approve the permissions; the board opens in the rail and as a page.
2. The setup wizard, for Local and for GitHub (including the `gh` checks and label creation).
3. Drag and drop: moving a card changes one line of the file (`git diff` shows a one-line change) or swaps the state label on GitHub.
4. Path A with a new worktree: same name, branch and location as OpenChamber's Quick worktree?
5. Path B: does the session show under the project with its worktree, and is the model applied?
6. The queue with the board closed: does a queued card start when a running session finishes?
7. Deleting a linked session still lets the queue drain.
8. Summaries: generated automatically, regenerated after a body edit, the Summarise button, per-card language.
9. Agent skills: an agent finds the CLI from the instructions and creates, claims and closes a task with the skills.
10. The task modal: a Review card whose path B session was archived shows **Session archived** and opens nothing; **Open session** on a live path B session in a worktree opens that session.
11. Archive done: the confirm counts the done tasks; after it Done is empty in both the rail panel and the full-screen page; **Show archived** and **Unarchive** work; reopening an archived task (CLI or GitHub) brings it back without a click.
12. Type and state suggested: a task added with both on **Let the model pick** gets a type and state from the Small Model a moment later; one with a type picked keeps it; with no Small Model set, one notice and the form stops offering it.
13. Search tasks: typing filters the cards in both the rail panel and the page, a sub-task match shows its parent, Escape clears it, and dragging still works while filtered (a card dropped at the end of a filtered column goes after the hidden cards too). Filters (`type:research status:backlog`) and their completion list: arrows, Enter/Tab, Escape closes the list before clearing the field.
14. The rail panel in a chat: a chat started from one card opens that card's modal; from an orchestrator and a second card, the list; a chat started by hand, the banner; a chat in an OpenChamber worktree shows its own project.

## Development

```sh
npm install
npm run check   # typecheck + tests + build
```

`npm run build` bundles with esbuild: the panel to `panel/main.js` (IIFE), the service to `service/main.js` and the CLI to `build/cli/task-board.mjs` (ESM). Commit the built files with the sources: installs never build.

Before a release, check the package with OpenChamber's checker. On Node 26 it cannot run from `node_modules` directly (Node will not strip types there), so copy it out first:

```sh
D=$(mktemp -d); mkdir $D/scripts
cp node_modules/@openchamber/sdk/scripts/check-guest.ts $D/scripts/
ln -s $PWD/node_modules/@openchamber/sdk/dist $D/dist
echo '{"type":"module"}' > $D/package.json
node $D/scripts/check-guest.ts $PWD   # must print "Package is ready"
```

### Trying a branch: the Kanban TEST build

Production is installed from the Git URL `https://github.com/krzeznicki/ICF-OpenChamber-Kanban-board` (branch `main`; OpenChamber offers an update when `version` rises). To try changes before they reach `main`, build a separate test extension next to it:

1. Check out your branch and make the change.
2. `npm run build:test` builds **Kanban TEST** (id `icf-kanban-test`, version `<version>-test.g<short sha>`) into `~/openchamber-extensions/icf-kanban-test`, outside every repo and worktree. Another folder: `npm run build:test -- --out <dir>` or `KANBAN_TEST_OUT=<dir>`. The folder is emptied and rewritten on each build; a folder that has files but no `.kanban-test-build` marker (so it was not written by build:test), or one inside the repo, is refused.
3. Install it once: in an OpenChamber chat, `openchamber://extensions/install?path=<the output folder>`, or **Settings → Extensions** → install from that folder. After that, each `npm run build:test` reloads the installed test build.
4. Test it. Production keeps running untouched next to it.
5. Open a PR to `main` with a `version` bump (and the rebuilt production bundles from `npm run check`). Once merged, users update from **Settings → Extensions**.

The test build shares nothing with production: its own extension id (OpenChamber keeps settings and storage per extension), a **TEST** badge in the board's toolbar and its own icon and name (sessions it starts carry its panel id), data in `~/.icf-kanban-test/` (links, queue) instead of `~/.icf-kanban/`, worktree branches `icf-test/<slug>` instead of `icf/<slug>`, skills `kanban-test-create/status/next/start`, and agent instructions that name its own CLI and say to use it only when you ask for the TEST board. Only the output folder gets the test bundles: the bundles committed in the repo are always built as production (`npm run build`). Both builds work on the same project trackers (`.scratch/` or GitHub Issues), which are the project's own data.

The design is in [docs/superpowers/specs/2026-11-15-task-board-design.md](docs/superpowers/specs/2026-11-15-task-board-design.md).

## Licence

MIT. See [LICENSE](LICENSE). The built panel and service include `@openchamber/sdk` (MIT); its licence is in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).
