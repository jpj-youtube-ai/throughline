# Throughline — Specification (Complete)

> Throughline turns your team's approved ideas into spec-linked GitHub tasks for Claude Code, and logs the *why* behind every decision so the project's history never gets lost.

This spec covers the **entire** system — every feature is a first-class build target with acceptance criteria. The order tags are a recommended **build sequence**, not a scope line: everything here ships.

---

## 0. How to read this spec

- Requirements are `REQ-NNN`, each with acceptance criteria.
- **Order tags** `[1]`/`[2]`/`[3]` indicate recommended build sequence (foundation → integrity → surface), not whether to build. Everything is in scope.
- **Status** (tracked in data, not this doc): `planned` → `building` → `shipped`.
- **Provenance**: `imported` (genesis) · `voted` (approved idea) · `drift` (declared at drift resolution).

---

## 1. The truth model (read first — correctness depends on it)

Four artifacts, each authoritative for exactly one thing:

1. **Event log** — source of truth for **intent and causal history** (what was decided, by whom, *why*). Append-only; never updated or deleted.
2. **Code on `master`** — source of truth for **current state** (what is actually built).
3. **GitHub** — authoritative for **task-issue existence and open/closed/merged status**. The board mirrors these via webhook and never overrides them. A task is "done" only when its PR merges — a fact born on GitHub.
4. **Board database** — authoritative for everything else (idea/task content, metadata, claim state, REQ links, votes) and is the single human interface.

**`SPEC.md` in the repo is NOT truth.** It is a materialized projection generated from requirement events — readable by humans and Claude Code, never hand-edited. This is what stops the spec rotting: it is regenerated, not maintained.

**Hybrid event sourcing.** Mutable state tables exist for fast queries, written transactionally alongside their events. The `events` table is the durable, authoritative record of history and rationale. State is a projection of the log; the log is never rebuilt from state.

---

## 2. Architecture & stack

- **Framework:** Next.js (App Router), self-hosted on the operator's always-on machine.
- **Database:** Postgres via **Drizzle** ORM.
- **Auth:** Auth.js (NextAuth), GitHub provider, sole sign-in.
- **Repo access:** a dedicated **GitHub App** on the one project repo (issues r/w, contents r/w, pull requests r, webhooks).
- **Repo reads for generation:** a **local clone** on the host, pulled before each run.
- **LLM:** Anthropic API, Sonnet or Opus for generation (never Haiku).
- **Background worker** for long-running jobs (generation, drift, narrative, digest).
- **Team access:** Tailscale; no public exposure, no DNS required.

**Baked-in assumptions:** single project / single repo; flat equal roles (operator installs the App); one spec, tied to the repo.

---

## 3. Data model

### `users`
`id uuid pk` · `github_id bigint unique` · `github_login text` · `name text` · `avatar_url text` · `created_at`

### `project` (singleton)
`id uuid pk` · `repo_full_name text` · `default_branch text` · `installation_id bigint` · `local_clone_path text` · `spec_path text` (`SPEC.md`) · `claude_md_path text` (`CLAUDE.md`) · `convention_version int` · `digest_webhook_url text null` · `digest_schedule text null` · `created_at`

### `requirements`
`id uuid pk` · `key text unique` (`REQ-NNN`) · `title text` · `description text` · `status enum` (`planned`|`building`|`shipped`) · `provenance enum` (`imported`|`voted`|`drift`) · `origin_idea_id uuid null` · `created_at` · `updated_at`

### `ideas`
`id uuid pk` · `title text` · `why text null` (mandatory once promoted from scratch) · `feasibility int null` (1–10) · `viability int null` (1–10) · `author_id uuid` · `state enum` (`scratch`|`voting`|`approved`|`rejected`|`generated`) · `last_activity_at timestamptz` · `created_at` · `updated_at`

### `votes`
`id uuid pk` · `idea_id uuid` · `user_id uuid` · `created_at` · unique `(idea_id, user_id)`

