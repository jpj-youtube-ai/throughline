# Narrative Roadmap Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the narrative is (re)generated, also produce a "journey + what's next" roadmap image shown at the top of `/narrative`.

**Architecture:** In `materializeNarrative`, after the chapters, an LLM generates a self-contained roadmap HTML grounded in the chapters + real `requirements.status`; Puppeteer renders it to PNG (reusing `src/preview/render.ts`); it's stored on the `narratives` row and rendered in-app as a `data:image/png` URI. Best-effort: a roadmap failure never blocks the narrative.

**Tech Stack:** Drizzle/Postgres (+ bytea), `@anthropic-ai/sdk` (Sonnet), Puppeteer, Next.js App Router, Node `tsx --test` + PGlite.

## Global Constraints

- **TypeScript; no `any`** in domain code.
- **LLM: Sonnet/Opus, never Haiku** — roadmap uses `claude-sonnet-4-6`. Validate output; retry-once-then-`null` (never persist garbage).
- **Best-effort:** any roadmap step failing (LLM / Chromium) → log and store the narrative **without** the roadmap. Never blocks narrative generation.
- **Truth model:** `roadmap_image`/`roadmap_html` are stored in the **same insert** as `content`; the existing `narrative.generated` event is **unchanged**; **no new event**. LLM + render run **outside** the transaction. Grounded strictly in chapters + real `requirements.status` — the prompt forbids inventing phases/dates.
- **In-app display only** (no public route); the board is auth-gated over Tailscale.
- Migrations: `npm run db:generate`; the new migration is **applied to the live DB by hand**.
- New `*.test.ts` files appended to the `package.json` test list. Commits `[TASK-053]`, REQ-016. Branch `task-053-narrative-roadmap`.

---

## File Structure

**New**
- `src/preview/html.ts` — shared LLM-HTML helpers (`extractText`, `extractHtml`, `isValidHtml`).
- `src/narrative/roadmap.ts` — `generateRoadmapHtml`.

**Modified**
- `src/preview/generate.ts` — import the shared helpers (remove the local copies).
- `src/db/schema.ts` — `narratives.roadmap_image` (bytea) + `roadmap_html` (text).
- `src/narrative/materialize.ts` — query statuses, generate+render+store the roadmap (best-effort).
- `src/narrative/queries.ts` + `src/app/(app)/narrative/narrative-panel.tsx` — fetch + render the image.
- New migration under `drizzle/`; `package.json`.

---

## Task 1: Shared LLM-HTML helpers

**Files:** Create `src/preview/html.ts`; Modify `src/preview/generate.ts`.

**Interfaces:**
- Produces: `extractText(message: { content: Array<{ type: string; text?: string }> }): string`; `extractHtml(text: string): string | null`; `isValidHtml(html: string): boolean`.

- [ ] **Step 1: Create the shared module** — `src/preview/html.ts` (move the three helpers verbatim from `generate.ts`):

```ts
/** Join the text blocks of an Anthropic message. */
export function extractText(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}

/** Pull a usable HTML document out of model text: strip a ``` fence if present,
 *  then take from the first tag to the last closing tag. */
export function extractHtml(text: string): string | null {
  let s = text.trim();
  const fence = s.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/<(!doctype|html|body|div|section|main)\b/i);
  const end = s.lastIndexOf(">");
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1).trim();
}

export function isValidHtml(html: string): boolean {
  return /<[a-z!][\s\S]*>/i.test(html) && html.includes("</");
}
```

- [ ] **Step 2: Refactor `generate.ts`** — in `src/preview/generate.ts`, delete the local `extractText`, `extractHtml`, `isValidHtml` definitions and import them: add `import { extractText, extractHtml, isValidHtml } from "./html";` (keep everything else, incl. `MAX_HTML_BYTES`, unchanged).

- [ ] **Step 3: Verify the refactor is behavior-preserving** — `npx tsx --test src/preview/generate.test.ts` → 5/5 PASS (unchanged); `npm run typecheck` clean.

- [ ] **Step 4: Commit** — `git add src/preview/html.ts src/preview/generate.ts && git commit -m "[TASK-053] extract shared LLM-HTML helpers to preview/html.ts (REQ-016)"`

---

## Task 2: Schema columns + migration

**Files:** Modify `src/db/schema.ts`; Test `src/db/narrative-roadmap-columns.test.ts` (create); migration via `npm run db:generate`; Modify `package.json`.

**Interfaces:**
- Produces: `narratives.roadmapHtml` (`text`, nullable), `narratives.roadmapImage` (bytea, nullable, JS `Buffer`).

- [ ] **Step 1: Write the failing test** — `src/db/narrative-roadmap-columns.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./client";
import { project, narratives } from "./schema";
import { eq } from "drizzle-orm";

