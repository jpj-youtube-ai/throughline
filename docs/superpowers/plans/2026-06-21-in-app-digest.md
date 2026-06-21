# In-app Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redefine the digest (REQ-026) from an outbound webhook push to an on-demand, in-app generated summary read on the Digest page.

**Architecture:** Two PRs. **TASK A** adds the missing `requirement.amended` event + `amendRequirement()` primitive (closing a REQ-003 coverage gap), uses it once to redefine REQ-026, and re-materializes SPEC.md. **TASK B** rebuilds the digest on-demand: drops the webhook/schedule, renames `digest.sent` → `digest.generated`, and turns the Digest panel into Generate + latest + history.

**Tech Stack:** Next.js (App Router) · Postgres + Drizzle (PGlite for tests) · `node:test` via `tsx --test` · Anthropic SDK (Opus) for compose.

## Global Constraints

Copied verbatim from CLAUDE.md / the design — every task's requirements include these:

- **TypeScript throughout. No `any` in domain code** (events, tasks, requirements).
- **Every state change writes its event in the same DB transaction** as the mutable-table write, via the single `emitEvent(tx, ...)` helper. Never emit an event outside the transaction that wrote state.
- **Append-only events:** no code path updates or deletes `events`. The rename emits a *new* type going forward; it never mutates past rows.
- **`tasks.github_status` is written only by the webhook handler** — do not add another writer.
- **Branches:** `task-<key>-<slug>`. **PR title + squash message start with `[TASK-NNN]`.** One task per PR.
- **LLM calls** use Sonnet/Opus, never Haiku; validate/parse structured output; never persist garbage.
- **Migrations:** a new Drizzle migration must be **hand-applied to the live Postgres**; `db:migrate` re-runs the whole `schemaSql()` and is fresh-provision only. Tests build their schema from `drizzle/*.sql` via `schemaSql()`, so a migration file is required for tests to see the change.
- **Event taxonomy source of truth:** after re-materialize, SPEC.md no longer carries a §4 event catalog, so the `EventType` union in `src/db/events.ts` is the sole taxonomy record.
- Work on branch **`task-042-in-app-digest`** (already created off `main`; design doc already committed there). If TASK A and TASK B should be separate PRs with their own `TASK-NNN`, split branches at finish time.

---

## File Structure

**TASK A**
- Modify `src/db/events.ts` — add `requirement.amended` to the union + the rationale-required set.
- Create `src/requirements/amend.ts` — `amendRequirement()` primitive.
- Create `src/requirements/amend.test.ts` — unit tests.
- Create `src/cli/amend.ts` — general `amend` CLI (reusable; used once for REQ-026).
- Modify `package.json` — add the `amend` script and register the new test file.
- Modify `CLAUDE.md` — rewrite the digest anti-goal line (CLAUDE.md is hand-maintained).
- Operational — run `amend` for REQ-026, then `materialize` (live DB + bound clone).

**TASK B**
- Modify `src/db/events.ts` — rename `digest.sent` → `digest.generated`.
- Modify `src/digest/send.ts` — `sendDigest` → `generateDigest`; drop webhook + schedule helpers.
- Modify `src/digest/compose.ts` — reword copy to "in-app" (behavior unchanged).
- Modify `src/digest/queries.ts` — read `digest.generated`; rename field; add `recentDigests`.
- Modify `src/digest/send.test.ts`, `src/digest/queries.test.ts` — rewrite for the new behavior.
- Modify `src/worker/index.ts` — remove the digest job.
- Modify `src/cli/digest.ts` — generate + print; drop the `--send`/webhook framing.
- Modify `src/db/schema.ts` — remove `digestWebhookUrl`, `digestSchedule`.
- Create `drizzle/0003_drop_digest_columns.sql` — drop the two columns (via `db:generate` or by hand).
- Modify `src/app/(app)/digest/digest-panel.tsx` — Generate + latest + history (covers the drawer too).
- Modify `src/app/(app)/digest/actions.ts` — `sendNow` → `generate`.
- Modify `src/app/(app)/digest/page.tsx` — reword header.
- Modify `src/app/(app)/dashboard/page.tsx` — rail-card wording + field rename.
- Operational — hand-apply the column drop to the live DB (cleanup; not load-bearing).

