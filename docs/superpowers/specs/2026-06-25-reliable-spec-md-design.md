# Reliable SPEC.md — view from source + robust materialize — design

**Date:** 2026-06-25
**Status:** Approved (design); pending implementation plan
**Layer:** Foundation `[1]` (REQ-012 materialization) + Surface `[3]` (REQ-017 spec view).

## Problem

A user clicked "View SPEC.md" for their active project (`nbcc`) and saw the empty state, even though nbcc has 34 requirements. Systematic debugging found:

- **The view reads the committed file from the clone.** `SpecDocument` → `readSpec(db, pid)` reads `<localClonePath>/SPEC.md`; absent → null → "No SPEC.md yet." nbcc's clone has no SPEC.md.
- **nbcc was never materialized.** The event log shows nbcc has `project.genesis_imported` + `requirement.declared`×34 + `tasks.generated`×5 but **zero `spec.materialized`**. orbit (which has SPEC.md) went through the idea path and has `spec.materialized`×4.
- **Materialize only triggers on some paths.** `materializeSpec` runs in the worker **only `if (didGenerate)`** (idea-path generation), via the manual "Re-materialize SPEC.md" button, or the CLI. It does **not** run after **genesis import** or after **requirement-driven "Generate tasks"** (the `/spec` action). nbcc was built entirely through those uncovered paths.
- **SPEC.md is committed to the local clone but never pushed.** `materializeSpec` → `repoCommit` → `commitFileInClone` commits to the clone via plain git; `pushClone`/`syncCloneToRemote` are used only by CLAUDE.md sync (REQ-014). So: Claude Code working in the actual GitHub repo never sees SPEC.md; the un-pushed `[spec]` commits diverge the clone from origin, so TASK-064's per-tick `pull --ff-only` fails once the client's `main` advances (clone stops refreshing), and the CLAUDE.md-sync `reset --hard` can discard the local SPEC.md commit.

(Immediate remediation already applied operationally: materialized nbcc once — SPEC.md now present. This design is the durable fix.)

## Decision (settled in brainstorming)

Fix both facets. The DB requirements are the real source; SPEC.md is a projection.

- **View renders the projection from the DB** — the board never depends on the committed file.
- **Materialize becomes robust + idempotent** — mirror the proven CLAUDE.md-sync pipeline (reconcile clone to remote → write → commit → **push** → emit, but only when content changed), so SPEC.md lands on GitHub for Claude Code and the clone stops diverging.
- **The worker materializes every tick** (gated by the cheap no-op check), so all population paths (import, requirement-driven, idea) keep SPEC.md current and self-heal.

## Architecture

### Part A — `SpecDocument` renders from the DB (REQ-017)

Extract `buildSpecContent(db, projectId): Promise<string>` — the requirements + linked-tasks queries plus `renderSpec(...)`, lifted out of `materializeSpec` so both share it. `SpecDocument` calls `buildSpecContent` and renders the markdown. The empty state ("No requirements yet") shows only when the project has **zero requirements**. The view is now fully decoupled from the clone/commit pipeline and always shows the current projection — the reported symptom cannot recur.

`readSpec` (clone-file reader) is no longer the view's source; remove it if it has no other consumer (confirm during planning).

### Part B — Robust, idempotent `materializeSpec` (REQ-012)

Refactor the commit path to mirror `syncClaudeMdForProject` (`src/integrity/claude-md.ts`), with the same injectable-deps shape for testability:

1. `content = buildSpecContent(db, projectId)`.
2. **No-op pre-check:** read the clone's current SPEC.md; if `content === current` → return `{ status: "already-materialized" }` — **no fetch, no commit, no push, no event.** (We are the sole writer of SPEC.md, so the file compare is a reliable staleness signal, and this avoids per-tick network in the common case.)
3. Otherwise: `syncCloneToRemote` (fetch + `reset --hard` to remote tip — eliminates divergence and the clobber risk) → `commitFileInClone` (write + commit) → **`pushClone`** (SPEC.md lands on the GitHub default branch) → emit `spec.materialized` in the same tx.

The injectable deps (`syncRemote`, `readFile`, `commit`, `push`) keep it unit-testable without a real clone/network, exactly as the CLAUDE.md sync is tested.

Behavior change: `spec.materialized` now fires **only when the content actually changed** (parity with `claude_md.synced`), not on every call.

### Part C — Worker materializes every tick (REQ-012)

