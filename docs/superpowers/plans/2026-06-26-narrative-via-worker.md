# Narrative generation via the worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the slow narrative+roadmap generation off the web request path: the "Generate" button records a request; the worker does the LLM work per project; the page shows the latest result.

**Architecture:** A new `narrative.requested` event is the signal. `materializeNarrative` becomes per-project. The worker, each tick, regenerates a project's narrative only when a `narrative.requested` is newer than its last narrative. The page shows a "queued" hint while pending.

**Tech Stack:** TypeScript, Postgres + Drizzle (PGlite tests, `node:test`), Next.js (App Router server action), Anthropic SDK, the background worker.

**Design doc:** `docs/superpowers/specs/2026-06-26-narrative-via-worker-design.md`

## Global Constraints

- **Requirement:** REQ-016 (project narrative/roadmap) — refinement, **no new REQ**. Branch `task-073-narrative-via-worker`; PR/squash start `[TASK-073]`.
- **Truth model:** `narrative.requested` is emitted in a `db.transaction` (a deliberate *pure-intent* event — the log is the source of truth for "regen pending", like `spec.materialized` has no DB row); `narrative.generated` + the `narratives` row stay in the materialize tx. Append-only; no event updated/deleted. No `github_status` write. The worker narrative step is **best-effort** (own try/catch, never aborts the tick). No `any`.
- **No migration** — the signal is an event, not a column.
- **Pending check is by event `seq`** (monotonic append order): a project's regen is pending when `max(seq) of narrative.requested > max(seq) of narrative.generated` (or no narrative.generated yet).
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Setup

```bash
git switch -c task-073-narrative-via-worker   # already created — confirm you're on it
```

---

## File Structure

- `src/db/events.ts` — add `narrative.requested` to `EventType` (modify).
- `src/narrative/regen.ts` — `requestNarrative`, `narrativeRegenPending`, `materializeNarrativeIfRequested` (create).
- `src/narrative/materialize.ts` — `materializeNarrative(db, projectId, …)` per-project (modify).
- `src/app/(app)/narrative/actions.ts` — `regenerate()` emits the request (modify).
- `src/worker/index.ts` — narrative regen step + `WorkerDeps.regenNarrative` (modify).
- `src/app/(app)/narrative/narrative-panel.tsx` — "queued" hint (modify).

---

## Task 1: `narrative.requested` event + the request path

**Files:**
- Modify: `src/db/events.ts`
- Create: `src/narrative/regen.ts`, `src/narrative/regen.test.ts`; Modify: `package.json`
- Modify: `src/app/(app)/narrative/actions.ts`

**Interfaces:**
- Produces: `EventType` member `"narrative.requested"`; `requestNarrative(db, input: { projectId: string; actorId?: string | null }): Promise<void>` (emits `narrative.requested` in a tx).

- [ ] **Step 1: Write the failing test**

Create `src/narrative/regen.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { project, events } from "../db/schema";
import { requestNarrative } from "./regen";

test("requestNarrative emits narrative.requested for the project", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    await requestNarrative(db, { projectId: p.id });
    const evs = await db.select().from(events).where(eq(events.type, "narrative.requested"));
    assert.equal(evs.length, 1);
    assert.equal(evs[0].projectId, p.id);
    assert.equal(evs[0].subjectType, "project");
  } finally { await close(); }
});
```

Append ` src/narrative/regen.test.ts` to the `package.json` `test` script.

- [ ] **Step 2: Run — fails**

Run: `npx tsx --test src/narrative/regen.test.ts` → FAIL (`narrative.requested` not in `EventType`; `requestNarrative` missing).

- [ ] **Step 3: Add the event type**

In `src/db/events.ts`, add to the `EventType` union (after `"narrative.generated"`):

```ts
  | "narrative.requested"
```

(Keep `"digest.generated"` as the terminator; insert the new line above it or anywhere in the union — it ends with `;` already.) Do NOT add it to `RATIONALE_REQUIRED`.

- [ ] **Step 4: Implement `requestNarrative` (`src/narrative/regen.ts`)**

```ts
import { and, eq, max } from "drizzle-orm";
import type { Db } from "../db/client";
import { events } from "../db/schema";
import { emitEvent } from "../db/events";

/**
 * Record a request to regenerate a project's narrative (REQ-016). A pure-intent
 * event — the log is the source of truth for "a regen is pending"; the worker
 * picks it up off the request path. Emitted in its own tx (atomic append).
 */
export async function requestNarrative(db: Db, input: { projectId: string; actorId?: string | null }): Promise<void> {
  await db.transaction(async (tx) => {
    await emitEvent(tx, {
      type: "narrative.requested",
      subjectType: "project",
      subjectId: input.projectId,
      actorId: input.actorId ?? null,
      payload: {},
      projectId: input.projectId,
    });
  });
}
```

