# Narrative roadmap image — design

**Date:** 2026-06-23
**Status:** Approved (design); pending implementation plan
**Layer:** Surface `[3]` — augments the narrative (REQ-016) with a generated roadmap visual.
**Task:** TASK-053 · **Requirement:** REQ-016 (project narrative)

## Problem

The narrative (`/narrative`) is LLM-generated prose — `narratives.content = { chapters: [{heading, prose, refs}] }`, grounded in the event log, regenerated on demand. It's text-only. The user wants the narrative to **also generate a roadmap-style image** ("journey + what's next") shown alongside the chapters, so the project's arc is easy to see at a glance. Designed via ui-ux-pro-max.

## Decisions (settled in brainstorming)

1. **A generated image** (LLM HTML → PNG via the existing Puppeteer renderer), produced **when the narrative is (re)generated** — consistent with the issue-preview feature and safe (no LLM HTML in the app DOM).
2. **"Journey + what's next"** content: where the project has been + current status + what's coming.
3. **Grounded in real data**, not invented: fed the just-generated chapters **and** a requirement-status summary (shipped/building/planned + key titles) from `requirements.status`.
4. **In-app display** on `/narrative` (auth-gated over Tailscale) via a `data:image/png` URI — no Camo/public hosting needed (unlike the GitHub previews).
5. ui-ux-pro-max visual: a horizontal **spine timeline** with milestone nodes, status by **icon + color + label** (never color alone), a legend, in the ledger aesthetic.

## Architecture

### Flow — added to `materializeNarrative`, after the chapters, **best-effort**

1. Generate chapters as today (`generateNarrative` → `content`).
2. Query the project's requirements `{ key, title, status }` (the `requirements` table, scoped to `projectId`) → group into shipped / building / planned.
3. `generateRoadmapHtml({ chapters, requirements })` — LLM (Sonnet) → a self-contained roadmap HTML, grounded in the chapters (journey) + the status groups (done / current / next). Validate (HTML-ish, ≤ ~30 KB), retry-once-then-`null`.
4. `renderHtmlToPng(html)` — **reuse `src/preview/render.ts`** (Puppeteer, height-capped).
5. Insert the `narratives` row with `content` **plus** `roadmap_html` + `roadmap_image` (when generated), and emit `narrative.generated` — the existing single transaction.

**Failure handling:** any roadmap step failing (LLM / Chromium) → log and store the narrative **without** the roadmap (`roadmap_image` null). The roadmap never blocks narrative generation.

### Serving / display

`/narrative` (`narrative-panel.tsx`) reads the latest narrative's `roadmap_image`; when present, renders it at the top, above the chapters, as `<img src="data:image/png;base64,…">`. In-app only (authenticated). No public route — the board is the audience.

### Shared HTML helper (small refactor)

Extract `extractHtml` + `isValidHtml` (currently module-private in `src/preview/generate.ts`) into `src/preview/html.ts`, imported by both `generate.ts` and the new `roadmap.ts` (DRY — two LLM-HTML producers now). Each consumer keeps its own byte cap (preview 20 KB, roadmap 30 KB).

## Roadmap visual (ui-ux-pro-max-informed prompt aesthetic)

- **Horizontal spine timeline**, left → right: shipped phases → current (building) → what's next (planned); milestone dots on a verdigris spine line (Throughline's signature).
- **Status = icon + color + label:** ✓ shipped (green/`shipped`), ◐ building (amber/`planned`-vs-`building` accent), ○ planned (muted) — never color alone (accessibility).
- **Ledger aesthetic:** paper background, ink text, hairline borders, verdigris spine accent; Archivo-style headings, Plex-mono labels. A small **status legend**. ~1100 px wide, self-contained (inline `<style>`, no scripts/network).
- Minimal prose; phase/milestone labels are short and plain.

## Truth-model constraints

- `roadmap_html` / `roadmap_image` are part of the **narrative materialization** — stored in the same insert as `content`. The existing **`narrative.generated`** event is unchanged; **no new event**.
- LLM + render are **external side-effects performed before** the transaction (like `generateNarrative`), never inside it, never at render time.
- Grounded strictly in the chapters + real `requirements.status`; the prompt forbids inventing phases/dates.

## Components

**New**
- `src/preview/html.ts` — shared `extractHtml`, `isValidHtml`.
- `src/narrative/roadmap.ts` — `generateRoadmapHtml(input, deps?)`.

**Modified**
- `src/preview/generate.ts` — import the shared helpers (no behavior change).
- `src/narrative/materialize.ts` — query requirement statuses, generate+render+store the roadmap (best-effort), inject deps for tests.
- `src/db/schema.ts` — `narratives.roadmap_image` (bytea), `narratives.roadmap_html` (text), both nullable + migration (hand-applied to live DB).
- `src/narrative/queries.ts` + `src/app/(app)/narrative/narrative-panel.tsx` — fetch + render the roadmap image.

## Testing

- **`generateRoadmapHtml`** (mock Anthropic client): returns HTML for good output; strips a code fence; enforces the size cap; retries once then `null` on non-HTML; `null` (no throw) on API error.
- **`materializeNarrative`** (PGlite + injected narrative generator + injected roadmap generator + render): stores `roadmap_image` when the roadmap succeeds; **still stores the narrative + emits `narrative.generated` when the roadmap generator returns `null` or render throws** (best-effort); the roadmap input carries the real requirement statuses.
- **shared `extractHtml`/`isValidHtml`**: existing preview `generate.test.ts` continues to pass after the import refactor.
- **display**: `narrative-panel` renders an `<img>` when `roadmap_image` is present, none when absent.
- New test files appended to the `package.json` test list.

## Scope / phasing (for the plan)

1. Shared `src/preview/html.ts` + refactor `generate.ts` to use it (suite stays green).
2. Schema columns + migration.
3. `generateRoadmapHtml` (+ tests) — the ui-ux-pro-max roadmap prompt.
4. Wire into `materializeNarrative` (grounded input + best-effort store) (+ tests).
5. Display on `/narrative` + verify (render a real roadmap, view the PNG, iterate the prompt).

## Out of scope

- A public route / GitHub embedding of the roadmap (in-app only).
- An interactive/clickable roadmap (it's a static image).
- Regenerating the roadmap independently of the narrative (it's produced with the narrative).
- Changing the chapters' generation or the `narrative.generated` event.
