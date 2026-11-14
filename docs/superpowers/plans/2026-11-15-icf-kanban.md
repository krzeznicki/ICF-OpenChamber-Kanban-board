# ICF-kanban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An OpenChamber extension with a Kanban board over the project's own tracker (local `.scratch/` files or GitHub Issues, in Matt Pocock's skill format), where moving a card starts an agent session with preset settings, plus a CLI and skills so agents work on the same tasks.

**Architecture:** One TypeScript core (`src/core`) with a `Tracker` interface and two adapters. Three thin shells use it: a CLI for agents, a local HTTP service for the panel, and the sandboxed panel UI. The repo holds only the tracker data; sessions links come from OpenChamber's session records; personal settings and summaries live in the extension's storage.

**Tech Stack:** TypeScript 5, Node 20+, `@openchamber/sdk` 2.7.1, esbuild, `node:test` with `--experimental-strip-types`, `gh` CLI 2.94+, no UI framework (plain DOM, as the SDK examples do).

**Spec:** `docs/superpowers/specs/2026-11-15-task-board-design.md`

## Global Constraints

- Extension id `icf-kanban`, display name `ICF-kanban`, licence MIT, `engines.openchamber: ">=2.7.1"`.
- Nothing is copied from `mannu150/openchamber-kanban` (it has no licence file).
- Never read or write OpenChamber's own files (`~/.config/openchamber/**`). Only SDK calls and the extension's storage.
- The repo format is Matt's, unchanged: `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `.scratch/<feature>/spec.md`, `.scratch/<feature>/issues/NN-slug.md` with `**Status:**`, `**Blocked by:**`. The only addition is an optional `**Type:**` line.
- State roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`; label strings come from `triage-labels.md` when present. Category roles: `bug`, `enhancement`.
- In Progress and Review are never written to the repo.
- Panel code runs in `sandbox="allow-scripts"`: no `window.prompt/alert/confirm`, no network, no absolute file paths. Panel bundles are IIFE; the service and CLI are ESM for Node.
- All `gh` and `git` calls go through one injectable `Exec` function, so tests use a fake.
- Every task ends with `npm run check` green (typecheck + tests + build) and a commit.
- User-facing UI text in English; summaries in the user's chosen language (default Polish).

## Review Focus

1. A `.scratch` issue file that doesn't follow the template (no `Status:` line, extra headings, Windows line endings): the card still shows, in Backlog, and a later status write changes only the status line. → Task 2.
2. A project with no `docs/agents/issue-tracker.md`, or one written as free prose ("Other" tracker): the board shows the wizard or a clear "unsupported tracker" message, never an empty board. → Task 4, Task 9.
3. `gh` missing, too old, not logged in, or the repo has issues disabled: one readable message with what to do, not a stack trace. → Task 6.
4. The user drags the same card twice quickly, or drags it while its session is starting: one session only. → Task 12.
5. A task whose body changed on GitHub while the board was open: the board refreshes and the old summary is not shown for the new body. → Task 15.

---

## File Structure

```
package.json                 manifest (openchamber block), scripts
scripts/build.mjs            esbuild: panel (iife), service + cli (esm)
src/core/types.ts            Task, TaskState, TaskType, Tracker, Exec
src/core/config.ts           read/write docs/agents/issue-tracker.md + triage-labels.md
src/core/localFormat.ts      parse/patch one issue file and spec.md
src/core/localTracker.ts     Tracker over .scratch/
src/core/githubTracker.ts    Tracker over gh
src/core/openTracker.ts      config -> Tracker
src/cli/main.ts              `task-board` CLI
src/service/main.ts          HTTP service for the panel
src/panel/columns.ts         Task + session -> column
src/panel/settings.ts        layered settings + presets
src/panel/prompt.ts          start prompt text
src/panel/launcher.ts        start a session for a card
src/panel/queue.ts           concurrency limit
src/panel/summaries.ts       host.generate + cache
src/panel/api.ts             typed calls to the service
src/panel/ui/*.ts            board, card, detail, settingsView, wizard, dnd, styles
src/panel/main.ts            wiring
panel/index.html, panel/page.html
skills/icf-kanban-*/SKILL.md four skills
test/*.test.ts
README.md, LICENSE, docs/screenshots/
```

---

### Task 0: Spike — how sessions start (throwaway)

The SDK has two ways to start a session and neither covers everything the spec wants: the panel's `host.startSession` takes `worktree` but no model or agent; the service's `sessions.start` takes `model`, `variant`, `agent` and a `directory`, but no worktree. This spike decides Task 12. Code from it is deleted.

**Files:** `spike/` (deleted at the end), `docs/superpowers/specs/2026-11-15-session-start-findings.md`

- [ ] **Step 1:** Minimal extension in `spike/` with a panel button calling `host.startSession({providerId:'icf-kanban', id:'spike-1', title:'Spike', url:'https://icf-kanban.local/t/spike-1', text:'Say hi', projectId, worktree:true})`. Install from folder, click, and record: is the worktree the same kind OpenChamber's "Quick worktree" makes (name, branch, location)? Does the session record carry `items[0].id === 'spike-1'`?
- [ ] **Step 2:** Add a service with `contributes.sessionControl`. From it: `git worktree add` under the project, then `createServiceHost({env}).sessions.start({prompt, directory:<that worktree>, model:<a favourite model>})`. Record: does the session appear under the project with `worktree` set? Is the model applied? Does the session start with the panel closed?
- [ ] **Step 3:** Write the findings file with a one-line decision: **A** panel start (worktree by OpenChamber, model = user's default), **B** service start (own `git worktree add`, model and agent honoured, works with the board closed), or **A+B** (B only when a model/agent is set on the card). Show it to Kamil: this changes what "model on the card" can promise.
- [ ] **Step 4:** Delete `spike/`, commit the findings.

---

## Milestone 1 — core and CLI on local files

### Task 1: Scaffold and types

**Files:** Create `package.json`, `tsconfig.json`, `scripts/build.mjs`, `LICENSE`, `.gitignore`, `src/core/types.ts`, `test/types.test.ts`

**Interfaces — Produces:**
```ts
export type TaskState = 'needs-triage'|'needs-info'|'ready-for-agent'|'ready-for-human'|'wontfix'|'done';
export type TaskKind = 'parent'|'ticket';
export type Task = {
  id: string;            // local: ".scratch/<feature>/issues/01-slug.md" or ".scratch/<feature>/spec.md"; github: "#42"
  kind: TaskKind;
  title: string;
  body: string;          // full markdown as stored
  state: TaskState;      // no state line / no label -> 'needs-triage'
  type: string | null;   // 'bug' | 'enhancement' | custom ('chore','research',...)
  parentId: string | null;
  blockedBy: string[];   // ids
  url: string | null;    // github html url, null for local
  updatedAt: number;     // epoch ms
};
export type NewTask = { title: string; body?: string; type?: string; state?: TaskState; parentId?: string; blockedBy?: string[] };
export interface Tracker {
  list(): Promise<Task[]>;                       // open tasks + done ones from the last 30 days
  get(id: string): Promise<Task>;
  create(input: NewTask): Promise<Task>;
  setState(id: string, state: TaskState): Promise<Task>;   // 'done' closes; from 'done' reopens
  setType(id: string, type: string): Promise<Task>;
  close(id: string, opts: { withChildren: boolean }): Promise<Task[]>;  // returns every task it closed
}
export type Exec = (cmd: string, args: string[], opts: { cwd: string }) => Promise<{ code: number; stdout: string; stderr: string }>;
export class TrackerError extends Error { constructor(public code: 'NOT_CONFIGURED'|'UNSUPPORTED'|'NOT_FOUND'|'GH_MISSING'|'GH_AUTH'|'GH_OLD'|'INVALID'|'FAILED', message: string) }
```

- [ ] **Step 1:** `package.json`: `"type":"module"`, scripts `typecheck`, `test` (`node --test --experimental-strip-types test/*.test.ts`), `build`, `check`; devDeps `typescript`, `esbuild`, `@types/node`; dep `@openchamber/sdk@2.7.1`. No `openchamber` block yet (Task 8).
- [ ] **Step 2:** Test: `TrackerError` keeps `code` and is `instanceof Error`. Run, fail, implement `types.ts`, pass.
- [ ] **Step 3:** `npm run check`, commit `chore: scaffold and core types`.

### Task 2: Local file format

**Files:** Create `src/core/localFormat.ts`, `test/localFormat.test.ts`, `test/fixtures/scratch/**` (copy the two templates from Matt's `to-tickets` skill as fixtures)

**Interfaces — Produces:**
```ts
export type ParsedIssue = { title: string; state: TaskState; type: string | null; blockedBy: number[]; body: string };
export const parseIssue: (text: string, fileName: string) => ParsedIssue;
export const patchLine: (text: string, field: 'Status'|'Type'|'Blocked by', value: string) => string;
export const renderIssue: (n: number, input: NewTask) => string;   // Matt's local-ticket-template
export const parseSpec: (text: string, featureSlug: string) => { title: string; state: TaskState; type: string | null };
export const issueFileName: (n: number, title: string) => string;   // "03-add-login.md"
```
Rules: title = first `# ` heading with a leading `NN: ` stripped, else the file name. Field lines match `^\*\*(Status|Type|Blocked by):\*\*\s*(.*)$` and also the bare `Status: x` form Matt's local doc mentions. `resolved`, `closed`, `done` → `'done'`; `claimed` → `'ready-for-agent'`; unknown or missing → `'needs-triage'`. `Blocked by` takes every number in the line; "None…" → `[]`. `patchLine` replaces the existing line in place, keeping its form and the file's line endings; when absent it inserts after the title's blank line.

- [ ] **Step 1:** Tests: template fixture round-trips; file with no Status line parses as `needs-triage`; CRLF file patched keeps CRLF and changes exactly one line (compare all other lines); `Blocked by: 01, 03` → `[1,3]`; `patchLine` on a file without `Type` inserts one line; `issueFileName(3,'Add Login!')` → `03-add-login.md`.
- [ ] **Step 2:** Run to fail, implement, run to pass, commit `feat(core): local issue file format`.

### Task 3: Local tracker

**Files:** Create `src/core/localTracker.ts`, `test/localTracker.test.ts`

**Interfaces — Consumes:** Task 1 types, Task 2 functions. **Produces:** `export const createLocalTracker: (root: string) => Tracker`.

Rules: features are directories under `.scratch/`; `spec.md` is the parent (missing spec → a parent task titled from the slug, body empty, not written until edited); tickets are `issues/*.md`. `create` without `parentId` makes a new feature directory from the title slug with `spec.md`; with `parentId` it adds the next `NN` ticket there. Parent `state` is its own Status line. `close(parent,{withChildren:true})` sets every ticket and the spec to `resolved`. `updatedAt` from file mtime. Ids are paths relative to `root`; an id escaping `.scratch/` is `INVALID`.

- [ ] **Step 1:** Tests on a temp dir copy of the fixtures: `list` returns parent + tickets with `parentId` and `blockedBy` as ids; `create` under a parent numbers after the highest existing file; `setState('done')` writes `resolved`, `setState('ready-for-agent')` on it reopens; `close` with children returns all closed tasks; id `../x` rejects with `INVALID`; empty repo (no `.scratch`) lists `[]`.
- [ ] **Step 2:** Fail, implement, pass, commit `feat(core): local tracker`.

### Task 4: Project config

**Files:** Create `src/core/config.ts`, `src/core/openTracker.ts`, `test/config.test.ts`; fixtures from Matt's `issue-tracker-local.md`, `issue-tracker-github.md`, `triage-labels.md`

**Interfaces — Produces:**
```ts
export type TrackerKind = 'local'|'github';
export type ProjectConfig = { tracker: TrackerKind; labels: Record<Exclude<TaskState,'done'>, string> };
export const readConfig: (root: string) => Promise<ProjectConfig>;   // NOT_CONFIGURED | UNSUPPORTED
export const writeConfig: (root: string, tracker: TrackerKind) => Promise<void>;
export const openTracker: (root: string, exec: Exec) => Promise<Tracker>;
```
Detection: first heading of `docs/agents/issue-tracker.md` contains `Local Markdown` → local, `GitHub` → github, anything else → `UNSUPPORTED` with the heading in the message. `writeConfig` writes the matching template (kept in `src/core/templates/`, text identical to Matt's seed files) and never overwrites an existing file. Labels default to the role names; `triage-labels.md` overrides them when it has a table mapping role → label.

- [ ] **Step 1:** Tests: both fixtures detected; GitLab fixture → `UNSUPPORTED`; missing file → `NOT_CONFIGURED`; `writeConfig` twice leaves the first file untouched; custom label table read.
- [ ] **Step 2:** Fail, implement, pass, commit `feat(core): project config`.

### Task 5: CLI

**Files:** Create `src/cli/main.ts`, `test/cli.test.ts`; modify `scripts/build.mjs` (output `build/cli/task-board.mjs` with a `#!/usr/bin/env node` banner)

**Interfaces — Consumes:** `openTracker`. **Produces** commands, all with `--dir <path>` (default cwd) and `--json`:
`list [--state s] [--ready]`, `show <id>`, `create --title t [--type x] [--body-file f|-] [--parent id] [--state s]`, `state <id> <state>`, `next` (first `ready-for-agent` ticket with no open blocker, in id order; exit 3 when none), `close <id> [--with-children]`, `init <local|github>`.
Exit codes: 0 ok, 2 usage, 3 nothing found, 4 `TrackerError` (message on stderr, `{"error":{code,message}}` with `--json`).

- [ ] **Step 1:** Tests run `main(argv, io)` against a temp local project: `create` then `list --json` shows it; `next` skips a ticket blocked by an open one; `state x done` then `list --ready` omits it; unknown command exits 2; unconfigured dir exits 4 with code `NOT_CONFIGURED`.
- [ ] **Step 2:** Fail, implement, pass, build, run `node build/cli/task-board.mjs list --dir test/fixtures/...` by hand, commit `feat(cli): task-board`.

---

## Milestone 2 — GitHub

### Task 6: GitHub tracker

**Files:** Create `src/core/githubTracker.ts`, `src/core/exec.ts` (real `Exec` via `execFile`), `test/githubTracker.test.ts`, `test/fakeGh.ts`

**Interfaces — Produces:** `export const createGithubTracker: (root: string, exec: Exec, labels: ProjectConfig['labels']) => Tracker`.

Rules (commands as in Matt's `issue-tracker-github.md`): list with `gh issue list --state all --limit 500 --json number,title,body,labels,state,updatedAt,url,closedAt` plus one GraphQL call for `parent` and `subIssues` of those numbers; an issue with sub-issues is `kind:'parent'`. State from the state-role label, closed → `done`; more than one state label → first in role order. Type: `bug`/`enhancement` label, else any label starting `type:`. `blockedBy`: `issue_dependencies_summary` when available, else numbers on a `## Blocked by` section or `Blocked by:` line. `setState` swaps labels with one `gh issue edit --add-label … --remove-label …`, creating a missing label first; `done` = `gh issue close`, leaving `done` = `gh issue reopen`. `create --parent` uses `gh issue create --parent`. Before the first call: `gh --version` (missing → `GH_MISSING`, < 2.94 → `GH_OLD`), `gh auth status` (→ `GH_AUTH`); each message says the fix (`brew install gh`, `gh auth login`).

- [ ] **Step 1:** `fakeGh.ts`: an `Exec` over an in-memory issue list that records every call. Tests: list maps labels/parents/blockers; `setState` issues exactly one edit call with both flags; closing a parent with children closes each; no `gh` → `GH_MISSING` with "install"; old version → `GH_OLD`; issues disabled (gh exits 1 with "has disabled issues") → `FAILED` with that sentence.
- [ ] **Step 2:** Fail, implement, pass.
- [ ] **Step 3:** Manual check against the private repo `krzeznicki/ICF-OpenChamber-Kanban-board`: `task-board init github`, `create`, `state`, `close`; delete the test issue. Commit `feat(core): github tracker`.

---

## Milestone 3 — extension skeleton and read-only board

### Task 7: Service

**Files:** Create `src/service/main.ts`, `src/service/routes.ts`, `test/service.test.ts`; modify `scripts/build.mjs` (→ `service/main.js`)

**Interfaces — Produces** (all JSON, bearer `OPENCHAMBER_SERVICE_TOKEN`, listen `127.0.0.1:OPENCHAMBER_SERVICE_PORT`; every body carries `directory`, absolute):
`GET /health`; `POST /config/read` → `{config}` or `{error}`; `POST /config/init {tracker}`; `POST /tasks/list` → `{tasks}`; `POST /tasks/get {id}`; `POST /tasks/create {input}`; `POST /tasks/state {id,state}`; `POST /tasks/type {id,type}`; `POST /tasks/close {id,withChildren}`; `GET /cli` → `{path}` (absolute path of the built CLI).
`routes.ts` exports `handle(method, path, body, deps:{exec}) => Promise<{status, json}>`; `TrackerError` → 422 `{error:{code,message}}`, anything else → 500.

- [ ] **Step 1:** Tests call `handle` directly on a temp local project: list, create, state round trip; relative `directory` → 400; unconfigured → 422 `NOT_CONFIGURED`.
- [ ] **Step 2:** Fail, implement, pass, commit `feat(service): tracker routes`.

### Task 8: Manifest, panel shell, read-only board

**Files:** Modify `package.json` (add `openchamber` block); create `panel/index.html`, `panel/page.html`, `src/panel/main.ts`, `src/panel/api.ts`, `src/panel/columns.ts`, `src/panel/ui/board.ts`, `src/panel/ui/card.ts`, `src/panel/ui/styles.ts`, `test/columns.test.ts`

Manifest: `id/name/icon` (`icf-kanban`, `ICF-kanban`, `kanban-view`), `contributes.panel.entry`, `page` (full-screen board), `capabilities: ["sessions","prompt","model"]`, `service: {entry:"service/main.js", runtime:"host", permissions:{exec:["git","gh"]}}`. Styles use the host theme tokens from `ready`.

**Interfaces — Produces:**
```ts
export type Column = 'backlog'|'ready'|'in_progress'|'review'|'done';
export type SessionInfo = { id: string; activity: GuestSessionActivity; outcome: 'completed'|'failed'|null; archived: boolean };
export const columnFor: (task: Task, session: SessionInfo | null, queued: boolean) => Column;
export const sessionForTask: (taskId: string, sessions: GuestSessionRecord[]) => SessionInfo | null;  // newest non-archived session with items[].id === taskId
// api.ts
export const createApi: (host: HostClient, directory: string) => { readConfig, initConfig, list, get, create, setState, setType, close, cliPath };
```
`columnFor`: `done` → done; queued → in_progress; session `running`/`retrying` → in_progress; session `waiting-*`, or idle with an outcome → review; otherwise by state: `ready-for-agent` → ready, the rest → backlog.

- [ ] **Step 1:** Tests for `columnFor` (one per rule above, plus: done task with a running session stays done) and `sessionForTask` (ignores archived, picks newest).
- [ ] **Step 2:** Fail, implement, pass.
- [ ] **Step 3:** Board UI: project switcher from `host.onProjects`, five columns, cards with title, type badge, `ready-for-human`/`wontfix`/blocked badges, parent cards with `done/total` and a progress bar, a "hide sub-tasks" toggle. Refresh on open, on a Refresh button, and every 60 s while visible; live session changes through `host.onSessions`.
- [ ] **Step 4:** Install from folder in OpenChamber, open on a project with `.scratch` fixtures, confirm cards land in the right columns. Commit `feat(panel): read-only board`.

### Task 9: Setup wizard and error states

**Files:** Create `src/panel/ui/wizard.ts`, `src/panel/ui/notice.ts`

- [ ] **Step 1:** `NOT_CONFIGURED` → wizard: two choices (Local, GitHub; GitHub preselected when the service reports a github.com remote via a new `POST /config/detect` → `{remote: string|null}`), one button, calls `initConfig`, then loads the board. `UNSUPPORTED`, `GH_*` → a notice with the error message and a Retry button. Add a `handle` test for `/config/detect` on a repo with and without a remote.
- [ ] **Step 2:** Manual: fresh folder → wizard → Local → empty board with "Add task". Commit `feat(panel): setup wizard`.

---

## Milestone 4 — moving cards and starting agents

### Task 10: Add, edit, drag

**Files:** Create `src/panel/ui/dnd.ts`, `src/panel/ui/detail.ts`, `src/panel/moves.ts`, `test/moves.test.ts`

**Interfaces — Produces:**
```ts
export type Move = { kind:'setState'; state: TaskState } | { kind:'start' } | { kind:'close'; askChildren: boolean } | { kind:'none'; reason: string };
export const planMove: (task: Task, from: Column, to: Column, openChildren: number) => Move;
```
Rules: → backlog = `needs-triage`; → ready = `ready-for-agent`; → in_progress = `start`; → review = `none` ("Review is set by the agent's session"); → done = `close`, `askChildren` when a parent has open children; from done → reopen via the target's state.

- [ ] **Step 1:** Tests: each rule; same column → `none`.
- [ ] **Step 2:** Fail, implement, pass. Pointer-based drag and drop (no HTML5 DnD in the sandbox-safe path; also "Move to" buttons in the detail view). "Add task": inline form in the board header (title, type, a few sentences) → `create` in Backlog. Detail view: full body rendered as text, state/type selects, "Close with sub-tasks" confirm drawn in the panel.
- [ ] **Step 3:** Manual on local and GitHub projects; check the file diff touches one line. Commit `feat(panel): add, edit and move tasks`.

### Task 11: Settings and presets

**Files:** Create `src/panel/settings.ts`, `src/panel/presets.ts`, `src/panel/ui/settingsView.ts`, `test/settings.test.ts`

**Interfaces — Produces:**
```ts
export type Location = 'worktree'|'project';
export type StartOptions = { presetId: string; model: string | null; agent: string | null; location: Location };
export type Preset = { id: string; name: string; text: string; builtin: boolean };
export type Settings = {
  autoStart: boolean;                // default true
  maxParallel: number;               // default 3, 1..10
  defaults: StartOptions;            // default {presetId:'implement', model:null, agent:null, location:'worktree'}
  presetByType: Record<string,string>; // default {enhancement:'implement', bug:'implement', research:'plan'}
  summary: { auto: boolean; language: string; prompt: string };  // default auto true, 'Polish'
  hideChildren: boolean;
  types: string[];                   // default ['enhancement','bug','chore','research']
};
export const resolveSettings: (global: Partial<Settings>, project: Partial<Settings>) => Settings;
export const resolveStart: (s: Settings, task: Task, card: Partial<StartOptions>) => StartOptions;  // card > presetByType[type] > defaults
export const BUILTIN_PRESETS: Preset[];  // ids: plan, prototype, implement, implement-no-questions, orchestrate
```
Storage keys: `settings:global`, `settings:project:<projectId>`, `presets`, `card:<projectId>:<taskId>`.

- [ ] **Step 1:** Tests: project overrides global field by field; card overrides both; unknown preset id falls back to `implement`; `maxParallel` clamped.
- [ ] **Step 2:** Fail, implement, pass. Settings view with Global and This project tabs, preset editor (built-ins editable and resettable), start options on each card's detail view. Commit `feat(panel): layered settings and presets`.

### Task 12: Start sessions and track them

**Files:** Create `src/panel/prompt.ts`, `src/panel/launcher.ts`, `test/prompt.test.ts`, `test/launcher.test.ts`

**Interfaces — Consumes:** Task 0 decision, Task 11. **Produces:**
```ts
export const buildPrompt: (task: Task, preset: Preset, cliPath: string, children: Task[]) => string;
export const createLauncher: (deps:{ start:(req)=>Promise<{sessionId:string|null}>, isStarting:Set<string> }) => { launch(task: Task, opts: StartOptions): Promise<'started'|'already'|'failed'> };
```
Prompt order: task title and id, full body, the tracker kind and the CLI line (`node <cliPath> state <id> <state>`), then the preset text. For a parent: list of children with states, and "work until every sub-task is done; move each sub-task with the CLI as you go". The request carries `providerId:'icf-kanban'`, `id: task.id`, `title`, `url` (GitHub url or `https://icf-kanban.local/t/<encoded id>`), which is what links the session to the card. `launch` returns `'already'` when the task id is in `isStarting` or already has a live session.

- [ ] **Step 1:** Tests: prompt contains id, body, preset text in that order and stays under the SDK's 16000-char attach limit by truncating the body with a "read the full task with the CLI" line; two `launch` calls for one task → one `start` call; failed start clears `isStarting`.
- [ ] **Step 2:** Fail, implement, pass. Wire `planMove` `start` → `launch` with `resolveStart`; with `autoStart` off, show the start form first. Clicking a card with a session opens it (`host.openSession`).
- [ ] **Step 3:** Manual: drag → session appears, card in In Progress; finish → Review with an attention mark; drag to Done closes the issue. Commit `feat(panel): start agents from cards`.

### Task 13: Queue

**Files:** Create `src/panel/queue.ts`, `test/queue.test.ts`

**Interfaces — Produces:** `export const nextToStart: (queued: string[], running: number, maxParallel: number) => string[]` and storage key `queue:<projectId>` (ordered task ids).

- [ ] **Step 1:** Tests: limit 3, 2 running, 3 queued → first one; 0 running → first three; order kept.
- [ ] **Step 2:** Fail, implement, pass. A dropped card over the limit shows "Queued" in In Progress; the queue drains on every session snapshot. Dragging a queued card out removes it. Whether it drains with the board closed follows Task 0 (only path B can). Commit `feat(panel): start queue`.

---

## Milestone 5 — summaries, agent skills, release

### Task 14: Parent orchestration

**Files:** Modify `src/panel/prompt.ts`, `src/panel/columns.ts`, `src/panel/ui/card.ts`; tests in `test/columns.test.ts`

- [ ] **Step 1:** Test: a child whose parent has a running session and whose state is `ready-for-agent` shows `in_progress` only when the CLI marked it claimed. Add `claim <id>` to the CLI (local: `Status: claimed`; GitHub: assign `@me`) and a `claimed: boolean` field on `Task`; `columnFor` treats claimed + parent session running as in_progress.
- [ ] **Step 2:** Fail, implement, pass. Child cards show "led by orchestrator". Default preset for a parent is `orchestrate`. Commit `feat: parent orchestration`.

### Task 15: Summaries

**Files:** Create `src/panel/summaries.ts`, `test/summaries.test.ts`

**Interfaces — Produces:**
```ts
export const summaryKey: (projectId: string, task: Task, s: Settings['summary']) => string;  // hash of body + language + prompt
export const createSummaries: (deps:{ generate, storage }) => { get(task): string|null; ensure(task): Promise<string|null> };
export const DEFAULT_SUMMARY_PROMPT: string;
```
Default prompt asks for 2–4 plain sentences in `{language}`: what changes for the user, why, and what "done" means; no headings, no lists. At most 2 generations at once; `NO_MODEL` turns auto off for the session and shows one notice.

- [ ] **Step 1:** Tests: same body → cached, one `generate` call; changed body → new key, old text not returned; changed language → new key; `NO_MODEL` → `null` and no retry storm.
- [ ] **Step 2:** Fail, implement, pass. Card and detail show the summary first, the full body collapsed; "Summarise" button when auto is off. Commit `feat(panel): personal task summaries`.

### Task 16: Agent skills

**Files:** Create `skills/icf-kanban-create/SKILL.md`, `skills/icf-kanban-status/SKILL.md`, `skills/icf-kanban-next/SKILL.md`, `skills/icf-kanban-start/SKILL.md`; modify `package.json` (`contributes.skills: "skills"`, `contributes.instructions: true`), `src/service/main.ts`

- [ ] **Step 1:** On start the service calls `createServiceHost({env}).setInstructions(null, text)` where text is one paragraph: tasks for this project are managed with `node <absolute cli path>`, plus the four command lines. Each skill is under 40 lines: when to use it, the exact CLI calls, and "if `docs/agents/issue-tracker.md` is missing, run `init` only after asking the user which tracker".
- [ ] **Step 2:** Manual: in a project without Matt's skills, ask an agent to "add a bug task and take the next ready one"; confirm the card appears and moves. Repeat with Matt's skills installed and `to-tickets`; confirm its tickets show on the board. Commit `feat: agent skills`.

### Task 17: README, screenshots, release

**Files:** Create `README.md`, `docs/screenshots/*.png`, `CHANGELOG.md`

- [ ] **Step 1:** README: what it is, install (git URL), the permission list with what each is used for, tracker setup, columns ↔ Matt's states table, presets, settings layers, agent skills and CLI reference, limits found in Task 0. Screenshots taken from the running extension: board, card detail with summary, settings, wizard.
- [ ] **Step 2:** `npm run check`, version `0.1.0`, tag, push. Repo stays private. Making it public and sending it to the OpenChamber directory are Kamil's calls.
