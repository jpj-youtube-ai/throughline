# Additive branch-spec merge — design

**Date:** 2026-06-26
**Requirement:** REQ-032 (new) — "Additive branch-spec merge." Genuinely new capability, not the one-time genesis import (REQ-004); follows the throughline dev-convention REQ sequence (latest new req was REQ-031 / idea photos).
**Task:** TASK-074. Branch `task-074-branch-spec-merge`, squash `[TASK-074]`.

## Problem / goal

Genesis import (`importGenesisSpec`, REQ-004) is a **one-time bootstrap** — it refuses when the requirements table is non-empty. There is no way to fold *additional* requirements into a board that already has a spec. The operator wants to upload a **branched-off spec** — a Markdown file containing only the *new* requirements branched off the main one — and have the board **add** those requirements and **rematerialise `SPEC.md`**.

This is a **repeatable, additive merge** that runs on an already-populated board: parse → preview → confirm → add the new requirements → the worker rematerialises.

## Decisions (settled in brainstorming)

- **Purely additive.** The uploaded file holds **only the new requirements** (the delta), not a superset. No diffing of changed text, **no amending** of existing requirements.
- **Skip-and-record on title collision.** For each parsed requirement, check whether it already exists on the board (by title). **Add** the genuinely new ones; **do not add** the ones that already exist; **log the skips** so there's an audit trail of what the merge declined to re-add.
- **Preview, then confirm.** Two-phase: parse and show what will be added vs skipped (mutates nothing), then commit on a second click.
- **No wrapper milestone event.** Each requirement in the file produces exactly **one** per-requirement event (declared, or skipped) — there is no single "merge happened" milestone event.
- **Fresh minted keys.** The doc's own `REQ-NNN` numbers are ignored; keys are minted continuing the board's own monotonic per-project sequence, exactly as genesis already does.
- **Provenance `imported`.** These are imported from a spec doc; reuses the existing enum (`imported|voted|drift`) → **no migration**.

## Design

### 1. Matching — "already exists"

A parsed requirement "already exists" iff its **title** matches an existing requirement **in the active project**, compared **trimmed + case-insensitive** (so `Payments` / `payments ` collide). Keys cannot be matched on — they are minted, never carried from the doc, so the doc's `REQ-NNN` is not a reliable identity. Title is the human identity.

### 2. The merge domain function

New module `src/requirements/merge.ts` (or `src/genesis/merge.ts` — sits next to `import.ts`; final placement decided in the plan). It is genesis without the refuse-guard and without the wrapper event:

