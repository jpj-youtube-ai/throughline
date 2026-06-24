# Themed explainer graphics — ledger theme for generated HTML — design

**Date:** 2026-06-24
**Status:** approved (brainstorming), pending implementation plan
**Layer:** Surface `[3]` — restyles the two LLM→HTML explainer graphics to the Throughline design system.
**Tasks:** TASK-060 · **Requirement:** REQ-017 (Spec map / requirement diagram) — introduces the shared brief
&nbsp;&nbsp;&nbsp;&nbsp;TASK-061 · **Requirement:** REQ-009 (issue creation) — issue-preview explainer consumes the brief

> **Cross-REQ note (surfaced, not folded):** this is one cohesive design change that lands across two
> existing requirements. Per CLAUDE.md ("one task per PR; every task implements exactly its linked REQ"),
> it is split into two tasks/PRs that share this single design doc. TASK-060 (REQ-017) is built first
> because it creates the shared brief module; TASK-061 (REQ-009) then consumes it. *Pending user sign-off
> on the split at the spec-review gate.*

## Problem

Two artifacts ask an LLM to produce one self-contained HTML "explainer" graphic, but neither uses the
project's real design system:

1. **`src/spec/diagram.ts`** — the requirement concept diagram, shown in-app in a sandboxed iframe
   (`HtmlFrame`). Its aesthetic block uses *approximate* colors (`#FAF8F3`, `#1A1A1A`, `#E5E0D8`,
   `#2E7D74`) that do **not** match the committed `@theme` tokens, and it permits emoji as icons.
2. **`src/preview/generate.ts`** — the task explainer, rendered to a PNG (`renderHtmlToPng`) and embedded
   in the GitHub issue body. Its aesthetic is **generic** ("Friendly, calm colors") — no theme at all.

Result: the generated graphics read as off-brand and inconsistent with the "iron-gall ink on ledger
paper" Surface aesthetic (verdigris spine, Plex/Archivo voice, cool-bone paper) established in
`globals.css` and the design-system memory.

## Goals

- Both generators produce graphics in the Throughline ledger aesthetic, grounded in the **committed
  `@theme` tokens** (paper `#ECEAE3`, ink `#1A1D2E`, verdigris spine `#2E7D6B`, …) — not approximations.
- A **single shared style brief** is the source of the aesthetic, so the two artifacts cannot drift.
- Introduce the **verdigris "throughline" spine** as the recurring brand device in these graphics —
  used only where a real sequence / before→after / causal flow exists, never forced.
- Keep both graphics **calm and clarity-first** (these explain things to non-technical readers), and
  keep them **self-contained** (no external resources, no network, no web fonts) — unchanged contract.

## Non-goals

- No web fonts. Decided: **system stacks** that evoke Archivo/Plex (the no-network/self-contained
  contract is preserved — the diagram runs in a sandboxed iframe, the preview renders to a PNG offline).
- No change to the rendering/security path: iframe sandbox (`allow-scripts`, opaque origin) and the PNG
  render are untouched. No `dangerouslySetInnerHTML`.
- No change to generation *behavior*: model (`claude-sonnet-4-6`), retry/`maxRetries`, byte caps
  (30 KB diagram / 20 KB preview), and the "never persist partial/garbage" rule are unchanged.
- No truth-model surface: no events, no schema, no `github_status`, no generation-persistence change.
  (No `event-integrity-reviewer` pass required — pure Surface restyle.)
- No "bolder/overdrive" register. Calm-but-distinctive; clarity wins for non-technical readers.

## Design

### 1. Shared brief module (new) — TASK-060

New file **`src/preview/throughline-style.ts`** (lives in `preview/` because `spec/diagram.ts` already
imports `../preview/html` — established cross-module reuse).

```ts
/** The Throughline ledger aesthetic, shared by every LLM→HTML explainer graphic
 *  (requirement diagrams, issue previews) so they cannot drift. Tokens mirror
 *  the committed @theme in src/app/globals.css. */
export const THROUGHLINE_STYLE: string = `...`;
```

Brief content (approved draft) — instructs the model to:
- **Aesthetic:** calm, precise, archival — "iron-gall ink on cool ledger paper," one verdigris thread as
  the only accent; restraint over decoration. Self-contained: ONE HTML doc, inline `<style>` only, no
  external resources / network / `<script>` / `<img>` / web fonts.
- **Palette — by role, only these (no invented/neon colors):** paper `#ECEAE3` (cool bone, *not* warm
  cream) · raised `#F4F2EC` · sunk `#E4E1D8`; ink `#1A1D2E` · ink-soft `#3B3F4F` · secondary `#5A5E6B`;
  hairline `#D6D2C8`; verdigris `#2E7D6B` · deep `#245F52` (accent text) · wash `#E0E9E4`; status (muted,
  only when meaning needs it) done `#2F7D4F` · planned `#B0790F` · risk `#B23A2E` (washes `#E4EDE5` /
  `#F1E9D6` / `#F1E0DC`).
- **Typography — system stacks only:** headings/labels `ui-sans-serif, system-ui, "Segoe UI", Roboto,
  sans-serif` (weight carries hierarchy; heading tracking `-0.01em`, never below `-0.04em`); the one
  "why"/analogy line (sparingly) `Georgia, serif` italic; every REQ/TASK id, count, metric, date
  `ui-monospace, "SF Mono", Consolas, monospace` with tabular figures. Body measure ≤ ~65ch.
