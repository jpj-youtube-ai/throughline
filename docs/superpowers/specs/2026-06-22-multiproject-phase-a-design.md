# Multi-project — Phase A: scope the data model + writes

**Date:** 2026-06-22
**Status:** Approved (design); pending implementation plan
**Layer:** Foundation `[1]` — re-architecture. **Phase A of A/B/C** (see Decomposition).

## Context & premise change

Throughline was built **single-repo** by design (`CLAUDE.md`: "Self-hosted, 5 users, single repo"): the `project` table holds one row, queried as "the one project" (`select().from(project).limit(1)`) in 16+ places, and `ideas`/`requirements`/`tasks`/`events` carry **no project id**. The user now wants **true multi-project**: bind multiple repos, keep each repo's ideas/requirements/tasks/events separately, and **alternate** the active one per-user.

This is a deliberate expansion of the stated scope. It introduces a **new requirement** ("multi-project support") that must be declared on the board (provenance `drift`/new-req) — **surface it during planning; do not fold it silently.** Number TBD given concurrent work on `main`.

## Decisions (settled in brainstorming)

1. **True multi-project** — multiple projects coexist; all per-project data is preserved; switching changes which one you see.
2. **Per-user active project** — each user picks their own active project (`users.active_project_id`); switching affects only that user.
3. **Phased delivery** — A (data model + writes), B (scope reads), C (add repos + switcher). Each phase leaves the app working.
4. **Scoped tables** carry a direct `project_id`: `requirements`, `ideas`, `tasks`, `events`, `narratives`. `votes` and `drift_flags` stay scoped via their parent (`idea` / `task`).
5. **Keys go per-project** — `requirements.key` and `tasks.key` are unique **per project**, not globally.

## Architecture (Phase A)

### 1. Schema (`src/db/schema.ts` + a Drizzle migration)

- **`users.activeProjectId`** — `uuid("active_project_id")` nullable, FK → `project.id`. The per-user active project; null resolves to the default project.
- **`projectId`** — `uuid("project_id").notNull().references(() => project.id)` added to: `requirements`, `ideas`, `tasks`, `events`, `narratives`.
- **Unique constraints** change from global to per-project:
  - `requirements`: drop the global `unique` on `key`; add `unique(project_id, key)`.
  - `tasks`: drop the global `unique` on `key`; add `unique(project_id, key)`.
- `votes` (`unique(idea_id, user_id)`) and `drift_flags` are unchanged — scope derives from their parent row.

### 2. Migration + backfill

