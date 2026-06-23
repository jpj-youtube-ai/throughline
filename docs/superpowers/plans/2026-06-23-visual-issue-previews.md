# Visual Issue Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed an inline image mockup of "what the change does" at the top of each generated GitHub issue.

**Architecture:** In the worker's issue-creation step, per task and best-effort: an LLM produces a small self-contained HTML mockup, Puppeteer rasterizes it to PNG, the PNG is stored on the task row, and the issue body gets `![preview](<PUBLIC_BASE_URL>/preview/<taskId>.png)`. A public, unauthenticated route streams the stored PNG; Tailscale Funnel (already live, whole-board on 443) makes it fetchable by GitHub's Camo proxy.

**Tech Stack:** Next.js 16 App Router (route handler), Drizzle/Postgres (+ bytea), `@anthropic-ai/sdk`, Puppeteer (headless Chromium), Node `tsx --test` + PGlite.

## Global Constraints

- **TypeScript; no `any`** in domain code.
- **LLM: Sonnet/Opus, never Haiku** (use `claude-sonnet-4-6` for previews — cheaper, sufficient). Validate output; on malformed output, retry then **skip** — never persist garbage.
- **Best-effort:** any failure (LLM / Chromium / store) → log and create the issue **without** the image. The visual NEVER blocks issue creation.
- **Truth model:** all steps are external side-effects in the worker, **after** the tasks are committed, **never inside a DB transaction**, **never at render time**. `preview_html`/`preview_image` are cache/mirror data (like `github_issue_number/url`) — **no event**.
- **`/preview` is public + unauthenticated** (no global middleware exists; do not add an auth check). The rest of the app stays auth-gated.
- Migrations: `npm run db:generate`; the new migration is **applied to the live DB by hand** (db:migrate is fresh-provision only).
- New `*.test.ts` files appended to the `package.json` test list. Commits `[TASK-051]`, REQ-009. Branch `task-051-visual-issue-previews`.
- Env: `PUBLIC_BASE_URL=https://paul.tailf03436.ts.net` (in `.env`, already set up). Funnel is already enabled + verified.

---

## File Structure

**New**
- `src/preview/generate.ts` — LLM → HTML mockup string.
- `src/preview/render.ts` — HTML → PNG (Puppeteer; reused browser).
- `src/app/preview/[id]/route.ts` — public PNG route.

**Modified**
- `src/db/schema.ts` — `tasks.preview_html` (text) + `tasks.preview_image` (bytea custom type).
- `src/github/issues.ts` — wire generate→render→store→embed into `createIssuesForTasks`.
- `package.json` — `puppeteer` dep + new test files.
- New migration under `drizzle/`.

---

## Task 1: Schema columns + migration

**Files:** Modify `src/db/schema.ts`; Test `src/db/preview-columns.test.ts` (create); migration via `npm run db:generate`; Modify `package.json`.

**Interfaces:**
- Produces: `tasks.previewHtml` (`text`, nullable), `tasks.previewImage` (bytea, nullable, JS type `Buffer`).

- [ ] **Step 1: Write the failing test** — `src/db/preview-columns.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./client";
import { project, requirements, tasks } from "./schema";
import { eq } from "drizzle-orm";

test("tasks.preview_html / preview_image round-trip", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const [r] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: p.id }).returning({ id: requirements.id });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const [t] = await db.insert(tasks).values({
      key: "TASK-001", title: "t", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50,
      projectId: p.id, previewHtml: "<html></html>", previewImage: png,
    }).returning({ id: tasks.id });
    const [got] = await db.select({ html: tasks.previewHtml, img: tasks.previewImage }).from(tasks).where(eq(tasks.id, t.id));
    assert.equal(got.html, "<html></html>");
    assert.deepEqual(Buffer.from(got.img as Uint8Array), png);
  } finally { await close(); }
});
```

