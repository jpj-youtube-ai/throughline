# Design-prototype library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a team upload project-level HTML design prototypes that are fed into task generation as rendered screenshots and linked from the generated GitHub issues.

**Architecture:** A `prototypes` table (per project) stores uploaded HTML + a rendered-PNG cache. The web upload action stores HTML (+ event); a worker sweep renders the PNG (Puppeteer, off the request path). Generation loads the rendered PNGs and passes them as vision image blocks; issue creation appends a "Design references" links section pointing at a public PNG route.

**Tech Stack:** TypeScript, Next.js (App Router, server actions), Postgres + Drizzle, Anthropic SDK (vision), Puppeteer (existing `renderHtmlToPng`), `node:test` + PGlite.

**Design doc:** `docs/superpowers/specs/2026-06-25-design-prototype-library-design.md`

## Global Constraints

- **Requirement linkage:** a **new requirement** — **REQ-030 "Design prototype context"** (declared via `declare-req`, provenance `drift`, in Task 7). Every commit/PR uses `[TASK-068]` and references REQ-030. (Confirm REQ-030 is the next free id at planning/declare time.)
- **Truth model:** `prototype.added` / `prototype.removed` are emitted **in the same transaction** as the row insert/delete (precedent: `setContextPins` → `project.context_pins_changed`). The rendered `image` is a **derived cache** filled by the worker — **no event** (precedent: `preview_image`). No `github_status` write. Events append-only; `emitEvent` is the only event writer, always inside a tx.
- **External work off the request path:** rendering (Puppeteer) happens in the **worker sweep**, best-effort (try/catch + log), never in a DB tx, never in the upload action.
- **No `any` in domain code.**
- **Generation budget:** the prototype images fold into the generation `fixed` token estimate (~1500 tokens/image) so the repo slice shrinks within the 40k cap; cap the images fed at **6**.
- **Conventions:** branch `task-068-design-prototype-library`; PR title + squash start `[TASK-068]`.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **New `*.test.ts` files MUST be registered** in the enumerated `package.json` `test` script.
- **A new Drizzle migration is NOT auto-applied to the live DB and tests won't catch it** — generate it, and the controller hand-applies the `CREATE TABLE` to live Postgres at deploy (Task 1 notes this).

## Setup (before Task 1)

```bash
git switch -c task-068-design-prototype-library
```

---

## File Structure

- `src/db/schema.ts` — `prototypes` table (modify).
- `src/db/events.ts` — `prototype.added` / `prototype.removed` event types (modify).
- `src/prototypes/store.ts` — `addPrototype`, `removePrototype`, `loadProjectPrototypes` (create).
- `src/prototypes/serve.ts` — `getPrototypePng` (create).
- `src/prototypes/render.ts` — `renderPrototypeImages` worker sweep (create).
- `src/prototypes/*.test.ts` — tests (create + register).
- `src/app/prototype/[id]/route.ts` — public PNG serve (create).
- `src/generation/run.ts` — image content blocks (modify).
- `src/generation/orchestrate.ts` — load + pass prototype images + budget (modify).
- `src/prompt.ts` — `SYSTEM_PROMPT` prototype rule (modify).
- `src/worker/index.ts` — render sweep step + dep (modify).
- `src/github/issues.ts` — Design references section (modify).
- `src/app/(app)/connect/...` — "Design prototypes" upload+list UI + actions (modify/create).

---

## Task 1: Schema + event types + migration

**Files:**
- Modify: `src/db/schema.ts` (new `prototypes` table)
- Modify: `src/db/events.ts` (`EventType` union)
- Create (generated): `drizzle/00NN_*.sql`
- Create: `src/db/prototypes-schema.test.ts`
- Modify: `package.json` (register the test)

**Interfaces:**
- Produces: the `prototypes` table — `{ id: uuid, projectId: uuid, label: text, html: text, image: bytea|null, createdAt }`. Drizzle export `prototypes`. Event types `"prototype.added"`, `"prototype.removed"`.

- [ ] **Step 1: Write the failing round-trip test**

Create `src/db/prototypes-schema.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "./client";
import { project, prototypes } from "./schema";

test("prototypes row round-trips html + nullable image, scoped to a project", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const [row] = await db.insert(prototypes).values({ projectId: p.id, label: "Search page", html: "<html><body>hi</body></html>" }).returning({ id: prototypes.id });

    const [fresh] = await db.select({ label: prototypes.label, html: prototypes.html, image: prototypes.image }).from(prototypes).where(eq(prototypes.id, row.id));
    assert.equal(fresh.label, "Search page");
    assert.match(fresh.html, /hi/);
    assert.equal(fresh.image, null, "image defaults null until rendered");

    await db.update(prototypes).set({ image: png }).where(eq(prototypes.id, row.id));
    const [withImg] = await db.select({ image: prototypes.image }).from(prototypes).where(eq(prototypes.id, row.id));
    assert.deepEqual(Buffer.from(withImg.image as Uint8Array), png);
  } finally { await close(); }
});
```

