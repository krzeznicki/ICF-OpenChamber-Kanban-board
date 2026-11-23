# Agents

Dropping a card on In Progress starts an agent session for the task. The session gets the card's **preset**, **model**, **thinking level**, **agent** and **location**: a new worktree (the default) or the project folder. With **Start at once** turned off in Settings, a short form lets you adjust these before the session starts.

## How a session starts

There are two ways, and the board picks one for you:

- **Through OpenChamber (path A).** When the card has no model, thinking level or agent set, anywhere in its settings, the board calls OpenChamber's own start. OpenChamber creates the worktree and the session runs with whatever model, thinking level and agent your chat composer has selected. The pickers call this **Default — OpenChamber's current selection**.
- **Through the extension (path B).** When any of model, thinking level or agent is set, and for every card started from the queue, the extension's service starts the session itself. For a new worktree it runs `git worktree add -b icf/<slug> <parent>/<repo>-worktrees/<slug>`, next to your project folder. If the session fails to start, the worktree and branch are removed again.

The first message tells the agent which task to work on, the preset's instructions, and how to update the task with the `task-board` CLI. The agent always passes `--dir <project root>`, because its worktree has no copy of the tracker the board reads.

Worktrees and branches of sessions that started are never merged or removed for you.

## Presets

A preset is a block of instructions added to the agent's first message. There are seven built-in presets:

| Preset | What the agent does |
|---|---|
| Plan | Plans first and writes no code until you approve the plan. |
| Prototype | Builds a quick, throwaway prototype that answers the task's question. |
| Implement | Implements with tests and asks when a decision is unclear. |
| Implement without questions | The same, choosing the simplest option and listing every assumption. |
| Break down and orchestrate | Splits the task into sub-tasks, hands them to subagents and works until all are done. |
| Diagnose | Reproduces a bug, finds the cause and fixes it with a regression test. |
| Triage | Evaluates a raw task and sets its state, with a brief or questions. Writes no code. |

### Preset sets

Each preset exists in three sets, which differ in how the agent does the work:

- **Matt Pocock's skills**: the presets run [Matt Pocock's skills](https://github.com/mattpocock/skills), for example `/grill-with-docs`, `/to-spec` and `/to-tickets` for Plan, `/implement` with `/tdd` and `/code-review` for Implement, and `/diagnosing-bugs` for Diagnose.
- **Superpowers**: the presets run [Superpowers](https://github.com/obra/superpowers) skills, for example `brainstorming` and `writing-plans` for Plan, `test-driven-development` for Implement, `subagent-driven-development` for orchestration and `systematic-debugging` for Diagnose.
- **Plain**: the instructions alone, no skills.

Without a choice, the board uses Matt Pocock's skills if all of them are installed, otherwise Superpowers if all of its skills are, otherwise Plain. Pick a set in **Settings → Global → Preset set**, or per project in **Settings → This project**. You can choose a set whose skills are missing; Settings names the missing ones.

The board looks for skills (`<name>/SKILL.md`) in `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills`, the project's `.opencode/skills` and `.claude/skills`, and the Superpowers plugin in OpenCode's cache. The first message lists the path of each SKILL.md the preset uses, for agents that cannot load a skill by name.

Every skills preset tells the agent where the tracker is, never to run a setup skill such as `/setup-matt-pocock-skills`, and to make every tracker change through the `task-board` CLI. The Superpowers presets also tell the agent to work in the worktree the board created and not to merge, push or open a pull request; that stays your decision.

### Editing presets

**Settings → Presets** shows one set at a time. You can edit any preset (**Reset** restores a built-in text), add your own presets to a set, and create your own sets with **New set**, either empty or as a copy of the shown set.

A preset text can use these placeholders, filled in when the session starts:

| Placeholder | Becomes |
|---|---|
| `{cli}` | the `task-board` command with `--dir` |
| `{root}` | the project root |
| `{tracker}` | the root's `docs/agents/issue-tracker.md` |
| `{id}` | the task's id |
| `{note}` | how to add a note to the task |

### Which preset a card gets

1. The preset chosen on the card.
2. Break down and orchestrate, for a task with sub-tasks.
3. The preset for the task's type: `enhancement` → Implement, `bug` → Diagnose, `research` → Plan. Change these in Settings.
4. The default preset (Implement).

If the project's set has no such preset, the card starts with the set's Implement. A research task starts with Plan; once it has added sub-tasks it gets Break down and orchestrate.

## The queue

**Sessions at a time** (3 by default) limits how many agents run in a project at once. A card dropped on In Progress over the limit shows **Queued** and starts when a slot frees up, oldest first. Only cards you move are queued; the board never picks up tasks by itself.

The queue is kept in `~/.icf-kanban/queue.json`. While the board is open, it advances whenever the session list changes. While the board is closed, the service starts the next card when a session in that project finishes or fails, always through path B.

A card that fails to start goes back to the front of the queue and shows the reason. After three failed starts it stays queued but is not tried again until you move it out of In Progress and back. A queued card's first message is written when it is queued, so later edits to the task are not included.

## Known limits

- A path A session runs on the model, thinking level and agent your composer has selected when the card starts, because OpenChamber's start has no fields for them.
- A path B session's worktree is made with `git` under `<repo>-worktrees/` on an `icf/<slug>` branch, not by OpenChamber's Quick worktree, so it may look different in the sidebar.
- With the board closed, queued cards start only through path B, with the options they were queued with, or OpenCode's defaults.

More detail on how starts work: [session-start findings](superpowers/specs/2026-11-15-session-start-findings.md).
