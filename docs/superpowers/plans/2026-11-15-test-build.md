# Kanban TEST: a local test build next to production

Kamil installs production from the Git URL (`main`, updates when `version` rises). He needs to try changes before they reach `main`, with the test build installed side by side.

**Goal:** `npm run build:test` builds a separate extension, id `icf-kanban-test`, name `Kanban TEST`, from whatever branch is checked out, into a stable folder outside the repo. Installed once from that folder, every rebuild reloads it live. Production keeps working untouched next to it.

## Constraints

- Production stays exactly as it is: id `icf-kanban`, name `Kanban Board`, skills `icf-kanban-*`, data in `~/.icf-kanban/`. Nothing production reads or writes changes location.
- The test build must not share anything with production: different id (OpenChamber keeps storage per extension), its own data directory, its own skill names, its own worktree branch prefix, instructions that say it is the TEST build.
- Output folder default `~/openchamber-extensions/icf-kanban-test` (outside every repo and worktree, so deleting a worktree never removes the installed test build); overridable with `--out <dir>` or `KANBAN_TEST_OUT`. The folder is wiped and rewritten on each build (refuse to wipe a folder that exists but has no marker file the script wrote, e.g. `.kanban-test-build`).
- All 0.3 constraints hold. `npm run check` green, check-guest "Package is ready" on both the repo and the test output.

## Task 1: build:test and test-build identity

- `scripts/build-test.mjs` (+ `npm run build:test`): run the normal build, then assemble the output folder with only what the package needs at runtime (package.json, LICENSE, THIRD_PARTY_LICENSES, README, assets/, panel/, service/, build/cli/, skills/). In the copied package.json: `name` `icf-kanban-test`, `version` `<version>-test.<short git sha>`, `openchamber.contributes.panel.id` `icf-kanban-test`, `panel.name` and `page.title` `Kanban TEST`, icon a TEST variant of the SVG (e.g. the same board with a small "T" badge), and add a small `kanbanBuild: { variant: "test" }` field (or similar) the service and panel can read.
- Variant awareness in code, driven by one value baked at build time (esbuild `define`, e.g. `__KANBAN_VARIANT__` = "prod" | "test"; the test build runs esbuild with "test"): 
  - service data dir: prod `~/.icf-kanban`, test `~/.icf-kanban-test` (links.json, queue.json);
  - service worktrees: path B branch prefix `icf/` (prod) vs `icf-test/` (test);
  - agent instructions (setInstructions): the test build's paragraph says it is the Kanban TEST development build, names its own CLI path, and tells agents to use it only when the user asks for the TEST board;
  - skills: the test output renames each skill folder and its `name` to `kanban-test-<x>` and prefixes the description with "Kanban TEST (development build) — only when the user asks for the TEST board.";
  - panel: a visible "TEST" badge in the board header.
- Tests: the variant helpers (data dir, branch prefix, instructions text) for both values; the manifest rewrite and skills rewrite as pure functions tested against fixtures; the wipe guard.
- README "Development" section: the flow — branch → `npm run build:test` → install once with `openchamber://extensions/install?path=<out>` (chat) or Settings → Extensions → folder → test → PR to `main` with a version bump → users update from Settings → Extensions. Note that production installs from `https://github.com/krzeznicki/ICF-OpenChamber-Kanban-board`.
- `.gitignore`: nothing new is written inside the repo by build:test (it writes outside); if a temp dir is used inside, ignore it.