test("narratives.roadmap_html / roadmap_image round-trip", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 7, 7]);
    const [n] = await db.insert(narratives).values({ eventCount: 3, content: { chapters: [] }, projectId: p.id, roadmapHtml: "<html></html>", roadmapImage: png }).returning({ id: narratives.id });
    const [got] = await db.select({ html: narratives.roadmapHtml, img: narratives.roadmapImage }).from(narratives).where(eq(narratives.id, n.id));
    assert.equal(got.html, "<html></html>");
    assert.deepEqual(Buffer.from(got.img as Uint8Array), png);
  } finally { await close(); }
});
```

- [ ] **Step 2: Add the columns** — in `src/db/schema.ts`, inside `pgTable("narratives", { ... })`, after `content`, add (reuse the existing module-level `bytea` custom type added for tasks.preview_image):

```ts
  roadmapHtml: text("roadmap_html"),
  roadmapImage: bytea("roadmap_image"),
```

- [ ] **Step 3: Generate the migration** — `npm run db:generate` → `drizzle/NNNN_*.sql` with `ALTER TABLE "narratives" ADD COLUMN "roadmap_html" text;` and `ADD COLUMN "roadmap_image" "bytea";`. Do NOT hand-edit.

- [ ] **Step 4: Append the test + run** — add ` src/db/narrative-roadmap-columns.test.ts` to `package.json`. `npx tsx --test src/db/narrative-roadmap-columns.test.ts` → PASS; `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `git add src/db/schema.ts src/db/narrative-roadmap-columns.test.ts drizzle package.json && git commit -m "[TASK-053] narratives.roadmap_html + roadmap_image columns (REQ-016)"` (note in the body: migration must be hand-applied to the live DB).

---

## Task 3: `generateRoadmapHtml`

**Files:** Create `src/narrative/roadmap.ts`, `src/narrative/roadmap.test.ts`; Modify `package.json`.

**Interfaces:**
- Consumes: `createClient` (`../anthropic`); `extractText`, `extractHtml`, `isValidHtml` (`../preview/html`).
- Produces: `generateRoadmapHtml(input: RoadmapInput, deps?: { client?: Anthropic; modelId?: string; maxRetries?: number }): Promise<string | null>` where `RoadmapInput = { chapters: { heading: string; prose: string }[]; requirements: { key: string; title: string; status: "planned" | "building" | "shipped" }[] }`.

- [ ] **Step 1: Write the failing test** — `src/narrative/roadmap.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { generateRoadmapHtml } from "./roadmap";

function fakeClient(texts: string[]) {
  let i = 0;
  return { messages: { create: async () => ({ content: [{ type: "text", text: texts[Math.min(i++, texts.length - 1)] }] }) } } as never;
}
const input = {
  chapters: [{ heading: "Foundations", prose: "The team built the event log." }],
  requirements: [
    { key: "REQ-001", title: "Event log", status: "shipped" as const },
    { key: "REQ-016", title: "Narrative", status: "building" as const },
    { key: "REQ-020", title: "Pipeline view", status: "planned" as const },
  ],
};

test("returns roadmap HTML for valid output", async () => {
  const html = "<!doctype html><html><body><div>roadmap</div></body></html>";
  const r = await generateRoadmapHtml(input, { client: fakeClient([html]), maxRetries: 1 });
  assert.ok(r && r.includes("roadmap"));
});

test("strips a code fence", async () => {
  const r = await generateRoadmapHtml(input, { client: fakeClient(["```html\n<html><body>x</body></html>\n```"]), maxRetries: 1 });
  assert.ok(r && r.startsWith("<html>") && !r.includes("```"));
});

