# Narrative roadmap — vertical + auto-height — design

**Date:** 2026-06-24
**Status:** Approved (design); pending implementation plan
**Layer:** Surface `[3]` — refines the narrative roadmap (TASK-053/054 / REQ-016).
**Task:** TASK-055 · **Requirement:** REQ-016 (project narrative)

## Problem

The narrative roadmap (now live HTML in a sandboxed iframe) reads as a **horizontal** timeline in a fixed-height frame. The user wants it **vertical (top→bottom)**, with the **spine on the left and each milestone's text/card to its right**, and **wider cards**. A vertical timeline is tall and varies with the requirement count, so the fixed iframe height no longer fits — it should **auto-grow to the content**.

## Decisions (settled in brainstorming)

1. **Vertical top→bottom timeline:** a spine line down the **left**; phases as headings; milestone cards stacked top (earliest/shipped) → bottom (upcoming); each card's content sits to the **right** of the spine, with a status dot on the spine. **Wider cards** using the full width right of the line.
2. **Auto-grow iframe:** the iframe resizes to exactly fit the roadmap (page scrolls naturally; no inner scrollbar, no wasted whitespace).

## Architecture

### Roadmap prompt (`src/narrative/roadmap.ts`)
Replace the horizontal/compact-wide layout instructions with a **vertical** spec:
- A vertical spine line on the **left**; group milestones under phase headings, earliest at top → upcoming at bottom.
- Each milestone is a **card to the right of the spine** with a status dot on the spine; cards are **wide** (use the full width to the right of the line) with room for the REQ id, title, and a short status label.
- Status still shown by **icon + colour + label** (shipped/in-progress/planned), with a legend. Body width ~100%. Ground strictly in chapters + real requirement statuses (unchanged). Self-contained inline-CSS, no scripts (unchanged — our wrapper adds the only script; see below).

### Auto-height: `RoadmapFrame` client component (`src/app/(app)/narrative/roadmap-frame.tsx`, new)
- `"use client"` `RoadmapFrame({ html }: { html: string })`.
- Renders `<iframe sandbox="allow-scripts" srcDoc={html + REPORTER} …>` — **`allow-scripts` WITHOUT `allow-same-origin`**, so the frame gets an opaque origin: its scripts run but **cannot read the app's cookies/DOM** (cross-origin). No `allow-top-navigation`/`allow-forms`.
- `REPORTER` is a small constant `<script>` **we** append to the HTML: on `load` + via a `ResizeObserver`, it `parent.postMessage({ __roadmap: "h", height: document.documentElement.scrollHeight }, "*")`.
- A `useEffect` listens for `message`; it accepts only events whose `source === iframe.contentWindow` and whose `data.__roadmap === "h"` with a numeric `height`, then sets the iframe height to `clamp(height, 120, 6000)` (guards against a spoofed/abusive value). Default height (pre-message) ~420px.
- `scrolling="no"` (auto-height means no inner scroll).

### Display (`src/app/(app)/narrative/narrative-panel.tsx`)
Replace the inline `<iframe …>` with `<RoadmapFrame html={n.roadmapHtml} />` (rendered only when `n.roadmapHtml` is present).

## Security

- The roadmap HTML is LLM-generated from board text → untrusted. `allow-scripts` **without** `allow-same-origin` keeps it on an **opaque origin**: any script it contains runs sandboxed and cannot touch the parent app (cookies, DOM, storage) or navigate the top window. The only privileged channel is `postMessage`, which the parent **validates** (source identity, message shape, numeric clamped height). This is the accepted trade-off for auto-height (chosen over the strictest no-scripts sandbox).

## Truth-model constraints (unchanged)

`roadmap_html` stored in the same tx as `content`; `narrative.generated` event unchanged; no new event; LLM outside the tx; best-effort. Display is in-app only.

## Components

**Modified**
- `src/narrative/roadmap.ts` — vertical layout prompt.
- `src/app/(app)/narrative/narrative-panel.tsx` — use `RoadmapFrame`.

**New**
- `src/app/(app)/narrative/roadmap-frame.tsx` — auto-height sandboxed iframe client component.

**Unchanged:** materialize/queries/schema (still store + serve `roadmap_html`).

## Testing

- `roadmap.test.ts` (generateRoadmapHtml) unchanged — its fake-client tests don't depend on prompt text; confirm 5/5 still pass.
- `RoadmapFrame` is a browser-behavior client component (postMessage/ResizeObserver); the project has no React-component/jsdom test harness, so it's verified by **build + typecheck + live** (consistent with the other panels). The message handler's guards (source check, shape, numeric clamp) are simple + reviewed inline.
- Full suite stays green.

## Scope / phasing (for the plan)

1. `roadmap.ts` — vertical layout prompt (confirm roadmap.test still 5/5).
2. `RoadmapFrame` client component (iframe `allow-scripts` no-same-origin + reporter + validated auto-height listener).
3. `narrative-panel.tsx` — use `RoadmapFrame`; build + typecheck + full suite.
4. Verify live: regenerate the narrative, view `/narrative` — vertical roadmap, spine-left/cards-right, wide cards, iframe auto-sized; tune the prompt if the layout needs it.

## Out of scope

- Changing materialize/storage/schema (still `roadmap_html`).
- The issue-preview (PNG) feature.
- A non-iframe render (sandbox isolation is kept; only `allow-scripts` is added for height).
