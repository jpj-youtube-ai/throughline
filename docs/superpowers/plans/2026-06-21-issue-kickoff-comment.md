# Issue Kickoff-Comment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a task's branch is created on claim, post a Claude Code kickoff prompt as a comment on the task's GitHub issue.

**Architecture:** A new `commentOnIssue` primitive (octokit) + a pure `kickoffComment(taskKey, branchName)` builder; the existing `createBranchesForClaimedTasks` sweep posts the comment right after creating each branch (when the task has an issue number) and before setting the `branch_created_at` sentinel — so it fires exactly once, from both the claim action and the worker, with no new state.

**Tech Stack:** Drizzle/Postgres, octokit (`rest.issues.createComment`), Node `tsx --test` + pglite.

## Global Constraints

- **TypeScript; no `any` in domain code** (the existing `as unknown as GitRefClient` octokit-boundary cast in `branches.ts` stays; no new casts needed here).
- **Posting a comment is an external side-effect** — it happens inside the sweep, which already runs **outside any DB transaction**. **No new event.** **`tasks.github_status` stays webhook-only**; the only bookkeeping column written is `branch_created_at`.
- **Best-effort, gated once:** order is `createBranch → comment → set branch_created_at`. A comment failure leaves the sentinel null so the next sweep retries (createBranch idempotent via 422; the comment re-posts once — the failed attempt never posted, so no duplicate). The claim action already wraps the sweep in try/catch.
- Comment only when the task has a `github_issue_number`; otherwise skip it (the branch is still recorded).
- `src/github/branches.test.ts` is **already** in the `package.json` test list (from TASK-040) — no `package.json` change needed.
- **Commits start with `[TASK-041]`** on branch `task-041-kickoff-comment`. Implements **REQ-009** (issue interaction) / **REQ-011** (claim/branch).

---

## File Structure

**Modified**
- `src/github/app.ts` — add `commentOnIssue`.
- `src/github/branches.ts` — add `kickoffComment` + `CommentOnIssueFn`; `createBranchesForClaimedTasks` posts the comment.
- `src/github/branches.test.ts` — cover `kickoffComment` + the comment behavior.

---

## Task 1: `commentOnIssue` primitive + `kickoffComment` builder

**Files:** Modify `src/github/app.ts`, `src/github/branches.ts`, `src/github/branches.test.ts`.

**Interfaces:**
- Produces: `commentOnIssue(installationId: number, repoFullName: string, issueNumber: number, body: string): Promise<void>` (in `app.ts`); `kickoffComment(taskKey: string, branchName: string): string` (in `branches.ts`).

- [ ] **Step 1: Write the failing test** — append to `src/github/branches.test.ts`:

```ts
import { kickoffComment } from "./branches";

test("kickoffComment includes the task key, the branch, and the PR-title convention", () => {
  const c = kickoffComment("TASK-007", "task-007-do-the-thing");
  assert.match(c, /TASK-007/);
  assert.match(c, /task-007-do-the-thing/);
  assert.match(c, /\[TASK-007\]/); // the [TASK-NNN] PR title convention
  assert.match(c, /Claude Code/);
});
```

> `branches.test.ts` already imports `createBranch`, `createBranchesForClaimedTasks`, types, `test`, and `assert`. Add `kickoffComment` to the existing `./branches` import rather than a second import line if you prefer — either compiles.

- [ ] **Step 2: Run it (fails)**

Run: `npx tsx --test src/github/branches.test.ts`
Expected: FAIL — `kickoffComment` is not exported.

- [ ] **Step 3: Add `commentOnIssue` to `src/github/app.ts`** (after the existing `openIssue` function):

```ts
// Post a comment on an existing issue on the bound repo (REQ-009). Used to drop a
// Claude Code kickoff prompt when a task's branch is created.
export async function commentOnIssue(
  installationId: number,
  repoFullName: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationOctokit(installationId);
  await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
}
```

- [ ] **Step 4: Add `kickoffComment` to `src/github/branches.ts`** (after the `createBranch` function, before `createBranchesForClaimedTasks`):

