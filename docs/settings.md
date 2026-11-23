# Settings

Settings come in three layers. Each layer overrides the one before it, field by field:

1. **Global** (Settings → Global): your defaults for every project.
2. **This project** (Settings → This project): overrides for the open project. A field left at **Use global** inherits.
3. **The card** (Settings in the task modal, or the start options in Add task): preset, location, model, thinking level, agent and summary language for one task.

All three are stored per user in OpenChamber, not in the repository.

| Setting | Default |
|---|---|
| Start at once | on |
| Sessions at a time | 3 (1 to 10) |
| Default preset | Implement |
| Location | New worktree |
| Model / Thinking / Agent | OpenChamber's current selection |
| Preset set | Matt Pocock's skills if installed, else Superpowers if installed, else Plain |
| Preset per type | `enhancement` → Implement, `bug` → Diagnose, `research` → Plan |
| Hide sub-tasks | off |
| Types | `enhancement`, `bug`, `chore`, `research` |
| Summarise automatically | on |
| Summary language | English |
| Summary prompt | a built-in prompt; `{language}`, `{title}` and `{body}` are filled in |
| Suggest type and state for new tasks (Global only) | on |
| Keyboard shortcuts (Global only) | see [Keyboard shortcuts](keyboard.md) |

## Model, thinking level and agent

These three are picked from lists wherever start options appear. The lists come from OpenCode's server for the project (`opencode api GET /api/model` and `GET /api/agent`, with `opencode models` as a fallback) and are cached for 10 minutes.

- **Model** lists models by name, with the `provider/model` id beside it. Type to filter.
- **Thinking** lists the chosen model's thinking levels (OpenCode's variants, such as low, high or max). It is disabled until a model is set or inherited.
- **Agent** lists OpenCode's session agents, such as Build and Plan.

The first entry, **Default (…)**, means "not set here" and names the value it falls back to. Setting any of the three makes the extension start the session itself instead of OpenChamber (see [Agents](agents.md#how-a-session-starts)). To use a model for one project only, set it in **This project**.

A layer that sets a model also owns the thinking level, so a level is never carried over to a different model. A value that is no longer offered still shows, marked "not in the list".

## Sources

**Settings → Sources** lists the open project's task sources, primary first. Unlike the other settings, it changes `docs/agents/issue-tracker.md` in the repository.

- **Add Local** or **Add GitHub** adds a source. GitHub needs a github.com remote and a logged-in `gh`; its labels are created.
- **Remove** stops showing a source's tasks. Nothing is deleted: the `.scratch/` files or the issues stay.
- **Make primary** makes a source the one new tasks go to.

Notes you added to `issue-tracker.md` are kept. If its template part was edited by hand, the board asks before replacing it. The CLI does the same with `task-board init --add`, `--remove` and `--primary` (see [CLI](cli.md)).
