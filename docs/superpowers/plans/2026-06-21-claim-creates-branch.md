# Claim Creates the GitHub Branch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user claims a task, also create its branch (`task-<key>-<slug>`) on GitHub — best-effort, idempotent, with a worker auto-retry.

**Architecture:** Claim stays a transaction that records intent (`task.claimed`); branch creation is an external side-effect performed *after* it (like issue-creation). A new `createBranch` primitive + a `createBranchesForClaimedTasks` sweep (mirroring `createIssuesForTasks`) ensure branches for claimed tasks; a nullable `tasks.branch_created_at` column is the "branch exists" sentinel. The claim action runs the sweep best-effort and surfaces a warning; the worker runs it each tick to retry failures.

**Tech Stack:** Next.js 16 App Router (React 19 `useActionState`), Drizzle/Postgres (+ drizzle-kit migrations), octokit (`rest.git.getRef`/`createRef`), Node `tsx --test` + pglite.

## Global Constraints

- **TypeScript; no `any` in domain code.** Reuse the existing ledger design system — no new theme.
- **Branch creation is external and happens AFTER the claim transaction** — never inside a DB transaction (external calls can't be rolled back), exactly like `createIssuesForTasks`.
- **No new event** — the existing `task.claimed` already records the branch name. **`tasks.github_status` stays webhook-only**; `branch_created_at` is local bookkeeping, written by the branch-creation code.
- **Idempotent**: creating an existing branch (GitHub 422) is success. **Best-effort**: a GitHub failure must never fail the claim or throw to the user.
- **Unclaim leaves the GitHub branch** in place and resets `branch_created_at` to null.
- The `claim` server action stays **`auth()`-guarded**.
- New `*.test.ts` files **must be appended to the `test` script list in `package.json`**.
- **Commits start with `[TASK-040]`** on branch `task-040-claim-creates-branch`. Implements **REQ-010** (claim) / **REQ-011** (branch convention).
- **Build before typecheck** for the client-component task (Next regenerates types).

---

## File Structure

**New**
- `src/github/branches.ts` — `createBranch` + `createBranchesForClaimedTasks` (the sweep).
- `src/github/branches.test.ts` — tests for both.
- `src/app/(app)/tasks/claim-button.tsx` — `ClaimButton` client component.

**Modified**
- `src/db/schema.ts` — add `tasks.branchCreatedAt` (+ generated migration under `drizzle/`).
- `src/tasks/claim.ts` — `unclaimTask` resets `branchCreatedAt`.
- `src/tasks/claim.test.ts` — assert the reset.
- `src/app/(app)/tasks/actions.ts` — `claim` returns `ClaimState` + best-effort sweep.
- `src/app/(app)/tasks/tasks-panel.tsx` — use `ClaimButton` for the claim case.
- `src/worker/index.ts` — add the sweep to the tick.

---

## Task 1: Schema column + migration + unclaim reset

**Files:** Modify `src/db/schema.ts`, `src/tasks/claim.ts`, `src/tasks/claim.test.ts`; generate `drizzle/0002_*.sql`.

**Interfaces:**
- Produces: `tasks.branchCreatedAt` (nullable `timestamp`, column `branch_created_at`). `unclaimTask` now also sets `branchCreatedAt: null`.

> The test DB builds itself by replaying every `drizzle/*.sql` migration (see `schemaSql()` in `src/db/migrate.ts`), so generating the migration is what makes the column exist in tests — no hand-edited SQL.

- [ ] **Step 1: Add the column** — in `src/db/schema.ts`, inside the `tasks` table definition, add after the `githubStatus` line:

```ts
  branchCreatedAt: timestamp("branch_created_at", { withTimezone: true }),
```

(`timestamp` is already imported in this file.)

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0002_*.sql` is created containing `ALTER TABLE "tasks" ADD COLUMN "branch_created_at" timestamp with time zone;`. Confirm the file exists:

Run: `ls drizzle/*.sql` → shows `0000_…`, `0001_…`, and the new `0002_…`.

- [ ] **Step 3: Write the failing test** — append to `src/tasks/claim.test.ts`:

```ts
test("unclaimTask resets branchCreatedAt to null", async () => {
  const { db, close } = await createTestDb();
  try {
    const u = await db.insert(users).values({ githubId: 1, login: "alice" }).returning({ id: users.id });
    const [req] = await db
      .insert(requirements)
      .values({ key: "REQ-001", title: "t", description: "d", provenance: "imported" })
      .returning({ id: requirements.id });
    const [task] = await db
      .insert(tasks)
      .values({ key: "TASK-001", title: "a", body: "b", requirementId: req.id, effort: 1, risk: "low", confidence: 50 })
      .returning({ id: tasks.id });

    await claimTask(db, task.id, u[0].id);
    // simulate the branch having been created
    await db.update(tasks).set({ branchCreatedAt: new Date() }).where(eq(tasks.id, task.id));

    await unclaimTask(db, task.id, u[0].id);

    const [t] = await db.select({ b: tasks.branchCreatedAt }).from(tasks).where(eq(tasks.id, task.id));
    assert.equal(t.b, null);
  } finally {
    await close();
  }
});
```

> Match the existing imports at the top of `claim.test.ts`. If `users`, `requirements`, `eq`, or `assert` aren't already imported there, add them (`users`/`requirements` from `../db/schema`, `eq` from `drizzle-orm`, `assert` from `node:assert/strict`). Read the file's existing header before adding.

- [ ] **Step 4: Run it (fails)**

Run: `npx tsx --test src/tasks/claim.test.ts`
Expected: the new test FAILS — `branchCreatedAt` is still set after unclaim.

- [ ] **Step 5: Reset it in `unclaimTask`** — in `src/tasks/claim.ts`, in `unclaimTask`'s `.set({...})`, add `branchCreatedAt: null`:

```ts
      .set({ claimState: "unclaimed", claimUserId: null, branchName: null, branchCreatedAt: null, updatedAt: new Date() })
```

- [ ] **Step 6: Run it (passes)**

Run: `npx tsx --test src/tasks/claim.test.ts` → all pass. `npm run typecheck` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts drizzle/ src/tasks/claim.ts src/tasks/claim.test.ts
git commit -m "[TASK-040] tasks.branch_created_at sentinel; unclaim resets it (REQ-010)"
```

---

## Task 2: Branch creation primitive + sweep

**Files:** Create `src/github/branches.ts`, `src/github/branches.test.ts`; Modify `package.json`.

**Interfaces:**
- Consumes: `getInstallationOctokit` (`./app`); `project`, `tasks` (`../db/schema`); `Db`.
- Produces:
  - `GitRefClient` (interface) — the octokit slice used.
  - `createBranch(installationId: number, repoFullName: string, branchName: string, baseBranch: string, client?: GitRefClient): Promise<{ created: boolean }>` — idempotent (422 → `created:false`).
  - `CreateBranchFn` = `(installationId: number, repoFullName: string, branchName: string, baseBranch: string) => Promise<{ created: boolean }>`.
  - `createBranchesForClaimedTasks(db: Db, createBranchFn?: CreateBranchFn): Promise<{ created: string[] }>`.

- [ ] **Step 1: Write the failing tests** — `src/github/branches.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { project, tasks, requirements } from "../db/schema";
import { createBranch, createBranchesForClaimedTasks, type GitRefClient, type CreateBranchFn } from "./branches";

const okClient: GitRefClient = {
  rest: {
    git: {
      getRef: async () => ({ data: { object: { sha: "basesha" } } }),
      createRef: async () => ({}),
    },
  },
};

test("createBranch returns created:true on a fresh ref", async () => {
  assert.deepEqual(await createBranch(1, "o/r", "task-001-x", "main", okClient), { created: true });
});

test("createBranch is idempotent: a 422 (ref exists) returns created:false", async () => {
  const client: GitRefClient = {
    rest: {
      git: {
        getRef: async () => ({ data: { object: { sha: "s" } } }),
        createRef: async () => {
          throw Object.assign(new Error("Reference already exists"), { status: 422 });
        },
      },
    },
  };
  assert.deepEqual(await createBranch(1, "o/r", "task-001-x", "main", client), { created: false });
});

test("createBranch rethrows non-422 errors", async () => {
  const client: GitRefClient = {
    rest: {
      git: {
        getRef: async () => ({ data: { object: { sha: "s" } } }),
        createRef: async () => {
          throw Object.assign(new Error("boom"), { status: 500 });
        },
      },
    },
  };
  await assert.rejects(() => createBranch(1, "o/r", "b", "main", client), /boom/);
});

async function seed(db: Awaited<ReturnType<typeof createTestDb>>["db"]) {
  await db.insert(project).values({
    repoFullName: "o/r", installationId: 1, defaultBranch: "main",
    localClonePath: "/tmp", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
  });
  const [req] = await db
    .insert(requirements)
    .values({ key: "REQ-001", title: "t", description: "d", provenance: "imported" })
    .returning({ id: requirements.id });
  return req.id;
}

test("createBranchesForClaimedTasks branches claimed+unbranched tasks, sets the timestamp, skips the rest", async () => {
  const { db, close } = await createTestDb();
  try {
    const reqId = await seed(db);
    await db.insert(tasks).values({ key: "TASK-001", title: "a", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, claimState: "claimed", branchName: "task-001-a" });
    await db.insert(tasks).values({ key: "TASK-002", title: "b", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, claimState: "claimed", branchName: "task-002-b", branchCreatedAt: new Date() });
    await db.insert(tasks).values({ key: "TASK-003", title: "c", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, claimState: "unclaimed" });

    const calls: string[] = [];
    const fake: CreateBranchFn = async (_i, _r, branch) => { calls.push(branch); return { created: true }; };
    const { created } = await createBranchesForClaimedTasks(db, fake);

    assert.deepEqual(created, ["TASK-001"]);
    assert.deepEqual(calls, ["task-001-a"]);
    const [t1] = await db.select({ b: tasks.branchCreatedAt }).from(tasks).where(eq(tasks.key, "TASK-001"));
    assert.ok(t1.b instanceof Date);
  } finally {
    await close();
  }
});

test("createBranchesForClaimedTasks leaves branchCreatedAt null when creation throws (retried next sweep)", async () => {
  const { db, close } = await createTestDb();
  try {
    const reqId = await seed(db);
    await db.insert(tasks).values({ key: "TASK-001", title: "a", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, claimState: "claimed", branchName: "task-001-a" });
    const failing: CreateBranchFn = async () => { throw new Error("github down"); };
    await assert.rejects(() => createBranchesForClaimedTasks(db, failing), /github down/);
    const [t1] = await db.select({ b: tasks.branchCreatedAt }).from(tasks).where(eq(tasks.key, "TASK-001"));
    assert.equal(t1.b, null);
  } finally {
    await close();
  }
});

test("createBranchesForClaimedTasks throws when no project is bound", async () => {
  const { db, close } = await createTestDb();
  try {
    await assert.rejects(() => createBranchesForClaimedTasks(db, okClient as unknown as CreateBranchFn), /No project bound/);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Append the test to `package.json` and run it (fails)**

Add ` src/github/branches.test.ts` to the `test` script list. Run: `npx tsx --test src/github/branches.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** `src/github/branches.ts`:

```ts
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { tasks, project } from "../db/schema";
import { getInstallationOctokit } from "./app";

// The slice of the octokit git API we use — typed so domain code needs no `any`
// and tests can supply an honest fake.
export interface GitRefClient {
  rest: {
    git: {
      getRef: (p: { owner: string; repo: string; ref: string }) => Promise<{ data: { object: { sha: string } } }>;
      createRef: (p: { owner: string; repo: string; ref: string; sha: string }) => Promise<unknown>;
    };
  };
}

export type CreateBranchFn = (
  installationId: number,
  repoFullName: string,
  branchName: string,
  baseBranch: string,
) => Promise<{ created: boolean }>;

/**
 * Create refs/heads/<branchName> at the base branch's HEAD, via the App
 * (REQ-011 branch convention). Idempotent: an existing ref (GitHub 422) resolves
 * to { created: false }. Any other error throws so the caller can retry.
 */
export async function createBranch(
  installationId: number,
  repoFullName: string,
  branchName: string,
  baseBranch: string,
  client?: GitRefClient,
): Promise<{ created: boolean }> {
  const [owner, repo] = repoFullName.split("/");
  const kit = client ?? ((await getInstallationOctokit(installationId)) as unknown as GitRefClient);
  const base = await kit.rest.git.getRef({ owner, repo, ref: `heads/${baseBranch}` });
  try {
    await kit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branchName}`, sha: base.data.object.sha });
    return { created: true };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 422) return { created: false }; // ref already exists — idempotent
    throw e;
  }
}

/**
 * Ensure a branch exists for every claimed task that doesn't have one yet
 * (branch_created_at IS NULL), from the project's default branch. Mirrors
 * createIssuesForTasks: idempotent, runs OUTSIDE any DB transaction (external
 * call). Stores branch_created_at as the "exists" sentinel — never github_status.
 */
export async function createBranchesForClaimedTasks(
  db: Db,
  createBranchFn: CreateBranchFn = createBranch,
): Promise<{ created: string[] }> {
  const [proj] = await db.select().from(project).limit(1);
  if (!proj) throw new Error("No project bound (REQ-002).");

  const pending = await db
    .select({ id: tasks.id, key: tasks.key, branchName: tasks.branchName })
    .from(tasks)
    .where(and(eq(tasks.claimState, "claimed"), isNull(tasks.branchCreatedAt), isNotNull(tasks.branchName)));

  const created: string[] = [];
  for (const t of pending) {
    if (!t.branchName) continue; // narrow; WHERE already excludes nulls
    await createBranchFn(proj.installationId, proj.repoFullName, t.branchName, proj.defaultBranch);
    await db.update(tasks).set({ branchCreatedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, t.id));
    created.push(t.key);
  }
  return { created };
}
```

- [ ] **Step 4: Run the tests (pass) + typecheck**

Run: `npx tsx --test src/github/branches.test.ts` → PASS (5 tests). `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/github/branches.ts src/github/branches.test.ts package.json
git commit -m "[TASK-040] createBranch + createBranchesForClaimedTasks sweep (REQ-011)"
```

---

## Task 3: Claim action returns status + Claim button

**Files:** Modify `src/app/(app)/tasks/actions.ts`, `src/app/(app)/tasks/tasks-panel.tsx`; Create `src/app/(app)/tasks/claim-button.tsx`.

**Interfaces:**
- Consumes: `claimTask`/`unclaimTask` (`@/tasks/claim`); `createBranchesForClaimedTasks` (`@/github/branches`); `auth`, `getDb`, `tasks`.
- Produces: `ClaimState = { ok: true; branchCreated: boolean } | { ok: false; error: string } | null`; `claim(prev: ClaimState, formData: FormData): Promise<ClaimState>`; `ClaimButton({ taskId }: { taskId: string })`.

> `claim` changes from `(formData)` to `(prev, formData)` so it can drive `useActionState`. After this task the panel calls `claim` only via `ClaimButton`; `unclaim` stays a plain form action (no status surface needed).

- [ ] **Step 1: Rewrite the `claim` action** — replace the `claim` function in `src/app/(app)/tasks/actions.ts` (leave `unclaim` unchanged) and add the imports:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { claimTask, unclaimTask } from "@/tasks/claim";
import { createBranchesForClaimedTasks } from "@/github/branches";

export type ClaimState =
  | { ok: true; branchCreated: boolean }
  | { ok: false; error: string }
  | null;

export async function claim(_prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const taskId = String(formData.get("taskId"));
  const db = getDb();

  const result = await claimTask(db, taskId, session.user.id);
  if (result.claimed) {
    // External, best-effort (after the claim tx); the worker sweep retries failures.
    try {
      await createBranchesForClaimedTasks(db);
    } catch {
      // claim holds regardless; leave branch_created_at null for the next sweep.
    }
  }

  revalidatePath("/tasks");
  revalidatePath("/dashboard");

  // Reflect THIS task's branch state (not the sweep's whole key list).
  const [t] = await db.select({ branchCreatedAt: tasks.branchCreatedAt }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return { ok: true, branchCreated: Boolean(t?.branchCreatedAt) };
}
```

(Keep the existing `unclaim(formData)` function below, untouched.)

- [ ] **Step 2: Create the client button** — `src/app/(app)/tasks/claim-button.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { claim, type ClaimState } from "./actions";
import { buttonClass } from "@/components/ui";

export function ClaimButton({ taskId }: { taskId: string }) {
  const [state, action, pending] = useActionState<ClaimState, FormData>(claim, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      <button type="submit" disabled={pending} className={buttonClass("primary")}>
        {pending ? "Claiming…" : "Claim"}
      </button>
      {state?.ok === true && !state.branchCreated && (
        <span className="text-xs text-risk">claimed · branch not created — it&apos;ll retry</span>
      )}
      {state?.ok === false && <span className="text-xs text-risk">{state.error}</span>}
    </form>
  );
}
```

- [ ] **Step 3: Wire it into the panel** — in `src/app/(app)/tasks/tasks-panel.tsx`: change the import line `import { claim, unclaim } from "./actions";` to `import { unclaim } from "./actions";`, add `import { ClaimButton } from "./claim-button";`, and replace the claim `<form>` block (the `session?.user?.id ?` branch) with:

```tsx
                  ) : session?.user?.id ? (
                    <ClaimButton taskId={t.id} />
                  ) : (
```

(leave the `claimed` branch with its `unclaim` form, and the signed-out `<span>`, unchanged).

- [ ] **Step 4: Build + typecheck**

Run: `npm run build` then `npm run typecheck` → both clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/tasks/actions.ts" "src/app/(app)/tasks/claim-button.tsx" "src/app/(app)/tasks/tasks-panel.tsx"
git commit -m "[TASK-040] claim action creates branch best-effort + ClaimButton warning (REQ-010)"
```

---

## Task 4: Worker sweep + verify

**Files:** Modify `src/worker/index.ts`.

**Interfaces:** Consumes `createBranchesForClaimedTasks` (`../github/branches`).

- [ ] **Step 1: Add the sweep to the tick** — in `src/worker/index.ts`, add the import `import { createBranchesForClaimedTasks } from "../github/branches";` and, in `tick`, right after the `createIssuesForTasks` try/catch block, add:

```ts
  // Create branches for any claimed task that doesn't have one yet (REQ-011).
  try {
    const { created } = await createBranchesForClaimedTasks(db);
    if (created.length) console.error(`[worker] created ${created.length} branch(es): ${created.join(", ")}`);
  } catch (e) {
    console.error("[worker] branch creation skipped:", e instanceof Error ? e.message : e);
  }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` → clean.

- [ ] **Step 3: Commit**

```bash
git add src/worker/index.ts
git commit -m "[TASK-040] worker tick ensures branches for claimed tasks (REQ-011)"
```

- [ ] **Step 4: Full suite** — stop any `:3000` server, then `npm test` → all pass (existing + the new `branches.test.ts` and the new `claim.test.ts` case).

- [ ] **Step 5: Build** — `npm run build` → succeeds.

- [ ] **Step 6: Runtime verification (controller + user)** — rebuild + restart the prod server. On `/tasks` (or the Tasks drawer): claim a task → the button shows "Claiming…", then the row flips to "Claimed by you" with the branch name; the branch `task-<key>-<slug>` appears on `orbit`. Unclaim → the row returns to "Claim"; the branch **remains** on `orbit`. Re-claim → no error (idempotent). If a claim ever shows "branch not created — it'll retry", confirm the worker (or a later claim) creates it.

- [ ] **Step 7: Hand off** — report; ready for finishing-a-development-branch.

---

## Self-Review

**Spec coverage:** `branch_created_at` sentinel + unclaim reset → Task 1; `createBranch` (idempotent) + `createBranchesForClaimedTasks` sweep → Task 2; claim action best-effort + `ClaimState` warning + `ClaimButton` → Task 3; worker auto-retry sweep → Task 4; runtime claim/unclaim/reclaim against `orbit` → Task 4 Step 6. Truth-model constraints honored: branch creation is after the claim tx and try/caught (Task 3) and in the worker (Task 4); no new event; `github_status` untouched; `branch_created_at` written only by the sweep.

**Placeholder scan:** every code/test step is complete; run steps carry commands + expected results. No TBD.

**Type consistency:** `createBranch(installationId, repoFullName, branchName, baseBranch, client?) → { created: boolean }`; `CreateBranchFn` is the 4-arg shape (the optional `client` makes `createBranch` assignable to it as the default); `createBranchesForClaimedTasks(db, createBranchFn?) → { created: string[] }`; `ClaimState`/`claim(prev, formData)` match `useActionState<ClaimState, FormData>`; `ClaimButton({ taskId })` consumed in the panel with `taskId={t.id}`. `tasks.branchCreatedAt` (camel) ↔ `branch_created_at` (column) used consistently; `unclaimTask` resets it. The sweep mirrors `createIssuesForTasks`'s signature/behavior (injectable fn default, throws on no project, runs outside a tx).
