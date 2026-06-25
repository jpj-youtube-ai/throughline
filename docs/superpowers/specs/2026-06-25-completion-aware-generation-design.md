# Completion-aware task generation — design

**Date:** 2026-06-25
**Status:** Approved (design); pending implementation plan
**Layer:** Foundation `[1]` — improves the generation core (REQ-008).

## Problem

Task generation produces tasks for work that has **already been done**. Observed in the live deployment (a duplicate task was generated for already-finished work).

Root cause — the generator has **no completion-awareness**:

- The context fed to the model (`buildUserMessage`, `src/prompt.ts:54-76`) is only: CLAUDE.md, the spec + requirement **keys/titles** (not even their status — `reqContextFromDb`, `orchestrate.ts:22-36`), the approved idea, and a curated repo file-slice. There is **no `git log`** and **no list of existing `TASK-NNN`s or their status**.
- The one source that could show "this already exists" is the repo slice, but the local clone is **never refreshed before generation**. `ensureClone` (fetch + ff-pull, `src/github/clone.ts:34-49`) is called in exactly one place — the `/connect` bind flow (`src/project/connect.ts:64`). The worker tick and `generateForApprovedIdea`/`generateForRequirement` (`orchestrate.ts`) read directly off `proj.localClonePath` with **no pull**, so the slice/spec/CLAUDE.md the model sees go stale with every merge.

So generation can re-propose completed work because nothing in its context reliably tells it what is already built — and the code that could is stale.

## Decision (settled in brainstorming)

Three additive changes — **no new tables, no events; pure read + context enrichment.** Linked to **REQ-008**.

1. **Best-effort clone refresh before generation** (settled: best-effort, not hard-fail).
2. **Feed two completion signals**: the existing tasks + status (board DB) **and** a recent git log (settled: both).
3. **A system-prompt rule** telling the model not to duplicate already-done/in-flight work. **Prompt-signal only** — no hard semantic validator that rejects a duplicate task (settled: prompt-only first; a rejecting validator is a deferred bigger hammer).

## Architecture

### 1. Refresh the clone before generating (`src/worker/index.ts`)

A new best-effort step in `tickForProject`, **before** the approved-idea loop: mint a short-lived token (`getInstallationToken(proj.installationId)`, `src/github/app.ts`) and call the existing `ensureClone({ repoFullName, dir: proj.localClonePath, token, defaultBranch: proj.defaultBranch })`. Wrapped in its own try/catch + log line, like the other steps — **a pull failure does not abort generation**; we proceed on the existing (possibly stale) clone. Injectable as `WorkerDeps.refreshClone` for tests.

- **Why the worker:** matches where the other external git/GitHub ops already live (createIssues/createBranches/closeIssues); refreshes **once per project per tick**, shared by all that project's ideas.
- The **requirement-driven** path (`generateForRequirementKey`, the web `/spec` action) gets the same refresh at its call site so it isn't left stale.

### 2. Two completion blocks in the prompt (`src/prompt.ts`, `src/generation/context.ts`)

A new `## ALREADY IN THIS PROJECT` section in `buildUserMessage`, between the spec and the idea:

- **Existing tasks** — `projectTaskSummary(db, projectId)`: newest-first, one compact line per task:
  `TASK-NNN [open|claimed|closed] — <title> → REQ-NNN`
  Status label precedence: **`closed`** if `github_status='closed'` (done is done), else **`claimed`** if `claim_state='claimed'` (in flight), else **`open`**. Authoritative board view; covers completed **and** in-flight work. Capped at the **200 newest** tasks (by `created_at`) to bound size.
- **Recent commits** — `recentGitLog(clonePath, { limit: 80 })`: the default branch's recent `[TASK-NNN] …` subjects — ground truth of what landed on `main`.

Both feed through `UserMessageParts`. When both are empty (greenfield), the section renders a short "(nothing built yet)" note rather than empty headers.

### 3. Token budget (`src/generation/orchestrate.ts`)

Both blocks are added to the `fixed` token estimate so `buildSlice`'s `budgetTokens = MAX_CONTEXT_TOKENS - fixed` shrinks to fit — no overflow against the 40k cap. The repo slice yields budget to the (now more valuable) explicit completion signals. Bounds (200 tasks / 80 commits) keep the blocks small (~2-3k tokens typical).

