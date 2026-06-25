# Per-repo design prototypes on /connect — design

**Date:** 2026-06-25
**Requirement:** REQ-030 (Design prototype context) — refinement, no new REQ.
**Task:** TASK-069.

## Problem

The design-prototype library (TASK-068, REQ-030) is stored per project (`prototypes.project_id`), but its management UI on `/connect` is bound to the user's *active* project only: `DesignPrototypes` resolves its project via `activeProjectId()` and renders a single library. The same page renders **context pins per bound repo** (the "Bound repos" list loops over every project, each with its own pins editor scoped to that repo's `projectId`). So a user with several repos connected sees one prototype library under an otherwise per-repo list — it reads as "only one screen," and there is no way to manage another repo's prototypes without switching the global active project.

Root cause: the prototype UI/action take the project *implicitly* from the active project, where the pins UI/action take it *explicitly* from the rendered repo (`savePins` reads `projectId` from a hidden form field).

## Goal

Make prototype management on `/connect` **per bound repo**, consistent with context pins. Each connected repo gets its own upload form + thumbnail list, scoped to that repo. The active-project concept stops mattering for prototype management on this page.

Out of scope (already correct, unchanged): the data model (already `project_id`-scoped), the `prototype.added`/`prototype.removed` events, the worker render sweep, and generation/issues (both already load the *generated* project's own prototypes via `loadProjectPrototypes(proj.id)`).

## Design

Chosen layout: keep the existing "Design prototypes" section, but render a **per-repo sub-block** inside it (repo name header + that repo's upload + list), looping over the already-fetched bound projects. Keeps the bound-repo cards lean and groups all prototype management in one place.

### Changes

1. **`DesignPrototypes` (`connect/prototypes.tsx`)** — takes props `{ projectId: string; repoFullName: string }` instead of calling `activeProjectId()`. Renders a repo-name header, the upload form, and the list — all scoped to `projectId` via the existing `listProjectPrototypes(db, projectId)`.

2. **The "Design prototypes" section (`connect/page.tsx`)** — replaces the single `<DesignPrototypes />` with a `<section>` that maps over `boundProjects`, rendering `<DesignPrototypes projectId={p.id} repoFullName={p.repoFullName} />` for each. A repo with no prototypes shows the existing "No prototypes yet" empty state inside its own block. When no repos are bound, the section renders nothing (there is nothing to attach prototypes to).

3. **`addPrototypeAction` (`connect/actions.ts`)** — reads `projectId` from the form (`String(formData.get("projectId"))`), like `savePins`, instead of `await activeProjectId()`. Everything else (auth gate, file/label validation, `addPrototype`, `revalidatePath("/connect")`) is unchanged.

4. **`PrototypeUploadForm` (`connect/prototype-upload-form.tsx`)** — takes a `projectId: string` prop and renders a hidden `<input name="projectId" value={projectId}>` so the action receives the explicit project.

5. **`removePrototypeAction`** — unchanged. It is already keyed by the prototype's `id` and derives `projectId` from the row; the remove `<form>` already carries the hidden `id`.

### Data flow

`connect/page.tsx` already fetches `boundProjects` (via `listProjectsWithPins`). The Design-prototypes section maps over them → one `DesignPrototypes` per repo → each upload posts `{projectId, label, file}` → `addPrototype(db, {projectId, ...})` (event in-tx) → worker renders the PNG next tick (unchanged) → the row appears in that repo's list.

### Truth model

Unchanged. `addPrototype`/`removePrototype` still emit `prototype.added`/`prototype.removed` in the same transaction as the row write. The only difference is that `addPrototypeAction` now sources `projectId` explicitly from the form rather than from the active project — the emitted event's `projectId` is the same value either way (it's the project being uploaded to). No new events, no schema change, no `github_status` touch.

## Testing

Store-level per-project scoping is already covered by `store.test.ts` (`addPrototype`/`listProjectPrototypes` are tested across two projects with no cross-project leakage). This change is component-prop + action-param + page-loop wiring — React components and auth-gated server actions are not unit-tested in this repo (the same as the original TASK-068 UI task and the other `/connect` actions). Verification:

- `npm run typecheck` clean, `npm run build` clean.
- Runtime walkthrough on the deploy: with ≥2 repos bound, the "Design prototypes" section shows a block per repo; uploading under repo A adds to A's list only (B's stays unchanged); each thumbnail renders within a tick; removing is scoped to its own repo.

## Edge cases

- **No bound repos:** the section renders nothing (consistent with there being nothing to manage).
- **Repo with no prototypes:** its block shows the existing "No prototypes yet" empty state.
- **Many repos:** many blocks, each independent (acceptable; matches the per-repo pins list).
