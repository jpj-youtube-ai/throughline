# Narrative Roadmap as HTML (not image) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the narrative roadmap as live HTML in a sandboxed iframe instead of a rasterized PNG.

**Architecture:** Drop the Puppeteer render + the `roadmap_image` column; `materializeNarrative` stores only `roadmap_html`; `/narrative` renders it in a sandboxed `<iframe srcdoc sandbox="">` (scripts neutralized, CSS isolated). The narrative no longer uses Puppeteer.

**Tech Stack:** Drizzle/Postgres, `@anthropic-ai/sdk` (Sonnet), Next.js App Router, Node `tsx --test` + PGlite.

## Global Constraints

- **TypeScript; no `any`** in domain code.
- **Untrusted HTML:** `roadmap_html` is LLM-generated + grounded in board text, so it MUST render in a `sandbox=""` iframe (no `allow-scripts`, no `allow-same-origin`) — never injected raw.
- **Best-effort:** a roadmap failure (generator `null`/throw) → store the narrative **without** `roadmap_html`; never blocks narrative generation.
- **Truth model:** `roadmap_html` written in the SAME `db.transaction` insert as `content`; `narrative.generated` event UNCHANGED; NO new event; the LLM runs OUTSIDE the transaction.
- **Narrative no longer uses Puppeteer** — but `src/preview/render.ts` + the issue-preview pipeline (TASK-051/052) keep using it; do NOT remove them.
- Migration: `npm run db:generate`; the `DROP COLUMN` migration is **applied to the live DB by hand**.
- Commits `[TASK-054]`, REQ-016. Branch `task-054-narrative-roadmap-html`.

---

## File Structure

**Modified**
- `src/db/schema.ts` (+ new migration) — drop `narratives.roadmap_image`.
- `src/narrative/materialize.ts` — store `roadmap_html` only; drop render/image + `renderPng` dep.
- `src/narrative/queries.ts` — return `roadmapHtml`.
- `src/app/(app)/narrative/narrative-panel.tsx` — sandboxed iframe.
- `src/narrative/roadmap.ts` — minor prompt note (compact/wide).
- Tests: `src/db/narrative-roadmap-columns.test.ts`, `src/narrative/materialize.test.ts`.

**Untouched:** `src/preview/render.ts`, `src/preview/html.ts`, `src/narrative/roadmap.test.ts` (logic unchanged).

---

## Task 1: Drop `roadmap_image` (schema + migration)

**Files:** Modify `src/db/schema.ts`, `src/db/narrative-roadmap-columns.test.ts`; migration via `npm run db:generate`.

**Interfaces:**
- Produces: `narratives` has `roadmap_html` (text, nullable) and **no** `roadmap_image`.

- [ ] **Step 1: Update the columns test** — in `src/db/narrative-roadmap-columns.test.ts`, drop everything about `roadmap_image` (the `png` buffer, the insert field, the assertion). The test should now only round-trip `roadmap_html`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./client";
import { project, narratives } from "./schema";
import { eq } from "drizzle-orm";

test("narratives.roadmap_html round-trip", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const [n] = await db.insert(narratives).values({ eventCount: 3, content: { chapters: [] }, projectId: p.id, roadmapHtml: "<html></html>" }).returning({ id: narratives.id });
    const [got] = await db.select({ html: narratives.roadmapHtml }).from(narratives).where(eq(narratives.id, n.id));
    assert.equal(got.html, "<html></html>");
  } finally { await close(); }
});
```

- [ ] **Step 2: Remove the column** — in `src/db/schema.ts`, delete the `roadmapImage: bytea("roadmap_image"),` line from the `narratives` pgTable. Keep `roadmapHtml: text("roadmap_html"),`. Leave the module-level `bytea` custom type in place (still used by `tasks.preview_image`).

- [ ] **Step 3: Generate the migration** — `npm run db:generate`. The new `drizzle/NNNN_*.sql` should contain `ALTER TABLE "narratives" DROP COLUMN "roadmap_image";`. Verify it (a single DROP). If drizzle-kit asks whether `roadmap_image` was renamed vs deleted, it's a **delete/drop** (there is no replacement column). If `db:generate` can't run non-interactively, hand-create the next-numbered migration file with exactly `ALTER TABLE "narratives" DROP COLUMN "roadmap_image";` and add its tag to `drizzle/meta/_journal.json` following the existing entries.

- [ ] **Step 4: Run the test + typecheck** — `npx tsx --test src/db/narrative-roadmap-columns.test.ts` → PASS (PGlite replays add-then-drop, ending with no `roadmap_image`); `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `git add src/db/schema.ts src/db/narrative-roadmap-columns.test.ts drizzle && git commit -m "[TASK-054] drop narratives.roadmap_image column (REQ-016)"` (note in the body: migration hand-applied to live DB).

---

## Task 2: Store `roadmap_html` only in `materializeNarrative`

**Files:** Modify `src/narrative/materialize.ts`, `src/narrative/materialize.test.ts`.

