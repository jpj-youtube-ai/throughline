# Tasks visible only after their GitHub issue exists — design

**Date:** 2026-06-26
**Requirement:** REQ-009 (GitHub issue existence & task-issue lifecycle) — refinement, no new REQ. (Same shape as TASK-073 / REQ-016.)
**Task:** TASK-075. Branch `task-075-tasks-visible-after-issue`, squash `[TASK-075]`.

## Problem / goal

When you hit **Generate tasks** (the spec-map requirement drawer), the action generates the tasks synchronously and renders them inline **immediately**, while `github_issue_number` is still `null`. The GitHub issue is created up to ~10s later by the worker's `createIssuesForTasks` sweep (preview LLM + Puppeteer screenshot + issue API — slow/heavy work deliberately kept off the web request path). So for that window a task is shown with no issue behind it (no/empty "view issue" link).

The operator wants a task to be **visible only once its GitHub issue exists** — everywhere a task is shown, not just the generate result.

## Decisions (settled in brainstorming)

- **Scope = everywhere tasks are shown** (not just the generate result): the `/tasks` board, the spec requirement detail, and the dashboard task-count cards.
- **Failure handling = trust the worker:** an issue-less task is simply hidden until its issue exists; no pending/error area, no timeout-reveal. The worker retries every tick; at this scale (5 trusted users, working GitHub App) it succeeds. A persistently-failing issue means the task stays hidden — accepted.
- **Generate button = auto-reveal:** after clicking Generate, show a "creating their GitHub issues…" status and **poll** so the tasks appear (with claim controls) the moment their issues exist.
- **Keep issue creation in the worker.** No slow/heavy work (preview LLM, Puppeteer, issue API) moves onto the web request path — this respects the codebase's hard rule (never run multi-second external work synchronously in a Next server action; it times out behind the Funnel).

## Design

This is almost entirely a **read-side** change. No events, no schema, no change to generation or issue creation. `github_issue_number` is already written only by the issue-creation path (it is outbound bookkeeping, not `github_status` which stays webhook-only), so there is no truth-model impact.

### 1. The visibility rule

A task is "visible" iff `github_issue_number IS NOT NULL`. Apply `isNotNull(tasks.githubIssueNumber)` to the **task-row list/count reads the user browses**:

- `src/spec/detail.ts` `getRequirementDetail` — the requirement's task list (spec detail page, the intercepted drawer, **and** the inline generate result, since the generate action re-fetches through here).
- `src/tasks/queries.ts` `listTasks` — the `/tasks` board list (and any task-row counts it derives for that view).
- `src/dashboard/summarize.ts` — the dashboard's **task-count cards** (the counts that read task rows).
- `src/pipeline/queries.ts` `listPipeline` — the lifecycle pipeline card on the dashboard; reads `tasks` rows directly (not the event log), so it must be filtered.
- `src/metrics/quickwins.ts` `listQuickWins` — the quick-win recommendations card; also reads `tasks` rows directly and must be filtered.

**Deliberately NOT filtered** — these reflect reality/history, and filtering them would distort the truth model:

- `src/requirements/lifecycle.ts` `reconcileRequirementStatus` — requirement status is derived from **all** tasks (a generated-but-issue-less task still means the requirement is `building`). Filtering here would wrongly flip a requirement back to `planned`.
- **Event-derived views** — burn-up, heartbeat, activity feed (Pulse), narrative — read the **event log** (`tasks.generated` happened regardless of whether the issue exists yet), so they stay truthful and are untouched.
- `src/github/issues.ts` (`createIssuesForTasks` needs the issue-**less** tasks; `closeIssuesForMergedTasks`) and the claim path — operate on specific tasks by id/issue-state, never the browse filter.

To keep the rule DRY and discoverable, each filtered query adds the same `isNotNull(tasks.githubIssueNumber)` predicate with a short shared comment pointing back to this rule. (A one-liner SQL helper is optional; inline is fine given the number of sites.)

**Accepted transient inconsistency:** for the ~10–15s between generation and issue creation, a requirement can read `building` (lifecycle, unfiltered) while its detail shows 0 visible tasks. Self-heals on the next read once the issue lands. Acceptable at this scale.

### 2. Generate button — auto-reveal when issues land