- [ ] **Step 2: Register the test in `package.json`**

Append ` src/db/prototypes-schema.test.ts` to the `"test"` script list.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx tsx --test src/db/prototypes-schema.test.ts`
Expected: FAIL — `prototypes` is not exported from `./schema`.

- [ ] **Step 4: Add the table + event types**

In `src/db/schema.ts`, after the `tasks` table (the `bytea` customType is already defined at the top of the file — reuse it), add:

```ts
export const prototypes = pgTable("prototypes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => project.id),
  label: text("label").notNull(),
  html: text("html").notNull(),
  // Rendered-PNG cache (derived; regenerable, no event) — filled by the worker sweep.
  image: bytea("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

In `src/db/events.ts`, add to the `EventType` union (after `digest.generated`):

```ts
  | "prototype.added"
  | "prototype.removed";
```

(Move the trailing `;` so it terminates the last member.)

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/00NN_*.sql` with `CREATE TABLE "prototypes" (...)`. The test DB rebuilds from all `drizzle/*.sql`, so the table is now present in PGlite.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx tsx --test src/db/prototypes-schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/events.ts src/db/prototypes-schema.test.ts package.json drizzle/
git commit -m "$(cat <<'EOF'
[TASK-068] prototypes table + prototype.added/removed events (REQ-030)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Live DB (deploy-time, controller)**

The migration is NOT applied to live Postgres by `db:migrate`. At deploy, the controller hand-applies the generated `CREATE TABLE "prototypes" ...` (with the FK) to `DATABASE_URL` and verifies via `information_schema.tables`, then `npm run db:check`. Not part of the implementer's task.

---

## Task 2: Prototype store (add / remove / load) + serve reader

**Files:**
- Create: `src/prototypes/store.ts`
- Create: `src/prototypes/serve.ts`
- Create: `src/prototypes/store.test.ts`
- Modify: `package.json` (register the test)

**Interfaces:**
- Consumes: `prototypes` table (Task 1); `emitEvent`.
- Produces:
  - `addPrototype(db, input: { projectId: string; label: string; html: string; actorId?: string | null }): Promise<{ id: string }>`
  - `removePrototype(db, input: { id: string; actorId?: string | null }): Promise<{ removed: boolean }>`
  - `loadProjectPrototypes(db, projectId: string, opts?: { limit?: number }): Promise<{ id: string; label: string; image: Buffer }[]>` (rendered only, newest-first, cap default 6)
  - `getPrototypePng(db, id: string): Promise<Buffer | null>`

- [ ] **Step 1: Write the failing tests**

Create `src/prototypes/store.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { project, prototypes, events } from "../db/schema";
import { addPrototype, removePrototype, loadProjectPrototypes } from "./store";
import { getPrototypePng } from "./serve";

async function seedProject(db: Db, repo: string, inst: number): Promise<string> {
  const [p] = await db.insert(project).values({ repoFullName: repo, installationId: inst, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
  return p.id;
}

test("addPrototype inserts and emits prototype.added in one tx", async () => {
  const { db, close } = await createTestDb();
  try {
    const pid = await seedProject(db, "a/b", 1);
    const { id } = await addPrototype(db, { projectId: pid, label: "Home", html: "<h1>Home</h1>" });
    const [row] = await db.select().from(prototypes).where(eq(prototypes.id, id));
    assert.equal(row.label, "Home");
    assert.equal(row.image, null);
    const evs = await db.select().from(events).where(eq(events.type, "prototype.added"));
    assert.equal(evs.length, 1);
    assert.equal(evs[0].projectId, pid);
  } finally { await close(); }
});

test("removePrototype deletes and emits prototype.removed in one tx", async () => {
  const { db, close } = await createTestDb();
  try {
    const pid = await seedProject(db, "a/b", 1);
    const { id } = await addPrototype(db, { projectId: pid, label: "Home", html: "<h1>Home</h1>" });
    const r = await removePrototype(db, { id });
    assert.equal(r.removed, true);
    assert.equal((await db.select().from(prototypes).where(eq(prototypes.id, id))).length, 0);
    assert.equal((await db.select().from(events).where(eq(events.type, "prototype.removed"))).length, 1);
    // removing a non-existent id is a clean no-op
    assert.deepEqual(await removePrototype(db, { id: "00000000-0000-0000-0000-000000000000" }), { removed: false });
  } finally { await close(); }
});

test("loadProjectPrototypes returns rendered ones only, newest-first, capped + scoped", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seedProject(db, "a/alpha", 1);
    const b = await seedProject(db, "a/beta", 2);
    const png = Buffer.from([1, 2, 3]);
    // a: one rendered (old), one rendered (new), one unrendered
    await db.insert(prototypes).values({ projectId: a, label: "A-old", html: "x", image: png, createdAt: new Date("2026-01-01T00:00:00Z") });
    await db.insert(prototypes).values({ projectId: a, label: "A-new", html: "x", image: png, createdAt: new Date("2026-01-02T00:00:00Z") });
    await db.insert(prototypes).values({ projectId: a, label: "A-unrendered", html: "x", createdAt: new Date("2026-01-03T00:00:00Z") });
    await db.insert(prototypes).values({ projectId: b, label: "B", html: "x", image: png });

    const got = await loadProjectPrototypes(db, a);
    assert.deepEqual(got.map((g) => g.label), ["A-new", "A-old"], "rendered only, newest-first, no B leakage");
    assert.ok(Buffer.isBuffer(got[0].image));

    const capped = await loadProjectPrototypes(db, a, { limit: 1 });
    assert.equal(capped.length, 1);
  } finally { await close(); }
});

test("getPrototypePng returns the stored PNG, null for a bad/absent id", async () => {
  const { db, close } = await createTestDb();
  try {
    const pid = await seedProject(db, "a/b", 1);
    const png = Buffer.from([9, 9, 9]);
    const [row] = await db.insert(prototypes).values({ projectId: pid, label: "x", html: "x", image: png }).returning({ id: prototypes.id });
    assert.deepEqual(await getPrototypePng(db, row.id), png);
    assert.equal(await getPrototypePng(db, "not-a-uuid"), null);
  } finally { await close(); }
});
```

- [ ] **Step 2: Register the test in `package.json`**

Append ` src/prototypes/store.test.ts` to the `"test"` script list.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx tsx --test src/prototypes/store.test.ts`
Expected: FAIL — modules `./store` / `./serve` missing.

- [ ] **Step 4: Implement the store + serve**

Create `src/prototypes/store.ts`:

```ts
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { prototypes } from "../db/schema";
import { emitEvent } from "../db/events";

/** Add a project design prototype (REQ-030): store HTML + emit prototype.added in
 *  one tx. The PNG is rendered later by the worker sweep (no render here). */
export async function addPrototype(
  db: Db,
  input: { projectId: string; label: string; html: string; actorId?: string | null },
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(prototypes)
      .values({ projectId: input.projectId, label: input.label, html: input.html })
      .returning({ id: prototypes.id });
    await emitEvent(tx, {
      type: "prototype.added",
      subjectType: "prototype",
      subjectId: row.id,
      actorId: input.actorId ?? null,
      payload: { label: input.label },
      projectId: input.projectId,
    });
    return row;
  });
}

