# Requirement Diagram + Task-Title Wrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the requirement-detail view, make task titles wrap (fully readable) and add an on-demand, LLM-generated conceptual diagram of what a requirement represents, rendered inline.

**Architecture:** Reuse the narrative-roadmap pattern end to end — an LLM (Sonnet) produces one self-contained HTML document, stored as a derived cache column on `requirements`, rendered in a sandboxed `<iframe>`. Generation is user-triggered via a server action; the render path never calls the LLM. No event is emitted (derived cache).

**Tech Stack:** Next.js App Router (RSC + server actions, `useActionState`), Drizzle + Postgres/PGlite, `@anthropic-ai/sdk`, Tailwind v4, `tsx --test`.

## Global Constraints

- TypeScript throughout; **no `any` in domain code** (events/tasks/requirements).
- LLM model is **`claude-sonnet-4-6`** (Sonnet) — **never Haiku**. Validate/parse output, retry once, then fail — **never persist partial/garbage** output.
- The diagram is a **derived cache → NO event** (the only sanctioned eventless write here; matches `narratives.roadmap_html`). Every *other* state change would still require an in-tx event — none occur in this plan.
- **New test files MUST be registered** in the `test` script in `package.json` (enumerated, not globbed — unregistered tests are silently skipped).
- **New migration MUST be hand-applied** to the live `:5434` Postgres (`docker exec … psql < drizzle/0011_*.sql`); `npm run db:migrate` runs *all* migrations and is fresh-provision only.
- Untrusted LLM HTML renders **only** in `sandbox="allow-scripts"` (opaque origin) — **never** `dangerouslySetInnerHTML`.
- Dogfood: branch `task-059-requirement-diagram`; final squash message starts `[TASK-059]`; one task, **REQ-017**. (Per-task commits below are on that branch; defer committing if the user prefers.)

---

### Task 0: Branch

- [ ] **Step 1: Create the working branch**

Run: `git checkout -b task-059-requirement-diagram`
Expected: `Switched to a new branch 'task-059-requirement-diagram'`

---

### Task 1: Task-title wrap fix

**Files:**
- Modify: `src/app/(app)/spec/requirement-detail.tsx` (the `r.tasks.map(...)` list, ~lines 31-43)

**Interfaces:**
- Consumes: existing `RequirementDetail.tasks` (`{ key, title, githubStatus, claimState, githubIssueUrl }`).
- Produces: nothing new.

- [ ] **Step 1: Replace the task `<li>` markup**

In `src/app/(app)/spec/requirement-detail.tsx`, replace the `<ul>…</ul>` block (currently using `items-center` + `truncate`) with:

```tsx
<ul className="mt-3 flex flex-col gap-2">
  {r.tasks.map((t) => (
    <li key={t.key} className="flex items-start gap-2 text-[13px]">
      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${t.githubStatus === "closed" ? "bg-shipped" : "bg-graphite"}`} />
      <span className="shrink-0 font-mono text-spine-deep">{t.key}</span>
      <span className="min-w-0 flex-1 break-words text-ink">{t.title}</span>
      {t.claimState === "claimed" && <span className="shrink-0"><Pill tone="spine" dot={false}>claimed</Pill></span>}
      {t.githubIssueUrl && (
        <a href={t.githubIssueUrl} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-[11px] text-spine-deep hover:underline">issue ↗</a>
      )}
    </li>
  ))}
</ul>
```

What changed: `items-center` → `items-start`; dot gets `mt-1.5 shrink-0`; the REQ key / `claimed` pill (wrapped, since `Pill` takes no `className`) / `issue ↗` link get `shrink-0`; the title drops `truncate` and gains `break-words` so it wraps. `min-w-0 flex-1` is retained so the title can shrink/wrap inside flex.

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Visual check (manual)**

Open `/spec` in the signed-in app, open a requirement with a long task title (or temporarily verify with a known one). Confirm the title wraps onto multiple lines and is fully visible; the key, pill, and issue link stay aligned at the top.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/spec/requirement-detail.tsx
git commit -m "fix(spec): wrap long task titles in requirement detail (REQ-017)"
```

---

### Task 2: Schema column + migration 0011

**Files:**
- Modify: `src/db/schema.ts` (the `requirements` table, after the `description` column ~line 59)
- Create: `drizzle/0011_*.sql` + `drizzle/meta/*` (generated)

**Interfaces:**
- Produces: `requirements.diagramHtml` (Drizzle column, SQL `diagram_html text` nullable).

- [ ] **Step 1: Add the column to the schema**

In `src/db/schema.ts`, inside `export const requirements = pgTable("requirements", { … })`, add after the `description` line:

