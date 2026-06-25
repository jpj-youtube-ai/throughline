# Completion-aware task generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the generator from emitting tasks for work already done, by refreshing the clone before generation and feeding the model the project's existing tasks (with status) and recent commits.

**Architecture:** Three additive, read/context-only changes (no schema, no events): (1) two new read helpers — `recentGitLog` (git subjects) and `projectTaskSummary` (board tasks + status); (2) a new `## ALREADY IN THIS PROJECT` prompt section + a system-prompt no-duplication rule, threaded through both `orchestrate.ts` generators and folded into the token budget; (3) a best-effort `refreshProjectClone` run before generation in the worker tick and the `/spec` action.

**Tech Stack:** TypeScript, Next.js (App Router), Postgres + Drizzle, Anthropic SDK, `node:test` + PGlite, `git` via `node:child_process`.

**Design doc:** `docs/superpowers/specs/2026-06-25-completion-aware-generation-design.md`

## Global Constraints

- **Requirement linkage:** every commit/PR is for **REQ-008** (task generation). No new REQ.
- **Read / context-only.** No new schema, table, or event. `github_status` is only **read** (to label tasks); it stays webhook-only for writes.
- **Best-effort externals.** `refreshProjectClone` and `recentGitLog` must never abort generation — the worker step and the `/spec` action wrap the refresh in try/catch and proceed; `recentGitLog` returns `[]` on any error.
- **Token budget.** The generation context cap is `MAX_CONTEXT_TOKENS = 40000` (`orchestrate.ts`). The two new blocks MUST be added to the `fixed` estimate so `buildSlice`'s `budgetTokens` shrinks to fit — no overflow.
- **No `any` in domain code.**
- **Bounds:** `projectTaskSummary` caps at the **200 newest** tasks (by `created_at`); `recentGitLog` at **80** commits.
- **Status label precedence:** `closed` (if `github_status='closed'`) > `claimed` (if `claim_state='claimed'`) > `open`.
- **Conventions:** branch `task-064-completion-aware-generation`; PR title + squash message start with `[TASK-064]`. (Confirm `TASK-064` is the next free id before opening the PR.)
- **Every commit message ends with the trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **New `*.test.ts` files MUST be registered in the enumerated `test` script in `package.json`** (not globbed — an unregistered test is silently skipped).

## Setup (before Task 1)

```bash
git switch -c task-064-completion-aware-generation
```

---

## File Structure

- `src/github/clone.ts` — add `recentGitLog` (modify).
- `src/github/clone.test.ts` — tests for `recentGitLog` (create + register).
- `src/generation/context.ts` — `projectTaskSummary` (create).
- `src/generation/context.test.ts` — tests for `projectTaskSummary` (create + register).
- `src/prompt.ts` — `UserMessageParts` fields, the new section, the system-prompt rule (modify).
- `src/prompt.test.ts` — tests for `buildUserMessage` + `SYSTEM_PROMPT` (create + register).
- `src/generation/orchestrate.ts` — assemble the blocks + budget in both generators (modify).
- `src/generation/orchestrate-requirement.test.ts` — add a completion-context test (modify; already registered).
- `src/project/refresh.ts` — `refreshProjectClone` (create).
- `src/worker/index.ts` — `WorkerDeps.refreshClone` + tick step (modify).
- `src/worker/worker.test.ts` — refresh test + stub existing deps (modify; already registered).
- `src/app/(app)/spec/[key]/actions.ts` — best-effort refresh before generation (modify).
- `package.json` — register the 3 new test files (modify).

---

## Task 1: `recentGitLog` helper

**Files:**
- Modify: `src/github/clone.ts` (add export; `spawn` is already imported)
- Create: `src/github/clone.test.ts`
- Modify: `package.json` (register the test)