test("retries once then null on non-HTML", async () => {
  const r = await generateRoadmapHtml(input, { client: fakeClient(["nope", "still nope"]), maxRetries: 1 });
  assert.equal(r, null);
});

test("null (no throw) on API error", async () => {
  const client = { messages: { create: async () => { throw new Error("boom"); } } } as never;
  assert.equal(await generateRoadmapHtml(input, { client, maxRetries: 1 }), null);
});

test("rejects output over the size cap", async () => {
  const big = "<html><body>" + "x".repeat(40000) + "</body></html>";
  assert.equal(await generateRoadmapHtml(input, { client: fakeClient([big, big]), maxRetries: 1 }), null);
});
```

- [ ] **Step 2: Run it (fails)** — `npx tsx --test src/narrative/roadmap.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/narrative/roadmap.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "../anthropic";
import { extractText, extractHtml, isValidHtml } from "../preview/html";

const MODEL_ID = "claude-sonnet-4-6";
const MAX_HTML_BYTES = 30000;

export interface RoadmapInput {
  chapters: { heading: string; prose: string }[];
  requirements: { key: string; title: string; status: "planned" | "building" | "shipped" }[];
}

const SYSTEM = `You produce ONE self-contained HTML "roadmap" graphic for a software project —
a horizontal timeline of the journey so far and what's next, for a quick at-a-glance read by anyone.
Rules:
- Output ONLY one HTML document. No prose, no markdown, no code fences.
- Inline <style> only. No external resources, no <script>, no network.
- Layout: a horizontal SPINE timeline (a thin teal/verdigris line) running left -> right with milestone
  nodes (dots) along it, grouped into a few phases. Left = earliest/shipped, right = upcoming/next.
- Show each milestone's status with BOTH an icon and a color and a short label (never color alone):
  shipped = check + green, in progress = half-circle + amber, planned/next = hollow circle + muted grey.
- Include a small legend of the three statuses.
- Aesthetic: light "paper" background (~#FAF8F3), dark ink text (~#1A1A1A), hairline borders (~#E5E0D8),
  a verdigris/teal accent (~#2E7D74) for the spine; clean modern sans headings, a monospace for small
  labels/keys (REQ ids). Calm, lots of whitespace, ~1100px wide. Well under 30KB.
- Ground EVERY milestone in the data given: the chapters are the journey; the requirements are the real
  status. Do NOT invent phases, dates, or features not present. Keep labels short.`;

function buildUserMessage(input: RoadmapInput): string {
  const chapters = input.chapters.map((c, i) => `${i + 1}. ${c.heading} — ${c.prose}`).join("\n");
  const group = (s: RoadmapInput["requirements"][number]["status"]) =>
    input.requirements.filter((r) => r.status === s).map((r) => `${r.key} ${r.title}`).join("; ") || "(none)";
  return `## The journey so far (narrative chapters)\n${chapters || "(none)"}\n\n## Real requirement status (ground truth)\n- Shipped: ${group("shipped")}\n- In progress (building): ${group("building")}\n- Planned (what's next): ${group("planned")}\n\nDraw the roadmap now, grounded strictly in the above.`;
}

