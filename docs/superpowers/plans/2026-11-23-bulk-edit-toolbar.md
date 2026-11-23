# Bulk Edit Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bottom toolbar for applying state/type changes to Marked cards, with reliable partial-failure recovery and optional recursive closing.

**Architecture:** A DOM-free bulk controller owns draft, immutable operation targets and per-field results. A small SDK-based toolbar renders its public model; main/editor integrate selection, busy state and existing single-task API writes. Keep the original type targets separate from recursively added close targets, including on retry.

**Tech Stack:** TypeScript, OpenChamber SDK UI, node:test, existing esbuild scripts.

**Spec:** `docs/superpowers/specs/2026-11-23-bulk-edit-toolbar-design.md`.

## Global Constraints

- Follow the approved spec, especially default-on recursive closing, unchanged session/queue links and hidden-failure retention.
- Existing six TASK_STATES; reuse taskTypes for configured and observed types.
- No changes outside explicit fields. No new dependencies unless existing test infrastructure proves insufficient.
- Red then green, one behavior at a time at approved public seams; typecheck regularly.
- Tracker writes use Kanban TEST CLI at `/Users/kamilagents/projects/ICF-OpenChamber-Kanban-board`, never this worktree.
- Review against starting commit `b2d1240830cb43ce65a6c9d2817869a5a2d7bb7b`; commit implementation on current branch.

## Review Focus

- Recursive child fails after its parent was also explicitly selected: parent remains open, type applies once only to explicit targets (Task 1).
- Poll/filter redraw removes a failed target: retained retry and hidden count survive (Task 2).
- Existing task write or project switch races Apply: no silent skip and no writes into another project (Task 3).
- Partial source listing or cyclic/missing hierarchy: do not claim complete descendant closure from incomplete data (Task 1).
- Keyboard Escape, drag, source/archive switches bypass disabled buttons: save lock covers every UI entry point (Task 3).

## File map and public interfaces

New `src/panel/bulkEdit.ts`:

```ts
type BulkDraft = { state: TaskState | null; type: string | null; withChildren: boolean };
type BulkFailure = { id: string; field: 'read' | 'type' | 'state'; message: string };
type BulkPlan = {
  selectedIds: readonly string[];
  typeIds: readonly string[];
  closeIds: readonly string[]; // postorder, deduplicated
  draft: BulkDraft;
};
type BulkResult = { succeeded: string[]; failures: BulkFailure[] };
type BulkProgress = { completed: number; total: number };
function planBulk(tasks: readonly Task[], ids: readonly string[], draft: BulkDraft): BulkPlan;
function runBulk(plan: BulkPlan, api: Pick<Api, 'get' | 'setType' | 'setState'>,
  progress: (value: BulkProgress) => void): Promise<BulkResult>;
```

`planBulk` validates supplied hierarchy and unknown selected IDs; coordinator verifies listing completeness before calling it. `runBulk` refreshes each target through get, skips already-matching fields, reports errors instead of swallowing them, never calls queue/session/move hooks. A failed type prevents that task's state write; unrelated tasks continue. Retry keeps original plan/typeIds and limits execution to unresolved work; do not derive typeIds from failed descendants.

New `src/panel/bulkToolbar.ts`: DOM-free controller:

```ts
createBulkToolbar(deps): {
  model(): BulkToolbarModel;
  selectionChanged(ids: readonly string[]): void;
  setDraft(change: Partial<BulkDraft>): void;
  apply(): Promise<void>;
  clear(): void;
  reset(): void;
}
```

Define `BulkToolbarModel` with selected count, hidden count, draft, extra close count, locked/canApply/blockReason, progress and failures. Dependencies supply current project API, complete task listing, selection/visible IDs, busy IDs, public selection setters/lock and model-change callback. Snapshot API/project and plan at Apply; prevent project switching while saving. `reset` clears all project-specific state when idle. Selection changes retain draft unless empty; retries preserve explicit type targets.

Extend `Selection` in `src/panel/ui/selection.ts`: `setMarked(ids)`, `selectAll()`, `setLocked(value)`, `retain(ids)` and an optional `onMarksChanged` callback. `retain` explicitly protects save/retry IDs from layout pruning; ordinary filtering still prunes ordinary marks. Programmatic result replacement is possible while locked; user mark/clear/select-all are blocked.

New `src/panel/ui/bulkToolbar.ts`: `mountBulkToolbar(slot, callbacks)` returning `{ update(model), dispose() }`, using SDK controls and no business logic.