/** Remove a prototype (REQ-030): delete + emit prototype.removed in one tx. */
export async function removePrototype(
  db: Db,
  input: { id: string; actorId?: string | null },
): Promise<{ removed: boolean }> {
  const [row] = await db.select({ projectId: prototypes.projectId, label: prototypes.label }).from(prototypes).where(eq(prototypes.id, input.id)).limit(1);
  if (!row) return { removed: false };
  await db.transaction(async (tx) => {
    await tx.delete(prototypes).where(eq(prototypes.id, input.id));
    await emitEvent(tx, {
      type: "prototype.removed",
      subjectType: "prototype",
      subjectId: input.id,
      actorId: input.actorId ?? null,
      payload: { label: row.label },
      projectId: row.projectId,
    });
  });
  return { removed: true };
}

/** The project's rendered prototypes for the generation context (REQ-030/008) —
 *  newest-first, rendered only, capped. */
export async function loadProjectPrototypes(
  db: Db,
  projectId: string,
  opts: { limit?: number } = {},
): Promise<{ id: string; label: string; image: Buffer }[]> {
  const rows = await db
    .select({ id: prototypes.id, label: prototypes.label, image: prototypes.image })
    .from(prototypes)
    .where(and(eq(prototypes.projectId, projectId), isNotNull(prototypes.image)))
    .orderBy(desc(prototypes.createdAt))
    .limit(opts.limit ?? 6);
  return rows.map((r) => ({ id: r.id, label: r.label, image: Buffer.from(r.image as Uint8Array) }));
}
```

Create `src/prototypes/serve.ts` (mirror `src/preview/serve.ts`):

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { prototypes } from "../db/schema";

/** Fetch a prototype's rendered PNG by id, or null. */
export async function getPrototypePng(db: Db, id: string): Promise<Buffer | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select({ img: prototypes.image }).from(prototypes).where(eq(prototypes.id, id)).limit(1);
  return row?.img ? Buffer.from(row.img as Uint8Array) : null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsx --test src/prototypes/store.test.ts`
