# Single-page dashboard redesign — design

**Date:** 2026-06-21
**Status:** Approved (design); pending implementation plan
**Layer:** Surface `[3]` (re-organizes existing surface into one page; reuses domain logic unchanged)
**Supersedes the IA of:** the tabbed dashboard-home shipped as TASK-031 / REQ-028.

## Problem

The app today is a tabbed dashboard-home (REQ-028): a `/dashboard` overview that summarizes 12 areas and deep-links into 13 separate sidebar pages. The user wants a genuinely **single-page** app — one dashboard that holds everything, with **no other tabs** except **Spec** (upload + map) and **Connect** (GitHub). Visual model: a curated analytics dashboard (the supplied reference image) rendered in the existing "ledger" design system.

## Decisions (settled in brainstorming)

1. **Single page = curated card dashboard**, the post-sign-in landing.
2. **Interactions happen in a drawer/modal opened from each card** — not by navigating to a tab. (User chose "Drawer/modal from cards.")
3. **Only two separate tabs remain:** **Spec** (genesis upload **and** the requirement map, in one tab) and **Connect** (existing GitHub repo-link). (User chose "Both: upload + map in one tab.")
4. **Layout** approved via the visual companion (below).
5. **Drawer mechanism:** Next.js **intercepting routes** reuse the existing per-area page content + server actions as drawer content.
6. **Aesthetic:** existing ledger design system + the ui-ux-pro-max guidance already recorded in `2026-06-21-dashboard-home-design.md`; reference-style card arrangement. No new theme.

## Layout (approved)

Two-region grid: a main area + a full-height right rail. Twelve areas (Spec excluded — it is a tab).

