# ICF-kanban

A Kanban board for [OpenChamber](https://github.com/openchamber/openchamber) over your project's own task files. It reads and writes the format used by Matt Pocock's agent skills: local Markdown files in `.scratch/`, or GitHub Issues. You and your agents work on the same tasks.

- One source of truth per project: the tracker. The board keeps no task data of its own.
- Drag a card to **In Progress** and an agent session starts with the card's preset, model and location. No dialog unless you want one.
- Parents (features) start one orchestrator session that works through their sub-tasks.
- A limit on agents running at once, with a queue that keeps draining while the board is closed.
- A short personal summary at the top of each card, in your language (default Polish).
- Agent skills and a `task-board` CLI, so agents create, take and close tasks in the same format.

Requires OpenChamber 2.7.1 or later. Licence: MIT.

## Screenshots

Not taken yet: the extension has to be running in OpenChamber. To do, saved in [`docs/screenshots/`](docs/screenshots/):

- [ ] `board.png`: the board with cards in every column
- [ ] `card-detail.png`: a card's detail sheet with its summary
- [ ] `settings.png`: the Settings sheet
- [ ] `wizard.png`: the setup wizard (Local or GitHub)

## Install

The repository is private for now.

**From a local folder.** Clone the repository, then in OpenChamber open **Settings → Extensions** and install from that folder, or open this link with the folder's absolute path:

```
openchamber://extensions/install?path=/absolute/path/to/ICF-OpenChamber-Kanban-board
```

Install from a separate clone, not from the folder of a project you use the board on. A folder install runs from the folder itself, and any write inside the package reloads the extension.

**From the git URL** (once the repository is published): in **Settings → Extensions**, install from `https://github.com/krzeznicki/ICF-OpenChamber-Kanban-board`. OpenChamber copies it into its own extensions folder.

Nothing is built on install: the built files (`panel/main.js`, `service/main.js`, `build/cli/task-board.mjs`) are committed.

OpenChamber asks you to approve the permissions below. The board opens from the **ICF-kanban** icon in the side rail, or full screen as **Board** from the sidebar's Extension pages menu.

## Permissions

| Permission | What ICF-kanban uses it for |
|---|---|
| `sessions` | Reads the session list to place cards in In Progress and Review, and opens a card's session. |
| `prompt` | Starts an agent session from a card (path A, see [Starting agents](#starting-agents)). |
| `model` | Writes the card summaries with your model (`generate`). |
| Service (`service/main.js`, runs on your machine) | Reads and writes the project's tracker files: `docs/agents/issue-tracker.md` and `.scratch/**`. Keeps its own files in `~/.icf-kanban/`: `links.json` (which session works on which card) and `queue.json` (the start queue). |
| Service programs: `git`, `gh` | `git remote -v` to suggest GitHub in the wizard; `git worktree add` for path B starts. `gh` for everything on GitHub Issues: issues, labels, sub-issues, dependencies. |
| Session control (`sessionControl`) | The service starts sessions itself (path B) and reads their status, also while the board is closed. |
| Session events (`turn-finished`, `turn-failed`) | When a session finishes or fails a turn, the service starts the next queued card. |
| Instructions | One paragraph added to every agent session: where the `task-board` CLI is and its main commands. |
| Skills | Four agent skills: `icf-kanban-create`, `icf-kanban-status`, `icf-kanban-next`, `icf-kanban-start`. |

Settings, presets, per-card options and summaries are kept in the extension's storage in OpenChamber, per user, never in the repository. ICF-kanban never reads or writes OpenChamber's own files.

## Tracker setup

When you open a project that has no `docs/agents/issue-tracker.md`, the board shows a setup wizard: pick **Local** or **GitHub** (GitHub is preselected when the project has a github.com remote) and press **Set up board**.

- **Local** writes `docs/agents/issue-tracker.md` for local Markdown. Tasks live in `.scratch/<feature>/spec.md` (the feature, a parent) and `.scratch/<feature>/issues/NN-slug.md` (its tickets), with `**Status:**`, `**Blocked by:**` and an optional `**Type:**` line.
- **GitHub** first checks that `gh` is installed, version 2.94 or later, and logged in; if not, nothing is written and the board says what to fix. Then it writes `docs/agents/issue-tracker.md` for GitHub and creates the triage labels and the `bug` / `enhancement` labels the repository does not have yet. Parents are issues with sub-issues; blockers are GitHub issue dependencies.

An existing `issue-tracker.md` is never overwritten. If the project already uses Matt Pocock's `setup-matt-pocock-skills`, the board reads its files as they are, including the label names in `docs/agents/triage-labels.md`. ICF-kanban does not write `triage-labels.md`.

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
- A drop on Backlog or Ready changes one line of the task file (local) or swaps the state label (GitHub). The rest of the file is left as it is.

## Parents and orchestration

A parent (a feature with sub-tasks) is a card too, with its progress (`2/5 sub-tasks done`). Sub-tasks are drawn indented under their parent when both sit in the same column; **Hide sub-tasks** in the toolbar hides them.

Dragging a parent to In Progress starts one orchestrator session with the **Break down and orchestrate** preset (unless the card picks another). The orchestrator creates sub-tasks if there are none, claims them through the CLI and hands them to subagents. While it runs, its sub-tasks show **led by orchestrator**, a claimed one sits in In Progress, and dropping one of them on In Progress starts nothing. Closing a parent with open sub-tasks asks whether to close them too.

## Starting agents

A card starts with its **preset**, **model**, **agent** and **location** (a new worktree, the default, or the project folder). There are two ways the start happens:

- **Path A** (a card with no model and no agent set): the board calls OpenChamber's own start. OpenChamber makes the worktree, the session is linked to the card, and it runs on the model and agent currently selected in your composer.
- **Path B** (a card with a model or agent set, and every queued card the service starts): the service creates the worktree itself with `git worktree add -b icf/<slug> <parent>/<repo>-worktrees/<slug>`, starts the session with that model and agent, and records the link in `~/.icf-kanban/links.json`.

With **Start at once** off, dropping a card on In Progress opens a small form to adjust the options before it starts.

## Presets

A preset is a block of instructions added to the agent's first message. Built in:

| Preset | Use |
|---|---|
| Plan | Plan first; write no code until you approve the plan. |
| Prototype | A quick, throwaway prototype that answers the task's question. |
| Implement | Implement with tests; ask when a decision is unclear. The default. |
| Implement without questions | The same, choosing the simplest option instead of asking, listing every assumption. |
| Break down and orchestrate | Split into tickets, hand them to subagents, work until all are done. The default for parents. |

In **Settings → Presets** you can edit the built-in texts (**Reset** brings the original back) and add, rename and delete your own. A card whose preset was deleted falls back to Implement.

Which preset a card gets: the card's own choice, else Break down and orchestrate for a parent, else the preset for its type (`enhancement` → Implement, `bug` → Implement, `research` → Plan), else the default preset.

## Settings

Three layers, each overriding the one before, field by field:

1. **Global** (Settings → Global): your defaults for every project.
2. **This project** (Settings → This project): overrides for the open project; a field left at **Use global** inherits.
3. **The card** (its detail sheet, Start options): preset, location, model, agent and summary language for that card.

All of them are per user and stored in the extension's storage.

| Setting | Default |
|---|---|
| Start at once | on |
| Sessions at a time | 3 (1 to 10) |
| Default preset | Implement |
| Location | New worktree |
| Model / Agent | your current model / agent |
| Preset per type | `enhancement` and `bug` → Implement, `research` → Plan |
| Hide sub-tasks | off |
| Types | `enhancement`, `bug`, `chore`, `research` |
| Summarise automatically | on |
| Summary language | Polish |
| Summary prompt | a built-in prompt (2 to 4 plain sentences); `{language}`, `{title}` and `{body}` are filled in |

## Queue

**Sessions at a time** limits how many agents run in a project at once. A card dropped on In Progress over the limit waits there with a **Queued** badge and starts when a slot frees up, oldest first. Only cards you move are queued; nothing is picked up on its own.

The queue lives in `~/.icf-kanban/queue.json`. While the board is open it drains on every change of the session list. With the board closed, the service drains it when a session in that project finishes or fails a turn, and starts those cards by path B. A start that fails puts the card back at the front of the queue with the reason shown on the card; it is tried again on the next drain. A linked session that was deleted, or a link older than a day whose status cannot be read, never holds a slot.

## Summaries

Each card can show a few plain sentences at the top, written by your model through OpenChamber (`model` permission). They are personal: stored in the extension's storage per user, never in the repository, and agents never see them. A summary is regenerated when the task's body, the language or the prompt changes. With **Summarise automatically** off, use the **Summarise** button in the card's detail sheet. The language can be set per card.

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
  claim <id>                            take a sub-task before working on it (orchestrator)
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

## Limits

Found while building it (see [the session-start findings](docs/superpowers/specs/2026-11-15-session-start-findings.md)):

- **Path A uses your current model.** OpenChamber's own start has no model or agent field: a card without a model or agent runs on whatever your composer has selected when it starts.
- **Path B makes its own worktree.** A card with a model or agent set (and every card the service starts from the queue) gets a worktree made with `git` under `<parent>/<repo>-worktrees/`, on a branch `icf/<slug>`, not by OpenChamber's Quick worktree. Such sessions may look different in the sidebar.
- **With the board closed, the queue drains only by path B.** Queued cards then run with the model and agent stored on the card, or the session default when none is set.
- Worktrees are never merged or removed for you.
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

The design is in [docs/superpowers/specs/2026-11-15-task-board-design.md](docs/superpowers/specs/2026-11-15-task-board-design.md).

## Licence

MIT. See [LICENSE](LICENSE).