`generateTasksForRequirement` (`src/app/(app)/spec/[key]/actions.ts`) generation is unchanged (still synchronous), but its return becomes:

```ts
type GenState =
  | { ok: true; generatedKeys: string[]; tasks: GenTask[] }   // generatedKeys = keys just generated; tasks = currently-visible (filtered) tasks
  | { ok: false; error: string }
  | null;
```

`generatedKeys` comes from the generation result (the keys it just persisted); `tasks` is the requirement's currently-**visible** (now filtered) tasks — initially excludes the new ones because they are issue-less.

A thin new server action drives the poll:

```ts
// auth-checked; resolves the active project; returns the requirement's VISIBLE (filtered) tasks
async function pollRequirementTasks(key: string): Promise<GenTask[]>
```

`SpecGenerate` (`src/app/(app)/spec/spec-generate.tsx`):
- On a successful generate, store `generatedKeys` and render **"Generated N tasks — creating their GitHub issues…"**.
- Start a client poll (`useEffect` + interval, ~3s) calling `pollRequirementTasks(reqKey)`; update local state with the returned visible tasks and render them inline with the existing claim controls (`SpecClaimButton`) as each becomes visible.
- Stop polling when every `generatedKey` is present in the visible list, or after a generous cap (e.g. ~3 min) → show "still creating… refresh to see the rest" (consistent with *trust-the-worker*; this is a poll timeout, not a failure surface).

The poll updates React local state (not `revalidatePath`), so it re-renders correctly inside the intercepted drawer (sidesteps the TASK-035/058 no-revalidate-rerender quirk).

## Data flow

click Generate → action generates tasks (issue-less, persisted) → returns `{ generatedKeys, tasks: [visible so far] }` → `SpecGenerate` shows "creating issues…" and polls `pollRequirementTasks` every ~3s → meanwhile the worker's `createIssuesForTasks` opens each issue and sets `github_issue_number` → next poll returns the now-visible task → it renders inline with claim → all generatedKeys visible → poll stops. Elsewhere (`/tasks`, dashboard counts, spec detail), the same filter means issue-less tasks simply never appear until their issue exists.

## Truth model

Read-only change. No new/changed events; no schema/migration; `github_status` untouched (webhook-only); `github_issue_number` still written only by the issue-creation path. Generation and issue creation logic are unchanged. event-integrity review is light (no state/event/schema change) but the generate action is adjacent, so include a pass.

## Testing

- **`getRequirementDetail`** (`src/spec/detail.test.ts`): a task with `githubIssueNumber = null` is excluded; a task with a non-null `githubIssueNumber` is included. (Seed both; assert the filtered list.)
- **`/tasks` board query** (`src/tasks/queries.test.ts`): issue-less tasks excluded from the board list/counts; issue-having tasks included.
- **dashboard summarize** (`src/dashboard/summarize.test.ts`): task-count cards exclude issue-less tasks.
- **Not-filtered guards:** `reconcileRequirementStatus` still derives `building` from an issue-less task (`src/requirements/lifecycle.test.ts` — add/confirm); an event-derived metric (e.g. burn-up) is unaffected by issue-less tasks (confirm existing tests still pass; add one if cheap).
- **`pollRequirementTasks`**: returns only visible (filtered) tasks for the active project + requirement (project-scoped). (Server action — covered by the underlying `getRequirementDetail` test + typecheck; a thin direct test if it carries logic.)
- **UI** (`SpecGenerate` poll): not unit-tested (repo convention) — typecheck/build + runtime smoke in a signed-in browser.
- Register any new `*.test.ts` in the `test` script in `package.json` (enumerated, not globbed).
- Full suite + `npm run typecheck` + `npm run build`.

## Out of scope (YAGNI)

- Any "awaiting GitHub issue" pending area, error surface, or timeout-reveal (chose trust-the-worker).
- Moving generation to the worker / an event-signaled generate (generation stays synchronous in the action; only issue *visibility* changes).
- Filtering event-derived history views or requirement-status derivation (would distort the log-as-truth).
- A new migration, event type, or provenance change.

## Deploy

**Web-only** (reads + a client poll; the worker is untouched and already creates issues every tick). No migration. Web restart per the redeploy recipe.