- **Icon rail (left, ~60px):** Dashboard · Spec · Connect, + avatar / sign-out at the bottom. (Replaces the current 4-group nav-rail.)
- **Top bar:** "Dashboard" title + the repo chip (`● org/repo`). No notification bell (anti-goal: no in-app notifications).
- **Main area:**
  - **KPI row (3 cards):** **Tasks** (open/claimed/merged) · **Ideas** (`NEEDS VOTES` badge when any await the viewer's vote) · **Drift** (`ATTENTION` badge when open flags > 0, else quiet "no drift").
  - **Hero row:** **Heartbeat** as a wide line/area chart of 14-day activity (2 columns) · **Progress** burn-up as a **donut** (`%` + done/scope).
  - **Mid row:** **Quick wins** (top picks) · **Pipeline** (5-stage bars) (2 columns).
  - **Small row:** **Reconcile** (structural freshness) · **Why-quality** (rationale count).
- **Right rail (full height):** **Narrative** snippet (latest chapter) → **Pulse** "recent activity" feed → **Digest** (last sent + count).

Every card is clickable and opens that area's drawer.

## Drawers

- Each card links to its area route (`/ideas`, `/tasks`, `/pulse`, …). **Intercepting routes** render that route as a **right-side drawer over the dashboard** rather than a full page.
- **Drawer content = the existing per-area page body, reused**, including its server actions: Ideas (vote, submit-new), Tasks (claim/unclaim), Pulse (log retroactive work), Narrative (regenerate — LLM), Reconcile (run full check — LLM), Why-quality (run review — LLM), Digest (view; send if applicable), Drift (resolve), Quick-wins/Pipeline/Heartbeat/Progress (read).
- Drawers are **URL-addressable**; **Esc / scrim / back** closes and returns to the dashboard. A **direct visit or refresh** of the route renders the same content as a **full-page fallback** (deep links and no-JS still work).
- **LLM actions never fire on load** — only on an explicit button click inside the drawer. The dashboard cards keep showing the cheap proxies (digest count, structural reconcile, rationale count) built in TASK-031.
- **Primary risk to de-risk first:** intercepting + parallel routes inside the `(app)` route group with the auth layout. The plan's first drawer task is a spike; if interception proves too fiddly in Next 16, fall back to a client-side drawer component that renders the area's server component into a slot (server actions still imported directly). The user-visible behavior (card → drawer → action → close) is identical either way.

## Spec tab (`/spec`)

- **New genesis-import UI (top):** paste or upload a Markdown spec → parse with the existing `parseSpecRequirements` → preview the parsed `REQ-NNN` list → **Import** via the existing `importGenesisSpec` (emits `project.genesis_imported` + one `requirement.declared` each, in one transaction).
- **One-time bootstrap:** `importGenesisSpec` refuses if any requirements already exist. So when the table is non-empty the upload section shows a quiet **"already imported"** state (further requirements come via the idea→vote flow or `declareRequirement`, not re-upload).
- **Requirement map (below):** the existing `listSpecMap` view grouped shipped / building / planned (the current `/spec` page content).

## Connect tab (`/connect`)

Unchanged (existing repo-link UI, REQ-002).

## Shell

- Rewrite `src/components/nav-rail.tsx` from the 4 grouped sections into a **3-item icon rail** (Dashboard · Spec · Connect) + avatar / sign-out; update `src/app/(app)/layout.tsx` to host the drawer slot.
- `/dashboard` stays the landing (already wired in TASK-031: `src/app/page.tsx` redirects there).

## Truth-model constraints (unchanged — must still hold)

- The **dashboard page and all card summaries are read-only**: no events, no writes, **no LLM on load**.
- Every **state-changing action** (vote, claim/unclaim, submit idea, log work, resolve drift, declare/import requirements) keeps emitting its event **in the same transaction** via `emitEvent` — these now live inside drawers, but the logic is the **existing, tested server actions**, reused, not rewritten.
- `tasks.github_status` stays **webhook-only**.
- The three LLM areas (Digest, Reconcile, Why-quality): cheap proxy on the card; full LLM only on explicit in-drawer action.

## Components

**New / changed**
- `src/components/nav-rail.tsx` → 3-item icon rail.
- `src/app/(app)/layout.tsx` → add the drawer/parallel-route slot.
- `src/app/(app)/dashboard/page.tsx` → rewrite into the reference grid (KPI cards, hero, rail, mid, small), reusing the TASK-031 summarizers/queries/proxies.
- **New viz:** `Donut` (Progress %) component; a wider line/area **hero chart** for Heartbeat (enlarge the existing `Sparkline`, or a small `LineChart`). `Meter` from TASK-031 may be reused or retired.
- **Drawer infra:** intercepting/parallel routes (e.g. an `@drawer` slot + `(.)ideas`, `(.)tasks`, … entries) that render the existing area page bodies as drawer content.
- **Spec tab:** a genesis-upload component (file/paste → parse → preview → import server action wrapping `importGenesisSpec`) combined with the existing requirement-map view.

**Reused as-is**
- All read queries, the TASK-031 cheap proxies (`digestSummary`, `countRationales`, `structuralReconciliationForProject`), the summarizers, and every state-changing **server action** (vote/claim/submit/logWork/resolveDrift/declareRequirement) and the genesis import logic.

## Scope / phasing (for the plan)

This is a sizable rebuild; the plan will phase it so each phase is independently shippable:

1. **Shell** — 3-item icon rail; layout hosts the drawer slot.
2. **Viz + dashboard layout** — `Donut` + hero line; rebuild the dashboard grid (cards) over existing data.
3. **Drawer system** — intercepting-route scaffold (spike first), then convert each area to a drawer, area by area, reusing its page body + actions.
4. **Spec tab** — genesis-upload UI + map.
5. **Cleanup** — remove the old per-area nav surfacing and the prior TASK-031 13-card grid; verify.

## Testing

- New **pure** logic (donut geometry, any new summarizers) unit-tested with `tsx --test` (pure inputs / pglite), added to the `package.json` test list.
- Shell, drawers, and the spec-upload UI: typecheck + `npm run build`; they reuse already-tested queries/actions, and `importGenesisSpec` / `parseSpecRequirements` are already covered by `src/genesis/import.test.ts`.
- A server action for the upload (wrapping `importGenesisSpec`) gets a focused test if it adds logic beyond delegation.
- Manual: visual walkthrough of the dashboard + each drawer + the Spec tab.

## Requirement linkage

- The **dashboard redesign continues under REQ-028** (Overview dashboard) — same requirement, evolved IA.
- The **new spec-upload UI** is the in-app surface of **REQ-004** (genesis import, currently CLI-only) — analogous to how TASK-028 was the in-app surface of REQ-002 (binding). Confirm during planning whether it ships as REQ-004's UI or warrants a new REQ; surface the choice rather than folding it in silently.

## Out of scope (YAGNI)

- No in-app notifications / bell (anti-goal).
- No customizable / draggable dashboard, no date-range picker (the reference has one; skip unless asked).
- No changes to domain logic, the event taxonomy, or the schema.
- No re-import flow after genesis bootstrap (intentionally blocked).
