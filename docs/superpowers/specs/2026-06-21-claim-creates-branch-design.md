# Claim creates the GitHub branch — design

**Date:** 2026-06-21
**Status:** Approved (design); pending implementation plan
**Layer:** Foundation `[1]` — extends the claim flow (REQ-010) to operationalize the branch convention (REQ-011).

## Problem

When a user claims a task, `claimTask` (REQ-010) already **computes and stores the branch name** (`task-<key>-<slug>`, the REQ-011 convention) and emits `task.claimed` with that branch in its payload — but it **never creates the actual git branch on GitHub**. So a claimer (or Claude Code, which keys off the branch) has a *name* but no branch to check out. The user wants claiming a task to also create the branch, so work can start immediately.

The GitHub App already has the access needed: it commits `SPEC.md` (`contents: write`) and opens issues, so it can create a ref. `github/app.ts` simply has no create-branch function yet.

## Decisions (settled in brainstorming)

1. **Best-effort + warning.** The claim **always succeeds** (it is the recorded intent in the log, independent of GitHub). The branch is created right after; if GitHub errors, the user keeps the claim and sees a small "branch not created — it'll retry" notice. This mirrors how issue-creation is treated.
2. **Base = the project's `default_branch` HEAD.**
3. **Idempotent.** Creating an already-existing branch is a success, not an error.
4. **Unclaim leaves the GitHub branch** (deleting could discard work) and resets the local tracking flag.
5. **Worker auto-retry sweep** — a failed creation self-heals on the next worker tick, exactly like the issue-creation sweep. (Bonus: this also back-fills branches for anything claimed before this feature shipped.)
6. **Tracking via one nullable timestamp** `tasks.branchCreatedAt` — the sentinel for "branch exists on GitHub," analogous to `githubIssueNumber IS NULL` meaning "no issue yet."

## Architecture

### 1. Branch creation primitive (`src/github/app.ts`)

- **`createBranch(installationId, repoFullName, branchName, baseBranch): Promise<{ created: boolean }>`** — read the base branch's HEAD sha (`git.getRef heads/<baseBranch>`), then `git.createRef refs/heads/<branchName>` at that sha. **Idempotent:** a 422 "Reference already exists" resolves to `{ created: false }` (success), a fresh create to `{ created: true }`. Any other error throws (so the caller can mark it not-created and retry).

### 2. Sweep + per-task creation (`src/github/branches.ts`, new — mirrors `issues.ts`)

- **`createBranchesForClaimedTasks(db, createBranch?): Promise<{ created: string[] }>`** — load the bound `project`; select `claimed` tasks where `branchCreatedAt IS NULL` and `branchName IS NOT NULL`; for each, call `createBranch(installationId, repoFullName, branchName, defaultBranch)` and, on a non-throwing result, set `branchCreatedAt = now()`. **Idempotent, runs outside any transaction** (external call — never inside a DB tx, same rule as `createIssuesForTasks`). `createBranch` is injectable for tests. Returns the task keys whose branch was ensured this run.

### 3. Schema (`src/db/schema.ts` + a Drizzle migration)

- Add **`branchCreatedAt: timestamp("branch_created_at", { withTimezone: true })`** (nullable) to `tasks`. Generate the migration (`drizzle-kit generate`) and apply it.
- **Unclaim** (`unclaimTask`) already nulls `branchName`; also set `branchCreatedAt: null` in the same update (the GitHub branch itself is **not** deleted; a later reclaim re-runs `createBranch`, which is idempotent if the branch still exists).

### 4. Claim flow + UX