- [ ] **Step 2: Add the columns** — in `src/db/schema.ts`, add a bytea custom type near the imports and the two columns to the `tasks` table (after `githubIssueUrl`):

```ts
import { customType } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return "bytea"; },
});
```
```ts
  // inside pgTable("tasks", { ... }) after githubIssueUrl:
  previewHtml: text("preview_html"),
  previewImage: bytea("preview_image"),
```

- [ ] **Step 3: Generate the migration** — `npm run db:generate` → creates `drizzle/NNNN_*.sql` containing `ALTER TABLE "tasks" ADD COLUMN "preview_html" text;` and `ADD COLUMN "preview_image" "bytea";`. Do NOT hand-edit.

- [ ] **Step 4: Append the test + run** — add ` src/db/preview-columns.test.ts` to the `package.json` test list. Run: `npx tsx --test src/db/preview-columns.test.ts` → PASS (PGlite rebuilds from migrations). `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `git add src/db/schema.ts src/db/preview-columns.test.ts drizzle package.json && git commit -m "[TASK-051] tasks.preview_html + preview_image columns (REQ-009)"`. Note in the commit body: **migration must be applied to the live DB by hand**.

---

## Task 2: `generatePreviewHtml`

**Files:** Create `src/preview/generate.ts`, `src/preview/generate.test.ts`; Modify `package.json`.

**Interfaces:**
- Consumes: `createClient` from `../anthropic`.
- Produces: `generatePreviewHtml(task: { key: string; title: string; body: string }, deps?: { client?: Anthropic; modelId?: string; maxRetries?: number }): Promise<string | null>`.

- [ ] **Step 1: Write the failing test** — `src/preview/generate.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { generatePreviewHtml } from "./generate";

function fakeClient(texts: string[]) {
  let i = 0;
  return { messages: { create: async () => ({ content: [{ type: "text", text: texts[Math.min(i++, texts.length - 1)] }] }) } } as never;
}
const task = { key: "TASK-001", title: "Add a lineup save button", body: "Adds a Save button to the lineup editor." };

test("returns the HTML when the model produces a valid doc", async () => {
  const html = "<!doctype html><html><body><button>Save</button></body></html>";
  const r = await generatePreviewHtml(task, { client: fakeClient([html]), maxRetries: 1 });
  assert.ok(r && r.includes("<button>Save</button>"));
});

test("strips a markdown code fence around the HTML", async () => {
  const r = await generatePreviewHtml(task, { client: fakeClient(["```html\n<html><body>x</body></html>\n```"]), maxRetries: 1 });
  assert.ok(r && r.startsWith("<html>") && !r.includes("```"));
});

test("retries once then returns null on non-HTML output", async () => {
  const r = await generatePreviewHtml(task, { client: fakeClient(["sorry, I can't", "still not html"]), maxRetries: 1 });
  assert.equal(r, null);
});

test("returns null (no throw) on API error", async () => {
  const client = { messages: { create: async () => { throw new Error("boom"); } } } as never;
  const r = await generatePreviewHtml(task, { client, maxRetries: 1 });
  assert.equal(r, null);
});

test("rejects output over the size cap", async () => {
  const big = "<html><body>" + "x".repeat(30000) + "</body></html>";
  const r = await generatePreviewHtml(task, { client: fakeClient([big, big]), maxRetries: 1 });
  assert.equal(r, null);
});
```

- [ ] **Step 2: Run it (fails)** — `npx tsx --test src/preview/generate.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/preview/generate.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "../anthropic";

const MODEL_ID = "claude-sonnet-4-6";
const MAX_HTML_BYTES = 20000;

const SYSTEM = `You produce a SMALL, self-contained HTML mockup that helps a developer
instantly see what a software task will do. Rules:
- Output ONLY one HTML document. No prose, no markdown, no code fences.
- Inline <style> only. No external resources, no <script>, no network.
- Keep it compact (well under 20KB), ~900px wide, clean and modern.
- Adapt to the task: for a user-facing change, mock the resulting screen/component;
  for a backend change (DB, webhook, event log), draw a simple before/after or a
  small flow / data-shape diagram using styled boxes and arrows.`;

