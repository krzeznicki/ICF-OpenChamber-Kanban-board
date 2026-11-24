# Floating bulk actions implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stretched footer with a compact floating panel exposing the complete approved bulk-action set.

**Architecture:** Keep the tested status/type runner. Add a typed action runner and capability model for the other operations, sharing selection, busy ownership and retry lifecycle. Keep tracker writes in the service and panel storage/agent actions behind explicit adapters.

**Tech Stack:** TypeScript, existing OpenChamber SDK controls/icons, node:test, headless Chrome.

**Spec:** `docs/superpowers/specs/2026-11-23-floating-bulk-actions-design.md`

## Global constraints

- English UI copy; existing `--oc-*` tokens and SDK controls.
- No cross-source relationships; local blockers must be sibling tickets.
- Raw status/type edits preserve links and queue; moving/start/delete retain their distinct existing semantics.
- Ordinary GitHub labels must not mutate configured state labels or type labels.
- No silent success for skipped targets, storage errors or uncertain starts.
- Keep the existing worktree, PR #38, and native execution method. Publish to Kanban TEST after verification.

## Review focus

1. Reparenting changes IDs while a failed sibling remains selected: retry must use current IDs.
2. Mixed source/archived groups: show eligible and ineligible counts before applying, never silently skip.
3. A start times out after dispatch: retry must not create another agent.
4. Escape and polling while a popup is open: retain focus/selection; saving owns the lock.
5. A selected parent and descendant are both deleted: deduplicate the deletion scope and preserve failed targets.

## Structure

- `src/core/{types,sources,githubTracker,localTracker}.ts`: label and additive-blocker contracts and persistence.
- `src/service/routes.ts`, `src/panel/api.ts`: validated service boundary.
- New `src/panel/bulkActions.ts`: action availability, executor and typed outcomes; no DOM.
- `src/panel/bulkToolbar.ts`: one operation lifecycle shared by the form and action runner.
- `src/panel/{edit,starter,main}.ts`: existing operation adapters with observable outcomes and ID remapping.
- `src/panel/ui/bulkToolbar.ts`, new `src/panel/ui/bulkActionForm.ts`: compact floating UI, accessible action popovers.
- `src/panel/ui/{board,styles}.ts`: bounded positioning and card clearance.

### Task 1: Source operations for labels and blockers

**Files:** Modify `src/core/types.ts`, `src/core/sources.ts`, `src/core/githubTracker.ts`, `src/core/localTracker.ts`, `src/service/routes.ts`, `src/panel/api.ts`; tests `test/githubTracker.test.ts`, `test/localTracker.test.ts`, `test/sources.test.ts`, `test/service.test.ts`, `test/fakeGh.ts`.

**Interfaces:** Add `Tracker.changeLabel(id: string, label: string, mode: 'add' | 'remove'): Promise<Task>` and `Tracker.addBlocker(id: string, blockerId: string): Promise<Task>`. Add optional `Task.labels?: string[]` and a `labels` capability (local false, GitHub true). Mirror methods on `Api` via `/tasks/label` and `/tasks/blocker`.

- [ ] RED: service test adds an existing sibling blocker, reads it through `/tasks/get`, repeats without duplication, and preserves the original body and other blockers. Cross-feature, cross-source and self blockers return INVALID without writes.
- [ ] Run `node --test --experimental-strip-types test/service.test.ts test/sources.test.ts`; confirm new cases fail.
- [ ] Implement additive local blocker persistence using existing `patchLine`/`blockersValue` and ID validation. GitHub uses native issue dependencies; inspect installed gh/API documentation before choosing the mutation, extending fakeGh to match that real interface. Reject dependency cycles; do not infer complete graphs from the capped board list.
- [ ] RED: GitHub label add/remove preserves status/type and unrelated labels, repeat is idempotent. Configured state labels and current type labels are refused. Local source reports UNSUPPORTED.
- [ ] Implement GitHub label mutation using existing label operations; route combined sources and validate request shapes at the service boundary.
- [ ] Run the four affected test files plus `npm run typecheck`; commit `feat: support bulk label and blocker operations`.

### Task 2: Observable action adapters

