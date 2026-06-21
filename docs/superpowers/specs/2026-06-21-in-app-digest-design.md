# In-app digest — amend REQ-026

**Date:** 2026-06-21
**Status:** Design, pending implementation
**Touches:** REQ-026 (redefined), REQ-003 (event-log coverage gap closed), REQ-012 (materializer exercised)

## Motivation

The Digest page showed "Set a webhook URL and schedule … until then it stays inert."
Investigation found the cause is not a misconfiguration but a missing capability:

- The "inert" banner is gated purely on `project.digest_webhook_url` being non-null.
- **Nothing in the app ever writes `digest_webhook_url` or `digest_schedule`.** The only
  writers are tests; `bindProject` leaves both NULL. There is no settings UI, action, or
  env var. The webhook the user thought they set was the *GitHub App* webhook (inbound
  events) — a different field entirely.

So the outbound digest (REQ-026) was built end-to-end but its configuration surface never
existed, leaving it permanently inert. Rather than build the missing Slack/Discord config,
the decision is to **make the digest an in-app artifact** — a generated "what moved this
window" summary read on the Digest page, with no outbound delivery.

This reverses REQ-026 as written ("a scheduled **outbound** digest … posted to a configured
webhook … **No in-app notification system**") and the matching CLAUDE.md anti-goal. Under the
truth model a requirement's meaning may not be changed silently, so the redefinition is a
logged decision (a `requirement.amended` event), not a quiet code edit.

## Decisions

1. **In-app, not outbound.** The digest is composed (LLM) and stored as an event; it is read
   on the Digest page. No webhook, no notification system.
2. **On-demand only.** A "Generate digest" button is the sole trigger. No schedule, no
   background job, no config to set. The window is "since the last digest" — the existing
   `digest.*` watermark already provides this.
3. **Drop both columns.** `digest_webhook_url` and `digest_schedule` become dead; remove them
   (Drizzle migration, hand-applied to the live DB).
4. **Rename the event** `digest.sent` → `digest.generated` (nothing is sent). Expected zero
   historical `digest.sent` events (the feature has been inert), so the rename is clean.
5. **Re-materialize SPEC.md, accepting the thin projection.** After amending REQ-026 we run
   `materializeSpec`. `renderSpec` emits only a header + Shipped/Planned lists, so SPEC.md
   loses its hand-written §1–4 / §6 prose (truth model, data model, event catalog, glossary).
   This is accepted knowingly; fixing the materializer to preserve the preamble is **out of
   scope** (a separate REQ-012 task). Consequence: SPEC.md will no longer carry the §4 event
   catalog, so **the `EventType` union in `src/db/events.ts` becomes the sole source of truth
   for the taxonomy.**

## Decomposition — two PRs

Two requirements are touched, so per one-task-per-PR this is two tasks.

### TASK A — amendment primitive + REQ-026 redefinition

The event taxonomy can `requirement.declared` and `requirement.status_changed` a requirement
but cannot **redefine** one. That is a gap in the event log's coverage (REQ-003): a
requirement's `description` is mutable state (`materializeSpec` reads it), yet no event records
a change to it. Closing that gap is the honest way to amend a requirement.

- **New event type** `requirement.amended` added to the `EventType` union, and to
  `RATIONALE_REQUIRED` — amending a spec decision must carry a why.
- **`amendRequirement(db, { key, title?, description, why })`** in `src/requirements/amend.ts`,
  mirroring `declareRequirement`: one transaction that updates the `requirements` row
  (`description`, optional `title`, `updatedAt`) and emits `requirement.amended`
  (`subjectType: "requirement"`, `subjectId`, payload `{ key }`, rationale = `why`). Throws if
  the key does not exist. Does **not** touch `status` (that remains lifecycle-derived).
- **Apply once to REQ-026** with the new self-contained text (Accept clause inline, since the
  thin projection renders `description` verbatim), e.g.:

  > An on-demand, in-app digest: a generated "what moved this window" prose summary, composed
  > from the activity feed and stored as a `digest.generated` event, read on the Digest page.
  > No outbound delivery and no notification system. *Accept:* generating composes a summary of
  > the decisions since the last digest and records `digest.generated`; an empty window records
  > nothing.

  with a rationale capturing *why* (the config surface never existed; a 5-user self-hosted tool
  on Tailscale doesn't need an outbound channel; in-app reading is sufficient).
- **Re-materialize** SPEC.md via `materializeSpec(db)` so the projection reflects the new text
  (thin projection accepted — see Decision 5).
- **Edit CLAUDE.md by hand** (it is the hand-maintained operating manual, not generated): the
  anti-goal line "the only push is the outbound digest (REQ-026)" and the stack/§ references to
  an outbound digest, to describe the in-app model.

How it is run once: a small one-shot (script under `src/cli/` or a guarded invocation) that
calls `amendRequirement` for REQ-026 then `materializeSpec`. Decide exact entrypoint in the
plan; it must go through `amendRequirement` (never a raw UPDATE), to honor the truth model.

### TASK B — rebuild the digest as on-demand in-app

Implements the amended REQ-026.

- **`src/digest/send.ts`** → rename `sendDigest` to `generateDigest`: drop the
  `digest_webhook_url` gate and the `post()` call; keep compose → emit. Emit
  `digest.generated`. Delete `sendDigestIfDue`, `dueForDigest`, `scheduleToDays`, `PostFn`,
  `httpPost`. (Rename file to `generate.ts` if cheap; otherwise keep the path.)
- **`src/worker/index.ts`** — remove the `sendDigestIfDue` import and the digest job block.
- **`src/db/schema.ts`** — remove `digestWebhookUrl`, `digestSchedule` from `project`.
- **New Drizzle migration** dropping both columns. **Must be hand-applied to the live Postgres**
  (db:migrate is fresh-provision only; tests won't catch a missing apply).
- **`src/digest/compose.ts`** — reword the system prompt and schema description from "outbound
  digest … team's channel" to an in-app summary. (Behavior unchanged; wording only.)
- **`src/digest/queries.ts`** — `digestSummary` reads `digest.generated`; rename `lastSentAt` →
  `lastGeneratedAt`.
- **`src/app/(app)/digest/digest-panel.tsx`** — the panel becomes the digest's home:
  - "Generate digest" button always available (replaces the webhook-gated "Send now").
  - Render the latest digest (already wired via `digest.*` payload `text`).
  - Add a short **history** list of past digests (all are events — query the last N
    `digest.generated`, show date + count + prose).
  - Remove the webhook / schedule / next-due cards and the "stays inert" banner.
- **`src/app/(app)/digest/actions.ts`** — `sendNow` → `generate`; call `generateDigest`.
- **`src/app/(app)/digest/page.tsx`** — rewrite header eyebrow/lede (drop "Outbound … posted to
  your team's webhook. The worker sends it on schedule.").
- **`src/app/(app)/dashboard/page.tsx`** — rail card wording: "Last generated …" / "Never
  generated" / "N generated".
- **`src/cli/digest.ts`** — drop `--send`/webhook framing; become generate + print (or retire
  if redundant with the button — decide in the plan).
- **Tests** — `src/digest/send.test.ts` (no webhook gate; assert `digest.generated` emitted
  without any post), `src/digest/queries.test.ts` (new event name + field).

The drawer route `@drawer/(.)digest/page.tsx` and `digest/page.tsx` both render `DigestPanel`,
so the panel rewrite covers both surfaces; no drawer-specific change.

## Truth-model compliance

- `amendRequirement` and `generateDigest` each write their event in the **same transaction** as
  the state write, via `emitEvent`. `requirement.amended` carries a rationale.
- No new writer of `tasks.github_status`. The append-only events rule holds (rename is a new
  type, not a mutation of past rows; historical `digest.sent` count expected to be zero).
- The amended REQ-026 text is the source of truth in `requirements.description`; SPEC.md is its
  projection, regenerated by `materializeSpec`.

## Out of scope

- Fixing `renderSpec` to preserve the §1–4 / §6 preamble (separate REQ-012 task).
- Any outbound/Slack/Discord/email delivery, or scheduling/config UI.
- A general requirement-editing UI — `amendRequirement` is a primitive used once here; no
  surface beyond it.

## Risks

- **Live DB migration** must be hand-applied or the app breaks on the missing columns; tests
  won't surface it. Call this out in the plan and at merge.
- **Materialize is destructive to SPEC.md** (accepted): the rich preamble is lost the first
  time `materializeSpec` runs. Reviewers will see a large SPEC.md diff — this is expected.
- **Materialize needs the repo clone / commit path** (`repoCommit`) to be functional in the
  environment where TASK A's one-shot runs.

## Acceptance

- The Digest page has no webhook/schedule UI and no "inert" banner; "Generate digest" composes
  a summary of decisions since the last digest and records `digest.generated`; the latest and a
  history of past digests are shown.
- An empty window records nothing.
- `project` no longer has `digest_webhook_url` / `digest_schedule`; the worker has no digest
  job.
- REQ-026 in the requirements table and in materialized SPEC.md describes the in-app digest; a
  `requirement.amended` event with a rationale records the change; CLAUDE.md's anti-goal matches.
