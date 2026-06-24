# Requirement diagram + task-title wrap — design

**Date:** 2026-06-24
**Task:** TASK-059
**Requirement:** REQ-017 (Spec map) — enhancement to the requirement-detail surface
**Status:** approved (brainstorming), pending implementation plan

## Problem

In the requirement-detail view (the `/spec/[key]` page and its drawer), two issues:

1. **Task titles don't wrap.** Each task row clamps its title to a single line with an ellipsis (`truncate`), so long titles are unreadable in the card.
2. **No visual for a requirement.** There is no at-a-glance picture of *what a requirement represents*. The project already generates LLM→HTML visuals elsewhere (issue previews, narrative roadmap); requirements should get the same treatment.

## Goals

- Task titles wrap and are fully readable in the requirement-detail view (page + drawer).
- An on-demand, regenerable **conceptual diagram** of a requirement — a visual-first, low-text explainer of what the capability does and why, for a non-technical reader — rendered inline.
- Reuse the existing LLM→HTML→sandboxed-iframe machinery; introduce no new rendering or security approach.

## Non-goals

- No Puppeteer / PNG. The diagram is live HTML in a sandboxed iframe (the narrative-roadmap approach, post-TASK-054).
- No automatic generation in the worker or on render. Generation is user-triggered only; the render path never calls the LLM.
- No new requirement (this enhances REQ-017); no SPEC.md change; no `declare-req`/`materialize`.
- No staleness auto-invalidation. The diagram is a regenerable cache with a Regenerate button (matches narrative). No timestamp is stored — no "generated · date" caption (would need a column we don't add).

## Truth-model decision

The diagram is a **derived cache, not a state decision** — no event is emitted. This matches REQ-016's narrative cache ("regenerating updates the cache") and the roadmap-HTML precedent. The write touches only `requirements.diagram_html` (it does **not** bump `updated_at`, which stays meaning "last real change").

> Note: the `event-integrity-reviewer` agent will flag the eventless write to a mutable table. That is expected — it is the documented, approved cache exception, the same shape as `narratives.roadmap_html`.

## Design

### 1. Task-title wrap (bug fix)

File: `src/app/(app)/spec/requirement-detail.tsx`.

Change each task `<li>` from `flex items-center … truncate` to a wrapping layout:
- `<li>`: `flex items-start gap-2 text-[13px]` (top-align so multi-line rows look right).
- status dot: add `mt-1.5 shrink-0` so it aligns with the first text line and never shrinks.
- `<span>` REQ key, `claimed` pill, `issue ↗` link: add `shrink-0` so they keep their size.
- title `<span>`: drop `truncate`; use `min-w-0 flex-1 break-words text-ink` so it wraps.

No data/query change.

### 2. Storage

File: `src/db/schema.ts`.

Add to the `requirements` table:
```ts
diagramHtml: text("diagram_html"),   // nullable; derived visual cache (no event)
```
New migration **`drizzle/0011_*.sql`** via `npm run db:generate`, then **hand-applied to the live :5434 Postgres** (use `/apply-migration`; PGlite tests won't catch a missing apply). Commit the `.sql` + its `drizzle/meta/*` snapshot with the task.

### 3. Generator (the LLM call)

New file: `src/spec/diagram.ts`, modeled on `src/narrative/roadmap.ts`.

```ts
export interface RequirementDiagramInput {
  key: string;
  title: string;
  description: string;
  tasks: { key: string; title: string; status: "open" | "closed" }[];
}

export async function generateRequirementDiagramHtml(
  input: RequirementDiagramInput,
  deps?: { client?: Anthropic; modelId?: string; maxRetries?: number },
): Promise<string | null>;
```

- Model `claude-sonnet-4-6` (Sonnet — never Haiku), `max_tokens` ~6000, `maxRetries` 1.
- Reuse `extractText`, `extractHtml`, `isValidHtml` from `src/preview/html.ts`; enforce a 30 KB byte cap (`MAX_HTML_BYTES = 30000`).
- Returns the HTML string, or `null` on API error or after a failed retry (never throws, never returns partial garbage).
- **Prompt** (SYSTEM + user message): produce ONE self-contained HTML document — a conceptual, **visual-first, low-text explainer** of what this requirement represents, for a **non-technical** reader (simple shapes/diagram, icons or emoji, an everyday analogy). Inline `<style>` only; no `<script>`, no external resources/network. Ledger aesthetic: paper background (~#FAF8F3), dark ink (~#1A1A1A), hairline borders (~#E5E0D8), verdigris/teal accent (~#2E7D74); clean sans headings, monospace for the REQ id; calm, generous whitespace; body width ~100% (max ~900px), centered; well under 30 KB. **Ground strictly** in the title, description, and task list provided — do not invent features, mechanisms, or scope not present.

### 4. Server action

File: `src/app/(app)/spec/[key]/actions.ts` (add alongside `generateTasksForRequirement`).

```ts
export type DiagramState = { ok: true } | { ok: false; error: string } | null;
export async function generateRequirementDiagram(prev: DiagramState, formData: FormData): Promise<DiagramState>;
```

Steps:
1. `auth()` — if not signed in, return `{ ok: false, error: "Not signed in." }` (server actions are not gated by the `(app)` layout redirect — the TASK-036 lesson).
2. `pid = activeProjectId()`; `detail = getRequirementDetail(db, pid, key)` — one lookup, **scoped to the active project** (key alone is ambiguous across projects — the TASK-058 scoping lesson). If `null` → `{ ok: false, error: "Unknown requirement." }`. `detail` already carries `id`, title, description, and tasks.
3. `generateRequirementDiagramHtml({ key: detail.key, title: detail.title, description: detail.description, tasks: detail.tasks.map(t => ({ key: t.key, title: t.title, status: t.githubStatus })) })`. On `null` → `{ ok: false, error: "Couldn't generate a diagram — try again." }` (no write).
4. On success → `db.update(requirements).set({ diagramHtml: html }).where(eq(requirements.id, detail.id))` — **only** `diagram_html`, **no event**.
5. `revalidatePath("/spec/" + key)`, `revalidatePath("/spec")`, `revalidatePath("/dashboard")`; return `{ ok: true }`.

LLM stays strictly in `actions.ts` — never imported into the panel/page (keeps the render path LLM-free, the TASK-034 rule).

### 5. Render — shared sandboxed frame

Extract the sandboxed-iframe + height-reporter from `RoadmapFrame` into a reusable component, so there is **one** security-critical sandbox implementation:

- New `src/components/html-frame.tsx`: `HtmlFrame({ html, title, className? })` — the current `RoadmapFrame` body, generalized (`sandbox="allow-scripts"` only → opaque origin; validated `postMessage` height; clamp [120, 6000]).
- `src/app/(app)/narrative/roadmap-frame.tsx`: `RoadmapFrame` becomes a thin wrapper delegating to `HtmlFrame` (keeps its title/`mb-8` styling). Narrative behavior unchanged.

New client component `src/app/(app)/spec/requirement-diagram.tsx`:
```tsx
"use client";
export function RequirementDiagram({ reqKey, html }: { reqKey: string; html: string | null }) { … }
```
- `useActionState(generateRequirementDiagram, null)`.
- `html` present → `<HtmlFrame html={html} title={`What ${reqKey} represents`} />` + a "Regenerate diagram" submit (form with hidden `key`) + helper/caption line.
- `html` null → a single "Generate diagram" submit + one line of helper text.
- pending → button shows "Generating…"; on `{ok:false}` show the error in `text-risk`.

Mirror `SpecGenerate` (client child invoked inside the server component `RequirementDetail`).

### 6. Wire-up

- `src/spec/detail.ts`: add `diagramHtml: string | null` to the `RequirementDetail` interface and the requirement `select`.
- `src/app/(app)/spec/requirement-detail.tsx`: render `<RequirementDiagram reqKey={r.key} html={r.diagramHtml} />` **after the description, above the Tasks section**. Both the full page and the drawer render `RequirementDetail`, so both get it.

## Error handling

- Generator never throws; `null` on API/parse failure → action returns `{ok:false}` → inline error; nothing persisted (CLAUDE.md: never persist partial/garbage output).
- Render is fully isolated: untrusted LLM HTML runs in `sandbox="allow-scripts"` without `allow-same-origin` (opaque origin, no app cookies/DOM), exactly as the roadmap does. No `dangerouslySetInnerHTML`.

## Testing

- `src/spec/diagram.test.ts` (mirrors `src/narrative/roadmap.test.ts`): injected fake Anthropic client →
  - valid HTML output is returned;
  - malformed output retries then returns `null`;
  - output over the byte cap is rejected → `null`.
  Register the new path in `package.json`'s `test` script (enumerated, not globbed).
- `src/spec/detail.test.ts`: extend to assert `diagramHtml` is selected/returned (default `null`).
- The wrap fix and the rendered diagram are verified **visually in the running app** (signed-in browser), per the Surface-layer practice.

## Ops / dogfood

- Branch `task-059-requirement-diagram`; squash commit/PR title `[TASK-059] …`; one task, REQ-017.
- After `db:generate`, **hand-apply 0011 to the live :5434 DB** before the feature works there.
- No SPEC.md/materialize step (existing requirement).

## Files touched

- `src/db/schema.ts` (+ `drizzle/0011_*.sql`, `drizzle/meta/*`)
- `src/spec/diagram.ts` (new) · `src/spec/diagram.test.ts` (new)
- `src/spec/detail.ts` (+ test)
- `src/app/(app)/spec/[key]/actions.ts`
- `src/app/(app)/spec/requirement-diagram.tsx` (new)
- `src/app/(app)/spec/requirement-detail.tsx`
- `src/components/html-frame.tsx` (new) · `src/app/(app)/narrative/roadmap-frame.tsx` (refactor to wrapper)
- `package.json` (register the new test)