**Files:** Modify `src/panel/edit.ts`, `src/panel/starter.ts`, `src/panel/main.ts`, `src/panel/archive.ts`; create `src/panel/actionResult.ts`; tests `test/starter.test.ts` (create if absent), `test/archive.test.ts`, existing move/start tests discovered before editing.

**Interfaces:** Export `ActionResult = { kind: 'success'; id: string } | { kind: 'failed'; id: string; message: string } | { kind: 'pending'; id: string; message: string } | { kind: 'cancelled'; id: string }`. Add result-returning editor `moveTask(id: string, to: Column): Promise<ActionResult>` and starter `startTaskAction(id: string, mode: 'start' | 'queue'): Promise<ActionResult>`. Retain current callbacks as wrappers for existing callers.

- [ ] RED: successful, refused and cancelled moves produce different outcomes; rejected writes do not resolve as success after showing a toast.
- [ ] RED: start timeout after dispatch produces pending, then reconciliation finds the linked session; another request cannot launch it twice. Queue mode adds an idempotent entry; it may drain under the existing queue scheduler.
- [ ] Implement adapters around existing editor/launcher paths, preserving limits, presets, prompts and session detachment rules. Do not bypass the launcher to start sessions.
- [ ] RED: archiving selected done tasks preserves unrelated marks; restoring only removes requested marks; failed persistence is a failed outcome rather than success.
- [ ] Implement archive adapters in composition using the existing storage synchronization contract; no new persistence format.
- [ ] Run affected tests and typecheck; commit `refactor: expose outcomes for grouped board actions`.

### Task 3: Bulk action lifecycle and eligibility

**Files:** Create `src/panel/bulkActions.ts`, `test/bulkActions.test.ts`; modify `src/panel/bulkToolbar.ts`, `test/bulkToolbar.test.ts`, `src/panel/main.ts`.

**Interfaces:**

```ts
type BulkAction =
  | { kind: 'move'; to: Column }
  | { kind: 'label'; label: string; mode: 'add' | 'remove' }
  | { kind: 'parent'; parentId: string }
  | { kind: 'unparent' }
  | { kind: 'blocker'; blockerId: string }
  | { kind: 'start' | 'queue' | 'archive' | 'restore' }
  | { kind: 'delete'; withChildren: boolean }
  | { kind: 'copy'; format: 'titles' | 'links' };
type BulkActionOutcome = {
  succeeded: string[];
  failures: { id: string; message: string }[];
  pending: { id: string; message: string }[];
  remapped: { from: string; to: string }[];
};
```

`previewAction(action, tasks, selected, context)` returns `{ eligible: string[]; excluded: {id: string; reason: string}[]; additional: string[] }`. Context carries source capabilities, archived IDs and busy IDs. `runAction(action, ids, deps): Promise<BulkActionOutcome>` consumes API plus result-returning adapters from Task 2. `BulkToolbar.executeAction(action, confirmedIds)` owns lock, snapshot, progress, reload and retained retry selection, just as `apply()` does for state/type.

- [ ] RED: mixed local/GitHub label group previews local exclusion with reason; executor receives only the explicitly confirmed eligible IDs. Empty eligible set refuses execution.
- [ ] RED: one reparent succeeds with changed ID and another fails; success remaps panel state and retry targets only the failed ID. Reject a selected parent as destination and hierarchy cycles before mutation.
- [ ] Implement preview and sequential execution through explicit dependencies. Re-read targets before writes; propagate unsupported/error outcomes without swallowing them.
- [ ] RED: parent-plus-child deletion with descendants deletes each ID once; partial failure retains survivors; incomplete subtree refuses recursive deletion before writes. No descendants are deleted without explicit confirmation.
- [ ] RED: pending start is retained with a distinct explanation and cannot be blindly rerun; a source/list failure blocks hierarchy writes; duplicate Apply does not dispatch twice.
- [ ] RED: copy titles/links preserves order and marks; local links use task paths, GitHub uses URLs; clipboard rejection is visible and never clears marks.
- [ ] Implement shared busy/lock ownership and ID remapping for marks, archive, per-card options and order using existing re-key paths. Capture the project for the entire action.
- [ ] Run `node --test --experimental-strip-types test/bulkActions.test.ts test/bulkToolbar.test.ts` and typecheck; commit `feat: execute the complete bulk action set`.