- [ ] **Step 5: Change the action to request, not materialize**

Replace `src/app/(app)/narrative/actions.ts` entirely:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { activeProjectId } from "@/project/current";
import { requestNarrative } from "@/narrative/regen";

export async function regenerate() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await requestNarrative(getDb(), { projectId: await activeProjectId(), actorId: session.user.id });
  revalidatePath("/narrative");
  revalidatePath("/dashboard");
}
```

- [ ] **Step 6: Run + typecheck**

Run: `npx tsx --test src/narrative/regen.test.ts` → PASS. `npm run typecheck` → clean (the action no longer imports `materializeNarrative`; `materializeNarrative` is now only referenced by its own test — that's fine until Task 2).

- [ ] **Step 7: Commit**

```bash
git add src/db/events.ts src/narrative/regen.ts src/narrative/regen.test.ts "src/app/(app)/narrative/actions.ts" package.json
git commit -m "$(cat <<'EOF'
[TASK-073] narrative.requested event; Generate records a request, not the work (REQ-016)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `materializeNarrative` per-project

**Files:**
- Modify: `src/narrative/materialize.ts`, `src/narrative/materialize.test.ts`

**Interfaces:**
- Produces: `materializeNarrative(db, projectId: string, generate?: NarrativeGenerator, roadmapDeps?: RoadmapDeps): Promise<MaterializeNarrativeResult>` — scoped to `projectId`; 0 events → no-op `{ eventCount: 0, chapters: 0 }` (no throw, no write).

- [ ] **Step 1: Write the failing tests**

In `src/narrative/materialize.test.ts` (it already injects a fake generator + roadmap), update existing calls to pass a `projectId` and add scoping + no-op tests:

```ts
test("materializeNarrative is scoped to its project (no cross-project events)", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seedProjectWithEvent(db, "a/alpha"); // seed a project + at least one event (e.g. an idea.submitted)
    const b = await seedProjectWithEvent(db, "a/beta");
    const fakeGen = async (digest: string) => { /* capture */ capturedDigest = digest; return { ok: true as const, content: { chapters: [{ heading: "h", prose: "p", refs: [] }] } }; };
    let capturedDigest = "";
    await materializeNarrative(db, a.projectId, fakeGen, { generateRoadmap: async () => "<html></html>" });
    // the narrative row is on project a; the digest contains a's event, not b's
    const rows = await db.select().from(narratives).where(eq(narratives.projectId, a.projectId));
    assert.equal(rows.length, 1);
    assert.ok(!capturedDigest.includes("beta-only-marker")); // b's event must not appear
  } finally { await close(); }
});

test("materializeNarrative on a project with no events is a no-op (no row, no throw)", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/empty", installationId: 9, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const res = await materializeNarrative(db, p.id, async () => ({ ok: true as const, content: { chapters: [] } }), { generateRoadmap: async () => null });
    assert.deepEqual(res, { eventCount: 0, chapters: 0 });
    assert.equal((await db.select().from(narratives).where(eq(narratives.projectId, p.id))).length, 0);
  } finally { await close(); }
});
```

Adapt to the file's existing helpers/imports (it already imports `narratives`, `project`; add `eq` if missing; write a small `seedProjectWithEvent` that inserts a project + one event so `listActivity` returns something — use the existing event-seeding helper if present). Keep/repair the pre-existing materialize test by passing the new `projectId` arg.

- [ ] **Step 2: Run — fails**

Run: `npx tsx --test src/narrative/materialize.test.ts` → FAIL (arity/behavior).

- [ ] **Step 3: Make `materializeNarrative` per-project (`src/narrative/materialize.ts`)**

Change the signature and body: take `projectId` as the 2nd arg; scope `listActivity` to it; drop the `getActiveProjectId(db, null)` line; return a no-op on 0 events instead of throwing.