A new `drizzle/NNNN_*.sql` (generated via `npm run db:generate`, then hand-edited to add the backfill), applied to the live DB by hand (per the project's migrate gotcha — see the "migrations & the live DB" memory). The backfill targets **the single existing project** via a subquery — `(SELECT id FROM project ORDER BY created_at LIMIT 1)` — so the same SQL resolves correctly in prod (orbit) and in the PGlite test DB (the test-seeded project), with **no hardcoded uuid in the repo**. Because `schemaSql()` replays every migration on a fresh PGlite, that id-agnostic form is required for the tests to pass.

- `requirements`/`ideas`/`tasks`/`narratives`: `ADD COLUMN project_id uuid`; `UPDATE … SET project_id = (SELECT id FROM project ORDER BY created_at LIMIT 1)`; `ALTER … SET NOT NULL`; drop the old global `key` unique and add the per-project unique index.
- **`events` is append-only** — a DB trigger (`src/db/append-only.sql`) blocks `UPDATE`/`DELETE`, so the backfill cannot be a plain `UPDATE`. The migration **temporarily bypasses the trigger** for the one-time backfill: `ALTER TABLE events DISABLE TRIGGER <name>; UPDATE events SET project_id = (SELECT id FROM project ORDER BY created_at LIMIT 1); ALTER TABLE events ENABLE TRIGGER <name>;` then `SET NOT NULL`. This is the only place the append-only guard is deliberately bypassed, and only to set a value on rows that had none — **no intent is rewritten.** (Confirm the exact trigger name from `append-only.sql` during planning.)

### 3. Active-project resolver (`src/project/active.ts`, new)

- **`getActiveProjectId(db, userId): Promise<string>`** — returns the user's `active_project_id`; if null, the oldest project's id (`ORDER BY created_at LIMIT 1`). Throws a clear error if no project is bound. In Phase A there is exactly one project, so it always returns orbit. Consumed by writes now; by reads in Phase B.

### 4. Writes carry `project_id`

- **`emitEvent(tx, { type, projectId, subjectType, … })`** — add a **required** `projectId`. Every existing call site passes it (resolved from the active project — in Phase A, the sole project). This is the truth-model anchor: every event is now project-tagged.
- Every insert into `requirements` / `ideas` / `tasks` / `narratives` sets `project_id`.
- **Per-project key minting:** `nextRequirementKey(tx, projectId)` and the task-number helper (`maxNumber` usage in `persist*`) compute the next `REQ-NNN`/`TASK-NNN` **within the given project** (`WHERE project_id = …`).

### 5. What does NOT change in Phase A

- **Reads.** Every list/query (spec map, tasks, ideas, pipeline, quick-wins, heartbeat, burnup, feed, narrative, digest) still returns all rows — correct because there is exactly one project. Scoping reads is **Phase B**.
- **No repo-binding changes, no switcher** — those are **Phase C**.
- Net effect: the app behaves identically after Phase A, but every row and event is project-tagged and keying is per-project.

## Truth-model constraints

- **Events stay append-only.** Adding a column is not an update of intent; the one-time backfill bypasses the trigger *only* to set a previously-absent `project_id` on historical rows, rewriting no intent. Going forward `emitEvent` writes `project_id` in the same transaction as the state write — unchanged discipline, now project-scoped.
- **`tasks.github_status` stays webhook-only.** Untouched.
- **`project_id` is NOT NULL** on the scoped tables after backfill — no orphan rows.

## Components

**New**
- `src/project/active.ts` — `getActiveProjectId`.
- `drizzle/NNNN_*.sql` — the generated migration.

**Modified**
- `src/db/schema.ts` — `project_id` on five tables, `users.active_project_id`, per-project unique constraints.
- `src/db/events.ts` — `emitEvent` requires `projectId`.
- `src/requirements/keys.ts` (+ `declare.ts`) — per-project `nextRequirementKey`.
- `src/generation/persist.ts` / `persist-helpers.ts` — per-project task numbering; inserts set `project_id`.
- `src/genesis/import.ts`, `src/ideas/submit.ts`, `src/requirements/declare.ts`, `src/narrative/materialize.ts`, and every other write path — set `project_id` and pass it to `emitEvent`.

## Testing

- **Migration/backfill** (PGlite via `schemaSql()`): after replay, seeded rows carry `project_id`; `events.project_id` is set and NOT NULL; the append-only trigger is back ON afterwards (an `UPDATE events` still throws).
- **`emitEvent` requires `projectId`** and writes it (extend `events.test.ts`).
- **Per-project keys:** two projects → each can hold `REQ-001`/`TASK-001` independently; `unique(project_id, key)` permits the duplicate key across projects but blocks it within one; `nextRequirementKey`/task numbering count only the given project.
- **`getActiveProjectId`:** returns the user's choice; falls back to the oldest project when null; throws when no project.
- Update existing tests that call `emitEvent`/insert scoped rows to pass a `projectId` (a test-seeded project).

## Decomposition (the whole feature)

- **Phase A (this spec):** schema + migration/backfill + writes carry `project_id` + per-project keys + the resolver.
- **Phase B:** scope every read to the active project (the 16+ `.from(project).limit(1)` sites resolve the user's active project; all list queries filter by it; genesis becomes per-project — refuse if *this* project has requirements).
- **Phase C:** bind additional repos (each its own clone + `SPEC.md`/`CLAUDE.md`), the per-user active-project switcher UI, and a project list/management surface.

## Out of scope (Phase A)

- Scoping reads (Phase B); multiple repos + switcher (Phase C).
- Declaring/numbering the new "multi-project" requirement on the board (do during planning).
- Cross-project moves, per-project permissions, archiving.

## Concurrency note

Phase A edits `schema.ts` and many write-path files — the same files the **other active session** is changing on `main`. Designing/spec-writing does not conflict, but at **implementation** time, serialize (pause the other agent) to avoid constant 40-file merge conflicts.