export async function generateRoadmapHtml(
  input: RoadmapInput,
  deps: { client?: Anthropic; modelId?: string; maxRetries?: number } = {},
): Promise<string | null> {
  const client = deps.client ?? createClient();
  const modelId = deps.modelId ?? MODEL_ID;
  const maxRetries = deps.maxRetries ?? 1;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildUserMessage(input) }];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let message: Anthropic.Message;
    try {
      message = await client.messages.create({ model: modelId, max_tokens: 6000, system: SYSTEM, messages });
    } catch {
      return null;
    }
    const html = extractHtml(extractText(message));
    if (html && isValidHtml(html) && Buffer.byteLength(html, "utf8") <= MAX_HTML_BYTES) return html;
    messages.push({ role: "assistant", content: message.content });
    messages.push({ role: "user", content: "That was not usable. Return ONLY one self-contained HTML document under 30KB — no prose, no code fences." });
  }
  return null;
}
```

- [ ] **Step 4: Append the test + run** — add ` src/narrative/roadmap.test.ts` to `package.json`. `npx tsx --test src/narrative/roadmap.test.ts` → 5/5 PASS; `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `git add src/narrative/roadmap.ts src/narrative/roadmap.test.ts package.json && git commit -m "[TASK-053] generateRoadmapHtml: grounded roadmap mockup, validate + retry-skip (REQ-016)"`

---

## Task 4: Wire the roadmap into `materializeNarrative`

**Files:** Modify `src/narrative/materialize.ts`, `src/narrative/materialize.test.ts`.

**Interfaces:**
- Consumes: `generateRoadmapHtml` (Task 3), `renderHtmlToPng` (`../preview/render`), `requirements`/`narratives` schema, `roadmap_*` columns (Task 2).
- Produces: extended `materializeNarrative(db, generate?, roadmapDeps?)` where `roadmapDeps = { generateRoadmap?: typeof generateRoadmapHtml; renderPng?: typeof renderHtmlToPng }`.

- [ ] **Step 1: Write the failing tests** — append to `src/narrative/materialize.test.ts` (it already seeds projects + events; reuse its helpers). Add a requirements import if missing (`requirements` from `../db/schema`). Add:

```ts
test("materializeNarrative stores a roadmap image when generation succeeds", async () => {
  const { db, close } = await createTestDb();
  try {
    const ctx = await seedNarratableProject(db); // returns { projectId }
    await db.insert(requirements).values({ key: "REQ-001", title: "Event log", description: "d", provenance: "imported", status: "shipped", projectId: ctx.projectId });
    let roadmapInput: unknown = null;
    const r = await materializeNarrative(
      db,
      async () => ({ ok: true, content: { chapters: [{ heading: "H", prose: "p", refs: [] }] } }),
      {
        generateRoadmap: async (input) => { roadmapInput = input; return "<html><body>roadmap</body></html>"; },
        renderPng: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]),
      },
    );
    assert.ok(r.eventCount > 0);
    const [n] = await db.select({ img: narratives.roadmapImage, html: narratives.roadmapHtml }).from(narratives);
    assert.ok(n.img && n.html, "roadmap stored");
    assert.ok(roadmapInput && (roadmapInput as { requirements: unknown[] }).requirements.length === 1, "real requirements passed to the roadmap");
    const evs = await db.select().from(events).where(eq(events.type, "narrative.generated"));
    assert.equal(evs.length, 1);
  } finally { await close(); }
});

test("materializeNarrative still stores the narrative when the roadmap fails", async () => {
  const { db, close } = await createTestDb();
  try {
    const ctx = await seedNarratableProject(db);
    const r = await materializeNarrative(
      db,
      async () => ({ ok: true, content: { chapters: [{ heading: "H", prose: "p", refs: [] }] } }),
      { generateRoadmap: async () => null, renderPng: async () => { throw new Error("should not run"); } },
    );
    assert.ok(r.eventCount > 0);
    const [n] = await db.select({ img: narratives.roadmapImage }).from(narratives);
    assert.equal(n.img, null, "no image stored");
    const evs = await db.select().from(events).where(eq(events.type, "narrative.generated"));
    assert.equal(evs.length, 1, "narrative still generated");
  } finally { await close(); }
});

test("materializeNarrative still stores the narrative when render throws", async () => {
  const { db, close } = await createTestDb();
  try {
    const ctx = await seedNarratableProject(db);
    const r = await materializeNarrative(
      db,
      async () => ({ ok: true, content: { chapters: [{ heading: "H", prose: "p", refs: [] }] } }),
      { generateRoadmap: async () => "<html><body>x</body></html>", renderPng: async () => { throw new Error("chromium boom"); } },
    );
    assert.ok(r.eventCount > 0);
    const [n] = await db.select({ img: narratives.roadmapImage }).from(narratives);
    assert.equal(n.img, null);
  } finally { await close(); }
});
```