**Interfaces:**
- Produces: `recentGitLog(repoPath: string, opts?: { limit?: number }): Promise<string[]>` — commit subjects of the checked-out branch, newest-first, capped at `limit` (default 80). Best-effort: `[]` on any error. Consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `src/github/clone.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { recentGitLog } from "./clone";

function git(dir: string, args: string[]): void {
  execFileSync("git", ["-C", dir, ...args], { stdio: ["ignore", "ignore", "ignore"] });
}

test("recentGitLog returns commit subjects newest-first, respecting limit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tl-gitlog-"));
  try {
    execFileSync("git", ["init", "-q", dir], { stdio: ["ignore", "ignore", "ignore"] });
    git(dir, ["config", "user.email", "t@e"]);
    git(dir, ["config", "user.name", "t"]);
    for (const s of ["[TASK-001] first", "[TASK-002] second", "[TASK-003] third"]) {
      git(dir, ["commit", "--allow-empty", "-q", "-m", s]);
    }
    assert.deepEqual(await recentGitLog(dir), ["[TASK-003] third", "[TASK-002] second", "[TASK-001] first"]);
    assert.deepEqual(await recentGitLog(dir, { limit: 1 }), ["[TASK-003] third"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("recentGitLog returns [] for a non-git directory (best-effort, no throw)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tl-nogit-"));
  try {
    assert.deepEqual(await recentGitLog(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Register the test in `package.json`**

Append ` src/github/clone.test.ts` to the end of the `"test"` script list.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx tsx --test src/github/clone.test.ts`
Expected: FAIL — `recentGitLog` is not exported from `./clone`.

- [ ] **Step 4: Implement `recentGitLog`**

In `src/github/clone.ts`, append (the file already imports `spawn` from `node:child_process`):

```ts
/**
 * Recent commit subjects of the clone's checked-out branch (REQ-008 generation
 * context) — newest-first, capped at `limit` (default 80). Best-effort: returns
 * [] on any error (non-repo, git failure) so it never blocks generation.
 */
export async function recentGitLog(repoPath: string, opts: { limit?: number } = {}): Promise<string[]> {
  const limit = opts.limit ?? 80;
  return new Promise((resolve) => {
    const p = spawn("git", ["-C", repoPath, "log", "--no-merges", "--format=%s", "-n", String(limit)], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    p.stdout.on("data", (d) => {
      out += d.toString();
    });
    p.on("error", () => resolve([]));
    p.on("close", (code) => {
      if (code !== 0) return resolve([]);
      resolve(out.split("\n").map((s) => s.trim()).filter(Boolean));
    });
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsx --test src/github/clone.test.ts`
Expected: PASS (both).

- [ ] **Step 6: Commit**

```bash
git add src/github/clone.ts src/github/clone.test.ts package.json
git commit -m "$(cat <<'EOF'
[TASK-064] recentGitLog: recent commit subjects for generation context (REQ-008)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `projectTaskSummary` helper

**Files:**
- Create: `src/generation/context.ts`
- Create: `src/generation/context.test.ts`
- Modify: `package.json` (register the test)

**Interfaces:**
- Produces: `projectTaskSummary(db: Db, projectId: string, opts?: { limit?: number }): Promise<string[]>` — one line per task, newest-first (by `created_at`), `TASK-NNN [open|claimed|closed] — <title> → REQ-NNN`, capped at `limit` (default 200), project-scoped. Consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `src/generation/context.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { project, requirements, tasks } from "../db/schema";
import { projectTaskSummary } from "./context";

async function seed(db: Db, repo: string, inst: number): Promise<{ pid: string; reqId: string }> {
  const [p] = await db.insert(project).values({ repoFullName: repo, defaultBranch: "main", installationId: inst, localClonePath: "/x" }).returning({ id: project.id });
  const [r] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: p.id }).returning({ id: requirements.id });
  return { pid: p.id, reqId: r.id };
}