Expected: PASS (all four).

- [ ] **Step 6: Commit**

```bash
git add src/prototypes/store.ts src/prototypes/serve.ts src/prototypes/store.test.ts package.json
git commit -m "$(cat <<'EOF'
[TASK-068] prototype store: add/remove (+events), load, serve (REQ-030)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Render sweep + worker wiring

**Files:**
- Create: `src/prototypes/render.ts`
- Create: `src/prototypes/render.test.ts`
- Modify: `src/worker/index.ts` (`WorkerDeps` + tick step)
- Modify: `src/worker/worker.test.ts` (stubs + a test)
- Modify: `package.json` (register the render test)

**Interfaces:**
- Consumes: `prototypes` table; `renderHtmlToPng` (`../preview/render`).
- Produces: `renderPrototypeImages(db, projectId: string, render?: (html: string) => Promise<Buffer>): Promise<{ rendered: string[] }>`; `WorkerDeps.renderPrototypes?: (db, projectId) => Promise<{ rendered: string[] }>`.

- [ ] **Step 1: Write the failing render test**

Create `src/prototypes/render.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { project, prototypes } from "../db/schema";
import { renderPrototypeImages } from "./render";

async function seed(db: Db, repo: string, inst: number): Promise<string> {
  const [p] = await db.insert(project).values({ repoFullName: repo, installationId: inst, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
  return p.id;
}

test("renderPrototypeImages renders only un-rendered prototypes, stores the PNG, project-scoped", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seed(db, "a/alpha", 1);
    const b = await seed(db, "a/beta", 2);
    const [unrendered] = await db.insert(prototypes).values({ projectId: a, label: "A1", html: "<h1>a</h1>" }).returning({ id: prototypes.id });
    await db.insert(prototypes).values({ projectId: a, label: "A2", html: "x", image: Buffer.from([1]) }); // already rendered → skip
    await db.insert(prototypes).values({ projectId: b, label: "B1", html: "<h1>b</h1>" }); // other project → skip

    const calls: string[] = [];
    const fakeRender = async (html: string) => { calls.push(html); return Buffer.from([7, 7, 7]); };

    const r = await renderPrototypeImages(db, a, fakeRender);
    assert.deepEqual(r.rendered, [unrendered.id]);
    assert.deepEqual(calls, ["<h1>a</h1>"], "only the un-rendered A prototype rendered");
    const [row] = await db.select({ image: prototypes.image }).from(prototypes).where(eq(prototypes.id, unrendered.id));
    assert.deepEqual(Buffer.from(row.image as Uint8Array), Buffer.from([7, 7, 7]));
  } finally { await close(); }
});

test("renderPrototypeImages: a render failure is isolated and leaves image null (retryable)", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seed(db, "a/alpha", 1);
    const [p1] = await db.insert(prototypes).values({ projectId: a, label: "boom", html: "1" }).returning({ id: prototypes.id });
    const [p2] = await db.insert(prototypes).values({ projectId: a, label: "ok", html: "2" }).returning({ id: prototypes.id });
    const render = async (html: string) => { if (html === "1") throw new Error("chromium boom"); return Buffer.from([2]); };
    const r = await renderPrototypeImages(db, a, render);
    assert.deepEqual(r.rendered, [p2.id]);
    assert.equal((await db.select({ i: prototypes.image }).from(prototypes).where(eq(prototypes.id, p1.id)))[0].i, null);
  } finally { await close(); }
});
```

- [ ] **Step 2: Register the test in `package.json`**

Append ` src/prototypes/render.test.ts` to the `"test"` script list.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx tsx --test src/prototypes/render.test.ts`
Expected: FAIL — `renderPrototypeImages` not exported.

- [ ] **Step 4: Implement the sweep**

Create `src/prototypes/render.ts`:

