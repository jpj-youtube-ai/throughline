# Claim tasks from the spec map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user claim tasks directly from the spec-map requirement detail, including freshly-generated tasks rendered inline (no manual refresh).

**Architecture:** Reuse the existing claim domain unchanged (`claimTask` → `task.claimed` in-tx → best-effort branch sweep). Extract a shared `claimAndBranch` helper used by the `/tasks` claim action and a new spec-scoped `claimFromSpec` action. Expose task `id` on the requirement detail, return the requirement's tasks from the generate action so they render inline, and add a compact claim control to both the static detail list and the inline post-generate list.

**Tech Stack:** TypeScript, Next.js (App Router, server actions + `useActionState`), Postgres + Drizzle, `node:test` + PGlite. UI follows the verdigris ledger design system.

**Design doc:** `docs/superpowers/specs/2026-06-25-claim-from-spec-map-design.md`

## Global Constraints

- **Requirement linkage:** every commit/PR is for **REQ-010** (Task board & claiming) — the claim capability, surfaced on the spec map. (Confirm REQ-010 vs the spec-map REQ during review; don't fold silently.)
- **Claim domain is unchanged.** Claiming MUST go through `claimTask` (atomic `unclaimed→claimed`, sets `claim_user_id` + `branch_name`, emits `task.claimed` **in the same transaction**). No new event types, no new claim logic.
- **Branch creation is best-effort, after the claim tx** (external call; REQ-011) — a failure leaves `branch_created_at` null for the next worker sweep. Never inside a DB transaction.
- **`github_status` stays webhook-only** (untouched here).
- **No `any` in domain code.**
- **Surface-layer styling** follows the existing ledger design system; use the `impeccable` / `ui-ux-pro-max` tooling for the claim control's look — compact (`buttonClass("quiet")`-weight), fitting the detail's ~13px density. Don't introduce a generic palette.
- **Conventions:** branch `task-065-claim-from-spec-map`; PR title + squash message start with `[TASK-065]`. (Confirm `TASK-065` is the next free id before opening the PR.)
- **Every commit message ends with the trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **New `*.test.ts` files MUST be registered in the enumerated `test` script in `package.json`** (not globbed).
- **UI components (React server/client) are not unit-tested in this repo** — verified by `typecheck` + `build` + the runtime walkthrough (Task 5). Only data/logic gets `node:test` coverage.

## Setup (before Task 1)

```bash
git switch -c task-065-claim-from-spec-map
```

---

## File Structure

- `src/spec/detail.ts` — add `id` to detail task rows (modify).
- `src/spec/detail.test.ts` — assert `id` present (modify; already registered).
- `src/tasks/claim-and-branch.ts` — shared `claimAndBranch` helper (create).
- `src/tasks/claim-and-branch.test.ts` — helper tests (create + register).
- `src/app/(app)/tasks/actions.ts` — refactor `claim` onto `claimAndBranch` (modify).
- `src/app/(app)/spec/[key]/actions.ts` — add `claimFromSpec`; `generateTasksForRequirement` returns tasks (modify).
- `src/app/(app)/spec/spec-claim-button.tsx` — compact claim control (create).
- `src/app/(app)/spec/requirement-detail.tsx` — claim control per unclaimed task (modify).
- `src/app/(app)/spec/spec-generate.tsx` — inline render returned tasks with claim (modify).

---

## Task 1: Expose task `id` on the requirement detail

**Files:**
- Modify: `src/spec/detail.ts` (the `tasks` field of `RequirementDetail` + the `taskRows` select)
- Modify: `src/spec/detail.test.ts` (already registered)

**Interfaces:**
- Produces: `RequirementDetail.tasks[].id: string`. Consumed by Tasks 3 and 4 (claim controls need the task id).

- [ ] **Step 1: Add a failing assertion**

In `src/spec/detail.test.ts`, in the first test ("returns the requirement with its tasks; null for unknown"), after the existing `assert.equal(detail!.tasks[0].key, "TASK-001");` line, add:

```ts
    assert.equal(typeof detail!.tasks[0].id, "string");
    assert.ok(detail!.tasks[0].id.length > 0, "task row carries its id");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/spec/detail.test.ts`
Expected: FAIL — `detail.tasks[0].id` is `undefined` (not selected yet).

- [ ] **Step 3: Add `id` to the type and the select**

In `src/spec/detail.ts`, change the `tasks` field of the `RequirementDetail` interface to include `id`:

```ts
  tasks: { id: string; key: string; title: string; githubStatus: "open" | "closed"; claimState: "unclaimed" | "claimed"; githubIssueUrl: string | null }[];
```

And add `id: tasks.id,` as the first selected column in the `taskRows` query:

```ts
  const taskRows = await db
    .select({ id: tasks.id, key: tasks.key, title: tasks.title, githubStatus: tasks.githubStatus, claimState: tasks.claimState, githubIssueUrl: tasks.githubIssueUrl })
    .from(tasks)
    .where(and(eq(tasks.requirementId, req.id), eq(tasks.projectId, projectId)))
    .orderBy(asc(tasks.key));
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx tsx --test src/spec/detail.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/spec/detail.ts src/spec/detail.test.ts
git commit -m "$(cat <<'EOF'
[TASK-065] expose task id on the requirement detail (REQ-010)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Shared `claimAndBranch` helper + `claimFromSpec` action

**Files:**
- Create: `src/tasks/claim-and-branch.ts`
- Create: `src/tasks/claim-and-branch.test.ts`
- Modify: `src/app/(app)/tasks/actions.ts` (refactor `claim` onto the helper)
- Modify: `src/app/(app)/spec/[key]/actions.ts` (add `claimFromSpec`)
- Modify: `package.json` (register the test)

**Interfaces:**
- Consumes: `claimTask` (`@/tasks/claim`), `createBranchesForClaimedTasks` (`@/github/branches`).
- Produces:
  - `claimAndBranch(db: Db, taskId: string, userId: string, branchSweep?: (db: Db, projectId?: string) => Promise<{ created: string[] }>): Promise<{ claimed: boolean; branchCreated: boolean }>`.
  - `claimFromSpec(_prev: ClaimState, formData: FormData): Promise<ClaimState>` (FormData carries `taskId` + `key`); reuses `ClaimState` from `@/app/(app)/tasks/actions`. Consumed by Tasks 3 and 4.

- [ ] **Step 1: Write the failing helper test**

Create `src/tasks/claim-and-branch.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { users, requirements, tasks, events, project } from "../db/schema";
import { claimAndBranch } from "./claim-and-branch";

async function seed(db: Db): Promise<{ taskId: string; userId: string }> {
  const [proj] = await db.insert(project).values({ repoFullName: "acme/repo", defaultBranch: "main", installationId: 1, localClonePath: "/x" }).returning({ id: project.id });
  const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
  const [req] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: proj.id }).returning({ id: requirements.id });
  const [task] = await db.insert(tasks).values({ key: "TASK-001", title: "Event log", body: "b", requirementId: req.id, effort: 1, risk: "low", confidence: 50, projectId: proj.id }).returning({ id: tasks.id });
  return { taskId: task.id, userId: u.id };
}