---

## TASK A — amendment primitive + REQ-026 redefinition

**Interfaces:**
- Produces: `amendRequirement(db: Db, input: { key: string; title?: string; description: string; why: string; actorId?: string | null }): Promise<{ id: string; key: string }>`
- Produces: event type `"requirement.amended"` (rationale required).
- Consumes: existing `emitEvent`, `requirements` schema, `materializeSpec`.

- [ ] **Step 1: Add the event type.** In `src/db/events.ts`, add `requirement.amended` to the `EventType` union (right after `"requirement.status_changed"`):

```ts
  | "requirement.declared"
  | "requirement.status_changed"
  | "requirement.amended"
```

and add it to `RATIONALE_REQUIRED`:

```ts
const RATIONALE_REQUIRED: ReadonlySet<EventType> = new Set([
  "idea.submitted",
  "idea.approved",
  "idea.rejected",
  "work.logged_retroactively",
  "drift.resolved",
  "requirement.amended",
]);
```

- [ ] **Step 2: Write the failing test.** Create `src/requirements/amend.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { requirements, events } from "../db/schema";
import { amendRequirement } from "./amend";

test("amendRequirement updates the description and records requirement.amended with the why", async () => {
  const { db, close } = await createTestDb();
  try {
    const [r] = await db
      .insert(requirements)
      .values({ key: "REQ-026", title: "Digest to team chat", description: "outbound webhook", provenance: "imported" })
      .returning({ id: requirements.id });

    const res = await amendRequirement(db, {
      key: "REQ-026",
      description: "An on-demand, in-app digest.",
      why: "the outbound config surface never existed; in-app is enough",
    });
    assert.equal(res.id, r.id);

    const [row] = await db.select().from(requirements).where(eq(requirements.id, r.id));
    assert.equal(row.description, "An on-demand, in-app digest.");
    assert.equal(row.title, "Digest to team chat"); // unchanged when title omitted

    const evs = await db.select().from(events).where(eq(events.type, "requirement.amended"));
    assert.equal(evs.length, 1);
    assert.equal(evs[0].subjectId, r.id);
    assert.match(evs[0].rationale ?? "", /never existed/);
  } finally {
    await close();
  }
});

test("amendRequirement throws on an unknown key", async () => {
  const { db, close } = await createTestDb();
  try {
    await assert.rejects(amendRequirement(db, { key: "REQ-999", description: "x", why: "y" }), /no such requirement/);
  } finally {
    await close();
  }
});
```

- [ ] **Step 3: Run the test, verify it fails.**

Run: `npx tsx --test src/requirements/amend.test.ts`
Expected: FAIL — cannot find module `./amend`.

- [ ] **Step 4: Implement the primitive.** Create `src/requirements/amend.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { requirements } from "../db/schema";
import { emitEvent } from "../db/events";

export interface AmendRequirementInput {
  key: string; // REQ-NNN to amend
  title?: string; // optional new title; omit to keep the current one
  description: string; // replaces the current description
  why: string; // rationale — requirement.amended must carry a why
  actorId?: string | null;
}

/**
 * Amend an existing requirement's definition (title/description) and record it
 * with requirement.amended + a rationale, in one transaction. The only sanctioned
 * way to change a requirement's text: declare creates, lifecycle changes status,
 * amend redefines. Does not touch status (that stays lifecycle-derived). Throws
 * if the key does not exist.
 */
export async function amendRequirement(db: Db, input: AmendRequirementInput): Promise<{ id: string; key: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: requirements.id, title: requirements.title, description: requirements.description })
      .from(requirements)
      .where(eq(requirements.key, input.key))
      .for("update")
      .limit(1);
    if (!row) throw new Error(`Cannot amend ${input.key}: no such requirement.`);

    const nextTitle = input.title ?? row.title;
    await tx
      .update(requirements)
      .set({ title: nextTitle, description: input.description, updatedAt: new Date() })
      .where(eq(requirements.id, row.id));

    await emitEvent(tx, {
      type: "requirement.amended",
      subjectType: "requirement",
      subjectId: row.id,
      actorId: input.actorId ?? null,
      payload: {
        key: input.key,
        from: { title: row.title, description: row.description },
        to: { title: nextTitle, description: input.description },
      },
      rationale: input.why,
    });
    return { id: row.id, key: input.key };
  });
}
```