If the file lacks a reusable seed helper, add one near the top that inserts a project + at least one event (so `listActivity` is non-empty) and returns `{ projectId }`; model it on the file's existing setup (it already emits events like `requirement.declared` / `idea.approved`). Ensure `requirements`, `narratives`, `events`, `eq` are imported.

- [ ] **Step 2: Run them (fail)** — `npx tsx --test src/narrative/materialize.test.ts` → FAIL (roadmap not stored / param missing).

- [ ] **Step 3: Implement** — modify `src/narrative/materialize.ts`. Add imports:

```ts
import { eq } from "drizzle-orm";
import { requirements } from "../db/schema";
import { generateRoadmapHtml } from "./roadmap";
import { renderHtmlToPng } from "../preview/render";

export interface RoadmapDeps {
  generateRoadmap?: typeof generateRoadmapHtml;
  renderPng?: typeof renderHtmlToPng;
}
```

Change the signature + add the best-effort roadmap step before the transaction, and include the columns in the insert:

```ts
export async function materializeNarrative(
  db: Db,
  generate: NarrativeGenerator = defaultGenerator,
  roadmapDeps: RoadmapDeps = {},
): Promise<MaterializeNarrativeResult> {
  // ... unchanged: build items, eventDigest, call generate(), resolve projectId ...

  // Best-effort roadmap image (REQ-016): grounded in the chapters + real requirement statuses.
  const generateRoadmap = roadmapDeps.generateRoadmap ?? generateRoadmapHtml;
  const renderPng = roadmapDeps.renderPng ?? renderHtmlToPng;
  let roadmapHtml: string | null = null;
  let roadmapImage: Buffer | null = null;
  try {
    const reqRows = await db
      .select({ key: requirements.key, title: requirements.title, status: requirements.status })
      .from(requirements)
      .where(eq(requirements.projectId, projectId));
    const html = await generateRoadmap({ chapters: result.content.chapters, requirements: reqRows });
    if (html) {
      roadmapImage = await renderPng(html);
      roadmapHtml = html;
    }
  } catch (e) {
    console.error("[narrative] roadmap failed:", e instanceof Error ? e.message : e);
  }

  await db.transaction(async (tx) => {
    await tx.insert(narratives).values({ eventCount, content: result.content, projectId, roadmapHtml, roadmapImage });
    await emitEvent(tx, {
      type: "narrative.generated",
      subjectType: "project",
      payload: { event_count: eventCount, chapters: result.content.chapters.length },
      projectId,
    });
  });

  return { eventCount, chapters: result.content.chapters.length };
}
```