```ts
  diagramHtml: text("diagram_html"), // derived conceptual-diagram cache (REQ-017); regenerable, no event
```

(`text` is already imported in this file.)

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0011_*.sql` is created containing roughly `ALTER TABLE "requirements" ADD COLUMN "diagram_html" text;`, plus an updated `drizzle/meta/` snapshot. Open the `.sql` and confirm it only adds the column (no drops).

- [ ] **Step 3: Verify the test DB still builds (column present)**

Run: `npm test`
Expected: all existing tests pass. (PGlite rebuilds its schema from the concatenated `drizzle/*.sql` files, so 0011 is now part of the test schema.)

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/0011_*.sql drizzle/meta
git commit -m "feat(db): add requirements.diagram_html cache column (REQ-017)"
```

- [ ] **Step 5: Hand-apply to the live DB (deploy/ops step)**

> Run when deploying to the live box (or via the `/apply-migration` skill). Not part of the code commit.

Run: `docker exec -i throughline-pg psql -U throughline -d throughline < drizzle/0011_*.sql`
Verify: `docker exec -i throughline-pg psql -U throughline -d throughline -c "\d requirements" | grep diagram_html`
Expected: `diagram_html | text`.

---

### Task 3: Diagram generator + test (TDD)

**Files:**
- Create: `src/spec/diagram.ts`
- Test: `src/spec/diagram.test.ts`
- Modify: `package.json` (register the test)

**Interfaces:**
- Consumes: `extractText`, `extractHtml`, `isValidHtml` from `src/preview/html.ts`; `createClient` from `src/anthropic.ts`.
- Produces:
  - `RequirementDiagramInput = { key: string; title: string; description: string; tasks: { key: string; title: string; status: "open" | "closed" }[] }`
  - `generateRequirementDiagramHtml(input: RequirementDiagramInput, deps?: { client?: Anthropic; modelId?: string; maxRetries?: number }): Promise<string | null>`

- [ ] **Step 1: Write the failing test**

Create `src/spec/diagram.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { generateRequirementDiagramHtml } from "./diagram";

function fakeClient(texts: string[]) {
  let i = 0;
  return { messages: { create: async () => ({ content: [{ type: "text", text: texts[Math.min(i++, texts.length - 1)] }] }) } } as never;
}
const input = {
  key: "REQ-017",
  title: "Spec map",
  description: "A grid of requirement cells — not-started / building / shipped.",
  tasks: [{ key: "TASK-059", title: "Requirement diagram", status: "open" as const }],
};

test("returns diagram HTML for valid output", async () => {
  const html = "<!doctype html><html><body><div>concept</div></body></html>";
  const r = await generateRequirementDiagramHtml(input, { client: fakeClient([html]), maxRetries: 1 });
  assert.ok(r && r.includes("concept"));
});

test("strips a code fence", async () => {
  const r = await generateRequirementDiagramHtml(input, { client: fakeClient(["```html\n<html><body>x</body></html>\n```"]), maxRetries: 1 });
  assert.ok(r && r.startsWith("<html>") && !r.includes("```"));
});

test("retries once then null on non-HTML", async () => {
  const r = await generateRequirementDiagramHtml(input, { client: fakeClient(["nope", "still nope"]), maxRetries: 1 });
  assert.equal(r, null);
});

test("null (no throw) on API error", async () => {
  const client = { messages: { create: async () => { throw new Error("boom"); } } } as never;
  assert.equal(await generateRequirementDiagramHtml(input, { client, maxRetries: 1 }), null);
});

test("rejects output over the size cap", async () => {
  const big = "<html><body>" + "x".repeat(40000) + "</body></html>";
  assert.equal(await generateRequirementDiagramHtml(input, { client: fakeClient([big, big]), maxRetries: 1 }), null);
});
```

- [ ] **Step 2: Register the test in package.json**

In `package.json`, in the `"test"` script string, add ` src/spec/diagram.test.ts` immediately after `src/spec/detail.test.ts`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx --test src/spec/diagram.test.ts`
Expected: FAIL — cannot find module `./diagram`.

- [ ] **Step 4: Implement the generator**

Create `src/spec/diagram.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "../anthropic";
import { extractText, extractHtml, isValidHtml } from "../preview/html";

const MODEL_ID = "claude-sonnet-4-6";
const MAX_HTML_BYTES = 30000;

export interface RequirementDiagramInput {
  key: string;
  title: string;
  description: string;
  tasks: { key: string; title: string; status: "open" | "closed" }[];
}

const SYSTEM = `You produce ONE self-contained HTML "concept diagram" that explains, for a NON-TECHNICAL reader, what a single software requirement represents — what the capability does and why it matters.
Rules:
- Output ONLY one HTML document. No prose, no markdown, no code fences.
- Inline <style> only. No external resources, no <script>, no network.
- VISUAL-FIRST and low-text: use simple shapes, boxes/arrows, icons or emoji, and at most one short real-world analogy. Prefer a diagram over paragraphs.
- Communicate the IDEA of the requirement, not its implementation. No code, no file names, no jargon.
- Aesthetic (ledger): light "paper" background (~#FAF8F3), dark ink text (~#1A1A1A), hairline borders (~#E5E0D8), a verdigris/teal accent (~#2E7D74). Clean modern sans for headings, a monospace for the REQ id only. Calm, lots of whitespace. Body width ~100% (max ~900px), centered. Well under 30KB.
- Ground EVERYTHING strictly in the requirement title, description, and task list provided. Do NOT invent features, mechanisms, scope, dates, or numbers not present.`;

function buildUserMessage(input: RequirementDiagramInput): string {
  const tasks = input.tasks.length
    ? input.tasks.map((t) => `- ${t.key} (${t.status === "closed" ? "done" : "in progress/planned"}): ${t.title}`).join("\n")
    : "(no tasks yet)";
  return `## Requirement ${input.key}: ${input.title}\n\n## What it means (description)\n${input.description || "(no description)"}\n\n## The work under it (tasks)\n${tasks}\n\nDraw the concept diagram now, grounded strictly in the above.`;
}

export async function generateRequirementDiagramHtml(
  input: RequirementDiagramInput,
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

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx --test src/spec/diagram.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/spec/diagram.ts src/spec/diagram.test.ts package.json
git commit -m "feat(spec): LLM generator for requirement concept diagram (REQ-017)"
```

---

### Task 4: Surface `diagramHtml` in the detail query (+ test)

**Files:**
- Modify: `src/spec/detail.ts`
- Test: `src/spec/detail.test.ts` (extend existing first test)

**Interfaces:**
- Produces: `RequirementDetail.diagramHtml: string | null` (now selected and returned).

- [ ] **Step 1: Extend the failing test**

In `src/spec/detail.test.ts`, in the first test (`"…returns the requirement with its tasks…"`), after `assert.equal(detail!.tasks[0].githubIssueUrl, "http://x/1");` add:

```ts
    assert.equal(detail!.diagramHtml, null); // defaults null until generated
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/spec/detail.test.ts`
Expected: FAIL — `diagramHtml` is `undefined` (not selected yet).

- [ ] **Step 3: Add the column to the interface and select**

In `src/spec/detail.ts`:

Add to the `RequirementDetail` interface (after `provenance`):

```ts
  diagramHtml: string | null;
```

Add to the requirement `.select({...})` (after `provenance: requirements.provenance`):

```ts
      diagramHtml: requirements.diagramHtml,
```

(`return { ...req, tasks: taskRows }` already spreads the new field.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test src/spec/detail.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spec/detail.ts src/spec/detail.test.ts
git commit -m "feat(spec): return diagramHtml from getRequirementDetail (REQ-017)"
```

---

### Task 5: Server action to generate + store the diagram

**Files:**
- Modify: `src/app/(app)/spec/[key]/actions.ts`

**Interfaces:**
- Consumes: `generateRequirementDiagramHtml` (Task 3), `getRequirementDetail` (Task 4), `activeProjectId` from `@/project/current`.
- Produces:
  - `DiagramState = { ok: true; html: string } | { ok: false; error: string } | null`
  - `generateRequirementDiagram(prev: DiagramState, formData: FormData): Promise<DiagramState>`

> Note (refinement over the spec): the action **returns the generated `html`** so the UI can render it in place immediately. This sidesteps the known drawer limitation that a revalidate does not re-render the intercepted `@drawer` slot (the TASK-058 gotcha) — the component prefers `state.html` over the server-rendered prop.

> No unit test for this action (matches the codebase — `generateTasksForRequirement` is likewise untested; it depends on `auth()`, the live DB, and the LLM). It is covered by `typecheck` + end-to-end verification in Task 8.

- [ ] **Step 1: Add imports**

At the top of `src/app/(app)/spec/[key]/actions.ts`, add:

```ts
import { activeProjectId } from "@/project/current";
import { getRequirementDetail } from "@/spec/detail";
import { generateRequirementDiagramHtml } from "@/spec/diagram";
```

(`auth`, `getDb`, `requirements`, `eq`, `revalidatePath` are already imported.)

- [ ] **Step 2: Append the action**

At the end of the file, add:

```ts
export type DiagramState = { ok: true; html: string } | { ok: false; error: string } | null;

export async function generateRequirementDiagram(_prev: DiagramState, formData: FormData): Promise<DiagramState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };

  const key = String(formData.get("key") ?? "");
  const db = getDb();
  const pid = await activeProjectId();
  const detail = await getRequirementDetail(db, pid, key);
  if (!detail) return { ok: false, error: `Unknown requirement ${key}.` };

  const html = await generateRequirementDiagramHtml({
    key: detail.key,
    title: detail.title,
    description: detail.description,
    tasks: detail.tasks.map((t) => ({ key: t.key, title: t.title, status: t.githubStatus })),
  });
  if (!html) return { ok: false, error: "Couldn't generate a diagram — try again." };

  await db.update(requirements).set({ diagramHtml: html }).where(eq(requirements.id, detail.id));

  revalidatePath(`/spec/${key}`);
  revalidatePath("/spec");
  revalidatePath("/dashboard");
  return { ok: true, html };
}
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/spec/[key]/actions.ts"
git commit -m "feat(spec): server action to generate requirement diagram (REQ-017)"
```

---

### Task 6: Extract shared `HtmlFrame`; refactor `RoadmapFrame`

**Files:**
- Create: `src/components/html-frame.tsx`
- Modify: `src/app/(app)/narrative/roadmap-frame.tsx`

**Interfaces:**
- Produces: `HtmlFrame({ html: string; title: string; className?: string })` — a sandboxed, auto-height iframe for untrusted HTML.
- `RoadmapFrame({ html })` keeps its signature, now delegating to `HtmlFrame`.

- [ ] **Step 1: Create the shared frame**

Create `src/components/html-frame.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

// Injected into the (sandboxed, opaque-origin) iframe to report its content
// height to the parent. The parent validates every message before trusting it.
const REPORTER =
  "<script>(function(){function r(){parent.postMessage({__hf:'h',height:document.documentElement.scrollHeight},'*');}" +
  "window.addEventListener('load',r);if(window.ResizeObserver){new ResizeObserver(r).observe(document.documentElement);}r();})();</script>";

/**
 * Render an untrusted, LLM-generated HTML document in a sandboxed iframe that
 * auto-grows to its content. sandbox="allow-scripts" WITHOUT allow-same-origin
 * keeps the frame on an opaque origin — its scripts run but cannot reach the
 * app's cookies/DOM. The only channel is postMessage, which we validate
 * (source identity, message shape, numeric height, clamped).
 */
