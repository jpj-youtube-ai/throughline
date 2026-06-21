# Dashboard home — design

**Date:** 2026-06-21
**Status:** Approved (design); pending implementation plan
**Layer:** Surface `[3]` (reorganizes existing surface; no new domain state)

## Problem

The app surfaces its 13 views as individual pages in a left sidebar (4 groups:
Story / Work / Spec / Integrity). There is no single place to see the whole
project at a glance — every signal lives one click away behind its own tab. The
user wants a dashboard home that mirrors all the elements on one page.

## Decision summary

These were settled during brainstorming:

1. **Overview home, tabs stay.** A new dashboard becomes the landing page. All 13
   existing pages remain unchanged and reachable; the dashboard summarizes them
   and deep-links in. No page is removed or merged.
2. **Comprehensive grid.** One card per area — all 13, always visible, organized
   into the same four groups as the sidebar. A true mirror of the nav, not an
   opinionated "what needs attention" board.
3. **Stat + tiny preview** per card — a headline stat plus a small glanceable
   preview (latest items / a count / a sparkline), not just a number.
4. **Dashboard is the new home.** A "Dashboard" item is pinned to the top of the
   sidebar; sign-in redirects to `/dashboard` instead of `/pulse`. Pulse stays as
   its own page.

## Non-negotiable constraint (truth model)

The dashboard is **read-only**: a pure projection over existing query functions.
It **emits no events and writes no state**. It introduces no new writer of
`tasks.github_status` or any mutable table. This keeps it clean under the truth
model — there is no state change, so there is correctly no event.

## Cost constraint (the one design call the user blessed)

Three areas are backed by **expensive LLM calls** on their full pages: **Digest**
(`composeDigest`), **Reconcile** (`reconcile`), and **Why-quality**
(`reviewWhyQuality`). A dashboard renders on every visit, so these cards MUST NOT
trigger an LLM on page load. Each shows a **cheap proxy** instead, and the user
clicks into the full page to run the real (LLM) view:

- **Digest** → filter `listActivity` for `digest.sent` events (count + last-sent
  time). No LLM.
- **Reconcile** → `reconcileStructural(db, currentSpec)` (cheap staleness check +
  requirement count + unmapped-code count). The full LLM `reconcile()` stays
  on-demand on its own page.
- **Why-quality** → a cheap count of logged rationales from the event log. The
  full LLM grader stays on-demand on its own page.

This means those three cards are intentionally "lighter" than their pages.

## Routing & data flow

- New route: `src/app/(app)/dashboard/page.tsx` — **server component**,
  `export const dynamic = "force-dynamic"`, read-only.
- Landing change: `src/app/page.tsx` redirects authenticated users to
  `/dashboard` (was `/pulse`); the GitHub `signIn` `redirectTo` updates to
  `/dashboard` in both `src/app/page.tsx` and anywhere else it points to `/pulse`
  for landing. (The `/pulse` page and its own `revalidatePath("/pulse")` stay.)
- Nav: add a **Dashboard** item at the top of `src/components/nav-rail.tsx`,
  above the four groups, as its own pinned entry (not inside a group). Active
  state matches the existing pattern.
- The page fetches all card data in **one `Promise.all`**, then renders. All
  queries are cheap reads (the three LLM areas use their cheap proxies above).

## Layout

Four group sections — **Story / Work / Spec / Integrity** — each with the
existing mono-uppercase section header (same treatment as the nav-rail group
labels). Under each, a responsive card grid:

- `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`
- Story has 4 cards, Work 4, Spec 2, Integrity 3 (13 total).

Page uses the shared `PageHeader` (eyebrow + title + lede).

## The card shell

One new presentational component `DashboardCard` in `src/components/ui.tsx`
(next to `Card`):

- Props: `href`, `Icon`, `title`, `stat` (headline, `ReactNode`), `children`
  (the preview slot, `ReactNode`).
- Structure: icon + title row, headline stat, preview slot, trailing `ArrowIcon`.
- The whole card is a `next/link` `Link` to `href` with the hover affordance used
  elsewhere (e.g. `hover:bg-paper-sunk`).
- Reuses `Card`, `Pill`, and the existing icons. Each card renders a quiet
  one-line state when its area has nothing to show, rather than going blank.

## The 13 cards

Each row: headline stat · tiny preview · data source. All sources are existing
cheap queries except the three marked ⚠ (cheap proxy, see Cost constraint).

### Story
- **Pulse** — events today · latest 2 events (actor · verb · subject) ·
  `listActivity` (`src/events/feed.ts`).
