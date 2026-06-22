# Multi-project Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag every project-scoped row and event with a `project_id` and make all writes carry it — the data-model foundation for multiple repos — with **no change to app behavior** (one project still).

**Architecture:** Add `project_id` to `requirements`/`ideas`/`tasks`/`events`/`narratives` and `users.active_project_id`; backfill the sole project; thread `project_id` through `emitEvent` and every write path (each deriving it from the subject's project or the actor's active project); make keys unique per-project. Land it incrementally: columns nullable → writes set them → finalize NOT NULL + per-project unique.

**Tech Stack:** Drizzle/Postgres (+ drizzle-kit, hand-edited backfill SQL), Node `tsx --test` + PGlite.

## Global Constraints

- **TypeScript; no `any` in domain code.**
- **Every event carries `project_id`, written in the same transaction as its state write** (`emitEvent`). The truth-model anchor — now project-scoped.
- **`events` is append-only** (DB trigger `events_append_only`). The one-time backfill bypasses it via `ALTER TABLE events DISABLE TRIGGER events_append_only; … ; ENABLE TRIGGER …`; no other code path ever updates `events`. **`tasks.github_status` stays webhook-only.**
- **Backfill is id-agnostic:** `SET project_id = (SELECT id FROM project ORDER BY created_at LIMIT 1)` — resolves to orbit in prod and the test-seeded project in PGlite; **no hardcoded uuid in the repo.**
- **Reads do NOT change in Phase A** — every list/query still returns all rows (correct: one project). Scoping reads is Phase B.
- New migrations must be **applied to the live DB by hand** (see the "migrations & the live DB" memory) — `db:migrate` is fresh-provision only.
- Keys become unique **per project** (`unique(project_id, key)`); key minting counts within the project.
- **Commits start with `[TASK-045]`** on branch `task-045-multiproject-phase-a`. Introduces a **new requirement** ("multi-project support") — declare it on the board during this work (see Task 0).

---

## File Structure

**New**
- `src/project/active.ts` — `getActiveProjectId` resolver (+ test).

**Modified (core)**
- `src/db/schema.ts` — `project_id` on 5 tables, `users.active_project_id`, per-project unique constraints.
- `drizzle/NNNN_*.sql` — generated + hand-edited backfill.
- `src/db/events.ts` — `emitEvent` carries `projectId`.
- `src/requirements/keys.ts` — `nextRequirementKey(tx, projectId)`.
- `src/generation/persist.ts` (+ `persist-helpers.ts`) — per-project task numbering; inserts set `project_id`.

**Modified (write paths — set `project_id` + pass to `emitEvent`)**
- `src/genesis/import.ts`, `src/ideas/submit.ts`, `src/ideas/scratch.ts`, `src/ideas/vote.ts`, `src/requirements/declare.ts`, `src/requirements/amend.ts`, `src/requirements/lifecycle.ts`, `src/narrative/materialize.ts`, `src/spec/materialize.ts`, `src/drift/flag.ts`, `src/integrity/reconcile.ts`, `src/integrity/claude-md.ts`, `src/digest/send.ts`, `src/tasks/claim.ts`, `src/github/webhook.ts`.

> **Concurrency:** these are the exact files the other session is editing on `main`. Execute this plan **only after the other agent is paused and `main` is stable** (see the handoff note) — otherwise the cross-cutting edits will conflict continuously, and the line references below will drift.

---

## Task 0: Requirement number (no DB action)

Multi-project is **Throughline's own** requirement — **REQ-029** (Throughline's spec uses REQ-001..027; REQ-028 = the overview dashboard).

**Do NOT run the declare CLI against the live DB.** The bound board currently holds the *orbit* repo's requirements (genesis-imported), so declaring "multi-project support" there would wrongly add it to orbit's board. Throughline's own requirements live in `throughline/SPEC.md`; recording REQ-029 there is a separate concern from this code work.

- [ ] Use **REQ-029** in every commit trailer below (replaces `REQ-0xx`).

---

## Task 1: `getActiveProjectId` resolver

**Files:** Create `src/project/active.ts`, `src/project/active.test.ts`; Modify `package.json`.

**Interfaces:**
- Produces: `getActiveProjectId(db: Db, userId?: string | null): Promise<string>` — the user's `active_project_id`, else the oldest project's id; throws if no project bound.