function buildUserMessage(task: { key: string; title: string; body: string }): string {
  return `Task ${task.key}: ${task.title}\n\nDetails:\n${task.body}\n\nReturn the HTML mockup now.`;
}

function extractText(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}

// Pull a usable HTML document out of the model text: strip a ``` fence if present,
// then take from the first tag to the last closing tag.
function extractHtml(text: string): string | null {
  let s = text.trim();
  const fence = s.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/<(!doctype|html|body|div|section|main)\b/i);
  const end = s.lastIndexOf(">");
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1).trim();
}

function isValidHtml(html: string): boolean {
  return /<[a-z!][\s\S]*>/i.test(html) && html.includes("</");
}

export async function generatePreviewHtml(
  task: { key: string; title: string; body: string },
  deps: { client?: Anthropic; modelId?: string; maxRetries?: number } = {},
): Promise<string | null> {
  const client = deps.client ?? createClient();
  const modelId = deps.modelId ?? MODEL_ID;
  const maxRetries = deps.maxRetries ?? 1;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildUserMessage(task) }];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let message: Anthropic.Message;
    try {
      message = await client.messages.create({ model: modelId, max_tokens: 4000, system: SYSTEM, messages });
    } catch {
      return null; // API/transport error — skip the visual entirely
    }
    const html = extractHtml(extractText(message));
    if (html && isValidHtml(html) && Buffer.byteLength(html, "utf8") <= MAX_HTML_BYTES) return html;
    messages.push({ role: "assistant", content: message.content });
    messages.push({ role: "user", content: "That was not usable. Return ONLY one self-contained HTML document under 20KB — no prose, no code fences." });
  }
  return null;
}
```

- [ ] **Step 4: Append the test + run** — add ` src/preview/generate.test.ts` to `package.json`. `npx tsx --test src/preview/generate.test.ts` → PASS; `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `git add src/preview/generate.ts src/preview/generate.test.ts package.json && git commit -m "[TASK-051] generatePreviewHtml: LLM HTML mockup, validate + retry-then-skip (REQ-009)"`

---

## Task 3: `renderHtmlToPng` (Puppeteer)

**Files:** Create `src/preview/render.ts`, `src/preview/render.test.ts`; Modify `package.json` (dep + test).

**Interfaces:**
- Produces: `renderHtmlToPng(html: string): Promise<Buffer>`; `closeBrowser(): Promise<void>`.

- [ ] **Step 1: Install Puppeteer** — `npm install puppeteer` (downloads Chromium ~150MB). Confirm it appears in `package.json` dependencies.

- [ ] **Step 2: Write the smoke test** — `src/preview/render.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { renderHtmlToPng, closeBrowser } from "./render";

test("renders HTML to a non-empty PNG buffer", async () => {
  try {
    const buf = await renderHtmlToPng("<!doctype html><html><body style='margin:0'><h1>Hello</h1></body></html>");
    assert.ok(buf.length > 100, "png should have bytes");
    assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "PNG magic bytes");
  } finally { await closeBrowser(); }
});
```

- [ ] **Step 3: Run it (fails)** — `npx tsx --test src/preview/render.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement** — `src/preview/render.ts`:

```ts
import puppeteer, { type Browser } from "puppeteer";

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  }
  return browserPromise;
}

/** Render a self-contained HTML document to a PNG (REQ-009). Reuses one headless
 *  Chromium across calls (worker-lifetime). Height-capped to keep images bounded. */
