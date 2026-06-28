# Tasks visible only after their GitHub issue exists — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A generated task is shown in the UI only once it has a GitHub issue (`github_issue_number IS NOT NULL`); the generate button auto-reveals each task the moment its issue exists.

**Architecture:** A read-side visibility filter on the two task-list queries (`listTasks` → `/tasks` board + dashboard counts; `getRequirementDetail` → spec detail/drawer + the generate result). Issue creation stays in the worker, unchanged. The generate action returns the just-generated keys; `SpecGenerate` polls a thin server action and reveals tasks as their issues land. No events, no schema, no migration — `github_issue_number` is already written only by the issue-creation path.

**Tech Stack:** TypeScript, Next.js App Router (React 19 server actions + client `useEffect` poll), Drizzle ORM, Postgres / PGlite (tests), `node:test` via `tsx --test`.

Design doc: `docs/superpowers/specs/2026-06-26-tasks-visible-after-issue-design.md`. Requirement: **REQ-009** (refinement, no new REQ). Task: **TASK-075**, branch `task-075-tasks-visible-after-issue` (already created; the design-doc commit is on it).

## Global Constraints

(From `CLAUDE.md` and the design. Every task implicitly includes these.)

- **No `any` in domain code.**
- **`tasks.github_status` is webhook-only** — not touched here. `github_issue_number` stays written only by the issue-creation path (`src/github/issues.ts`).
- **Read-only change:** no new/changed events, no schema, no migration. Generation and issue-creation logic are unchanged.
- **The visibility rule:** a task is visible iff `github_issue_number IS NOT NULL`. Apply it to ALL task-row browse queries: `getRequirementDetail`, `listTasks`, `listPipeline` (`src/pipeline/queries.ts` — reads task rows directly), and `listQuickWins` (`src/metrics/quickwins.ts` — also reads task rows directly). Do **NOT** filter: `reconcileRequirementStatus` (`src/requirements/lifecycle.ts` — status derives from all tasks), event-derived views (burn-up, heartbeat, Pulse, narrative — they read the event log), or `createIssuesForTasks` (it needs the issue-less tasks).
- **Dashboard counts** are covered automatically: `src/app/(app)/dashboard/page.tsx` sources tasks from `listTasks(db, pid)` and feeds `taskBreakdown`; filtering `listTasks` filters those counts. The pipeline and quick-wins dashboard cards call `listPipeline`/`listQuickWins` directly, so each carries its own filter. **Do not change `src/dashboard/summarize.ts`** (its functions are pure over a passed-in list).
- **Tests are enumerated** in `package.json`'s `test` script (not globbed). The two test files touched here are already registered; no new file is added.
- **Branch** `task-075-tasks-visible-after-issue`; **commits** small; PR/squash starts with `[TASK-075]`.
- **Surface `[3]`** (the generate UI) serves the ledger design system — reuse existing primitives/tones (`buttonClass`, `Pill`, `text-ink-soft`, `text-graphite`, `text-risk`).

---

## File Structure

- **Modify** `src/spec/detail.ts` — add the visibility filter to `getRequirementDetail`'s task query.
- **Modify** `src/spec/detail.test.ts` — existing seeds gain `githubIssueNumber` (stay visible); add an exclusion test.
- **Modify** `src/tasks/queries.ts` — add the visibility filter to `listTasks`.
- **Modify** `src/tasks/queries.test.ts` — existing seeds gain `githubIssueNumber`; add an exclusion test.
- **Modify** `src/pipeline/queries.ts` — add the visibility filter to `listPipeline`'s task-row query.
- **Modify** `src/pipeline/queries.test.ts` — existing seeds gain `githubIssueNumber`; add an exclusion test.
- **Modify** `src/metrics/quickwins.ts` — add the visibility filter to `listQuickWins`.
- **Modify** `src/metrics/quickwins.test.ts` — existing seeds gain `githubIssueNumber`; add an exclusion test.
- **Modify** `src/app/(app)/spec/[key]/actions.ts` — `GenState` gains `generatedKeys`; add `pollRequirementTasks` server action.
- **Modify** `src/app/(app)/spec/spec-generate.tsx` — show "creating issues…" + poll + auto-reveal.