```ts
/**
 * The kickoff prompt posted to a task's issue when its branch is created (REQ-009).
 * References the issue's own pointers/acceptance rather than duplicating them.
 */
export function kickoffComment(taskKey: string, branchName: string): string {
  return [
    `🤖 Branch \`${branchName}\` is ready.`,
    "",
    "**Prompt for Claude Code:**",
    `> Work on ${taskKey} on branch \`${branchName}\`, following the pointers and acceptance check in this issue and the repo's CLAUDE.md conventions. Open a PR titled \`[${taskKey}] …\` when done.`,
  ].join("\n");
}
```

- [ ] **Step 5: Run it (passes) + typecheck**

Run: `npx tsx --test src/github/branches.test.ts` → PASS (existing + the new kickoffComment test).
Run: `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/github/app.ts src/github/branches.ts src/github/branches.test.ts
git commit -m "[TASK-041] commentOnIssue primitive + kickoffComment builder (REQ-009)"
```

---

## Task 2: Sweep posts the kickoff comment

**Files:** Modify `src/github/branches.ts`, `src/github/branches.test.ts`.

**Interfaces:**
- Consumes: `commentOnIssue` (`./app`); `kickoffComment` (Task 1); `tasks.githubIssueNumber`.
- Produces: `CommentOnIssueFn` type; `createBranchesForClaimedTasks(db, createBranchFn?, commentOnIssueFn?)` (new optional third param, default `commentOnIssue`).

> The existing sweep tests call `createBranchesForClaimedTasks(db, fake)` with tasks that have **no** `githubIssueNumber`, so the comment is skipped there and the real `commentOnIssue` is never invoked — they stay green unchanged.

- [ ] **Step 1: Write the failing test** — append to `src/github/branches.test.ts` (add `type CommentOnIssueFn` to the existing `./branches` import):

```ts
test("createBranchesForClaimedTasks posts a kickoff comment for a task with an issue number, skips one without", async () => {
  const { db, close } = await createTestDb();
  try {
    const reqId = await seed(db);
    await db.insert(tasks).values({ key: "TASK-010", title: "a", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, claimState: "claimed", branchName: "task-010-a", githubIssueNumber: 42 });
    await db.insert(tasks).values({ key: "TASK-011", title: "b", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, claimState: "claimed", branchName: "task-011-b" });

    const branchFake: CreateBranchFn = async () => ({ created: true });
    const comments: { issueNumber: number; body: string }[] = [];
    const commentFake: CommentOnIssueFn = async (_i, _r, issueNumber, body) => {
      comments.push({ issueNumber, body });
    };

    const { created } = await createBranchesForClaimedTasks(db, branchFake, commentFake);
    assert.deepEqual(created.sort(), ["TASK-010", "TASK-011"]);

    assert.equal(comments.length, 1); // only TASK-010 has an issue
    assert.equal(comments[0].issueNumber, 42);
    assert.match(comments[0].body, /TASK-010/);
    assert.match(comments[0].body, /task-010-a/);

    const rows = await db.select({ b: tasks.branchCreatedAt }).from(tasks);
    assert.ok(rows.every((r) => r.b instanceof Date)); // both branches recorded
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run it (fails)**

Run: `npx tsx --test src/github/branches.test.ts`
Expected: FAIL — `CommentOnIssueFn` not exported / sweep doesn't accept a third arg / no comment posted.

- [ ] **Step 3: Wire the comment into the sweep** — in `src/github/branches.ts`:

(a) extend the `./app` import:

```ts
import { getInstallationOctokit, commentOnIssue } from "./app";
```

(b) add the type after `CreateBranchFn`:

```ts
export type CommentOnIssueFn = (
  installationId: number,
  repoFullName: string,
  issueNumber: number,
  body: string,
) => Promise<void>;
```

(c) replace `createBranchesForClaimedTasks` with:

```ts
export async function createBranchesForClaimedTasks(
  db: Db,
  createBranchFn: CreateBranchFn = createBranch,
  commentOnIssueFn: CommentOnIssueFn = commentOnIssue,
): Promise<{ created: string[] }> {
  const [proj] = await db.select().from(project).limit(1);
  if (!proj) throw new Error("No project bound (REQ-002).");

  const pending = await db
    .select({ id: tasks.id, key: tasks.key, branchName: tasks.branchName, githubIssueNumber: tasks.githubIssueNumber })
    .from(tasks)
    .where(and(eq(tasks.claimState, "claimed"), isNull(tasks.branchCreatedAt), isNotNull(tasks.branchName)));

  const created: string[] = [];
  for (const t of pending) {
    if (!t.branchName) continue; // narrow; WHERE already excludes nulls
    await createBranchFn(proj.installationId, proj.repoFullName, t.branchName, proj.defaultBranch);
    if (t.githubIssueNumber != null) {
      await commentOnIssueFn(
        proj.installationId,
        proj.repoFullName,
        t.githubIssueNumber,
        kickoffComment(t.key, t.branchName),
      );
    }
    await db.update(tasks).set({ branchCreatedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, t.id));
    created.push(t.key);
  }
  return { created };
}
```

- [ ] **Step 4: Run it (passes) + typecheck**

Run: `npx tsx --test src/github/branches.test.ts` → PASS (all, incl. the new comment test and the unchanged TASK-040 sweep tests).
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/github/branches.ts src/github/branches.test.ts
git commit -m "[TASK-041] sweep posts kickoff comment on the task's issue (REQ-009/011)"
```

- [ ] **Step 6: Full suite + build** — stop any `:3000` server, then `npm test` → all pass; `npm run build` → succeeds.

- [ ] **Step 7: Runtime verification (controller + user)** — rebuild + restart the prod server. On `/tasks`: claim a task that has an open issue → its branch is created **and** a kickoff comment ("🤖 Branch `…` is ready" + the Claude Code prompt) appears on that task's GitHub issue on `orbit`. Claiming again posts no duplicate (the sentinel gates it).

- [ ] **Step 8: Hand off** — report; ready for finishing-a-development-branch.

---

## Self-Review

**Spec coverage:** `commentOnIssue` primitive → Task 1; `kickoffComment` builder + content (key, branch, CLAUDE.md ref, `[TASK-NNN]` PR) → Task 1 (tested); sweep posts the comment after branch creation, gated by `branch_created_at`, only when an issue number exists → Task 2; both callers (claim action + worker) get it via the shared sweep → no change needed (they already call the sweep); runtime claim showing the comment on `orbit` → Task 2 Step 7. Truth model: comment is external + outside any tx, no event, no `github_status` write — preserved (the sweep was already outside a tx in TASK-040).

**Placeholder scan:** every code/test step is complete with commands + expected results. No TBD.

**Type consistency:** `commentOnIssue(installationId, repoFullName, issueNumber, body) → Promise<void>` matches `CommentOnIssueFn` exactly (so the real fn is assignable as the default); `kickoffComment(taskKey, branchName) → string` used in the sweep and tested directly; the sweep's new third param defaults to `commentOnIssue`; the select adds `githubIssueNumber` (camel) ↔ `github_issue_number` (column). Existing TASK-040 sweep tests pass tasks without an issue number, so the added comment branch is inert for them.