### `tasks`
`id uuid pk` · `key text unique` (`TASK-NNN`) · `title text` · `body text` (Claude Code pointers) · `requirement_id uuid` (mandatory) · `origin_idea_id uuid null` · `effort int` (1–5) · `risk enum` (`low`|`med`|`high`) · `confidence int` (0–100) · `claim_user_id uuid null` · `claim_state enum` (`unclaimed`|`claimed`) · `branch_name text null` · `github_issue_number int null` · `github_issue_url text null` · `github_status enum` (`open`|`closed`, **mirrored from GitHub only**) · `created_at` · `updated_at`

### `drift_flags`
`id uuid pk` · `task_id uuid` · `pr_number int` · `unmapped_items jsonb` · `status enum` (`open`|`resolved`) · `resolution enum null` (`new_req`|`out_of_scope`|`relink`) · `resolved_by uuid null` · `created_at` · `resolved_at null`

### `events` (append-only — the log)
`id uuid pk` · `type text` · `actor_id uuid null` (null = system) · `subject_type text` · `subject_id uuid null` · `payload jsonb` · `rationale text null` · `created_at`

> Append-only enforced: no update/delete code paths; revoke UPDATE/DELETE at DB-role level if practical.

### `narratives` (cache)
`id uuid pk` · `generated_at` · `event_count int` · `content jsonb` (segments with event refs + recorded/inferred flags)

---

## 4. Event taxonomy

| type | rationale | payload |
|---|---|---|
| `project.genesis_imported` | — | filename, count |
| `requirement.declared` | — | provenance, key, origin_idea_id |
| `requirement.status_changed` | — | from, to |
| `idea.parked` | — | author (scratch created) |
| `idea.graduated` | — | scratch → voting |
| `idea.submitted` | ✅ why | scores, author |
| `idea.voted` | — | voter |
| `idea.gate_passed` | — | count |
| `idea.approved` | ✅ | — |
| `idea.rejected` | ✅ | — |
| `tasks.generated` | — | task keys, req keys, model, tokens |
| `task.claimed` | — | claimer, branch |
| `task.unclaimed` | — | — |
| `task.github_status_changed` | — | from, to (webhook) |
| `work.logged_retroactively` | ✅ | pr/commit, minted req/task |
| `spec.materialized` | — | count, commit sha |
| `drift.flagged` | — | task key, unmapped items |
| `drift.resolved` | ✅ | resolution |
| `claude_md.synced` | — | convention version |
| `narrative.generated` | — | event count |
| `digest.sent` | — | window, summary |

---

## 5. Requirements

### Foundation — the core loop `[1]`

**REQ-001 — GitHub sign-in.** Sole auth is GitHub via Auth.js. First sign-in creates a `users` row from the GitHub profile; identity is used for attribution throughout. *Accept:* no non-GitHub login path exists.

**REQ-002 — GitHub App & repo binding.** Operator installs the App on one repo; setup records `repo_full_name`, `installation_id`, `default_branch`, creates the `project` singleton, and maintains a local clone. *Accept:* after setup the board reads repo contents locally and can open issues/PRs via the App.

**REQ-003 — Event log foundation.** Append-only `events`; every state change writes its event in the same transaction; no update/delete paths. *Accept:* each action produces exactly one correct event, with `rationale` where required.

**REQ-004 — Genesis spec import.** Upload a Markdown spec → parse into requirements, each `provenance=imported`, `status=planned`, monotonic `REQ-NNN`. Emits `project.genesis_imported` + one `requirement.declared` each. Imported reqs are **pre-approved** but flagged `imported`. Greenfield: no code to reconcile; they populate the planned horizon. *Accept:* after import the spec view shows N planned, seed-marked requirements and the log holds the genesis events.

**REQ-005 — Submit an idea.** Fields: title, **why** (mandatory pitch), feasibility (1–10), viability (1–10). Creates `ideas` (`state=voting`), emits `idea.submitted` with the why as rationale. *Accept:* empty why blocks submission; submitted idea appears in `voting`.

**REQ-006 — Idea board.** Lists `voting` ideas with title, why, scores, vote progress, author; default sort by vote progress. *Accept:* all voting ideas visible with accurate live counts.

**REQ-007 — Voting & the 2-gate.** One vote per user per idea (unique); **author may vote**; gate = **2 approvals**. Reaching 2 → `approved`, emits `idea.gate_passed` then `idea.approved`; voting emits `idea.voted`. *Accept:* the 2nd distinct approval flips to `approved` and triggers generation; further votes have no gate effect.

