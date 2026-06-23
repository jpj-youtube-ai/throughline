# CLAUDE.md sync button (per-repo on Connect) — design

**Date:** 2026-06-23
**Status:** Approved (design); pending implementation plan
**Layer:** Integrity `[2]` — surfaces the existing CLAUDE.md sync (REQ-014) as a per-repo action + adds push.

## Problem

The tool already knows how to write its managed convention block into a bound repo's `CLAUDE.md` (REQ-014): `managedBlockBody()` (the canonical block), `upsertManagedBlock` (idempotent marker-region replace), `commitFileInClone` (commits only when the file changed), the `claude_md.synced` event + `convention_version` bump, and the `sync:claude` CLI. But there is **no in-app way** to run it per repo, and the existing path **commits to the local clone without pushing**. The user wants, under each repository on the Connect page, a button that finds `CLAUDE.md`, inserts/updates the THROUGHLINE block, and **commits + pushes** — saying "already synced" if it's a no-op and creating the file if it's missing.

## Decisions (settled in brainstorming)

1. **Reuse the existing canonical managed block** (`managedBlockBody()` + the existing `<!-- THROUGHLINE:START/END -->` markers) — no change to the block text or markers.
2. **Push to the repo's default branch** (no PR) — the natural fit for a tooling file, matching "commits and pushes."
3. **Per-repo button on Connect**, one per bound project.
4. **Idempotent:** unchanged → "already synced" (no commit/push/event); missing → create.

## Architecture

### 1. Push helper (`src/github/commit.ts`)

- **`pushClone(clonePath, repoFullName, installationId, branch, deps?)`** — push the clone's `branch` to `origin` using a fresh App installation token. Implementation: get a short-lived token (`getInstallationToken`), then `git push` to `https://x-access-token:<token>@github.com/<repoFullName>.git HEAD:<branch>` from `clonePath` (reusing the file's `git()` runner). The token getter + git runner are injectable for tests (mirror `commitFileInClone`'s style). Returns void; throws on failure.

### 2. Orchestrator (`src/integrity/claude-md.ts` — new export `syncClaudeMdForProject`)

- **`syncClaudeMdForProject(db, projectId, deps?): Promise<{ status: "synced" | "already-synced"; sha?: string; conventionVersion?: number }>`**:
  1. Load the project (`localClonePath`, `claudeMdPath`, `repoFullName`, `installationId`, `defaultBranch`, `conventionVersion`). Throw if not found.
  2. Read the current CLAUDE.md from the clone (`fs.readFileSync(clonePath/claudeMdPath)`, `""` if missing).
  3. `next = upsertManagedBlock(current, managedBlockBody())`.
  4. **If `next === current`** → return `{ status: "already-synced" }` (no commit/push/bump/event).
  5. **Else** → `commitFileInClone(clonePath, claudeMdPath, next, "[claude-md] sync conventions")` (writes/creates the file + commits only-if-changed) → `pushClone(clonePath, repoFullName, installationId, defaultBranch)` → in one transaction: bump `convention_version` + `emitEvent(claude_md.synced, projectId)` → return `{ status: "synced", sha, conventionVersion }`.
- Reuses the existing `upsertManagedBlock` + `managedBlockBody`; the version-bump/event logic mirrors the existing `syncClaudeMd` (the two can share a small helper, or `syncClaudeMdForProject` is the clone-reading + push-adding wrapper). The `fs`/`commit`/`push` deps are injectable for tests.

### 3. Connect UI + action

- **`src/app/(app)/connect/actions.ts`** (or inline in the page) — `"use server"` `syncClaudeMd(formData)`: `auth()`-guarded; reads `projectId` from the form; calls `syncClaudeMdForProject(getDb(), projectId)`; `revalidatePath("/connect")`; returns a typed `{ ok: true; status } | { ok: false; error }` (via `useActionState`).
- **Connect page** — under each bound repo (the `listProjects` list from Phase C), render a **`SyncClaudeMdButton`** (`"use client"`, `useActionState`): a "Sync CLAUDE.md" button → pending "Syncing…" → result line: **"✓ synced"** (committed+pushed), **"already synced"** (no-op), or the error.

## Truth-model constraints

- **`claude_md.synced` is emitted in the same transaction** as the `convention_version` bump (existing pattern) — only on an actual sync, not a no-op.
- Commit + push are **external side-effects performed after** the unchanged-check (never inside the event tx). Per-project: targets that project's clone + repo only.
- The action is **`auth()`-guarded**. `tasks.github_status` untouched.

## Components

**New**
- `pushClone` in `src/github/commit.ts`.
- `syncClaudeMdForProject` in `src/integrity/claude-md.ts`.
- `src/app/(app)/connect/actions.ts` (`syncClaudeMd` action) + `src/components/sync-claude-md-button.tsx` (or co-located).

**Modified**
- `src/app/(app)/connect/page.tsx` — render the button per bound repo.

## Testing

- **`syncClaudeMdForProject`** (PGlite + injected fs/commit/push): already-synced (current already contains the up-to-date block → no commit/push/event, status `already-synced`); creates-if-missing (no file → writes the block, commits, pushes, emits, status `synced`); upserts-if-stale (file present without/with an old block → block inserted/updated, committed, pushed, version bumped, event emitted); per-project (targets the given project's clone). Assert the `claude_md.synced` event + bump happen only on a real sync.
- **`pushClone`** (injected token getter + git runner): pushes `HEAD:<branch>` to the token URL; throws on git failure.
- **Connect button/action**: typecheck + build; a runtime click against `orbit` → the block appears on the repo (and a second click → "already synced").
- New test files added to `package.json`.

## Scope / phasing (for the plan)

1. `pushClone` helper (+ test).
2. `syncClaudeMdForProject` orchestrator (+ tests).
3. Connect action + `SyncClaudeMdButton` + wire under each repo; verify (suite + build + runtime).

## Requirement linkage

Surfaces **REQ-014** (CLAUDE.md sync) in-app + adds push. TASK-049.

## Out of scope

- Opening a PR for the CLAUDE.md change (pushes to the default branch directly).
- Changing the managed block text or markers (kept canonical).
- Auto-sync on bind or on a schedule (button-triggered only).