- **Signature — the spine:** when the idea is a sequence / before→after / causal flow, draw ONE verdigris
  thread (~2px) with circular nodes — filled = done, hollow (paper fill + 2px verdigris ring) = planned,
  risk = red ring. Use where a flow exists; never force onto non-sequences.
- **Icons:** inline SVG line icons only (~1.75px stroke, `currentColor`, round caps). **No emoji. No
  raster images.**
- **Layout:** centered ~900px column, generous whitespace, hairline rules over nested boxes; at most one
  light surface lift (`#F4F2EC`). Hierarchy by size/space/weight, **not color alone** (pair color with a
  label/icon/position).
- **Contrast:** body/secondary text ≥4.5:1 on paper — ink/ink-soft/graphite, never light gray on the tint.
- **Static-safe (critical for the PNG path):** all content must be visible without animation; never gate
  visibility on a transition (headless render captures a frame); any motion subtle + honors
  `prefers-reduced-motion`.
- **Absolute bans (rewrite if tempted):** emoji-as-icons · colored side-stripe borders · gradient/clip
  text · decorative glassmorphism · identical repeated card grids · a tiny uppercase wide-tracked eyebrow
  on every block · decorative-only color.

### 2. Requirement diagram generator — TASK-060

File **`src/spec/diagram.ts`**. Recompose `SYSTEM` as `ROLE + THROUGHLINE_STYLE + OUTPUT_CONTRACT`:
- **ROLE** (kept, trimmed): produce ONE concept diagram explaining, for a non-technical reader, what a
  single requirement represents — the capability and why it matters; visual-first, low-text; communicate
  the idea, not the implementation; no code/file names/jargon.
- **THROUGHLINE_STYLE**: imported shared brief.
- **OUTPUT_CONTRACT** (kept): output only one HTML document, no prose/markdown/fences; ground EVERYTHING
  strictly in the provided title/description/task list — invent nothing; well under 30 KB.

Export the composed `SYSTEM` (rename module-private `SYSTEM` → `export const SYSTEM`) so it is assertable.
The approximate-color aesthetic block is **deleted** (now sourced from the brief). No behavior change.

### 3. Issue-preview generator — TASK-061

File **`src/preview/generate.ts`**. Same recomposition `ROLE + THROUGHLINE_STYLE + OUTPUT_CONTRACT`:
- **ROLE** (kept): a small explainer that lets a non-technical person instantly understand what a change
  *does for them* — outcome/benefit, ideally a real-world analogy or a simple before→after; no
  code/file-names/technical-terms/app-UI-mockups.
- **THROUGHLINE_STYLE**: imported shared brief.
- **OUTPUT_CONTRACT** (kept): output only one HTML document, no prose/fences; well under 20 KB.

The generic "Friendly, calm colors…" line is **replaced** by the brief. Export `SYSTEM`. No behavior
change to `generatePreviewHtml` or to `createIssuesForTasks` (`src/github/issues.ts` is untouched — it
still embeds the rendered PNG; only the PNG's styling improves).

## Error handling

Unchanged. Both generators still never throw, return `null` on API/parse failure or after a failed
retry, reject output over the byte cap, and never persist partial output. The brief only changes the
*content* of the prompt, not the control flow.

## Testing (TDD)

- **New `src/preview/throughline-style.test.ts`** (register in `package.json`'s enumerated `test`
  script — TASK-060):
  - `THROUGHLINE_STYLE` contains the core tokens (`#2E7D6B`, `#ECEAE3`, `#1A1D2E`, `ui-monospace`).
  - It states the emoji ban (asserts on the "No emoji" / no-raster directive).
  - The requirement-diagram `SYSTEM` (from `spec/diagram.ts`) includes `THROUGHLINE_STYLE`.
  - **Extended in TASK-061:** the issue-preview `SYSTEM` (from `preview/generate.ts`) also includes
    `THROUGHLINE_STYLE` — added once that generator is restyled (it isn't composed from the brief until
    then). Together the two assertions guard the composition so a future edit can't silently drop the
    shared brief from either prompt.
- **Existing `src/spec/diagram.test.ts`** and the preview tests use a mocked Anthropic client and assert
  *behavior* (valid output returned, malformed→retry→`null`, over-cap→`null`), not prompt text — expected
  to stay green; confirm in the verify step.
- Final visual check is **in the running app / a real generated PNG** (Surface-layer practice): generate a
  requirement diagram in the signed-in board and open a freshly created issue's preview image.

## Ops / dogfood

- **TASK-060** `[REQ-017]` — branch `task-060-ledger-requirement-diagram`; squash title `[TASK-060] …`.
  Creates `throughline-style.ts` (+ test), restyles `spec/diagram.ts`, registers the test in
  `package.json`. Verify `npm test` / `npm run typecheck` / `npm run build`.
- **TASK-061** `[REQ-009]` — branch `task-061-ledger-issue-preview`; squash title `[TASK-061] …`.
  Restyles `preview/generate.ts` to import the brief. Depends on TASK-060 (the brief module).
- No migration, no SPEC.md/materialize step (both are existing requirements), no event.

## Files touched

**TASK-060 (REQ-017):**
- `src/preview/throughline-style.ts` (new) · `src/preview/throughline-style.test.ts` (new)
- `src/spec/diagram.ts` (recompose + export `SYSTEM`)
- `package.json` (register the new test)

**TASK-061 (REQ-009):**
- `src/preview/generate.ts` (recompose + export `SYSTEM`)
- `src/preview/throughline-style.test.ts` (extend: assert `generate.ts` `SYSTEM` includes the brief)