### Task 4: Floating panel and action forms

**Files:** Modify `src/panel/ui/bulkToolbar.ts`, `src/panel/ui/styles.ts`, `src/panel/ui/board.ts`, `src/panel/main.ts`, `src/panel/ui/selection.ts`; create `src/panel/ui/bulkActionForm.ts`; extend `test/browser/bulkToolbar.ts`, `scripts/debug/bulk-toolbar/run.sh`.

**Interfaces:** `mountBulkActionForm(root, { onSubmit(action, eligibleIds), onDismiss })` returns `update(action, preview, locked)` and `dispose()`. Toolbar receives `onAction(kind)` alongside existing form callbacks. Use the SDK's available icon/tooltip API verified in installed declarations, not guessed component props.

- [ ] RED browser check: every approved action is discoverable by accessible name, disabled actions expose their reason, icon-only controls have tooltips, choosing a parent opens a form without losing marks.
- [ ] Build a floating, content-width elevated panel; count and selection controls, bounded State/Type fields and Apply, then grouped action icons. Keep Delete separated. All approved actions are visible; copy format and move destination are chosen in their forms.
- [ ] Mount action forms above the panel with bounded height, keyboard focus management and Escape layering. Show eligible/excluded/additional counts and per-action confirmation. State/type draft remains untouched until its own Apply.
- [ ] RED browser check: resize at 390×844 and 1440×900; panel fits horizontally and vertically; fields do not expand across the page; final card scrolls clear; popup fits viewport. Poll keeps focused control and marks.
- [ ] Wire all forms to Task 3, including archived-view selection for Restore. Lock project/filter/view/card interactions during saves, but retain accessible progress and errors.
- [ ] Run typecheck and `sh scripts/debug/bulk-toolbar/run.sh`; inspect actual visual output in narrow and wide layouts, not only assertions. Commit `feat: add compact floating bulk action panel`.

### Task 5: Review, release to TEST and update PR

**Files:** `README.md`, both new spec/plan documents; generated `panel/main.js`, `service/main.js`, `build/cli/task-board.mjs`; tracker notes at main checkout.

- [ ] Document action semantics, source limitations, queue behavior and shortcut/tooltip use.
- [ ] Run `npm run typecheck`, `npm test`, `npm run build`, both browser scripts (`bulk-toolbar`, `drag-across-columns`) and `git diff --check`. Record exact results.
- [ ] Run `code-review` against `cf02c93` for this extension; fix findings with targeted regressions and rerun affected checks.
- [ ] Commit source/generated output, push existing branch, update PR #38 with full action scope and evidence. Run `npm run build:test` and verify installed manifest/build identity.
- [ ] Complete the tracker follow-up, finish progress mirror and report actual shipped scope and tests.

## Handoff

Design and execution approved. Native implementation in this session.

## Execution record

- Task 1 complete: `8dc3643`, service and tracker tests RED→GREEN; 106 focused tests/typecheck pass.
- Task 2 complete: `2ba10e0`, explicit move outcomes and uncertain-start protection; 21 focused tests/typecheck pass.
- Task 3 complete: `14812b6`, eligibility, execution, locks and partial outcomes; 31 runner/controller/archive tests/typecheck pass.
- Task 4 complete: `68104df`, floating icon panel and action forms; browser checks pass in narrow and desktop layouts. SDK picker regression reproduced and fixed by removing transformed ancestor.
- Task 5 verification complete: full suite 811/811, build/typecheck, browser checks and SDK package checker pass. Independent standards review found no violations. Spec review findings fixed and rechecked: ambiguous host starts stay reserved; failed first-message delivery remains actionable through reconciliation/timeouts; parent/unparent retries repair metadata under the new ID without repeating source mutations. PR update and TEST publication follow.

Implementation rulings: result-returning moves are composed via DOM-free `executeMove`, rather than another editor entry point; archive adapter reuses `archiveWriteJob` with awaited persistence. Optional label capability defaults to unsupported for older services. Recursive deletion uses confirmed postorder and nonrecursive writes to avoid deleting unconfirmed new descendants. Icons use inline outline SVG because the installed SDK exposes no action icon library. Empty local features may become sub-tasks, consistent with existing tracker behavior.