```ts
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { prototypes } from "../db/schema";
import { renderHtmlToPng } from "../preview/render";

/** Render any of a project's prototypes that don't have a PNG yet (REQ-030).
 *  Best-effort + idempotent (skips already-rendered); a per-prototype failure
 *  leaves image null for the next sweep. Runs in the worker (Puppeteer). */
export async function renderPrototypeImages(
  db: Db,
  projectId: string,
  render: (html: string) => Promise<Buffer> = renderHtmlToPng,
): Promise<{ rendered: string[] }> {
  const pending = await db
    .select({ id: prototypes.id, html: prototypes.html })
    .from(prototypes)
    .where(and(eq(prototypes.projectId, projectId), isNull(prototypes.image)));

  const rendered: string[] = [];
  for (const p of pending) {
    try {
      const png = await render(p.html);
      await db.update(prototypes).set({ image: png }).where(eq(prototypes.id, p.id));
      rendered.push(p.id);
    } catch (e) {
      console.error(`[prototypes] render failed for ${p.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return { rendered };
}
```

- [ ] **Step 5: Run the render test to verify it passes**

Run: `npx tsx --test src/prototypes/render.test.ts`
Expected: PASS (both).

- [ ] **Step 6: Wire the worker**

In `src/worker/index.ts`: import `renderPrototypeImages`; add to `WorkerDeps`:

```ts
  renderPrototypes?: (db: Db, projectId: string) => Promise<{ rendered: string[] }>;
```

Add to the `tickForProject` destructuring defaults:

```ts
    renderPrototypes = (d, pid) => renderPrototypeImages(d, pid),
```

Add a best-effort step (after the close-issues step, before spec materialize):

```ts
  // Render any newly-uploaded design prototypes to PNG (REQ-030) — Puppeteer, off
  // the web request path. Best-effort; a failure never aborts the tick.
  try {
    const { rendered } = await renderPrototypes(db, proj.id);
    if (rendered.length) console.error(`[worker][${proj.id}] rendered ${rendered.length} prototype(s)`);
  } catch (e) {
    console.error(`[worker][${proj.id}] prototype render skipped:`, formatError(e));
  }
```

- [ ] **Step 7: Worker test stubs + a test**

In `src/worker/worker.test.ts`, add `renderPrototypes: async () => ({ rendered: [] }),` to every existing `deps: WorkerDeps` object (next to `closeIssues`). Then append:

```ts
test("tick renders prototypes for each project each tick", async () => {
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
      renderPrototypes: async (_d, pid) => { calls.push(pid); return { rendered: [] }; },
      specMaterialize: async () => ({ status: "already-materialized", requirementCount: 0 }),
      digest: async () => ({ generated: false, reason: "nothing new" }),
    };
    await tick(db, deps);
    assert.deepEqual(calls, [projAId]);
  } finally { await close(); }
});
```

> Note: `specMaterialize` stub shape assumes TASK-066 merged (`{ status, requirementCount }`). If this branch predates that merge, use the then-current shape.

- [ ] **Step 8: Run worker tests + typecheck**

Run: `npx tsx --test src/worker/worker.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/prototypes/render.ts src/prototypes/render.test.ts src/worker/index.ts src/worker/worker.test.ts package.json
git commit -m "$(cat <<'EOF'
[TASK-068] worker renders prototype PNGs each tick (REQ-030)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Feed prototypes into generation (vision)

**Files:**
- Modify: `src/generation/run.ts` (image content blocks)
- Modify: `src/generation/orchestrate.ts` (load + pass + budget)
- Modify: `src/prompt.ts` (SYSTEM_PROMPT rule)
- Modify: `src/prompt.test.ts` (rule assertion)
- Modify: `src/generation/run.test.ts` if present, else add a focused test (see Step 1)

**Interfaces:**
- Consumes: `loadProjectPrototypes` (Task 2).
- Produces: `generateTasks` accepts `images?: { mediaType: string; data: string }[]` and builds vision content blocks.

- [ ] **Step 1: Write the failing test for the message construction**

The pure message-building is the testable unit. Extract it so it's unit-testable. Add to a new `src/generation/run.test.ts` (register it):

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildUserContent } from "./run";

test("buildUserContent returns the bare text when no images", () => {
  assert.deepEqual(buildUserContent("hello", []), [{ type: "text", text: "hello" }]);
});

test("buildUserContent appends base64 image blocks after the text", () => {
  const c = buildUserContent("prompt", [{ mediaType: "image/png", data: "AAAA" }]);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], { type: "text", text: "prompt" });
  assert.deepEqual(c[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
});
```

In `src/prompt.test.ts`, add:

```ts
test("SYSTEM_PROMPT carries the design-prototype grounding rule", () => {
  assert.ok(/design[- ]prototype screenshots/i.test(SYSTEM_PROMPT));
});
```

- [ ] **Step 2: Register `run.test.ts` + run to verify it fails**

Append ` src/generation/run.test.ts` to the `"test"` script. Run:
`npx tsx --test src/generation/run.test.ts src/prompt.test.ts`
Expected: FAIL — `buildUserContent` not exported; SYSTEM_PROMPT lacks the rule.

- [ ] **Step 3: Implement in `run.ts`**

In `src/generation/run.ts`, add the image type to `GenerateTasksArgs`:

```ts
  images?: { mediaType: string; data: string }[]; // prototype screenshots (REQ-030)
