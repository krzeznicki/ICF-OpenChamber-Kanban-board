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
var SOURCE_IDS = ["local", "github"];
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
var ADDITIONAL = "Additional sources";
var ADDITIONAL_HEADING = /^ {0,3}##\s+additional sources\s*#*\s*$/i;
var SECTION_END = /^ {0,3}#{1,2}\s/;
var SOURCE_ITEM = /^\s*[-*+]\s+`?([A-Za-z][\w.-]*)`?/;
var additionalRange = (lines) => {
  const start = lines.findIndex((l) => ADDITIONAL_HEADING.test(l));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !SECTION_END.test(lines[end])) end++;
  return { start, end };
};
var additionalSources = (text) => {
  const lines = text.split(/\r?\n/);
  const range = additionalRange(lines);
  if (range === null) return [];
  const out = [];
  for (const line2 of lines.slice(range.start + 1, range.end)) {
    const m = SOURCE_ITEM.exec(line2);
    if (m === null) continue;
    const id = m[1].toLowerCase();
    if (!SOURCE_IDS.includes(id)) {
      throw new TrackerError(
        "UNSUPPORTED",
        `Unsupported source "${m[1]}" under ## ${ADDITIONAL} in ${ISSUE_TRACKER}: ICF-kanban supports ${SOURCE_IDS.join(" and ")}`
      );
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
};
var SOURCE_TEXT = {
  local: "markdown files under `.scratch/` in this repository (private: they stay with the repository checkout)",
  github: "this repository's GitHub Issues (shared with the team)"
};
var additionalSourcesSection = (ids) => [
  `## ${ADDITIONAL}`,
  "",
  "The Kanban board also shows tasks from the sources below. Everything above describes the primary source: a new task goes there unless you name another source.",
  "",
  ...ids.map((id) => `- \`${id}\`: ${SOURCE_TEXT[id]}. Publish there with \`task-board create --source ${id} ...\`.`),
  "",
  "A sub-task always goes to its parent's source. Tasks of different sources are never linked: no parent or blocker across sources.",
  ""
].join("\n");
var withAdditionalSources = (text, ids) => {
  const lines = text.split("\n");
  const range = additionalRange(lines);
  const before = range === null ? text : lines.slice(0, range.start).join("\n");
  const after = range === null ? "" : lines.slice(range.end).join("\n").replace(/\s+$/, "");
  let out = `${before.replace(/\s+$/, "")}
`;
  if (after !== "") out += `
${after}
`;
  if (ids.length > 0) out += `
${additionalSourcesSection(ids)}`;
  return out;
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
var readLabels = async (root) => parseLabels(await readOptional(join(root, TRIAGE_LABELS)));
var readConfig = async (root) => {
  const tracker = await readOptional(join(root, ISSUE_TRACKER));
  if (tracker === null) {
    throw new TrackerError("NOT_CONFIGURED", `No ${ISSUE_TRACKER}: choose a tracker (Local Markdown or GitHub) first`);
  }
  const primary = detect(tracker);
  const sources = [primary, ...additionalSources(tracker).filter((id) => id !== primary)];
  return { tracker: primary, primary, sources, labels: await readLabels(root) };
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
var EditedTemplateError = class extends TrackerError {
  /** The primary source whose edited template would be replaced. */
  primary;
  constructor(primary) {
    super(
      "INVALID",
      `The ${primary} part of ${ISSUE_TRACKER} was edited by hand; changing the primary source replaces it with the new template and the edits are lost. Run it again with force (--force) to go ahead.`
    );
    this.name = "EditedTemplateError";
    this.primary = primary;
  }
};
var sourceOf = (change) => "add" in change ? change.add : "remove" in change ? change.remove : change.primary;
var changedText = (text, config, change, force) => {
  const others = config.sources.filter((id) => id !== config.primary);
  if ("add" in change) return withAdditionalSources(text, others.includes(change.add) || change.add === config.primary ? others : [...others, change.add]);
  if ("remove" in change) {
    if (change.remove === config.primary) {
      throw new TrackerError("INVALID", `${change.remove} is the primary source; make another source primary before removing it`);
    }
    return withAdditionalSources(text, others.filter((id) => id !== change.remove));
  }
  const primary = change.primary;
  if (primary === config.primary) return text;
  const rest = [config.primary, ...others].filter((id) => id !== primary);
  const base = withAdditionalSources(text, []);
  const old = TEMPLATES[config.primary];
  if (!base.startsWith(old) && !force) throw new EditedTemplateError(config.primary);
  const kept = base.startsWith(old) ? base.slice(old.length) : "";
  return withAdditionalSources(`${TEMPLATES[primary]}${kept}`, rest);
};
var changeSources = async (root, change, opts = {}) => {
  const id = sourceOf(change);
  if (!SOURCE_IDS.includes(id)) {
    throw new TrackerError("INVALID", `Unknown source "${String(id)}": use ${SOURCE_IDS.join(" or ")}`);
  }
  const config = await readConfig(root);
  const path = join(root, ISSUE_TRACKER);
  const text = await readFile(path, "utf8");
  const next = changedText(text, config, change, opts.force === true);
  if (next !== text) await writeFile(path, next);
  return readConfig(root);
};

// src/core/exec.ts
import { execFile } from "node:child_process";
var MAX_BUFFER = 64 * 1024 * 1024;
var realExec = (cmd, args, opts) => new Promise((resolve2) => {
  execFile(
    cmd,
    args,
    { cwd: opts.cwd, encoding: "utf8", maxBuffer: MAX_BUFFER, windowsHide: true, timeout: opts.timeoutMs ?? 0 },
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

// src/core/githubTracker.ts
var MIN_GH = [2, 94];
var DONE_WINDOW_MS = 30 * 24 * 3600 * 1e3;
var ROLES2 = ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"];
var CATEGORIES = ["bug", "enhancement"];
var TYPE_PREFIX = "type:";
var LIST_FIELDS = "number,title,body,labels,state,updatedAt,url,closedAt,assignees";
var ROLE_DESCRIPTIONS = {
  "needs-triage": "Maintainer needs to evaluate this issue",
  "needs-info": "Waiting on reporter for more information",
  "ready-for-agent": "Fully specified, ready for an AFK agent",
  "ready-for-human": "Requires human implementation",
  wontfix: "Will not be actioned"
};
var RELATION_FIELDS = "number parent { number } subIssues(first: 100) { totalCount nodes { number state } } issueDependenciesSummary { totalBlockedBy } blockedBy(first: 100) { nodes { number } }";
var ISSUE_FIELDS = `title body state url updatedAt closedAt labels(first: 100) { nodes { name } } assignees(first: 10) { nodes { login } } ${RELATION_FIELDS}`;
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
  for (const line2 of body.split(/\r?\n/)) {
    const heading = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line2);
    if (heading) {
      inSection = /^blocked by:?$/i.test(heading[1].replace(/[*_]/g, "").trim());
      continue;
    }
    if (inSection) {
      take(line2);
      continue;
    }
    const m = /^\s*[-*]?\s*[*_]*blocked by:?[*_]*:?\s*(.*)$/i.exec(line2);
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
    updatedAt: Date.parse(issue.updatedAt) || 0,
    claimed: issue.assignees.length > 0,
    source: "github"
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
      closedAt: g.closedAt ?? null,
      assignees: (g.assignees?.nodes ?? []).map((a) => a.login)
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
  const setState = async (id, state) => {
    const { issue } = await load(parseNumber(id));
    const open = issue.state === "OPEN";
    if (state === "done") {
      if (open) await run(["issue", "close", String(issue.number)]);
      return get(idOf(issue.number));
    }
    if (!ROLES2.includes(state)) throw new TrackerError("INVALID", `Unknown state: ${String(state)}`);
    if (!open) await run(["issue", "reopen", String(issue.number)]);
    const label = labels[state];
    const remove = issue.labels.filter((l) => stateLabels.includes(l) && l !== label);
    await swapLabels(issue.number, issue.labels.includes(label) ? null : label, remove);
    return get(idOf(issue.number));
  };
  const subtree = async (n, rel) => {
    const out = [];
    const seen = /* @__PURE__ */ new Set([n]);
    const walk = async (at, r) => {
      if (r.childCount > r.children.length) {
        throw new TrackerError("INVALID", `${idOf(at)} has ${r.childCount} sub-issues, more than can be deleted at once; delete some of them first`);
      }
      const fresh = r.children.map((c) => c.number).filter((c) => !seen.has(c));
      for (const c of fresh) seen.add(c);
      const found = fresh.length === 0 ? /* @__PURE__ */ new Map() : await graph(fresh, false);
      for (const c of fresh) await walk(c, relationsOf(found.get(c) ?? null));
      out.push(at);
    };
    await walk(n, rel);
    return out;
  };
  return {
    preflight: ready,
    setupLabels: () => ensureLabels([...stateLabels, ...CATEGORIES]),
    async list() {
      const r = await run(["issue", "list", "--state", "all", "--limit", "500", "--json", LIST_FIELDS]);
      const raw = parseJson(
        r.stdout,
        "issue list"
      );
      const now = Date.now();
      const issues = raw.map((i) => ({
        ...i,
        body: i.body ?? "",
        labels: (i.labels ?? []).map((l) => l.name),
        assignees: (i.assignees ?? []).map((a) => a.login)
      })).filter((i) => i.state === "OPEN" || i.closedAt !== null && now - Date.parse(i.closedAt) <= DONE_WINDOW_MS).sort((a, b) => a.number - b.number);
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
      const state = input.state === void 0 || input.state === "done" ? null : labels[input.state];
      if (input.state !== void 0 && input.state !== "done" && state === void 0) {
        throw new TrackerError("INVALID", `Unknown state: ${String(input.state)}`);
      }
      const add = [state, type].filter((l) => l !== null);
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
    async edit(id, changes) {
      const n = parseNumber(id);
      if (changes.title !== void 0 && (typeof changes.title !== "string" || changes.title.trim() === "")) {
        throw new TrackerError("INVALID", "Title is required");
      }
      if (changes.body !== void 0 && typeof changes.body !== "string") throw new TrackerError("INVALID", "The description must be a string");
      const args = ["issue", "edit", String(n)];
      if (changes.title !== void 0) args.push("--title", changes.title.trim());
      if (changes.body !== void 0) args.push("--body", changes.body);
      if (args.length > 3) await run(args);
      return get(idOf(n));
    },
    async claim(id) {
      const { task, issue } = await load(parseNumber(id));
      if (task.kind === "parent") throw new TrackerError("INVALID", `Only a sub-task can be claimed, not a parent issue: ${task.id}`);
      if (task.state !== "ready-for-agent") throw new TrackerError("INVALID", `Only a ready-for-agent task can be claimed: ${task.id}`);
      await run(["issue", "edit", String(issue.number), "--add-assignee", "@me"]);
      return get(task.id);
    },
    async setParent(id, parentId) {
      const n = parseNumber(id);
      const p = parseNumber(parentId);
      if (n === p) throw new TrackerError("INVALID", `A task cannot be its own parent: ${idOf(n)}`);
      const found = await graph([n, p], false);
      for (const k of [n, p]) if ((found.get(k) ?? null) === null) throw new TrackerError("NOT_FOUND", `Issue not found: #${k}`);
      if (relationsOf(found.get(n)).parent === p) throw new TrackerError("INVALID", `${idOf(n)} is already a sub-issue of ${idOf(p)}`);
      const seen = /* @__PURE__ */ new Set([p]);
      for (let up = relationsOf(found.get(p)).parent; up !== null && !seen.has(up); ) {
        if (up === n) throw new TrackerError("INVALID", `${idOf(p)} is a descendant of ${idOf(n)}; linking would make a cycle`);
        seen.add(up);
        up = relationsOf((await graph([up], false)).get(up) ?? null).parent;
      }
      await run(["issue", "edit", String(n), "--parent", String(p)]);
      return get(idOf(n));
    },
    async remove(id, opts) {
      const { issue, rel } = await load(parseNumber(id));
      const numbers = opts.withChildren ? await subtree(issue.number, rel) : [issue.number];
      const deleted = [];
      for (const n of numbers) {
        const args = ["issue", "delete", String(n), "--yes"];
        const r = await run(args, true);
        if (r.code !== 0) {
          const detail = (r.stderr || r.stdout).trim();
          const done = deleted.length > 0 ? ` (already deleted: ${deleted.join(", ")})` : "";
          if (/permission|must have admin|FORBIDDEN/i.test(detail)) {
            throw new TrackerError("FAILED", `Only repository admins can delete GitHub issues; close it instead${done}. gh: ${detail}`);
          }
          throw new TrackerError("FAILED", `${failed(args, r).message}${done}`);
        }
        deleted.push(idOf(n));
      }
      return deleted;
    },
    async removeParent(id) {
      const n = parseNumber(id);
      const found = (await graph([n], false)).get(n) ?? null;
      if (found === null) throw new TrackerError("NOT_FOUND", `Issue not found: ${idOf(n)}`);
      if (relationsOf(found).parent === null) throw new TrackerError("INVALID", `${idOf(n)} has no parent issue to remove`);
      await run(["issue", "edit", String(n), "--remove-parent"]);
      return get(idOf(n));
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
import { mkdir as mkdir2, readdir, readFile as readFile2, rmdir, stat, unlink, writeFile as writeFile2 } from "node:fs/promises";
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
var isClaimed = (word) => (word ?? "").trim().toLowerCase() === "claimed";
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
    claimed: isClaimed(fields.Status),
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
var blockersValue = (numbers) => numbers.length > 0 ? numbers.map(pad).join(", ") : NONE_BLOCKERS;
var renumberIssue = (text, n, title) => {
  const heading = `# ${pad(n)}: ${title.trim()}`;
  const lines = splitLines(text);
  const i = headingIndex(lines);
  if (i < 0) return text.trim() === "" ? `${heading}
` : `${heading}${text.includes("\r\n") ? "\r\n\r\n" : "\n\n"}${text}`;
  lines[i] = heading + (lines[i].endsWith("\r") ? "\r" : "");
  return lines.join("\n");
};
var setTitle = (text, title, keepNumber) => {
  const lines = splitLines(text);
  const i = headingIndex(lines);
  if (i < 0) return text.trim() === "" ? `# ${title.trim()}
` : `# ${title.trim()}${text.includes("\r\n") ? "\r\n\r\n" : "\n\n"}${text}`;
  const prefix = keepNumber ? /^# (\d+:\s*)/.exec(content(lines[i]))?.[1] ?? "" : "";
  lines[i] = `# ${prefix}${title.trim()}` + (lines[i].endsWith("\r") ? "\r" : "");
  return lines.join("\n");
};
var specFromIssue = (text, title) => {
  const lines = splitLines(text);
  const i = headingIndex(lines);
  const heading = `# ${title.trim()}`;
  if (i < 0) lines.unshift(heading, "");
  else lines[i] = heading + (lines[i].endsWith("\r") ? "\r" : "");
  const blocked = headerFields(lines).find((f) => f.field === "Blocked by");
  if (blocked !== void 0) {
    const blank = (k) => k >= 0 && k < lines.length && content(lines[k]).trim() === "";
    const from = blocked.index;
    lines.splice(from, blank(from + 1) && blank(from - 1) ? 2 : 1);
  }
  return lines.join("\n");
};
var NOT_PARAGRAPH = /^\s*(?:[-+]\s|\*\s|\d+[.)]\s|#|```|~~~|>|\|)/;
var splitLead = (body) => {
  if (body === "" || NOT_PARAGRAPH.test(body)) return { lead: "", rest: body };
  const cut = body.search(/\n[ \t]*\n/);
  const lead = cut < 0 ? body : body.slice(0, cut);
  if (lead.split("\n").some((l) => matchField(l) !== null || /^\s{0,3}(#|```|~~~)/.test(l))) return { lead: "", rest: body };
  return { lead, rest: cut < 0 ? "" : body.slice(cut).replace(/^\s*\n/, "") };
};
var normalizeBody = (body) => body.replace(/\r\n/g, "\n").replace(/^\s*\n/, "").replace(/\s+$/, "");
var renderIssue = (n, input) => {
  const blockers = (input.blockedBy ?? []).map(blockerRef);
  const { lead, rest } = splitLead(normalizeBody(input.body ?? ""));
  const parts = [`# ${pad(n)}: ${input.title.trim()}`];
  if (lead !== "") parts.push(lead);
  parts.push(`**Blocked by:** ${blockers.length > 0 ? blockers.join(", ") : NONE_BLOCKERS}`);
  if (input.type !== void 0 && input.type.trim() !== "") parts.push(`**Type:** ${input.type.trim()}`);
  parts.push(`**Status:** ${fromState(input.state ?? "needs-triage")}`);
  if (rest !== "") parts.push(rest);
  return parts.join("\n\n") + "\n";
};
var TAIL = /^## (?:Comments|Answer)\s*$/i;
var splitParts = (text) => {
  const lines = splitLines(text).map(content);
  const tailAt = plainLines(lines, false).find(([, c]) => TAIL.test(c))?.[0] ?? lines.length;
  const head = headingIndex(lines);
  const fieldAt = new Set(headerFields(lines).filter((f) => f.index < tailAt).map((f) => f.index));
  const kept = [];
  let removed = false;
  for (let i = 0; i < tailAt; i++) {
    if (i === head || fieldAt.has(i)) {
      removed = true;
      continue;
    }
    const blank = lines[i].trim() === "";
    if (blank && (kept.length === 0 || removed && kept[kept.length - 1].trim() === "")) continue;
    kept.push(lines[i]);
    if (!blank) removed = false;
  }
  return {
    heading: head >= 0 && head < tailAt ? lines[head] : null,
    fields: [...fieldAt].sort((a, b) => a - b).map((i) => lines[i]),
    description: kept.join("\n").replace(/\s+$/, ""),
    tail: tailAt < lines.length ? lines.slice(tailAt).join("\n").replace(/\s+$/, "") : null
  };
};
var withDescription = (text, description) => {
  const p = splitParts(text);
  const { lead, rest } = splitLead(normalizeBody(description));
  const parts = [];
  if (p.heading !== null) parts.push(p.heading);
  if (lead !== "") parts.push(lead);
  if (p.fields.length > 0) parts.push(p.fields.join(fieldsTight(text) ? "\n" : "\n\n"));
  if (rest !== "") parts.push(rest);
  if (p.tail !== null) parts.push(p.tail);
  const out = parts.join("\n\n") + "\n";
  return text.includes("\r\n") ? out.replace(/\n/g, "\r\n") : out;
};
var fieldsTight = (text) => {
  const f = headerFields(splitLines(text));
  return f.length > 1 && f.every((x, i) => i === 0 || x.index === f[i - 1].index + 1);
};
var foldText = (text) => text.replace(/[łŁ]/g, "l").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
var slugify = (title) => {
  const slug = foldText(title).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
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
        updatedAt: s.mtimeMs,
        claimed: false,
        source: "local"
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
      updatedAt: file.mtime,
      claimed: false,
      source: "local"
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
      updatedAt: data.mtime,
      claimed: p.claimed,
      source: "local"
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
  const edit = async (id, changes) => {
    if (changes.title !== void 0 && (typeof changes.title !== "string" || changes.title.trim() === "")) {
      throw new TrackerError("INVALID", "Title is required");
    }
    const task = await get(id);
    const ref = parseId(task.id);
    let text = task.body === "" && ref.kind === "parent" ? `# ${task.title}
` : task.body;
    if (changes.title !== void 0) text = setTitle(text, changes.title, ref.kind === "ticket");
    if (changes.body !== void 0) {
      if (typeof changes.body !== "string") throw new TrackerError("INVALID", "The description must be a string");
      text = withDescription(text, changes.body);
    }
    if (text !== task.body) await writeFile2(abs(task.id), text);
    return get(task.id);
  };
  const slugOf = (title) => issueFileName(0, title).slice(3, -3);
  const newFeature = async (title) => {
    const slug = slugOf(title);
    await mkdir2(join2(root, SCRATCH), { recursive: true });
    for (let i = 1; ; i++) {
      const feature = i === 1 ? slug : `${slug}-${i}`;
      try {
        await mkdir2(featureDir(feature));
        return feature;
      } catch (e) {
        if (e.code === "EEXIST") continue;
        throw e;
      }
    }
  };
  const createParent = async (input) => {
    const feature = await newFeature(input.title);
    const parts = [`# ${input.title.trim()}`];
    const fields = [];
    if (input.type !== void 0 && input.type.trim() !== "") fields.push(`**Type:** ${input.type.trim()}`);
    if (input.state !== void 0) fields.push(`**Status:** ${statusWord(input.state)}`);
    if (fields.length > 0) parts.push(fields.join("\n"));
    const body = (input.body ?? "").replace(/\r\n/g, "\n").trim();
    if (body !== "") parts.push(body);
    await writeFile2(abs(specId(feature)), parts.join("\n\n") + "\n", { flag: "wx" });
    return get(specId(feature));
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
  const writeNextTicket = async (feature, title, text) => {
    await mkdir2(issuesDir(feature), { recursive: true });
    for (; ; ) {
      const files = await issueFiles(issuesDir(feature));
      const n = files.map(fileNumber).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0) + 1;
      const file = issueFileName(n, title);
      try {
        await writeFile2(join2(issuesDir(feature), file), renumberIssue(text, n, title), { flag: "wx" });
      } catch (e) {
        if (e.code === "EEXIST") continue;
        throw e;
      }
      return ticketId(feature, file);
    }
  };
  const dropBlocker = async (feature, n) => {
    for (const file of await issueFiles(issuesDir(feature))) {
      const data = await readText(join2(issuesDir(feature), file));
      if (data === null) continue;
      const numbers = parseIssue(data.text, file).blockedBy;
      if (!numbers.includes(n)) continue;
      const rest = numbers.filter((b) => b !== n);
      await writeFile2(join2(issuesDir(feature), file), patchLine(data.text, "Blocked by", blockersValue(rest)));
    }
  };
  const extraFiles = async (feature) => {
    const list = async (path) => {
      try {
        return await readdir(path, { withFileTypes: true });
      } catch (e) {
        if (isNotFound2(e)) return [];
        throw e;
      }
    };
    const out = [];
    for (const d of await list(featureDir(feature))) {
      if (d.name === "spec.md" && d.isFile()) continue;
      if (d.name === "issues" && d.isDirectory()) {
        for (const i of await list(issuesDir(feature))) out.push(`issues/${i.name}${i.isDirectory() ? "/" : ""}`);
        continue;
      }
      out.push(`${d.name}${d.isDirectory() ? "/" : ""}`);
    }
    return out.sort();
  };
  const removeIfEmpty = async (path) => {
    try {
      await rmdir(path);
    } catch (e) {
      const c = e.code;
      if (c !== "ENOENT" && c !== "ENOTEMPTY" && c !== "EEXIST") throw e;
    }
  };
  const unlinkIfThere = (path) => unlink(path).catch((e) => {
    if (!isNotFound2(e)) throw e;
  });
  const setParent = async (id, parentId) => {
    const ref = parseId(id);
    const to = parseId(parentId);
    if (to.kind !== "parent") throw new TrackerError("INVALID", `A parent must be a feature (spec.md), not a ticket: ${parentId}`);
    if (ref.kind === "parent" && ref.feature === to.feature) throw new TrackerError("INVALID", `A task cannot be its own parent: ${id}`);
    const task = await get(id);
    if (!await featureExists(to.feature)) throw new TrackerError("NOT_FOUND", `Parent not found: ${parentId}`);
    if (ref.kind === "ticket" && ref.feature === to.feature) throw new TrackerError("INVALID", `${id} is already a ticket of ${parentId}`);
    if (ref.kind === "parent" && (await issueFiles(issuesDir(ref.feature))).length > 0) {
      throw new TrackerError("INVALID", `${id} has tickets of its own; a feature with tickets cannot become a ticket (two levels only)`);
    }
    if (ref.kind === "parent") {
      const extra = await extraFiles(ref.feature);
      if (extra.length > 0) {
        throw new TrackerError("INVALID", `${id} cannot become a ticket: its folder also holds ${extra.join(", ")}; move or remove those first`);
      }
    }
    const text = task.body === "" ? `# ${task.title}
` : task.body;
    const newId = await writeNextTicket(to.feature, task.title, patchLine(text, "Blocked by", blockersValue([])));
    await unlinkIfThere(abs(task.id));
    if (ref.kind === "ticket") {
      await dropBlocker(ref.feature, fileNumber(ref.file));
    } else {
      await removeIfEmpty(issuesDir(ref.feature));
      await removeIfEmpty(featureDir(ref.feature));
    }
    return get(newId);
  };
  const remove = async (id, opts) => {
    const task = await get(id);
    const ref = parseId(task.id);
    if (ref.kind === "ticket") {
      await unlinkIfThere(abs(task.id));
      await dropBlocker(ref.feature, fileNumber(ref.file));
      await removeIfEmpty(issuesDir(ref.feature));
      return [task.id];
    }
    const tickets = await issueFiles(issuesDir(ref.feature));
    if (tickets.length > 0 && !opts.withChildren) {
      throw new TrackerError("INVALID", `${id} has ${tickets.length} sub-task${tickets.length === 1 ? "" : "s"}; delete them with it (withChildren) or move them first`);
    }
    const ticketEntries = new Set(tickets.map((f) => `issues/${f}`));
    const extra = (await extraFiles(ref.feature)).filter((f) => !ticketEntries.has(f));
    if (extra.length > 0) {
      throw new TrackerError("INVALID", `${id} cannot be deleted: its folder also holds ${extra.join(", ")}; move or remove those first`);
    }
    const deleted = [];
    for (const file of tickets) {
      await unlinkIfThere(join2(issuesDir(ref.feature), file));
      deleted.push(ticketId(ref.feature, file));
    }
    await unlinkIfThere(abs(task.id));
    await removeIfEmpty(issuesDir(ref.feature));
    await removeIfEmpty(featureDir(ref.feature));
    return [...deleted, task.id];
  };
  const removeParent = async (id) => {
    const ref = parseId(id);
    if (ref.kind === "parent") throw new TrackerError("INVALID", `${id} is a feature; it has no parent to remove`);
    const task = await get(id);
    let text = specFromIssue(task.body, task.title);
    if (task.claimed) text = patchLine(text, "Status", "ready-for-agent");
    const feature = await newFeature(task.title);
    await writeFile2(abs(specId(feature)), text, { flag: "wx" });
    await unlinkIfThere(abs(task.id));
    await dropBlocker(ref.feature, fileNumber(ref.file));
    await removeIfEmpty(issuesDir(ref.feature));
    return get(specId(feature));
  };
  return {
    remove,
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
    edit,
    setParent,
    removeParent,
    setType(id, type) {
      return patch(id, "Type", type.trim());
    },
    async claim(id) {
      if (parseId(id).kind !== "ticket") throw new TrackerError("INVALID", `Only a ticket can be claimed, not a feature: ${id}`);
      if ((await get(id)).state !== "ready-for-agent") throw new TrackerError("INVALID", `Only a ready-for-agent task can be claimed: ${id}`);
      return patch(id, "Status", "claimed");
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

// src/core/sources.ts
var ALL = { create: true, subtasks: true, blockedBy: true, claim: true, delete: true };
var SOURCES = {
  local: { label: "Local", capabilities: ALL },
  github: { label: "GitHub", capabilities: ALL }
};
var sourceInfo = (id) => ({ id, ...SOURCES[id] });
var availabilityOf = (e) => {
  const message = e instanceof Error ? e.message : String(e);
  return { status: e instanceof TrackerError && e.code === "GH_AUTH" ? "needs-login" : "unavailable", message };
};
var sourceError = (source, e) => ({
  source,
  code: e instanceof TrackerError ? e.code : "FAILED",
  message: e instanceof Error ? e.message : String(e),
  availability: availabilityOf(e).status
});
var createLocalSource = (root) => ({
  ...createLocalTracker(root),
  ...sourceInfo("local"),
  owns: (id) => id.startsWith(".scratch/"),
  availability: async () => ({ status: "ok" })
});
var createGithubSource = (root, exec, labels) => {
  const tracker = createGithubTracker(root, exec, labels);
  return {
    ...tracker,
    ...sourceInfo("github"),
    // `42` is accepted as well as `#42`, as the GitHub tracker always did.
    owns: (id) => /^\s*#?\d+\s*$/.test(id),
    availability: async () => {
      try {
        await tracker.preflight();
        return { status: "ok" };
      } catch (e) {
        return availabilityOf(e);
      }
    }
  };
};
var createCombinedTracker = (primary, sources) => {
  const sourceOf2 = (id) => {
    const owner = sources.find((s) => s.owns(id));
    if (owner !== void 0) return owner;
    if (sources.length === 1) return sources[0];
    throw new TrackerError("NOT_FOUND", `No source of this project has a task "${id}" (sources: ${sources.map((s) => s.id).join(", ")})`);
  };
  const primarySource = sources.find((s) => s.id === primary) ?? sources[0];
  const listAll = async (opts = {}) => {
    const asked = opts.source === void 0 ? sources : sources.filter((s) => s.id === opts.source);
    if (asked.length === 0) {
      throw new TrackerError("INVALID", `Unknown source "${opts.source}": this project has ${sources.map((s) => s.id).join(", ")}`);
    }
    const results = await Promise.allSettled(asked.map((s) => s.list()));
    const failed = results.flatMap((r) => r.status === "rejected" ? [r.reason] : []);
    if (failed.length === asked.length) throw failed[0];
    const tasks = [];
    const errors = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") tasks.push(...r.value);
      else errors.push(sourceError(asked[i].id, r.reason));
    });
    return { tasks, errors };
  };
  return {
    primary: primarySource.id,
    sources,
    sourceOf: sourceOf2,
    listAll,
    list: async () => (await listAll()).tasks,
    get: async (id) => sourceOf2(id).get(id),
    create: async (input) => primarySource.create(input),
    setState: async (id, state) => sourceOf2(id).setState(id, state),
    setType: async (id, type) => sourceOf2(id).setType(id, type),
    edit: async (id, changes) => sourceOf2(id).edit(id, changes),
    claim: async (id) => sourceOf2(id).claim(id),
    setParent: async (id, parentId) => sourceOf2(id).setParent(id, parentId),
    removeParent: async (id) => sourceOf2(id).removeParent(id),
    close: async (id, opts) => sourceOf2(id).close(id, opts),
    remove: async (id, opts) => sourceOf2(id).remove(id, opts)
  };
};

// src/core/openTracker.ts
var openTracker = async (root, exec) => {
  const config = await readConfig(root);
  const sources = config.sources.map(
    (id) => id === "local" ? createLocalSource(root) : createGithubSource(root, exec, config.labels)
  );
  return createCombinedTracker(config.primary, sources);
};

// src/cli/main.ts
var USAGE = `Usage: task-board <command> [options]

Commands:
  list [--state <state>] [--ready] [--source <id>]
                                        tasks, one per line; with several sources each line
                                        names its source (--json always has "source")
  show <id>                             one task with its body
  create --title <t> [--type <x>] [--body-file <f>|-] [--parent <id>] [--state <state>]
         [--blocked-by <id>[,<id>...]]...   blockers: repeat the option or separate ids with commas
  state <id> <state>                    set the state ('done' closes)
  edit <id> [--title <t>] [--body-file <f>|-]
                                        change the title and/or the description (local: the
                                        heading number, Status/Type/Blocked by and ## Comments stay)
  claim <id>                            take a sub-task before working on it (orchestrator)
  parent <id> <parentId>                make an existing task a sub-task of another (prints its id,
                                        which changes in a local tracker: the file moves)
  next [--source <id>]                  first ready-for-agent ticket with no open blocker
  close <id> [--with-children]          close a task (and a feature's tickets)
  init <local|github>                   write docs/agents/issue-tracker.md (the primary source)
  init --add <id> | --remove <id> | --primary <id> [--force]
                                        add or remove a source, or make one primary; this
                                        rewrites docs/agents/issue-tracker.md as Settings does.
                                        Removing deletes nothing (its files or issues stay).
                                        --force: replace a primary template edited by hand

Sources: list and next read every source in docs/agents/issue-tracker.md (the primary one and
any under ## Additional sources); --source local|github reads only that one. Commands on an id
go to the source that owns it. A source that fails is reported on stderr; the others still list.

Options for every command:
  --dir <path>   project root (default: current directory)
  --json         machine-readable output

A value starting with '-' is written with '=': --title=-x

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
  "blocked-by": { type: "string", multiple: true },
  "with-children": { type: "boolean" },
  source: { type: "string" },
  add: { type: "string" },
  remove: { type: "string" },
  primary: { type: "string" },
  force: { type: "boolean" }
};
var COMMANDS = {
  list: { positionals: 0, options: ["state", "ready", "source"] },
  show: { positionals: 1, options: [] },
  create: { positionals: 0, options: ["title", "type", "body-file", "parent", "state", "blocked-by"] },
  state: { positionals: 2, options: [] },
  edit: { positionals: 1, options: ["title", "body-file"] },
  claim: { positionals: 1, options: [] },
  parent: { positionals: 2, options: [] },
  next: { positionals: 0, options: ["source"] },
  close: { positionals: 1, options: ["with-children"] },
  init: { positionals: 1, options: ["add", "remove", "primary", "force"] }
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
var line = (t, withSource = false) => `${t.id}  ${withSource ? `${t.source}  ` : ""}[${t.state}${t.claimed ? ", claimed" : ""}]  ${t.title}
`;
var sourcesLine = (config) => config.sources.map((id) => id === config.primary ? `${id} (primary)` : id).join(", ");
var sourcesAnswer = (config) => ({ tracker: config.tracker, primary: config.primary, sources: config.sources });
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
  if (command === "init") {
    const changes = ["add", "remove", "primary"].filter((k) => values[k] !== void 0);
    if (changes.length > 1) usage("init takes one of --add, --remove and --primary");
    if (values.force && values.primary === void 0) usage("--force applies to init --primary");
    for (const k of changes) {
      if (!SOURCE_IDS.includes(values[k])) usage(`Unknown source "${values[k]}": use ${SOURCE_IDS.join(" or ")}`);
    }
    if (changes.length === 1 && args.length !== 0) usage("init takes a tracker or a source option, not both");
    if (changes.length === 1) return { command, args, values };
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
  const bodyOf = async (file) => {
    if (file === "-") return readStdin(io.stdin);
    if (file === void 0) return void 0;
    try {
      return await readFile3(resolve(io.cwd, file), "utf8");
    } catch (e) {
      throw new TrackerError("INVALID", `Cannot read body file ${file}: ${e.message}`);
    }
  };
  const listed = async (tracker, source) => {
    const { tasks, errors } = await tracker.listAll(source === void 0 ? {} : { source });
    for (const e of errors) io.stderr(`task-board: source ${e.source}: ${e.code}: ${e.message}
`);
    return tasks;
  };
  try {
    switch (command) {
      case "list": {
        const state = values.state === void 0 ? void 0 : toState2(values.state, "state");
        const tracker = await openTracker(root, exec);
        const all = await listed(tracker, values.source);
        const ready = values.ready ? new Set(readyTickets(all).map((t) => t.id)) : null;
        const tasks = all.filter((t) => (state === void 0 || t.state === state) && (ready === null || ready.has(t.id)));
        const several = tracker.sources.length > 1;
        print(tasks, tasks.map((t) => line(t, several)).join(""));
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
        const blockedBy = (values["blocked-by"] ?? []).flatMap((v) => v.split(",")).map((v) => v.trim());
        if (blockedBy.some((id) => id === "")) usage("--blocked-by needs non-empty ids");
        const body = await bodyOf(values["body-file"]);
        const task = await (await openTracker(root, exec)).create({
          title: values.title,
          ...body === void 0 ? {} : { body },
          ...values.type === void 0 ? {} : { type: values.type },
          ...values.parent === void 0 ? {} : { parentId: values.parent },
          ...blockedBy.length === 0 ? {} : { blockedBy },
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
      case "edit": {
        if (values.title === void 0 && values["body-file"] === void 0) usage("edit needs --title, --body-file or both");
        const body = await bodyOf(values["body-file"]);
        const task = await (await openTracker(root, exec)).edit(args[0], {
          ...values.title === void 0 ? {} : { title: values.title },
          ...body === void 0 ? {} : { body }
        });
        print(task, line(task));
        return 0;
      }
      case "claim": {
        const task = await (await openTracker(root, exec)).claim(args[0]);
        print(task, line(task));
        return 0;
      }
      case "parent": {
        const task = await (await openTracker(root, exec)).setParent(args[0], args[1]);
        print(task, line(task));
        return 0;
      }
      case "next": {
        const tracker = await openTracker(root, exec);
        const [task] = readyTickets(await listed(tracker, values.source));
        if (task === void 0) {
          io.stderr("task-board: no ready ticket (ready-for-agent with no open blocker)\n");
          return 3;
        }
        print(task, `${task.id}  ${tracker.sources.length > 1 ? `${task.source}  ` : ""}${task.title}
`);
        return 0;
      }
      case "close": {
        const closed = await (await openTracker(root, exec)).close(args[0], { withChildren: values["with-children"] === true });
        print(closed, closed.map((t) => line(t)).join(""));
        return 0;
      }
      case "init": {
        const change = values.add !== void 0 ? { add: values.add } : values.remove !== void 0 ? { remove: values.remove } : values.primary !== void 0 ? { primary: values.primary } : null;
        if (change !== null) {
          const config2 = await changeSources(root, change, { force: values.force === true });
          print(sourcesAnswer(config2), `Sources: ${sourcesLine(config2)} (docs/agents/issue-tracker.md)
`);
          return 0;
        }
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