- Reuse the existing `parseSpecRequirements(specText)` (same `**REQ-NNN — Title.** desc` format and regex).
- If 0 requirements parse → throw the same "no requirements found" error as genesis (caught by the action → typed failure).
- In **one `db.transaction`**, for the given `projectId`:
  - Load the project's existing requirement titles once (normalized) into a set.
  - For each parsed requirement:
    - **If its normalized title is in the set** → emit `requirement.merge_skipped` (see §3); do **not** insert. (Don't add the just-matched title to a "new" set — see edge cases for within-file dupes.)
    - **Else** → mint `nextRequirementKey(tx, projectId)`, insert the row (`status: "planned"`, `provenance: "imported"`, `projectId`), emit `requirement.declared` with payload `{ provenance: "imported", key, origin_idea_id: null, source: "branch-merge", filename }`.
  - Return `{ filename, added: ParsedRequirement-keys[], skipped: { title, existingKey }[] }`.

Signature mirrors genesis: `mergeBranchSpec(db, specText, filename, projectId): Promise<MergeResult>`.

### 3. The skip event — `requirement.merge_skipped` (one new EventType)

Add `"requirement.merge_skipped"` to the `EventType` union in `src/db/events.ts`. Emitted in the merge transaction, append-only:
- `subjectType: "requirement"`, `subjectId` = the **existing** requirement's id (the one matched).
- `payload: { filename, skipped_title, existing_key }`.
- **Not** in `RATIONALE_REQUIRED` (a skip needs no "why").

This is the design's only truth-model addition. A skip is not a state change to a requirement row; this event records an **intent/causal fact** — "a branch merge matched this existing requirement and declined to duplicate it" — which the operator explicitly wants tracked. It references an existing row, exactly as `task.claimed` references an existing task. Goes through `event-integrity-reviewer`.

### 4. Server actions — `src/app/(app)/spec/actions.ts`

Two new actions alongside the existing `importSpec`:

- **`previewBranchSpec(_prev, formData)`** → reads the file/pasted text, resolves the active project (`auth()` re-checked like every action — server actions aren't gated by the layout redirect; same lesson as `importSpec`), parses, and classifies each requirement as **add** or **skip** (running the same title-match against the DB). **Mutates nothing.** Returns a typed preview state: `{ ok: true, filename, toAdd: string[] /* titles */, toSkip: { title, existingKey }[], rawText }` or `{ ok: false, error }`. `rawText` is echoed so confirm re-parses the exact same input.
- **`mergeBranchSpec(_prev, formData)`** → reads the **raw text** (re-parses server-side, never trusts client-sent requirement data), resolves the active project, calls the domain `mergeBranchSpec`, `revalidatePath("/spec")` + `revalidatePath("/dashboard")`, returns `{ ok: true, addedCount, skippedCount, addedKeys }` or `{ ok: false, error }`.

### 5. Surface — `/spec` `SpecUpload`

Today `SpecUpload` shows the genesis form when empty and a static "already imported (N)" note when non-empty. Extend the **non-empty** branch to ALSO render a **"Merge a branch spec"** form (file input or paste), using React 19 `useActionState`, two-phase:
1. First submit → `previewBranchSpec`; render the result: *"3 to add · 2 already on board (will be skipped)"*, the add list, and the skip list (each annotated "already exists"). Keep `rawText` in a hidden field.
2. A **Confirm and add** button → `mergeBranchSpec` with the hidden `rawText`; on success show *"Added 3 requirements (REQ-033…REQ-035) · skipped 2 already on board."*

Empty board → genesis form unchanged. Surface `[3]` work → the ledger design system applies ([[design-system]]); reuse `Card`/`Field`/`fieldClass`/`buttonClass` like the existing form.

### 6. Rematerialise

**No new code.** The worker runs `materializeSpec` **every tick** (TASK-066), so `SPEC.md` regenerates and pushes within a tick of the confirm — same path genesis already relies on (`importSpec` doesn't materialize inline either). The `/spec` board renders from the DB (`buildSpecContent`), so the new requirements appear **immediately**; the committed `SPEC.md` follows seconds later. A manual "rematerialise now" already exists (reconcile panel / `npm run materialize`) for impatience. This honors "then rematerialises" without putting multi-second git work on the request path (GOTCHA 8).

## Data flow

upload/paste branch spec → **Preview** action parses + classifies against the DB (no writes) → form shows "N to add · M to skip" → **Confirm** posts the same raw text → `mergeBranchSpec` (one tx): insert each new req (`requirement.declared`, `imported`, `source: branch-merge`) + emit `requirement.merge_skipped` for each existing one → revalidate → `/spec` shows the new requirements immediately → next worker tick: `materializeSpec` regenerates + pushes `SPEC.md`.

## Truth model

- Every insert carries its `requirement.declared` in the **same tx**; the skip events ride the same tx. Append-only; nothing updated/deleted.
- `requirement.merge_skipped` is a new event type — reviewed for taxonomy fitness (precedent: `project.bound`, `narrative.requested`, `prototype.added/removed` were all added post-spec).
- No `github_status` write. No `any` in domain code. Parse is deterministic and validated (0 reqs → throw, no partial state). No migration (provenance reuses `imported`; the new event is taxonomy-only).

## Testing (TDD)

- **`parseSpecRequirements`** — already covered; add a case asserting the branch-format parses identically (reuse, no change).
- **`mergeBranchSpec` (domain):**
  - Adds the genuinely-new requirements to a **non-empty** board (no refuse-guard), minting keys that **continue** the project's sequence (board has REQ-001..030 → new ones are REQ-031..); each emits `requirement.declared` with `provenance: "imported"` and the `source: "branch-merge"` payload marker — all in one tx.
  - **Skips** a parsed requirement whose title matches an existing one (trimmed + case-insensitive); emits `requirement.merge_skipped` with `subjectId` = the existing req id and the existing key in the payload; **no row inserted** for it.
  - Mixed file (some new, some existing) → correct split; result `{ added, skipped }` is accurate.
  - 0 parsed → throws.
  - **Project-scoped:** seed two projects with the same title; merging into project A skips against A's titles only (no cross-project bleed) and mints in A's sequence.
- **Actions:** `previewBranchSpec` returns the add/skip split and writes **nothing** (assert no new events/rows); `mergeBranchSpec` re-parses the raw text and commits (test the domain function directly for the heavy assertions; a thin action test for auth + the typed shapes).
- **Non-unit:** the `/spec` preview→confirm UI (repo convention: UI not unit-tested) — typecheck / build / runtime in a signed-in browser.
- Register every new `*.test.ts` in the `test` script in `package.json` (enumerated, not globbed).
- **event-integrity review** (new event type, in-tx writes).
- **Deploy:** **web only** — no worker code changes (the worker already materializes every tick), **no migration**. Web restart per the redeploy recipe.

## Edge cases

- **All parsed reqs already exist** → confirm inserts nothing, emits only `requirement.merge_skipped` events; `materializeSpec` is a no-op (no requirement change). Preview shows "0 to add · M already exist."
- **Within-file duplicate titles** (two parsed reqs, same title, neither on the board) → both are added (the "existing titles" set is computed once before the loop, so the second isn't caught). Operator responsibility; documented out-of-scope, consistent with "purely additive."
- **Empty / malformed file** (0 `REQ-NNN` headings) → domain throws "No requirements found…"; the action returns the typed failure; the form shows it.
- **Re-upload of the same file after a successful merge** → on the second run every title now exists → all skipped, nothing double-added. The preview/skip flow makes re-upload safe **without** a hard idempotency key.
- **Preview vs confirm drift** → confirm re-parses the same raw text (deterministic regex), so the committed set matches the preview; the title-match is re-run at confirm against the live DB (correct even if the board changed between preview and confirm).

## Out of scope (YAGNI)

- Amending / updating existing requirements from the branch (the "only the new ones" choice).
- Diffing changed descriptions.
- A wrapper "merge happened" milestone event (per the per-requirement decision).
- A new provenance enum value or any migration.
- An inline/synchronous rematerialise trigger (the worker tick + existing manual button cover it).