```

Export the content builder and use it for the first user message:

```ts
import type Anthropic from "@anthropic-ai/sdk";

export function buildUserContent(
  userMessage: string,
  images: { mediaType: string; data: string }[],
): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: userMessage }];
  for (const img of images) {
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType as "image/png", data: img.data } });
  }
  return content;
}
```

Change the initial `messages` construction from a bare string to:

```ts
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildUserContent(args.userMessage, args.images ?? []) },
  ];
```

- [ ] **Step 4: Add the SYSTEM_PROMPT rule (`src/prompt.ts`)**

In the `Rules:` list of `SYSTEM_PROMPT`, add a bullet:

```
- You may be given design-prototype screenshots of the product. When present, ground each task's pointers and acceptance_check in the intended design they show (layout, components, copy, flows); do not propose UI that contradicts them. They are reference, not a file to reproduce verbatim.
```

- [ ] **Step 5: Wire `orchestrate.ts`**

In both `generateForApprovedIdea` and `generateForRequirement`, after the project is resolved, load prototype images and fold them into the budget + pass them. Add the import `import { loadProjectPrototypes } from "../prototypes/store";`. In each function:

```ts
  const prototypeRows = await loadProjectPrototypes(db, proj.id);
  const images = prototypeRows.map((p) => ({ mediaType: "image/png", data: p.image.toString("base64") }));
```

Add to that function's `fixed` (each image ~1500 tokens):

```ts
    + images.length * 1500
```

And add `images,` to the `generateTasks({ ... })` call.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx tsx --test src/generation/run.test.ts src/prompt.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors. (The existing `orchestrate-requirement.test.ts` still passes — its nonexistent clone path means zero prototypes, so `images` is `[]` and behavior is unchanged.)

- [ ] **Step 7: Commit**

```bash
git add src/generation/run.ts src/generation/run.test.ts src/generation/orchestrate.ts src/prompt.ts src/prompt.test.ts package.json
git commit -m "$(cat <<'EOF'
[TASK-068] feed project prototype screenshots into generation (vision) (REQ-030)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Public serve route + issue "Design references"

**Files:**
- Create: `src/app/prototype/[id]/route.ts`
- Modify: `src/github/issues.ts` (Design references section)
- Modify: `src/github/issues.test.ts`

**Interfaces:**
- Consumes: `getPrototypePng` (Task 2); `prototypes` table.
- Produces: a public `/prototype/<id>.png` route; issue bodies gain a `## Design references` section.

- [ ] **Step 1: Write the failing issues test**

In `src/github/issues.test.ts`, add (it already imports `createTestDb`, `project`, `requirements`, `tasks`, `createIssuesForTasks`; add `prototypes` to the schema import):

```ts
test("createIssuesForTasks appends a Design references section linking the project's prototypes", async () => {
  const { db, close } = await createTestDb();
  try {
    const { projId, reqId } = await seedProject(db, "acme/repo", 88);
    const [proto] = await db.insert(prototypes).values({ projectId: projId, label: "Search page", html: "x", image: Buffer.from([1]) }).returning({ id: prototypes.id });
    await db.insert(tasks).values({ key: "TASK-001", title: "A", body: "do it", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId });

    const bodies: string[] = [];
    const fakeOpen = async (_i: number, _r: string, _t: string, body: string) => { bodies.push(body); return { number: 1, url: "u" }; };
    await createIssuesForTasks(db, projId, fakeOpen, { baseUrl: "https://b.test" });

    assert.match(bodies[0], /## Design references/);
    assert.match(bodies[0], new RegExp(`\\[Search page\\]\\(https://b\\.test/prototype/${proto.id}\\.png\\)`));
  } finally { await close(); }
});

test("createIssuesForTasks omits Design references when the project has no prototypes", async () => {
  const { db, close } = await createTestDb();
  try {
    const { projId, reqId } = await seedProject(db, "acme/repo2", 89);
    await db.insert(tasks).values({ key: "TASK-001", title: "A", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId });
    const bodies: string[] = [];
    await createIssuesForTasks(db, projId, async (_i, _r, _t, body) => { bodies.push(body); return { number: 1, url: "u" }; }, { baseUrl: "https://b.test" });
    assert.doesNotMatch(bodies[0], /Design references/);
  } finally { await close(); }
});
```

(`seedProject` already exists in that file and returns `{ projId, reqId }`. `PreviewDeps` already accepts `baseUrl`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/github/issues.test.ts`
Expected: FAIL — no Design references section is produced.

