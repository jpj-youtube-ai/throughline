# Close the GitHub issue when a task's PR merges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a task's PR merges (its issue's `github_status` becomes `closed`), actively close the corresponding GitHub issue via the App.

**Architecture:** A new idempotent worker sweep (`closeIssuesForMergedTasks`) mirrors the existing `createIssuesForTasks`/`createBranchesForClaimedTasks` pattern — it runs each tick, finds tasks whose status is `closed` but whose issue we haven't closed yet, closes them via a new `closeIssue` App primitive, and stamps a once-per-task `tasks.issue_closed_at` marker so it never re-closes and self-heals on failure. The webhook is untouched; it stays a pure transactional DB mirror.

**Tech Stack:** TypeScript, Next.js (App Router), Postgres + Drizzle, Octokit (GitHub App), `node:test` + PGlite for tests.

**Design doc:** `docs/superpowers/specs/2026-06-25-close-issue-on-merge-design.md`

## Global Constraints

- **Requirement linkage:** every commit/PR is for **REQ-009** (Issue creation & status mirroring). No new REQ.
- **Truth model — `github_status` is webhook-only.** This change must NOT write `tasks.github_status`. `issue_closed_at` is a *separate* outbound-action bookkeeping column, written only by the worker sweep — exactly like `github_issue_number`.
- **No event for `issue_closed_at`.** Outbound-action bookkeeping emits no event (consistent with issue/branch creation). The authoritative state change is captured by the resulting `issues closed` webhook → `task.github_status_changed`.
- **External calls never inside a DB transaction.** The sweep runs outside any tx (it makes an Octokit call that can't be rolled back).
- **No `any` in domain code.**
- **Conventions:** branch `task-063-close-issue-on-merge`; PR title and squash message start with `[TASK-063]`. (Confirm `TASK-063` is the next free task id before opening the PR.)
- **Every commit message ends with the trailer:**
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **New `*.test.ts` files MUST be added to the `test` script in `package.json`** (it is enumerated, not globbed — an unregistered test is silently skipped).
- **A new Drizzle migration does NOT reach the live DB automatically and tests will NOT catch the gap.** After generating it, apply the single `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` to the live Postgres by hand and verify, before any runtime walkthrough.

## Setup (before Task 1)

Create the work branch off `main`:

```bash
git switch -c task-063-close-issue-on-merge
```

---

## File Structure

- `src/db/schema.ts` — add the `issueClosedAt` column to `tasks` (modify).
- `drizzle/0012_*.sql` — generated migration adding the column (create, via `db:generate`).
- `src/db/issue-closed-column.test.ts` — column round-trip test (create).
- `src/github/app.ts` — add the `closeIssue` App primitive (modify).
- `src/github/issues.ts` — add the `closeIssuesForMergedTasks` sweep (modify).
- `src/github/issues.test.ts` — tests for the sweep (modify).
- `src/worker/index.ts` — wire the sweep into `tickForProject` (modify).
- `src/worker/worker.test.ts` — test the new step + its failure isolation (modify).
- `package.json` — register the new column test file (modify).

---

## Task 1: Add `tasks.issue_closed_at` column + migration

**Files:**
- Modify: `src/db/schema.ts` (the `tasks` table, after `branchCreatedAt`, around line 113)
- Create: `src/db/issue-closed-column.test.ts`
- Create (generated): `drizzle/0012_*.sql`
- Modify: `package.json` (the `test` script)

**Interfaces:**
- Produces: a nullable `tasks.issueClosedAt` column — Drizzle `timestamp("issue_closed_at", { withTimezone: true })`, TS type `Date | null`. Tasks 2 and 3 read/write it.

- [ ] **Step 1: Write the failing column round-trip test**

Create `src/db/issue-closed-column.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "./client";
import { project, requirements, tasks } from "./schema";

test("tasks.issue_closed_at defaults to null and round-trips a timestamp", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db
      .insert(project)
      .values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" })
      .returning({ id: project.id });
    const [r] = await db
      .insert(requirements)
      .values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: p.id })
      .returning({ id: requirements.id });
    const [t] = await db
      .insert(tasks)
      .values({ key: "TASK-001", title: "t", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: p.id })
      .returning({ id: tasks.id });

    const [fresh] = await db.select({ at: tasks.issueClosedAt }).from(tasks).where(eq(tasks.id, t.id));
    assert.equal(fresh.at, null, "defaults to null");

    const when = new Date("2026-06-25T12:00:00.000Z");
    await db.update(tasks).set({ issueClosedAt: when }).where(eq(tasks.id, t.id));
    const [updated] = await db.select({ at: tasks.issueClosedAt }).from(tasks).where(eq(tasks.id, t.id));
    assert.deepEqual(updated.at, when);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Register the test file in `package.json`**

In the `"test"` script, append ` src/db/issue-closed-column.test.ts` to the end of the enumerated list (after `src/db/check.test.ts`).

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx --test src/db/issue-closed-column.test.ts`
Expected: FAIL — `tasks.issueClosedAt` is `undefined` / the `issue_closed_at` column does not exist in the PGlite schema.

- [ ] **Step 4: Add the column to the schema**

In `src/db/schema.ts`, inside the `tasks` table, immediately after the `branchCreatedAt` line, add:

```ts
  // When we closed the task's GitHub issue after its PR merged (REQ-009).
  // Outbound-action bookkeeping, written ONLY by the worker close sweep — this is
  // NOT github_status (which stays webhook-only) and emits no event.
  issueClosedAt: timestamp("issue_closed_at", { withTimezone: true }),
```

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `drizzle/0012_*.sql` containing `ALTER TABLE "tasks" ADD COLUMN "issue_closed_at" timestamp with time zone;` (the test DB rebuilds from all `drizzle/*.sql`, so the column is now present in PGlite).

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx tsx --test src/db/issue-closed-column.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/issue-closed-column.test.ts package.json drizzle/
git commit -m "$(cat <<'EOF'
[TASK-063] add tasks.issue_closed_at column (REQ-009)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Apply the migration to the live DB (ops step — required)**

The generated migration is NOT applied to the running Postgres by `db:migrate` (fresh-provision only). Apply the single statement by hand against `DATABASE_URL`, then verify:

```bash
# Apply (idempotent):
node --input-type=module -e "import('pg').then(async ({default:{Pool}})=>{const{config}=await import('dotenv').catch(()=>({config:()=>{}}));const p=new Pool({connectionString:process.env.DATABASE_URL});await p.query('ALTER TABLE \"tasks\" ADD COLUMN IF NOT EXISTS \"issue_closed_at\" timestamp with time zone');console.log('applied');await p.end();})"
```

If `dotenv` isn't available in scope, load env the same way the repo does (`src/env.ts` `loadDotenv()`), or run the `ALTER TABLE … IF NOT EXISTS` directly via the team's psql access. Then verify:

```bash
node --input-type=module -e "import('pg').then(async ({default:{Pool}})=>{const p=new Pool({connectionString:process.env.DATABASE_URL});const r=await p.query(\"select column_name from information_schema.columns where table_name='tasks' and column_name='issue_closed_at'\");console.log(r.rows);await p.end();})"
```

Expected: one row `{ column_name: 'issue_closed_at' }`.

> Note: `npm run db:check` / the worker boot guard will report drift on `tasks.issue_closed_at` until this step is done.

---

## Task 2: `closeIssue` primitive + `closeIssuesForMergedTasks` sweep

**Files:**
- Modify: `src/github/app.ts` (add `closeIssue`, sibling of `openIssue` around line 42)
- Modify: `src/github/issues.ts` (add the sweep + its types; extend the `./app` import)
- Test: `src/github/issues.test.ts` (already registered in `package.json`)

**Interfaces:**
- Consumes: `tasks.issueClosedAt` (Task 1); existing `project` row fields `installationId`, `repoFullName`; existing `listProjects(db)`.
- Produces:
  - `closeIssue(installationId: number, repoFullName: string, issueNumber: number): Promise<void>` (in `app.ts`).
  - `type CloseIssueFn = (installationId: number, repoFullName: string, issueNumber: number) => Promise<void>`.
  - `interface CloseIssuesResult { closed: string[] }`.
  - `closeIssuesForMergedTasks(db: Db, projectId?: string, closeIssue?: CloseIssueFn): Promise<CloseIssuesResult>`.
  - Task 3 consumes `closeIssuesForMergedTasks` and `CloseIssuesResult`.

- [ ] **Step 1: Write the failing sweep tests**

In `src/github/issues.test.ts`, update the top import to pull in the sweep:

```ts
import { createIssuesForTasks, closeIssuesForMergedTasks, type OpenIssueFn, type CloseIssueFn } from "./issues";
```

Then append these three tests (they reuse the existing `seedProject(db, repoFullName, installationId)` helper already in the file):

```ts
test("closeIssuesForMergedTasks closes merged tasks' issues, marks them once, idempotently", async () => {
  const { db, close } = await createTestDb();
  try {
    const { projId, reqId } = await seedProject(db, "acme/repo", 77);
    await db.insert(tasks).values([
      // eligible: closed + has an issue + not yet marked
      { key: "TASK-001", title: "A", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId, githubStatus: "closed", githubIssueNumber: 11 },
      // not eligible: still open
      { key: "TASK-002", title: "B", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId, githubStatus: "open", githubIssueNumber: 12 },
      // not eligible: closed but no issue number
      { key: "TASK-003", title: "C", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId, githubStatus: "closed" },
    ]);

    const calls: Array<{ installationId: number; repo: string; issue: number }> = [];
    const fakeClose: CloseIssueFn = async (installationId, repo, issue) => {
      calls.push({ installationId, repo, issue });
    };

    const r1 = await closeIssuesForMergedTasks(db, projId, fakeClose);
    assert.deepEqual(r1.closed, ["TASK-001"]);
    assert.deepEqual(calls, [{ installationId: 77, repo: "acme/repo", issue: 11 }]);

    const [t1] = await db.select({ at: tasks.issueClosedAt }).from(tasks).where(eq(tasks.key, "TASK-001"));
    assert.ok(t1.at instanceof Date, "issue_closed_at marked on success");

    // Second sweep: nothing left, no re-close.
    const r2 = await closeIssuesForMergedTasks(db, projId, fakeClose);
    assert.deepEqual(r2.closed, []);
    assert.equal(calls.length, 1, "no re-close on the second sweep");
  } finally {
    await close();
  }
});

test("closeIssuesForMergedTasks: a per-task close failure leaves it unmarked and does not block others", async () => {
  const { db, close } = await createTestDb();
  try {
    const { projId, reqId } = await seedProject(db, "acme/repo", 55);
    await db.insert(tasks).values([
      { key: "TASK-001", title: "A", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId, githubStatus: "closed", githubIssueNumber: 1 },
      { key: "TASK-002", title: "B", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId, githubStatus: "closed", githubIssueNumber: 2 },
    ]);

    const fakeClose: CloseIssueFn = async (_i, _r, issue) => {
      if (issue === 1) throw new Error("github boom");
    };

    const r = await closeIssuesForMergedTasks(db, projId, fakeClose);
    assert.deepEqual(r.closed, ["TASK-002"], "the healthy task still closed");

    const rows = await db.select({ key: tasks.key, at: tasks.issueClosedAt }).from(tasks);
    const t1 = rows.find((x) => x.key === "TASK-001");
    const t2 = rows.find((x) => x.key === "TASK-002");
    assert.equal(t1?.at, null, "failed task left unmarked (retryable next tick)");
    assert.ok(t2?.at instanceof Date, "succeeded task marked");
  } finally {
    await close();
  }
});

test("closeIssuesForMergedTasks is project-scoped: another project's closed task is untouched", async () => {
  const { db, close } = await createTestDb();
  try {
    const { projId: pA, reqId: rA } = await seedProject(db, "acme/alpha", 10);
    const { projId: pB, reqId: rB } = await seedProject(db, "acme/beta", 20);
    await db.insert(tasks).values([
      { key: "TASK-001", title: "Alpha", body: "b", requirementId: rA, effort: 1, risk: "low", confidence: 50, projectId: pA, githubStatus: "closed", githubIssueNumber: 1 },
      { key: "TASK-001", title: "Beta", body: "b", requirementId: rB, effort: 1, risk: "low", confidence: 50, projectId: pB, githubStatus: "closed", githubIssueNumber: 1 },
    ]);

    const calls: number[] = [];
    const fakeClose: CloseIssueFn = async (installationId) => { calls.push(installationId); };

    const r = await closeIssuesForMergedTasks(db, pB, fakeClose);
    assert.deepEqual(r.closed, ["TASK-001"]);
    assert.deepEqual(calls, [20], "only project B's installation used");

    const rows = await db.select({ pid: tasks.projectId, at: tasks.issueClosedAt }).from(tasks);
    const a = rows.find((x) => x.pid === pA);
    assert.equal(a?.at, null, "project A untouched");
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/github/issues.test.ts`
Expected: FAIL — `closeIssuesForMergedTasks` / `CloseIssueFn` are not exported from `./issues`.

- [ ] **Step 3: Add the `closeIssue` primitive to `app.ts`**

In `src/github/app.ts`, after the `openIssue` function (around line 52), add:

```ts
// Close an issue on the bound repo once its task's PR has merged (REQ-009).
// state_reason "completed" because the work shipped. Idempotent: closing an
// already-closed issue is a GitHub no-op.
export async function closeIssue(
  installationId: number,
  repoFullName: string,
  issueNumber: number,
): Promise<void> {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationOctokit(installationId);
  await octokit.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    state: "closed",
    state_reason: "completed",
  });
}
```

- [ ] **Step 4: Add the sweep to `issues.ts`**

In `src/github/issues.ts`, extend the imports:

```ts
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { openIssue as realOpenIssue, closeIssue as realCloseIssue } from "./app";
```

(the file currently imports `{ and, eq, isNull }` and `{ openIssue as realOpenIssue }` — add `isNotNull` and the `closeIssue` alias).

Then append the sweep at the end of the file:

```ts
export type CloseIssueFn = (
  installationId: number,
  repoFullName: string,
  issueNumber: number,
) => Promise<void>;

export interface CloseIssuesResult {
  closed: string[]; // task keys whose issue we closed this run
}

/**
 * Close the GitHub issue for each task whose PR has merged (REQ-009) — i.e. the
 * webhook has mirrored github_status to 'closed' — that we haven't closed yet.
 * Runs AFTER any tx (an external call can't be rolled back). Idempotent and
 * self-healing: issue_closed_at is stamped only on success, so a failure retries
 * next tick. Closing an already-closed issue is a harmless GitHub no-op.
 *
 * issue_closed_at is outbound-action bookkeeping (like github_issue_number) — it
 * is NOT github_status (webhook-only) and emits no event.
 *
 * `projectId` is optional: when omitted, resolves the oldest project (parity with
 * createIssuesForTasks).
 */
export async function closeIssuesForMergedTasks(
  db: Db,
  projectId?: string,
  closeIssue: CloseIssueFn = realCloseIssue,
): Promise<CloseIssuesResult> {
  let resolvedProjectId: string;
  if (projectId) {
    resolvedProjectId = projectId;
  } else {
    const projects = await listProjects(db);
    if (projects.length === 0) throw new Error("No project bound (REQ-002).");
    resolvedProjectId = projects[0].id;
  }

  const [proj] = await db.select().from(project).where(eq(project.id, resolvedProjectId)).limit(1);
  if (!proj) throw new Error(`Project ${resolvedProjectId} not found (REQ-002).`);

  const pending = await db
    .select({ id: tasks.id, key: tasks.key, issueNumber: tasks.githubIssueNumber })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, resolvedProjectId),
        eq(tasks.githubStatus, "closed"),
        isNotNull(tasks.githubIssueNumber),
        isNull(tasks.issueClosedAt),
      ),
    );

  const closed: string[] = [];
  for (const t of pending) {
    try {
      await closeIssue(proj.installationId, proj.repoFullName, t.issueNumber!);
      await db
        .update(tasks)
        .set({ issueClosedAt: new Date(), updatedAt: new Date() })
        .where(eq(tasks.id, t.id));
      closed.push(t.key);
    } catch (e) {
      console.error(`[issues] close failed for ${t.key}:`, e instanceof Error ? e.message : e);
    }
  }
  return { closed };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsx --test src/github/issues.test.ts`
Expected: PASS (all three new tests plus the existing `createIssuesForTasks` ones).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/github/app.ts src/github/issues.ts src/github/issues.test.ts
git commit -m "$(cat <<'EOF'
[TASK-063] close merged tasks' issues via a worker sweep (REQ-009)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire the sweep into the worker tick

**Files:**
- Modify: `src/worker/index.ts` (`WorkerDeps`, `tickForProject`)
- Test: `src/worker/worker.test.ts` (already registered)

**Interfaces:**
- Consumes: `closeIssuesForMergedTasks`, `CloseIssuesResult` (Task 2).
- Produces: `WorkerDeps.closeIssues?: (db: Db, projectId: string) => Promise<CloseIssuesResult>`; a new isolated step in `tickForProject`.

- [ ] **Step 1: Write the failing worker test**

In `src/worker/worker.test.ts`, append:

```ts
test("tick runs the close-issues sweep per project, and a failure in it does not abort the tick", async () => {
  const { db, close } = await createTestDb();
  try {
    const userId = await makeUser(db);
    const projAId = await seedProject(db, "acme/repo-a");
    await seedApprovedIdea(db, projAId, userId, "Idea A");

    const closeCalls: string[] = [];
    const deps: WorkerDeps = {
      generate: async () => ({ ok: true, taskKeys: [] }),
      createIssues: async () => ({ created: [] }),
      createBranches: async () => ({ created: [] }),
      closeIssues: async (_d, pid) => {
        closeCalls.push(pid);
        throw new Error("close boom");
      },
      specMaterialize: async () => ({ requirementCount: 0, sha: "abc1234" }),
      digest: async () => ({ generated: false, reason: "nothing new" }),
    };

    // The thrown error from closeIssues must be caught inside the step.
    await assert.doesNotReject(() => tick(db, deps));
    assert.deepEqual(closeCalls, [projAId], "close sweep invoked for the project");
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/worker/worker.test.ts`
Expected: FAIL — `closeIssues` is not a recognized `WorkerDeps` key / the step isn't called (`closeCalls` empty), or a type error on the deps object.

- [ ] **Step 3: Wire the sweep into the worker**

In `src/worker/index.ts`:

(a) Extend the issues import:

```ts
import { createIssuesForTasks, closeIssuesForMergedTasks, type CreateIssuesResult, type CloseIssuesResult } from "../github/issues";
```

(b) Add to the `WorkerDeps` interface (after `createBranches`):

```ts
  closeIssues?: (db: Db, projectId: string) => Promise<CloseIssuesResult>;
```

(c) Add to the `tickForProject` destructuring defaults (after the `createBranches` default):

```ts
    closeIssues = (d, pid) => closeIssuesForMergedTasks(d, pid),
```

(d) Add the new step in `tickForProject`, immediately after the branch-creation `try/catch` block and before the spec re-materialization block:

```ts
  // Close GitHub issues for tasks whose PR merged (REQ-009). Outbound + idempotent;
  // the issue_closed_at marker bounds this to once per task and lets it self-heal.
  try {
    const { closed } = await closeIssues(db, proj.id);
    if (closed.length) console.error(`[worker][${proj.id}] closed ${closed.length} issue(s): ${closed.join(", ")}`);
  } catch (e) {
    console.error(`[worker][${proj.id}] issue close skipped:`, formatError(e));
  }
```

- [ ] **Step 4: Stub `closeIssues` in the three existing worker tests**

Each of the three existing tests in `worker.test.ts` builds a `deps: WorkerDeps` object that stubs every dependency. Add this line to each of those three `deps` objects (next to `createBranches`) so they stay hermetic and don't fall through to the real sweep:

```ts
      closeIssues: async () => ({ closed: [] }),
```

- [ ] **Step 5: Run the worker tests to verify they pass**

Run: `npx tsx --test src/worker/worker.test.ts`
Expected: PASS (the new test plus the three existing ones).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/worker/index.ts src/worker/worker.test.ts
git commit -m "$(cat <<'EOF'
[TASK-063] run the close-issues sweep each worker tick (REQ-009)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Verify, review, and open the PR

**Files:** none (verification + review + integration).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass (show the output). Confirm the new tests are among them.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Event-integrity review**

Dispatch the `event-integrity-reviewer` agent on the diff. It must confirm:
- nothing here writes `tasks.github_status` (still webhook-only);
- `issue_closed_at` is written only by the sweep, emits no event, and is justified as outbound-action bookkeeping (parity with `github_issue_number`);
- no `any` in the new domain code;
- the work maps to REQ-009 (no invented requirement).

Address any findings (apply `receiving-code-review` rigor — verify, don't just agree), re-running the suite after changes.

- [ ] **Step 5: Confirm the live-DB migration is applied**

Run: `npm run db:check`
Expected: no drift on `tasks.issue_closed_at` (i.e. Task 1 Step 8 was done). If it reports drift, apply the `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` before deploying.

- [ ] **Step 6: Runtime walkthrough**

With the worker running against the live (or a staging) project, confirm: a task whose PR has merged (so `github_status='closed'`, issue number present, `issue_closed_at` null) gets its GitHub issue closed on the next tick, the log line `closed N issue(s): …` appears, `issue_closed_at` is set, and the subsequent tick does not re-close it. (Closing an already-closed issue, e.g. one a human closed, is a harmless no-op.)

- [ ] **Step 7: Push and open the PR**

```bash
git push -u origin task-063-close-issue-on-merge
gh pr create --title "[TASK-063] close the GitHub issue when a task's PR merges (REQ-009)" --body "…"
```

PR body: summarize the sweep + marker, note the new column and that the live DB migration was applied, and link the design doc. Squash-merge so `[TASK-063]` lands as one line on `main`.

---

## Self-Review

**Spec coverage** (against `2026-06-25-close-issue-on-merge-design.md`):
- Data model (`issue_closed_at`) → Task 1. ✔
- `closeIssue` primitive → Task 2 (Step 3). ✔
- `closeIssuesForMergedTasks` sweep (predicate, mark-on-success, project scope, outside-tx) → Task 2 (Step 4) + tests (Step 1). ✔
- Worker wiring (isolated step, log line) → Task 3. ✔
- Truth-model constraints (no `github_status` write, no event) → Global Constraints + Task 4 Step 4 review. ✔
- Failure handling (retryable, doesn't block batch/tick) → Task 2 failure test + Task 3 failure test. ✔
- Migration hand-applied to live DB → Task 1 Step 8 + Task 4 Step 5. ✔
- Known limitation (no clear-on-reopen) → intentionally not implemented (YAGNI), matches spec. ✔
- REQ-009 linkage → Global Constraints. ✔

**Placeholder scan:** the only `…` are in the `gh pr create` body and a log string — both intentional, not code stubs. No TBD/TODO.

**Type consistency:** `CloseIssueFn`, `CloseIssuesResult`, and `closeIssuesForMergedTasks` are named identically in Task 2 (definition), Task 2 tests, and Task 3 (consumption). `issueClosedAt` (camel) ↔ `issue_closed_at` (snake) used consistently for TS vs SQL.