```ts
export async function materializeNarrative(
  db: Db,
  projectId: string,
  generate: NarrativeGenerator = defaultGenerator,
  roadmapDeps: RoadmapDeps = {},
): Promise<MaterializeNarrativeResult> {
  const items = (await listActivity(db, projectId, 2000)).slice().reverse();
  const eventCount = items.length;
  if (eventCount === 0) return { eventCount: 0, chapters: 0 }; // nothing to narrate — no-op (was: throw)

  const eventDigest = items
    .map((it) => {
      const who = it.actor ?? "system";
      const subject = it.subject ? ` ${it.subject}` : "";
      const why = it.why ? ` — ${it.why}` : "";
      return `- ${who} ${it.verb}${subject}${why}`;
    })
    .join("\n");

  const result = await generate(eventDigest, eventCount);
  if (!result.ok) throw new Error(`Narrative generation failed: ${result.failure}`);

  // Best-effort roadmap HTML — grounded in the chapters + this project's requirement statuses.
  const generateRoadmap = roadmapDeps.generateRoadmap ?? generateRoadmapHtml;
  let roadmapHtml: string | null = null;
  try {
    const reqRows = await db
      .select({ key: requirements.key, title: requirements.title, status: requirements.status })
      .from(requirements)
      .where(eq(requirements.projectId, projectId));
    roadmapHtml = await generateRoadmap({ chapters: result.content.chapters, requirements: reqRows });
  } catch (e) {
    console.error("[narrative] roadmap failed:", e instanceof Error ? e.message : e);
  }

  await db.transaction(async (tx) => {
    await tx.insert(narratives).values({ eventCount, content: result.content, projectId, roadmapHtml });
    await emitEvent(tx, {
      type: "narrative.generated",
      subjectType: "project",
      subjectId: projectId,
      payload: { event_count: eventCount, chapters: result.content.chapters.length },
      projectId,
    });
  });

  return { eventCount, chapters: result.content.chapters.length };
}
```

Remove the now-unused `getActiveProjectId` import. (`subjectId: projectId` is added to the event — fine.)

- [ ] **Step 4: Run + typecheck**

Run: `npx tsx --test src/narrative/materialize.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/narrative/materialize.ts src/narrative/materialize.test.ts
git commit -m "$(cat <<'EOF'
[TASK-073] materializeNarrative is per-project; empty project is a no-op (REQ-016)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Worker regenerates on request

**Files:**
- Modify: `src/narrative/regen.ts`, `src/narrative/regen.test.ts`
- Modify: `src/worker/index.ts`, `src/worker/worker.test.ts`

**Interfaces:**
- Consumes: `materializeNarrative` (Task 2); the `narrative.requested`/`narrative.generated` events.
- Produces: `narrativeRegenPending(db, projectId): Promise<boolean>`; `materializeNarrativeIfRequested(db, projectId, materialize?): Promise<{ regenerated: boolean }>`; `WorkerDeps.regenNarrative?`.

- [ ] **Step 1: Write the failing tests (regen.test.ts)**

```ts
import { narratives } from "../db/schema";
import { materializeNarrativeIfRequested, narrativeRegenPending } from "./regen";

async function emitGenerated(db: Db, projectId: string) {
  // simulate a completed narrative by inserting a row + emitting narrative.generated
  await db.transaction(async (tx) => {
    await tx.insert(narratives).values({ eventCount: 1, content: { chapters: [] }, projectId, roadmapHtml: null });
    // use emitEvent directly:
  });
}

test("narrativeRegenPending: true after a request, false once generated is newer", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    assert.equal(await narrativeRegenPending(db, p.id), false); // no request yet
    await requestNarrative(db, { projectId: p.id });
    assert.equal(await narrativeRegenPending(db, p.id), true);
    // a fake materialize that emits narrative.generated (newer seq) clears it
    await materializeNarrativeIfRequested(db, p.id, async (_d, pid) => { await fakeGenerated(db, pid); });
    assert.equal(await narrativeRegenPending(db, p.id), false);
  } finally { await close(); }
});

test("materializeNarrativeIfRequested only runs when a request is pending", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/c", installationId: 2, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    let calls = 0;
    const fake = async () => { calls++; };
    assert.deepEqual(await materializeNarrativeIfRequested(db, p.id, fake), { regenerated: false });
    assert.equal(calls, 0);
    await requestNarrative(db, { projectId: p.id });
    assert.deepEqual(await materializeNarrativeIfRequested(db, p.id, fake), { regenerated: true });
    assert.equal(calls, 1);
  } finally { await close(); }
});
```

Provide a `fakeGenerated(db, projectId)` helper in the test that inserts a `narratives` row AND emits `narrative.generated` via `emitEvent` inside one `db.transaction` (so its `seq` is newer than the request). Import `emitEvent` from `../db/events`.

- [ ] **Step 2: Run — fails**

Run: `npx tsx --test src/narrative/regen.test.ts` → FAIL (functions missing).

- [ ] **Step 3: Implement the pending check + the if-requested wrapper (`src/narrative/regen.ts`)**

Add to `regen.ts` (import `materializeNarrative` from `./materialize`):

```ts
import { materializeNarrative } from "./materialize";