- [ ] **Step 5: Run the test, verify it passes.**

Run: `npx tsx --test src/requirements/amend.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Add the CLI.** Create `src/cli/amend.ts`:

```ts
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";
import { createDb } from "../db/client";
import { amendRequirement } from "../requirements/amend";

// Amend a requirement's definition (records requirement.amended):
//   npx tsx src/cli/amend.ts --key REQ-NNN --description "…" --why "…" [--title "…"]
async function main(): Promise<void> {
  loadDotenv();
  const { values } = parseArgs({
    options: {
      key: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      why: { type: "string" },
    },
  });
  if (!values.key || !values.description || !values.why) {
    throw new Error('Usage: npx tsx src/cli/amend.ts --key REQ-NNN --description "…" --why "…" [--title "…"]');
  }
  const { db, close } = createDb();
  try {
    const r = await amendRequirement(db, {
      key: values.key,
      title: values.title,
      description: values.description,
      why: values.why,
    });
    console.error(`[amend] ${r.key} amended.`);
  } finally {
    await close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[amend] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
```

- [ ] **Step 7: Register the script and the test.** In `package.json`, add to `scripts` (after the `"materialize"` line):

```json
    "amend": "tsx src/cli/amend.ts",
```

and append `src/requirements/amend.test.ts` to the end of the `"test"` command's file list (space-separated).

- [ ] **Step 8: Run the full suite + typecheck.**

Run: `npm run typecheck && npm test`
Expected: PASS, including the new `amend.test.ts`.

- [ ] **Step 9: Commit.**

```bash
git add src/db/events.ts src/requirements/amend.ts src/requirements/amend.test.ts src/cli/amend.ts package.json
git commit -m "[TASK-042] requirement.amended event + amendRequirement primitive (REQ-003)"
```

- [ ] **Step 10: Edit CLAUDE.md (hand-maintained).** Replace the anti-goal line:

> - Don't add notifications as an in-app system; the only push is the outbound digest (REQ-026).

with:

> - Don't add an in-app notification/push system. The digest (REQ-026) is an in-app, on-demand summary you read on the board — there is no outbound channel.

Then grep CLAUDE.md for any other "outbound digest" / "webhook (digest)" phrasing and align it. Commit:

```bash
git add CLAUDE.md
git commit -m "[TASK-042] CLAUDE.md: digest is in-app, not an outbound push (REQ-026)"
```

- [ ] **Step 11: OPERATIONAL — amend REQ-026 in the live DB.** Requires `DATABASE_URL` set and the project bound. From PowerShell (single-quoted here-strings keep backticks/quotes literal):

```powershell
$desc = @'
An on-demand, in-app digest: a generated "what moved this window" prose summary, composed from the activity feed and stored as a `digest.generated` event, read on the Digest page. No outbound delivery and no notification system. *Accept:* generating composes a summary of the decisions since the last digest and records `digest.generated`; an empty window records nothing.
'@
$why = @'
The outbound webhook/schedule config surface never existed, so the digest was permanently inert. A 5-user self-hosted tool on Tailscale does not need an outbound channel; an in-app, on-demand summary is sufficient. This reverses the prior outbound-only definition of REQ-026.
'@
npx tsx src/cli/amend.ts --key REQ-026 --title "Digest" --description $desc --why $why
```

Verify: `[amend] REQ-026 amended.` printed, and one `requirement.amended` event exists for REQ-026.

- [ ] **Step 12: OPERATIONAL — re-materialize SPEC.md.** This regenerates SPEC.md as the **thin projection** (header + Shipped/Planned lists) — the rich §1–4/§6 prose is dropped, as agreed. Materialize commits SPEC.md into the bound clone (`[spec] materialize requirements`).

```bash
npx tsx src/cli/materialize.ts
```

Verify SPEC.md now shows the redefined REQ-026 under its Shipped/Planned section. If the bound clone is a separate checkout from this branch, reconcile the resulting SPEC.md into the PR per your repo layout (do not hand-edit it — it is generated output). If the environment lacks `DATABASE_URL`/a bound clone, hand Steps 11–12 to the operator.

---

## TASK B — rebuild the digest as on-demand in-app

**Interfaces:**
- Produces: `generateDigest(db: Db, opts?: { compose?: ComposeFn }): Promise<{ generated: true; eventCount: number; text: string } | { generated: false; reason?: string; failure?: string }>`
- Produces: event type `"digest.generated"` (replaces `"digest.sent"`).
- Produces: `digestSummary(db): Promise<{ count: number; lastGeneratedAt: Date | null }>`, `recentDigests(db, limit?): Promise<{ at: Date; eventCount: number; text: string | null }[]>`
- Produces: server action `generate()` (replaces `sendNow()`).
- Consumes: `listActivity`, `composeDigest`/`ComposeFn`, `emitEvent`, `project`/`events` schema.

- [ ] **Step 1: Rename the event type.** In `src/db/events.ts`, change the last union member:

```ts
  | "digest.generated";
```

- [ ] **Step 2: Rewrite the digest test (failing).** Replace the entire contents of `src/digest/send.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { users, project, events } from "../db/schema";
import { emitEvent } from "../db/events";
import { generateDigest } from "./send";

async function seedProjectWithActivity(db: Db) {
  await db.insert(project).values({
    repoFullName: "acme/repo",
    defaultBranch: "main",
    installationId: 1,
    localClonePath: "/x",
  });
  const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
  await db.transaction((tx) =>
    emitEvent(tx, { type: "idea.approved", subjectType: "idea", actorId: u.id, payload: {}, rationale: "reached the gate" }),
  );
}

test("generateDigest composes, records digest.generated, and advances the watermark", async () => {
  const { db, close } = await createTestDb();
  try {
    await seedProjectWithActivity(db);
    const fakeCompose = async () => ({ ok: true as const, text: "Alice approved an idea." });

    const res = await generateDigest(db, { compose: fakeCompose });
    assert.equal(res.generated, true);
    assert.equal(res.generated && res.text, "Alice approved an idea.");

    const gen = await db.select().from(events).where(eq(events.type, "digest.generated"));
    assert.equal(gen.length, 1);
    assert.equal((gen[0].payload as { event_count: number }).event_count, 1);

    // nothing new now → no second record (watermark advanced)
    const again = await generateDigest(db, { compose: fakeCompose });
    assert.equal(again.generated, false);
    assert.equal((await db.select().from(events).where(eq(events.type, "digest.generated"))).length, 1);
  } finally {
    await close();
  }
});

test("generateDigest records nothing on an empty window", async () => {
  const { db, close } = await createTestDb();
  try {
    await db.insert(project).values({ repoFullName: "acme/repo", defaultBranch: "main", installationId: 1, localClonePath: "/x" });
    const res = await generateDigest(db, { compose: async () => ({ ok: true as const, text: "x" }) });
    assert.equal(res.generated, false);
    assert.match(res.reason ?? "", /nothing new/i);
    assert.equal((await db.select().from(events).where(eq(events.type, "digest.generated"))).length, 0);
  } finally {
    await close();
  }
});

test("generateDigest records nothing on compose failure", async () => {
  const { db, close } = await createTestDb();
  try {
    await seedProjectWithActivity(db);
    const res = await generateDigest(db, { compose: async () => ({ ok: false as const, failure: "API error" }) });
    assert.equal(res.generated, false);
    assert.equal((await db.select().from(events).where(eq(events.type, "digest.generated"))).length, 0);
  } finally {
    await close();
  }
});
```

- [ ] **Step 3: Run the test, verify it fails.**

Run: `npx tsx --test src/digest/send.test.ts`
Expected: FAIL — `generateDigest` is not exported / `sendDigest` still present.

- [ ] **Step 4: Rewrite `src/digest/send.ts`.** Replace the entire file:

```ts
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { events, project } from "../db/schema";
import { emitEvent } from "../db/events";
import { listActivity } from "../events/feed";
import { composeDigest, type ComposeFn } from "./compose";

export type GenerateResult =
  | { generated: true; eventCount: number; text: string }
  | { generated: false; reason?: string; failure?: string };

/**
 * Generate the in-app digest (REQ-026): summarise the decisions since the last
 * digest and record digest.generated (the watermark for "since last digest").
 * In-app only — there is no outbound delivery. Compose is injectable so tests and
 * dry-runs never touch the API. Records nothing if no project is bound or nothing
 * new has happened.
 */
export async function generateDigest(db: Db, opts: { compose?: ComposeFn } = {}): Promise<GenerateResult> {
  const compose = opts.compose ?? composeDigest;

  const [proj] = await db.select().from(project).limit(1);
  if (!proj) return { generated: false, reason: "no project bound" };

  const [last] = await db
    .select({ at: events.createdAt })
    .from(events)
    .where(eq(events.type, "digest.generated"))
    .orderBy(desc(events.createdAt))
    .limit(1);
  const since = last?.at ?? null;

  const fresh = (await listActivity(db, 500)).filter((it) => !since || it.createdAt > since);
  if (fresh.length === 0) return { generated: false, reason: "nothing new since the last digest" };

  // chronological digest text, with the why woven in
  const eventDigest = fresh
    .slice()
    .reverse()
    .map((it) => {
      const who = it.actor ?? "system";
      const subject = it.subject ? ` ${it.subject}` : "";
      const why = it.why ? ` — ${it.why}` : "";
      return `- ${who} ${it.verb}${subject}${why}`;
    })
    .join("\n");

  const composed = await compose({ eventDigest, since: since ? since.toISOString() : null });
  if (!composed.ok) return { generated: false, failure: composed.failure };

  await db.transaction(async (tx) => {
    await emitEvent(tx, {
      type: "digest.generated",
      subjectType: "project",
      subjectId: proj.id,
      payload: { text: composed.text, event_count: fresh.length, since: since ? since.toISOString() : null },
    });
  });

  return { generated: true, eventCount: fresh.length, text: composed.text };
}
```

(This removes `scheduleToDays`, `dueForDigest`, `httpPost`, `PostFn`, `sendDigest`, and `sendDigestIfDue`.)

- [ ] **Step 5: Run the test, verify it passes.**

Run: `npx tsx --test src/digest/send.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Rewrite `src/digest/queries.test.ts` (failing).** Replace the entire file:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { events } from "../db/schema";
import { digestSummary, recentDigests } from "./queries";

test("digestSummary returns zero/null with no digest events", async () => {
  const { db, close } = await createTestDb();
  try {
    assert.deepEqual(await digestSummary(db), { count: 0, lastGeneratedAt: null });
  } finally {
    await close();
  }
});

test("digestSummary counts digest.generated and reports the latest; recentDigests is newest-first", async () => {
  const { db, close } = await createTestDb();
  try {
    await db.insert(events).values([
      { type: "digest.generated", subjectType: "project", payload: { text: "older", event_count: 2 }, createdAt: new Date(1000) },
      { type: "digest.generated", subjectType: "project", payload: { text: "newer", event_count: 5 }, createdAt: new Date(3000) },
      { type: "idea.submitted", subjectType: "idea", payload: {}, rationale: "x", createdAt: new Date(2000) },
    ]);
    const s = await digestSummary(db);
    assert.equal(s.count, 2);
    assert.equal(s.lastGeneratedAt?.getTime(), 3000);

    const recent = await recentDigests(db, 10);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].text, "newer");
    assert.equal(recent[0].eventCount, 5);
    assert.equal(recent[1].text, "older");
  } finally {
    await close();
  }
});
```

- [ ] **Step 7: Run, verify it fails.**

Run: `npx tsx --test src/digest/queries.test.ts`
Expected: FAIL — `recentDigests` not exported / `lastGeneratedAt` missing.

- [ ] **Step 8: Rewrite `src/digest/queries.ts`.** Replace the entire file:

```ts
import { eq, desc } from "drizzle-orm";
import type { Db } from "../db/client";
import { events } from "../db/schema";

