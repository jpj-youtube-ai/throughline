# Narrative roadmap as HTML (not image) — design

**Date:** 2026-06-24
**Status:** Approved (design); pending implementation plan
**Layer:** Surface `[3]` — refines the narrative roadmap (TASK-053 / REQ-016).
**Task:** TASK-054 · **Requirement:** REQ-016 (project narrative)

## Problem

TASK-053 added a narrative roadmap as a **PNG** (LLM HTML → Puppeteer → bytea → `<img data:>`). The roadmap is only ever shown **in-app** on `/narrative`, so rasterizing to PNG is needless overhead — render the HTML directly instead. The catch: the roadmap HTML is **LLM-generated and grounded in board text** (idea/requirement content), so it's untrusted — it must be rendered without executing scripts or leaking CSS into the app.

## Decision

- **Render `roadmap_html` directly in a sandboxed `<iframe srcdoc>`** with `sandbox=""` (no `allow-scripts`, no `allow-same-origin`): the browser neutralizes any scripts and gives the frame an opaque origin, and the iframe isolates the roadmap's CSS from the app. No new dependency. (Chosen over server-side sanitize-and-inline, which risks CSS bleed + sanitizer gaps, and over `allow-scripts`+height-reporter, which lets LLM scripts run.)
- **Drop the PNG path entirely:** no Puppeteer render in narrative generation, no `roadmap_image` column. **The narrative no longer uses Puppeteer at all** (the issue-preview feature keeps using it in the worker).
- A sandboxed iframe can't auto-size; use a **sensible fixed height** (tunable constant), full width, with internal scroll for taller roadmaps.

## Architecture (changes from TASK-053)

### `materializeNarrative` (`src/narrative/materialize.ts`)
- Remove the `renderHtmlToPng` import + the `RoadmapDeps.renderPng` dep.
- The best-effort roadmap step now stores **only `roadmap_html`**: `roadmapHtml = await generateRoadmap({ chapters, requirements })` in a try/catch; on `null`/throw → store the narrative with `roadmapHtml` null. Insert `{ content, projectId, roadmapHtml }` (no `roadmapImage`) in the same transaction; `narrative.generated` event unchanged.

### Schema (`src/db/schema.ts`) + migration
- **Drop** `narratives.roadmap_image`. Keep `roadmap_html` (text, nullable). New migration `DROP COLUMN "roadmap_image"` — **hand-applied to the live DB** (brand-new column from TASK-053; the only data is regenerable). The shared `bytea` custom type stays (still used by `tasks.preview_image`).

### Query (`src/narrative/queries.ts`)
- `LatestNarrative.roadmapHtml: string | null` (replacing `roadmapImage: Buffer | null`); select `narratives.roadmapHtml`.

### Display (`src/app/(app)/narrative/narrative-panel.tsx`)
- Replace the `<img src="data:image/png…">` with:
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
  (height is a tunable constant; refine after viewing.)

### `generateRoadmapHtml` (`src/narrative/roadmap.ts`)
- Unchanged logic (still self-contained inline-CSS HTML, validate + retry-skip). Minor prompt note: keep the layout **compact and wide** so it fits a ~1000×800 area without excessive vertical scroll (lay phases out horizontally).

## Truth-model constraints (unchanged)

- `roadmap_html` stored in the **same transaction** as `content`; `narrative.generated` event **unchanged**; **no new event**; the LLM call runs **outside** the transaction; best-effort (failure → narrative without roadmap).
- Display is **in-app only**, now via a sandboxed iframe (no PNG, no data URI, no public route).

## Components

**Modified**
- `src/db/schema.ts` (+ migration) — drop `roadmap_image`.
- `src/narrative/materialize.ts` — drop render/image; store html only; drop `renderPng` dep.
- `src/narrative/queries.ts` — return `roadmapHtml`.
- `src/app/(app)/narrative/narrative-panel.tsx` — sandboxed iframe.
- `src/narrative/roadmap.ts` — minor prompt note (compact/wide).

**Unchanged:** `src/preview/render.ts` + `src/preview/html.ts` (the preview feature still uses them); the issue-preview pipeline (TASK-051/052).

## Testing

- **`materializeNarrative`** (PGlite + injected narrative generator + injected `generateRoadmap`): stores `roadmap_html` when the roadmap succeeds; **still stores the narrative + emits `narrative.generated` when the roadmap generator returns `null` or throws** (best-effort); the roadmap input carries the real requirement statuses. (The old "render throws" test is removed — render is no longer in the path.)
- **schema round-trip**: `narratives.roadmap_html` round-trips (drop the `roadmap_image` assertion).
- **display**: `narrative-panel` renders the `<iframe>` (with `sandbox=""` + `srcDoc`) only when `roadmapHtml` is present, none when absent.
- Suite stays green; `roadmap.test.ts` (generateRoadmapHtml) unchanged.

## Scope / phasing (for the plan)

1. Drop `roadmap_image` (schema + migration); update the columns round-trip test.
2. `materializeNarrative` — store html only, drop the render/image + `renderPng` dep (+ update its tests).
3. `queries.ts` + `narrative-panel.tsx` — `roadmapHtml` + sandboxed iframe.
4. Minor `roadmap.ts` prompt note (compact/wide); verify (regenerate, view `/narrative`, tune the iframe height/prompt).

## Out of scope

- Auto-height iframe (no `allow-scripts`); a fixed height with internal scroll is accepted.
- Re-adding any image/PNG path for the narrative.
- Changing chapter generation, the `narrative.generated` event, or the issue-preview (PNG) feature.