async function maxSeq(db: Db, projectId: string, type: "narrative.requested" | "narrative.generated"): Promise<number | null> {
  const [row] = await db.select({ seq: max(events.seq) }).from(events).where(and(eq(events.projectId, projectId), eq(events.type, type)));
  return row?.seq ?? null;
}

/** A project's narrative regen is pending when a request was logged after its last
 *  generated narrative (REQ-016). Uses monotonic event seq, not wall-clock. */
export async function narrativeRegenPending(db: Db, projectId: string): Promise<boolean> {
  const reqSeq = await maxSeq(db, projectId, "narrative.requested");
  if (reqSeq == null) return false;
  const genSeq = await maxSeq(db, projectId, "narrative.generated");
  return genSeq == null || reqSeq > genSeq;
}

/** Regenerate a project's narrative iff a request is pending (REQ-016). The
 *  materialize fn is injectable for tests. */
export async function materializeNarrativeIfRequested(
  db: Db,
  projectId: string,
  materialize: (db: Db, projectId: string) => Promise<unknown> = materializeNarrative,
): Promise<{ regenerated: boolean }> {
  if (!(await narrativeRegenPending(db, projectId))) return { regenerated: false };
  await materialize(db, projectId);
  return { regenerated: true };
}
```

- [ ] **Step 4: Run regen tests**

Run: `npx tsx --test src/narrative/regen.test.ts` → PASS.

- [ ] **Step 5: Wire the worker (`src/worker/index.ts`)**

Import `materializeNarrativeIfRequested` from `../narrative/regen`. Add to `WorkerDeps`:

```ts
  regenNarrative?: (db: Db, projectId: string) => Promise<{ regenerated: boolean }>;
```

Add to the `tickForProject` destructuring defaults:

```ts
    regenNarrative = (d, pid) => materializeNarrativeIfRequested(d, pid),
```

Add a best-effort step **after** the spec-materialize block, **before** digest:

```ts
  // Regenerate this project's narrative only when one was requested (REQ-016).
  // The LLM work (narrative + roadmap, ~minute) runs here, off the web request
  // path. Best-effort: a failure is logged; the request stays pending and retries.
  try {
    const r = await regenNarrative(db, proj.id);
    if (r.regenerated) console.error(`[worker][${proj.id}] narrative regenerated`);
  } catch (e) {
    console.error(`[worker][${proj.id}] narrative regen skipped:`, formatError(e));
  }
```

- [ ] **Step 6: Worker test stub + a test (`src/worker/worker.test.ts`)**

Add `regenNarrative: async () => ({ regenerated: false }),` to every existing `deps: WorkerDeps` object. Append:

```ts
test("tick regenerates a project's narrative only when requested", async () => {
  const { db, close } = await createTestDb();
  try {
    const projAId = await seedProject(db, "acme/repo-a");
    const calls: string[] = [];
    const deps: WorkerDeps = {
      refreshClone: async () => {},
      generate: async () => ({ ok: true, taskKeys: [] }),
      createIssues: async () => ({ created: [] }),
      createBranches: async () => ({ created: [] }),
      closeIssues: async () => ({ closed: [] }),
      specMaterialize: async () => ({ status: "already-materialized", requirementCount: 0 }),
      regenNarrative: async (_d, pid) => { calls.push(pid); return { regenerated: false }; },
      digest: async () => ({ generated: false, reason: "nothing new" }),
    };
    await tick(db, deps);
    assert.deepEqual(calls, [projAId]);
  } finally { await close(); }
});
```

- [ ] **Step 7: Run worker tests + typecheck**

Run: `npx tsx --test src/worker/worker.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/narrative/regen.ts src/narrative/regen.test.ts src/worker/index.ts src/worker/worker.test.ts
git commit -m "$(cat <<'EOF'
[TASK-073] worker regenerates the narrative off the request path, per request (REQ-016)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: "Regenerating… (queued)" hint on /narrative

**Files:**
- Modify: `src/app/(app)/narrative/narrative-panel.tsx`

> No unit test (React server component) — `narrativeRegenPending` is already tested (Task 3). Verify via typecheck/build + the runtime walkthrough.

- [ ] **Step 1: Show the pending state**

