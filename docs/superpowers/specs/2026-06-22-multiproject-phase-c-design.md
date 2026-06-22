# Multi-project — Phase C: multi-bind + switcher + operations + worker

**Date:** 2026-06-22
**Status:** Approved (design); pending implementation plan
**Layer:** Foundation `[1]` — **Phase C of A/B/C** (REQ-029). Phases A (data model) and B (read scoping) are done & merged. This is the final phase — it makes multi-project real end-to-end.

## Context

Phase A scoped the data model; Phase B scoped reads to the signed-in user's active project. But you still cannot **bind a second repo**, there is no **switcher**, and the operation/worker paths still resolve "the one project" (`select().from(project).limit(1)`). Phase C delivers the whole user-facing capability: bind multiple repos, switch the active one per-user, and have generation/issues/branches/spec/digest/worker all operate on the correct project.

## Decisions (settled in brainstorming)

1. **All of Phase C in one phase** — multi-bind + switcher + operation/worker resolution + the carry-in reads.
2. **`bindProject` adds** a project (refusing only a duplicate `repoFullName`); on success it sets the binder's `users.active_project_id` to the new project.
3. A project may start **empty**; genesis import stays optional and per-project (Phase B).
4. **Per-user switcher** in the shell header sets `users.active_project_id`.
5. **Operations resolve the subject's project** (its `projectId` → that project's `installationId`/`localClonePath`/`specPath`); the **worker iterates every project**.

## Architecture

### 1. Multi-bind (`src/project/bind.ts`, `connect.ts`)

- **`bindProject`** — drop the "second bind refused" guard. Instead **refuse a duplicate repo**: if a `project` row with the same `repoFullName` exists, throw a clear error. Insert the new project; emit `project.bound` (already carries `projectId`). Add an optional `actorId` use: after the bind, the caller sets `users.active_project_id = newProject.id` (see the connect action) so the binder lands on it.
- A DB safeguard: add `unique` on `project.repoFullName` (migration) so a duplicate can never be bound even via a race.
- `bindAndClone` is unchanged structurally (clone-first, then `bindProject`); it already clones per-repo.

### 2. Connect page — bind additional repos (`src/app/(app)/connect/*`)

- Show the **list of bound projects** (repo + active marker) and a picker to **bind another** repo from `listConnectableRepos`, **excluding already-bound** repos.
- The connect server action: `bindAndClone(...)` then set the actor's `active_project_id` to the new project; revalidate. Auth-guarded (it already should be — verify).

### 3. Active-project switcher (shell header — `src/app/(app)/layout.tsx` + a new client component)

