// src/service/main.ts
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

// node_modules/@openchamber/sdk/dist/scrollbar-style.js
var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
function installGuestScrollbarActivity(doc) {
  const root = doc.documentElement;
  if (root.hasAttribute("data-oc-scrollbar-activity"))
    return;
  root.setAttribute("data-oc-scrollbar-activity", "");
  const timers = /* @__PURE__ */ new WeakMap();
  doc.addEventListener("scroll", (event) => {
    const target = event.target === doc ? root : event.target;
    if (!(target instanceof Element))
      return;
    if (!target.hasAttribute("data-oc-scrolling"))
      target.setAttribute("data-oc-scrolling", "");
    const pending2 = timers.get(target);
    if (pending2 !== void 0)
      clearTimeout(pending2);
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      target.removeAttribute("data-oc-scrolling");
    }, 1e3));
  }, { capture: true, passive: true });
}
var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;

// node_modules/@openchamber/sdk/dist/manifest.js
var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);

// node_modules/@openchamber/sdk/dist/session-events.js
var GUEST_SESSION_EVENT_TYPES = [
  "turn-finished",
  "turn-failed",
  "permission-asked",
  "question-asked",
  "turn-started",
  "session-created",
  "session-archived",
  "session-deleted"
];
var SESSION_EVENTS_PATH = "/session-events";
var SESSION_EVENTS_WIRE_VERSION = 1;
var SESSION_EVENTS_IDLE_MS = 10 * 6e4;
var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);
var isGuestSessionEventType = (value) => EVENT_TYPES.has(value);
var readSessionEventRequest = (body) => {
  let wire;
  try {
    const parsed = JSON.parse(body);
    if (Object(parsed) !== parsed || parsed === null)
      return null;
    wire = parsed;
  } catch {
    return null;
  }
  const { v, requestId, event, content: content2 } = wire;
  if (v !== SESSION_EVENTS_WIRE_VERSION)
    return null;
  if (String(requestId) !== requestId || requestId.length === 0)
    return null;
  if (Object(event) !== event || event === void 0)
    return null;
  const { id, type, at, session, project, linked, permission, question } = event;
  if (String(id) !== id || id.length === 0)
    return null;
  if (String(type) !== type || !isGuestSessionEventType(type))
    return null;
  if (!Number.isFinite(at))
    return null;
  if (Object(session) !== session || session === void 0)
    return null;
  const sessionId = session.id;
  if (String(sessionId) !== sessionId || sessionId.length === 0)
    return null;
  const parentId = session.parentId;
  if (parentId !== null && (String(parentId) !== parentId || parentId.length === 0))
    return null;
  if (Object(project) !== project || project === void 0)
    return null;
  const directory = project.directory;
  if (directory !== null && (String(directory) !== directory || directory.length === 0))
    return null;
  if (!Array.isArray(linked))
    return null;
  const request = {
    v: SESSION_EVENTS_WIRE_VERSION,
    requestId,
    event: { id, type, at: Number(at), session: { id: sessionId, parentId }, project: { directory }, linked }
  };
  if (permission !== void 0) {
    if (Object(permission) !== permission)
      return null;
    const permissionRequestId = permission.requestId;
    if (String(permissionRequestId) !== permissionRequestId || permissionRequestId.length === 0)
      return null;
    request.event.permission = { requestId: permissionRequestId };
  }
  if (question !== void 0) {
    if (Object(question) !== question)
      return null;
    const { kind, id: questionId } = question;
    if (kind !== "form" && kind !== "page")
      return null;
    if (String(questionId) !== questionId || questionId.length === 0)
      return null;
    request.event.question = { kind, id: questionId };
  }
  if (content2 !== void 0) {
    if (Object(content2) !== content2 || content2.type !== type)
      return null;
    request.content = content2;
  }
  return request;
};

