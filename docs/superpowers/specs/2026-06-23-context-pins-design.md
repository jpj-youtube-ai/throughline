# Per-project context pins for generation

**Date:** 2026-06-23
**Requirement:** REQ-008 (Task generation — refines the *curated slice*)
**Status:** Approved design, ready for implementation plan

## Problem

`buildSlice` (`src/repoSlice.ts`) selects which file *contents* enter the
generation prompt by keyword-matching the idea against each file (`scoreFile`).
Anchors (README, `package.json`, `schema`, `migrations/`) are always included;
everything else competes on keyword overlap with the idea's title + why.

The consequence: the cross-cutting, **idea-independent** modules that every task
must respect — the append-only event log, the `emitEvent` helper, the base
schema, the truth-model enforcement points — only land in the slice when they
happen to share words with the idea. An idea about "voting" never pulls
`src/db/events.ts` into its slice, so the generated tasks never see the
invariant ("event-write shares the state-write's transaction") and silently
violate it. The architecture is present in the repo but absent from *this idea's
slice*.

This is the "generation misses architecture" failure mode, and its mechanism is
slice *selection*, not missing repo data.

## Mechanism

Let an operator pin a small set of always-include paths/globs **per project**.
`buildSlice` already orders candidate files `[...explicit, ...anchors,
...ranked]`, where `explicit` is the `includes` + `relevantPaths` options — so
pinned paths are prioritized ahead of anchors and keyword-ranked files and are
guaranteed into the slice (budget permitting), regardless of the idea's
keywords.

`orchestrate.ts` currently calls `buildSlice({ ..., includes: [],
relevantPaths: [] })`. The entire fix is: persist a pin list on the project and
pass it as `includes`. No new selection logic.

## Design

### 1. Data model

Add one column to the `project` table (`src/db/schema.ts`):

```ts
contextPins: jsonb("context_pins").$type<string[]>().notNull().default([]),
```

It is per-repo project metadata — Board DB territory ("everything else").

A new Drizzle migration adds the column. **It must be applied to the live
Postgres by hand** — `db:migrate` is fresh-provision only and tests never catch
a missing migration.

### 2. Setting pins — `setContextPins`

A server action `setContextPins(projectId, rawPins)`:

1. **Normalize:** trim each entry, drop empties, convert to posix separators,
   dedupe (preserve order).
2. **Validate (advisory only):** for each pin, check whether it matches ≥1 file
   in the clone using the same matcher `buildSlice` uses (`matchesGlob`). Report
   "N of M matched the clone." Unmatched pins are **stored, not rejected** — a
   pin that matches nothing is harmlessly ignored by `buildSlice`'s `explicit`
   filter (which only emits real, eligible paths), and a path may become valid
   as the repo evolves. Validation is feedback, never a gate.
3. **Persist in one transaction:**
   - `update project set context_pins = <normalized>`
   - `emitEvent(tx, { type: "project.context_pins_changed", subjectType:
     "project", subjectId: projectId, actorId: <current user>, payload: { pins,
     count }, projectId })`

   No rationale required — this is configuration tuning, like `claude_md.synced`.

The match-count is returned to the UI for display; it is not persisted.

### 3. UI

Each bound-repo `Card` on `/connect` (`src/app/(app)/connect/page.tsx`) gains a
pins editor:

- a `textarea`, one path/glob per line, seeded from `project.contextPins`;
- a Save button wired to the `setContextPins` action;
- after save, "N of M paths matched the clone" feedback;
- a short hint to keep the list small (pins consume budget first — see
  tradeoff).

Reuses the existing `Card`, `buttonClass`, and design tokens. No new page.

### 4. Reading pins into generation

In `generateForApprovedIdea` and `generateForRequirement`
(`src/generation/orchestrate.ts`), read `proj.contextPins` and pass it through:

```ts
const slice = buildSlice({ ..., includes: proj.contextPins, relevantPaths: [] });
```

`excludeAbs` already excludes the spec and CLAUDE.md, so pins cannot double-count
them.

### 5. Truth model

Add `project.context_pins_changed` to the `EventType` union in
`src/db/events.ts`. It is **not** added to `RATIONALE_REQUIRED`.

SPEC.md §4 (the event taxonomy) is **not** hand-edited — it is a generated
projection, and the code already runs ahead of it (`project.bound`,
`requirement.amended`, `digest.generated` are in the union but not in the table).
The union in `events.ts` is the operative source.

## Testing (TDD)

- **`setContextPins`:** normalization (trim / drop-empty / dedupe / posix);
  emits exactly one `project.context_pins_changed` in the same transaction as
  the column write; returns the correct match count against a fixture clone.
- **Generation threading:** `generateForRequirement` passes `proj.contextPins`
  into `buildSlice` (verified via an injected/spied slice builder or by
  asserting a pinned, keyword-irrelevant path appears in the resulting slice).
- **`buildSlice`:** a case proving an `includes` entry force-includes a file
  that would otherwise lose on keyword score (extend existing slice tests if
  `includes` coverage already exists).

## Tradeoffs and scope

**Known tradeoff (no guard built yet):** pinned files consume the token budget
*first* (they are prioritized), so an over-long pin list crowds out
idea-relevant files. Mitigated by the UI hint to keep the list small; it is the
operator's explicit call. A budget cap / share-limit is deferred until it is a
real problem.

**Deferred (out of scope for this cut):**

- the optional one-paragraph architecture *note* injected into the prompt;
- auto-detection / seeding of default pins on bind;
- any budget cap on pins.

Paths-only, first cut. Prove the mechanism end-to-end before going wider.

## Dogfood

New `TASK-NNN` linked to **REQ-008**. Branch `task-NNN-context-pins`. PR title
and squash message start with `[TASK-NNN]`.