Replace the header's single-repo `<a href="/connect">` indicator with a **switcher**:
- The layout resolves the signed-in user's projects (`listUserProjects(db)` — all bound projects) and the active one, and renders a `ProjectSwitcher` client component.
- `ProjectSwitcher` (`"use client"`): a button showing the active project + a dropdown of all projects (active marked) and a "**Link a repo…**" entry → `/connect`. Selecting a project submits a server action **`setActiveProject(projectId)`** that sets `users.active_project_id` (auth-guarded — only the caller's row) and `revalidatePath("/", "layout")` (or `/dashboard` + the current views) so the whole board re-renders with the new project (Phase B reads scope it).
- New: `src/app/(app)/active/actions.ts` (`setActiveProject`), `src/components/project-switcher.tsx`.
- New query: `listUserProjects(db): { id, repoFullName }[]` (all projects; "user's projects" = all, since binding is a team action and any user can switch to any bound project — 5-user team).

### 4. Operation/worker project-resolution

Replace each operation's `select().from(project).limit(1)` with **loading the project the work belongs to**:
- **`src/generation/orchestrate.ts`** — `generateForApprovedIdea`/`generateForRequirement` already know the idea/requirement; load **that subject's** project (`projectId` → the `project` row) for `localClonePath`/`specPath`/`claudeMdPath`. (They currently grab the sole project.)
- **`src/github/issues.ts`** (`createIssuesForTasks`), **`src/github/branches.ts`** (`createBranchesForClaimedTasks`) — accept a `projectId` (or iterate per project); use that project's `installationId`/`repoFullName`. The sweeps process tasks **for one project at a time**.
- **`src/spec/materialize.ts`**, **`src/spec/commit.ts`**, **`src/spec/read.ts`** — materialize/commit/read **per project** (each project's `SPEC.md` from its own requirements + clone).
- **`src/digest/send.ts`** / `compose.ts` — per project.
- **`src/integrity/reconcile.ts`**, **`src/integrity/claude-md.ts`** — per project.
- **`src/worker/index.ts`** — the tick **iterates all projects** (`listProjects(db)`); for each project: generate its approved ideas, open its issues, create its branches, materialize its spec, run its digest — each scoped to that project's id/clone.
- **`src/github/webhook.ts`** — already resolves the task's project (Phase A); confirm it loads the right project for any repo lookup (the incoming webhook identifies the repo → map to the matching `project` row by `repoFullName`/`installationId`).

> The CLIs (`cli/drift.ts`, `cli/sync-claude.ts`, `cli/materialize.ts`, etc.) take an optional `--repo`/project selector, defaulting to erroring if multiple projects exist and none is given (surface, don't silently pick one). Confirm exact CLI ergonomics during planning.

### 5. Carry-in reads (the Phase-B deferrals)

- **`src/integrity/reconcile.ts`** `structuralReconciliationForProject`/`reconcileStructural` — take `projectId`; scope the project lookup + the requirement/task counts by it. Wire the dashboard Reconcile card + `/reconcile` panel to pass the active project.
- **`src/quality/queries.ts`** `countRationales(db, projectId)` — scope `events` by `projectId`. Wire the dashboard Why-quality card.

### 6. Truth model

- Each project materializes its **own** `SPEC.md` into its **own** clone/repo; never cross-write. `tasks.github_status` stays webhook-only; the webhook maps the incoming repo to its `project` row. Events stay project-scoped (Phase A). Binding emits `project.bound`; switching active is **per-user UI state** (`users.active_project_id`) — not an event (it's not project history, it's a user preference).

## Components

**New**
- `src/components/project-switcher.tsx` (client), `src/app/(app)/active/actions.ts` (`setActiveProject`).
- `listUserProjects`/`listProjects` query (in `src/project/active.ts` or a `src/project/list.ts`).
- A migration: `unique(project.repoFullName)`.

**Modified**
- `src/project/bind.ts` (add not refuse; duplicate-repo guard), `connect.ts` + the Connect page (bind another + activate), `src/app/(app)/layout.tsx` (switcher).
- Operation files: `generation/orchestrate.ts`, `github/issues.ts`, `github/branches.ts`, `spec/materialize.ts`/`commit.ts`/`read.ts`, `digest/send.ts`, `integrity/reconcile.ts`/`claude-md.ts`, `worker/index.ts`, `github/webhook.ts`.
- Carry-in reads: `integrity/reconcile.ts`, `quality/queries.ts` + their dashboard/panels.

## Testing

- **bindProject:** adds a second project; refuses a duplicate `repoFullName`; the unique constraint blocks a racing duplicate.
- **setActiveProject:** sets the caller's `users.active_project_id` only (auth-guarded); switching changes which project's data the reads return (integration-style with two projects).
- **Operations resolve the subject's project:** `generateForRequirement` for a requirement in project B loads project B's clone (injected project-load); `createIssuesForTasks(db, projectB)` opens issues on B's repo (injected `openIssue`); branches likewise; materialize writes B's SPEC.md.
- **Worker iterates projects:** with two projects each having an approved idea, the tick generates for both (injected generator).
- **Carry-in reads:** reconcile/countRationales return only the target project's data (two-project).
- **Switcher** renders the user's projects + the active marker (component/build).
- Full suite green; a real runtime walkthrough: bind a second repo, switch to it, see its (empty/own) board, switch back to orbit.

## Scope / phasing (for the plan)

1. **Multi-bind core** — `bindProject` add + duplicate guard + `unique(repoFullName)` migration; `listProjects`/`listUserProjects`; tests.
2. **Switcher + connect** — `setActiveProject` action; `ProjectSwitcher`; layout wiring; Connect page binds-another + activates.
3. **Operation resolution** — generation/issues/branches/spec/digest/reconcile/claude-md load the subject's project; carry-in reads scoped + dashboard wired.
4. **Worker** — iterate projects in the tick.
5. **Verify** — suite + build + a real two-repo runtime walkthrough.

## Requirement linkage

Completes **REQ-029** (multi-project). TASK-047.

## Out of scope

- Per-project access control / permissions (any of the 5 users can switch to any bound project).
- Unbinding/archiving a project; cross-project aggregate views.
- Renaming the migration tooling (the `db:migrate` foot-gun is tracked separately). Note: Phase C adds one migration (`unique(project.repoFullName)`) that must be applied to the live DB by hand, as in Phase A.