- **Heartbeat** — active N/14 days · 14-day sparkline · `heartbeatSeries(db, now,
  14)` (`src/metrics/heartbeat.ts`).
- **Narrative** — N chapters · when generated · first chapter heading ·
  `getLatestNarrative` (`src/narrative/queries.ts`). Empty: "not generated yet".
- **Digest** ⚠ — last sent / never · count sent · cheap filter of `listActivity`
  for `digest.sent`.

### Work
- **Ideas** — N voting · M past gate · top 2 ideas by votes (`title
  (votes/gate)`) · `listVotingIdeas` (`src/ideas/queries.ts`).
- **Tasks** — claimed / open / merged breakdown · top 2 tasks (in-review and
  claimed first, then newest) with claim state · `listTasks`
  (`src/tasks/queries.ts`).
- **Quick wins** — top score /100 · top 1–2 wins (`KEY: score (effort/risk)`) ·
  `listQuickWins` (`src/metrics/quickwins.ts`).
- **Pipeline** — 5-stage flow `2 → 1 → 3 → 2 → 4` · the labeled stage flow ·
  `listPipeline` (`src/pipeline/queries.ts`).

### Spec
- **Spec** — N requirements (shipped / building / planned) · status pills ·
  `listSpecMap` (`src/spec/map.ts`).
- **Progress** (Burnup) — done/scope (%) · burn-up sparkline · `burnUpSeries`
  (`src/metrics/burnup.ts`).

### Integrity
- **Drift** — N open flags (0 → quiet "no drift") · top 1–2 flags (`TASK (PR #n,
  k items)`) · `listOpenDriftFlags` (`src/drift/queries.ts`).
- **Reconcile** ⚠ — spec fresh / **STALE** · N reqs · unmapped-code count ·
  `reconcileStructural(db, currentSpec)` (`src/integrity/reconcile.ts`). The
  `currentSpec` text comes from the same source the Reconcile page already uses
  (the rendered/materialized spec, e.g. `src/spec/render.ts` or the on-disk
  `SPEC.md`) — confirm which during plan-writing and reuse it, do not re-render.
- **Why-quality** ⚠ — N rationales logged · "run review →" link · cheap count
  from the event log.

## Sparklines

A small shared `Sparkline` component (inline SVG, no chart lib) for Heartbeat and
Progress, fed by the existing series (`heartbeatSeries(...).days`,
`burnUpSeries(...).points`). Compact — sized for a card, not the full-page charts
that already exist (`heartbeat-chart.tsx`, `burnup-chart.tsx`).

## States

- Per-card empty/zero states (e.g. "no drift", "not generated yet", "no ideas in
  voting"). Quiet, single line.
- No error path: all dashboard queries are cheap reads. (The three LLM-backed
  full views keep their own error handling on their own pages.)

## Components touched / added

- **Add:** `src/app/(app)/dashboard/page.tsx`, `DashboardCard` + `Sparkline` in
  `src/components/ui.tsx` (or a small new file if `ui.tsx` grows too large).
- **Edit:** `src/components/nav-rail.tsx` (pinned Dashboard item),
  `src/app/page.tsx` (landing redirect + `signIn` `redirectTo`).
- **Possibly add:** a cheap `digest.sent` selector and a cheap rationale-count
  selector, as small pure functions (testable). Reuse `reconcileStructural` as-is.

## Testing

Runner: Node's built-in test via `tsx --test`, DB via pglite. New `*.test.ts`
files **must be added to the `test` script list in `package.json`** (it is an
explicit file list, not a glob).

Unit-test the new **pure selectors/helpers**:
- the `digest.sent` summary (count + last-sent) over a synthetic activity list,
- the cheap why-quality rationale counter,
- the `Sparkline` SVG path generator (given points → expected path/extents).

The 10 reused queries are already covered by existing tests. The page itself is
thin composition over tested pieces.

## Out of scope (YAGNI)

- No removal or merging of existing pages.
- No new notifications (the only push remains the outbound digest, REQ-026).
- No running LLM views on dashboard load.
- No new mutable tables or events.
- No drag-to-rearrange / customizable dashboard.

## Requirement linkage

This is Surface-layer presentation over existing data. During plan-writing,
confirm whether it maps to an existing Surface requirement in `SPEC.md` or needs
a new `REQ-NNN` declared — per CLAUDE.md, work that maps to no requirement is
drift and must be surfaced, not folded in silently. Either way it ships as one
`[TASK-NNN]` PR.