export interface DigestSummary {
  count: number;
  lastGeneratedAt: Date | null;
}

// Cheap proxy for the Digest card: how many digests exist and when the last was
// generated. No LLM (composeDigest is the LLM path; the dashboard never calls it).
export async function digestSummary(db: Db): Promise<DigestSummary> {
  const rows = await db
    .select({ at: events.createdAt })
    .from(events)
    .where(eq(events.type, "digest.generated"))
    .orderBy(desc(events.createdAt));
  return { count: rows.length, lastGeneratedAt: rows[0]?.at ?? null };
}

export interface DigestEntry {
  at: Date;
  eventCount: number;
  text: string | null;
}

// The most recent generated digests, newest first — for the Digest page.
export async function recentDigests(db: Db, limit = 10): Promise<DigestEntry[]> {
  const rows = await db
    .select({ at: events.createdAt, payload: events.payload })
    .from(events)
    .where(eq(events.type, "digest.generated"))
    .orderBy(desc(events.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const p = r.payload as { text?: string; event_count?: number };
    return { at: r.at, eventCount: p.event_count ?? 0, text: p.text ?? null };
  });
}
```

- [ ] **Step 9: Run, verify it passes.**

Run: `npx tsx --test src/digest/queries.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Reword `src/digest/compose.ts` (copy only).** Change the schema description, `SYSTEM`, and JSDoc from "outbound … team's channel" to in-app. Set the `summary` `.describe(...)` to:

```ts
        "A brief in-app digest, 2–4 plain sentences. No greeting, sign-off, or markdown headings. Grounded strictly in the events.",
```

and `SYSTEM` to:

```ts
const SYSTEM = `You write a short in-app digest of a project's recent decisions for the team to read on the board. Summarise what happened and why in 2–4 plain sentences, grounded strictly in the events given — do not invent work, names, or numbers. No greeting, no sign-off, no markdown headings; just the prose.`;
```

Update the JSDoc first line to "Compose the prose digest (REQ-026) from the recent events. In-app …". Leave model (`claude-opus-4-8`) and logic unchanged.

- [ ] **Step 11: Remove the digest job from the worker.** In `src/worker/index.ts`, delete the import line `import { sendDigestIfDue } from "../digest/send";` (line 9) and the entire digest block at the end of `tick()`:

```ts
  // Send the outbound digest if one is due (REQ-026). No-op unless the project
  // has a webhook URL and a schedule configured.
  try {
    const d = await sendDigestIfDue(db);
    if (d.sent) console.error(`[worker] digest sent (${d.eventCount} decisions)`);
  } catch (e) {
    console.error("[worker] digest skipped:", e instanceof Error ? e.message : e);
  }
```

- [ ] **Step 12: Rewrite `src/cli/digest.ts`.** Replace the entire file:

```ts
import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";
import { createDb } from "../db/client";
import { generateDigest } from "../digest/send";