export async function renderHtmlToPng(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 900, height: 600, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 15000 });
    const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const height = Math.min(fullHeight, 2000);
    const buf = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 900, height } });
    return Buffer.from(buf);
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}
```

- [ ] **Step 5: Append the test + run** — add ` src/preview/render.test.ts` to `package.json`. `npx tsx --test src/preview/render.test.ts` → PASS (launches Chromium; may take a few seconds). `npm run typecheck` clean.

- [ ] **Step 6: Commit** — `git add src/preview/render.ts src/preview/render.test.ts package.json package-lock.json && git commit -m "[TASK-051] renderHtmlToPng: Puppeteer HTML->PNG, reused browser (REQ-009)"`

---

## Task 4: Public `/preview/[id]` route

**Files:** Create `src/app/preview/[id]/route.ts`, `src/app/preview/[id]/route.test.ts`; Modify `package.json`.

**Interfaces:**
- Consumes: `tasks.previewImage` (Task 1).
- Produces: `GET(req, ctx)` handler at `/preview/<taskId>.png`.

- [ ] **Step 1: Write the failing test** — `src/app/preview/[id]/route.test.ts` (test the handler directly with an injected db via a small seam; the handler reads `getDb()`, so the test seeds the same test db). Use the exported `getPreviewPng(db, id)` helper the handler wraps:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../../db/client";
import { project, requirements, tasks } from "../../../db/schema";
import { getPreviewPng } from "./route";

test("getPreviewPng returns the stored PNG, or null when absent", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const [r] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: p.id }).returning({ id: requirements.id });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]);
    const [withImg] = await db.insert(tasks).values({ key: "TASK-001", title: "t", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: p.id, previewImage: png }).returning({ id: tasks.id });
    const [noImg] = await db.insert(tasks).values({ key: "TASK-002", title: "t", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: p.id }).returning({ id: tasks.id });

    const got = await getPreviewPng(db, withImg.id);
    assert.deepEqual(got && Buffer.from(got), png);
    assert.equal(await getPreviewPng(db, noImg.id), null);
    assert.equal(await getPreviewPng(db, "00000000-0000-0000-0000-000000000000"), null);
  } finally { await close(); }
});
```

- [ ] **Step 2: Run it (fails)** — `npx tsx --test "src/app/preview/[id]/route.test.ts"` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/app/preview/[id]/route.ts` (public, no auth check):

```ts
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Fetch a task's stored preview PNG by id, or null. Exported for testing. */
export async function getPreviewPng(db: Db, id: string): Promise<Buffer | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select({ img: tasks.previewImage }).from(tasks).where(eq(tasks.id, id)).limit(1);
  return row?.img ? Buffer.from(row.img as Uint8Array) : null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const png = await getPreviewPng(getDb(), id.replace(/\.png$/i, ""));
  if (!png) return new Response("Not found", { status: 404 });
  return new Response(png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
```

- [ ] **Step 4: Append the test + run** — add ` src/app/preview/[id]/route.test.ts` to `package.json`. Run the test → PASS; `npm run build` (route compiles) + `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `git add "src/app/preview" package.json && git commit -m "[TASK-051] public /preview/<id>.png route streams the stored mockup (REQ-009)"`

---

## Task 5: Wire into issue creation + verify

**Files:** Modify `src/github/issues.ts`, `src/github/issues.test.ts`.

**Interfaces:**
- Consumes: `generatePreviewHtml` (Task 2), `renderHtmlToPng` (Task 3), `tasks.previewHtml/previewImage` (Task 1).
- Produces: extended `createIssuesForTasks(db, projectId?, openIssue?, previewDeps?)` where `previewDeps = { generatePreview?: typeof generatePreviewHtml; renderPng?: typeof renderHtmlToPng; baseUrl?: string }`.

- [ ] **Step 1: Write the failing tests** — append to `src/github/issues.test.ts` (it already seeds projects/tasks; reuse its helpers or add minimal seeding). Add:

```ts
test("createIssuesForTasks embeds the preview image and stores it", async () => {
  const { db, close } = await createTestDb();
  try {
    const ids = await seedOnePendingTask(db); // {projectId, taskId, key}
    const bodies: string[] = [];
    const openIssue = async (_i: number, _r: string, _t: string, body: string) => { bodies.push(body); return { number: 1, url: "u" }; };
    await createIssuesForTasks(db, ids.projectId, openIssue, {
      generatePreview: async () => "<html><body>mock</body></html>",
      renderPng: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]),
      baseUrl: "https://example.test",
    });
    assert.match(bodies[0], new RegExp(`^!\\[preview\\]\\(https://example\\.test/preview/${ids.taskId}\\.png\\)`));
    const [t] = await db.select({ img: tasks.previewImage, html: tasks.previewHtml }).from(tasks).where(eq(tasks.id, ids.taskId));
    assert.ok(t.img && t.html);
  } finally { await close(); }
});

