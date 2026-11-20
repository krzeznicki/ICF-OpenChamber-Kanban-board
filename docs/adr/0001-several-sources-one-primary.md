# Several sources per project, one primary, described in issue-tracker.md

A project can show tasks from several sources at once (the private local `.scratch/` files and a shared tracker such as GitHub Issues; later Linear, Jira, Asana, ClickUp). `docs/agents/issue-tracker.md` keeps describing the primary source in Matt Pocock's format, so his skills keep working unchanged, and a `## Additional sources` section at its end tells agents how to publish to each other source; we rejected a separate sources file because the skills read only issue-tracker.md. A sub-task, its parent and its blockers always live in one source: no links across sources, so a public issue never points at a private file.

## Consequences

- New tasks go to the primary source unless a source is named; a sub-task goes to its parent's source.
- Future external sources connect through the tool's own MCP server with the board as its own OAuth client (or a good official CLI such as Jira's), not through OpenCode's MCP connections: OpenCode offers no API to call an MCP tool, and its tokens are internal.