- [ ] **Step 3: Implement the Design references section**

In `src/github/issues.ts`, import the table: `import { tasks, project, prototypes } from "../db/schema";`. In `createIssuesForTasks`, after `baseUrl` is resolved and before the `for (const t of pending)` loop, build the references once:

```ts
  let designRefs = "";
  if (baseUrl) {
    const protos = await db.select({ id: prototypes.id, label: prototypes.label }).from(prototypes).where(eq(prototypes.projectId, resolvedProjectId));
    if (protos.length) {
      designRefs = "\n\n## Design references\n" + protos.map((p) => `- [${p.label}](${baseUrl}/prototype/${p.id}.png)`).join("\n");
    }
  }
```

Append `designRefs` to the issue body — change the `openIssue(...)` call's body argument from `bodyPrefix + t.body` to:

```ts
    const issue = await openIssue(proj.installationId, proj.repoFullName, `[${t.key}] ${t.title}`, bodyPrefix + t.body + designRefs);
```

- [ ] **Step 4: Create the public serve route**

Create `src/app/prototype/[id]/route.ts` (mirror `src/app/preview/[id]/route.ts`):

```ts
import { getDb } from "@/db/client";
import { getPrototypePng } from "@/prototypes/serve";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const png = await getPrototypePng(getDb(), id.replace(/\.png$/i, ""));
  if (!png) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
```

- [ ] **Step 5: Run the issues test + build**

Run: `npx tsx --test src/github/issues.test.ts`
Expected: PASS (new tests + existing ones).
Run: `npm run build`
Expected: success (the new route compiles).

- [ ] **Step 6: Commit**

```bash
git add src/github/issues.ts src/github/issues.test.ts "src/app/prototype/[id]/route.ts"
git commit -m "$(cat <<'EOF'
[TASK-068] serve prototype PNGs + Design references in issues (REQ-030, REQ-009)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Upload UI on /connect

**Files:**
- Create: `src/app/(app)/connect/prototypes.tsx` (the "Design prototypes" section — server component listing + the client upload form)
- Create/Modify: `src/app/(app)/connect/actions.ts` (server actions `addPrototypeAction`, `removePrototypeAction`)
- Modify: `src/app/(app)/connect/page.tsx` (render the section)

**Interfaces:**
- Consumes: `addPrototype`, `removePrototype`, `loadProjectPrototypes` / a list query (Task 2); `activeProjectId`; `auth`.

> No unit test (React + auth-gated actions) — verified by typecheck + build + the runtime walkthrough (Task 7). Use the `impeccable` / `ui-ux-pro-max` tooling to fit the ledger design system; mirror `spec-upload.tsx` (file upload) and the existing pins UI.

- [ ] **Step 1: Server actions (`connect/actions.ts`)**

Add (alongside the existing connect/pins actions):

```ts
"use server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { activeProjectId } from "@/project/current";
import { addPrototype, removePrototype } from "@/prototypes/store";

export type ProtoState = { ok: true } | { ok: false; error: string } | null;

export async function addPrototypeAction(_prev: ProtoState, formData: FormData): Promise<ProtoState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const label = String(formData.get("label") ?? "").trim();
  const file = formData.get("file");
  if (!label) return { ok: false, error: "Give the prototype a label." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an HTML file." };
  const html = await file.text();
  if (!html.trim()) return { ok: false, error: "The file is empty." };
  const db = getDb();
  const pid = await activeProjectId();
  await addPrototype(db, { projectId: pid, label, html, actorId: session.user.id });
  revalidatePath("/connect");
  return { ok: true };
}