**REQ-008 — Task generation.** Background job assembles context (idea + why + materialized spec + a **curated slice** of the local clone, not the whole repo) → Anthropic API → tasks, each with title, implementation body (**pointers, not a canned prompt**: files/patterns to follow + acceptance check), `effort` (1–5), `risk`, `confidence` (0–100), and a **mandatory REQ link** (existing or newly declared, `provenance=voted`). Each task gets a `TASK-NNN` key + row; emits `tasks.generated`. Malformed output is validated, retried, and surfaced as "generation failed — retry" rather than written as partial tasks. *Accept:* approval yields ≥1 task, each with a valid REQ link and all three metrics; malformed responses create no partial tasks.

**REQ-009 — Issue creation & status mirroring.** Each task → a GitHub issue via the App (`issue_number`/`url` stored). A webhook updates `github_status` on close/reopen/PR-merge, emitting `task.github_status_changed`. The board **never** sets `github_status` itself. *Accept:* closing/merging on GitHub flips board status within one webhook cycle; the board cannot mark a task done locally.

**REQ-010 — Task board & claiming.** Lists tasks with title, REQ link, the three metrics, claim state, mirrored status. Claim: atomic `unclaimed→claimed`, sets `claim_user_id`, computes `branch_name=task-<key>-<slug>`, emits `task.claimed`, optionally assigns the issue. Unclaim emits `task.unclaimed`. *Accept:* a claimed task shows claimer + branch everywhere; two users cannot both win the claim.

**REQ-011 — Commit linkage via squash-merge.** Convention: branch `task-<key>-<slug>`; PR title + squash message start with `[TASK-<key>]`; repo set to squash-from-PR-title. *Accept (process):* `git log master` shows one `[TASK-NNN]` line per merged task; no per-commit linter needed.

**REQ-012 — Spec materialization (two-horizon).** Render all requirements into **shipped** (`shipped`) and **planned** (`planned`/`building`) groups with key, title, linked tasks; regenerate on any requirement change; commit/PR to the repo; never hand-edited; emits `spec.materialized`. *Accept:* `SPEC.md` always reflects current requirements; manual edits are overwritten next materialization (by design).

### Integrity layer `[2]`

**REQ-013 — Drift detection.** PR-time check reads the PR diff + the task's REQ and identifies work mapping to no requirement. It **flags, never auto-resolves** (never rewrites the spec to match code). Offers three paths — `new_req`, `out_of_scope`, `relink` — recorded in `drift_flags` and logged with rationale (`drift.resolved`). *Accept:* a PR doing more than its task claims raises a flag listing unmapped items; resolving records the decision + why; no spec change without a human choice.

**REQ-014 — CLAUDE.md managed block.** The board writes a managed region into the target repo's `CLAUDE.md` (branch/commit convention, task-pickup protocol, spec contract). Written **directly** but **only** between `<!-- THROUGHLINE:START -->`/`<!-- THROUGHLINE:END -->`; missing markers → appended; never blind-overwritten. Emits `claude_md.synced`; carries `convention_version`. *Accept:* updating the block changes only the marked region; surrounding content is byte-identical after.

**REQ-015 — Spec reconciliation.** On demand, compare materialized spec vs log + code; report stale requirement text and code/features mapping to no requirement. Regenerating is a reviewed PR. *Accept:* reconciliation lists divergences without auto-applying; applying produces a PR, not a silent commit.

### Surface — visual & narrative layer `[3]`

**REQ-016 — Project narrative.** A grounded "how did we get here", generated from the event log into the `narratives` cache. Every claim traces to real events; **recorded reasoning and inferred reasoning are visibly distinct**; inferences never present as recorded fact. *Accept:* each statement links to source event(s); inferred segments are visually marked; regenerating updates the cache with the covered event count.

**REQ-017 — Spec map.** A grid of requirement cells — not-started / building / shipped — derived from requirement status. *Accept:* cell states match requirement statuses live; counts reconcile with the requirements table.

