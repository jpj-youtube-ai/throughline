# Multi-project — Phase B: scope reads to the active project

**Date:** 2026-06-22
**Status:** Approved (design); pending implementation plan
**Layer:** Foundation `[1]` — **Phase B of A/B/C** (REQ-029). Phase A (data model + writes) is done & merged.

## Context

Phase A tagged every row and event with `project_id` (NOT NULL) and made keys per-project, but **reads were intentionally left unscoped** — every list/query still returns all rows. With one project that is correct; for multiple projects each user must see only their **active** project's data. Phase B scopes the **reads**. The operation/worker project-resolution (generation/issues/branches/spec/digest clone lookups) is **deferred to Phase C**, where a second repo actually exists to operate on. The active-project switcher UI is also Phase C; Phase B reads through whatever `users.active_project_id` already holds (one project today, so behavior is unchanged).

## Decisions (settled in brainstorming)

1. **Reads only.** Phase B scopes the ~12 read/list queries + their pages; it does not touch the operation/worker `select().from(project).limit(1)` sites (Phase C).
2. **Per-user active project** drives reads — resolved via the existing `getActiveProjectId(db, userId)` (Phase A).
3. A small **`activeProjectId()` page helper** removes the per-page boilerplate.
4. **Genesis guard goes per-project** (refuse if *this* project has requirements).

## Architecture

### 1. Read queries gain a `projectId` parameter

Each gains `projectId: string` and filters its result rows by `eq(<table>.projectId, projectId)`:

- `src/spec/map.ts` — `listSpecMap(db, projectId)`
- `src/spec/detail.ts` — `getRequirementDetail(db, projectId, key)` (keys are per-project, so a key alone is ambiguous)
- `src/spec/read.ts` — `readSpec(db, projectId)` (the materialized spec doc for the project)
- `src/tasks/queries.ts` — `listTasks(db, projectId)`
- `src/pipeline/queries.ts` — `listPipeline(db, projectId)`
- `src/metrics/quickwins.ts` — `listQuickWins(db, projectId, limit?)`
- `src/metrics/heartbeat.ts` — heartbeat read (scope by project)
- `src/metrics/burnup.ts` — burnup read (scope by project)
- `src/ideas/queries.ts` — `listVotingIdeas(db, projectId)`, `listScratchIdeas(db, projectId, authorId)`
- `src/events/feed.ts` — `listActivity(db, projectId, limit?)` (events are project-tagged)
- `src/drift/*` read — `listOpenDriftFlags(db, projectId)` (join via task's project, or add a project filter through the task)
- `src/narrative/*` read — narrative read scoped to the project
- `src/digest/queries.ts` — digest reads scoped to the project
- `src/dashboard/summarize.ts` — the dashboard summary helpers take `projectId` and pass it through to the queries they call

> `listOpenDriftFlags` / drift reads scope via the flagged task's `project_id` (drift_flags has no own column — Phase A kept it parent-scoped). Join `drift_flags → tasks` and filter `tasks.project_id`.

### 2. The `activeProjectId()` page helper (NEW server-only file)

Add the helper in its **own** module — `src/project/current.ts` — NOT in `active.ts`. Keeping it separate is important: `active.ts`'s `getActiveProjectId(db, userId)` is a pure DB function with PGlite unit tests; importing `@/auth` into it would drag Next's server context into those tests. The new file is the auth-coupled wrapper:

```ts
// src/project/current.ts — server-only: the signed-in user's active project for a page/panel.
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { getActiveProjectId } from "./active";

export async function activeProjectId(): Promise<string> {
  const session = await auth();
  return getActiveProjectId(getDb(), session?.user?.id ?? null);
}
```

(Pages call `const pid = await activeProjectId()` then pass `pid` to the query. `active.ts` stays pure and unit-tested; `current.ts` is exercised via build + the runtime check, not a PGlite unit test.)

### 3. Pages/panels resolve + pass the active project

Every server component that reads data resolves `pid = await activeProjectId()` and passes it to its query. Affected (the panels/pages from the dashboard + tabs): the dashboard page + each area panel (ideas, tasks, pipeline, quick-wins, heartbeat, burnup, drift/reconcile, narrative, digest, activity/pulse), the `/spec` page (`listSpecMap`), the `/spec/[key]` page + drawer (`getRequirementDetail(db, pid, key)`), and the spec "View SPEC.md" drawer (`readSpec(db, pid)`).

### 4. Per-project genesis guard

`src/genesis/import.ts` — the refuse-if-not-empty guard checks **this project's** requirements (`WHERE project_id = projectId`) rather than the whole table. (Genesis already receives/sets `projectId` from Phase A.)

## Truth-model constraints

- **Reads only** — no writes, events, or `github_status` touched. Operations/worker unchanged (Phase C).
- The active project is read via `users.active_project_id` (Phase A); no new mutable state.
- With one project bound, every query returns exactly what it does today (the active project = the sole project) — **no behavior change** until Phase C adds a second project + the switcher.

## Components

**New**
- `src/project/current.ts` — the server-only `activeProjectId()` page helper (`auth()` + `getActiveProjectId`). Kept separate from the pure `active.ts`.

**Modified**
- The ~12 read/query files above (add `projectId` param + `WHERE project_id`).
- The ~12 page/panel server components (resolve `activeProjectId()` + pass it).
- `src/genesis/import.ts` (per-project refuse guard).

## Testing

- **Each scoped query** (PGlite, two projects seeded): returns only the target project's rows; e.g. `listSpecMap(db, p1)` excludes p2's requirements; `getRequirementDetail(db, p1, "REQ-001")` returns p1's REQ-001 not p2's; `listTasks`/`listPipeline`/`listQuickWins`/ideas/activity/drift/metrics likewise. Extend each query's existing `*.test.ts`.
- **Genesis guard:** importing into a project that already has requirements is refused; a fresh project is allowed (two-project test).
- **Pages:** typecheck + build; a runtime check that the live (single-project) app still shows orbit's data unchanged through the new active-project path.
- Full suite green.

## Scope / phasing (for the plan)

1. `activeProjectId()` helper (+ test).
2. Scope the read queries + their tests (grouped: spec/tasks/pipeline; ideas/activity/drift; metrics/narrative/digest/summarize).
3. Wire the pages/panels to resolve + pass `pid`.
4. Per-project genesis guard + verify (suite + build + runtime).

## Requirement linkage

Part of **REQ-029** (multi-project). TASK-046.

## Out of scope (Phase B)

- Operation/worker project-resolution (generation/issues/branches/spec materialize/digest clone lookups) — **Phase C**.
- The active-project switcher UI, binding additional repos, the project list — **Phase C**.
- Cross-project views or aggregates.
