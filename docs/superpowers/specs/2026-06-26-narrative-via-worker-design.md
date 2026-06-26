# Narrative generation via the worker — design

**Date:** 2026-06-26
**Requirement:** REQ-016 (project narrative / roadmap) — refinement, no new REQ.
**Task:** TASK-073.

## Problem (root cause, from systematic debugging)

The `/narrative` "Generate" button runs `materializeNarrative` **synchronously inside the server action**, which makes **two sequential LLM calls**: `generateNarrative` (Opus, ~12s) + `generateRoadmapHtml` (Sonnet, **~63s** for a 17 KB timeline graphic over 35 requirements). Measured end-to-end: **~75s**. A 75s+ blocking server action behind Tailscale Funnel + the browser hangs/times out — so the button "stopped working" as the project's history and requirement count grew. The logic is sound (both calls succeed when run directly); the architecture is wrong: **slow LLM work doesn't belong on the request path** (CLAUDE.md: keep slow external work off the request path; the worker already owns generation, issue creation, spec materialization).

Two related defects this exposes:
- The action never passes a project: `materializeNarrative` uses `getActiveProjectId(db, null)` (the **oldest** project) and `listActivity(db, undefined, …)` (**all** projects' events). So `/narrative` shows a *cross-project* story attributed to the wrong project.

## Decisions (settled in brainstorming)

- **Move the work to the worker.** The button records a request; the worker does the LLM work off the request path; the page shows the latest result (async — the result appears a tick later).
- **Signal = a new `narrative.requested` event** (event-sourced; no new mutable column; self-clearing).
- **Per-project scoping** — `materializeNarrative(db, projectId)` scopes events/requirements/narrative to one project; `/narrative` shows the **active project's own** story.

## Design

### 1. The request signal — `narrative.requested` (new event type)
Add `"narrative.requested"` to the `EventType` union. The `/narrative` "Generate" server action (`regenerate()`) **stops calling `materializeNarrative`**; instead it emits `narrative.requested` for the **active** project (resolved from the signed-in user) in a `db.transaction`, then `revalidatePath("/narrative")` and returns **instantly**. Not in `RATIONALE_REQUIRED` (a request needs no "why").

### 2. `materializeNarrative` becomes per-project
Signature → `materializeNarrative(db, projectId, generate?, roadmapDeps?)`. Inside:
- `listActivity(db, projectId, 2000)` (scoped to the project) → digest.
- requirements scoped to `projectId` (already is).
- the `narratives` insert + the `narrative.generated` event carry `projectId` (already do).
- drop the internal `getActiveProjectId(db, null)` call — `projectId` is the argument.
- the 0-events guard stays, but per project (a project with no events → nothing to narrate; the worker just skips it rather than throwing — see §3).

### 3. The worker sweep — on-demand only
New helper `materializeNarrativeIfRequested(db, projectId, deps?)`:
- Find the project's latest `narrative.requested` event time and its latest `narratives.createdAt` (or latest `narrative.generated` event time).
- If a request exists and is **newer** than the last materialized narrative → run `materializeNarrative(db, projectId)` and return `{ regenerated: true }`. Else `{ regenerated: false }` (cheap no-op).
- After materialize emits `narrative.generated` + inserts a `narratives` row (newer than the request), the comparison is satisfied → no re-run until the next request. **Self-clearing.**

Wire into `tickForProject` as a **best-effort** step (own try/catch, never aborts the tick), with a `WorkerDeps.materializeNarrative?: (db, projectId) => Promise<{ regenerated: boolean }>` override (default `materializeNarrativeIfRequested`). Place it near the end of the tick (after spec materialize), so the slow LLM work runs after the cheap/outbound sweeps. A pending request makes that project's tick take ~75s — acceptable; the worker is not request-bound, and requests are manual/rare.

### 4. Page UX — `/narrative`
- Show the **active project's** latest stored narrative (scope the page's narrative read to `activeProjectId()` — today it may read the oldest project's).
- Add a **"Regenerating… (queued)"** indicator when the project's latest `narrative.requested` is newer than its latest narrative (the worker hasn't caught up). The "Generate" button posts the request; the indicator appears; on the next tick (~75s) the new narrative lands and a refresh shows it.

### 5. Truth model
`narrative.requested` is emitted in the action's `db.transaction`; `narrative.generated` (+ the `narratives` row) in the materialize `db.transaction` — both state changes carry their event in the same tx. Append-only; no event updated/deleted. No `github_status` write. No LLM output persisted unvalidated (generate already validates the schema → throws on failure → no partial narrative). No `any`. No migration (the signal is an event).

## Data flow

click "Generate" → action emits `narrative.requested` (active project, in-tx) → returns instantly; page shows "Regenerating… (queued)" → next worker tick: `materializeNarrativeIfRequested` sees the request is newer than the last narrative → `materializeNarrative(projectId)` (Opus narrative + Sonnet roadmap, ~75s) → inserts the `narratives` row + emits `narrative.generated` (in-tx) → `/narrative` (refreshed) shows the new story; the "queued" hint clears.

## Testing
- **Unit (TDD):**
  - `materializeNarrative(db, projectId, fakeGen, {fakeRoadmap})` writes a project-scoped `narratives` row + `narrative.generated`; uses only that project's events (seed two projects, assert no cross-project bleed).
  - `materializeNarrativeIfRequested`: regenerates when a `narrative.requested` is newer than the last narrative; no-ops when there's no request or the last narrative is newer; project-scoped (injected fake materialize so no LLM).
  - `regenerate()` action emits `narrative.requested` for the active project and does NOT call materialize (the slow path) — or test the underlying `requestNarrative(db, {projectId, actorId})` helper directly (emits the event in-tx).
  - worker `tickForProject` calls the narrative step per project (stub).
- **Non-unit:** the `/narrative` page "queued" indicator + scoping — typecheck/build/runtime.
- **event-integrity review** (new event type, worker, in-tx).
- **Deploy:** worker + web. **No migration.**

## Edge cases
- Project with no events → `materializeNarrativeIfRequested` runs materialize only if requested; `materializeNarrative` with 0 events should **skip** (return a no-op result) rather than throw, so a request on an empty project doesn't error the tick. (Change the current `throw` to a no-op return when called from the worker.)
- Rapid double-click → two `narrative.requested` events; the worker regenerates once (the request newer than the last narrative; after one materialize, both requests are older than the new narrative). Idempotent enough.
- A request that errors mid-materialize (LLM/API) → best-effort: logged, the tick continues; the request stays "newer than the last narrative" so it retries next tick. (Acceptable; bounded by manual requests. If an unrecoverable input keeps failing it retries each tick — note as a known limitation; rare.)
- The roadmap stays best-effort (null on failure) inside `materializeNarrative` — unchanged.