In `tickForProject`, call `materializeSpec(db, proj.id)` **every tick**, dropping the `if (didGenerate)` gate. Because materialize is now a cheap no-op when unchanged, this is a safe, idempotent, self-healing sweep that covers every path that creates requirements/tasks (genesis import, requirement-driven generation, idea generation). Keep it in its own try/catch + log line like the other worker steps. The manual "Re-materialize" button and the CLI still call the same function.

## Truth-model constraints

- **View is read-only** — `buildSpecContent` is reads; no events, no writes. Rendering the projection from the source (DB requirements) is faithful to "SPEC.md is a generated projection, never a source of truth."
- **`spec.materialized` stays in-tx** and now fires only on real change (the event accompanies an actual materialize). No event on the no-op path.
- **Pushing via the App** realizes the model's "commits SPEC.md via the GitHub App."
- `github_status` untouched (webhook-only). Append-only events preserved (materialize only appends `spec.materialized`).

## Error handling

- View (`buildSpecContent`) — ordinary DB read; errors propagate (no stale fallback needed — it IS the source).
- `materializeSpec` — `syncRemote`/`commit`/`push` are external; a failure throws out of `materializeSpec`. The worker step wraps it in try/catch + log (best-effort, like the other steps) so a transient git/network failure never aborts the tick; the next tick retries.
- No-op path never touches the network, so the common case can't fail on git/network.

## Components

**New**
- `buildSpecContent(db, projectId): Promise<string>` (`src/spec/render.ts` or `src/spec/materialize.ts` — shared by view + materialize).

**Modified**
- `src/spec/materialize.ts` — idempotent sync→commit→push via injectable deps; emit only on change; use `buildSpecContent`.
- `src/spec/commit.ts` (`repoCommit`) — extend to the sync+push pipeline (or materialize orchestrates `syncCloneToRemote`/`commitFileInClone`/`pushClone` directly like claude-md does). Decide the seam in planning; reuse `src/github/commit.ts` helpers.
- `src/app/(app)/spec/spec-document.tsx` — render from `buildSpecContent`; empty state only when no requirements.
- `src/worker/index.ts` — materialize every tick (drop `if (didGenerate)`).
- `src/spec/materialize.test.ts` — no-op-when-unchanged (no event), commit+push+event-when-changed (injected deps).
- `src/spec/read.ts` / `read.test.ts` — remove if `readSpec` becomes unused (else leave).
- Register any new `*.test.ts` in `package.json`.

## Testing

- **`buildSpecContent`** (pglite): renders a project's requirements + linked tasks via `renderSpec`; project-scoped (another project's reqs excluded); empty/minimal when no reqs.
- **`materializeSpec` idempotency** (pglite + injected `syncRemote`/`readFile`/`commit`/`push`): when the rendered content equals the current file → returns `already-materialized`, **no commit/push, and no `spec.materialized` event**; when it differs → calls sync, commit, push, and emits exactly one `spec.materialized` in-tx with the sha. (Mirror the `claude-md` test structure.)
- **Project scoping** retained (the existing two-project materialize test).
- **`SpecDocument`** (data path): shows content when reqs exist, empty state only when none — verified via `buildSpecContent`; React rendering verified at runtime.
- **`tickForProject`** (extend `worker.test.ts`): materialize is invoked every tick (injected spy), and a materialize failure does not abort the tick.

## Scope / phasing (for the plan)

1. **`buildSpecContent`** extract (+ test); `materializeSpec` uses it (no behavior change yet).
2. **Idempotent + push materialize** — no-op pre-check, sync→commit→push, emit-on-change (+ tests).
3. **View from DB** — `SpecDocument` → `buildSpecContent`; empty-only-when-no-reqs; drop/retire `readSpec` if unused.
4. **Worker every tick** — drop `if (didGenerate)` (+ worker test).
5. **Verify** — suite + typecheck + build; event-integrity review; runtime: view a never-materialized project's spec, then confirm the worker materializes + pushes it and re-runs are no-ops.

## Requirement linkage

**REQ-012** (spec materialization) for Parts B + C; **REQ-017** (spec map/surface) for Part A. Confirm the task/REQ split during planning (likely one task per REQ; surface, don't fold).

## Out of scope (YAGNI)

- No change to generation's spec-context read — it benefits automatically once the clone SPEC.md is reliably current.
- No change to the CLAUDE.md sync flow (we mirror its pattern, not modify it).
- No further per-tick fetch optimization beyond the content no-op pre-check.
- The one-off nbcc remediation is already done operationally; not part of this change.
