# Session start: findings (Task 0)

Status: decided from the SDK 2.7.1 reference (`API.md`, `GUEST_SERVICES.md`), not from a live spike. The live checks listed at the end are still open.

## What the SDK offers

| | Panel `host.startSession` | Service `sessions.start` |
|---|---|---|
| Worktree | `worktree: true` (generated, the host's normal defaults, the same path as "Quick worktree") or `{kind:'new', name?, baseBranch?}` | none; takes a `directory` |
| Model / agent / variant | no field; the user's current composer selection is captured when the call starts | `model`, `variant`, `agent` |
| Links the session to the card | yes: `providerId` + `id` land in the session record's `items[]` | no `items`; the service must remember `taskId → sessionId` itself |
| Works with the board closed | no | yes (`contributes.sessionControl`) |

## Decision: A+B

- **A (default).** A card with no model and no agent set starts from the panel with `host.startSession({ providerId:'icf-kanban', id: task.id, title, url, text, projectId, worktree: true | false })`. OpenChamber makes the worktree, the session carries `items[0].id === task.id`, and the model is whatever the user has selected.
- **B.** A card with a model or agent set, and every queued card the service starts while the board is closed, starts from the service: for location `worktree` it runs `git worktree add -b icf/<slug> <repo>/../<repo>-worktrees/<slug>` itself, then `sessions.start({ prompt, directory, title, model, agent })`. The service writes the link `taskId → sessionId` to `~/.icf-kanban/links.json`; the panel reads it through `POST /links/list` and `sessionForTask` checks both sources.
- Queue: the panel drains it while the board is open; the service also drains it on `sessionEvents` `turn-finished` / `turn-failed`, so it works with the board closed (path B only).

What this changes for "model on the card": a model or agent set on the card is honoured, but those sessions get a worktree made by `git` rather than by OpenChamber, so they may look different from Quick-worktree sessions in the sidebar.

## Open live checks (for Kamil, after install)

1. Path A with `worktree: true`: same name, branch and location as "Quick worktree"?
2. Path B: does the session show under the project with its worktree, and is the model applied?
3. Path B with the board closed: does a queued card start when a running session finishes?