export async function removePrototypeAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await removePrototype(getDb(), { id: String(formData.get("id")), actorId: session.user.id });
  revalidatePath("/connect");
}
```

- [ ] **Step 2: The section component (`connect/prototypes.tsx`)**

A server component that loads the active project's prototypes (id + label + whether rendered) and renders: a heading "Design prototypes", a short helper line, the upload form (client component using `useActionState(addPrototypeAction)` with a `label` text input + `file` input accepting `.html`), and a list — each row showing the label, a thumbnail `<img src={\`/prototype/${id}.png\`}>` when rendered (or "rendering…" when not), and a remove `<form action={removePrototypeAction}>` with a hidden `id`. Style with `impeccable`/`ui-ux-pro-max` within the ledger tokens (mirror `spec-upload.tsx` for the upload form and the tasks list for rows). Add a list query (e.g. `listProjectPrototypes(db, projectId) → { id, label, rendered }[]`) to `src/prototypes/store.ts` for the section (id + label + `image IS NOT NULL`), or reuse a lightweight select in the component.

- [ ] **Step 3: Render the section in `connect/page.tsx`**

Import and render `<DesignPrototypes />` (the section) in an appropriate place on the connect page, near the context-pins section.

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck` then `npm run build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/connect/prototypes.tsx" "src/app/(app)/connect/actions.ts" "src/app/(app)/connect/page.tsx" src/prototypes/store.ts
git commit -m "$(cat <<'EOF'
[TASK-068] upload + manage design prototypes on /connect (REQ-030)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Declare REQ-030, verify, review, open the PR

**Files:** none (declare + verification + review + integration).

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npm test` (expect all pass incl. the new prototype/render/issues/run tests), then `npm run typecheck`, then `npm run build`. (Transient V8/JIT crash on first test run on this Windows/Node 24 box → re-run once.)

- [ ] **Step 2: Declare the requirement (operator step)**

Run (controller, against the live DB): `npm run declare-req -- --title "Design prototype context" --provenance drift --why "Teams upload HTML design prototypes that ground task generation (as screenshots) and are linked from the generated issues."` then `npm run materialize`. Confirm the assigned key is **REQ-030** (next free in the tool's sequence); if it differs, note it. This makes the requirement real so the `[TASK-068]` work maps to it (mirrors REQ-028's declare+materialize).

- [ ] **Step 3: Event-integrity review**

Dispatch the `event-integrity-reviewer` on the diff. Confirm: `prototype.added`/`prototype.removed` emitted in the same tx as the insert/delete; the rendered `image` is a derived cache with no event; the worker render step is best-effort and outside any tx; generation only reads prototypes and still validates LLM output; no `github_status` write; no `any`; maps to REQ-030 (+ REQ-009 for the issue links). Address findings.

- [ ] **Step 4: Live DB migration**

Apply the Task 1 `CREATE TABLE "prototypes"` migration to live Postgres (hand-applied), then `npm run db:check` (expect no drift). Required before the worker/web run the new code.

- [ ] **Step 5: Runtime walkthrough**

On the deploy: upload a prototype on `/connect` → within a tick the worker logs `rendered N prototype(s)` and the thumbnail appears (and `/prototype/<id>.png` serves it) → generate tasks for a requirement/idea and confirm the generation prompt carried the image (worker log / behavior) → confirm a new issue's body has the `## Design references` link.

- [ ] **Step 6: Push + PR**

```bash
git push -u origin task-068-design-prototype-library
gh pr create --title "[TASK-068] design-prototype library for task generation (REQ-030)" --body "…"
```

PR body: summarize upload → render sweep → vision generation → issue Design references; note the new table (migration hand-applied), the new REQ-030, no `github_status` impact. Squash-merge.

---

## Self-Review

**Spec coverage** (against `2026-06-25-design-prototype-library-design.md`):
- §1 Storage + truth model (`prototypes` table; `prototype.added`/`removed` in-tx; image derived/no-event) → Task 1 + Task 2. ✔
- §2 Upload + manage on `/connect` → Task 6. ✔
- §3 Render sweep (worker) → Task 3. ✔
- §4 Generation context (load + vision blocks + budget + SYSTEM_PROMPT) → Task 4. ✔
- §5 Serve route + issue Design references → Task 5. ✔
- §6 Testing → each task's tests + Task 7 runtime. ✔
- New REQ-030 declared → Task 7 Step 2. ✔
- Migration hand-applied to live DB → Task 1 Step 8 + Task 7 Step 4. ✔

**Placeholder scan:** the only `…` is the `gh pr create` body. No TBD/TODO. (Task 6 describes the UI section in prose with the exact actions/queries it uses — UI components aren't unit-tested here, so the prose + the concrete action code is the spec.)

**Type consistency:** `addPrototype(db, {projectId,label,html,actorId?}) → {id}`, `removePrototype(db, {id,actorId?}) → {removed}`, `loadProjectPrototypes(db, projectId, {limit?}) → {id,label,image:Buffer}[]`, `getPrototypePng(db,id) → Buffer|null`, `renderPrototypeImages(db, projectId, render?) → {rendered:string[]}`, `WorkerDeps.renderPrototypes`, `buildUserContent(text, images) → ContentBlockParam[]`, `GenerateTasksArgs.images?: {mediaType,data}[]` — each defined once and consumed with the same shape across Tasks 2–6. The issue links use `/prototype/<id>.png` matching the serve route's `.png` strip.