**REQ-018 — Burn-up chart.** Completed requirements over time, with a scope line (total over time). Both series derived from `requirement.declared` / `requirement.status_changed` events. *Accept:* the done series equals cumulative `shipped` transitions by date; scope equals cumulative declarations.

**REQ-019 — Activity feed.** "What moved since I last looked", from the event log, newest first, with human-readable lines per event type and a per-user "last seen" marker. *Accept:* every item maps to a real event; the marker separates new from old.

**REQ-020 — Quick-win surfacer.** Open, unclaimed tasks ranked by `viability ÷ effort` (viability via origin idea; effort from the task). *Accept:* ordering matches the ratio; claimed/closed tasks excluded.

**REQ-021 — Lifecycle pipeline.** Ideas grouped by stage: scratch → voting → generated → in progress → shipped (in-progress/shipped derived from linked task statuses). *Accept:* each idea appears in exactly one stage consistent with its state and its tasks' mirrored statuses.

**REQ-022 — Project heartbeat / timeline.** Milestones from the log: first idea, repo bound, first task shipped, spec quartiles (25/50/75/100% shipped), first release tag. *Accept:* each milestone node maps to the satisfying event(s); future milestones shown pending.

**REQ-023 — Idea decay.** Ideas dim as `last_activity_at` ages while unvoted/stalled, surfaced with an age and a prompt to approve, revive, or drop. *Accept:* an idea past the inactivity threshold is visibly aged; voting or editing resets `last_activity_at`.

### Reality & adoption layer `[3]`

**REQ-024 — Scratch / thought state.** A parking state below idea: title only, no why/scores required (`state=scratch`), emits `idea.parked`. Graduating to `voting` requires the why + scores and emits `idea.graduated`. *Accept:* a scratch is creatable with title alone; it cannot enter voting without a why + scores.

**REQ-025 — Retroactive logging of informal work.** Attach a why to work that already happened: from a merged PR with no task, mint a requirement and/or task after the fact, emitting `work.logged_retroactively` with rationale. *Accept:* a merged PR can be linked to a newly minted (or existing) REQ/TASK with a recorded why; the log marks it retroactive, distinct from normal generation.

**REQ-026 — Digest to team chat.** A scheduled outbound digest ("what moved this window") posted to a configured webhook (Slack/Discord), built from the activity feed; emits `digest.sent`. No in-app notification system. *Accept:* on schedule, a window summary posts to `digest_webhook_url`; empty windows post nothing or a quiet "no movement".

**REQ-027 — Why-quality surfacing.** Make thinning rationale legible rather than confabulated over: the narrative (and optionally the feed) flags stretches where recorded whys are sparse, instead of inventing reasoning. *Accept:* a run of decisions with empty/low-content whys is shown as "thin reasoning here", never papered over with inferred reasons presented as fact.

---

## 6. Conventions & glossary

- **REQ-NNN / TASK-NNN** — monotonic keys; REQ lives in the log + materialized into `SPEC.md`; TASK becomes a GitHub issue, carried to `master` via squash PR title `[TASK-NNN]`.
- **Branch** — `task-<key>-<slug>`, set at claim time.
- **The why** — mandatory on idea submit; also captured at approve / reject / drift-resolve / retroactive-log as event rationale.
- **Source of truth** — log = intent & history; code = current state; GitHub = issue existence/status; board = everything else. Spec = derived, never truth.

---

## 7. Recommended build order

Everything ships; build it in this sequence so the risky part is proven before the rest leans on it.

1. **Generation as a standalone script** (REQ-008's core), iterated against real example ideas until the task output is genuinely good. The only novel, uncertain part — prove it first.
2. **Foundation `[1]`:** event log + data model → genesis import → auth + App binding → idea board + vote + 2-gate (one thin vertical slice end-to-end) → wire in generation + issues + status webhook → claim/branch/squash + spec materialization.
3. **Integrity `[2]`:** drift detection → CLAUDE.md sync → reconciliation.
4. **Surface `[3]`:** narrative + visual views (map, burn-up, feed, quick-wins, pipeline, heartbeat, decay) + adoption (scratch, retroactive logging, digest, why-quality).

Each `[3]` view is a rendering of the event log built in steps 1–2; they are cheap once the log is real, which is why they come last.