### 4. System prompt (`src/prompt.ts`)

Add a rule to `SYSTEM_PROMPT`: the tasks and commits listed under "ALREADY IN THIS PROJECT" are already created or completed — do **not** emit tasks that re-implement them; reuse and reference them in pointers instead. Sharpens the existing "reuse prerequisites if present in the slice" rule with concrete completion data.

## Components

**New**
- `recentGitLog(repoPath: string, opts?: { limit?: number }): Promise<string[]>` — `src/github/clone.ts`. Runs `git -C <repoPath> log --no-merges --format=%s -n <limit>` (default 80) on the checked-out default branch; returns subjects newest-first. Best-effort: returns `[]` on any error (non-repo, git failure) — never throws.
- `projectTaskSummary(db, projectId, opts?: { limit?: number }): Promise<string[]>` — `src/generation/context.ts`. Selects the project's tasks (newest-first, limit default 200) joined to their requirement key; returns formatted lines.

**Modified**
- `src/prompt.ts` — `UserMessageParts` gains `taskSummary: string[]` + `recentCommits: string[]`; new `## ALREADY IN THIS PROJECT` section in `buildUserMessage`; new `SYSTEM_PROMPT` rule.
- `src/generation/orchestrate.ts` — both `generateForApprovedIdea` and `generateForRequirement` assemble the two blocks, fold their token estimates into `fixed`, and pass them to `buildUserMessage`.
- `src/worker/index.ts` — `refreshClone` step in `tickForProject` + `WorkerDeps.refreshClone`.
- The web `/spec` generation action — refresh the clone before `generateForRequirementKey` (same best-effort helper).

## Truth-model constraints

- **Read-only / context-only.** No events, no state writes. Reading the tasks table and the git log are reads; the clone refresh is an external git op (like the existing bind-time `ensureClone`), emits nothing.
- `github_status` is only **read** (to label tasks); still webhook-only for writes.
- No new requirement; this is REQ-008 (the generation core).

## Error handling

- **Clone refresh** — best-effort: try/catch + log; generation proceeds on the existing clone.
- **`recentGitLog`** — best-effort: `[]` on error.
- **`projectTaskSummary`** — ordinary DB read (errors propagate as today).

## Testing (TDD)

- **`recentGitLog`**: in a temp git repo with a few `[TASK-NNN]` commits, returns the subjects newest-first and respects `limit`; on a non-git directory returns `[]` without throwing.
- **`projectTaskSummary`**: pglite — returns the project's tasks newest-first with correct `[open|claimed|closed]` labels and `→ REQ-NNN`; **project-scoped** (another project's tasks excluded); respects the cap.
- **`buildUserMessage`**: renders the `## ALREADY IN THIS PROJECT` section with task lines + commits when provided; renders the "(nothing built yet)" note when both are empty. (Pure function.)
- **`SYSTEM_PROMPT`**: a light assertion that the new no-duplication rule text is present.
- **`tickForProject`** (extend `worker.test.ts`): the `refreshClone` step is invoked per project; a `refreshClone` that throws does **not** abort the tick (other steps still run, `tick` doesn't reject).
- Register any new `*.test.ts` in the `package.json` `test` script (enumerated, not globbed).

## Scope / phasing (for the plan)

1. **Read helpers** — `recentGitLog` + `projectTaskSummary` (+ tests, TDD).
2. **Prompt** — `UserMessageParts` fields, the new section, the system-prompt rule (+ `buildUserMessage`/`SYSTEM_PROMPT` tests).
3. **Wire generation** — both `orchestrate.ts` functions assemble the blocks + budget; verify token accounting.
4. **Clone refresh** — `WorkerDeps.refreshClone` + `tickForProject` step (+ worker test); the web `/spec` action call site.
5. **Verify** — `npm test` / `typecheck` / `build`; a runtime check that a generation run now includes the completion context (and ideally that the previously-duplicated idea no longer duplicates).

## Requirement linkage

**REQ-008** (task generation). No new REQ.

## Out of scope (YAGNI)

- No new schema, table, or event.
- **No hard semantic validator** rejecting a generated task that matches an existing one — the prompt signal is the first fix; revisit if duplicates persist.
- No requirement-status feed beyond what the task lines already convey.
- No change to how often the worker ticks or to the slice-selection algorithm itself.