// node_modules/@openchamber/sdk/dist/service-host.js
var SERVICE_HOST_PATH = "/service/call";
var OPENCHAMBER_HOST_CALLBACK_URL_ENV = "OPENCHAMBER_HOST_CALLBACK_URL";
var SERVICE_HOST_TIMEOUT_MS = 3e4;
var SERVICE_SCHEDULE_IDLE_MS = 10 * 6e4;
var MENTIONS_IDLE_MS = 10 * 6e4;
var ServiceHostError = class extends Error {
  code;
  status;
  constructor(message2, code2, status) {
    super(message2);
    this.name = "ServiceHostError";
    this.code = code2;
    this.status = status;
  }
};
var createServiceHost = ({ env }) => {
  const call = async (method, input) => {
    const base = env[OPENCHAMBER_HOST_CALLBACK_URL_ENV];
    const token2 = env.OPENCHAMBER_SERVICE_TOKEN;
    if (!base || !token2)
      throw new ServiceHostError("This service was not started by OpenChamber.", "HOST_UNAVAILABLE", 0);
    let response;
    try {
      response = await fetch(`${base.replace(/\/+$/, "")}${SERVICE_HOST_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token2}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method, input }),
        signal: AbortSignal.timeout(SERVICE_HOST_TIMEOUT_MS)
      });
    } catch {
      throw new ServiceHostError("OpenChamber did not answer.", "HOST_UNAVAILABLE", 0);
    }
    const body = await response.json().catch(() => null);
    if (response.ok && body?.result !== void 0)
      return body.result;
    throw new ServiceHostError(body?.error?.message ?? `OpenChamber answered HTTP ${response.status}.`, body?.error?.code ?? "HOST_UNAVAILABLE", response.status);
  };
  return {
    sessions: {
      start: (input) => call("sessions.start", input),
      send: (sessionId, prompt) => call("sessions.send", { sessionId, prompt }),
      retry: (sessionId) => call("sessions.retry", { sessionId }),
      status: (sessionId) => call("sessions.status", { sessionId }),
      lastReply: (sessionId) => call("sessions.lastReply", { sessionId }),
      stop: (sessionId) => call("sessions.stop", { sessionId }),
      answerPermission: (sessionId, requestId, answer) => call("sessions.answerPermission", { sessionId, requestId, ...answer }),
      answerForm: (sessionId, formId, values, message2) => call("sessions.answerForm", { sessionId, formId, values, ...message2 === void 0 ? {} : { message: message2 } })
    },
    setInstructions: (directory, text) => call("instructions.set", { directory, text }),
    emit: (topic, data) => call("panels.emit", { topic, data }),
    readSettings: () => call("settings.read", {}).then(({ settings }) => settings),
    needsConfiguration: (message2) => call("status.set", { needsConfiguration: message2 }),
    setMark: (target, mark) => call("marks.set", { target, mark })
  };
};

// node_modules/@openchamber/sdk/dist/contract.js
var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
var GUEST_GENERATE_LATE_KEEP_MS = 60 * 6e4;
var HOST_REQUEST_ERROR_CODES = [
  "HOST_UNAVAILABLE",
  "HOST_TIMEOUT",
  "HOST_REJECTED",
  "DISCONNECTED",
  "DISABLED",
  "BAD_PATH",
  "NO_INTEGRATION",
  "NO_SERVICE",
  "SERVICE_FAILED",
  "REQUEST_FAILED",
  "RESPONSE_TOO_LARGE",
  "NO_SESSION",
  "SESSION_BUSY",
  "NOT_GRANTED",
  "NO_DIRECTORY",
  "NOT_FOUND",
  "FILE_TOO_LARGE",
  "DENIED",
  "NO_MODEL",
  "MODEL_FAILED",
  "UNSUPPORTED"
];
var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);

// node_modules/@openchamber/sdk/dist/service-providers.js
var BROWSER_CONTROL_ACTIONS = [
  "browser.open",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.inspect",
  "browser.capture",
  "browser.resize",
  "browser.close"
];
var BROWSER_PROVIDER_IDLE_MS = 10 * 6e4;
var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 6e4;
var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 6e4;
var TRACKER_PROVIDER_IDLE_MS = 10 * 6e4;
var QUOTA_PROVIDER_IDLE_MS = 10 * 6e4;

// node_modules/@openchamber/sdk/dist/service-surface.js
var SURFACE_CONTROLLERS = ["none", "agent", "user"];
var CONTROLLERS = new Set(SURFACE_CONTROLLERS);

// src/core/exec.ts
import { execFile } from "node:child_process";
var MAX_BUFFER = 64 * 1024 * 1024;
var realExec = (cmd, args, opts) => new Promise((resolve) => {
  execFile(
    cmd,
    args,
    { cwd: opts.cwd, encoding: "utf8", maxBuffer: MAX_BUFFER, windowsHide: true },
    (error2, stdout, stderr) => {
      if (error2 === null) {
        resolve({ code: 0, stdout, stderr });
        return;
      }
      const code2 = error2.code;
      if (code2 === "ENOENT") {
        resolve({ code: 127, stdout: "", stderr: `${cmd}: command not found` });
      } else if (typeof code2 === "number") {
        resolve({ code: code2, stdout, stderr });
      } else {
        resolve({ code: 1, stdout, stderr: stderr || error2.message });
      }
    }
  );
});

// src/service/routes.ts
import { stat as stat2 } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

// src/core/config.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// src/core/templates/index.ts
var TEMPLATES = {
  local: '# Issue tracker: Local Markdown\n\nIssues and specs for this repo live as markdown files in `.scratch/`.\n\n## Conventions\n\n- One feature per directory: `.scratch/<feature-slug>/`\n- The spec is `.scratch/<feature-slug>/spec.md`\n- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file\n- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)\n- Comments and conversation history append to the bottom of the file under a `## Comments` heading\n\n## When a skill says "publish to the issue tracker"\n\nCreate a new file under `.scratch/<feature-slug>/` (creating the directory if needed).\n\n## When a skill says "fetch the relevant ticket"\n\nRead the file at the referenced path. The user will normally pass the path or the issue number directly.\n\n## Wayfinding operations\n\nUsed by `/wayfinder`. The **map** is a file with one **child** file per ticket.\n\n- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).\n- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.\n- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.\n- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.\n- **Claim**: set `Status: claimed` and save before any work.\n- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map\'s Decisions-so-far in `map.md`.\n',
  github: '# Issue tracker: GitHub\n\nIssues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.\n\n## Conventions\n\n- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.\n- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.\n- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq \'[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]\'` with appropriate `--label` and `--state` filters.\n- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.\n- **Comment on an issue**: `gh issue comment <number> --body "..."`\n- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`\n- **Close**: `gh issue close <number> --comment "..."`\n\nInfer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.\n\n## Pull requests as a triage surface\n\n**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_\n\nWhen set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:\n\n- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.\n- **List external PRs for triage**: `gh api --paginate \'repos/{owner}/{repo}/pulls?state=open\' --jq \'.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}\'`.\n- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.\n\nGitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.\n\n## When a skill says "publish to the issue tracker"\n\nCreate a GitHub issue.\n\n## When a skill says "fetch the relevant ticket"\n\nRead it as in **Read an issue** above.\n\n## Wayfinding operations\n\nUsed by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.\n\n- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.\n- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren\'t enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.\n- **Blocking**: GitHub\'s **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker\'s numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren\'t available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.\n- **Frontier query**: list the map\'s open children (`gh issue list --state open`, scoped to the map\'s sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.\n- **Claim**: `gh issue edit <n> --add-assignee @me`, the session\'s first write.\n- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map\'s Decisions-so-far.\n',
  triageLabels: '# Triage Labels\n\nThe skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo\'s issue tracker.\n\n| Label in mattpocock/skills | Label in our tracker | Meaning                                  |\n| -------------------------- | -------------------- | ---------------------------------------- |\n| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |\n| `needs-info`               | `needs-info`         | Waiting on reporter for more information |\n| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |\n| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |\n| `wontfix`                  | `wontfix`            | Will not be actioned                     |\n\nWhen a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.\n\nEdit the "Label in our tracker" column to match whatever vocabulary you actually use.\n'
};

// src/core/types.ts
var TrackerError = class extends Error {
  // Declared explicitly: Node's type stripping does not support constructor parameter properties.
  code;
  constructor(code2, message2) {
    super(message2);
    this.name = "TrackerError";
    this.code = code2;
  }
};

// src/core/config.ts
var DIR = "docs/agents";
var ISSUE_TRACKER = `${DIR}/issue-tracker.md`;
var TRIAGE_LABELS = `${DIR}/triage-labels.md`;
var ROLES = ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"];
var HEADING = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
var isNotFound = (e) => typeof e === "object" && e !== null && e.code === "ENOENT";
var readOptional = async (path) => {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
};
var firstHeading = (text) => {
  for (const line of text.split(/\r?\n/)) {
    const m = HEADING.exec(line);
    if (m) return m[1];
  }
  return null;
};
var detect = (text) => {
  const heading = firstHeading(text);
  if (heading === null) {
    throw new TrackerError("UNSUPPORTED", `${ISSUE_TRACKER} has no heading naming the tracker`);
  }
  if (/local markdown/i.test(heading)) return "local";
  if (/github/i.test(heading)) return "github";
  throw new TrackerError(
    "UNSUPPORTED",
    `Unsupported issue tracker "${heading}" in ${ISSUE_TRACKER}: ICF-kanban supports Local Markdown and GitHub`
  );
};
var cell = (s) => s.trim().replace(/^`+|`+$/g, "").trim();
var parseLabels = (text) => {
  const labels = Object.fromEntries(ROLES.map((r) => [r, r]));
  if (text === null) return labels;
  for (const line of text.split(/\r?\n/)) {
    const row = line.trim();
    if (!row.startsWith("|")) continue;
    const cells = row.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell);
    if (cells.length < 2) continue;
    const role = cells[0];
    const label = cells[1];
    if (ROLES.includes(role) && label !== "") labels[role] = label;
  }
  return labels;
};
var readLabels = async (root) => parseLabels(await readOptional(join(root, TRIAGE_LABELS)));
var readConfig = async (root) => {
  const tracker2 = await readOptional(join(root, ISSUE_TRACKER));
  if (tracker2 === null) {
    throw new TrackerError("NOT_CONFIGURED", `No ${ISSUE_TRACKER}: choose a tracker (Local Markdown or GitHub) first`);
  }
  return { tracker: detect(tracker2), labels: await readLabels(root) };
};
var writeNew = async (path, text) => {
  try {
    await writeFile(path, text, { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
};
var writeConfig = async (root, tracker2) => {
  if (tracker2 !== "local" && tracker2 !== "github") {
    throw new TrackerError("INVALID", `Unknown tracker "${String(tracker2)}": use local or github`);
  }
  await mkdir(join(root, DIR), { recursive: true });
  await writeNew(join(root, ISSUE_TRACKER), tracker2 === "local" ? TEMPLATES.local : TEMPLATES.github);
};

// src/core/githubTracker.ts
var MIN_GH = [2, 94];
var DONE_WINDOW_MS = 30 * 24 * 3600 * 1e3;
var ROLES2 = ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"];
var CATEGORIES = ["bug", "enhancement"];
var TYPE_PREFIX = "type:";
var LIST_FIELDS = "number,title,body,labels,state,updatedAt,url,closedAt";
var ROLE_DESCRIPTIONS = {
  "needs-triage": "Maintainer needs to evaluate this issue",
  "needs-info": "Waiting on reporter for more information",
  "ready-for-agent": "Fully specified, ready for an AFK agent",
  "ready-for-human": "Requires human implementation",
  wontfix: "Will not be actioned"
};
var RELATION_FIELDS = "number parent { number } subIssues(first: 100) { totalCount nodes { number state } } issueDependenciesSummary { totalBlockedBy } blockedBy(first: 100) { nodes { number } }";
var ISSUE_FIELDS = `title body state url updatedAt closedAt labels(first: 100) { nodes { name } } ${RELATION_FIELDS}`;
var parseNumber = (id) => {
  const m = typeof id === "string" ? /^\s*#?(\d+)\s*$/.exec(id) : null;
  if (m === null || Number(m[1]) === 0) throw new TrackerError("INVALID", `GitHub task id must be "#<number>": ${String(id)}`);
  return Number(m[1]);
};
var idOf = (n) => `#${n}`;
var bodyBlockers = (body) => {
  const out = [];
  const take = (text) => {
    for (const m of text.matchAll(/#(\d+)\b/g)) {
      const n = Number(m[1]);
      if (!out.includes(n)) out.push(n);
    }
  };
  let inSection = false;
  for (const line of body.split(/\r?\n/)) {
    const heading = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      inSection = /^blocked by:?$/i.test(heading[1].replace(/[*_]/g, "").trim());
      continue;
    }
    if (inSection) {
      take(line);
      continue;
    }
    const m = /^\s*[-*]?\s*[*_]*blocked by:?[*_]*:?\s*(.*)$/i.exec(line);
    if (m) take(m[1]);
  }
  return out;
};
var CATEGORY_DESCRIPTIONS = {
  bug: "Something isn't working",
  enhancement: "New feature or request"
};
var versionOf = (stdout) => {
  const m = /gh version (\d+)\.(\d+)(?:\.(\d+))?/.exec(stdout.split("\n")[0] ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
};
var createGithubTracker = (root, exec, labels) => {
  const stateLabels = ROLES2.map((r) => labels[r]);
  let preflight = null;
  let known = null;
  const missing = () => new TrackerError("GH_MISSING", "GitHub CLI (gh) is not installed: install it with `brew install gh`, then run `gh auth login`");
  const check = async () => {
    const v = await exec("gh", ["--version"], { cwd: root });
    if (v.code === 127) throw missing();
    const version = versionOf(v.stdout);
    if (v.code !== 0 || version === null) {
      throw new TrackerError("FAILED", `Cannot read the gh version: ${(v.stderr || v.stdout).trim()}`);
    }
    if (version[0] < MIN_GH[0] || version[0] === MIN_GH[0] && version[1] < MIN_GH[1]) {
      throw new TrackerError(
        "GH_OLD",
        `gh ${version.join(".")} is too old: ICF-kanban needs gh ${MIN_GH.join(".")} or later; update it with \`brew upgrade gh\``
      );
    }
    const auth = await exec("gh", ["auth", "status"], { cwd: root });
    if (auth.code === 127) throw missing();
    if (auth.code !== 0) {
      const detail = (auth.stderr || auth.stdout).trim();
      throw new TrackerError("GH_AUTH", `gh is not logged in to GitHub: run \`gh auth login\`${detail ? ` (${detail})` : ""}`);
    }
  };
  const ready = () => {
    if (preflight === null) {
      preflight = check();
      preflight.catch(() => {
        preflight = null;
      });
    }
    return preflight;
  };
  const failed = (args, r) => new TrackerError("FAILED", `gh ${args.slice(0, 2).join(" ")} failed: ${(r.stderr || r.stdout).trim() || `exit code ${r.code}`}`);
  const run = async (args, allowFailure = false) => {
    await ready();
    const r = await exec("gh", args, { cwd: root });
    if (r.code === 127) throw missing();
    if (r.code !== 0 && !allowFailure) throw failed(args, r);
    return r;
  };
  const parseJson = (text, what) => {
    try {
      return JSON.parse(text);
    } catch {
      throw new TrackerError("FAILED", `gh returned invalid JSON for ${what}`);
    }
  };
  const graph = async (numbers, full) => {
    const fields = full ? ISSUE_FIELDS : RELATION_FIELDS;
    const aliases = numbers.map((n) => `i${n}: issue(number: ${n}) { ${fields} }`).join(" ");
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${aliases} } }`;
    const args = ["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-f", `query=${query}`];
    const r = await run(args, true);
    let data = null;
    try {
      data = JSON.parse(r.stdout);
    } catch {
      data = null;
    }
    const repo = data?.data?.repository;
    if (r.code !== 0 && (repo === void 0 || repo === null)) throw failed(args, r);
    if (repo === void 0 || repo === null) throw new TrackerError("FAILED", "gh api graphql returned no repository");
    return new Map(numbers.map((n) => [n, repo[`i${n}`] ?? null]));
  };
  const relationsOf = (g) => ({
    parent: g?.parent?.number ?? null,
    children: (g?.subIssues?.nodes ?? []).map((c) => ({ number: c.number, open: c.state === "OPEN" })),
    childCount: g?.subIssues?.totalCount ?? 0,
    blockedBy: g?.issueDependenciesSummary && g.issueDependenciesSummary.totalBlockedBy > 0 && g.blockedBy ? g.blockedBy.nodes.map((b) => b.number) : null
  });
  const stateOf = (issue) => {
    if (issue.state !== "OPEN") return "done";
    return ROLES2.find((r) => issue.labels.includes(labels[r])) ?? "needs-triage";
  };
  const typeOf = (names) => {
    const category = CATEGORIES.find((c) => names.includes(c));
    if (category !== void 0) return category;
    const custom = names.find((l) => l.toLowerCase().startsWith(TYPE_PREFIX));
    return custom === void 0 ? null : custom.slice(TYPE_PREFIX.length).trim() || null;
  };
  const toTask = (issue, rel) => ({
    id: idOf(issue.number),
    kind: rel.childCount > 0 ? "parent" : "ticket",
    title: issue.title,
    body: issue.body,
    state: stateOf(issue),
    type: typeOf(issue.labels),
    parentId: rel.parent === null ? null : idOf(rel.parent),
    blockedBy: (rel.blockedBy ?? bodyBlockers(issue.body)).map(idOf),
    url: issue.url,
    updatedAt: Date.parse(issue.updatedAt) || 0
  });
  const load = async (n) => {
    const g = (await graph([n], true)).get(n) ?? null;
    if (g === null) throw new TrackerError("NOT_FOUND", `Issue not found: #${n}`);
    const issue = {
      number: g.number,
      title: g.title ?? "",
      body: g.body ?? "",
      labels: (g.labels?.nodes ?? []).map((l) => l.name),
      state: g.state ?? "OPEN",
      updatedAt: g.updatedAt ?? "",
      url: g.url ?? "",
      closedAt: g.closedAt ?? null
    };
    const rel = relationsOf(g);
    return { task: toTask(issue, rel), issue, rel };
  };
  const get = async (id) => (await load(parseNumber(id))).task;
  const typeLabel = (type) => CATEGORIES.includes(type) ? type : `${TYPE_PREFIX}${type}`;
  const isTypeLabel = (l) => CATEGORIES.includes(l) || l.toLowerCase().startsWith(TYPE_PREFIX);
  const ensureLabels = async (names) => {
    if (known === null) {
      known = run(["label", "list", "--limit", "1000", "--json", "name"]).then(
        (r) => new Set(parseJson(r.stdout, "label list").map((l) => l.name))
      );
      known.catch(() => {
        known = null;
      });
    }
    const have = await known;
    for (const name of names) {
      if (have.has(name)) continue;
      const role = ROLES2.find((r) => labels[r] === name);
      const description = role !== void 0 ? ROLE_DESCRIPTIONS[role] : CATEGORY_DESCRIPTIONS[name] ?? "Task type";
      await run(["label", "create", name, "--description", description]);
      have.add(name);
    }
  };
  const swapLabels = async (n, add, remove) => {
    if (add === null && remove.length === 0) return;
    if (add !== null) await ensureLabels([add]);
    const args = ["issue", "edit", String(n)];
    if (add !== null) args.push("--add-label", add);
    for (const l of remove) args.push("--remove-label", l);
    await run(args);
  };
  const setState = async (id, state2) => {
    const { issue } = await load(parseNumber(id));
    const open = issue.state === "OPEN";
    if (state2 === "done") {
      if (open) await run(["issue", "close", String(issue.number)]);
      return get(idOf(issue.number));
    }
    if (!ROLES2.includes(state2)) throw new TrackerError("INVALID", `Unknown state: ${String(state2)}`);
    if (!open) await run(["issue", "reopen", String(issue.number)]);
    const label = labels[state2];
    const remove = issue.labels.filter((l) => stateLabels.includes(l) && l !== label);
    await swapLabels(issue.number, issue.labels.includes(label) ? null : label, remove);
    return get(idOf(issue.number));
  };
  return {
    preflight: ready,
    setupLabels: () => ensureLabels([...stateLabels, ...CATEGORIES]),
    async list() {
      const r = await run(["issue", "list", "--state", "all", "--limit", "500", "--json", LIST_FIELDS]);
      const raw = parseJson(r.stdout, "issue list");
      const now = Date.now();
      const issues = raw.map((i) => ({ ...i, body: i.body ?? "", labels: (i.labels ?? []).map((l) => l.name) })).filter((i) => i.state === "OPEN" || i.closedAt !== null && now - Date.parse(i.closedAt) <= DONE_WINDOW_MS).sort((a, b) => a.number - b.number);
      if (issues.length === 0) return [];
      const rel = await graph(issues.map((i) => i.number), false);
      return issues.map((i) => toTask(i, relationsOf(rel.get(i.number) ?? null)));
    },
    get,
    async create(input) {
      if (typeof input.title !== "string" || input.title.trim() === "") throw new TrackerError("INVALID", "Title is required");
      const parent = input.parentId === void 0 ? null : parseNumber(input.parentId);
      const blockers = (input.blockedBy ?? []).map(parseNumber);
      const type = input.type?.trim() ? typeLabel(input.type.trim()) : null;
      const state2 = input.state === void 0 || input.state === "done" ? null : labels[input.state];
      if (input.state !== void 0 && input.state !== "done" && state2 === void 0) {
        throw new TrackerError("INVALID", `Unknown state: ${String(input.state)}`);
      }
      const add = [state2, type].filter((l) => l !== null);
      await ensureLabels(add);
      const args = ["issue", "create", "--title", input.title.trim(), "--body", input.body ?? ""];
      for (const l of add) args.push("--label", l);
      if (parent !== null) args.push("--parent", String(parent));
      if (blockers.length > 0) args.push("--blocked-by", blockers.join(","));
      const r = await run(args);
      const m = /\/issues\/(\d+)\s*$/.exec(r.stdout.trim());
      if (m === null) throw new TrackerError("FAILED", `gh issue create printed no issue URL: ${r.stdout.trim()}`);
      const n = Number(m[1]);
      if (input.state === "done") await run(["issue", "close", String(n)]);
      return get(idOf(n));
    },
    setState,
    async setType(id, type) {
      const value = typeof type === "string" ? type.trim() : "";
      if (value === "") throw new TrackerError("INVALID", "Type is required");
      const { issue } = await load(parseNumber(id));
      const label = typeLabel(value);
      const remove = issue.labels.filter((l) => isTypeLabel(l) && l !== label);
      await swapLabels(issue.number, issue.labels.includes(label) ? null : label, remove);
      return get(idOf(issue.number));
    },
    async close(id, opts) {
      const { issue, rel } = await load(parseNumber(id));
      const closed = [];
      if (opts.withChildren) {
        for (const child of rel.children.filter((c) => c.open)) {
          await run(["issue", "close", String(child.number)]);
          closed.push(child.number);
        }
      }
      if (issue.state === "OPEN") await run(["issue", "close", String(issue.number)]);
      const out = [await get(idOf(issue.number))];
      for (const n of closed) out.push(await get(idOf(n)));
      return out;
    }
  };
};

// src/core/localTracker.ts
import { mkdir as mkdir2, readdir, readFile as readFile2, stat, writeFile as writeFile2 } from "node:fs/promises";
import { join as join2, posix } from "node:path";

// src/core/localFormat.ts
var BOLD_FIELD = /^\*\*(Status|Type|Blocked by):\*\*\s*(.*)$/;
var BARE_FIELD = /^(Status|Type|Blocked by):\s*(.*)$/;
var HEADING2 = /^# (.*)$/;
var NONE_BLOCKERS = "None (can start immediately)";
var splitLines = (text) => text.split("\n");
var content = (line) => line.endsWith("\r") ? line.slice(0, -1) : line;
var matchField = (line) => {
  const c = content(line);
  const bold = BOLD_FIELD.exec(c);
  if (bold) return { field: bold[1], value: bold[2].trim(), bare: false };
  const bare = BARE_FIELD.exec(c);
  if (bare) return { field: bare[1], value: bare[2].trim(), bare: true };
  return null;
};
var FENCE = /^\s{0,3}(```|~~~)/;
var SECTION = /^## /;
var plainLines = (lines, headerOnly) => {
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const c = content(lines[i]);
    const f = FENCE.exec(c);
    if (fence !== null) {
      if (f && f[1] === fence) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    if (headerOnly && SECTION.test(c)) break;
    out.push([i, c]);
  }
  return out;
};
var headerFields = (lines) => {
  const out = [];
  for (const [index, c] of plainLines(lines, true)) {
    const m = matchField(c);
    if (m) out.push({ index, ...m });
  }
  return out;
};
var readFields = (text) => {
  const out = {};
  for (const m of headerFields(splitLines(text))) {
    if (out[m.field] === void 0) out[m.field] = m.value;
  }
  return out;
};
var headingIndex = (lines) => {
  for (const [i, c] of plainLines(lines, false)) if (HEADING2.test(c)) return i;
  return -1;
};
var readHeading = (text) => {
  const lines = splitLines(text);
  const i = headingIndex(lines);
  return i < 0 ? null : HEADING2.exec(content(lines[i]))[1].trim();
};
var toState = (word) => {
  const w = (word ?? "").trim().toLowerCase();
  switch (w) {
    case "resolved":
    case "closed":
    case "done":
      return "done";
    case "claimed":
      return "ready-for-agent";
    case "needs-info":
    case "ready-for-agent":
    case "ready-for-human":
    case "wontfix":
    case "needs-triage":
      return w;
    default:
      return "needs-triage";
  }
};
var fromState = (state2) => state2 === "done" ? "resolved" : state2;
var toType = (value) => {
  const v = (value ?? "").trim().toLowerCase();
  return v === "" ? null : v;
};
var toBlockers = (value) => {
  const v = (value ?? "").trim();
  if (v === "" || /^none\b/i.test(v)) return [];
  return [...v.matchAll(/\d+/g)].map((m) => Number(m[0]));
};
var parseIssue = (text, fileName) => {
  const fields = readFields(text);
  const heading = readHeading(text);
  const title = heading !== null ? heading.replace(/^\d+:\s*/, "") : fileName.replace(/\.md$/i, "");
  return {
    title,
    state: toState(fields.Status),
    type: toType(fields.Type),
    blockedBy: toBlockers(fields["Blocked by"]),
    body: text
  };
};
var parseSpec = (text, featureSlug) => {
  const fields = readFields(text);
  return {
    title: readHeading(text) ?? featureSlug,
    state: toState(fields.Status),
    type: toType(fields.Type)
  };
};
var patchLine = (text, field, value) => {
  const lines = splitLines(text);
  const fields = headerFields(lines);
  const existing = fields.find((f) => f.field === field);
  if (existing) {
    const cr = lines[existing.index].endsWith("\r") ? "\r" : "";
    lines[existing.index] = formatField(field, value, existing.bare) + cr;
    return lines.join("\n");
  }
  const crlf = text.includes("\r\n");
  const newLine = formatField(field, value, fields[0]?.bare ?? false) + (crlf ? "\r" : "");
  let at;
  const status = fields.find((f) => f.field === "Status");
  if (status) {
    at = status.index;
  } else if (fields.length > 0) {
    at = fields[fields.length - 1].index + 1;
  } else {
    const titleAt = headingIndex(lines);
    at = 0;
    if (titleAt >= 0) {
      at = titleAt + 1;
      if (at < lines.length && content(lines[at]).trim() === "") at++;
    }
  }
  lines.splice(at, 0, newLine);
  return lines.join("\n");
};
var formatField = (field, value, bare) => bare ? `${field}: ${value}` : `**${field}:** ${value}`;
var pad = (n) => String(n).padStart(2, "0");
var blockerRef = (id) => {
  const base = id.split("/").pop() ?? id;
  const m = /^(\d+)(?:-|\.md$|$)/.exec(base);
  return m ? pad(Number(m[1])) : id;
};
var NOT_PARAGRAPH = /^\s*(?:[-+]\s|\*\s|\d+[.)]\s|#|```|~~~|>|\|)/;
var renderIssue = (n, input) => {
  const blockers = (input.blockedBy ?? []).map(blockerRef);
  const body = (input.body ?? "").replace(/\r\n/g, "\n").replace(/^\s*\n/, "").replace(/\s+$/, "");
  let lead = "";
  let rest = body;
  if (body !== "" && !NOT_PARAGRAPH.test(body)) {
    const cut = body.search(/\n[ \t]*\n/);
    lead = cut < 0 ? body : body.slice(0, cut);
    rest = cut < 0 ? "" : body.slice(cut).replace(/^\s*\n/, "");
  }
  const parts = [`# ${pad(n)}: ${input.title.trim()}`];
  if (lead !== "") parts.push(lead);
  parts.push(`**Blocked by:** ${blockers.length > 0 ? blockers.join(", ") : NONE_BLOCKERS}`);
  if (input.type !== void 0 && input.type.trim() !== "") parts.push(`**Type:** ${input.type.trim()}`);
  parts.push(`**Status:** ${fromState(input.state ?? "needs-triage")}`);
  if (rest !== "") parts.push(rest);
  return parts.join("\n\n") + "\n";
};
var slugify = (title) => {
  const slug = title.replace(/[łŁ]/g, "l").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return slug === "" ? "issue" : slug;
};
var issueFileName = (n, title) => `${pad(n)}-${slugify(title)}.md`;

// src/core/localTracker.ts
var SCRATCH = ".scratch";
var DONE_WINDOW_MS2 = 30 * 24 * 3600 * 1e3;
var ID = /^\.scratch\/([^/]+)\/(spec\.md|issues\/([^/]+\.md))$/;
var NN = /^(\d+)/;
var specId = (feature) => `${SCRATCH}/${feature}/spec.md`;
var ticketId = (feature, file) => `${SCRATCH}/${feature}/issues/${file}`;
var statusWord = (state2) => state2 === "done" ? "resolved" : state2;
var parseId = (id) => {
  if (typeof id !== "string" || id.includes("\\") || id.includes("\0") || posix.isAbsolute(id)) {
    throw new TrackerError("INVALID", `Invalid task id: ${String(id)}`);
  }
  const m = ID.exec(posix.normalize(id));
  if (!m || m[1] === "." || m[1] === ".." || m[3] === ".md") {
    throw new TrackerError("INVALID", `Task id must be .scratch/<feature>/spec.md or .scratch/<feature>/issues/<file>.md: ${id}`);
  }
  return m[3] === void 0 ? { feature: m[1], kind: "parent", file: null } : { feature: m[1], kind: "ticket", file: m[3] };
};
var isNotFound2 = (e) => typeof e === "object" && e !== null && e.code === "ENOENT";
var readText = async (path) => {
  try {
    const [text, s] = await Promise.all([readFile2(path, "utf8"), stat(path)]);
    return { text, mtime: s.mtimeMs };
  } catch (e) {
    if (isNotFound2(e)) return null;
    throw e;
  }
};
var dirNames = async (path) => {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort();
  } catch (e) {
    if (isNotFound2(e)) return [];
    throw e;
  }
};
var issueFiles = async (path) => {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md")).map((e) => e.name).sort((a, b) => fileNumber(a) - fileNumber(b) || a.localeCompare(b));
  } catch (e) {
    if (isNotFound2(e)) return [];
    throw e;
  }
};
var fileNumber = (file) => {
  const m = NN.exec(file);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
};
var isRecent = (t, now) => t.state !== "done" || now - t.updatedAt <= DONE_WINDOW_MS2;
var createLocalTracker = (root) => {
  const abs = (id) => join2(root, ...id.split("/"));
  const featureDir = (feature) => join2(root, SCRATCH, feature);
  const issuesDir = (feature) => join2(featureDir(feature), "issues");
  const featureExists = async (feature) => {
    try {
      return (await stat(featureDir(feature))).isDirectory();
    } catch (e) {
      if (isNotFound2(e)) return false;
      throw e;
    }
  };
  const loadParent = async (feature) => {
    const file = await readText(abs(specId(feature)));
    if (file === null) {
      if (!await featureExists(feature)) return null;
      const s = await stat(featureDir(feature));
      return {
        id: specId(feature),
        kind: "parent",
        title: feature,
        body: "",
        state: "needs-triage",
        type: null,
        parentId: null,
        blockedBy: [],
        url: null,
        updatedAt: s.mtimeMs
      };
    }
    const p = parseSpec(file.text, feature);
    return {
      id: specId(feature),
      kind: "parent",
      title: p.title,
      body: file.text,
      state: p.state,
      type: p.type,
      parentId: null,
      blockedBy: [],
      url: null,
      updatedAt: file.mtime
    };
  };
  const resolveBlockers = (feature, numbers, files) => {
    const out = [];
    for (const n of numbers) {
      const file = files.find((f) => fileNumber(f) === n);
      if (file !== void 0) {
        const id = ticketId(feature, file);
        if (!out.includes(id)) out.push(id);
      }
    }
    return out;
  };
  const loadTicket = async (feature, file, files) => {
    const id = ticketId(feature, file);
    const data = await readText(abs(id));
    if (data === null) return null;
    const p = parseIssue(data.text, file);
    const siblings = files ?? await issueFiles(issuesDir(feature));
    return {
      id,
      kind: "ticket",
      title: p.title,
      body: data.text,
      state: p.state,
      type: p.type,
      parentId: specId(feature),
      blockedBy: resolveBlockers(feature, p.blockedBy, siblings),
      url: null,
      updatedAt: data.mtime
    };
  };
  const get = async (id) => {
    const ref = parseId(id);
    const task = ref.kind === "parent" ? await loadParent(ref.feature) : await loadTicket(ref.feature, ref.file);
    if (task === null) throw new TrackerError("NOT_FOUND", `Task not found: ${id}`);
    return task;
  };
  const patch = async (id, field, value) => {
    const task = await get(id);
    const ref = parseId(task.id);
    const base = task.body === "" && ref.kind === "parent" ? `# ${task.title}

` : task.body;
    await writeFile2(abs(task.id), patchLine(base, field, value));
    return get(task.id);
  };
  const setState = (id, state2) => patch(id, "Status", statusWord(state2));
  const slugOf = (title) => issueFileName(0, title).slice(3, -3);
  const createParent = async (input) => {
    const slug = slugOf(input.title);
    await mkdir2(join2(root, SCRATCH), { recursive: true });
    for (let i = 1; ; i++) {
      const feature = i === 1 ? slug : `${slug}-${i}`;
      try {
        await mkdir2(featureDir(feature));
      } catch (e) {
        if (e.code === "EEXIST") continue;
        throw e;
      }
      const parts = [`# ${input.title.trim()}`];
      const fields = [];
      if (input.type !== void 0 && input.type.trim() !== "") fields.push(`**Type:** ${input.type.trim()}`);
      if (input.state !== void 0) fields.push(`**Status:** ${statusWord(input.state)}`);
      if (fields.length > 0) parts.push(fields.join("\n"));
      const body = (input.body ?? "").replace(/\r\n/g, "\n").trim();
      if (body !== "") parts.push(body);
      await writeFile2(abs(specId(feature)), parts.join("\n\n") + "\n", { flag: "wx" });
      return get(specId(feature));
    }
  };
  const createTicket = async (input, parentId) => {
    const ref = parseId(parentId);
    if (ref.kind !== "parent") throw new TrackerError("INVALID", `Parent must be a spec.md id: ${parentId}`);
    if (!await featureExists(ref.feature)) throw new TrackerError("NOT_FOUND", `Parent not found: ${parentId}`);
    for (const b of input.blockedBy ?? []) {
      const bRef = parseId(b);
      if (bRef.kind !== "ticket" || bRef.feature !== ref.feature) {
        throw new TrackerError("INVALID", `Blocker must be a ticket of the same feature as ${parentId}: ${b}`);
      }
      if (await readText(abs(ticketId(bRef.feature, bRef.file))) === null) {
        throw new TrackerError("INVALID", `Blocker does not exist: ${b}`);
      }
    }
    await mkdir2(issuesDir(ref.feature), { recursive: true });
    for (; ; ) {
      const files = await issueFiles(issuesDir(ref.feature));
      const highest = files.map(fileNumber).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
      const n = highest + 1;
      const file = issueFileName(n, input.title);
      try {
        await writeFile2(join2(issuesDir(ref.feature), file), renderIssue(n, input), { flag: "wx" });
      } catch (e) {
        if (e.code === "EEXIST") continue;
        throw e;
      }
      return get(ticketId(ref.feature, file));
    }
  };
  return {
    async list() {
      const now = Date.now();
      const out = [];
      for (const feature of await dirNames(join2(root, SCRATCH))) {
        const files = await issueFiles(issuesDir(feature));
        const parent = await loadParent(feature);
        if (parent !== null && isRecent(parent, now)) out.push(parent);
        for (const file of files) {
          const t = await loadTicket(feature, file, files);
          if (t !== null && isRecent(t, now)) out.push(t);
        }
      }
      return out;
    },
    get,
    create(input) {
      if (typeof input.title !== "string" || input.title.trim() === "") {
        return Promise.reject(new TrackerError("INVALID", "Title is required"));
      }
      return input.parentId === void 0 ? createParent(input) : createTicket(input, input.parentId);
    },
    setState,
    setType(id, type) {
      return patch(id, "Type", type.trim());
    },
    async close(id, opts) {
      const task = await get(id);
      const closed = [await setState(task.id, "done")];
      if (opts.withChildren && task.kind === "parent") {
        const { feature } = parseId(task.id);
        for (const file of await issueFiles(issuesDir(feature))) {
          const child = await loadTicket(feature, file);
          if (child !== null && child.state !== "done") closed.push(await setState(child.id, "done"));
        }
      }
      return closed;
    }
  };
};

// src/core/openTracker.ts
var openTracker = async (root, exec) => {
  const config = await readConfig(root);
  if (config.tracker === "local") return createLocalTracker(root);
  return createGithubTracker(root, exec, config.labels);
};

// src/service/queue.ts
import { homedir } from "node:os";
import { join as join3 } from "node:path";

// src/core/queue.ts
var nextToStart = (queued, running, maxParallel) => queued.slice(0, Math.max(0, maxParallel - running));

// src/service/store.ts
import { randomBytes } from "node:crypto";
import { mkdir as mkdir3, readFile as readFile3, rename, writeFile as writeFile3 } from "node:fs/promises";
import { dirname } from "node:path";
var code = (e) => e?.code;
var readJson = async (file, now = Date.now) => {
  let text;
  try {
    text = await readFile3(file, "utf8");
  } catch (e) {
    if (code(e) === "ENOENT") return null;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch {
    try {
      await rename(file, `${file}.corrupt-${now()}`);
    } catch (e) {
      if (code(e) !== "ENOENT") throw e;
    }
    return null;
  }
};
var writeJson = async (file, data) => {
  await mkdir3(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile3(tmp, `${JSON.stringify(data, null, 2)}
`, "utf8");
  await rename(tmp, file);
};
var chains = /* @__PURE__ */ new Map();
var serial = (file, fn) => {
  const run = (chains.get(file) ?? Promise.resolve()).then(fn);
  const tail = run.catch(() => {
  });
  chains.set(file, tail);
  void tail.then(() => {
    if (chains.get(file) === tail) chains.delete(file);
  });
  return run;
};

// src/service/queue.ts
var defaultQueueFile = () => join3(homedir(), ".icf-kanban", "queue.json");
var DEFAULT_MAX_PARALLEL = 3;
var MAX_PARALLEL_LIMIT = 10;
var RESERVE_MS = 18e4;
var isEntry = (v) => {
  const e = v;
  return typeof e === "object" && e !== null && typeof e.taskId === "string" && typeof e.title === "string" && typeof e.prompt === "string" && (e.model === null || typeof e.model === "string") && (e.agent === null || typeof e.agent === "string") && (e.location === "worktree" || e.location === "project") && typeof e.queuedAt === "number" && (e.lastError === void 0 || typeof e.lastError === "string");
};
var clampMax = (n) => typeof n === "number" && Number.isFinite(n) ? Math.min(MAX_PARALLEL_LIMIT, Math.max(1, Math.round(n))) : DEFAULT_MAX_PARALLEL;
var readQueueFile = async (file) => {
  const raw = await readJson(file);
  const projects = {};
  const src = raw?.projects;
  if (typeof src === "object" && src !== null && !Array.isArray(src)) {
    for (const [dir, q] of Object.entries(src)) {
      const p = q;
      if (typeof p !== "object" || p === null || !Array.isArray(p.entries)) continue;
      projects[dir] = { maxParallel: clampMax(p.maxParallel), entries: p.entries.filter(isEntry) };
    }
  }
  return { version: 1, projects };
};
var update = (file, dir, fn) => serial(file, async () => {
  const data = await readQueueFile(file);
  const q = data.projects[dir] ?? { maxParallel: DEFAULT_MAX_PARALLEL, entries: [] };
  const before = JSON.stringify(data.projects[dir] ?? null);
  const result = await fn(q);
  if (q.entries.length === 0) delete data.projects[dir];
  else data.projects[dir] = q;
  if (JSON.stringify(data.projects[dir] ?? null) !== before) await writeJson(file, data);
  return result;
});
var listQueue = async (file, dir) => (await readQueueFile(file)).projects[dir]?.entries ?? [];
var queuedProjects = async (file) => Object.entries((await readQueueFile(file)).projects).filter(([, q]) => q.entries.length > 0).map(([dir]) => dir);
var addToQueue = (file, dir, entry, maxParallel) => {
  forgetRemoval(file, dir, entry.taskId);
  return update(file, dir, (q) => {
    if (maxParallel !== void 0) q.maxParallel = clampMax(maxParallel);
    if (!q.entries.some((e) => e.taskId === entry.taskId)) q.entries.push(entry);
    return [...q.entries];
  });
};
var removeFromQueue = (file, dir, taskId) => {
  const p = pendingFor(file, dir);
  if (p.reserved.has(taskId) || p.inFlight.has(taskId)) p.removed.add(taskId);
  release(file, dir, taskId);
  return update(file, dir, (q) => {
    q.entries = q.entries.filter((e) => e.taskId !== taskId);
    return [...q.entries];
  });
};
var requeueFailed = (file, dir, entry, error2) => {
  release(file, dir, entry.taskId);
  if (forgetRemoval(file, dir, entry.taskId)) return listQueue(file, dir);
  return update(file, dir, (q) => {
    q.entries = q.entries.filter((e) => e.taskId !== entry.taskId);
    q.entries.unshift({ ...entry, lastError: error2 });
    return [...q.entries];
  });
};
var pending = /* @__PURE__ */ new Map();
var pendingFor = (file, dir) => {
  const key = `${file}\0${dir}`;
  let p = pending.get(key);
  if (p === void 0) {
    p = { reserved: /* @__PURE__ */ new Map(), inFlight: /* @__PURE__ */ new Map(), removed: /* @__PURE__ */ new Set() };
    pending.set(key, p);
  }
  return p;
};
var release = (file, dir, taskId) => {
  pendingFor(file, dir).reserved.delete(taskId);
};
var forgetRemoval = (file, dir, taskId) => pendingFor(file, dir).removed.delete(taskId);
var inFlight = async (file, dir, taskId, fn) => {
  const p = pendingFor(file, dir);
  p.inFlight.set(taskId, (p.inFlight.get(taskId) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const n = (p.inFlight.get(taskId) ?? 1) - 1;
    if (n <= 0) p.inFlight.delete(taskId);
    else p.inFlight.set(taskId, n);
  }
};
var runningNow = (links, p, starting, now) => {
  for (const [taskId, at] of p.reserved) if (now - at >= RESERVE_MS) p.reserved.delete(taskId);
  const live = links.filter((l) => l.status === "busy" || l.status === "waiting");
  const liveTasks = new Set(live.map((l) => l.taskId));
  const starts = /* @__PURE__ */ new Set([...p.reserved.keys(), ...p.inFlight.keys(), ...starting]);
  let n = new Set(live.map((l) => l.sessionId)).size;
  for (const id of starts) if (!liveTasks.has(id)) n++;
  return n;
};
var takeFromQueue = (file, dir, input) => update(file, dir, async (q) => {
  if (input.maxParallel !== void 0) q.maxParallel = clampMax(input.maxParallel);
  if (q.entries.length === 0) return { taken: [], queue: [] };
  const links = await input.links();
  if (links.some((l) => l.status === "error")) return { taken: [], queue: [...q.entries] };
  const live = new Set(links.filter((l) => l.status === "busy" || l.status === "waiting").map((l) => l.taskId));
  q.entries = q.entries.filter((e) => !live.has(e.taskId));
  const now = (input.now ?? Date.now)();
  const p = pendingFor(file, dir);
  const running = runningNow(links, p, [...input.starting ?? [], ...input.running ?? []], now);
  const ids = new Set(nextToStart(q.entries.map((e) => e.taskId), running, q.maxParallel));
  const taken = q.entries.filter((e) => ids.has(e.taskId));
  q.entries = q.entries.filter((e) => !ids.has(e.taskId));
  for (const e of taken) p.reserved.set(e.taskId, now);
  return { taken, queue: [...q.entries] };
});

// src/service/sessions.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { homedir as homedir2 } from "node:os";
import { basename, dirname as dirname2, join as join4, sep } from "node:path";
var LINKS_PER_PROJECT = 500;
var defaultLinksFile = () => join4(homedir2(), ".icf-kanban", "links.json");
var isLink = (v) => {
  const l = v;
  return typeof l === "object" && l !== null && typeof l.taskId === "string" && typeof l.sessionId === "string" && typeof l.directory === "string" && typeof l.createdAt === "number";
};
var readLinksFile = async (file) => {
  const raw = await readJson(file);
  const projects = {};
  const src = raw?.projects;
  if (typeof src === "object" && src !== null && !Array.isArray(src)) {
    for (const [dir, list] of Object.entries(src)) if (Array.isArray(list)) projects[dir] = list.filter(isLink);
  }
  return { version: 1, projects };
};
var listLinks = async (file, directory) => (await readLinksFile(file)).projects[directory] ?? [];
var addLink = (file, project, link) => serial(file, async () => {
  const data = await readLinksFile(file);
  const list = [...data.projects[project] ?? [], link];
  data.projects[project] = list.slice(-LINKS_PER_PROJECT);
  await writeJson(file, data);
});
var STATUS_CHECK_MAX = 50;
var STATUS_CONCURRENCY = 8;
var unknownSession = (e) => {
  const err = e;
  return err?.status === 404 || err?.status === 410 || err?.code === "NOT_FOUND";
};
var STALE_LINK_MS = 24 * 60 * 60 * 1e3;
var linkStatuses = async (links, sessions, now = Date.now()) => {
  const out = /* @__PURE__ */ new Map();
  const status = sessions?.status;
  const newest = /* @__PURE__ */ new Map();
  for (const l of links) {
    const n = newest.get(l.taskId);
    if (n === void 0 || l.createdAt >= n.createdAt) newest.set(l.taskId, l);
  }
  const ask = [...newest.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, STATUS_CHECK_MAX);
  const failed = (l) => now - l.createdAt >= STALE_LINK_MS ? "unknown" : "error";
  if (status === void 0) {
    for (const l of ask) out.set(l.sessionId, failed(l));
    return out;
  }
  let next = 0;
  const worker = async () => {
    while (next < ask.length) {
      const l = ask[next++];
      try {
        out.set(l.sessionId, await status(l.sessionId));
      } catch (e) {
        out.set(l.sessionId, unknownSession(e) ? "unknown" : failed(l));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(STATUS_CONCURRENCY, ask.length) }, worker));
  return out;
};
var withStatus = async (links, sessions) => {
  const statuses = await linkStatuses(links, sessions);
  return links.map((l) => ({ ...l, status: statuses.get(l.sessionId) ?? "unknown" }));
};
var isInside = (dir, root) => dir === root || dir.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
var worktreeSlug = (taskId, title, suffix = randomBytes2(3).toString("hex")) => {
  const base = (s) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  const name = base(title) || base(taskId.replace(/^.*\//, "").replace(/\.md$/, "")) || "task";
  return `${name}-${suffix}`;
};
var worktreesRoot = (directory) => join4(dirname2(directory), `${basename(directory)}-worktrees`);
var message = (e) => e instanceof Error ? e.message : String(e);
var startSession = async (input, deps2) => {
  let worktree = null;
  if (input.location === "worktree") {
    const slug = worktreeSlug(input.taskId, input.title, deps2.suffix?.());
    const path = join4(worktreesRoot(input.directory), slug);
    const r = await deps2.exec("git", ["-C", input.directory, "worktree", "add", "-b", `icf/${slug}`, path], { cwd: input.directory });
    if (r.code !== 0) {
      throw new TrackerError("FAILED", `Could not create the worktree ${path}: ${(r.stderr || r.stdout).trim() || `git exited ${r.code}`}`);
    }
    worktree = path;
  }
  const cwd = worktree ?? input.directory;
  let started;
  try {
    started = await deps2.sessions.start({
      prompt: input.prompt,
      directory: cwd,
      title: input.title,
      ...input.model !== null ? { model: input.model } : {},
      ...input.agent !== null ? { agent: input.agent } : {}
    });
  } catch (e) {
    const kept = worktree === null ? "" : ` The worktree ${worktree} was created and is kept; remove it with git worktree remove if you do not need it.`;
    throw new TrackerError("FAILED", `Could not start the session: ${message(e).replace(/\.$/, "")}.${kept}`);
  }
  const directory = started.directory ?? cwd;
  try {
    await addLink(deps2.linksFile, input.directory, { taskId: input.taskId, sessionId: started.sessionId, directory, createdAt: Date.now() });
  } catch (e) {
    throw new TrackerError(
      "FAILED",
      `The session ${started.sessionId} started, but its link to the card could not be saved (${message(e)}); the card will not follow it.`
    );
  }
  return { sessionId: started.sessionId, directory, worktree };
};

// src/service/routes.ts
var STATES = ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix", "done"];
var InvalidRequest = class extends Error {
};
var invalid = (message2) => {
  throw new InvalidRequest(message2);
};
var error = (status, code2, message2) => ({ status, json: { error: { code: code2, message: message2 } } });
var isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var optional = (body, key) => {
  const v = body[key];
  if (v === void 0 || v === null) return null;
  return typeof v === "string" ? v.trim() === "" ? null : v.trim() : invalid(`"${key}" must be a string or null`);
};
var str = (body, key) => {
  const v = body[key];
  return typeof v === "string" && v.trim() !== "" ? v : invalid(`"${key}" must be a non-empty string`);
};
var state = (v, key) => typeof v === "string" && STATES.includes(v) ? v : invalid(`"${key}" must be one of ${STATES.join(", ")}`);
var directoryOf = async (body) => {
  if (!isObject(body)) return invalid('Request body must be a JSON object with "directory"');
  const dir = body.directory;
  if (typeof dir !== "string" || !isAbsolute(dir)) return invalid('"directory" must be an absolute path');
  let isDir = false;
  try {
    isDir = (await stat2(dir)).isDirectory();
  } catch {
  }
  return isDir ? dir : invalid(`"directory" is not an existing directory: ${dir}`);
};
var newTask = (v) => {
  if (!isObject(v)) return invalid('"input" must be an object with "title"');
  const task = { title: str(v, "title") };
  if (v.body !== void 0) task.body = typeof v.body === "string" ? v.body : invalid('"input.body" must be a string');
  if (v.type !== void 0) task.type = str(v, "type");
  if (v.state !== void 0) task.state = state(v.state, "input.state");
  if (v.parentId !== void 0) task.parentId = str(v, "parentId");
  if (v.blockedBy !== void 0) {
    const b = v.blockedBy;
    task.blockedBy = Array.isArray(b) && b.every((id) => typeof id === "string" && id.trim() !== "") ? b : invalid('"input.blockedBy" must be an array of task ids');
  }
  return task;
};
var defaultCliPath = () => fileURLToPath(new URL("../build/cli/task-board.mjs", import.meta.url));
var linksFile = (deps2) => deps2.linksFile ?? defaultLinksFile();
var queueFile = (deps2) => deps2.queueFile ?? defaultQueueFile();
var location = (v, key) => v === "worktree" || v === "project" ? v : invalid(`"${key}" must be "worktree" or "project"`);
var queueEntry = (v) => {
  if (!isObject(v)) return invalid('"entry" must be an object');
  const queuedAt = v.queuedAt;
  return {
    taskId: str(v, "taskId"),
    title: str(v, "title"),
    prompt: str(v, "prompt"),
    model: optional(v, "model"),
    agent: optional(v, "agent"),
    location: location(v.location, "entry.location"),
    queuedAt: queuedAt === void 0 ? Date.now() : typeof queuedAt === "number" ? queuedAt : invalid('"entry.queuedAt" must be a number')
  };
};
var maxParallelOf = (body) => body.maxParallel === void 0 ? void 0 : typeof body.maxParallel === "number" ? clampMax(body.maxParallel) : invalid('"maxParallel" must be a number');
var start = async (dir, input, deps2) => {
  if (deps2.sessions === void 0) throw new TrackerError("FAILED", "Starting sessions from the service is not available");
  const sessions = deps2.sessions;
  try {
    return await inFlight(
      queueFile(deps2),
      dir,
      input.taskId,
      () => startSession(
        { directory: dir, ...input },
        { exec: deps2.exec, sessions, linksFile: linksFile(deps2), ...deps2.suffix ? { suffix: deps2.suffix } : {} }
      )
    );
  } finally {
    release(queueFile(deps2), dir, input.taskId);
  }
};
var liveLinks = async (dir, deps2) => withStatus(await listLinks(linksFile(deps2), dir), deps2.sessions);
var ERROR_MAX = 500;
var drainProject = async (dir, deps2) => {
  const { taken } = await takeFromQueue(queueFile(deps2), dir, { links: () => liveLinks(dir, deps2) });
  const log = deps2.log ?? ((m) => console.error(m));
  await Promise.all(
    taken.map(async (e) => {
      try {
        await start(dir, { taskId: e.taskId, title: e.title, prompt: e.prompt, model: e.model, agent: e.agent, location: e.location }, deps2);
        forgetRemoval(queueFile(deps2), dir, e.taskId);
      } catch (err) {
        const why = (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MAX);
        log(`icf-kanban: could not start the queued task ${e.taskId}: ${why}`);
        await requeueFailed(queueFile(deps2), dir, e, why).catch(
          (w) => log(`icf-kanban: could not put ${e.taskId} back in the queue: ${w instanceof Error ? w.message : String(w)}`)
        );
      }
    })
  );
};
var DRAIN_EVENTS = /* @__PURE__ */ new Set(["turn-finished", "turn-failed"]);
var onSessionEvent = async (req, deps2) => {
  const { event } = req;
  if (!DRAIN_EVENTS.has(event.type) || event.session.parentId !== null) return;
  const dir = event.project.directory;
  for (const project of await queuedProjects(queueFile(deps2))) {
    const links = await listLinks(linksFile(deps2), project);
    const ours = links.some((l) => l.sessionId === event.session.id) || dir !== null && (isInside(dir, project) || isInside(dir, worktreesRoot(project)) || links.some((l) => isInside(dir, l.directory)));
    if (ours) await drainProject(project, deps2);
  }
};
var tracker = (dir, deps2) => openTracker(dir, deps2.exec);
var existingConfig = async (dir) => {
  try {
    return await readConfig(dir);
  } catch (e) {
    if (e instanceof TrackerError && e.code === "NOT_CONFIGURED") return null;
    throw e;
  }
};
var githubRemote = (output) => {
  const remotes = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^(\S+)\s+(\S+)/.exec(line);
    if (m === null) continue;
    const url = m[2];
    if (/^(?:[a-z+]+:\/\/)?(?:[^@/\s]+@)?github\.com[:/]/i.test(url)) remotes.push({ name: m[1], url });
  }
  return (remotes.find((r) => r.name === "origin") ?? remotes[0])?.url ?? null;
};
var POST = {
  "/config/read": async (_body, dir) => {
    try {
      return { config: await readConfig(dir) };
    } catch (e) {
      if (e instanceof TrackerError && (e.code === "NOT_CONFIGURED" || e.code === "UNSUPPORTED")) {
        return { error: { code: e.code, message: e.message } };
      }
      throw e;
    }
  },
  "/config/init": async (body, dir, deps2) => {
    const kind = body.tracker;
    if (kind !== "local" && kind !== "github") return invalid('"tracker" must be "local" or "github"');
    const alreadySetUp = (tracker2) => {
      throw new TrackerError(
        "INVALID",
        `docs/agents/issue-tracker.md already configures the ${tracker2} tracker; it was left unchanged`
      );
    };
    const existing = await existingConfig(dir);
    if (existing !== null && existing.tracker !== kind) alreadySetUp(existing.tracker);
    const gh = kind === "github" ? createGithubTracker(dir, deps2.exec, await readLabels(dir)) : null;
    await gh?.preflight();
    await writeConfig(dir, kind);
    const config = await readConfig(dir);
    if (config.tracker !== kind) alreadySetUp(config.tracker);
    await gh?.setupLabels();
    return { config };
  },
  "/config/detect": async (_body, dir, deps2) => {
    const r = await deps2.exec("git", ["remote", "-v"], { cwd: dir });
    return { remote: r.code === 0 ? githubRemote(r.stdout) : null };
  },
  "/tasks/list": async (_body, dir, deps2) => ({ tasks: await (await tracker(dir, deps2)).list() }),
  "/tasks/get": async (body, dir, deps2) => {
    const id = str(body, "id");
    return { task: await (await tracker(dir, deps2)).get(id) };
  },
  "/tasks/create": async (body, dir, deps2) => {
    const input = newTask(body.input);
    return { task: await (await tracker(dir, deps2)).create(input) };
  },
  "/tasks/state": async (body, dir, deps2) => {
    const id = str(body, "id");
    const to = state(body.state, "state");
    return { task: await (await tracker(dir, deps2)).setState(id, to) };
  },
  "/tasks/type": async (body, dir, deps2) => {
    const id = str(body, "id");
    const type = str(body, "type");
    return { task: await (await tracker(dir, deps2)).setType(id, type) };
  },
  "/tasks/close": async (body, dir, deps2) => {
    const id = str(body, "id");
    const w = body.withChildren;
    const withChildren = w === void 0 ? false : typeof w === "boolean" ? w : invalid('"withChildren" must be a boolean');
    return { tasks: await (await tracker(dir, deps2)).close(id, { withChildren }) };
  },
  "/sessions/start": async (body, dir, deps2) => {
    const taskId = str(body, "taskId");
    const title = str(body, "title");
    const prompt = str(body, "prompt");
    const model = optional(body, "model");
    const agent = optional(body, "agent");
    const where = location(body.location, "location");
    return start(dir, { taskId, title, prompt, model, agent, location: where }, deps2);
  },
  /** Links with the live status of their session (idle, busy, waiting, unknown). */
  "/links/list": async (_body, dir, deps2) => ({
    links: (await liveLinks(dir, deps2)).map((l) => l.status === "error" ? { ...l, status: "unknown" } : l)
  }),
  /** A session the panel started itself (path A), so the queue counts it while it runs. */
  "/links/add": async (body, dir, deps2) => {
    const taskId = str(body, "taskId");
    const sessionId = str(body, "sessionId");
    const at = optional(body, "sessionDirectory");
    if (at !== null && !isAbsolute(at)) return invalid('"sessionDirectory" must be an absolute path');
    await addLink(linksFile(deps2), dir, { taskId, sessionId, directory: at ?? dir, createdAt: Date.now() });
    release(queueFile(deps2), dir, taskId);
    return {};
  },
  "/queue/list": async (_body, dir, deps2) => ({ queue: await listQueue(queueFile(deps2), dir) }),
  "/queue/add": async (body, dir, deps2) => ({ queue: await addToQueue(queueFile(deps2), dir, queueEntry(body.entry), maxParallelOf(body)) }),
  "/queue/remove": async (body, dir, deps2) => ({ queue: await removeFromQueue(queueFile(deps2), dir, str(body, "taskId")) }),
  "/queue/take": async (body, dir, deps2) => {
    const ids = (key) => {
      const s = body[key];
      return s === void 0 ? [] : Array.isArray(s) && s.every((id) => typeof id === "string") ? s : invalid(`"${key}" must be an array of task ids`);
    };
    const max = maxParallelOf(body);
    return takeFromQueue(queueFile(deps2), dir, {
      ...max !== void 0 ? { maxParallel: max } : {},
      starting: ids("starting"),
      running: ids("running"),
      links: () => liveLinks(dir, deps2)
    });
  }
};
var GET = {
  "/health": () => ({}),
  "/cli": (deps2) => ({ path: deps2.cliPath ?? defaultCliPath() })
};
var handle = async (method, path, body, deps2) => {
  try {
    const m = method.toUpperCase();
    const get = GET[path];
    const post = POST[path];
    if (path === SESSION_EVENTS_PATH) {
      if (m !== "POST") return error(405, "INVALID", `${path} does not accept ${m}`);
      const req = readSessionEventRequest(JSON.stringify(body ?? null));
      if (req === null) return error(400, "INVALID", "Not a session event of a known wire version");
      return { status: 200, json: { ok: true }, after: () => onSessionEvent(req, deps2) };
    }
    if (get === void 0 && post === void 0) return error(404, "NOT_FOUND", `No route ${path}`);
    if (m === "GET" && get !== void 0) return { status: 200, json: get(deps2) };
    if (m === "POST" && post !== void 0) {
      const dir = await directoryOf(body);
      return { status: 200, json: await post(body, dir, deps2) };
    }
    return error(405, "INVALID", `${path} does not accept ${m}`);
  } catch (e) {
    if (e instanceof InvalidRequest) return error(400, "INVALID", e.message);
    if (e instanceof TrackerError) return error(422, e.code, e.message);
    return error(500, "FAILED", e instanceof Error ? e.message : String(e));
  }
};

// src/service/main.ts
var MAX_BODY = 1024 * 1024;
var token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? "";
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
if (token === "" || !Number.isInteger(port) || port <= 0) {
  console.error("icf-kanban service: OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required");
  process.exit(1);
}
var expected = Buffer.from(`Bearer ${token}`);
var host = createServiceHost({ env: process.env });
var deps = {
  exec: realExec,
  sessions: { start: (input) => host.sessions.start(input), status: async (id) => (await host.sessions.status(id)).status }
};
var authorized = (req) => {
  const got = Buffer.from(req.headers.authorization ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
};
var send = (res, status, json) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(json));
};
var TooLarge = class extends Error {
};
var readBody = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new TooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};
var server = createServer((req, res) => {
  void (async () => {
    if (!authorized(req)) {
      res.writeHead(401).end();
      return;
    }
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    let body;
    try {
      const text = await readBody(req);
      body = text.trim() === "" ? void 0 : JSON.parse(text);
    } catch (e) {
      if (e instanceof TooLarge) send(res, 413, { error: { code: "INVALID", message: "Request body is too large" } });
      else send(res, 400, { error: { code: "INVALID", message: "Request body is not valid JSON" } });
      return;
    }
    const reply = await handle(req.method ?? "GET", path, body, deps);
    send(res, reply.status, reply.json);
    await reply.after?.().catch((e) => console.error(`icf-kanban: ${e instanceof Error ? e.message : String(e)}`));
  })().catch((e) => {
    if (!res.headersSent) send(res, 500, { error: { code: "FAILED", message: e instanceof Error ? e.message : String(e) } });
    else res.destroy();
  });
});
server.listen(port, "127.0.0.1");
var stop = () => {
  server.close(() => process.exit(0));
  server.closeAllConnections();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