test("projectTaskSummary lists tasks newest-first with status-label precedence", async () => {
  const { db, close } = await createTestDb();
  try {
    const { pid, reqId } = await seed(db, "a/b", 1);
    const base = { body: "b", requirementId: reqId, effort: 1, risk: "low" as const, confidence: 50, projectId: pid };
    await db.insert(tasks).values({ ...base, key: "TASK-001", title: "Open one", createdAt: new Date("2026-01-01T00:00:00Z") });
    await db.insert(tasks).values({ ...base, key: "TASK-002", title: "Claimed one", claimState: "claimed", createdAt: new Date("2026-01-02T00:00:00Z") });
    await db.insert(tasks).values({ ...base, key: "TASK-003", title: "Done one", githubStatus: "closed", claimState: "claimed", createdAt: new Date("2026-01-03T00:00:00Z") });

    const lines = await projectTaskSummary(db, pid);
    assert.deepEqual(lines, [
      "TASK-003 [closed] — Done one → REQ-001", // closed wins over claimed
      "TASK-002 [claimed] — Claimed one → REQ-001",
      "TASK-001 [open] — Open one → REQ-001",
    ]);
  } finally {
    await close();
  }
});

test("projectTaskSummary is project-scoped and respects the limit", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seed(db, "a/alpha", 1);
    const b = await seed(db, "a/beta", 2);
    await db.insert(tasks).values({ key: "TASK-001", title: "Alpha", body: "b", requirementId: a.reqId, effort: 1, risk: "low", confidence: 50, projectId: a.pid });
    await db.insert(tasks).values({ key: "TASK-001", title: "Beta1", body: "b", requirementId: b.reqId, effort: 1, risk: "low", confidence: 50, projectId: b.pid });
    await db.insert(tasks).values({ key: "TASK-002", title: "Beta2", body: "b", requirementId: b.reqId, effort: 1, risk: "low", confidence: 50, projectId: b.pid });

    const bLines = await projectTaskSummary(db, b.pid);
    assert.equal(bLines.length, 2, "only project B's tasks");
    assert.ok(bLines.every((l) => l.includes("Beta")), "no project A leakage");
    assert.equal((await projectTaskSummary(db, b.pid, { limit: 1 })).length, 1);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Register the test in `package.json`**

Append ` src/generation/context.test.ts` to the `"test"` script list.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx tsx --test src/generation/context.test.ts`
Expected: FAIL — `projectTaskSummary` is not exported from `./context` (module missing).

- [ ] **Step 4: Implement `projectTaskSummary`**

Create `src/generation/context.ts`:

```ts
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { tasks, requirements } from "../db/schema";

/**
 * A compact, newest-first summary of the project's tasks for the generation
 * context (REQ-008) — `TASK-NNN [open|claimed|closed] — title → REQ-NNN`. Read-only;
 * github_status is only read to label, never written. Capped at `limit` (default 200).
 */
export async function projectTaskSummary(
  db: Db,
  projectId: string,
  opts: { limit?: number } = {},
): Promise<string[]> {
  const limit = opts.limit ?? 200;
  const rows = await db
    .select({
      key: tasks.key,
      title: tasks.title,
      reqKey: requirements.key,
      githubStatus: tasks.githubStatus,
      claimState: tasks.claimState,
    })
    .from(tasks)
    .innerJoin(requirements, eq(tasks.requirementId, requirements.id))
    .where(eq(tasks.projectId, projectId))
    .orderBy(desc(tasks.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const status = r.githubStatus === "closed" ? "closed" : r.claimState === "claimed" ? "claimed" : "open";
    return `${r.key} [${status}] — ${r.title} → ${r.reqKey}`;
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsx --test src/generation/context.test.ts`
Expected: PASS (both).

- [ ] **Step 6: Commit**

```bash
git add src/generation/context.ts src/generation/context.test.ts package.json
git commit -m "$(cat <<'EOF'
[TASK-064] projectTaskSummary: existing tasks + status for generation context (REQ-008)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Prompt — completion section + no-duplication rule

**Files:**
- Modify: `src/prompt.ts` (`UserMessageParts`, `buildUserMessage`, `SYSTEM_PROMPT`)
- Create: `src/prompt.test.ts`
- Modify: `package.json` (register the test)

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `UserMessageParts` gains optional `taskSummary?: string[]` and `recentCommits?: string[]`; `buildUserMessage` renders a `## ALREADY IN THIS PROJECT` section (greenfield note when both empty); `SYSTEM_PROMPT` contains the no-duplication rule. Consumed by Task 4. (Optional + defaulted to `[]` so existing callers keep compiling.)

- [ ] **Step 1: Write the failing tests**

Create `src/prompt.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildUserMessage, SYSTEM_PROMPT, type UserMessageParts } from "./prompt";
import type { RepoSlice } from "./repoSlice";

const slice: RepoSlice = { repoLabel: "acme/repo", nearEmpty: false, fileCount: 0, tree: "(empty)", treeTruncated: false, files: [], omitted: [] };
const base: UserMessageParts = {
  conventions: null,
  existingList: "",
  nextKey: "REQ-001",
  specText: "spec",
  idea: { title: "Idea", why: "why", feasibility: null, viability: null },
  slice,
};

test("buildUserMessage renders the ALREADY IN THIS PROJECT section with tasks + commits", () => {
  const msg = buildUserMessage({
    ...base,
    taskSummary: ["TASK-001 [closed] — Event log → REQ-014"],
    recentCommits: ["[TASK-001] event-log-table"],
  });
  assert.ok(msg.includes("## ALREADY IN THIS PROJECT"));
  assert.ok(msg.includes("TASK-001 [closed] — Event log → REQ-014"));
  assert.ok(msg.includes("[TASK-001] event-log-table"));
});

test("buildUserMessage shows a greenfield note when there is nothing built", () => {
  const msg = buildUserMessage({ ...base, taskSummary: [], recentCommits: [] });
  assert.ok(msg.includes("## ALREADY IN THIS PROJECT"));
  assert.ok(/nothing built yet/i.test(msg));
});

test("SYSTEM_PROMPT carries the no-duplication rule", () => {
  assert.ok(/do not duplicate completed or in-flight work/i.test(SYSTEM_PROMPT));
});
```

- [ ] **Step 2: Register the test in `package.json`**

Append ` src/prompt.test.ts` to the `"test"` script list.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx tsx --test src/prompt.test.ts`
Expected: FAIL — `taskSummary`/`recentCommits` aren't on `UserMessageParts`, the section isn't rendered, and the rule isn't in `SYSTEM_PROMPT`.

- [ ] **Step 4: Add the no-duplication rule to `SYSTEM_PROMPT`**

In `src/prompt.ts`, inside the `Rules:` list of `SYSTEM_PROMPT`, immediately after the `- Prerequisites & scope` bullet, add:

```
- Do not duplicate completed or in-flight work. The "## ALREADY IN THIS PROJECT" section lists tasks already created for this project (each tagged open | claimed | closed) and recent commits that landed on the default branch. Never emit a task that re-implements something already listed there — reuse it and reference it in pointers instead. Emit only tasks that add what is genuinely still missing for the idea.
```

- [ ] **Step 5: Add the section to `UserMessageParts` + `buildUserMessage`**

In `src/prompt.ts`, add the two optional fields to `UserMessageParts`:

```ts
export interface UserMessageParts {
  conventions: string | null;
  existingList: string;
  nextKey: string;
  specText: string;
  idea: Idea;
  slice: RepoSlice;
  taskSummary?: string[];
  recentCommits?: string[];
}
```

Add this helper above `buildUserMessage`:

```ts
function alreadyBuiltBlock(taskSummary: string[], recentCommits: string[]): string {
  if (taskSummary.length === 0 && recentCommits.length === 0) {
    return "## ALREADY IN THIS PROJECT\n(Nothing built yet — greenfield.)";
  }
  const tasksPart =
    taskSummary.length > 0
      ? `Existing tasks (newest first) — already created; do NOT re-create these:\n${taskSummary.join("\n")}`
      : "Existing tasks: (none yet)";
  const commitsPart =
    recentCommits.length > 0 ? `\n\nRecent commits on the default branch:\n${recentCommits.join("\n")}` : "";
  return `## ALREADY IN THIS PROJECT\n${tasksPart}${commitsPart}`;
}
```

In `buildUserMessage`, insert the section between the spec block and `## APPROVED IDEA`. The return becomes:

```ts
export function buildUserMessage(p: UserMessageParts): string {
  const conventions = p.conventions ?? "(none provided)";
  return `## PROJECT CONVENTIONS (CLAUDE.md)
${conventions}

## CURRENT SPEC — existing requirements
Existing requirement keys you may link to:
${p.existingList || "(none found)"}

Next available requirement number for NEW requirements: ${p.nextKey} (use ${p.nextKey} and up, in order).

Full spec for context:
${p.specText}

${alreadyBuiltBlock(p.taskSummary ?? [], p.recentCommits ?? [])}

## APPROVED IDEA
${ideaBlock(p.idea)}

## TARGET REPO SLICE
${sliceBlock(p.slice)}

---
Now produce the tasks for the approved idea, following all rules.`;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsx --test src/prompt.test.ts`
Expected: PASS (all three).

- [ ] **Step 7: Typecheck (callers still compile — fields are optional)**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/prompt.ts src/prompt.test.ts package.json
git commit -m "$(cat <<'EOF'
[TASK-064] prompt: ALREADY IN THIS PROJECT section + no-duplication rule (REQ-008)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Thread completion context through both generators

**Files:**
- Modify: `src/generation/orchestrate.ts` (`generateForApprovedIdea` + `generateForRequirement`)
- Modify: `src/generation/orchestrate-requirement.test.ts` (already registered)

**Interfaces:**
- Consumes: `projectTaskSummary` (Task 2), `recentGitLog` (Task 1), `buildUserMessage` taskSummary/recentCommits (Task 3).
- Produces: both generators now include the completion context and account for its tokens.

- [ ] **Step 1: Write the failing test**

In `src/generation/orchestrate-requirement.test.ts`, add (the file already imports `createTestDb`, `project`, `requirements`, `tasks`, `generateForRequirement`, and a `generateTasks` type — match the existing import block; if `tasks` isn't imported there yet, add it to the `../db/schema` import):

```ts
test("generateForRequirement feeds the ALREADY IN THIS PROJECT completion context to the generator", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", defaultBranch: "main", installationId: 1, localClonePath: "/x" }).returning({ id: project.id });
    // Target requirement (no tasks → generation proceeds).
    const [target] = await db.insert(requirements).values({ key: "REQ-001", title: "Target", description: "d", provenance: "imported", projectId: p.id }).returning({ id: requirements.id });
    // A DIFFERENT requirement that already has a completed task — should surface in the context.
    const [other] = await db.insert(requirements).values({ key: "REQ-002", title: "Other", description: "d", provenance: "imported", projectId: p.id }).returning({ id: requirements.id });
    await db.insert(tasks).values({ key: "TASK-009", title: "Already done", body: "b", requirementId: other.id, effort: 1, risk: "low", confidence: 50, projectId: p.id, githubStatus: "closed" });

    let captured = "";
    const capturing: typeof generateTasks = async (args) => {
      captured = args.userMessage;
      return { ok: false, failure: "captured", usage: null }; // short-circuit before persist
    };

    const r = await generateForRequirement(db, target.id, { generate: capturing });
    assert.equal(r.ok, false);
    assert.ok(captured.includes("## ALREADY IN THIS PROJECT"), "completion section present");
    assert.ok(captured.includes("TASK-009 [closed] — Already done → REQ-002"), "existing closed task surfaced");
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/generation/orchestrate-requirement.test.ts`
Expected: FAIL — the captured message has the greenfield note (orchestrate doesn't pass `taskSummary`/`recentCommits` yet), so `TASK-009 [closed]` is absent.

- [ ] **Step 3: Wire both generators**

In `src/generation/orchestrate.ts`, add imports near the top:

```ts
import { recentGitLog } from "../github/clone";
import { projectTaskSummary } from "./context";
```

In **`generateForApprovedIdea`**, after `const ctx = reqContextFromDb(...)` and before the `const fixed = ...` line, add:

```ts
  const taskSummary = await projectTaskSummary(db, proj.id);
  const recentCommits = await recentGitLog(proj.localClonePath);
```

Change that function's `const fixed = ...` to include the two blocks:

```ts
  const fixed =
    estimateTokens(specText) +
    estimateTokens(conventions ?? "") +
    estimateTokens(idea.title + why) +
    estimateTokens(SYSTEM_PROMPT) +
    estimateTokens(taskSummary.join("\n")) +
    estimateTokens(recentCommits.join("\n")) +
    800;
```

And add the two fields to its `buildUserMessage({ ... })` call:

```ts
    idea: { title: idea.title, why, feasibility: idea.feasibility, viability: idea.viability },
    slice,
    taskSummary,
    recentCommits,
  });
```

Make the **identical** change in **`generateForRequirement`**: after its `const ctx = reqContextFromDb(...)` (and `const seedWhy = ...`), add `const taskSummary = await projectTaskSummary(db, proj.id);` and `const recentCommits = await recentGitLog(proj.localClonePath);`; add the same two `estimateTokens(...)` terms to its `fixed`; and add `taskSummary,` + `recentCommits,` to its `buildUserMessage({ ... })` call.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/generation/orchestrate-requirement.test.ts`
Expected: PASS (the new test plus all existing ones — existing tests use injected generators / nonexistent clone paths, so `recentGitLog` returns `[]` and `projectTaskSummary` returns the seeded rows without breaking their assertions).

> Note: `generateForApprovedIdea` has no direct unit test (the worker injects a fake generator); its identical wiring is covered by typecheck + the runtime check in Task 6, with `generateForRequirement`'s test validating the shared `buildUserMessage` path.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/generation/orchestrate.ts src/generation/orchestrate-requirement.test.ts
git commit -m "$(cat <<'EOF'
[TASK-064] feed completion context to both generators + budget for it (REQ-008)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Refresh the clone before generation

**Files:**
- Create: `src/project/refresh.ts`
- Modify: `src/worker/index.ts` (`WorkerDeps`, `tickForProject`)
- Modify: `src/worker/worker.test.ts` (already registered)
- Modify: `src/app/(app)/spec/[key]/actions.ts`

**Interfaces:**
- Consumes: `getInstallationToken` (`../github/app`), `ensureClone` (`../github/clone`).
- Produces: `refreshProjectClone(db: Db, projectId: string): Promise<void>` (throws on failure; callers run best-effort); `WorkerDeps.refreshClone?: (db: Db, projectId: string) => Promise<void>`.

- [ ] **Step 1: Write the failing worker test**

In `src/worker/worker.test.ts`, append:

```ts
test("tick refreshes each project's clone before generating; a refresh failure does not abort the tick", async () => {
  const { db, close } = await createTestDb();
  try {
    const userId = await makeUser(db);
    const projAId = await seedProject(db, "acme/repo-a");
    await seedApprovedIdea(db, projAId, userId, "Idea A");

    const order: string[] = [];
    const deps: WorkerDeps = {
      refreshClone: async (_d, pid) => {
        order.push(`refresh:${pid}`);
        throw new Error("pull boom");
      },
      generate: async () => {
        order.push("generate");
        return { ok: true, taskKeys: [] };
      },
      createIssues: async () => ({ created: [] }),
      createBranches: async () => ({ created: [] }),
      closeIssues: async () => ({ closed: [] }),
      specMaterialize: async () => ({ requirementCount: 0, sha: "abc1234" }),
      digest: async () => ({ generated: false, reason: "nothing new" }),
    };

    await assert.doesNotReject(() => tick(db, deps));
    assert.deepEqual(order, [`refresh:${projAId}`, "generate"], "refresh runs before generation; its failure is isolated");
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/worker/worker.test.ts`
Expected: FAIL — `refreshClone` isn't a `WorkerDeps` key / no refresh step runs (`order` is `["generate"]` or a type error).

- [ ] **Step 3: Create `refreshProjectClone`**

Create `src/project/refresh.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { project } from "../db/schema";
import { getInstallationToken } from "../github/app";
import { ensureClone } from "../github/clone";

/**
 * Refresh a project's local clone to the latest default branch before generation
 * (REQ-008), so the slice / spec / CLAUDE.md and the git-log context aren't stale
 * (which makes the model re-propose already-done work). Throws on failure; callers
 * run it best-effort. Mirrors the bind-time clone in src/project/connect.ts.
 */
export async function refreshProjectClone(db: Db, projectId: string): Promise<void> {
  const [proj] = await db.select().from(project).where(eq(project.id, projectId)).limit(1);
  if (!proj) throw new Error(`Project ${projectId} not found (REQ-002).`);
  const token = await getInstallationToken(proj.installationId);
  await ensureClone({
    repoFullName: proj.repoFullName,
    dir: proj.localClonePath,
    token,
    defaultBranch: proj.defaultBranch,
  });
}
```

- [ ] **Step 4: Wire the worker**

In `src/worker/index.ts`:

(a) Add the import:

```ts
import { refreshProjectClone } from "../project/refresh";
```

(b) Add to the `WorkerDeps` interface (next to `generate`):

```ts
  refreshClone?: (db: Db, projectId: string) => Promise<void>;
```

(c) Add to the `tickForProject` destructuring defaults (next to `generate`):

```ts
    refreshClone = refreshProjectClone,
```

(d) At the **start** of `tickForProject`, immediately after the destructuring block and before `let didGenerate = false;`, add the best-effort step:

```ts
  // Refresh the project's local clone so generation sees the latest merged code
  // (REQ-008) — a stale slice/spec/git-log makes the model re-propose already-done
  // work. Best-effort: a pull failure must not block the tick.
  try {
    await refreshClone(db, proj.id);
  } catch (e) {
    console.error(`[worker][${proj.id}] clone refresh skipped:`, formatError(e));
  }
```

- [ ] **Step 5: Stub `refreshClone` in the existing worker tests**

In `src/worker/worker.test.ts`, the four existing `deps: WorkerDeps` objects each stub every dependency. Add this line to each (next to `generate`) so they stay hermetic (the real `refreshProjectClone` would attempt GitHub App auth + git):

```ts
      refreshClone: async () => {},
```

(The four tests: "tick iterates all projects…", "tick scopes approved-idea query…", "tick per-project: a step failure…", "tick runs the close-issues sweep…".)

- [ ] **Step 6: Refresh in the `/spec` generation action**

In `src/app/(app)/spec/[key]/actions.ts`, add the import:

```ts
import { refreshProjectClone } from "@/project/refresh";
```

In `generateTasksForRequirement`, between `const pid = await activeProjectId();` and `const r = await generateForRequirementKey(db, pid, key);`, add:

```ts
  // Refresh the clone so generation sees the latest merged code (REQ-008). Best-effort.
  try {
    await refreshProjectClone(db, pid);
  } catch (e) {
    console.error("[spec] clone refresh skipped:", e instanceof Error ? e.message : e);
  }
```

- [ ] **Step 7: Run the worker tests to verify they pass**

Run: `npx tsx --test src/worker/worker.test.ts`
Expected: PASS (the new test plus the four existing ones).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

> Note: `refreshProjectClone` itself is thin glue over the already-tested `getInstallationToken` + `ensureClone` and is exercised at runtime; it is covered here via worker-level injection (like `createBranch`/`openIssue`, which also aren't unit-tested directly).

- [ ] **Step 9: Commit**

```bash
git add src/project/refresh.ts src/worker/index.ts src/worker/worker.test.ts "src/app/(app)/spec/[key]/actions.ts"
git commit -m "$(cat <<'EOF'
[TASK-064] refresh the clone before generation (worker + /spec) (REQ-008)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Verify, review, and open the PR

**Files:** none (verification + review + integration).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass (show output), including the new `clone`/`context`/`prompt` tests and the new orchestrate + worker tests. (A transient V8/JIT native crash has been seen on the first run on this Windows/Node 24 box — if you hit a native crash unrelated to the code, re-run once; a clean run is the real result.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Event-integrity review**

Dispatch the `event-integrity-reviewer` agent on the diff. It must confirm: this is read/context-only — no new events, no schema, no `github_status` write (only read to label tasks); no `any` in domain code; maps to REQ-008 (no invented requirement). Address any findings (apply `receiving-code-review` rigor), re-running the suite after changes.

- [ ] **Step 5: Runtime check**

With the worker running against the live deployment, trigger a generation (approve an idea, or use the `/spec` "generate tasks" action) and confirm from the worker/server logs (or by inspecting the assembled prompt) that the clone is refreshed first and the `## ALREADY IN THIS PROJECT` section now carries the project's existing tasks + recent commits. Ideally, re-run the idea that previously produced a duplicate and confirm it no longer does.

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin task-064-completion-aware-generation
gh pr create --title "[TASK-064] completion-aware task generation (REQ-008)" --body "…"
```

PR body: summarize the refresh + the two completion blocks + the system-prompt rule; note it's read/context-only (no schema, no events); link the design doc. Squash-merge so `[TASK-064]` lands as one line on `main`. No live migration is needed (no schema change).

---

## Self-Review

**Spec coverage** (against `2026-06-25-completion-aware-generation-design.md`):
- §1 Refresh the clone (worker step + `/spec` call site, best-effort, injectable) → Task 5. ✔
- §2 Two completion blocks — `projectTaskSummary` (Task 2) + `recentGitLog` (Task 1), rendered in the prompt section (Task 3), threaded through both generators (Task 4). ✔
- §3 Token budget (both blocks folded into `fixed`) → Task 4. ✔
- §4 System-prompt rule → Task 3. ✔
- Truth-model (read/context-only, no events, github_status read-only) → Global Constraints + Task 6 Step 4. ✔
- Bounds (200 tasks / 80 commits) and status precedence → Tasks 1, 2 + Global Constraints. ✔
- Greenfield note when empty → Task 3. ✔
- Best-effort error handling → Tasks 1 (`recentGitLog` → []), 5 (refresh try/catch). ✔
- Testing list → each helper/test mapped (clone, context, prompt, orchestrate, worker). ✔
- Out-of-scope (no schema/event, no hard validator, no requirement-status feed) → respected (nothing in the plan adds them). ✔

**Placeholder scan:** the only `…` are in the `gh pr create` body and the prompt rule's own copy — intentional, not code stubs. No TBD/TODO.

**Type consistency:** `recentGitLog(repoPath, { limit })`, `projectTaskSummary(db, projectId, { limit })`, and the optional `taskSummary?: string[]` / `recentCommits?: string[]` on `UserMessageParts` are named/typed identically where defined (Tasks 1-3) and consumed (Task 4). `refreshProjectClone(db, projectId)` and `WorkerDeps.refreshClone(db, projectId)` share one signature across Task 5. `RepoSlice` test fixture matches the fields `sliceBlock` reads (`repoLabel`, `nearEmpty`, `fileCount`, `tree`, `files`, `omitted`).