(`projectId` is resolved above the roadmap step — keep `const projectId = await getActiveProjectId(db, null);` before it. The roadmap's `result.content.chapters` only has `heading`/`prose`/`refs`; `generateRoadmapHtml` reads `heading`/`prose`, which is compatible.)

- [ ] **Step 4: Run the tests + typecheck** — `npx tsx --test src/narrative/materialize.test.ts` → PASS (existing + 3 new); `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `git add src/narrative/materialize.ts src/narrative/materialize.test.ts && git commit -m "[TASK-053] materializeNarrative generates+stores a best-effort roadmap image (REQ-016)"`

---

## Task 5: Display on `/narrative` + verify

**Files:** Modify `src/narrative/queries.ts`, `src/app/(app)/narrative/narrative-panel.tsx`.

**Interfaces:**
- Consumes: `narratives.roadmapImage` (Task 2).
- Produces: `LatestNarrative.roadmapImage: Buffer | null`.

- [ ] **Step 1: Add the image to the query** — in `src/narrative/queries.ts`, add `roadmapImage` to the interface + select:

```ts
export interface LatestNarrative {
  generatedAt: Date;
  eventCount: number;
  content: NarrativeContent;
  roadmapImage: Buffer | null;
}

export async function getLatestNarrative(db: Db, projectId?: string): Promise<LatestNarrative | null> {
  const [row] = await db
    .select({ generatedAt: narratives.generatedAt, eventCount: narratives.eventCount, content: narratives.content, roadmapImage: narratives.roadmapImage })
    .from(narratives)
    .where(projectId ? eq(narratives.projectId, projectId) : undefined)
    .orderBy(desc(narratives.generatedAt))
    .limit(1);
  return row
    ? { generatedAt: row.generatedAt, eventCount: row.eventCount, content: row.content as NarrativeContent, roadmapImage: row.roadmapImage ? Buffer.from(row.roadmapImage as Uint8Array) : null }
    : null;
}
```

- [ ] **Step 2: Render the roadmap image** — in `src/app/(app)/narrative/narrative-panel.tsx`, inside the `n` branch, before the `<article>`, render the image when present:

```tsx
{n.roadmapImage && (
  <img
    src={`data:image/png;base64,${n.roadmapImage.toString("base64")}`}
    alt="Project roadmap — journey and what's next"
    className="mb-8 w-full rounded-lg border border-hairline"
  />
)}
```

(Place it as the first child of the `n`-present block, above `<article className="spine …">`.)

- [ ] **Step 3: Build + typecheck** — `npm run build` then `npm run typecheck` → clean (the `<img data:>` is fine; Next may warn about `<img>` vs `next/image` — a warning, not an error; a plain `<img>` is correct for an inline data URI).

- [ ] **Step 4: Full suite (serial, memory-tight env)** — stop any `:3000` server; `for f in $(node -e "console.log(require('./package.json').scripts.test.replace('tsx --test','').trim())"); do npx tsx --test "$f"; done` → all pass.

- [ ] **Step 5: Commit** — `git add src/narrative/queries.ts "src/app/(app)/narrative/narrative-panel.tsx" && git commit -m "[TASK-053] show the roadmap image atop /narrative (REQ-016)"`

- [ ] **Step 6: Live verify (controller + user)** — apply the Task-2 migration to the live DB by hand; restart the worker/app from the worktree; regenerate the narrative (the `/narrative` "Regenerate" button or via the worker) → the roadmap image appears above the chapters. Render one roadmap to a PNG and **view it**; if the visual needs tuning, iterate the `SYSTEM` prompt in `roadmap.ts` and regenerate (build-order ethos: iterate the prompt until genuinely good).

---

## Self-Review

**Spec coverage:** shared helpers → Task 1; schema/bytea → Task 2; `generateRoadmapHtml` (grounded prompt, validate/retry-skip) → Task 3; wire into `materializeNarrative` (grounded input + best-effort + same-tx store, no new event) → Task 4; in-app display via data URI → Task 5; ui-ux-pro-max roadmap aesthetic → the Task 3 `SYSTEM` prompt; verify/iterate → Task 5 Step 6. Truth model: roadmap stored in the same insert as `content`, `narrative.generated` unchanged, no new event, LLM+render external (Task 4 tests assert narrative+event survive a roadmap failure).

**Placeholder scan:** every code/test step is complete with commands + expected results. No TBD.

**Type consistency:** `RoadmapInput` (chapters `{heading,prose}`, requirements `{key,title,status}`) defined in Task 3, consumed in Task 4 (passing `result.content.chapters` + `reqRows`); `generateRoadmapHtml(input, deps?) → Promise<string|null>` and `renderHtmlToPng(html) → Promise<Buffer>` referenced as `typeof` in Task 4's `RoadmapDeps`; `narratives.roadmapImage/roadmapHtml` defined Task 2, used Tasks 4/5; `extractText/extractHtml/isValidHtml` defined Task 1, consumed Task 3 + re-imported in `generate.ts`; `LatestNarrative.roadmapImage` defined Task 5 queries, consumed in the panel. `materializeNarrative` keeps `generate` as the 2nd positional arg; `roadmapDeps` is the new optional 3rd.

## Out of scope
Public route / GitHub embedding; interactive roadmap; regenerating the roadmap independently of the narrative; changing chapter generation or the `narrative.generated` event.