In `src/app/(app)/narrative/narrative-panel.tsx`, read the pending flag and reflect it. Add the import and the read:

```tsx
import { narrativeRegenPending } from "@/narrative/regen";
// …
  const pid = await activeProjectId();
  const n = await getLatestNarrative(getDb(), pid);
  const pending = await narrativeRegenPending(getDb(), pid);
```

Add a hint above the form (when pending) and adjust the button:

```tsx
      {pending && (
        <p className="mt-3 font-mono text-[11px] text-planned">Regenerating… queued for the next worker pass (~a minute); refresh to see it.</p>
      )}
      <form action={regenerate} className="mt-4">
        <button type="submit" disabled={pending} className={buttonClass(n ? "quiet" : "primary")}>
          {pending ? "Regenerating…" : n ? "Regenerate" : "Generate"}
        </button>
      </form>
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck` then `npm run build` → both clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/narrative/narrative-panel.tsx"
git commit -m "$(cat <<'EOF'
[TASK-073] show a queued hint while the narrative regenerates (REQ-016)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Verify, review, PR

**Files:** none (verification + review + integration).

- [ ] **Step 1: Full verify**

Run: `npm test` (all pass incl. the new narrative/worker tests; re-run once on a transient V8/JIT crash). `npm run typecheck`. `npm run build`. Grep that the old synchronous path is gone: the `regenerate()` action no longer imports/calls `materializeNarrative`; `materializeNarrative` is called only by `materializeNarrativeIfRequested` (+ tests).

- [ ] **Step 2: Event-integrity review**

Dispatch `event-integrity-reviewer` on the branch diff. Confirm: `narrative.requested` emitted in a tx (pure-intent event, precedent: `spec.materialized` has no DB row); `narrative.generated` + the `narratives` row still in the materialize tx; the worker step is best-effort + outside any tx; no `github_status`; the pending check is read-only; LLM output still validated (generate throws on malformed → no partial); no `any`; maps to REQ-016.

- [ ] **Step 3: Runtime walkthrough**

On the deploy: open `/narrative`, click Generate → the action returns instantly and the page shows "Regenerating… queued"; within ~one to two worker ticks the worker logs `narrative regenerated` and a refresh shows the new story (the active project's own) + roadmap; clicking again re-queues. Confirm the button no longer hangs for ~75s. (No migration; worker+web restart.)

- [ ] **Step 4: PR**

```bash
git push -u origin task-073-narrative-via-worker
gh pr create --title "[TASK-073] generate the narrative in the worker, off the request path (REQ-016)" --body "…"
```

Body: summarize the root cause (75s synchronous action → timeout) and the fix (request event → worker regen, per-project); note no migration, worker+web deploy. Squash-merge.

---

## Self-Review

**Spec coverage** (against `2026-06-26-narrative-via-worker-design.md`):
- §1 `narrative.requested` event + action emits it → Task 1. ✔
- §2 `materializeNarrative` per-project + 0-events no-op → Task 2. ✔
- §3 `narrativeRegenPending` + `materializeNarrativeIfRequested` + worker step (best-effort, after spec materialize, on-demand) → Task 3. ✔
- §4 page "queued" hint (the page already reads per-project via `getLatestNarrative(activeProjectId())`) → Task 4. ✔
- §5 truth model (events in-tx, no github_status, no migration, no `any`) → Global Constraints + Task 5 review. ✔
- Edge: empty project → no-op (Task 2); double-click → one regen (seq comparison, Task 3); persistent failure → retries each tick (best-effort, noted); roadmap best-effort unchanged (Task 2). ✔

**Placeholder scan:** the only `…` is the `gh pr create` body. No TBD/TODO. The test helpers (`seedProjectWithEvent`, `fakeGenerated`) are described with their exact required behavior (insert project+event / insert narratives row + emit narrative.generated in one tx) — concrete, to adapt to the file's existing helpers.

**Type consistency:** `requestNarrative(db, {projectId, actorId?})→void` (Task 1) called by the action (Task 1) + tests; `materializeNarrative(db, projectId, generate?, roadmapDeps?)` (Task 2) called by `materializeNarrativeIfRequested`'s default (Task 3); `narrativeRegenPending(db, projectId)→boolean` (Task 3) used by the worker wrapper + the page (Task 4); `materializeNarrativeIfRequested(db, projectId, materialize?)→{regenerated}` (Task 3) = `WorkerDeps.regenNarrative` shape; the pending check compares `max(events.seq)` of `narrative.requested` vs `narrative.generated`. Consistent.