test("claimAndBranch claims an unclaimed task and emits task.claimed (branch sweep injected)", async () => {
  const { db, close } = await createTestDb();
  try {
    const { taskId, userId } = await seed(db);
    const sweepCalls: Array<string | undefined> = [];
    const r = await claimAndBranch(db, taskId, userId, async (_d, pid) => { sweepCalls.push(pid); return { created: [] }; });

    assert.equal(r.claimed, true);
    assert.equal(r.branchCreated, false, "injected no-op sweep leaves branch_created_at null");
    assert.equal(sweepCalls.length, 1, "branch sweep invoked once after the claim");
    const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    assert.equal(t.claimState, "claimed");
    assert.equal(t.claimUserId, userId);
    const claimed = await db.select().from(events).where(eq(events.type, "task.claimed"));
    assert.equal(claimed.length, 1);
  } finally {
    await close();
  }
});

test("claimAndBranch returns claimed:false for an already-claimed task and does not run the sweep", async () => {
  const { db, close } = await createTestDb();
  try {
    const { taskId, userId } = await seed(db);
    await claimAndBranch(db, taskId, userId, async () => ({ created: [] }));

    let called = false;
    const r = await claimAndBranch(db, taskId, userId, async () => { called = true; return { created: [] }; });
    assert.equal(r.claimed, false);
    assert.equal(called, false, "no sweep on a lost claim");
    assert.equal((await db.select().from(events).where(eq(events.type, "task.claimed"))).length, 1, "no second claim event");
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Register the test in `package.json`**

Append ` src/tasks/claim-and-branch.test.ts` to the `"test"` script list.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx tsx --test src/tasks/claim-and-branch.test.ts`
Expected: FAIL — `claimAndBranch` is not exported (module missing).

- [ ] **Step 4: Implement the helper**

Create `src/tasks/claim-and-branch.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { tasks } from "../db/schema";
import { claimTask } from "./claim";
import { createBranchesForClaimedTasks } from "../github/branches";

type BranchSweep = (db: Db, projectId?: string) => Promise<{ created: string[] }>;

/**
 * Claim a task and (best-effort) create its branch (REQ-010/011). Shared by the
 * /tasks claim action and the spec-map claimFromSpec action — the claim domain
 * (claimTask → task.claimed in-tx) is unchanged; only the callers' revalidation
 * differs. The branch sweep runs OUTSIDE the claim tx (external call); a failure
 * leaves branch_created_at null for the next worker sweep. `branchSweep` is
 * injectable for tests.
 */
export async function claimAndBranch(
  db: Db,
  taskId: string,
  userId: string,
  branchSweep: BranchSweep = createBranchesForClaimedTasks,
): Promise<{ claimed: boolean; branchCreated: boolean }> {
  const result = await claimTask(db, taskId, userId);
  if (!result.claimed) return { claimed: false, branchCreated: false };

  const [t0] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  try {
    await branchSweep(db, t0?.projectId ?? undefined);
  } catch {
    // claim holds regardless; leave branch_created_at null for the next sweep.
  }
  const [t] = await db.select({ branchCreatedAt: tasks.branchCreatedAt }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return { claimed: true, branchCreated: Boolean(t?.branchCreatedAt) };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx tsx --test src/tasks/claim-and-branch.test.ts`
Expected: PASS (both).

- [ ] **Step 6: Refactor the `/tasks` `claim` action onto the helper**

Replace the body of `src/app/(app)/tasks/actions.ts` with (this removes the now-unused `getTaskProjectId` and `createBranchesForClaimedTasks` import, and keeps `claim`'s behavior identical):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { claimTask, unclaimTask } from "@/tasks/claim";
import { claimAndBranch } from "@/tasks/claim-and-branch";

export type ClaimState =
  | { ok: true; branchCreated: boolean }
  | { ok: false; error: string }
  | null;

export async function claim(_prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const taskId = String(formData.get("taskId"));
  const db = getDb();

  const { claimed, branchCreated } = await claimAndBranch(db, taskId, session.user.id);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  if (!claimed) return { ok: false, error: "Task is already claimed." };
  return { ok: true, branchCreated };
}

export async function unclaim(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await unclaimTask(getDb(), String(formData.get("taskId")), session.user.id);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}
```

- [ ] **Step 7: Add `claimFromSpec` to the spec action file**

In `src/app/(app)/spec/[key]/actions.ts`, add the import and the action. Add near the other imports:

```ts
import { claimAndBranch } from "@/tasks/claim-and-branch";
import type { ClaimState } from "../../tasks/actions";
```

And append the action (export the re-used `ClaimState` type alias for the client component to import from here):

```ts
export type { ClaimState };

// Claim a task from the spec-map requirement detail (REQ-010). Same claim domain
// as the /tasks board (claimAndBranch); revalidates the spec routes so the detail
// reflects the new claim.
export async function claimFromSpec(_prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const taskId = String(formData.get("taskId"));
  const key = String(formData.get("key") ?? "");
  const db = getDb();

  const { claimed, branchCreated } = await claimAndBranch(db, taskId, session.user.id);
  revalidatePath("/spec");
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  if (key) revalidatePath(`/spec/${key}`);
  if (!claimed) return { ok: false, error: "Task is already claimed." };
  return { ok: true, branchCreated };
}
```

- [ ] **Step 8: Run the suite + typecheck**

Run: `npx tsx --test src/tasks/claim-and-branch.test.ts src/tasks/claim.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors (the `claim` action refactor + `claimFromSpec` compile; the spec action file still has its existing exports).

- [ ] **Step 9: Commit**

```bash
git add src/tasks/claim-and-branch.ts src/tasks/claim-and-branch.test.ts package.json "src/app/(app)/tasks/actions.ts" "src/app/(app)/spec/[key]/actions.ts"
git commit -m "$(cat <<'EOF'
[TASK-065] shared claimAndBranch helper + claimFromSpec action (REQ-010)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Claim control component + wire into the static detail list

**Files:**
- Create: `src/app/(app)/spec/spec-claim-button.tsx`
- Modify: `src/app/(app)/spec/requirement-detail.tsx`

**Interfaces:**
- Consumes: `claimFromSpec` + `ClaimState` (Task 2); `RequirementDetail.tasks[].id` (Task 1).
- Produces: `SpecClaimButton({ taskId, reqKey })` — consumed here and by Task 4.

> No unit test — React UI. Verified by `npm run typecheck` + `npm run build` + the runtime walkthrough in Task 5.

- [ ] **Step 1: Create the claim control**

Create `src/app/(app)/spec/spec-claim-button.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { claimFromSpec, type ClaimState } from "./[key]/actions";
import { buttonClass } from "@/components/ui";

export function SpecClaimButton({ taskId, reqKey }: { taskId: string; reqKey: string }) {
  const [state, action, pending] = useActionState<ClaimState, FormData>(claimFromSpec, null);

  if (state?.ok === true) {
    return (
      <span className="shrink-0 font-mono text-[11px] text-shipped">
        {state.branchCreated ? "claimed" : "claimed · branch retrying"}
      </span>
    );
  }

  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="key" value={reqKey} />
      <button type="submit" disabled={pending} className={buttonClass("quiet")}>
        {pending ? "Claiming…" : "Claim"}
      </button>
      {state?.ok === false && <span className="ml-2 text-[11px] text-risk">{state.error}</span>}
    </form>
  );
}
```

- [ ] **Step 2: Render the control in the static task list**

In `src/app/(app)/spec/requirement-detail.tsx`, import the control near the top:

```ts
import { SpecClaimButton } from "./spec-claim-button";
```

Then, in the task `<li>`, replace the claimed-pill line:

```tsx
                {t.claimState === "claimed" && <span className="shrink-0"><Pill tone="spine" dot={false}>claimed</Pill></span>}
```

with a claimed-pill-or-claim-control:

```tsx
                {t.claimState === "claimed" ? (
                  <span className="shrink-0"><Pill tone="spine" dot={false}>claimed</Pill></span>
                ) : (
                  <SpecClaimButton taskId={t.id} reqKey={r.key} />
                )}
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/spec/spec-claim-button.tsx" "src/app/(app)/spec/requirement-detail.tsx"
git commit -m "$(cat <<'EOF'
[TASK-065] claim control on the spec-map task list (REQ-010)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Generate returns tasks; render them inline with claim

**Files:**
- Modify: `src/app/(app)/spec/[key]/actions.ts` (`GenState` + `generateTasksForRequirement`)
- Modify: `src/app/(app)/spec/spec-generate.tsx` (inline render)

**Interfaces:**
- Consumes: `getRequirementDetail` (Task 1, now with `id` + `claimState`); `SpecClaimButton` (Task 3).
- Produces: `GenState = { ok: true; tasks: GenTask[] } | { ok: false; error: string } | null` where `GenTask = { id: string; key: string; title: string; claimState: "unclaimed" | "claimed" }`.

> No unit test — React UI + an auth-gated server action. The data it returns (detail tasks with `id`/`claimState`) is covered by Task 1's `detail.test.ts`; the flow is verified by the runtime walkthrough in Task 5.

- [ ] **Step 1: Change `GenState` and have the action return the requirement's tasks**

In `src/app/(app)/spec/[key]/actions.ts`, add `getRequirementDetail` to the imports (it's in `@/spec/detail`):

```ts
import { getRequirementDetail } from "@/spec/detail";
```

Replace the `GenState` type:

```ts
export interface GenTask {
  id: string;
  key: string;
  title: string;
  claimState: "unclaimed" | "claimed";
}
export type GenState = { ok: true; tasks: GenTask[] } | { ok: false; error: string } | null;
```

In `generateTasksForRequirement`, replace the success path (the `revalidatePath` block + the `return { ok: true, taskKeys: ... }`) with a re-fetch of the requirement's tasks:

```ts
  if (!r.ok) return { ok: false, error: r.failure ?? "Generation failed." };

  // Re-fetch the requirement's tasks (now persisted, with ids) so they render
  // inline with claim controls — the detail sits in an intercepted drawer that
  // doesn't re-render on revalidate, so we return the data directly.
  const detail = await getRequirementDetail(db, pid, key);
  const genTasks: GenTask[] = (detail?.tasks ?? []).map((t) => ({
    id: t.id,
    key: t.key,
    title: t.title,
    claimState: t.claimState,
  }));

  revalidatePath("/spec");
  revalidatePath("/dashboard");
  revalidatePath(`/spec/${key}`);
  return { ok: true, tasks: genTasks };
```

(Keep the existing comment block about issue creation being the worker's job.)

- [ ] **Step 2: Inline-render the returned tasks in `SpecGenerate`**

Replace `src/app/(app)/spec/spec-generate.tsx` with:

```tsx
"use client";

import { useActionState } from "react";
import { generateTasksForRequirement, type GenState } from "./[key]/actions";
import { SpecClaimButton } from "./spec-claim-button";
import { buttonClass, Pill } from "@/components/ui";

export function SpecGenerate({ reqKey }: { reqKey: string }) {
  const [state, action, pending] = useActionState<GenState, FormData>(generateTasksForRequirement, null);
  return (
    <div className="mt-3">
      <form action={action}>
        <input type="hidden" name="key" value={reqKey} />
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Generating…" : "Generate tasks"}
        </button>
        {state?.ok === false && <p className="mt-2 text-[13px] text-risk">{state.error}</p>}
        <p className="mt-1 text-[11px] text-graphite">Runs one generation pass against the bound repo and opens a GitHub issue per task.</p>
      </form>

      {state?.ok === true && (
        <div className="mt-3">
          <p className="text-[13px] text-shipped">Generated {state.tasks.length} task(s) — claim what you'll work on:</p>
          <ul className="mt-2 flex flex-col gap-2">
            {state.tasks.map((t) => (
              <li key={t.key} className="flex items-start gap-2 text-[13px]">
                <span className="shrink-0 font-mono text-spine-deep">{t.key}</span>
                <span className="min-w-0 flex-1 break-words text-ink">{t.title}</span>
                {t.claimState === "claimed" ? (
                  <span className="shrink-0"><Pill tone="spine" dot={false}>claimed</Pill></span>
                ) : (
                  <SpecClaimButton taskId={t.id} reqKey={reqKey} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck`
Expected: no errors (note `GenState` no longer has `taskKeys`; `SpecGenerate` is the only consumer and is updated here).
Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/spec/[key]/actions.ts" "src/app/(app)/spec/spec-generate.tsx"
git commit -m "$(cat <<'EOF'
[TASK-065] return generated tasks + render them inline with claim (REQ-010)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Verify, review, and open the PR

**Files:** none (verification + review + integration).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass (show output), including the new `claim-and-branch` tests and the extended `detail` test. (If a transient V8/JIT native crash appears on the first run on this Windows/Node 24 box, re-run once.)

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck` then `npm run build`
Expected: both clean.

- [ ] **Step 3: Polish the claim control (impeccable / ui-ux-pro-max)**

Use the `impeccable` (e.g. `/impeccable polish` or `critique`) and/or `ui-ux-pro-max` tooling to refine `SpecClaimButton` and the two task-row layouts so the claim affordance sits cleanly in the ledger aesthetic at the detail's density (alignment, spacing, the claimed/branch-retry states). Keep it within the existing design system — don't swap palettes or restyle established primitives. Re-run typecheck/build after any change.

- [ ] **Step 4: Event-integrity review**

Dispatch the `event-integrity-reviewer` agent on the diff. It must confirm: claiming still goes through `claimTask` (atomic, emits `task.claimed` in one tx); no new event types or claim logic; the branch sweep stays best-effort outside the tx; `github_status` untouched; no `any` in domain code; maps to REQ-010. Address findings (apply `receiving-code-review` rigor), re-running the suite after changes.

- [ ] **Step 5: Runtime walkthrough**

In a signed-in browser on the live (or local) deploy: open a requirement with no tasks on the spec map → **Generate tasks** → confirm the new tasks appear **inline** (no manual refresh), each with a **Claim** button → claim one → it shows "claimed" (and the task gets its branch / "branch retrying"). Re-open the requirement and confirm the static list also shows Claim on remaining unclaimed tasks and the "claimed" pill on the claimed one. Confirm a second claim attempt on an already-claimed task reports "already claimed".

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin task-065-claim-from-spec-map
gh pr create --title "[TASK-065] claim tasks from the spec map (REQ-010)" --body "…"
```

PR body: summarize the inline-after-generate claim flow + the shared `claimAndBranch` helper + `claimFromSpec`; note it reuses the claim domain unchanged (no new events/schema); link the design doc. Squash-merge so `[TASK-065]` lands as one line on `main`. No migration (no schema change).

---

## Self-Review

**Spec coverage** (against `2026-06-25-claim-from-spec-map-design.md`):
- §1 Expose task ids → Task 1. ✔
- §2 Generate action returns claimable tasks → Task 4. ✔
- §3 Shared claim logic + spec-scoped action (reuse `claimTask`, extract `claimAndBranch`, refactor `/tasks` claim, add `claimFromSpec`) → Task 2. ✔
- §4 Where it renders (static list + inline) → Tasks 3 + 4; claim control component → Task 3. ✔
- §5 Styling (impeccable / ui-ux-pro-max) → Task 5 Step 3. ✔
- Truth model (claimTask unchanged, `task.claimed` in-tx, branch best-effort outside tx, github_status untouched) → Global Constraints + Task 2 + Task 5 Step 4. ✔
- Error handling (lost race, branch retry, generate failure) → Tasks 2 (action) + 3 (control states). ✔
- Testing (detail id, claimAndBranch, UI at runtime) → Tasks 1, 2, 5. ✔
- Out of scope (no claim-all, no unclaim from map, no claim-mechanism change, persist return unchanged) → respected. ✔
- REQ-010 linkage → Global Constraints + Task 5 Step 4. ✔

**Placeholder scan:** the only `…` is in the `gh pr create` body — intentional. No TBD/TODO.

**Type consistency:** `claimAndBranch(db, taskId, userId, branchSweep?)` returns `{ claimed, branchCreated }` — same signature where defined (Task 2) and consumed (the `claim` + `claimFromSpec` actions). `ClaimState` is defined once in `tasks/actions.ts`, re-exported from `spec/[key]/actions.ts`, and imported by `SpecClaimButton`. `GenState`/`GenTask` (Task 4) match what `SpecGenerate` consumes. `SpecClaimButton({ taskId, reqKey })` props match both call sites (Task 3 static list, Task 4 inline). `RequirementDetail.tasks[].id` (Task 1) is what the claim controls read.
