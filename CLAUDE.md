# CLAUDE.md — Throughline

Read this before doing anything in this repo. It is the operating manual for building Throughline with Claude Code. The full requirements live in `SPEC.md`.

## What this project is

Throughline turns a team's approved ideas into spec-linked GitHub tasks for Claude Code, and logs the *why* behind every decision so the project's history never gets lost. Self-hosted, 5 users, single repo.

## The truth model — do not violate this

Correctness depends on four artifacts, each authoritative for one thing:

- **Event log** = intent & causal history (what was decided, by whom, why). Append-only. Never update or delete an event.
- **Code on `master`** = current state.
- **GitHub** = task-issue existence and open/closed/merged status. Mirror it via webhook; never set a task's `github_status` from app logic.
- **Board DB** = everything else (idea/task content, metadata, claim state, REQ links, votes).

`SPEC.md` is a **generated projection**, never a source of truth, never hand-edited. The board materializes it from requirement events.

**The non-negotiable rule:** every state change writes its event in the *same database transaction* as the mutable-table write. If you add a feature that changes state without emitting an event, it is wrong. Events requiring rationale (see `SPEC.md` §4) must carry it.

## Stack

Next.js (App Router) · Postgres + Drizzle · Auth.js (GitHub provider, sole sign-in) · a separate GitHub App for repo read/write · local repo clone for generation context · Anthropic API (Sonnet/Opus, never Haiku) for generation · background worker for long jobs · Tailscale for team access. Do not add a second auth method. Do not call the GitHub API for generation context when the local clone will do.

## How we work — conventions

- **Tasks:** `TASK-NNN`. **Requirements:** `REQ-NNN`. Both monotonic.
- **Branches:** `task-<key>-<slug>` (e.g. `task-014-event-log-table`).
- **PRs:** title and squash message **start with** `[TASK-NNN]`. Repo is set to squash-merge seeded from the PR title, so the id lands on `master` as one clean line per task. Do this even now, while building the tool that will later enforce it — dogfood the convention.
- **Every task implements exactly its linked `REQ-NNN`.** Don't invent requirement ids. If work doesn't map to a requirement, that's drift — surface it, don't fold it silently into the code.
- **Commits:** small and reviewable. One task per PR.

## Build order — hold the line

`SPEC.md` describes the **whole** system (27 requirements). That is the destination, not the next commit. Build in this order and do not scaffold ahead of it:

1. **Generation as a standalone script first.** Before any app shell: a script that takes an idea + the spec + a curated repo slice and produces well-formed, REQ-linked tasks with effort/risk/confidence. Iterate the *prompt* against real example ideas until the output is genuinely good. This is the only uncertain part — prove it before building anything around it.
2. **Foundation `[1]`** — event log + data model first (it's load-bearing for everything), then genesis import, auth + App binding, then the idea→vote→gate vertical slice end-to-end, then wire in generation + issues + status webhook, then claim/branch/squash + spec materialization.
3. **Integrity `[2]`** — drift detection, CLAUDE.md sync, reconciliation.
4. **Surface `[3]`** — narrative + the visual views + adoption features.

When in doubt, build the smaller thing and get it working end-to-end before going wide. Do not build a `[3]` view before the event log it reads from exists and is real.

## Coding standards

- **TypeScript throughout.** No `any` in domain code (events, tasks, requirements).
- **Drizzle:** define the schema in one place; the event-write helper and the state-write must share a transaction. Provide a single `emitEvent(tx, ...)` used everywhere — never write an event outside a transaction that also wrote state.
- **Append-only events:** no code path updates or deletes `events`. If you find yourself wanting to, you're modelling something wrong — add a new event instead.
- **Mirrored status is read-only locally:** `tasks.github_status` is only ever written by the webhook handler. Grep for any other writer before merging.
- **LLM calls:** validate and parse structured output; on malformed output, retry then surface a failure state — never persist partial/garbage tasks. Keep generation context lean (spec + curated slice), both for cost and task quality.
- **Secrets:** Anthropic key and GitHub App credentials in env only, never in the repo.

## What "done" means for a task

A task is done when its PR merges — a fact that comes from GitHub via webhook, not something the app decides. Closing the loop in code means: the webhook flips `github_status` and emits `task.github_status_changed`. If your feature claims a task is complete without that path, it's wrong.

## Anti-goals

- Don't reintroduce the spec (or the log) as a hand-maintained truth document.
- Don't let the board become canonical for issue existence or completion.
- Don't build the full 27 requirements in one pass because the spec lists them — the spec is thorough so the destination is clear, not so the first sprint fills it.
- Don't add an in-app notification/push system. The digest (REQ-026) is an in-app, on-demand summary you read on the board — there is no outbound channel.