**Interfaces:**
- Produces: `materializeNarrative(db, generate?, roadmapDeps?)` where `roadmapDeps = { generateRoadmap?: typeof generateRoadmapHtml }` (no `renderPng`); stores `roadmap_html` only.

- [ ] **Step 1: Update the materialize tests** — in `src/narrative/materialize.test.ts`, replace the three TASK-053 roadmap tests (which referenced `roadmapImage`/`renderPng`) with these two (assert `roadmapHtml`, no render):

```ts
test("materializeNarrative stores roadmap_html when generation succeeds", async () => {
  const { db, close } = await createTestDb();
  try {
    const ctx = await seedNarratableProject(db);
    await db.insert(requirements).values({ key: "REQ-001", title: "Event log", description: "d", provenance: "imported", status: "shipped", projectId: ctx.projectId });
    let roadmapInput: unknown = null;
    const r = await materializeNarrative(
      db,
      async () => ({ ok: true, content: { chapters: [{ heading: "H", prose: "p", refs: [] }] } }),
      { generateRoadmap: async (input) => { roadmapInput = input; return "<html><body>roadmap</body></html>"; } },
    );
    assert.ok(r.eventCount > 0);
    const [n] = await db.select({ html: narratives.roadmapHtml }).from(narratives);
    assert.equal(n.html, "<html><body>roadmap</body></html>");
    assert.ok(roadmapInput && (roadmapInput as { requirements: unknown[] }).requirements.length === 1, "real requirements passed");
    const evs = await db.select().from(events).where(eq(events.type, "narrative.generated"));
    assert.equal(evs.length, 1);
  } finally { await close(); }
});

test("materializeNarrative still stores the narrative when the roadmap returns null", async () => {
  const { db, close } = await createTestDb();
  try {
    const ctx = await seedNarratableProject(db);
    const r = await materializeNarrative(
      db,
      async () => ({ ok: true, content: { chapters: [{ heading: "H", prose: "p", refs: [] }] } }),
      { generateRoadmap: async () => null },
    );
    assert.ok(r.eventCount > 0);
    const [n] = await db.select({ html: narratives.roadmapHtml }).from(narratives);
    assert.equal(n.html, null);
    const evs = await db.select().from(events).where(eq(events.type, "narrative.generated"));
    assert.equal(evs.length, 1, "narrative still generated");
  } finally { await close(); }
});

test("materializeNarrative still stores the narrative when the roadmap generator throws", async () => {
  const { db, close } = await createTestDb();
  try {
    const ctx = await seedNarratableProject(db);
    const r = await materializeNarrative(
      db,
      async () => ({ ok: true, content: { chapters: [{ heading: "H", prose: "p", refs: [] }] } }),
      { generateRoadmap: async () => { throw new Error("roadmap boom"); } },
    );
    assert.ok(r.eventCount > 0);
    const [n] = await db.select({ html: narratives.roadmapHtml }).from(narratives);
    assert.equal(n.html, null);
  } finally { await close(); }
});
```

Also update the legacy isolation call (the "builds a grounded digest" test) — it already passes `{ generateRoadmap: async () => null }`; leave it as-is (no `renderPng` to remove there). Ensure `requirements`, `narratives`, `events`, `eq` remain imported.

- [ ] **Step 2: Run them (fail)** — `npx tsx --test src/narrative/materialize.test.ts` → FAIL (`renderPng`/`roadmapImage` gone or html not stored).

- [ ] **Step 3: Implement** — edit `src/narrative/materialize.ts`:
  - Remove the import `import { renderHtmlToPng } from "../preview/render";`.
  - `RoadmapDeps`: remove `renderPng?`; keep only `generateRoadmap?: typeof generateRoadmapHtml`.
  - Replace the roadmap block + insert:

```ts
  // Best-effort roadmap HTML (REQ-016): grounded in the chapters + real requirement statuses.
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
      payload: { event_count: eventCount, chapters: result.content.chapters.length },
      projectId,
    });
  });
```

- [ ] **Step 4: Run the tests + typecheck** — `npx tsx --test src/narrative/materialize.test.ts` → PASS; `npm run typecheck` clean (confirms no dangling `renderHtmlToPng`/`roadmapImage` references).

- [ ] **Step 5: Commit** — `git add src/narrative/materialize.ts src/narrative/materialize.test.ts && git commit -m "[TASK-054] materializeNarrative stores roadmap_html only, no PNG render (REQ-016)"`

---

## Task 3: Serve + render the HTML (queries + sandboxed iframe)

**Files:** Modify `src/narrative/queries.ts`, `src/app/(app)/narrative/narrative-panel.tsx`.

**Interfaces:**
- Produces: `LatestNarrative.roadmapHtml: string | null`.

- [ ] **Step 1: Return the HTML from the query** — in `src/narrative/queries.ts`, replace the `roadmapImage` field with `roadmapHtml`:

