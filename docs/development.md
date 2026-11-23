# Development

```sh
npm install
npm run check   # typecheck, tests and build
```

`npm run build` bundles the code with esbuild: the panel to `panel/main.js`, the service to `service/main.js` and the CLI to `build/cli/task-board.mjs`. Commit the built files with the sources, because OpenChamber installs extensions without building them.

The tests run in Node without a layout engine, so drag and drop between columns of different lengths is checked separately in headless Chrome. `sh scripts/debug/drag-across-columns/run.sh` must print only `PASS` lines; set `CHROME` if Chrome is not at the default macOS path.

Install the board from a separate clone, not from a project you use it on: a folder install runs from the folder itself, and any write inside the package reloads the extension.

## Trying a branch: the Kanban TEST build

Production is installed from `main`. To try a branch without touching it, build a separate test extension:

1. Check out the branch.
2. Run `npm run build:test`. It builds **Kanban TEST** (id `icf-kanban-test`) into `~/openchamber-extensions/icf-kanban-test`. Use `--out <dir>` or `KANBAN_TEST_OUT` for another folder. The folder is emptied on every build; the script refuses a folder inside the repository, or one with files it did not write.
3. Install it once: in **Settings → Extensions**, install from that folder. Later builds reload it.
4. Test it. The TEST build keeps its data in `~/.icf-kanban-test/`, makes `icf-test/*` branches, ships its skills as `kanban-test-*` and shows a **TEST** badge, so production keeps running next to it.
5. Open a pull request to `main` with a `version` bump and the rebuilt bundles from `npm run check`. Users get the update from **Settings → Extensions**.

## Checking the package

Before a release, run OpenChamber's package checker. On Node 26 it cannot run from `node_modules`, because Node does not strip types there, so copy it out first:

```sh
D=$(mktemp -d); mkdir $D/scripts
cp node_modules/@openchamber/sdk/scripts/check-guest.ts $D/scripts/
ln -s $PWD/node_modules/@openchamber/sdk/dist $D/dist
echo '{"type":"module"}' > $D/package.json
node $D/scripts/check-guest.ts $PWD   # must print "Package is ready"
```

## Manual checks before the first public release

Each check needs the extension installed in OpenChamber. None has been done yet.

1. Install from a folder and approve the permissions; the board opens in the rail and as a page.
2. The setup wizard, for Local and for GitHub, including the `gh` checks and label creation.
3. Moving a card changes one line of the task file (`git diff`), or swaps the state label on GitHub.
4. A path A start in a new worktree gets the same name, branch and location as OpenChamber's Quick worktree.
5. A path B session shows under the project with its worktree, and runs on the chosen model.
6. With the board closed, a queued card starts when a running session finishes.
7. Deleting a linked session does not block the queue.
8. Summaries: written automatically, written again after a description edit, **Summarise**, per-card language.
9. An agent finds the CLI from the instructions and creates, claims and closes a task with the skills.
10. The task modal: a Review card whose path B session was archived shows **Session archived**; **Open session** on a live path B session opens it.
11. Archive done: the confirm counts the tasks, Done is empty in the rail and the page, **Show archived** and **Unarchive** work, and a task reopened from the CLI or GitHub comes back.
12. Type and state suggestions: a task left on **Let the model pick** gets both; a type you picked stays; with no Small Model there is one notice and the option disappears.
13. Search and filters in the rail and the page: a sub-task match shows its parent, Escape clears, the completion list works with the arrows, Enter and Tab, and dragging still works while filtered.
14. The rail panel beside a chat: a chat started from a card opens that card; an orchestrator chat shows the list; a chat started by hand shows the banner; a chat in a worktree shows its own project.

## Screenshots to take

Saved in [`docs/screenshots/`](screenshots/), with the extension running:

- [ ] `board.png`: the board with cards in every column (used in the README)
- [ ] `rail-icon.png`: the **Kanban Board** icon in the side rail
- [ ] `card-detail.png`: the task modal
- [ ] `settings.png`: the Settings sheet
- [ ] `wizard.png`: the setup wizard