test("createIssuesForTasks still creates the issue when preview generation fails", async () => {
  const { db, close } = await createTestDb();
  try {
    const ids = await seedOnePendingTask(db);
    const bodies: string[] = [];
    const openIssue = async (_i: number, _r: string, _t: string, body: string) => { bodies.push(body); return { number: 2, url: "u" }; };
    await createIssuesForTasks(db, ids.projectId, openIssue, {
      generatePreview: async () => null, // LLM failed/skipped
      renderPng: async () => { throw new Error("should not be called"); },
      baseUrl: "https://example.test",
    });
    assert.ok(!bodies[0].includes("![preview]"));
    const [t] = await db.select({ num: tasks.githubIssueNumber }).from(tasks).where(eq(tasks.id, ids.taskId));
    assert.equal(t.num, 2); // issue created regardless
  } finally { await close(); }
});

test("createIssuesForTasks still creates the issue when rendering throws", async () => {
  const { db, close } = await createTestDb();
  try {
    const ids = await seedOnePendingTask(db);
    const bodies: string[] = [];
    const openIssue = async (_i: number, _r: string, _t: string, body: string) => { bodies.push(body); return { number: 3, url: "u" }; };
    await createIssuesForTasks(db, ids.projectId, openIssue, {
      generatePreview: async () => "<html><body>x</body></html>",
      renderPng: async () => { throw new Error("chromium boom"); },
      baseUrl: "https://example.test",
    });
    assert.ok(!bodies[0].includes("![preview]"));
    const [t] = await db.select({ num: tasks.githubIssueNumber }).from(tasks).where(eq(tasks.id, ids.taskId));
    assert.equal(t.num, 3);
  } finally { await close(); }
});
```

Add a `seedOnePendingTask` helper at the top of the file if one doesn't already exist:

```ts
async function seedOnePendingTask(db: Db) {
  const [p] = await db.insert(project).values({ repoFullName: "acme/repo", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
  const [r] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: p.id }).returning({ id: requirements.id });
  const [t] = await db.insert(tasks).values({ key: "TASK-001", title: "T one", body: "body one", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: p.id }).returning({ id: tasks.id });
  return { projectId: p.id, taskId: t.id, key: "TASK-001" };
}
```

- [ ] **Step 2: Run them (fail)** — `npx tsx --test src/github/issues.test.ts` → FAIL (4th param / behavior missing).

- [ ] **Step 3: Implement** — modify `src/github/issues.ts`. Add imports + the `previewDeps` param + the per-task generate→render→store→embed, all best-effort:

```ts
import { generatePreviewHtml } from "../preview/generate";
import { renderHtmlToPng } from "../preview/render";