- [ ] **Step 1: Write the failing test** — `src/project/active.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { project, users } from "../db/schema";
import { getActiveProjectId } from "./active";

test("getActiveProjectId throws when no project is bound", async () => {
  const { db, close } = await createTestDb();
  try {
    await assert.rejects(() => getActiveProjectId(db), /no project/i);
  } finally { await close(); }
});

test("getActiveProjectId falls back to the oldest project when user has none set", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "o/orbit", installationId: 1, defaultBranch: "main", localClonePath: "/tmp", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" }).returning({ id: project.id });
    assert.equal(await getActiveProjectId(db), p.id);
    const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
    assert.equal(await getActiveProjectId(db, u.id), p.id); // user has no active set → oldest
  } finally { await close(); }
});

test("getActiveProjectId returns the user's active project when set", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p1] = await db.insert(project).values({ repoFullName: "o/a", installationId: 1, defaultBranch: "main", localClonePath: "/a", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" }).returning({ id: project.id });
    const [p2] = await db.insert(project).values({ repoFullName: "o/b", installationId: 2, defaultBranch: "main", localClonePath: "/b", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" }).returning({ id: project.id });
    const [u] = await db.insert(users).values({ githubId: 2, githubLogin: "bob", activeProjectId: p2.id }).returning({ id: users.id });
    assert.equal(await getActiveProjectId(db, u.id), p2.id);
    assert.notEqual(p1.id, p2.id);
  } finally { await close(); }
});
```

(This test depends on Task 2's `users.active_project_id` column — sequence Task 2 first if implementing strictly TDD, or land Task 1's resolver code with Task 2. The reviewer should treat Tasks 1–2 as a pair.)

- [ ] **Step 2: Append the test to `package.json`** test list; run → FAIL.

- [ ] **Step 3: Implement** `src/project/active.ts`:

```ts
import { eq, asc } from "drizzle-orm";
import type { Db } from "../db/client";
import { project, users } from "../db/schema";

/**
 * The project a user is currently working in (multi-project, per-user). Returns
 * the user's active_project_id; if unset (or no user), the oldest project. Throws
 * if no project is bound. Phase A: there is one project, so this always returns it.
 */
export async function getActiveProjectId(db: Db, userId?: string | null): Promise<string> {
  if (userId) {
    const [u] = await db.select({ active: users.activeProjectId }).from(users).where(eq(users.id, userId)).limit(1);
    if (u?.active) return u.active;
  }
  const [p] = await db.select({ id: project.id }).from(project).orderBy(asc(project.createdAt)).limit(1);
  if (!p) throw new Error("No project bound (REQ-002).");
  return p.id;
}
```

- [ ] **Step 4: Run the test** → PASS (after Task 2 adds the column). `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/project/active.ts src/project/active.test.ts package.json
git commit -m "[TASK-045] getActiveProjectId resolver (REQ-0xx)"
```

---

## Task 2: Schema — add `project_id` (nullable) + `active_project_id` + backfill migration

**Files:** Modify `src/db/schema.ts`; generate + hand-edit `drizzle/NNNN_*.sql`; Test `src/db/multiproject-schema.test.ts`; Modify `package.json`.

**Interfaces:**
- Produces: `requirements.projectId`, `ideas.projectId`, `tasks.projectId`, `events.projectId`, `narratives.projectId` (all nullable for now), `users.activeProjectId` (nullable). Global `key` uniques unchanged this task.

> Columns are added **nullable** here so the app keeps working before the write paths (Tasks 3–6) set them. Task 7 finalizes NOT NULL + per-project uniques.

- [ ] **Step 1: Add columns in `src/db/schema.ts`.** To `users` add:

```ts
  activeProjectId: uuid("active_project_id").references(() => project.id),
```

To each of `requirements`, `ideas`, `tasks`, `events`, `narratives` add (nullable, no `.notNull()` yet):

```ts
  projectId: uuid("project_id").references(() => project.id),
```

