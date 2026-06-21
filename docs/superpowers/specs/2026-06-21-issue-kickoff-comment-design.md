# Kickoff comment on the issue when the branch is created — design

**Date:** 2026-06-21
**Status:** Approved (design); pending implementation plan
**Layer:** Foundation `[1]` — extends the claim→branch flow (REQ-011) with an issue interaction (REQ-009).

## Problem

When a task is claimed, the app now creates its branch on GitHub (`task-<key>-<slug>`, TASK-040). But the task's GitHub issue says nothing about that branch — so whoever (or whatever, e.g. Claude Code) picks the task up has no in-issue signal of where the work lives or how to start. The user wants the issue to carry a **kickoff prompt** announcing the branch and telling Claude Code to begin.

## Decision (settled in brainstorming)

Post a **kickoff prompt for Claude Code** as an issue comment (not a status note, not an issue-body edit). It announces the ready branch and instructs Claude Code to implement the task on that branch, **referencing the pointers/acceptance already in the issue body** (no duplication) and the repo's CLAUDE.md conventions, opening a `[TASK-NNN]` PR when done.

## Architecture

The comment rides the **existing branch sweep** — no new trigger, no new state.

### 1. GitHub primitive (`src/github/app.ts`)

- **`commentOnIssue(installationId, repoFullName, issueNumber, body): Promise<void>`** — `octokit.rest.issues.createComment({ owner, repo, issue_number, body })`. Sibling of the existing `openIssue`.

### 2. Prompt builder (`src/github/branches.ts`)

- **`kickoffComment(taskKey: string, branchName: string): string`** — a pure function returning the markdown:

  ```
  🤖 Branch `<branchName>` is ready.

  **Prompt for Claude Code:**
  > Work on <taskKey> on branch `<branchName>`, following the pointers and
  > acceptance check in this issue and the repo's CLAUDE.md conventions.
  > Open a PR titled `[<taskKey>] …` when done.
  ```

### 3. Sweep integration (`src/github/branches.ts`)

- `createBranchesForClaimedTasks(db, createBranchFn?, commentOnIssueFn?)` gains a second injectable dependency (`commentOnIssueFn`, default the real `commentOnIssue`). Its select also fetches `githubIssueNumber`. Per task, in order:
  1. `createBranchFn(...)` (existing).
  2. **If `githubIssueNumber` is set**, `commentOnIssueFn(installationId, repoFullName, githubIssueNumber, kickoffComment(key, branchName))`.
  3. Set `branch_created_at = now()`.
- The `branch_created_at` sentinel therefore gates the comment to **exactly once** (the iteration that sets it). If the issue number is absent (rare — the issue is created at generation), the comment is skipped and the branch is still recorded.

### 4. Effects

Both callers of the sweep get the comment for free: the **claim action** (immediate, on claim) and the **worker tick** (retry/back-fill). No wiring beyond the sweep.

## Truth-model constraints

- Posting a comment is an **external side-effect**, performed inside the sweep which already runs **outside any transaction** (never inside a DB tx).
- **No new event** — consistent with issue/branch creation, which emit none.
- **Nothing writes `github_status`** (webhook-only). `branch_created_at` remains the only bookkeeping column, written only by the sweep.

## Failure handling

External + best-effort, ordered `createBranch → comment → set branch_created_at`:
- If `commentOnIssueFn` throws, the loop aborts before setting the sentinel, so `branch_created_at` stays null → the next sweep retries the whole task. `createBranch` is idempotent (GitHub 422 → success); the comment re-posts once (the failed attempt never posted, so **no duplicate**). The only duplicate risk — comment succeeds, then the DB update fails — is rare and acceptable.
- The claim action already wraps the sweep in try/catch, so a comment failure never breaks the claim.

## Components

**New**
- `commentOnIssue` (in `src/github/app.ts`).
- `kickoffComment` (in `src/github/branches.ts`).

**Modified**
- `src/github/branches.ts` — `createBranchesForClaimedTasks` posts the comment (new injectable `commentOnIssueFn`; select adds `githubIssueNumber`).
- `src/github/branches.test.ts` — cover `kickoffComment` + the comment behavior.

## Testing

- **`kickoffComment`** (pure): the returned string contains the task key, the branch name, and the `[<taskKey>]` PR-title convention.
- **`createBranchesForClaimedTasks`** (pglite, injected fake `createBranchFn` + fake `commentOnIssueFn`): for a claimed/unbranched task **with** a `githubIssueNumber`, the comment fn is called once with that issue number and a body containing the key+branch, and `branch_created_at` is set; for a claimed/unbranched task **without** an issue number, the branch is created and `branch_created_at` set but the comment fn is **not** called. Existing sweep assertions (skips already-branched/unclaimed, leaves null on createBranch throw, throws when no project) still hold.

## Scope / phasing (for the plan)

1. **Primitive + builder** — `commentOnIssue` in `app.ts`; `kickoffComment` in `branches.ts` (+ pure-function test).
2. **Sweep + verify** — wire `commentOnIssueFn` into `createBranchesForClaimedTasks` (+ tests); suite + typecheck + build; a runtime claim against `orbit` showing the kickoff comment on the issue.

## Requirement linkage

Extends **REQ-011** (claim/branch operationalization) with a **REQ-009** (GitHub issue) interaction. Confirm during planning whether it ships under REQ-009/011 or warrants a new REQ (surface, don't fold silently).

## Out of scope (YAGNI)

- Editing the issue body (we comment, not edit).
- Commenting on unclaim, or removing the comment.
- Configurable/templated comment text or mentioning the claimer (the chosen content is the kickoff prompt only).
