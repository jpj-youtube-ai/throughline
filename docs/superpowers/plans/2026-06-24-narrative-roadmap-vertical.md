# Vertical Narrative Roadmap + Auto-Height Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the narrative roadmap a vertical top→bottom timeline (spine left, wide cards right) shown in an auto-sizing sandboxed iframe.

**Architecture:** Update the roadmap prompt to a vertical layout; render the HTML in a new `RoadmapFrame` client component that uses `sandbox="allow-scripts"` (no same-origin) plus a height-reporter `postMessage` so the iframe grows to exactly fit its content.

**Tech Stack:** Next.js 16 App Router (client component, `postMessage`/`ResizeObserver`), `@anthropic-ai/sdk` (Sonnet), Node `tsx --test`.

## Global Constraints

- **TypeScript; no `any`** in domain code.
- **Untrusted HTML:** the roadmap iframe uses `sandbox="allow-scripts"` **without** `allow-same-origin` (opaque origin → frame scripts can't touch the app). The parent **validates** height messages (source identity, shape, numeric, clamped). Never `allow-same-origin`, never `dangerouslySetInnerHTML`.
- **Storage/schema/truth-model unchanged:** still store + serve `roadmap_html`; `narrative.generated` unchanged; no new event; best-effort.
- Commits `[TASK-055]`, REQ-016. Branch `task-055-narrative-roadmap-vertical`.

---

## File Structure

**Modified**
- `src/narrative/roadmap.ts` — vertical-layout prompt.
- `src/app/(app)/narrative/narrative-panel.tsx` — render `<RoadmapFrame>`.

**New**
- `src/app/(app)/narrative/roadmap-frame.tsx` — auto-height sandboxed-iframe client component.

**Unchanged:** materialize / queries / schema / `roadmap.test.ts`.

---

## Task 1: Vertical-layout roadmap prompt

**Files:** Modify `src/narrative/roadmap.ts`.

- [ ] **Step 1: Replace the `SYSTEM` constant** — in `src/narrative/roadmap.ts`, replace the entire `const SYSTEM = \`…\`;` block with this vertical version:

```ts
const SYSTEM = `You produce ONE self-contained HTML "roadmap" graphic for a software project —
a VERTICAL top-to-bottom timeline of the journey so far and what's next, for a quick read by anyone.
Rules:
- Output ONLY one HTML document. No prose, no markdown, no code fences.
- Inline <style> only. No external resources, no <script>, no network.
- Layout: a VERTICAL spine line running top -> bottom down the LEFT side. Group milestones under phase
  headings, earliest/shipped at the TOP, upcoming/planned at the BOTTOM. Each milestone is a card placed
  to the RIGHT of the spine, with its status dot sitting ON the spine line.
- Make the cards WIDE — use the full width to the right of the spine — with room for the REQ id, a short
  title, and a one-line status label. Use generous vertical spacing between cards.
- Show each milestone's status with BOTH an icon and a color and a short label (never color alone):
  shipped = check + green, in progress = half-circle + amber, planned/next = hollow circle + muted grey.
- Include a small legend of the three statuses near the top.
- Aesthetic: light "paper" background (~#FAF8F3), dark ink text (~#1A1A1A), hairline borders (~#E5E0D8),
  a verdigris/teal accent (~#2E7D74) for the spine; clean modern sans headings, a monospace for small
  labels/keys (REQ ids). Calm, lots of whitespace. Body width ~100% (max ~1000px), centered. Well under 30KB.
- Ground EVERY milestone in the data given: the chapters are the journey; the requirements are the real
  status. Do NOT invent phases, dates, or features not present. Keep labels short.\`;
```

- [ ] **Step 2: Confirm the generator tests still pass** — `npx tsx --test src/narrative/roadmap.test.ts` → 5/5 PASS (the fake-client tests don't depend on prompt text); `npm run typecheck` clean.

- [ ] **Step 3: Commit** — `git add src/narrative/roadmap.ts && git commit -m "[TASK-055] roadmap prompt: vertical top-to-bottom timeline, spine-left/wide cards (REQ-016)"`

---

## Task 2: `RoadmapFrame` auto-height client component

**Files:** Create `src/app/(app)/narrative/roadmap-frame.tsx`.

**Interfaces:**
- Produces: `RoadmapFrame({ html }: { html: string })` — a `"use client"` component rendering an auto-sizing sandboxed iframe.

- [ ] **Step 1: Create the component** — `src/app/(app)/narrative/roadmap-frame.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

// Injected into the (sandboxed, opaque-origin) iframe to report its content height
// to the parent. The parent validates every message before trusting it.
const REPORTER =
  "<script>(function(){function r(){parent.postMessage({__roadmap:'h',height:document.documentElement.scrollHeight},'*');}" +
  "window.addEventListener('load',r);if(window.ResizeObserver){new ResizeObserver(r).observe(document.documentElement);}r();})();</script>";

/**
 * Render an untrusted, LLM-generated roadmap HTML document in a sandboxed iframe
 * that auto-grows to its content (REQ-016). sandbox="allow-scripts" WITHOUT
 * allow-same-origin keeps the frame on an opaque origin — its scripts run but
 * cannot reach the app's cookies/DOM. The only channel is postMessage, which we
 * validate (source identity, message shape, numeric height, clamped).
 */
export function RoadmapFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(420);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const frame = ref.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const data = e.data as { __roadmap?: string; height?: unknown };
      if (data?.__roadmap !== "h" || typeof data.height !== "number") return;
      setHeight(Math.min(Math.max(data.height, 120), 6000));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={ref}
      title="Project roadmap — journey and what's next"
      sandbox="allow-scripts"
      srcDoc={html + REPORTER}
      scrolling="no"
      className="mb-8 w-full rounded-lg border border-hairline bg-paper"
      style={{ height }}
    />
  );
}
```

- [ ] **Step 2: Typecheck** — `npm run typecheck` → clean. (No unit test: this is browser-behavior — `postMessage`/`ResizeObserver` — and the project has no jsdom/React-component test harness; it's verified by build + the live check in Task 3. The message-handler guards are reviewed inline.)

- [ ] **Step 3: Commit** — `git add "src/app/(app)/narrative/roadmap-frame.tsx" && git commit -m "[TASK-055] RoadmapFrame: auto-height sandboxed iframe for the roadmap (REQ-016)"`

---

## Task 3: Use `RoadmapFrame` on `/narrative` + verify

**Files:** Modify `src/app/(app)/narrative/narrative-panel.tsx`.

**Interfaces:**
- Consumes: `RoadmapFrame` (Task 2); `LatestNarrative.roadmapHtml` (existing).

- [ ] **Step 1: Swap the inline iframe for `RoadmapFrame`** — in `src/app/(app)/narrative/narrative-panel.tsx`, add the import `import { RoadmapFrame } from "./roadmap-frame";` and replace the existing roadmap `<iframe …>` block with:

```tsx
{n.roadmapHtml && <RoadmapFrame html={n.roadmapHtml} />}
```

(Keep chapters/footer/regenerate button unchanged.)

- [ ] **Step 2: Build + typecheck** — stop any `:3000` server; `npm run build` then `npm run typecheck` → both clean (the `/narrative` route compiles; the client component is bundled).

- [ ] **Step 3: Full suite (serial, memory-tight env)** — `for f in $(node -e "console.log(require('./package.json').scripts.test.replace('tsx --test','').trim())"); do npx tsx --test "$f"; done` → all pass.

- [ ] **Step 4: Commit** — `git add "src/app/(app)/narrative/narrative-panel.tsx" && git commit -m "[TASK-055] render the roadmap via auto-height RoadmapFrame on /narrative (REQ-016)"`

- [ ] **Step 5: Live verify (controller + user)** — rebuild + restart the web server from the worktree; regenerate the narrative (`/narrative` "Regenerate") → the roadmap is a **vertical** timeline (spine left, wide cards right), and the iframe **auto-sizes** to the content (no inner scrollbar, no excess whitespace). If the layout needs tuning, adjust the Task-1 prompt and regenerate.

---

## Self-Review

**Spec coverage:** vertical prompt (spine-left, cards-right, wide) → Task 1; auto-height sandboxed iframe (`allow-scripts` no-same-origin + validated reporter) → Task 2; wire into `/narrative` → Task 3; live verify → Task 3 Step 5. Security: `allow-scripts` without `allow-same-origin`, parent validates source/shape/clamped height (Task 2). Truth model untouched (no materialize/schema changes).

**Placeholder scan:** every code step is complete; commands + expected results given. No TBD.

**Type consistency:** `RoadmapFrame({ html: string })` defined Task 2, consumed Task 3 as `<RoadmapFrame html={n.roadmapHtml} />` (`roadmapHtml: string | null`, guarded by `n.roadmapHtml &&`). `generateRoadmapHtml` signature unchanged (Task 1 edits only its prompt string). The reporter message shape `{ __roadmap: "h", height: number }` is produced by `REPORTER` and validated by the listener in the same file.

## Out of scope
materialize/storage/schema changes; the issue-preview (PNG) feature; non-iframe rendering.