---

## Task 1: Visibility filter on `getRequirementDetail`

Hide issue-less tasks from the spec requirement detail (page, drawer, and the generate result's re-fetch).

**Files:**
- Modify: `src/spec/detail.ts`
- Modify (test): `src/spec/detail.test.ts`

**Interfaces:**
- Consumes: `tasks` schema (`githubIssueNumber` column), `isNotNull` from `drizzle-orm`.
- Produces: `getRequirementDetail(db, projectId, key)` now returns only tasks with `github_issue_number IS NOT NULL` (signature and `RequirementDetail` shape unchanged).

- [ ] **Step 1: Update the existing tests' seeds + add the failing exclusion test**

In `src/spec/detail.test.ts`:

(a) In the first test, the seeded task must stay visible — add `githubIssueNumber: 1` to its insert (it currently sets only `githubIssueUrl`):

```ts
    await db.insert(tasks).values({ key: "TASK-001", title: "a", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, githubIssueNumber: 1, githubIssueUrl: "http://x/1", projectId: proj.id });
```

Then, still in the first test, after the existing assertions (before the `finally`), add a new issue-less task and assert it is excluded:

```ts
    // A task with no GitHub issue yet is NOT visible (REQ-009 refinement).
    await db.insert(tasks).values({ key: "TASK-002", title: "pending", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: proj.id });
    const after = await getRequirementDetail(db, proj.id, "REQ-001");
    assert.deepEqual(after!.tasks.map((t) => t.key), ["TASK-001"], "issue-less TASK-002 is hidden");
```

(b) In the second test (project-scoping), both seeded tasks must stay visible — add `githubIssueNumber` to each insert:

```ts
    await db.insert(tasks).values({ key: "TASK-100", title: "p1 task", body: "b", requirementId: r1.id, effort: 1, risk: "low", confidence: 50, githubIssueNumber: 100, projectId: p1.id });
    await db.insert(tasks).values({ key: "TASK-200", title: "p2 task", body: "b", requirementId: r2.id, effort: 1, risk: "low", confidence: 50, githubIssueNumber: 200, projectId: p2.id });
```

- [ ] **Step 2: Run the tests to verify the exclusion assertion fails**

Run: `npx tsx --test src/spec/detail.test.ts`
Expected: FAIL — the new assertion sees `["TASK-001","TASK-002"]` (filter not applied yet) ≠ `["TASK-001"]`. (Known transient quirk: if the FIRST run dies with a V8/JIT crash and no assertion failure, re-run once.)

- [ ] **Step 3: Add the filter**

In `src/spec/detail.ts`, add `isNotNull` to the import and the predicate to the task query:

```ts
import { eq, asc, and, isNotNull } from "drizzle-orm";
```

```ts
  const taskRows = await db
    .select({ id: tasks.id, key: tasks.key, title: tasks.title, githubStatus: tasks.githubStatus, claimState: tasks.claimState, githubIssueUrl: tasks.githubIssueUrl })
    .from(tasks)
    // A task is visible only once its GitHub issue exists (REQ-009 refinement —
    // see docs/superpowers/specs/2026-06-26-tasks-visible-after-issue-design.md).
    .where(and(eq(tasks.requirementId, req.id), eq(tasks.projectId, projectId), isNotNull(tasks.githubIssueNumber)))
    .orderBy(asc(tasks.key));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/spec/detail.test.ts`
Expected: PASS — both tests green (issue-less TASK-002 excluded; the issue-having tasks present).

- [ ] **Step 5: Commit**

```bash
git add src/spec/detail.ts src/spec/detail.test.ts
git commit -m "[TASK-075] hide issue-less tasks from requirement detail (REQ-009)"
```

---

## Task 2: Visibility filter on `listTasks` (board + dashboard counts)

Hide issue-less tasks from the `/tasks` board. Because `dashboard/page.tsx` sources its tasks from `listTasks`, this also filters the dashboard task-count cards — with no change to `summarize.ts`.

**Files:**
- Modify: `src/tasks/queries.ts`
- Modify (test): `src/tasks/queries.test.ts`

**Interfaces:**
- Consumes: `tasks` schema (`githubIssueNumber`), `isNotNull` + `and` from `drizzle-orm`.
- Produces: `listTasks(db, projectId?)` returns only tasks with `github_issue_number IS NOT NULL` (signature/`TaskListItem` unchanged).

- [ ] **Step 1: Update the existing tests' seeds + add the failing exclusion test**

In `src/tasks/queries.test.ts`:

(a) First test ("returns all tasks when no projectId given") — the two seeded tasks must stay visible; add `githubIssueNumber`:

```ts
    await db.insert(tasks).values([
      { key: "TASK-001", title: "First", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 80, githubIssueNumber: 1, projectId: proj.id },
      { key: "TASK-002", title: "Second", body: "b", requirementId: r.id, effort: 2, risk: "med", confidence: 60, githubIssueNumber: 2, projectId: proj.id },
    ]);
```

Then add a third, issue-less task and assert the result still has length 2 (it is hidden):

```ts
    await db.insert(tasks).values({ key: "TASK-003", title: "Pending", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: proj.id });
    const result = await listTasks(db);
    assert.equal(result.length, 2, "issue-less TASK-003 is hidden");
    assert.equal(result[0].key, "TASK-001");
    assert.equal(result[1].key, "TASK-002");
```

(Replace the existing `const result = await listTasks(db);` + assertions block in that test with the above so there is a single `listTasks` call.)

(b) Second test (project-scoping) — both seeded tasks must stay visible; add `githubIssueNumber`:

```ts
    await db.insert(tasks).values([
      { key: "TASK-001", title: "Task A", body: "b", requirementId: rA.id, effort: 1, risk: "low", confidence: 80, githubIssueNumber: 1, projectId: projA.id },
      { key: "TASK-001", title: "Task B", body: "b", requirementId: rB.id, effort: 1, risk: "low", confidence: 80, githubIssueNumber: 2, projectId: projB.id },
    ]);
```

- [ ] **Step 2: Run the tests to verify the exclusion assertion fails**

Run: `npx tsx --test src/tasks/queries.test.ts`
Expected: FAIL — `result.length` is 3 (filter not applied yet) ≠ 2. (Transient first-run crash → re-run once.)

- [ ] **Step 3: Add the filter**

In `src/tasks/queries.ts`, add `isNotNull` to the import and combine it into the `where` (always applied; AND the projectId when given):

```ts
import { and, eq, asc, isNotNull } from "drizzle-orm";
```

```ts
    .leftJoin(users, eq(tasks.claimUserId, users.id))
    // A task is visible only once its GitHub issue exists (REQ-009 refinement).
    .where(projectId ? and(eq(tasks.projectId, projectId), isNotNull(tasks.githubIssueNumber)) : isNotNull(tasks.githubIssueNumber))
    .orderBy(asc(tasks.key));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/tasks/queries.test.ts`
Expected: PASS — both tests green (issue-less task hidden; scoping intact).

- [ ] **Step 5: Commit**

```bash
git add src/tasks/queries.ts src/tasks/queries.test.ts
git commit -m "[TASK-075] hide issue-less tasks from the task board + dashboard counts (REQ-009)"
```

---

## Task 3: Generate button auto-reveals tasks as their issues land

The generate action returns the just-generated keys; `SpecGenerate` shows "creating their GitHub issues…" and polls a thin server action, revealing each task (with claim) the moment its issue exists.

**Files:**
- Modify: `src/app/(app)/spec/[key]/actions.ts`
- Modify: `src/app/(app)/spec/spec-generate.tsx`

**Interfaces:**
- Consumes: `generateForRequirementKey` (returns `{ ok, failure?, taskKeys? }`), `getRequirementDetail` (now filtered, Task 1), `activeProjectId`, `auth`, `getDb`.
- Produces:
  - `type GenState = { ok: true; generatedKeys: string[]; tasks: GenTask[] } | { ok: false; error: string } | null`
  - `pollRequirementTasks(key: string): Promise<GenTask[]>` (server action; the requirement's currently-visible filtered tasks for the active project).

> Server action + client UI — per repo convention not unit-tested; the gate is `npm run typecheck` + `npm run build` + runtime smoke. The filtering logic it relies on is covered by Tasks 1–2.

- [ ] **Step 1: Update the generate action + add the poll action**

In `src/app/(app)/spec/[key]/actions.ts`, change the `GenState` type and the `generateTasksForRequirement` return, and add `pollRequirementTasks`.

Replace the `GenState` type:

```ts
export type GenState = { ok: true; generatedKeys: string[]; tasks: GenTask[] } | { ok: false; error: string } | null;
```

In `generateTasksForRequirement`, capture the generated keys and include them in the return. Replace the lines from `const r = await generateForRequirementKey(...)` through the final `return`:

```ts
  const r = await generateForRequirementKey(db, pid, key);
  if (!r.ok) return { ok: false, error: r.failure ?? "Generation failed." };

  // Issue creation (and previews) is the WORKER's job (REQ-009) — it would race the
  // worker if the action also opened issues. The just-generated tasks are issue-less
  // now, so they are NOT yet visible (getRequirementDetail filters them); the client
  // polls pollRequirementTasks and reveals each as its issue lands.
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
  return { ok: true, generatedKeys: r.taskKeys ?? [], tasks: genTasks };
```

Add the poll action at the end of the file:

```ts
// Poll the requirement's currently-VISIBLE tasks (those whose GitHub issue exists)
// for the generate button's auto-reveal (REQ-009). Read-only; project-scoped.
export async function pollRequirementTasks(key: string): Promise<GenTask[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  const db = getDb();
  const pid = await activeProjectId();
  const detail = await getRequirementDetail(db, pid, key);
  return (detail?.tasks ?? []).map((t) => ({ id: t.id, key: t.key, title: t.title, claimState: t.claimState }));
}
```

- [ ] **Step 2: Typecheck (the action change compiles before touching the UI)**

Run: `npm run typecheck`
Expected: FAIL — `src/app/(app)/spec/spec-generate.tsx` still reads `state.tasks.length` against the old type without `generatedKeys`; this is expected and fixed in Step 3. (If it unexpectedly passes, proceed.)

- [ ] **Step 3: Update `SpecGenerate` to poll + auto-reveal**

Replace the entire contents of `src/app/(app)/spec/spec-generate.tsx` with:

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";
import { generateTasksForRequirement, pollRequirementTasks, type GenState, type GenTask } from "./[key]/actions";
import { SpecClaimButton } from "./spec-claim-button";
import { buttonClass, Pill } from "@/components/ui";

export function SpecGenerate({ reqKey }: { reqKey: string }) {
  const [state, action, pending] = useActionState<GenState, FormData>(generateTasksForRequirement, null);
  const [visible, setVisible] = useState<GenTask[]>([]);

  // After a successful generate, poll for the requirement's visible tasks (those
  // whose GitHub issue the worker has created) and reveal them as they land.
  useEffect(() => {
    if (!state?.ok) return;
    setVisible(state.tasks);
    const expected = state.generatedKeys;
    let stopped = false;
    let polls = 0;
    const MAX_POLLS = 60; // ~3 min at 3s — then leave it to a refresh (trust the worker).

    async function tick() {
      if (stopped) return;
      const tasks = await pollRequirementTasks(reqKey);
      if (stopped) return;
      setVisible(tasks);
      polls += 1;
      const allVisible = expected.every((k) => tasks.some((t) => t.key === k));
      if (allVisible || polls >= MAX_POLLS) return;
      setTimeout(tick, 3000);
    }
    const first = setTimeout(tick, 3000);
    return () => {
      stopped = true;
      clearTimeout(first);
    };
  }, [state, reqKey]);

  const allVisible = state?.ok ? state.generatedKeys.every((k) => visible.some((t) => t.key === k)) : false;

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
          <p className="text-[13px] text-ink-soft">
            {allVisible
              ? `Generated ${state.generatedKeys.length} task(s) — claim what you'll work on:`
              : `Generated ${state.generatedKeys.length} task(s) — creating their GitHub issues… they'll appear as each is ready.`}
          </p>
          {visible.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2">
              {visible.map((t) => (
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
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both PASS — `/spec` compiles with the updated component and the new action.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/spec/[key]/actions.ts" "src/app/(app)/spec/spec-generate.tsx"
git commit -m "[TASK-075] generate button auto-reveals tasks as their issues land (REQ-009)"
```

---

## Task 4: Verify, review, finalize

Full verification and the merge handoff. No new code unless a check fails.

**Files:** none (verification + process).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS, 0 failures — the prior count (268) holds (no new test files; the modified `detail`/`queries` tests still pass, and the not-filtered carve-out is guarded by the existing `lifecycle`/metrics tests, whose issue-less seeds must still derive status/metrics correctly). Confirm `detail.test.ts` and `queries.test.ts` both ran.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both PASS.

- [ ] **Step 3: Event-integrity review**

Dispatch the `event-integrity-reviewer` agent over the branch diff. This is a read-only change (no events, schema, or `github_status`/state writes), so the review should confirm exactly that: no `emitEvent` added/changed, no migration, `github_issue_number` still written only by the issue-creation path, the filter doesn't touch `reconcileRequirementStatus` or event-derived reads, no `any`. Address any Critical/Important findings.

- [ ] **Step 4: Runtime smoke (signed-in browser)**

On the deploy or local `next dev`: open a requirement with no tasks, click **Generate tasks** → the result shows "creating their GitHub issues…" → within a worker tick the task(s) appear with claim controls (auto-revealed, no manual refresh). Separately confirm the `/tasks` board and dashboard counts don't show a task until its issue exists. (UI isn't unit-tested — this is the verification.)

- [ ] **Step 5: Finish the branch**

Use `superpowers:finishing-a-development-branch`. Squash-merge so `[TASK-075]` lands as one line on `main`.

- [ ] **Step 6: Deploy (after merge)**

**Web-only** — reads + a client poll; the worker is untouched (it already creates issues every tick). **No migration.** Fast-forward the deploy worktree and restart the Next web server (redeploy recipe in project memory). Record TASK-075 / REQ-009 in project memory.

---

## Self-Review

**1. Spec coverage** (design § → task):
- Visibility rule on `getRequirementDetail` (spec detail/drawer/generate) → Task 1.
- Visibility rule on `listTasks` (`/tasks` board) → Task 2.
- Visibility rule on `listPipeline` (pipeline dashboard card — task-row read, not event-derived) → final-review fix.
- Visibility rule on `listQuickWins` (quick-wins dashboard card — task-row read, not event-derived) → final-review fix.
- Dashboard task-count cards → Task 2 (covered via `listTasks`, the dashboard's source; `summarize.ts` correctly untouched).
- Carve-outs (requirement status from all tasks; event-derived history — burn-up, heartbeat, Pulse, narrative — untouched) → enforced by NOT changing `lifecycle.ts` or event-log reads, and guarded by their existing tests still passing (Task 4 Step 1).
- Generate auto-reveal (`generatedKeys`, `pollRequirementTasks`, poll UI) → Task 3.
- Truth model / no migration / web-only deploy → Global Constraints + Task 4.
- Testing (detail exclusion, board exclusion, project-scoping retained) → Tasks 1–2; verification → Task 4.

**2. Placeholder scan:** none — every code step carries full code and exact commands; no "TBD"/"handle errors"/"similar to".

**3. Type consistency:** `GenState` gains `generatedKeys: string[]` in Task 3 and `SpecGenerate` reads exactly that; `GenTask` (`{ id, key, title, claimState }`) is unchanged and shared by `generateTasksForRequirement`, `pollRequirementTasks`, and the component; `getRequirementDetail`'s signature/`RequirementDetail` shape are unchanged (only its row filter changes), so its other callers (`requirement-detail.tsx`, `generateRequirementDiagram`) keep compiling. The filter predicate (`isNotNull(tasks.githubIssueNumber)`) is identical in Tasks 1 and 2.