// Generate the in-app digest (REQ-026): compose a summary of the decisions since
// the last digest and record digest.generated. The Digest page shows the result.
//   npm run digest
async function main(): Promise<void> {
  loadDotenv();
  const { db, close } = createDb();
  try {
    const r = await generateDigest(db);
    if (r.generated) console.error(`[digest] generated (${r.eventCount} decisions)\n\n${r.text}`);
    else console.error(`[digest] nothing recorded: ${r.reason ?? r.failure}`);
  } finally {
    await close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[digest] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
```

- [ ] **Step 13: Drop the schema columns.** In `src/db/schema.ts`, delete these two lines from the `project` table (lines 44–45):

```ts
  digestWebhookUrl: text("digest_webhook_url"),
  digestSchedule: text("digest_schedule"),
```

- [ ] **Step 14: Generate the migration.** Run `npm run db:generate` (drizzle-kit diffs the schema and writes `drizzle/00NN_*.sql` + updates `drizzle/meta/`). Verify the generated `.sql` contains exactly:

```sql
ALTER TABLE "project" DROP COLUMN "digest_webhook_url";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "digest_schedule";
```

If `db:generate` is unavailable, hand-create `drizzle/0003_drop_digest_columns.sql` with those two `ALTER TABLE … DROP COLUMN` statements. `schemaSql()` globs `drizzle/*.sql` sorted, so the file alone makes the test DB (and fresh provisions) reflect the drop.

- [ ] **Step 15: Run the full suite + typecheck.**

Run: `npm run typecheck && npm test`
Expected: PASS. (No test still seeds `digestWebhookUrl`/`digestSchedule` — only `send.test.ts` did, rewritten in Step 2.)

- [ ] **Step 16: Commit the backend.**

```bash
git add src/db/events.ts src/digest/send.ts src/digest/send.test.ts src/digest/queries.ts src/digest/queries.test.ts src/digest/compose.ts src/worker/index.ts src/cli/digest.ts src/db/schema.ts drizzle/
git commit -m "[TASK-042] digest is on-demand in-app; rename digest.sent -> digest.generated, drop webhook/schedule (REQ-026)"
```

- [ ] **Step 17: Rewrite the panel.** Replace the entire contents of `src/app/(app)/digest/digest-panel.tsx`:

```tsx
import { getDb } from "@/db/client";
import { recentDigests } from "@/digest/queries";
import { Card, Empty, buttonClass } from "@/components/ui";
import { generate } from "./actions";

export async function DigestPanel() {
  const db = getDb();
  const digests = await recentDigests(db, 10);
  const [latest, ...older] = digests;

  return (
    <>
      <form action={generate} className="mb-6">
        <button type="submit" className={buttonClass("primary")}>
          Generate digest
        </button>
      </form>

      <h2 className="font-mono mb-3 text-[11px] uppercase tracking-[0.18em] text-graphite">Latest digest</h2>
      {latest ? (
        <Card className="p-5">
          <div className="font-mono text-xs text-graphite">
            generated {new Date(latest.at).toLocaleString()} · {latest.eventCount} decisions
          </div>
          <p className="font-serif mt-3 max-w-prose text-[15px] leading-[1.7] text-ink">{latest.text}</p>
        </Card>
      ) : (
        <Empty title="No digest yet.">Generate one to summarise what has moved since the project began.</Empty>
      )}

      {older.length > 0 && (
        <>
          <h2 className="font-mono mb-3 mt-8 text-[11px] uppercase tracking-[0.18em] text-graphite">Earlier digests</h2>
          <div className="grid gap-3">
            {older.map((d) => (
              <Card key={d.at.toISOString()} className="p-4">
                <div className="font-mono text-xs text-graphite">
                  {new Date(d.at).toLocaleString()} · {d.eventCount} decisions
                </div>
                <p className="font-serif mt-2 max-w-prose text-[14px] leading-[1.7] text-ink">{d.text}</p>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
```

(Both `digest/page.tsx` and `@drawer/(.)digest/page.tsx` render `DigestPanel`, so this covers both surfaces.)

- [ ] **Step 18: Rewrite the action.** Replace the entire contents of `src/app/(app)/digest/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { generateDigest } from "@/digest/send";

export async function generate() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await generateDigest(getDb());
  revalidatePath("/digest");
  revalidatePath("/dashboard");
}
```

- [ ] **Step 19: Reword the page header.** In `src/app/(app)/digest/page.tsx`, replace the `PageHeader` props:

```tsx
      <PageHeader
        eyebrow="Surface"
        title="Digest"
        lede="An on-demand summary of what has moved since the last digest — generated on request and read here. No outbound delivery."
      />
```

- [ ] **Step 20: Fix the dashboard rail card.** In `src/app/(app)/dashboard/page.tsx`, replace the digest `RailCard` body (line ~209):

```tsx
            <span className="text-[13px] text-graphite">{digest.lastGeneratedAt ? `Last generated ${ago(digest.lastGeneratedAt)}` : "Never generated"} · {digest.count} generated</span>
```

- [ ] **Step 21: Typecheck + build.**

Run: `npm run typecheck && npm run build`
Expected: PASS (no references to `sendNow`, `lastSentAt`, `digestWebhookUrl`, `digestSchedule`, or `digest.sent` remain — grep to confirm).

- [ ] **Step 22: Commit the UI.**

```bash
git add "src/app/(app)/digest/digest-panel.tsx" "src/app/(app)/digest/actions.ts" "src/app/(app)/digest/page.tsx" "src/app/(app)/dashboard/page.tsx"
git commit -m "[TASK-042] Digest page: generate + latest + history, drop webhook UI (REQ-026)"
```

- [ ] **Step 23: OPERATIONAL — drop the columns on the live DB (cleanup).** Drizzle's `select()` emits an explicit column list, so an existing live DB with the two extra columns will NOT break the app — this is tidiness, safe to run at deploy:

```sql
ALTER TABLE project DROP COLUMN IF EXISTS digest_webhook_url;
ALTER TABLE project DROP COLUMN IF EXISTS digest_schedule;
```

Also confirm there are no stray legacy events (the rename assumes none): `SELECT count(*) FROM events WHERE type = 'digest.sent';` — expected `0`. If non-zero, they simply won't appear in the new history; do not mutate them (append-only).

---

## Self-Review

**Spec coverage:**
- "In-app, not outbound" → TASK B Steps 4, 17–19 (no `post`, panel reads stored events).
- "On-demand only; no schedule/worker/config" → Step 4 (no schedule helpers), Step 11 (worker), Steps 13–14 (columns dropped).
- "Drop both columns" → Steps 13–14, 23.
- "Rename digest.sent → digest.generated" → Steps 1, 4, 8.
- "Re-materialize, accept thin SPEC.md" → TASK A Step 12.
- "requirement.amended primitive (REQ-003 gap)" → TASK A Steps 1–5.
- "amended REQ-026 description, self-contained Accept" → Step 11 `$desc`.
- "CLAUDE.md anti-goal edit" → Step 10.
- "history of past digests" → `recentDigests` (Step 8) + panel (Step 17).
- Truth-model: every state write pairs an `emitEvent` in-tx (amend Step 4, generate Step 4); `requirement.amended` carries rationale (RATIONALE_REQUIRED, Step 1).

**Placeholder scan:** none — every code step shows complete code; the only deferrals are clearly-marked OPERATIONAL steps with exact commands.

**Type consistency:** `generateDigest` return shape (`{ generated, eventCount, text }` / `{ generated, reason?, failure? }`) is used identically in `send.test.ts`, `cli/digest.ts`, and `actions.ts`. `digestSummary` returns `lastGeneratedAt` (queries.ts, dashboard, queries.test.ts all agree). `recentDigests` returns `{ at, eventCount, text }` (queries.ts + panel + test agree). `amendRequirement` signature matches its test and CLI.
