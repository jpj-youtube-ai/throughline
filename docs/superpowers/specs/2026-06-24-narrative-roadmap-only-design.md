# Narrative page: roadmap only — design

**Date:** 2026-06-24
**Status:** Approved; implemented inline (single-file display change).
**Layer:** Surface `[3]` — `/narrative` display (REQ-016).
**Task:** TASK-056 · **Requirement:** REQ-016 (project narrative)

## Problem

With the roadmap now the centerpiece of `/narrative`, the prose chapters below it are redundant. Show **only the roadmap**.

## Decision

- `narrative-panel.tsx`: render **only** the roadmap (`RoadmapFrame`) + a **slim freshness caption** (`updated from N events · <date>`) + the Regenerate button. Drop the chapters `<article>` (heading/prose/refs).
- **Keep generating + storing the chapters** — they ground the roadmap (`generateRoadmapHtml` input = the journey) and back the `narrative.generated` event. Internal only now; not displayed.
- **No-roadmap fallback:** when a narrative exists but `roadmapHtml` is `null` (best-effort miss), show a small "Roadmap unavailable — regenerate" `Empty` instead of a blank page.
- Empty state (no narrative) + Regenerate/Generate button unchanged.

## Scope

Display-only, one file (`src/app/(app)/narrative/narrative-panel.tsx`). No change to materialize/generation/queries/schema/events (chapters still generated + stored). Verified by build + typecheck + full suite + live view. Too small for a separate plan — implemented inline.

## Out of scope

Stopping chapter generation (the roadmap needs them as grounding); changing the roadmap, materialize, or the event.