(Place near the other id columns. Leave the existing `unique` on `requirements.key`/`tasks.key` as-is for now.)

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate` → a new `drizzle/NNNN_*.sql` with the `ADD COLUMN`s. Note its filename.

- [ ] **Step 3: Hand-edit the migration to backfill.** Append to the generated `drizzle/NNNN_*.sql` (after the ADD COLUMNs), using the id-agnostic subquery:

```sql
--> statement-breakpoint
UPDATE "requirements" SET "project_id" = (SELECT id FROM project ORDER BY created_at LIMIT 1) WHERE "project_id" IS NULL;--> statement-breakpoint
UPDATE "ideas" SET "project_id" = (SELECT id FROM project ORDER BY created_at LIMIT 1) WHERE "project_id" IS NULL;--> statement-breakpoint
UPDATE "tasks" SET "project_id" = (SELECT id FROM project ORDER BY created_at LIMIT 1) WHERE "project_id" IS NULL;--> statement-breakpoint
UPDATE "narratives" SET "project_id" = (SELECT id FROM project ORDER BY created_at LIMIT 1) WHERE "project_id" IS NULL;--> statement-breakpoint
ALTER TABLE "events" DISABLE TRIGGER "events_append_only";--> statement-breakpoint
UPDATE "events" SET "project_id" = (SELECT id FROM project ORDER BY created_at LIMIT 1) WHERE "project_id" IS NULL;--> statement-breakpoint
ALTER TABLE "events" ENABLE TRIGGER "events_append_only";
```

> The `WHERE project_id IS NULL` makes it safe to re-run. In a fresh PGlite with a seeded project the subquery resolves to that project; with no project (some tests) the UPDATEs touch zero rows (the tables are empty too).

- [ ] **Step 4: Write the migration test** — `src/db/multiproject-schema.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { project, requirements, events, users } from "../db/schema";
import { emitEvent } from "./events";

test("scoped tables have a project_id column and backfill is id-agnostic", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" }).returning({ id: project.id });
    // a row written with project_id round-trips
    await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: p.id });
    const [r] = await db.select({ pid: requirements.projectId }).from(requirements).where(eq(requirements.key, "REQ-001"));
    assert.equal(r.pid, p.id);
  } finally { await close(); }
});

test("events is still append-only after the migration (trigger re-enabled)", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" }).returning({ id: project.id });
    await db.transaction(async (tx) => { await emitEvent(tx, { type: "project.bound", subjectType: "project", subjectId: p.id, projectId: p.id }); });
    await assert.rejects(() => db.update(events).set({ rationale: "x" }), /append-only/i);
  } finally { await close(); }
});
```

(The second test depends on Task 3's `emitEvent` accepting `projectId` — sequence Task 3 before running it, or land 2+3 together.)

- [ ] **Step 5:** Append the test to `package.json`; run the suite → the first test PASSES now; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/ src/db/multiproject-schema.test.ts package.json
git commit -m "[TASK-045] schema: nullable project_id + active_project_id + backfill (REQ-0xx)"
```

---

## Task 3: `emitEvent` carries `projectId`

**Files:** Modify `src/db/events.ts`, `src/db/events.test.ts`.

**Interfaces:**
- Produces: `EmitEventInput.projectId: string` (added; **optional at the type level for now** — `projectId?: string` — so the 17 callers can be migrated in Tasks 4–6 without breaking the build; Task 7 makes it required).

- [ ] **Step 1: Write the failing test** — append to `src/db/events.test.ts`:

```ts
test("emitEvent writes project_id", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" }).returning({ id: project.id });
    let id = "";
    await db.transaction(async (tx) => { id = (await emitEvent(tx, { type: "project.bound", subjectType: "project", subjectId: p.id, projectId: p.id })).id; });
    const [e] = await db.select({ pid: events.projectId }).from(events).where(eq(events.id, id));
    assert.equal(e.pid, p.id);
  } finally { await close(); }
});
```