export interface PreviewDeps {
  generatePreview?: typeof generatePreviewHtml;
  renderPng?: typeof renderHtmlToPng;
  baseUrl?: string;
}
```

Change the signature to:

```ts
export async function createIssuesForTasks(
  db: Db,
  projectId?: string,
  openIssue: OpenIssueFn = realOpenIssue,
  previewDeps: PreviewDeps = {},
): Promise<CreateIssuesResult> {
```

Inside the loop, replace the body construction so each task tries a preview first (best-effort), then opens the issue:

```ts
  const generatePreview = previewDeps.generatePreview ?? generatePreviewHtml;
  const renderPng = previewDeps.renderPng ?? renderHtmlToPng;
  const baseUrl = previewDeps.baseUrl ?? process.env.PUBLIC_BASE_URL;

  const created: string[] = [];
  for (const t of pending) {
    let bodyPrefix = "";
    if (baseUrl) {
      try {
        const html = await generatePreview({ key: t.key, title: t.title, body: t.body });
        if (html) {
          const png = await renderPng(html);
          await db.update(tasks).set({ previewHtml: html, previewImage: png }).where(eq(tasks.id, t.id));
          bodyPrefix = `![preview](${baseUrl}/preview/${t.id}.png)\n\n`;
        }
      } catch (e) {
        console.error(`[issues] preview failed for ${t.key}:`, e instanceof Error ? e.message : e);
      }
    }
    const issue = await openIssue(proj.installationId, proj.repoFullName, `[${t.key}] ${t.title}`, bodyPrefix + t.body);
    await db.update(tasks).set({ githubIssueNumber: issue.number, githubIssueUrl: issue.url, updatedAt: new Date() }).where(eq(tasks.id, t.id));
    created.push(t.key);
  }
  return { created };
```

(Keep the existing project-resolution + `pending` query above unchanged. Ensure `tasks` and `eq` are imported — they already are.)

- [ ] **Step 4: Run the tests + typecheck** — `npx tsx --test src/github/issues.test.ts` → PASS (existing + 3 new); `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `git add src/github/issues.ts src/github/issues.test.ts && git commit -m "[TASK-051] embed best-effort preview image in generated issues (REQ-009)"`

- [ ] **Step 6: Full verify** — stop any `:3000` server; run the suite **serially** (memory-constrained env): `for f in $(node -e "console.log(require('./package.json').scripts.test.replace('tsx --test','').trim())"); do npx tsx --test "$f"; done` → all pass. Then `npm run build` clean.

- [ ] **Step 7: Live end-to-end (controller + user)** — apply the Task-1 migration to the live DB by hand; rebuild + restart; trigger generation for a real idea so the worker creates an issue → confirm the issue shows the **inline mockup image** on GitHub (Camo fetches `https://paul.tailf03436.ts.net/preview/<id>.png`). Confirm a backend-flavored task gets a diagram-style mockup. If the image is broken, check the route returns the PNG publicly and `PUBLIC_BASE_URL` is correct.

---

## Self-Review

**Spec coverage:** schema/bytea → Task 1; `generatePreviewHtml` (validate/retry-skip) → Task 2; `renderHtmlToPng` (Puppeteer, height-cap, reused browser) → Task 3; public `/preview/<id>.png` route → Task 4; wire generate→render→store→embed + best-effort + `PUBLIC_BASE_URL` → Task 5; truth model (no event; external; post-commit) honored — preview stored via plain `db.update`, no `emitEvent`; live Funnel e2e → Task 5 Step 7. "Every task, adapted" → the system prompt in Task 2 instructs UI-vs-backend adaptation.

**Placeholder scan:** every code/test step is complete with commands + expected results. No TBD.

**Type consistency:** `generatePreviewHtml(task, deps?) → Promise<string|null>` and `renderHtmlToPng(html) → Promise<Buffer>` are produced in Tasks 2/3 and consumed by name in Task 5's `PreviewDeps` (`typeof generatePreviewHtml` / `typeof renderHtmlToPng`); `tasks.previewHtml`/`previewImage` defined in Task 1 and used in Tasks 4/5; `getPreviewPng(db, id)` defined + consumed within Task 4. `createIssuesForTasks` keeps `openIssue` as the 3rd positional arg (existing tests/worker unaffected) and adds `previewDeps` 4th.

## Out of scope (carried from spec)
Regenerating previews after issue exists; a board UI view; per-image access control beyond the unguessable UUID URL.
