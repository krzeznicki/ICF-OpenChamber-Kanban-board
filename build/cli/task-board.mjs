#!/usr/bin/env node

// src/cli/main.ts
import { readFile as readFile3 } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

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
  constructor(code, message) {
    super(message);
    this.name = "TrackerError";
    this.code = code;
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
  for (const line2 of text.split(/\r?\n/)) {
    const m = HEADING.exec(line2);
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
  for (const line2 of text.split(/\r?\n/)) {
    const row = line2.trim();
    if (!row.startsWith("|")) continue;
    const cells = row.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell);
    if (cells.length < 2) continue;
    const role = cells[0];
    const label = cells[1];
    if (ROLES.includes(role) && label !== "") labels[role] = label;
  }
  return labels;
};
var readConfig = async (root) => {
  const tracker = await readOptional(join(root, ISSUE_TRACKER));
  if (tracker === null) {
    throw new TrackerError("NOT_CONFIGURED", `No ${ISSUE_TRACKER}: choose a tracker (Local Markdown or GitHub) first`);
  }
  return { tracker: detect(tracker), labels: parseLabels(await readOptional(join(root, TRIAGE_LABELS))) };
};
var writeNew = async (path, text) => {
  try {
    await writeFile(path, text, { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
};
var writeConfig = async (root, tracker) => {
  if (tracker !== "local" && tracker !== "github") {
    throw new TrackerError("INVALID", `Unknown tracker "${String(tracker)}": use local or github`);
  }
  await mkdir(join(root, DIR), { recursive: true });
  await writeNew(join(root, ISSUE_TRACKER), tracker === "local" ? TEMPLATES.local : TEMPLATES.github);
};

// src/core/exec.ts
import { execFile } from "node:child_process";
var MAX_BUFFER = 64 * 1024 * 1024;
var realExec = (cmd, args, opts) => new Promise((resolve2) => {
  execFile(
    cmd,
    args,
    { cwd: opts.cwd, encoding: "utf8", maxBuffer: MAX_BUFFER, windowsHide: true },
    (error, stdout, stderr) => {
      if (error === null) {
        resolve2({ code: 0, stdout, stderr });
        return;
      }
      const code = error.code;
      if (code === "ENOENT") {
        resolve2({ code: 127, stdout: "", stderr: `${cmd}: command not found` });
      } else if (typeof code === "number") {
        resolve2({ code, stdout, stderr });
      } else {
        resolve2({ code: 1, stdout, stderr: stderr || error.message });
      }
    }
  );
});

// src/core/localTracker.ts
import { mkdir as mkdir2, readdir, readFile as readFile2, stat, writeFile as writeFile2 } from "node:fs/promises";
import { join as join2, posix } from "node:path";

// src/core/localFormat.ts
var BOLD_FIELD = /^\*\*(Status|Type|Blocked by):\*\*\s*(.*)$/;
var BARE_FIELD = /^(Status|Type|Blocked by):\s*(.*)$/;
var HEADING2 = /^# (.*)$/;
var NONE_BLOCKERS = "None (can start immediately)";
var splitLines = (text) => text.split("\n");
var content = (line2) => line2.endsWith("\r") ? line2.slice(0, -1) : line2;
var matchField = (line2) => {
  const c = content(line2);
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
var fromState = (state) => state === "done" ? "resolved" : state;
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
var DONE_WINDOW_MS = 30 * 24 * 3600 * 1e3;
var ID = /^\.scratch\/([^/]+)\/(spec\.md|issues\/([^/]+\.md))$/;
var NN = /^(\d+)/;
var specId = (feature) => `${SCRATCH}/${feature}/spec.md`;
var ticketId = (feature, file) => `${SCRATCH}/${feature}/issues/${file}`;
var statusWord = (state) => state === "done" ? "resolved" : state;
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
var isRecent = (t, now) => t.state !== "done" || now - t.updatedAt <= DONE_WINDOW_MS;
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
  const setState = (id, state) => patch(id, "Status", statusWord(state));
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
  void exec;
  throw new TrackerError("UNSUPPORTED", "GitHub Issues tracker is not available in this build yet");
};

// src/cli/main.ts
var USAGE = `Usage: task-board <command> [options]

Commands:
  list [--state <state>] [--ready]      tasks, one per line
  show <id>                             one task with its body
  create --title <t> [--type <x>] [--body-file <f>|-] [--parent <id>] [--state <state>]
  state <id> <state>                    set the state ('done' closes)
  next                                  first ready-for-agent ticket with no open blocker
  close <id> [--with-children]          close a task (and a feature's tickets)
  init <local|github>                   write docs/agents/issue-tracker.md

Options for every command:
  --dir <path>   project root (default: current directory)
  --json         machine-readable output

States: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix, done
Exit codes: 0 ok, 2 usage, 3 nothing found, 4 tracker error
`;
var STATES = ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix", "done"];
var OPTIONS = {
  dir: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  state: { type: "string" },
  ready: { type: "boolean" },
  title: { type: "string" },
  type: { type: "string" },
  "body-file": { type: "string" },
  parent: { type: "string" },
  "with-children": { type: "boolean" }
};
var COMMANDS = {
  list: { positionals: 0, options: ["state", "ready"] },
  show: { positionals: 1, options: [] },
  create: { positionals: 0, options: ["title", "type", "body-file", "parent", "state"] },
  state: { positionals: 2, options: [] },
  next: { positionals: 0, options: [] },
  close: { positionals: 1, options: ["with-children"] },
  init: { positionals: 1, options: [] }
};
var GLOBAL = ["dir", "json", "help"];
var UsageError = class extends Error {
};
var usage = (message) => {
  throw new UsageError(message);
};
var toState2 = (value, what) => STATES.includes(value) ? value : usage(`Unknown ${what} "${value}"`);
var byId = (a, b) => a.id.localeCompare(b.id, "en", { numeric: true });
var readyTickets = (tasks) => {
  const state = new Map(tasks.map((t) => [t.id, t.state]));
  const open = (id) => state.has(id) && state.get(id) !== "done";
  return tasks.filter((t) => t.kind === "ticket" && t.state === "ready-for-agent" && !t.blockedBy.some(open)).sort(byId);
};
var line = (t) => `${t.id}  [${t.state}]  ${t.title}
`;
var readStdin = async (stdin) => {
  if (stdin === void 0) return "";
  if (typeof stdin === "function") return stdin();
  let text = "";
  const decoder = new TextDecoder();
  for await (const chunk of stdin) text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
};
var parse = (argv) => {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    return usage(e.message);
  }
  const values = parsed.values;
  const [command = null, ...args] = parsed.positionals;
  if (values.help) return { command: null, args, values };
  if (command === null) return usage("Missing command");
  const spec = COMMANDS[command];
  if (spec === void 0) return usage(`Unknown command "${command}"`);
  for (const key of Object.keys(values)) {
    if (!GLOBAL.includes(key) && !spec.options.includes(key)) usage(`Option --${key} does not apply to ${command}`);
  }
  if (args.length !== spec.positionals) {
    usage(`${command} takes ${spec.positionals} argument${spec.positionals === 1 ? "" : "s"}, got ${args.length}`);
  }
  return { command, args, values };
};
var main = async (argv, io) => {
  let command;
  let args;
  let values;
  try {
    ({ command, args, values } = parse(argv));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.stderr(`task-board: ${e.message}

${USAGE}`);
    return 2;
  }
  if (command === null) {
    io.stdout(USAGE);
    return 0;
  }
  const json = values.json === true;
  const root = resolve(io.cwd, values.dir ?? ".");
  const exec = io.exec ?? realExec;
  const print = (value, human) => io.stdout(json ? `${JSON.stringify(value, null, 2)}
` : human);
  try {
    switch (command) {
      case "list": {
        const state = values.state === void 0 ? void 0 : toState2(values.state, "state");
        let tasks = await (await openTracker(root, exec)).list();
        if (state !== void 0) tasks = tasks.filter((t) => t.state === state);
        if (values.ready) {
          const ready = new Set(readyTickets(tasks).map((t) => t.id));
          tasks = tasks.filter((t) => ready.has(t.id));
        }
        print(tasks, tasks.map(line).join(""));
        return 0;
      }
      case "show": {
        const task = await (await openTracker(root, exec)).get(args[0]);
        const extra = task.url === null ? "" : `${task.url}
`;
        print(task, `${line(task)}${extra}
${task.body.replace(/\s*$/, "\n")}`);
        return 0;
      }
      case "create": {
        if (values.title === void 0 || values.title.trim() === "") usage("create needs --title");
        const state = values.state === void 0 ? void 0 : toState2(values.state, "state");
        let body;
        const file = values["body-file"];
        if (file === "-") body = await readStdin(io.stdin);
        else if (file !== void 0) {
          try {
            body = await readFile3(resolve(io.cwd, file), "utf8");
          } catch (e) {
            throw new TrackerError("INVALID", `Cannot read body file ${file}: ${e.message}`);
          }
        }
        const task = await (await openTracker(root, exec)).create({
          title: values.title,
          ...body === void 0 ? {} : { body },
          ...values.type === void 0 ? {} : { type: values.type },
          ...values.parent === void 0 ? {} : { parentId: values.parent },
          ...state === void 0 ? {} : { state }
        });
        print(task, line(task));
        return 0;
      }
      case "state": {
        const state = toState2(args[1], "state");
        const task = await (await openTracker(root, exec)).setState(args[0], state);
        print(task, line(task));
        return 0;
      }
      case "next": {
        const [task] = readyTickets(await (await openTracker(root, exec)).list());
        if (task === void 0) {
          io.stderr("task-board: no ready ticket (ready-for-agent with no open blocker)\n");
          return 3;
        }
        print(task, `${task.id}  ${task.title}
`);
        return 0;
      }
      case "close": {
        const closed = await (await openTracker(root, exec)).close(args[0], { withChildren: values["with-children"] === true });
        print(closed, closed.map(line).join(""));
        return 0;
      }
      case "init": {
        const kind = args[0];
        if (kind !== "local" && kind !== "github") return usage(`Unknown tracker "${kind}": use local or github`);
        await writeConfig(root, kind);
        const config = await readConfig(root);
        if (config.tracker !== kind) {
          throw new TrackerError(
            "INVALID",
            `docs/agents/issue-tracker.md already configures the ${config.tracker} tracker; it was left unchanged`
          );
        }
        print({ tracker: config.tracker }, `Tracker: ${config.tracker} (docs/agents/issue-tracker.md)
`);
        return 0;
      }
      default:
        return usage(`Unknown command "${command}"`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`task-board: ${e.message}

${USAGE}`);
      return 2;
    }
    const error = e instanceof TrackerError ? e : new TrackerError("FAILED", e instanceof Error ? e.message : String(e));
    io.stderr(`task-board: ${error.code}: ${error.message}
`);
    if (json) io.stdout(`${JSON.stringify({ error: { code: error.code, message: error.message } }, null, 2)}
`);
    return 4;
  }
};

// src/cli/task-board.ts
process.exitCode = await main(process.argv.slice(2), {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  stdin: process.stdin,
  cwd: process.cwd()
});