(Add `project`, `events`, `eq` to the test's imports if missing.)

- [ ] **Step 2: Run** → FAIL (`projectId` not on `EmitEventInput` / not written).

- [ ] **Step 3: Implement** — in `src/db/events.ts`, add to `EmitEventInput`:

```ts
  projectId?: string; // the project this event belongs to (multi-project). Required from Task 7.
```

and in the `.values({...})` of `emitEvent`, add:

```ts
      projectId: input.projectId ?? null,
```

- [ ] **Step 4: Run** → PASS. `npm run typecheck` → clean (callers still compile — `projectId` optional).

- [ ] **Step 5: Commit**

```bash
git add src/db/events.ts src/db/events.test.ts
git commit -m "[TASK-045] emitEvent carries project_id (optional pending caller migration) (REQ-0xx)"
```

---

## Task 4: Thread `project_id` through idea & requirement write paths

**Files:** Modify `src/ideas/submit.ts`, `src/ideas/scratch.ts`, `src/ideas/vote.ts`, `src/requirements/declare.ts`, `src/requirements/amend.ts`, `src/requirements/lifecycle.ts`; their tests.

**Interfaces:**
- Consumes: `getActiveProjectId` (Task 1).
- Each write resolves the project and sets it on inserts + passes it to `emitEvent`.

**Per-file project source (the actual content — derive `projectId` thus):**
- `ideas/scratch.ts`, `ideas/submit.ts` (create an idea): `const projectId = await getActiveProjectId(db /* or tx-bound db */, actorUserId)`. Set `ideas.projectId` on insert; pass `projectId` to `emitEvent`.
- `ideas/vote.ts` (vote on an existing idea): read the idea's `projectId` (`select projectId from ideas where id = ideaId`); pass to `emitEvent`. (Votes table itself is unscoped.)
- `requirements/declare.ts`: accept/resolve `projectId` (caller passes it; genesis/generation already know the project — see Tasks 5/6). Set `requirements.projectId` on insert; pass to `emitEvent`; mint the key per-project (Task 5's `nextRequirementKey(tx, projectId)`).
- `requirements/amend.ts`, `requirements/lifecycle.ts` (operate on an existing requirement): read the requirement's `projectId`; pass to `emitEvent`.

- [ ] **Step 1:** For each file, write/extend a test asserting the inserted row's `projectId` and the emitted event's `projectId` match the expected project (mirror the existing test in each `*.test.ts`; seed a `project` row and pass/resolve its id).
- [ ] **Step 2:** Run the affected tests → FAIL.
- [ ] **Step 3:** Implement per the per-file sources above. Where a function lacks the project, add a `projectId` parameter (declare/amend resolve from the subject or accept it from the caller).
- [ ] **Step 4:** Run the affected tests → PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** `git commit -m "[TASK-045] ideas + requirements writes carry project_id (REQ-0xx)"`

---

## Task 5: Per-project key minting + generation/genesis writes

**Files:** Modify `src/requirements/keys.ts`, `src/generation/persist.ts`, `src/generation/persist-helpers.ts`, `src/genesis/import.ts`; their tests.

**Interfaces:**
- Produces: `nextRequirementKey(tx: Tx, projectId: string): Promise<string>` (counts within the project); task numbering scoped by project.

- [ ] **Step 1: Write failing tests:** `nextRequirementKey` with two projects → each starts at `REQ-001` independently; `persistGeneration`/`persistGenerationForRequirement` set `tasks.projectId` and number `TASK-NNN` within the project; `importGenesisSpec` sets `requirements.projectId` and emits project-scoped events.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement:**
  - `keys.ts`: `nextRequirementKey(tx, projectId)` → `select key from requirements where project_id = projectId`; max+1.
  - `persist.ts`/`persist-helpers.ts`: task-number `maxNumber` scoped by `project_id` (`select key from tasks where project_id = projectId`); inserts set `tasks.projectId` and `requirements.projectId`; pass `projectId` to `emitEvent`. The project is the requirement's `projectId` (requirement-driven) or the idea's `projectId` (idea-driven) — read it.
  - `genesis/import.ts`: the project it imports into is the just-bound/sole project; set `requirements.projectId`; pass to `emitEvent`; use `nextRequirementKey(tx, projectId)`.
- [ ] **Step 4:** Run → PASS; typecheck clean.
- [ ] **Step 5: Commit** `git commit -m "[TASK-045] per-project key minting + generation/genesis writes carry project_id (REQ-0xx)"`

---

## Task 6: Thread `project_id` through task/spec/integrity/digest/narrative/webhook writes

**Files:** Modify `src/tasks/claim.ts`, `src/spec/materialize.ts`, `src/drift/flag.ts`, `src/integrity/reconcile.ts`, `src/integrity/claude-md.ts`, `src/digest/send.ts`, `src/narrative/materialize.ts`, `src/github/webhook.ts`; their tests.

**Per-file project source:**
- `tasks/claim.ts` (claim/unclaim a task): read the task's `projectId`; pass to `emitEvent`.
- `github/webhook.ts` (`task.github_status_changed`): read the task's `projectId`; pass to `emitEvent`. (Still only sets `github_status` + this event — webhook-only invariant intact.)
- `spec/materialize.ts`, `narrative/materialize.ts`: operate on a project — resolve the project (these run per-project; in Phase A the sole project). Set `narratives.projectId`; pass `projectId` to `emitEvent`.
- `drift/flag.ts` (`drift.flagged`): the flagged task's `projectId`; pass to `emitEvent`.
- `integrity/reconcile.ts`, `integrity/claude-md.ts`, `digest/send.ts`: resolve the project they operate on (the sole/bound project in Phase A); pass `projectId` to `emitEvent`.

- [ ] **Step 1:** Extend each file's test to assert the emitted event's `projectId` (and `narratives.projectId` where applicable).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement per the sources above.
- [ ] **Step 4:** Run → PASS; typecheck clean.
- [ ] **Step 5: Commit** `git commit -m "[TASK-045] task/spec/integrity/digest/narrative/webhook writes carry project_id (REQ-0xx)"`

---

## Task 7: Finalize — NOT NULL, per-project unique, required `projectId`

**Files:** Modify `src/db/schema.ts`; generate + hand-edit `drizzle/NNNN_*.sql`; Modify `src/db/events.ts`.

- [ ] **Step 1:** In `src/db/schema.ts`: add `.notNull()` to all five `projectId` columns; replace the global `key` uniques on `requirements`/`tasks` with table-level `unique(project_id, key)` (drop `.unique()` on the `key` column; add `(t) => [unique("requirements_project_key_unique").on(t.projectId, t.key)]`, same for tasks). In `src/db/events.ts` make `EmitEventInput.projectId` **required** (`projectId: string`) and drop the `?? null` fallback (write `input.projectId`).
- [ ] **Step 2:** `npm run db:generate` → new migration (SET NOT NULL + drop old unique + create new unique). Verify the generated SQL; ensure the NOT NULL comes after the Task-2 backfill in replay order (it does — later migration file).
- [ ] **Step 3: Write the failing test** — `unique(project_id, key)` permits the same key in two projects, blocks duplicates within one:

```ts
test("REQ/TASK keys are unique per project, not globally", async () => {
  const { db, close } = await createTestDb();
  try {
    const [a] = await db.insert(project).values({ repoFullName: "o/a", installationId: 1, defaultBranch: "main", localClonePath: "/a", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" }).returning({ id: project.id });
    const [b] = await db.insert(project).values({ repoFullName: "o/b", installationId: 2, defaultBranch: "main", localClonePath: "/b", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" }).returning({ id: project.id });
    await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: a.id });
    await db.insert(requirements).values({ key: "REQ-001", title: "t2", description: "d", provenance: "imported", projectId: b.id }); // ok: different project
    await assert.rejects(() => db.insert(requirements).values({ key: "REQ-001", title: "dup", description: "d", provenance: "imported", projectId: a.id })); // dup within project
  } finally { await close(); }
});
```

Add it to `src/db/multiproject-schema.test.ts`.

- [ ] **Step 4:** Run the new test → PASS; `npm run typecheck` clean (all callers now pass `projectId`, so required compiles).

- [ ] **Step 5: Full verification** — stop any `:3000` server; `npm test` → all pass; `npm run build` → succeeds. Apply both new migrations to a scratch DB (or the live DB, by hand) and confirm the columns are NOT NULL + the per-project uniques exist.

- [ ] **Step 6: Commit** `git commit -m "[TASK-045] finalize: project_id NOT NULL + per-project key uniques + required emitEvent projectId (REQ-0xx)"`

---

## Self-Review

**Spec coverage:** scoped tables + `active_project_id` → Tasks 2/7; resolver → Task 1; per-project keys + uniques → Tasks 5/7; `emitEvent` carries projectId → Tasks 3/7; all write paths set project_id → Tasks 4/5/6; events backfill via trigger bypass → Task 2; reads unchanged → enforced by not touching query files; new REQ declared → Task 0. Truth model: events append-only preserved (trigger re-enabled, verified in Task 2 test); project_id in every event; github_status untouched.

**Placeholder scan:** `REQ-0xx` is the deliberate output of Task 0 (the real number is minted there). The per-file "project source" lists are the actual derivation instructions (not vague). Tasks 4/6 use a per-file source table + the standard test-then-implement loop rather than re-pasting every function, because these files are being concurrently rewritten and verbatim snapshots would be stale; the implementer reads each file and applies the named derivation.

**Type consistency:** `getActiveProjectId(db, userId?) → Promise<string>`; `EmitEventInput.projectId` optional (Task 3) → required (Task 7); `nextRequirementKey(tx, projectId)`; `projectId` (camel) ↔ `project_id` (column) throughout; `users.activeProjectId` ↔ `active_project_id`.

**Incremental safety:** columns land nullable (Task 2) with global key uniques intact, so the app keeps working while Tasks 3–6 populate `project_id`; Task 7 flips NOT NULL + per-project uniques only once every write sets it. Each task ends green.
