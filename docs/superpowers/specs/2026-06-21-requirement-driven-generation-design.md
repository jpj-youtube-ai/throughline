# Requirement-driven task generation — design

**Date:** 2026-06-21
**Status:** Approved (design); pending implementation plan
**Layer:** Foundation `[1]` — extends generation (REQ-008) from idea-driven to requirement-driven.

## Problem

In Throughline, **tasks are only ever produced by the generation step, and generation is wired exclusively to the idea→vote→approve flow**: the worker polls `ideas` in state `approved`; `generateForApprovedIdea(db, ideaId)` requires an idea; `persistGeneration` throws unless there is an approved idea behind it. **Genesis-imported requirements have no idea behind them, so nothing ever generates tasks for them** — they sit as `planned` forever. A user imported 35 requirements (the bound `orbit` repo's spec) and reasonably expects to turn those approved requirements into tasks. There is currently no path to do that.

The deployment is otherwise generation-ready: repo `jpj-youtube-ai/orbit` is bound, the GitHub App is installed, the local clone exists, and the Anthropic key is set.

## Decisions (settled in brainstorming)

1. **Trigger:** per-requirement, **on demand** — a "Generate tasks" button (not bulk, not auto-on-import).
2. **Surface:** a **slide-over drawer** opened by clicking a spec-map cell, reusing the app's `DrawerShell` via an intercepting `/spec/[key]` route (consistent with the dashboard drawers).
3. **Synchronous:** the button runs generation inline (~10–30s, "Generating…" pending state); **no worker dependency**.
4. **Tasks-only:** a per-requirement generate produces **only tasks**, all linked to that requirement — **no auto sub-requirements** (keeps it predictable; the requirement is the unit).
5. **Auto-open GitHub issues** for the new tasks on `orbit`.

## Architecture

### 1. Requirement-driven generation (engine)

- **`generateForRequirement(db, reqId, opts?)`** (new; sibling of `generateForApprovedIdea` in `src/generation/orchestrate.ts`):
  - Loads the requirement (fail if missing); requires a bound `project` (fail with a clear message otherwise).
  - **Seeds the generator from the requirement** — `title = req.title`, the "why"/seed = `req.description` — and assembles the same context as today: the bound clone's `SPEC.md`, the `CLAUDE.md` conventions, the requirements list, and a curated `buildSlice` of the clone (`ideaTitle`/`ideaWhy` ← the requirement's title/description).
  - Instructs the generator (via the existing prompt path) to produce **tasks implementing this requirement**, referencing its existing key; `new_requirements` is expected empty.
  - Runs the existing `generateTasks`. **For testability**, accept an optional injected generator (`opts.generate`, default the real `generateTasks`) so the orchestration + guards can be unit-tested without the LLM (mirrors how `detectUnmappedCode` accepts an injectable client).
  - On generation failure → `{ ok: false, failure }` (persist nothing — no partial tasks). On success → `persistGenerationForRequirement`.