- **`claim` server action** (`src/app/(app)/tasks/actions.ts`): keep the `auth()` guard; after `claimTask` returns `{ claimed: true }`, call `createBranchesForClaimedTasks(getDb())` **best-effort in a try/catch** (a GitHub failure must not throw — the claim already holds); `revalidatePath("/tasks")` + `"/dashboard"`. Change the action to **return a status** so the UI can warn: `ClaimState = { ok: true; branchCreated: boolean } | { ok: false; error: string } | null`. **`branchCreated` is determined by re-reading the just-claimed task's `branchCreatedAt` after the sweep** (non-null → the branch exists on GitHub) — not by inspecting the sweep's returned key list, so the status reflects *this* task regardless of what else the sweep touched. If `claimTask` returns `{ claimed: false }` (someone else won the race), skip the branch step and just `revalidate` — the re-rendered panel shows the real owner; no branch warning is shown (the "branch not created" notice appears only when the user holds the claim and `branchCreatedAt` is still null).
- **`ClaimButton`** (`"use client"`, `useActionState`) replaces the inline `<form action={claim}>` for the claim case: a "Claim" button → pending "Claiming…" → on success either "claimed" or "claimed · branch not created — it'll retry". Unclaim stays a plain form action (no status surface needed).

### 5. Worker (`src/worker/index.ts`)

- Add a `createBranchesForClaimedTasks(db)` call to the tick (next to `createIssuesForTasks(db)`), wrapped like the others — the auto-retry path for any claimed task still missing its branch.

## Truth-model constraints

- **Branch creation is an external side-effect, performed AFTER the claim transaction** — never inside it (external calls can't be rolled back; same rule as issue creation).
- **No new event.** The existing `task.claimed` already records the branch name; issue-creation likewise emits no event. Branch existence is GitHub's to own.
- **`branchCreatedAt` is local bookkeeping** (like `githubIssueNumber`), written by the branch-creation code. It is **not** `github_status`, which remains webhook-only.
- The claim action stays **`auth()`-guarded**.

## Components

**New**
- `createBranch` (in `src/github/app.ts`).
- `src/github/branches.ts` — `createBranchesForClaimedTasks` (+ tests).
- `src/app/(app)/tasks/claim-button.tsx` — `ClaimButton` client component.

**Modified**
- `src/db/schema.ts` — `tasks.branchCreatedAt` (+ generated migration).
- `src/tasks/claim.ts` — `unclaimTask` resets `branchCreatedAt` (+ test update).
- `src/app/(app)/tasks/actions.ts` — `claim` returns `ClaimState` + best-effort branch creation.
- `src/app/(app)/tasks/tasks-panel.tsx` — use `ClaimButton` for the claim case.
- `src/worker/index.ts` — add the sweep to the tick.

## Testing

- **`createBranchesForClaimedTasks`** (pglite, injected fake `createBranch`): creates for `claimed` + `branchCreatedAt IS NULL` tasks and sets the timestamp; skips already-branched (`branchCreatedAt` set) and unclaimed tasks; a `createBranch` that throws leaves `branchCreatedAt` null (so the next sweep retries); no project bound → clear error. Returns the right keys.
- **`createBranch`** idempotency: an injected octokit-like whose `createRef` throws a 422 → `{ created: false }`; a clean create → `{ created: true }`; another error propagates.
- **`unclaimTask`** resets `branchCreatedAt` to null (extend `claim.test.ts`).
- Add the new `*.test.ts` files to the `package.json` test list.
- `ClaimButton` / `claim` action / worker wiring: typecheck + build; a runtime walkthrough — claim a task, confirm the branch appears on `orbit`; unclaim, confirm the branch remains; re-claim, confirm no error.

## Scope / phasing (for the plan)

1. **Schema** — add `branchCreatedAt` + migration; `unclaimTask` reset (+ test).
2. **GitHub primitives** — `createBranch` (idempotent) + `createBranchesForClaimedTasks` (+ tests).
3. **Claim flow + UX** — `claim` returns `ClaimState` + best-effort creation; `ClaimButton`; wire into `tasks-panel`.
4. **Worker + verify** — add the sweep to the tick; suite + typecheck + build + a runtime claim/unclaim/reclaim walkthrough against `orbit`.

## Requirement linkage

Extends **REQ-010** (claim) and operationalizes **REQ-011** (branch convention / commit linkage). Confirm during planning whether it ships under REQ-010/011 or warrants a new REQ (surface, don't fold silently).

## Out of scope (YAGNI)

- Deleting the GitHub branch on unclaim (left in place to preserve work).
- Opening the PR or any commit automation on claim (branch only).
- A manual "retry branch" button (the worker sweep + reclaim already cover retry).
- Surfacing branch state anywhere other than the claim button's transient notice.