```ts
export interface LatestNarrative {
  generatedAt: Date;
  eventCount: number;
  content: NarrativeContent;
  roadmapHtml: string | null;
}

export async function getLatestNarrative(db: Db, projectId?: string): Promise<LatestNarrative | null> {
  const [row] = await db
    .select({ generatedAt: narratives.generatedAt, eventCount: narratives.eventCount, content: narratives.content, roadmapHtml: narratives.roadmapHtml })
    .from(narratives)
    .where(projectId ? eq(narratives.projectId, projectId) : undefined)
    .orderBy(desc(narratives.generatedAt))
    .limit(1);
  return row
    ? { generatedAt: row.generatedAt, eventCount: row.eventCount, content: row.content as NarrativeContent, roadmapHtml: row.roadmapHtml ?? null }
    : null;
}
```

- [ ] **Step 2: Render the sandboxed iframe** — in `src/app/(app)/narrative/narrative-panel.tsx`, replace the `<img …>` block (the roadmap image from TASK-053) with a sandboxed iframe, as the first child of the narrative-present block (above `<article className="spine …">`):

```tsx
{n.roadmapHtml && (
  <iframe
    title="Project roadmap — journey and what's next"
    sandbox=""
    srcDoc={n.roadmapHtml}
    className="mb-8 w-full rounded-lg border border-hairline bg-paper"
    style={{ height: 820 }}
  />
)}
```

(`sandbox=""` is the most restrictive sandbox — no scripts, opaque origin. Keep chapters/footer/regenerate button unchanged.)

- [ ] **Step 3: Build + typecheck** — `npm run build` then `npm run typecheck` → both clean. (Stop any `:3000` server first if the build complains.)

- [ ] **Step 4: Commit** — `git add src/narrative/queries.ts "src/app/(app)/narrative/narrative-panel.tsx" && git commit -m "[TASK-054] render roadmap_html in a sandboxed iframe on /narrative (REQ-016)"`

---

## Task 4: Prompt note + verify

**Files:** Modify `src/narrative/roadmap.ts`.

- [ ] **Step 1: Nudge the layout to fit the frame** — in `src/narrative/roadmap.ts`, append one line to the end of the `SYSTEM` prompt string (inside the backticks, before the closing backtick), to keep the roadmap compact in the iframe:

```
- Keep it COMPACT and WIDE so it reads without much vertical scrolling: lay the phases out left-to-right, fit comfortably within roughly a 1000×800 area, and set the body width to ~100% (max ~1100px).
```

- [ ] **Step 2: Confirm roadmap tests still pass** — `npx tsx --test src/narrative/roadmap.test.ts` → 5/5 PASS (prompt text change doesn't affect the fake-client tests); `npm run typecheck` clean.

- [ ] **Step 3: Commit** — `git add src/narrative/roadmap.ts && git commit -m "[TASK-054] roadmap prompt: keep layout compact/wide for the iframe (REQ-016)"`

- [ ] **Step 4: Full suite (serial, memory-tight env)** — stop any `:3000` server; `for f in $(node -e "console.log(require('./package.json').scripts.test.replace('tsx --test','').trim())"); do npx tsx --test "$f"; done` → all pass.

- [ ] **Step 5: Live verify (controller + user)** — apply the Task-1 `DROP COLUMN` migration to the live DB by hand; rebuild + restart the web server from the worktree; regenerate the narrative (`/narrative` "Regenerate") → the roadmap renders as live HTML in the iframe. If it's clipped/too tall or too short, tune the iframe `height` constant (Task 3) and/or the compact/wide prompt note (Task 4) and regenerate.

---

## Self-Review

**Spec coverage:** drop `roadmap_image` + migration → Task 1; `materializeNarrative` stores html only, drop render/image/`renderPng` → Task 2; `queries.roadmapHtml` + sandboxed iframe → Task 3; compact/wide prompt note + verify → Task 4. Truth model: roadmap_html in the same tx as content, `narrative.generated` unchanged, no new event, LLM outside tx, best-effort (Task 2 tests assert narrative+event survive `null` AND a throwing generator). Untrusted-HTML constraint: `sandbox=""` iframe (Task 3). Puppeteer kept for the preview feature (only narrative's render removed).

**Placeholder scan:** every code/test step is complete with commands + expected results. No TBD.

**Type consistency:** `RoadmapDeps` now `{ generateRoadmap?: typeof generateRoadmapHtml }` (Task 2) — no `renderPng`; `narratives.roadmapHtml` (Task 1) used in Tasks 2/3; `LatestNarrative.roadmapHtml: string | null` (Task 3) consumed by the panel's `n.roadmapHtml`; `generateRoadmapHtml` signature unchanged (Task 4 only edits its prompt string). `materializeNarrative` keeps `generate` 2nd positional, `roadmapDeps` 3rd.

## Out of scope
Auto-height iframe; re-adding any PNG/image path for the narrative; changing chapter generation, the `narrative.generated` event, or the issue-preview (PNG) feature.