- **`persistGenerationForRequirement(db, { reqId, output, model, usage, actorId? })`** (new; in `src/generation/persist.ts` or a sibling):
  - One transaction: lock the requirement; **refuse if it already has tasks** (idempotence guard — return/throw a clear "already has tasks"). **Insert each output task linked to `reqId`** — *force* the link (ignore the output's `requirement_key` and any `new_requirements`; the requirement is the unit), minting `TASK-NNN`, rendering the structured body. Emit **one `tasks.generated`** with `subjectType: "requirement"`, `subjectId: reqId`, payload `{ task_keys, model, tokens }`. Advance the requirement `planned → building` via `reconcileRequirementStatus` (same tx). No `ideas` row is read or written.
  - **DRY:** extract the shared helpers (`pad3`, `maxNumber`, `renderBody`) used by both `persistGeneration` and this into a small shared module, so the two persist paths don't duplicate them.

### 2. Detail drawer + Generate button (UX)

- **Spec cells become links:** `spec-grid.tsx` wraps each cell in `<Link href={`/spec/${r.key}`}>` (the instant hover card stays for a quick peek).
- **`src/app/(app)/spec/[key]/page.tsx`** — full-page fallback: renders a `RequirementDetail` panel for `key` (a clear "unknown requirement" state if the key doesn't exist).
- **`src/app/(app)/@drawer/(.)spec/[key]/page.tsx`** — the intercepted drawer: `<DrawerShell title={key}><RequirementDetail reqKey={key} /></DrawerShell>` (opens over `/spec`; hard-visit/refresh of `/spec/REQ-005` renders the full page).
  - **Routing risk to verify early (spike, like Phase 2a):** every existing interceptor is a *top-level* route (`(.)ideas`); `/spec/[key]` is *nested + dynamic*. Confirm `@drawer/(.)spec/[key]` actually intercepts a soft-nav from `/spec` into the drawer (and that `/spec` itself is unaffected — no `(.)spec` interceptor exists, only `(.)spec/[key]`). If the nested interception can't be made to work, **fall back** to a client-side drawer on `/spec` driven by a `?req=REQ-005` query param (cell links set the param; `/spec` reads it and renders `RequirementDetail` in a client `DrawerShell` variant) — same user-visible behavior.
- **`RequirementDetail`** (async server component, self-fetching by key): shows the requirement's key / title / description / status / provenance and **its tasks** (key, mirrored status, GitHub-issue link). When it has **no tasks**, it renders the **`SpecGenerate` client component** (the "Generate tasks" button); once it has tasks, it lists them instead.
- **`SpecGenerate`** (`"use client"`, `useActionState`): the Generate button + pending ("Generating…") + success/error message, bound to the generate server action.
- **`src/app/(app)/spec/[key]/actions.ts`** — `"use server"` `generateTasksForRequirement(prev, formData)`:
  - **`auth()` guard** (server actions aren't gated by the layout redirect) → return `{ ok: false, error: "Not signed in." }`.
  - Resolve the requirement by key; guard "already has tasks".
  - `generateForRequirement(db, reqId)`; on failure → `{ ok: false, error }`.
  - On success: **`createIssuesForTasks(db)`** (opens GitHub issues for the new tasks); `revalidatePath("/spec")`, `revalidatePath("/dashboard")`, `revalidatePath(`/spec/${key}`)`; return `{ ok: true, taskKeys }`.

### 3. Effects

Click cell → drawer (`RequirementDetail`). Click **Generate** → server action → generate + persist (tasks linked to the req; req → `building`) → open issues on `orbit` → revalidate → the drawer re-renders showing the tasks; the cell turns **amber ("in progress")**; the tasks appear on the dashboard Tasks card / Tasks drawer; issues appear on the repo.

## Truth-model constraints

- **LLM only on the explicit click, never on load** — `RequirementDetail` renders by reading only (requirement + its tasks); `generateForRequirement` runs solely from the action.
- **`tasks.generated` is emitted in the same transaction** as the task inserts (via `persistGenerationForRequirement`). **No partial tasks** on failure (persist only on a complete, validated result).
- **`tasks.github_status` stays webhook-only** — issue creation sets `issue_number`/`url`, not `github_status`.
- **The generate server action is `auth()`-guarded.**

## Components

**New**
- `generateForRequirement` (in `src/generation/orchestrate.ts`).
- `persistGenerationForRequirement` (in `src/generation/persist.ts`) + a shared persist-helpers module (`pad3`/`maxNumber`/`renderBody`).
- `src/app/(app)/spec/[key]/page.tsx`, `src/app/(app)/spec/[key]/actions.ts`, the `RequirementDetail` panel, `SpecGenerate` client component, `src/app/(app)/@drawer/(.)spec/[key]/page.tsx`.

**Modified**
- `src/app/(app)/spec/spec-grid.tsx` — cells become `<Link>` to `/spec/[key]`.
- `src/generation/persist.ts` — extract shared helpers (no behavior change to `persistGeneration`).

## Testing

- **Unit-test `persistGenerationForRequirement`** against PGlite with a synthetic `GenerationOutput`: every task linked to the target `reqId`; one `tasks.generated` (subject = requirement) emitted in-tx; requirement advanced `planned → building`; the "already has tasks" guard refuses a second run; no `ideas` write. (Mirrors `persist.test.ts`.)
- **Unit-test `generateForRequirement`'s orchestration/guards** with an **injected generator** (`opts.generate`): no-project guard, missing-requirement guard, already-has-tasks guard, and the happy path (injected output → persisted tasks) — without calling the real LLM. (The LLM call itself is covered by `generateTasks`'s existing tests.)
- Add the new `*.test.ts` files to the `package.json` test list.
- `RequirementDetail` / `[key]` page / drawer / `SpecGenerate`: typecheck + build; runtime walkthrough including **one real generation** against an `orbit` requirement.

## Scope / phasing (for the plan)

1. **Engine** — shared helpers extraction; `persistGenerationForRequirement` (+ tests); `generateForRequirement` with injectable generator (+ guard tests).
2. **Detail surface** — `/spec/[key]` page + `RequirementDetail` panel + intercepting drawer; cells → `<Link>`.
3. **Generate action + button** — `generateTasksForRequirement` (auth-guarded, sync, opens issues) + `SpecGenerate`, wired into `RequirementDetail`.
4. **Verify** — suite + typecheck + build + a real generation run against one orbit requirement (tasks created, req → building, issue opened).

## Requirement linkage

Extends **REQ-008** (task generation) from idea-driven to requirement-driven. Confirm during planning whether it ships under REQ-008 or warrants a new REQ (surface, don't fold silently).

## Out of scope (YAGNI)

- Bulk / auto-on-import generation (per-requirement only).
- Re-generating when a requirement already has tasks (guarded off; revisit later).
- Minting new sub-requirements from a requirement generate.
- An async/worker path (synchronous only).
