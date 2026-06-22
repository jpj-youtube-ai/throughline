# Multi-project Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope every read/list query to the signed-in user's active project, so the board shows only that project's data — the visible "switch projects" behavior.

**Architecture:** Each read query gains a `projectId` parameter and filters its rows by `project_id`; a new server-only `activeProjectId()` helper resolves the signed-in user's active project; every page/panel resolves it and passes it down. Queries take `projectId?` (optional, filters when given) while areas are migrated so the build stays green, then a final task makes it required. Reads only — operations/worker + switcher are Phase C.

**Tech Stack:** Next.js 16 App Router (server components, `auth()`), Drizzle/Postgres, Node `tsx --test` + PGlite.

## Global Constraints

- **TypeScript; no `any`.** Reads only — **no writes, events, or `github_status` touched**; no operation/worker file changed (those `select().from(project).limit(1)` sites are Phase C).
- Every scoped query filters rows by `eq(<table>.projectId, projectId)` (for events-derived reads, `events.projectId`; for drift, join `drift_flags → tasks` and filter `tasks.projectId`).
- The active project is resolved via the existing `getActiveProjectId(db, userId)` (Phase A). The page helper `activeProjectId()` lives in a **separate server-only file** (`src/project/current.ts`), NOT in `active.ts` (keeps `active.ts`'s pure unit tests free of `@/auth`).
- **No behavior change with one project** — `activeProjectId()` resolves the sole project, so every view shows orbit exactly as today. Correctness is proven by **two-project isolation tests**.
- Each scoping task keeps the build green by adding `projectId` as **optional** (filter only when provided) and wiring its own pages; the final task makes it **required**.
- **Commits start with `[TASK-046]`**, REQ-029, on branch `task-046-multiproject-phase-b`.

---

## File Structure

**New**
- `src/project/current.ts` — `activeProjectId()` server-only helper.

**Modified — read queries (add `projectId` + `WHERE project_id`):**
- `src/spec/map.ts` (`listSpecMap`), `src/spec/detail.ts` (`getRequirementDetail`), `src/spec/read.ts` (`readSpec`)
- `src/tasks/queries.ts` (`listTasks`), `src/pipeline/queries.ts` (`listPipeline`), `src/metrics/quickwins.ts` (`listQuickWins`)
- `src/ideas/queries.ts` (`listVotingIdeas`, `listScratchIdeas`), `src/events/feed.ts` (`listActivity`), drift read (`listOpenDriftFlags`)
- `src/metrics/heartbeat.ts` (`heartbeatSeries`), `src/metrics/burnup.ts` (`burnUpSeries`), `src/digest/queries.ts` (`digestSummary`, `recentDigests`), narrative read, `src/dashboard/summarize.ts` (pass-through)

**Modified — pages/panels (resolve `activeProjectId()` + pass):**
- `src/app/(app)/dashboard/page.tsx`, `drift/drift-panel.tsx`, `ideas/ideas-panel.tsx`, `pipeline/pipeline-panel.tsx`, `pulse/pulse-panel.tsx`, `quick-wins/quick-wins-panel.tsx`, `spec/page.tsx`, `spec/requirement-detail.tsx`, `spec/spec-document.tsx`, `tasks/tasks-panel.tsx`, plus any heartbeat/burnup/narrative/digest panel that calls a scoped query (grep the fn names).

**Modified — guard:** `src/genesis/import.ts` (per-project refuse).

---

## Task 1: `activeProjectId()` page helper

**Files:** Create `src/project/current.ts`.

**Interfaces:** Produces `activeProjectId(): Promise<string>` (server-only).

- [ ] **Step 1: Implement** `src/project/current.ts`:

```ts
// Server-only: the signed-in user's active project for a page/panel (multi-project).
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { getActiveProjectId } from "./active";

export async function activeProjectId(): Promise<string> {
  const session = await auth();
  return getActiveProjectId(getDb(), session?.user?.id ?? null);
}
```

- [ ] **Step 2: Typecheck + build** — `npm run typecheck` clean; `npm run build` succeeds (the helper compiles; `@/auth` is server-only and this is only imported by server components).

> No unit test — it's an `auth()` wrapper; `getActiveProjectId` is already unit-tested in `active.test.ts`, and this is exercised by build + the runtime check in Task 6.

- [ ] **Step 3: Commit** `git add src/project/current.ts && git commit -m "[TASK-046] activeProjectId() page helper (REQ-029)"`

---

## Task 2: Scope the spec reads + wire spec pages

**Files:** Modify `src/spec/map.ts`, `src/spec/detail.ts`, `src/spec/read.ts`; their tests; `src/app/(app)/spec/page.tsx`, `spec/requirement-detail.tsx`, `spec/spec-document.tsx`, `@drawer/(.)spec/[key]/page.tsx`.

**Interfaces:**
- `listSpecMap(db, projectId?: string)` — filters `requirements.projectId` when given.
- `getRequirementDetail(db, projectId: string, key: string)` — **required** projectId (key alone is ambiguous); filters by both.
- `readSpec(db, projectId?: string)`.

- [ ] **Step 1: Worked example — `listSpecMap`.** In `src/spec/map.ts`, change the signature and add the filter:

```ts
import { eq, asc } from "drizzle-orm"; // ensure eq imported
export async function listSpecMap(db: Db, projectId?: string): Promise<SpecMapRequirement[]> {
  const rows = await db
    .select(/* existing columns */)
    .from(requirements)
    .where(projectId ? eq(requirements.projectId, projectId) : undefined)
    .orderBy(/* existing */);
  // …rest unchanged (tasks join etc. — if tasks are fetched, also filter by projectId)
}
```

(If `listSpecMap` also reads tasks per requirement, filter those by `projectId` too. Keep the return shape identical.)

- [ ] **Step 2: `getRequirementDetail`** — `getRequirementDetail(db, projectId: string, key: string)`: the requirement lookup becomes `where(and(eq(requirements.projectId, projectId), eq(requirements.key, key)))`; its tasks filter by `projectId` as well.

- [ ] **Step 3: `readSpec`** — `readSpec(db, projectId?: string)`: scope the project/spec lookup it does to `projectId` when given (it currently `select().from(project).limit(1)` — when `projectId` given, select that project).

- [ ] **Step 4: Tests** — extend `src/spec/map.test.ts`, `src/spec/detail.test.ts`, `src/spec/read.test.ts`: seed **two** projects with rows; assert `listSpecMap(db, p1)` returns only p1's requirements; `getRequirementDetail(db, p1, "REQ-001")` returns p1's, and `getRequirementDetail(db, p2, "REQ-001")` returns p2's (same key, different project); `readSpec(db, p1)` is p1's. Run → PASS.

- [ ] **Step 5: Wire spec pages** — in each, resolve and pass `pid`:
  - `spec/page.tsx`: `const pid = await activeProjectId(); const reqs = await listSpecMap(getDb(), pid);`
  - `spec/requirement-detail.tsx`: `const pid = await activeProjectId(); const r = await getRequirementDetail(getDb(), pid, reqKey);`
  - `spec/spec-document.tsx`: `const pid = await activeProjectId(); const doc = await readSpec(getDb(), pid);`
  - `@drawer/(.)spec/[key]/page.tsx`: it renders `<RequirementDetail reqKey={key} />`, which now resolves `pid` itself — no change needed unless it calls the query directly.
  - Add `import { activeProjectId } from "@/project/current";` to each.

- [ ] **Step 6: Verify** — `npx tsx --test src/spec/map.test.ts src/spec/detail.test.ts src/spec/read.test.ts` → PASS; `npm run typecheck` clean; `npm run build` succeeds.

- [ ] **Step 7: Commit** `git add -A && git commit -m "[TASK-046] scope spec reads to active project + wire spec pages (REQ-029)"`

---

## Task 3: Scope tasks / pipeline / quick-wins reads + wire panels

**Files:** Modify `src/tasks/queries.ts`, `src/pipeline/queries.ts`, `src/metrics/quickwins.ts`; their tests; `tasks/tasks-panel.tsx`, `pipeline/pipeline-panel.tsx`, `quick-wins/quick-wins-panel.tsx`.

**Interfaces:** `listTasks(db, projectId?)`, `listPipeline(db, projectId?)`, `listQuickWins(db, projectId?, limit?)` — each filters `tasks.projectId` when given.

- [ ] **Step 1:** Add `projectId?: string` to each; add `eq(tasks.projectId, projectId)` to the WHERE when provided (quickwins/pipeline read tasks; keep limit param order: `listQuickWins(db, projectId?, limit = 8)`).
- [ ] **Step 2: Tests** — extend `quickwins.test.ts`, `pipeline/queries.test.ts`, and the tasks-queries test (add one if missing + to package.json): two projects → each query returns only the target project's tasks. Run → PASS.
- [ ] **Step 3: Wire panels** — each panel: `const pid = await activeProjectId(); … listX(getDb(), pid)`. Add the import.
- [ ] **Step 4: Verify** — affected tests PASS; typecheck clean; build succeeds.
- [ ] **Step 5: Commit** `git add -A && git commit -m "[TASK-046] scope tasks/pipeline/quick-wins reads + wire panels (REQ-029)"`

---

## Task 4: Scope ideas / activity / drift reads + wire panels

**Files:** Modify `src/ideas/queries.ts`, `src/events/feed.ts`, the drift read (`listOpenDriftFlags`); their tests; `ideas/ideas-panel.tsx`, `pulse/pulse-panel.tsx`, `drift/drift-panel.tsx`.

**Interfaces:** `listVotingIdeas(db, projectId?)`, `listScratchIdeas(db, projectId?, authorId)`, `listActivity(db, projectId?, limit = 120)`, `listOpenDriftFlags(db, projectId?)`.

- [ ] **Step 1:** Add `projectId?` and filter: ideas by `ideas.projectId`; `listActivity` by `events.projectId`; `listOpenDriftFlags` by joining `drift_flags → tasks` and filtering `tasks.projectId` (drift_flags has no own column).
- [ ] **Step 2: Tests** — extend `ideas/queries.test.ts`, `events/feed.test.ts`, `drift/flag.test.ts` (or the drift-read test): two projects → each returns only the target project's rows. Run → PASS.
- [ ] **Step 3: Wire panels** — `ideas-panel`, `pulse-panel`, `drift-panel`: resolve `pid` + pass. (`listScratchIdeas` keeps `authorId` — `listScratchIdeas(getDb(), pid, session.user.id)`.)
- [ ] **Step 4: Verify** — affected tests PASS; typecheck clean; build succeeds.
- [ ] **Step 5: Commit** `git add -A && git commit -m "[TASK-046] scope ideas/activity/drift reads + wire panels (REQ-029)"`

---

## Task 5: Scope metrics / narrative / digest / summarize + wire dashboard

**Files:** Modify `src/metrics/heartbeat.ts`, `src/metrics/burnup.ts`, `src/digest/queries.ts`, the narrative read, `src/dashboard/summarize.ts`; their tests; `src/app/(app)/dashboard/page.tsx` + any heartbeat/burnup/narrative/digest panel.

**Interfaces:** `heartbeatSeries(db, projectId?, now?, windowDays?)`, `burnUpSeries(db, projectId?)`, `digestSummary(db, projectId?)`, `recentDigests(db, projectId?, limit?)`, narrative read `(db, projectId?)`, and `summarize*(db, projectId?)` passing `projectId` to every query it calls.

- [ ] **Step 1:** Add `projectId?` to each and filter by `events.projectId` (heartbeat/burnup/digest are event-derived; narrative reads `narratives.projectId`). `dashboard/summarize.ts` threads `projectId` into each underlying query call.
- [ ] **Step 2: Tests** — extend `metrics/heartbeat.test.ts`, `metrics/burnup.test.ts`, `digest/queries.test.ts`, the narrative test, `dashboard/summarize.test.ts`: two projects → each returns only the target project's data. Run → PASS.
- [ ] **Step 3: Wire** — `dashboard/page.tsx`: `const pid = await activeProjectId();` once, pass to `summarize*` and any direct query calls; wire any heartbeat/burnup/narrative/digest panel likewise.
- [ ] **Step 4: Verify** — affected tests PASS; typecheck clean; build succeeds.
- [ ] **Step 5: Commit** `git add -A && git commit -m "[TASK-046] scope metrics/narrative/digest/summarize + wire dashboard (REQ-029)"`

---

## Task 6: Make `projectId` required + per-project genesis + verify

**Files:** Modify all the scoped query files (drop `?` / fallback); `src/genesis/import.ts`.

- [ ] **Step 1:** In every scoped query, make `projectId` **required** (`projectId: string`) and remove the `projectId ? … : undefined` conditional (always filter). Typecheck will flag any page/caller that still omits it — fix it (resolve `activeProjectId()`).
- [ ] **Step 2: Per-project genesis guard** — in `src/genesis/import.ts`, change the refuse-if-not-empty check to count requirements `WHERE project_id = <the target project>` (genesis already has the project from Phase A). Add/extend a test: importing into a project that already has requirements is refused; a different (fresh) project is allowed.
- [ ] **Step 3: Full verification** — stop any `:3000` server; `npm test` → all pass; `npm run typecheck` clean; `npm run build` succeeds.
- [ ] **Step 4: Runtime check (controller + user)** — rebuild + restart the site; confirm the dashboard, `/spec`, `/spec/[key]`, tasks, pipeline, quick-wins, ideas, pulse, drift all still show orbit's data correctly (one project → unchanged). No errors in the log.
- [ ] **Step 5: Commit** `git add -A && git commit -m "[TASK-046] require projectId on reads + per-project genesis guard (REQ-029)"`

- [ ] **Step 6: Hand off** — report; ready for finishing-a-development-branch (merge to main).

---

## Self-Review

**Spec coverage:** the `activeProjectId()` helper → Task 1; every read query scoped → Tasks 2–5; `getRequirementDetail(db, projectId, key)` → Task 2; pages resolve + pass the active project → Tasks 2–5 (wiring) + Task 6 (required tightening forces any straggler); per-project genesis guard → Task 6; two-project isolation tests → each scoping task; reads-only / no writes-or-worker touched → enforced by the file lists (no operation/worker file appears). Truth model: no events/writes/`github_status` changed.

**Placeholder scan:** the worked `listSpecMap` example shows the exact pattern; each subsequent query applies the identical "add `projectId?` + `eq(<table>.projectId, projectId)`" transform (the queries are near-identical, so the pattern + per-file column is the actionable content, not a placeholder). Run steps carry commands + expected results.

**Type consistency:** `activeProjectId(): Promise<string>`; queries go `(db)` → `(db, projectId?: string)` in Tasks 2–5 → `(db, projectId: string)` in Task 6; `getRequirementDetail(db, projectId, key)` required from Task 2; `listScratchIdeas(db, projectId?, authorId)` and `listQuickWins(db, projectId?, limit?)` keep their trailing params; `projectId` (camel) ↔ `project_id` (column). Build stays green per task via the optional param + same-task page wiring; Task 6 tightens to required.