Modify `src/panel/ui/board.ts` (bottom slot and view-control lock), `src/panel/ui/styles.ts` (flex footer/wrapping), `src/panel/main.ts` (composition, redraw, shortcuts/project lock), `src/panel/edit.ts` and `src/panel/ui/dnd.ts` (shared busy/interaction exclusion).

### Task 1: Reliable bulk execution and recursive close

Files: create `src/panel/bulkEdit.ts`, `test/bulkEdit.test.ts`; extend `test/service.test.ts`.

- [x] Write first failing public-runner test: two tasks, draft type bug and state needs-info; returned stored tasks have both fields, result.succeeded contains both IDs, failures is empty.
- [x] Run `node --test --experimental-strip-types test/bulkEdit.test.ts`; verify failure is missing behavior.
- [x] Implement minimal plan/run interfaces above, only enough for the first test; rerun it to green.
- [x] Repeat red-green for type-before-state, type failure blocking only that task's state, state failure retaining success of type, and retry skipping already-stored values.
- [x] Repeat red-green for parent/child/grandchild postorder, duplicate selection, extra child unchanged type, failed descendant leaving ancestors open, independent branch success, missing IDs and cycle rejection.
- [x] Test public service integration by wiring runner API calls through `handle` on a real temporary local project; assert results via `/tasks/get`, including successful type with failed state and done without unintended descendants.
- [x] Add service integration regression: existing queue entry/session link remains after state/type writes. Read through public service routes, not backing JSON.
- [x] Run focused files and `npm run typecheck`; commit `feat: add reliable bulk task edits`.

### Task 2: Selection and toolbar state

Files: create `src/panel/bulkToolbar.ts`, `test/bulkToolbar.test.ts`; extend `src/panel/marks.ts`, `src/panel/ui/selection.ts`, `test/marks.test.ts`.
Consumes Task 1 public plan/run interfaces; produces controller/model consumed by Task 3.

- [x] First red-green controller slice: zero marks hides toolbar, one shows it; both draft fields null disable Apply, selecting type bug enables it.
- [x] Red-green: changing selection preserves draft; clear resets draft and default-on withChildren; successful Apply clears selection.
- [x] Red-green: select-all uses full filtered layout including offscreen columns; excluded cards remain excluded.
- [x] Red-green: locked user selection mutations do nothing; redraw preserves retained IDs while ordinary filtering still prunes unretained IDs.
- [x] Red-green: failed task hidden after a state/type change remains selected with hidden count 1, fields retained; retry applies only unresolved fields.
- [x] Red-green: implicit failed child is retryable but never receives selected type; editing draft/reselection intentionally starts a fresh operation rather than silently extending stale retry scope.
- [x] Red-green: busy target disables Apply with reason; repeated Apply while locked runs once; progress settles and unlocks after read/write/reload errors.
- [x] Run `node --test --experimental-strip-types test/marks.test.ts test/bulkToolbar.test.ts` and `npm run typecheck`; commit `feat: manage bulk edit selection and retries`.

### Task 3: Bottom toolbar integration and verification

Files: new `src/panel/ui/bulkToolbar.ts`; modify board/styles/main/edit/dnd as mapped above; extend public controller/integration tests.
Consumes Task 2 controller/model, Task 1 API adapter and existing SDK controls.

- [x] Red-green integration slice: selecting a card updates model, changing type and clicking Apply saves through public controller and hides toolbar on success.
- [x] Mount stable toolbar controls in footer after scrollable columns: count, Select all, Clear, State, Type, default-on Close sub-tasks for done, Apply. Use TASK_STATES and taskTypes, with No change choices; display extra close count before saving.
- [x] Lock all relevant controls and handlers while saving, including keyboard shortcuts, drag, project/source/archive/view switches and search. Update existing busy exclusion for every planned target, releasing it in finally.
- [x] Red-green race tests: preexisting busy task refuses Apply without writes; project cannot change during Apply; poll does not destroy retry selection; source listing error prevents incomplete recursive closure with explanation.
- [x] Connect reload to fresh counts/errors without resetting draft on routine redraw. Keep toolbar keyboard focus across polls. Show per-field errors, progress and hidden failure count with accessible labels/live status.
- [x] Verify layout at narrow panel and full-page widths: footer visible during scroll, cards unobscured, controls wrap; verify keyboard and SDK popup clicks do not clear marks.
- [x] Run `npm run typecheck`, then full `npm test` once, then `npm run build`. Review generated diffs against repository conventions.
- [x] Invoke `code-review` against starting commit; resolve findings with targeted red-green regressions and rerun affected checks.
- [ ] Commit completed changes, mark each tracker sub-task done, then parent done. Report what changed and actual verification results.