export function HtmlFrame({ html, title, className = "" }: { html: string; title: string; className?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(420);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const frame = ref.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const data = e.data as { __hf?: string; height?: unknown };
      if (data?.__hf !== "h" || typeof data.height !== "number") return;
      setHeight(Math.min(Math.max(data.height, 120), 6000));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-scripts"
      srcDoc={html + REPORTER}
      scrolling="no"
      className={`w-full rounded-lg border border-hairline bg-paper ${className}`}
      style={{ height }}
    />
  );
}
```

- [ ] **Step 2: Refactor `RoadmapFrame` to delegate**

Replace the entire contents of `src/app/(app)/narrative/roadmap-frame.tsx` with:

```tsx
import { HtmlFrame } from "@/components/html-frame";

/** Narrative roadmap — an auto-height sandboxed frame for the LLM-generated HTML (REQ-016). */
export function RoadmapFrame({ html }: { html: string }) {
  return <HtmlFrame html={html} title="Project roadmap — journey and what's next" className="mb-8" />;
}
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Visual check (manual) — narrative unchanged**

Open `/narrative`, click Regenerate (or view an existing roadmap). Confirm the roadmap still renders and auto-sizes exactly as before.

- [ ] **Step 5: Commit**

```bash
git add src/components/html-frame.tsx "src/app/(app)/narrative/roadmap-frame.tsx"
git commit -m "refactor(ui): extract shared sandboxed HtmlFrame from RoadmapFrame"
```

