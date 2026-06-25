# Close the GitHub issue when a task's PR merges — design

**Date:** 2026-06-25
**Status:** Approved (design); pending implementation plan
**Layer:** Foundation `[1]` — closes the loop on the issue lifecycle (REQ-009).

## Problem

When a PR whose title contains `[TASK-NNN]` merges, the webhook (`src/github/webhook.ts`) already flips the board's `github_status` to `closed`, emits `task.github_status_changed`, and reconciles the requirement — the **mirror**, intended by REQ-009 ("a webhook updates `github_status` on close/reopen/PR-merge").

But that path never touches the **actual GitHub issue**. So the issue stays **open** on GitHub even though the board shows the task done. GitHub would auto-close it if the merged PR body said `Closes #N`, but this tool doesn't author PR bodies, so it can't rely on that.

The user wants: when a task's PR merges, its GitHub issue is actively closed.

## Decision (settled in brainstorming)

Close the issue from a **worker sweep**, gated by a once-per-task bookkeeping marker — *not* inline in the webhook, and not via the `Closes #N` convention. This matches the existing architecture: the webhook is a pure transactional DB mirror, and all **outbound** GitHub actions (issue creation, branch creation) live in the worker as idempotent per-tick sweeps. The sweep self-heals — it retries every tick until the close succeeds.

Two confirmations from brainstorming:
- **Linked to REQ-009** (issue lifecycle & status mirroring), not a new requirement — this is additive.
- The sweep fires on **any** `github_status = 'closed'` (PR-merge *or* a human-closed issue). A human-closed issue → a harmless idempotent no-op close + marker. Not restricted to PR-merge-driven closes.

## Architecture

### 1. Data model — one new column (`src/db/schema.ts`)

- **`tasks.issue_closed_at timestamptz null`** — set to the time we successfully closed the issue via the App.

It is an **outbound-action bookkeeping field**, exactly like the existing `github_issue_number` / `github_issue_url` (which the worker writes in `createIssuesForTasks` with no event). It is **not** `github_status` — so the "webhook is the sole writer of `github_status`" rule is untouched, and **no event** is emitted for setting it (consistent with issue/branch creation, which emit none).

Needs a Drizzle migration, **hand-applied to the live DB** (per the migrations memory — `db:migrate` is fresh-provision only and tests never catch a missing one).

### 2. Outbound App call (`src/github/app.ts`)

- **`closeIssue(installationId, repoFullName, issueNumber): Promise<void>`** — sibling of `openIssue` / `commentOnIssue`:

  ```ts
  octokit.rest.issues.update({ owner, repo, issue_number, state: "closed", state_reason: "completed" })
  ```

  `state_reason: "completed"` because the work shipped. Closing an already-closed issue is a GitHub no-op (returns 200, state stays closed), so the call is idempotent.

### 3. Worker sweep (`src/github/issues.ts`)

- **`closeIssuesForMergedTasks(db, projectId?, closeIssue = realCloseIssue): Promise<{ closed: string[] }>`** — symmetric with `createIssuesForTasks` (same `projectId` resolution: explicit id, else oldest project; resolves `project` row for `installationId` + `repoFullName`).

  Select tasks **scoped to the project** where:

  ```
  github_status = 'closed' AND github_issue_number IS NOT NULL AND issue_closed_at IS NULL
  ```

  For each, in order: `closeIssue(installationId, repoFullName, githubIssueNumber)`, then `update tasks set issue_closed_at = now(), updated_at = now()`. Mark **only on success**, so a failed close leaves `issue_closed_at` null and retries next tick. Returns the closed task keys.

  Runs **outside any DB transaction** (external call — can't be rolled back), like the other sweeps.

### 4. Wire into the worker (`src/worker/index.ts`)

- Add `closeIssues?: (db, projectId) => Promise<{ closed: string[] }>` to `WorkerDeps` (default `(d, pid) => closeIssuesForMergedTasks(d, pid)`).
- New step in `tickForProject`, after branch creation, in its own try/catch with a log line (`[worker][<id>] closed N issue(s): …`), so a failure never aborts the other steps.

## Truth-model constraints

- **Nothing writes `github_status`** here — it remains webhook-only. `issue_closed_at` is a separate bookkeeping column, written only by the sweep (like `github_issue_number`).
- **No new event.** The authoritative state change (issue closed) is captured by the resulting `issues closed` webhook → `task.github_status_changed`. Setting `issue_closed_at` is outbound-action bookkeeping, not a domain fact. Flag this explicitly for the `event-integrity-reviewer`.
- External side-effect performed **outside any transaction**.

## Failure handling

- Per-task, ordered `closeIssue → set issue_closed_at`. If `closeIssue` throws, the marker stays null → next sweep retries the whole task. The only duplicate-effort risk — close succeeds, then the DB update fails — re-closes an already-closed issue next tick (harmless no-op).
- A per-task failure must not block the rest of the batch (continue the loop); the step's try/catch in `tickForProject` keeps a sweep failure from aborting the tick.

## Components

**New**
- `closeIssue` (in `src/github/app.ts`).
- `closeIssuesForMergedTasks` (in `src/github/issues.ts`).
- Drizzle migration adding `tasks.issue_closed_at`.

**Modified**
- `src/db/schema.ts` — add `issueClosedAt` column.
- `src/worker/index.ts` — `WorkerDeps.closeIssues` + new sweep step in `tickForProject`.
- `src/github/issues.test.ts` — cover `closeIssuesForMergedTasks`.
- `src/worker/worker.test.ts` — cover the new step + its failure isolation.
- `package.json` — register any new test file in the `test` script (enumerated, not globbed).

## Testing (TDD)

- **`closeIssuesForMergedTasks`** (pglite, injected fake `closeIssue`):
  - Closes only tasks matching the predicate; calls `closeIssue` with the right issue number; sets `issue_closed_at`; returns the keys.
  - Skips tasks already marked (`issue_closed_at` set), tasks with no issue number, and tasks with `github_status = 'open'`.
  - A per-task `closeIssue` throw leaves that task's `issue_closed_at` null (retryable) and does **not** block the others.
  - **Project-scoped**: a same-numbered closed task in another project is untouched.
- **`tickForProject`** (extend `worker.test.ts`): the new step runs (injected `closeIssues` spy called for the project); an error thrown by `closeIssues` does **not** abort the remaining steps.

## Scope / phasing (for the plan)

1. **Schema + migration** — add `issueClosedAt`; generate the Drizzle migration; apply to the live DB (apply-migration skill).
2. **Primitive** — `closeIssue` in `app.ts`.
3. **Sweep** — `closeIssuesForMergedTasks` in `issues.ts` (+ tests, TDD).
4. **Worker wiring + verify** — wire into `tickForProject` (+ tests); `npm test` / `typecheck` / `build`; runtime check that a merged task's issue closes on the next tick.

## Requirement linkage

**REQ-009** (Issue creation & status mirroring). Closing the issue on merge is part of the issue lifecycle this requirement owns. No new REQ.

## Out of scope (YAGNI)

- Clearing `issue_closed_at` on issue reopen. If a human reopens a closed task's issue and the PR later re-merges, we won't re-close it. Vanishingly rare for a 5-person single repo.
- Any change to the webhook handler, `github_status` semantics, or requirement reconciliation.
- Reopening issues when a task is reopened, or any issue edit beyond closing.