---

### Task 7: `RequirementDiagram` component + wire into the detail view

**Files:**
- Create: `src/app/(app)/spec/requirement-diagram.tsx`
- Modify: `src/app/(app)/spec/requirement-detail.tsx`

**Interfaces:**
- Consumes: `generateRequirementDiagram` + `DiagramState` (Task 5), `HtmlFrame` (Task 6), `buttonClass` from `@/components/ui`.
- Produces: `RequirementDiagram({ reqKey: string; html: string | null })`.

- [ ] **Step 1: Create the client component**

Create `src/app/(app)/spec/requirement-diagram.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { generateRequirementDiagram, type DiagramState } from "./[key]/actions";
import { HtmlFrame } from "@/components/html-frame";
import { buttonClass } from "@/components/ui";

export function RequirementDiagram({ reqKey, html }: { reqKey: string; html: string | null }) {
  const [state, action, pending] = useActionState<DiagramState, FormData>(generateRequirementDiagram, null);
  // Prefer a freshly generated diagram (the action returns it) over the stored
  // prop — so it appears in place even in the drawer, which doesn't re-render on revalidate.
  const shown = (state?.ok === true ? state.html : null) ?? html;

  return (
    <div className="mt-5 border-t border-hairline pt-4">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-graphite">Diagram</h3>
      {shown && <HtmlFrame html={shown} title={`What ${reqKey} represents`} className="mt-3" />}
      <form action={action} className="mt-2">
        <input type="hidden" name="key" value={reqKey} />
        <button type="submit" disabled={pending} className={buttonClass(shown ? "quiet" : "primary")}>
          {pending ? (shown ? "Regenerating…" : "Generating…") : shown ? "Regenerate diagram" : "Generate diagram"}
        </button>
        {!shown && <p className="mt-1 text-[11px] text-graphite">A one-shot visual explainer of what this requirement represents.</p>}
      </form>
      {state?.ok === false && <p className="mt-2 text-[13px] text-risk">{state.error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the detail view**

In `src/app/(app)/spec/requirement-detail.tsx`:

Add the import near the top (with the other local imports):

```tsx
import { RequirementDiagram } from "./requirement-diagram";
```

Insert the component **after the description paragraph, before the Tasks `<div>`** — i.e. between the `{r.description && …}` line and `<div className="mt-5 border-t border-hairline pt-4">`:

```tsx
      <RequirementDiagram reqKey={r.key} html={r.diagramHtml} />
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/spec/requirement-diagram.tsx" "src/app/(app)/spec/requirement-detail.tsx"
git commit -m "feat(spec): inline requirement diagram with generate/regenerate (REQ-017)"
```

---

### Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, including the 5 new `src/spec/diagram.test.ts` tests and the extended `detail.test.ts`.

- [ ] **Step 2: Type-check + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed, no errors.

- [ ] **Step 3: End-to-end visual check (signed-in app)**

Ensure the live DB has migration 0011 applied (Task 2, Step 5). In the running app:
- Open a requirement (card/drawer) with **no** diagram → see "Generate diagram"; click it → spinner → the diagram renders inline in the sandboxed frame.
- Click **Regenerate diagram** → a new diagram replaces it.
- Reopen the same requirement → the stored diagram loads from the DB.
- Confirm **long task titles wrap** and are fully readable.

- [ ] **Step 4: Request code review**

Run the `event-integrity-reviewer` agent over the diff. It **will** flag the eventless write to `requirements.diagram_html` in Task 5 — confirm this is the documented, approved derived-cache exception (consistent with `narratives.roadmap_html`) and not a regression. Address any other findings.

- [ ] **Step 5: Integrate**

Squash-merge the branch to `main` as one line:

```bash
git checkout main
git merge --squash task-059-requirement-diagram
git commit -m "[TASK-059] requirement diagram (inline HTML) + wrap long task titles (REQ-017)"
```

---

## Self-Review

**1. Spec coverage:**
- Wrap fix → Task 1. ✓
- `diagram_html` storage + migration (hand-apply) → Task 2. ✓
- LLM generator (Sonnet, validate/retry/null, 30KB cap, conceptual/non-technical prompt) → Task 3. ✓
- Detail query surfaces `diagramHtml` → Task 4. ✓
- Server action (auth, project-scoped, no event, revalidate) → Task 5. ✓
- Shared sandboxed `HtmlFrame` + `RoadmapFrame` refactor → Task 6. ✓
- `RequirementDiagram` component + placement (after description, above Tasks), both page & drawer → Task 7. ✓
- Tests registered; build/typecheck/visual + review + integrate → Task 8. ✓
- Derived-cache/no-event decision → Global Constraints + Task 5 note + Task 8 review. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**3. Type consistency:** `generateRequirementDiagramHtml(RequirementDiagramInput, deps?) → Promise<string|null>` used identically in Tasks 3 & 5. `DiagramState` defined in Task 5, consumed in Task 7. `HtmlFrame({html,title,className?})` defined in Task 6, consumed in Tasks 6 & 7. `RequirementDetail.diagramHtml: string|null` defined in Task 4, consumed in Task 7 wire-up. Task input `status` is sourced from `t.githubStatus` (`"open"|"closed"`) in Task 5 — matches the generator's `tasks[].status` type. ✓
