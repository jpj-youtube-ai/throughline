# Overview Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/dashboard` home — a comprehensive grid mirroring all 13 sidebar areas, each card showing a headline stat plus a tiny preview — and make it the post-sign-in landing page.

**Architecture:** A read-only server component (`force-dynamic`) fetches every card's data in one `Promise.all` over existing query functions, then renders four group sections of cards. Three LLM-backed areas (Digest, Reconcile, Why-quality) get cheap, no-LLM proxy queries so the page never fires the model on load. The dashboard emits no events and writes no state — it is a pure projection. Per-card numbers come from small pure summarizer functions that are unit-tested; the page is thin declarative composition.

**Tech Stack:** Next.js 16 App Router (React 19, server components), Drizzle + Postgres (pglite in tests), Tailwind v4, Node's built-in test runner via `tsx --test`.

## Global Constraints

Copied verbatim from CLAUDE.md / SPEC.md — every task's requirements implicitly include these:

- **TypeScript throughout. No `any` in domain code** (events, tasks, requirements).
- **Append-only events:** no code path updates or deletes `events`. Every state change writes its event in the *same DB transaction* via the single `emitEvent(tx, …)` helper. This dashboard changes no state, so it correctly emits **no events**.
- **`tasks.github_status` is read-only locally** — only the webhook writes it. This plan adds no writer.
- **Anthropic Sonnet/Opus only, never Haiku.** This plan makes **no** LLM calls (the three LLM-backed cards use cheap proxies).
- **Sole auth is GitHub via Auth.js.** Do not add a second auth method.
- **Branches:** `task-<key>-<slug>`. **PR title + squash message start with `[TASK-NNN]`.** This work ships as **`[TASK-030] Overview dashboard (REQ-028)`** on branch `task-030-dashboard-home`.
- **Every task implements exactly its linked REQ.** This work implements **REQ-028**, declared in Task 1 (it maps to none of the original 27 — see Task 1).
- New `*.test.ts` files **must be appended to the `test` script list in `package.json`** (it is an explicit file list, not a glob).

## Requirement linkage (resolved)

The dashboard maps to no existing requirement. Per the user's decision we **declare REQ-028 "Overview dashboard" up front** (Task 1) and build against it.

**Provenance note (needs a nod, not a blocker):** the `provenance` enum is `imported | voted | drift` — there is no "manually declared" value. REQ-028 was not genesis-imported and did not pass the board vote, so we use **`drift`** (the enum value already used in `src/drift/flag.ts` for "a requirement declared to cover work outside the planned spec"), with the *why* recorded as the `requirement.declared` event's rationale. If you'd rather add a new enum value or use `voted`, say so before running Task 1's operator steps.

**Known limitation (out of scope):** REQ-028's status auto-advances only from linked **task rows** (`reconcileRequirementStatus`). We are not minting a `tasks` row / GitHub issue for TASK-030 (that is the generation/claiming path), so REQ-028 will display as `planned` in the Spec card until a task row exists and merges. Surfaced as a follow-up; do not silently work around it.

---

## File Structure

**New:**
- `src/requirements/declare.ts` — `declareRequirement(db, input)`: mint the next `REQ-NNN`, insert the row, emit `requirement.declared`, all in one transaction.
- `src/requirements/declare.test.ts`
- `src/cli/declare-req.ts` — thin CLI wrapper to declare a requirement against the real DB.
- `src/digest/queries.ts` — `digestSummary(db)`: cheap proxy (count + last-sent) over `digest.sent` events.
- `src/digest/queries.test.ts`
- `src/quality/queries.ts` — `countRationales(db)`: cheap proxy (count of events carrying a why).
- `src/quality/queries.test.ts`
- `src/components/sparkline.ts` — pure `sparklinePath(values, w, h)`.
- `src/components/sparkline.tsx` — `Sparkline` component.
- `src/components/sparkline.test.ts`
- `src/dashboard/summarize.ts` — pure card summarizers (`eventsSince`, `taskBreakdown`, `topTasks`, `reqBreakdown`, `pct`).
- `src/dashboard/summarize.test.ts`
- `src/components/dashboard-card.tsx` — `DashboardCard` presentational shell.
- `src/app/(app)/dashboard/page.tsx` — the page.

**Modified:**
- `src/integrity/reconcile.ts` — add `structuralReconciliationForProject(db)` (cheap, no-LLM).
- `src/components/icons.tsx` — add `DashboardIcon`.
- `src/components/nav-rail.tsx` — pinned Dashboard link at top.
- `src/app/page.tsx` — landing redirect + `signIn` `redirectTo` → `/dashboard`.
- `package.json` — append the four new test files.

> **Note on placement:** the spec suggested putting `DashboardCard`/`Sparkline` in `ui.tsx`. They live in their own files instead to keep `ui.tsx` focused on generic primitives. The pure `sparklinePath` is split from the `.tsx` component so it can be unit-tested without JSX.

---

## Task 1: Declare REQ-028

**Files:**
- Create: `src/requirements/declare.ts`
- Test: `src/requirements/declare.test.ts`
- Create: `src/cli/declare-req.ts`
- Modify: `package.json` (append the new test file)

**Interfaces:**
- Consumes: `emitEvent` from `src/db/events.ts`; `requirements` from `src/db/schema.ts`; `Db` from `src/db/client.ts`.
- Produces: `declareRequirement(db: Db, input: DeclareRequirementInput): Promise<{ id: string; key: string }>` where
  `DeclareRequirementInput = { title: string; description?: string; provenance: "imported" | "voted" | "drift"; why?: string | null; actorId?: string | null; originIdeaId?: string | null }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/requirements/declare.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { requirements, events } from "../db/schema";
import { eq } from "drizzle-orm";
import { declareRequirement } from "./declare";

test("declareRequirement mints REQ-001 on an empty table and emits requirement.declared", async () => {
  const { db, close } = await createTestDb();
  try {
    const r = await declareRequirement(db, { title: "Overview dashboard", description: "d", provenance: "drift", why: "because" });
    assert.equal(r.key, "REQ-001");

    const [row] = await db.select().from(requirements).where(eq(requirements.id, r.id));
    assert.equal(row.key, "REQ-001");
    assert.equal(row.provenance, "drift");
    assert.equal(row.status, "planned");

    const evs = await db.select().from(events).where(eq(events.subjectId, r.id));
    assert.equal(evs.length, 1);
    assert.equal(evs[0].type, "requirement.declared");
    assert.equal(evs[0].rationale, "because");
  } finally {
    await close();
  }
});

test("declareRequirement uses max existing number + 1, not the count", async () => {
  const { db, close } = await createTestDb();
  try {
    await db.insert(requirements).values([
      { key: "REQ-001", title: "a", description: "", provenance: "imported" },
      { key: "REQ-005", title: "b", description: "", provenance: "imported" }, // gap
    ]);
    const r = await declareRequirement(db, { title: "next", provenance: "drift" });
    assert.equal(r.key, "REQ-006");
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Add the test file to `package.json` and run it to verify it fails**

In `package.json`, append ` src/requirements/declare.test.ts` to the end of the `test` script string (before the closing quote).

Run: `npm test`
Expected: FAIL — `Cannot find module './declare'` (or "declareRequirement is not a function").

- [ ] **Step 3: Write the implementation**

```ts
// src/requirements/declare.ts
import type { Db } from "../db/client";
import { requirements } from "../db/schema";
import { emitEvent } from "../db/events";

export type Provenance = "imported" | "voted" | "drift";

export interface DeclareRequirementInput {
  title: string;
  description?: string;
  provenance: Provenance;
  why?: string | null; // recorded as the requirement.declared rationale
  actorId?: string | null;
  originIdeaId?: string | null;
}

/**
 * Declare a new requirement: mint the next monotonic REQ-NNN, insert the row
 * (status=planned), and emit requirement.declared — all in one transaction.
 * The key is max(existing number)+1 so gaps never collide.
 */
export async function declareRequirement(db: Db, input: DeclareRequirementInput): Promise<{ id: string; key: string }> {
  return db.transaction(async (tx) => {
    const existing = await tx.select({ key: requirements.key }).from(requirements);
    let max = 0;
    for (const r of existing) {
      const m = /-(\d+)$/.exec(r.key);
      if (m) max = Math.max(max, Number(m[1]));
    }
    const key = `REQ-${String(max + 1).padStart(3, "0")}`;
    const [row] = await tx
      .insert(requirements)
      .values({
        key,
        title: input.title,
        description: input.description ?? "",
        status: "planned",
        provenance: input.provenance,
        originIdeaId: input.originIdeaId ?? null,
      })
      .returning({ id: requirements.id });
    await emitEvent(tx, {
      type: "requirement.declared",
      subjectType: "requirement",
      subjectId: row.id,
      actorId: input.actorId ?? null,
      payload: { provenance: input.provenance, key, origin_idea_id: input.originIdeaId ?? null },
      rationale: input.why ?? null,
    });
    return { id: row.id, key };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (both `declareRequirement` tests; the rest of the suite still green).

- [ ] **Step 5: Write the CLI**

```ts
// src/cli/declare-req.ts
import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";
import { createDb } from "../db/client";
import { declareRequirement, type Provenance } from "../requirements/declare";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadDotenv();
  const title = arg("title");
  if (!title) throw new Error("Usage: declare-req --title <t> [--description <d>] [--provenance imported|voted|drift] [--why <w>]");
  const provenance = (arg("provenance") ?? "drift") as Provenance;
  const { db, close } = createDb();
  try {
    const r = await declareRequirement(db, {
      title,
      description: arg("description") ?? "",
      provenance,
      why: arg("why") ?? null,
    });
    console.error(`[declare-req] declared ${r.key} (${provenance})`);
  } finally {
    await close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[declare-req] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
```

- [ ] **Step 6: Typecheck and commit the code**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/requirements/declare.ts src/requirements/declare.test.ts src/cli/declare-req.ts package.json
git commit -m "[TASK-030] declareRequirement helper + CLI (REQ-028)"
```

- [ ] **Step 7: OPERATOR STEP — declare REQ-028 against the real DB, then materialize**

> These two commands mutate live state: they insert REQ-028 into the database and (via materialize, REQ-012) commit a regenerated `SPEC.md` to the bound repo through the GitHub App. Run them yourself (or have the user run them). Do **not** run them in a throwaway/test DB.

```bash
npx tsx src/cli/declare-req.ts --title "Overview dashboard" \
  --description "A single home view mirroring all board areas — one card per area with a headline stat and a small preview, deep-linking into the full pages. Read-only projection; emits no events." \
  --provenance drift \
  --why "The 13 views were only reachable as separate tabs; a home dashboard gives the whole project at a glance and a daily entry point."
npm run materialize
```

Expected: `[declare-req] declared REQ-028 (drift)` then `[materialize] N requirements → spec committed (…)` with N including REQ-028. Confirm `SPEC.md` now contains a `REQ-028` heading.

---

## Task 2: Digest summary (cheap proxy)

**Files:**
- Create: `src/digest/queries.ts`
- Test: `src/digest/queries.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `events` from schema; `Db`.
- Produces: `digestSummary(db: Db): Promise<{ count: number; lastSentAt: Date | null }>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/digest/queries.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { events } from "../db/schema";
import { digestSummary } from "./queries";

test("digestSummary returns zero/null with no digest events", async () => {
  const { db, close } = await createTestDb();
  try {
    const s = await digestSummary(db);
    assert.deepEqual(s, { count: 0, lastSentAt: null });
  } finally {
    await close();
  }
});

test("digestSummary counts digest.sent and reports the latest", async () => {
  const { db, close } = await createTestDb();
  try {
    await db.insert(events).values([
      { type: "digest.sent", subjectType: "project", payload: {}, createdAt: new Date(1000) },
      { type: "digest.sent", subjectType: "project", payload: {}, createdAt: new Date(3000) },
      { type: "idea.submitted", subjectType: "idea", payload: {}, rationale: "x", createdAt: new Date(2000) },
    ]);
    const s = await digestSummary(db);
    assert.equal(s.count, 2);
    assert.equal(s.lastSentAt?.getTime(), 3000);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Append `src/digest/queries.test.ts` to the `package.json` test list and run it**

Run: `npm test`
Expected: FAIL — module `./queries` not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/digest/queries.ts
import { eq, desc } from "drizzle-orm";
import type { Db } from "../db/client";
import { events } from "../db/schema";

export interface DigestSummary {
  count: number;
  lastSentAt: Date | null;
}

// Cheap proxy for the Digest card: how many digests have gone out, and when the
// last one did. No LLM (composeDigest is the LLM path; the dashboard never calls it).
export async function digestSummary(db: Db): Promise<DigestSummary> {
  const rows = await db
    .select({ at: events.createdAt })
    .from(events)
    .where(eq(events.type, "digest.sent"))
    .orderBy(desc(events.createdAt));
  return { count: rows.length, lastSentAt: rows[0]?.at ?? null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/digest/queries.ts src/digest/queries.test.ts package.json
git commit -m "[TASK-030] digestSummary cheap proxy query (REQ-028)"
```

---

## Task 3: Why-quality rationale count (cheap proxy)

**Files:**
- Create: `src/quality/queries.ts`
- Test: `src/quality/queries.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `countRationales(db: Db): Promise<number>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/quality/queries.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { events } from "../db/schema";
import { countRationales } from "./queries";

test("countRationales counts only events carrying a why", async () => {
  const { db, close } = await createTestDb();
  try {
    assert.equal(await countRationales(db), 0);
    await db.insert(events).values([
      { type: "idea.submitted", subjectType: "idea", payload: {}, rationale: "a why" },
      { type: "idea.approved", subjectType: "idea", payload: {}, rationale: "another" },
      { type: "task.claimed", subjectType: "task", payload: {}, rationale: null },
    ]);
    assert.equal(await countRationales(db), 2);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Append `src/quality/queries.test.ts` to the `package.json` test list and run it**

Run: `npm test`
Expected: FAIL — module `./queries` not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/quality/queries.ts
import { isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { events } from "../db/schema";

// Cheap proxy for the Why-quality card: how many decisions carry a recorded why.
// The LLM grader (reviewWhyQuality) stays on-demand on the page; never on load.
export async function countRationales(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`cast(count(*) as integer)` })
    .from(events)
    .where(isNotNull(events.rationale));
  return row?.n ?? 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/quality/queries.ts src/quality/queries.test.ts package.json
git commit -m "[TASK-030] countRationales cheap proxy query (REQ-028)"
```

---

## Task 4: Structural reconciliation for the dashboard (cheap proxy)

**Files:**
- Modify: `src/integrity/reconcile.ts` (add one exported function)
- Test: `src/integrity/reconcile.test.ts` (already in the `package.json` list — no `package.json` change)

**Interfaces:**
- Consumes: existing `reconcileStructural(db, currentSpec)`, `project`, `requirements`, and the already-imported `fs`/`path` in `reconcile.ts`.
- Produces: `structuralReconciliationForProject(db: Db): Promise<{ bound: boolean; specStale: boolean; requirementCount: number }>`.

- [ ] **Step 1: Write the failing test (append to the existing reconcile test file)**

Add to `src/integrity/reconcile.test.ts`:

```ts
import { structuralReconciliationForProject } from "./reconcile";
import { createTestDb } from "../db/client";
import { requirements } from "../db/schema";

test("structuralReconciliationForProject reports unbound when no project exists", async () => {
  const { db, close } = await createTestDb();
  try {
    await db.insert(requirements).values([
      { key: "REQ-001", title: "a", description: "", provenance: "imported" },
      { key: "REQ-002", title: "b", description: "", provenance: "imported" },
    ]);
    const r = await structuralReconciliationForProject(db);
    assert.equal(r.bound, false);
    assert.equal(r.specStale, false);
    assert.equal(r.requirementCount, 2);
  } finally {
    await close();
  }
});
```

> If the existing file already imports `test`/`assert`/`createTestDb`, do not duplicate those imports — add only the missing ones.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `structuralReconciliationForProject` is not exported.

- [ ] **Step 3: Add the implementation to `src/integrity/reconcile.ts`**

Append this exported function (after `reconcileStructural`). `fs`, `path`, `project`, `requirements`, and `Db` are already imported in this file:

```ts
export interface DashboardReconciliation {
  bound: boolean;
  specStale: boolean;
  requirementCount: number;
}

/**
 * The dashboard's cheap reconcile read: structural staleness + requirement count,
 * no LLM. Returns bound:false (and skips the file read) when no repo is bound yet.
 */
export async function structuralReconciliationForProject(db: Db): Promise<DashboardReconciliation> {
  const [proj] = await db.select().from(project).limit(1);
  if (!proj) {
    const reqs = await db.select({ key: requirements.key }).from(requirements);
    return { bound: false, specStale: false, requirementCount: reqs.length };
  }
  const specFile = path.join(proj.localClonePath, proj.specPath);
  const currentSpec = fs.existsSync(specFile) ? fs.readFileSync(specFile, "utf8") : "";
  const s = await reconcileStructural(db, currentSpec);
  return { bound: true, specStale: s.specStale, requirementCount: s.requirementCount };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrity/reconcile.ts src/integrity/reconcile.test.ts
git commit -m "[TASK-030] structuralReconciliationForProject cheap reconcile read (REQ-028)"
```

---

## Task 5: Sparkline

**Files:**
- Create: `src/components/sparkline.ts` (pure)
- Create: `src/components/sparkline.tsx` (component)
- Test: `src/components/sparkline.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `sparklinePath(values: number[], width?: number, height?: number): { path: string; width: number; height: number }`; and `Sparkline({ values, width?, height?, className? })`.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/sparkline.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { sparklinePath } from "./sparkline";

test("sparklinePath draws a centered flat line for an empty series", () => {
  const g = sparklinePath([], 100, 20);
  assert.equal(g.path, "M0,10 L100,10");
});

test("sparklinePath maps min to the bottom and max to the top", () => {
  const g = sparklinePath([0, 1, 2], 96, 24);
  // first point: x=0, value=min(0) -> y=height(24); last: x=96, value=max(2) -> y=0
  assert.ok(g.path.startsWith("M0.00,24.00"));
  assert.ok(g.path.endsWith("96.00,0.00"));
});

test("sparklinePath centers a single point", () => {
  const g = sparklinePath([5], 96, 24);
  assert.equal(g.path, "M48.00,24.00");
});
```

- [ ] **Step 2: Append `src/components/sparkline.test.ts` to the `package.json` test list and run it**

Run: `npm test`
Expected: FAIL — module `./sparkline` not found.

- [ ] **Step 3: Write the pure function**

```ts
// src/components/sparkline.ts
export interface SparklineGeom {
  path: string;
  width: number;
  height: number;
}

// Map a numeric series to an SVG polyline path in a width×height box. Min sits at
// the bottom, max at the top. Empty -> a centered flat line; single point -> a dot
// at the center x. Coordinates are fixed to 2dp for stable, testable output.
export function sparklinePath(values: number[], width = 96, height = 24): SparklineGeom {
  const n = values.length;
  if (n === 0) return { path: `M0,${height / 2} L${width},${height / 2}`, width, height };
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = n === 1 ? width / 2 : (i * width) / (n - 1);
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return { path: `M${pts.join(" L")}`, width, height };
}
```

- [ ] **Step 4: Write the component**

```tsx
// src/components/sparkline.tsx
import { sparklinePath } from "./sparkline";

export function Sparkline({
  values,
  width = 96,
  height = 24,
  className = "",
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const { path } = sparklinePath(values, width, height);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden="true" className={className}>
      <path d={path} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test`
Expected: PASS (all three sparkline tests).
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/sparkline.ts src/components/sparkline.tsx src/components/sparkline.test.ts package.json
git commit -m "[TASK-030] Sparkline component + pure path generator (REQ-028)"
```

---

## Task 6: Card summarizers

**Files:**
- Create: `src/dashboard/summarize.ts`
- Test: `src/dashboard/summarize.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes types: `ActivityItem` (`src/events/feed.ts`), `TaskListItem` (`src/tasks/queries.ts`), `SpecMapRequirement` (`src/spec/map.ts`).
- Produces:
  - `eventsSince(items: ActivityItem[], sinceMs: number): number`
  - `taskBreakdown(tasks: TaskListItem[]): { open: number; claimed: number; merged: number }`
  - `topTasks(tasks: TaskListItem[], n: number): TaskListItem[]`
  - `reqBreakdown(reqs: SpecMapRequirement[]): { planned: number; building: number; shipped: number }`
  - `pct(done: number, scope: number): number`

- [ ] **Step 1: Write the failing test**

```ts
// src/dashboard/summarize.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { TaskListItem } from "../tasks/queries";
import type { ActivityItem } from "../events/feed";
import type { SpecMapRequirement } from "../spec/map";
import { eventsSince, taskBreakdown, topTasks, reqBreakdown, pct } from "./summarize";

function task(p: Partial<TaskListItem> & { key: string }): TaskListItem {
  return {
    id: p.key, key: p.key, title: p.key, requirementKey: "REQ-001", effort: 1, risk: "low",
    confidence: 50, claimState: "unclaimed", claimerLogin: null, branchName: null,
    githubStatus: "open", githubIssueUrl: null, ...p,
  };
}

test("eventsSince counts items at or after the cutoff", () => {
  const items = [
    { createdAt: new Date(5000) },
    { createdAt: new Date(1000) },
  ] as ActivityItem[];
  assert.equal(eventsSince(items, 2000), 1);
});

test("taskBreakdown splits open / claimed / merged", () => {
  const b = taskBreakdown([
    task({ key: "TASK-001" }),
    task({ key: "TASK-002", claimState: "claimed", claimerLogin: "alice" }),
    task({ key: "TASK-003", githubStatus: "closed", claimState: "claimed" }),
  ]);
  assert.deepEqual(b, { open: 1, claimed: 1, merged: 1 });
});

test("topTasks ranks claimed-open first, then open, then merged, newest key within a rank", () => {
  const top = topTasks([
    task({ key: "TASK-001" }),
    task({ key: "TASK-002", githubStatus: "closed" }),
    task({ key: "TASK-003", claimState: "claimed", claimerLogin: "alice" }),
    task({ key: "TASK-004" }),
  ], 2);
  assert.deepEqual(top.map((t) => t.key), ["TASK-003", "TASK-004"]);
});

test("reqBreakdown counts by status", () => {
  const reqs = [
    { status: "shipped" }, { status: "building" }, { status: "planned" }, { status: "planned" },
  ] as SpecMapRequirement[];
  assert.deepEqual(reqBreakdown(reqs), { planned: 2, building: 1, shipped: 1 });
});

test("pct rounds and guards divide-by-zero", () => {
  assert.equal(pct(0, 0), 0);
  assert.equal(pct(17, 27), 63);
});
```

- [ ] **Step 2: Append `src/dashboard/summarize.test.ts` to the `package.json` test list and run it**

Run: `npm test`
Expected: FAIL — module `./summarize` not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/dashboard/summarize.ts
import type { ActivityItem } from "../events/feed";
import type { TaskListItem } from "../tasks/queries";
import type { SpecMapRequirement } from "../spec/map";

export function eventsSince(items: ActivityItem[], sinceMs: number): number {
  return items.filter((it) => it.createdAt.getTime() >= sinceMs).length;
}

export interface TaskBreakdown {
  open: number;
  claimed: number;
  merged: number;
}

export function taskBreakdown(tasks: TaskListItem[]): TaskBreakdown {
  let open = 0;
  let claimed = 0;
  let merged = 0;
  for (const t of tasks) {
    if (t.githubStatus === "closed") merged++;
    else if (t.claimState === "claimed") claimed++;
    else open++;
  }
  return { open, claimed, merged };
}

// claimed-and-open first (rank 0), then unclaimed-open (1), then merged (2);
// within a rank, newest key first.
export function topTasks(tasks: TaskListItem[], n: number): TaskListItem[] {
  const rank = (t: TaskListItem): number =>
    t.githubStatus === "closed" ? 2 : t.claimState === "claimed" ? 0 : 1;
  return [...tasks].sort((a, b) => rank(a) - rank(b) || b.key.localeCompare(a.key)).slice(0, n);
}

export interface ReqBreakdown {
  planned: number;
  building: number;
  shipped: number;
}

export function reqBreakdown(reqs: SpecMapRequirement[]): ReqBreakdown {
  let planned = 0;
  let building = 0;
  let shipped = 0;
  for (const r of reqs) {
    if (r.status === "shipped") shipped++;
    else if (r.status === "building") building++;
    else planned++;
  }
  return { planned, building, shipped };
}

export function pct(done: number, scope: number): number {
  return scope === 0 ? 0 : Math.round((100 * done) / scope);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (all summarize tests).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/summarize.ts src/dashboard/summarize.test.ts package.json
git commit -m "[TASK-030] dashboard card summarizers (REQ-028)"
```

---

## Task 7: DashboardCard shell + DashboardIcon

**Files:**
- Create: `src/components/dashboard-card.tsx`
- Modify: `src/components/icons.tsx` (add `DashboardIcon`)

**Interfaces:**
- Consumes: `ArrowIcon` from `src/components/icons.tsx`.
- Produces: `DashboardCard({ href: string; Icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; stat: ReactNode; children?: ReactNode })`; `DashboardIcon(props: SVGProps<SVGSVGElement>)`.

> Presentational only — no unit test. Verified by `npm run typecheck` here and visually in Task 8/10.

- [ ] **Step 1: Add `DashboardIcon` to `src/components/icons.tsx`**

Append (it reuses the file's local `Svg` helper):

```tsx
export function DashboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.2" />
      <rect x="13" y="4" width="7" height="4.5" rx="1.2" />
      <rect x="13" y="11" width="7" height="9" rx="1.2" />
      <rect x="4" y="13.5" width="7" height="6.5" rx="1.2" />
    </Svg>
  );
}
```

- [ ] **Step 2: Write the DashboardCard component**

```tsx
// src/components/dashboard-card.tsx
import type { ReactNode, SVGProps, ComponentType } from "react";
import Link from "next/link";
import { ArrowIcon } from "./icons";

export function DashboardCard({
  href,
  Icon,
  title,
  stat,
  children,
}: {
  href: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  stat: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-leaf border border-hairline bg-paper-raised p-4 transition-colors hover:bg-paper-sunk"
    >
      <div className="flex items-center gap-2 text-graphite">
        <Icon className="text-spine" />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em]">{title}</span>
        <ArrowIcon className="ml-auto size-4 text-graphite opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="font-display mt-2 text-lg text-ink">{stat}</div>
      {children && <div className="mt-2 text-[13px] text-graphite">{children}</div>}
    </Link>
  );
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/components/dashboard-card.tsx src/components/icons.tsx
git commit -m "[TASK-030] DashboardCard shell + DashboardIcon (REQ-028)"
```

---

## Task 8: The dashboard page

**Files:**
- Create: `src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: every query + summarizer + component from Tasks 2–7, plus existing `listActivity`, `heartbeatSeries`, `getLatestNarrative`, `listVotingIdeas`, `APPROVAL_GATE`, `listTasks`, `listQuickWins`, `listPipeline`, `listSpecMap`, `burnUpSeries`, `listOpenDriftFlags`, and the icons. `getDb` from `@/db/client`.

> Composition over already-tested pieces — verified by typecheck + running the app, not a unit test.

- [ ] **Step 1: Write the page**

```tsx
// src/app/(app)/dashboard/page.tsx
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { listActivity } from "@/events/feed";
import { heartbeatSeries } from "@/metrics/heartbeat";
import { getLatestNarrative } from "@/narrative/queries";
import { digestSummary } from "@/digest/queries";
import { listVotingIdeas } from "@/ideas/queries";
import { APPROVAL_GATE } from "@/ideas/gate";
import { listTasks } from "@/tasks/queries";
import { listQuickWins } from "@/metrics/quickwins";
import { listPipeline } from "@/pipeline/queries";
import { listSpecMap } from "@/spec/map";
import { burnUpSeries } from "@/metrics/burnup";
import { listOpenDriftFlags } from "@/drift/queries";
import { structuralReconciliationForProject } from "@/integrity/reconcile";
import { countRationales } from "@/quality/queries";
import {
  PulseIcon, HeartbeatIcon, NarrativeIcon, DigestIcon, IdeaIcon, TaskIcon,
  QuickWinIcon, PipelineIcon, SpecIcon, ProgressIcon, DriftIcon, ReconcileIcon, WhyQualityIcon,
} from "@/components/icons";
import { PageHeader, Pill } from "@/components/ui";
import { DashboardCard } from "@/components/dashboard-card";
import { Sparkline } from "@/components/sparkline";
import { eventsSince, taskBreakdown, topTasks, reqBreakdown, pct } from "@/dashboard/summarize";

export const dynamic = "force-dynamic";

function ago(d: Date): string {
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function startOfTodayMs(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-mono mb-3 text-[11px] uppercase tracking-[0.18em] text-graphite">{label}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

export default async function DashboardPage() {
  const db = getDb();
  const [activity, heartbeat, narrative, digest, ideas, tasks, quickWins, pipeline, specMap, burnup, drift, reconcile, rationales] =
    await Promise.all([
      listActivity(db, 120),
      heartbeatSeries(db, Date.now(), 14),
      getLatestNarrative(db),
      digestSummary(db),
      listVotingIdeas(db),
      listTasks(db),
      listQuickWins(db),
      listPipeline(db),
      listSpecMap(db),
      burnUpSeries(db),
      listOpenDriftFlags(db),
      structuralReconciliationForProject(db),
      countRationales(db),
    ]);

  const today = eventsSince(activity, startOfTodayMs());
  const tb = taskBreakdown(tasks);
  const topT = topTasks(tasks, 2);
  const rb = reqBreakdown(specMap);
  const topWin = quickWins[0] ?? null;
  const burnPct = pct(burnup.done, burnup.scope);

  return (
    <>
      <PageHeader eyebrow="The whole board" title="Dashboard" lede="Every part of the project, at a glance." />
      <div className="flex flex-col gap-8">
        <Group label="Story">
          <DashboardCard href="/pulse" Icon={PulseIcon} title="Pulse" stat={`${today} ${today === 1 ? "event" : "events"} today`}>
            {activity.length === 0 ? (
              <span>Nothing logged yet.</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {activity.slice(0, 2).map((it) => (
                  <li key={it.seq} className="truncate">
                    <span className="text-ink">{it.actor ?? "system"}</span> {it.verb}{" "}
                    {it.subject && <span className="font-mono text-spine-deep">{it.subject}</span>}
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>

          <DashboardCard href="/heartbeat" Icon={HeartbeatIcon} title="Heartbeat" stat={`active ${heartbeat.activeDays}/${heartbeat.windowDays} days`}>
            <span className="text-spine">
              <Sparkline values={heartbeat.days.map((d) => d.count)} />
            </span>
          </DashboardCard>

          <DashboardCard
            href="/narrative"
            Icon={NarrativeIcon}
            title="Narrative"
            stat={narrative ? `${narrative.content.chapters.length} ${narrative.content.chapters.length === 1 ? "chapter" : "chapters"}` : "not generated"}
          >
            {narrative ? (
              <span className="truncate">
                {narrative.content.chapters[0]?.heading ?? "—"} · {ago(narrative.generatedAt)}
              </span>
            ) : (
              <span>Generate it from the log.</span>
            )}
          </DashboardCard>

          <DashboardCard href="/digest" Icon={DigestIcon} title="Digest" stat={digest.lastSentAt ? `sent ${ago(digest.lastSentAt)}` : "never sent"}>
            <span>{digest.count} {digest.count === 1 ? "digest" : "digests"} sent</span>
          </DashboardCard>
        </Group>

        <Group label="Work">
          <DashboardCard href="/ideas" Icon={IdeaIcon} title="Ideas" stat={`${ideas.length} in voting`}>
            {ideas.length === 0 ? (
              <span>No ideas in voting.</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {ideas.slice(0, 2).map((i) => (
                  <li key={i.id} className="truncate">
                    <span className="text-ink">{i.title}</span> <span className="font-mono">({i.voteCount}/{APPROVAL_GATE})</span>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>

          <DashboardCard href="/tasks" Icon={TaskIcon} title="Tasks" stat={`${tb.open} open · ${tb.claimed} claimed · ${tb.merged} merged`}>
            {tasks.length === 0 ? (
              <span>No tasks yet.</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {topT.map((t) => (
                  <li key={t.key} className="truncate">
                    <span className="font-mono text-spine-deep">{t.key}</span>{" "}
                    <span>{t.claimerLogin ? `claimed by ${t.claimerLogin}` : t.githubStatus === "closed" ? "merged" : "open"}</span>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>

          <DashboardCard href="/quick-wins" Icon={QuickWinIcon} title="Quick wins" stat={topWin ? `top ${topWin.score}/100` : "none open"}>
            {topWin ? (
              <ul className="flex flex-col gap-1">
                {quickWins.slice(0, 2).map((w) => (
                  <li key={w.key} className="truncate">
                    <span className="font-mono text-spine-deep">{w.key}</span> {w.score}/100 <span className="text-graphite">({w.risk} risk)</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span>No open unclaimed tasks.</span>
            )}
          </DashboardCard>

          <DashboardCard href="/pipeline" Icon={PipelineIcon} title="Pipeline" stat={pipeline.map((s) => s.count).join(" → ")}>
            <span className="truncate">{pipeline.map((s) => s.label).join(" · ")}</span>
          </DashboardCard>
        </Group>

        <Group label="Spec">
          <DashboardCard href="/spec" Icon={SpecIcon} title="Spec" stat={`${specMap.length} ${specMap.length === 1 ? "requirement" : "requirements"}`}>
            <span className="flex flex-wrap gap-1.5">
              <Pill tone="shipped">{rb.shipped} shipped</Pill>
              <Pill tone="spine">{rb.building} building</Pill>
              <Pill tone="planned">{rb.planned} planned</Pill>
            </span>
          </DashboardCard>

          <DashboardCard href="/burnup" Icon={ProgressIcon} title="Progress" stat={`${burnup.done}/${burnup.scope} merged · ${burnPct}%`}>
            <span className="text-spine">
              <Sparkline values={burnup.points.map((p) => p.done)} />
            </span>
          </DashboardCard>
        </Group>

        <Group label="Integrity">
          <DashboardCard
            href="/drift"
            Icon={DriftIcon}
            title="Drift"
            stat={drift.length === 0 ? "no drift" : `${drift.length} open ${drift.length === 1 ? "flag" : "flags"}`}
          >
            {drift.length === 0 ? (
              <span>Everything maps to a requirement.</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {drift.slice(0, 2).map((f) => (
                  <li key={f.id} className="truncate">
                    <span className="font-mono text-spine-deep">{f.taskKey}</span> PR #{f.prNumber} · {f.unmappedItems.length} items
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>

          <DashboardCard
            href="/reconcile"
            Icon={ReconcileIcon}
            title="Reconcile"
            stat={!reconcile.bound ? "no repo bound" : reconcile.specStale ? "spec STALE" : "spec fresh"}
          >
            <span>
              {reconcile.requirementCount} requirements{reconcile.bound ? "" : " · bind a repo to check"}
            </span>
          </DashboardCard>

          <DashboardCard
            href="/why-quality"
            Icon={WhyQualityIcon}
            title="Why-quality"
            stat={`${rationales} ${rationales === 1 ? "rationale" : "rationales"} logged`}
          >
            <span>Run the quality review →</span>
          </DashboardCard>
        </Group>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If `narrative.content.chapters` errors, confirm `NarrativeContent` is `{ chapters: { heading: string; prose: string }[] }` from `src/narrative/generate.ts` — it is.)

- [ ] **Step 3: Visually verify the page**

Run: `npm run dev`, sign in, visit `/dashboard`.
Expected: four group sections (Story / Work / Spec / Integrity) with 13 cards total; sparklines render on Heartbeat and Progress; cards link to their pages; empty areas show their quiet states. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "[TASK-030] dashboard page — 13-card grid (REQ-028)"
```

---

## Task 9: Nav link + landing redirect

**Files:**
- Modify: `src/components/nav-rail.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `DashboardIcon` (Task 7).

- [ ] **Step 1: Add the pinned Dashboard link to `nav-rail.tsx`**

Add `DashboardIcon` to the icon import, then render a pinned link before the `GROUPS.map(...)`. Replace the opening of the returned `<nav>`:

```tsx
  return (
    <nav aria-label="Sections" className="flex flex-col gap-5">
      <Link
        href="/dashboard"
        aria-current={pathname === "/dashboard" ? "page" : undefined}
        className={`group flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors duration-150 ${
          pathname === "/dashboard"
            ? "bg-spine-wash font-medium text-spine-deep"
            : "text-graphite hover:bg-paper-sunk hover:text-ink"
        }`}
      >
        <DashboardIcon className={pathname === "/dashboard" ? "text-spine" : "text-graphite group-hover:text-ink"} />
        <span>Dashboard</span>
        {pathname === "/dashboard" && <span className="ml-auto h-4 w-0.5 rounded-full bg-spine" />}
      </Link>
      {GROUPS.map((group) => (
```

And update the import line:

```tsx
import {
  DashboardIcon,
  PulseIcon,
  HeartbeatIcon,
  NarrativeIcon,
  DigestIcon,
  IdeaIcon,
  TaskIcon,
  QuickWinIcon,
  PipelineIcon,
  SpecIcon,
  ProgressIcon,
  DriftIcon,
  ReconcileIcon,
  WhyQualityIcon,
} from "./icons";
```

- [ ] **Step 2: Point the landing at `/dashboard` in `src/app/page.tsx`**

Change the two `/pulse` references:

```tsx
  if (session?.user) redirect("/dashboard");
```

```tsx
            await signIn("github", { redirectTo: "/dashboard" });
```

- [ ] **Step 3: Typecheck + verify navigation**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run dev`; sign in fresh.
Expected: sign-in lands on `/dashboard`; the sidebar shows **Dashboard** pinned at the top with active styling; the four groups and all 13 original pages still work. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/nav-rail.tsx src/app/page.tsx
git commit -m "[TASK-030] dashboard nav link + landing redirect (REQ-028)"
```

---

## Task 10: Full verification + PR

**Files:** none (verification + integration).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — every existing test plus the four new files (`declare`, `digest/queries`, `quality/queries`, `sparkline`, `dashboard/summarize`) and the added `reconcile` case.

- [ ] **Step 2: Typecheck + production build**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run build`
Expected: build succeeds; `/dashboard` appears in the route list.

- [ ] **Step 3: Final manual walkthrough**

Run: `npm run dev`. Confirm: sign-in → `/dashboard`; 13 cards across the four groups; sparklines on Heartbeat + Progress; Digest/Reconcile/Why-quality show cheap proxies (no slow LLM call, page loads fast); every card deep-links correctly; empty states read well. Stop the dev server.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin task-030-dashboard-home
gh pr create --title "[TASK-030] Overview dashboard (REQ-028)" --body "$(cat <<'EOF'
Adds a /dashboard home: a comprehensive grid mirroring all 13 sidebar areas (Story / Work / Spec / Integrity), each card showing a headline stat + a tiny preview. Becomes the post-sign-in landing page.

Read-only projection — emits no events, writes no state. Digest, Reconcile, and Why-quality use cheap, no-LLM proxy queries so the page never fires the model on load.

Implements REQ-028 (declared up front; provenance `drift` — work added outside the original 27).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens with the `[TASK-030]` title (squash-merge will land one clean `[TASK-030]` line on `master`).

---

## Self-Review

**Spec coverage:** routing/landing → Tasks 8–9; comprehensive 13-card grid in 4 groups → Task 8; stat + tiny preview per card → Task 8 (+ summarizers Task 6, sparkline Task 5); cheap proxies for the 3 LLM areas → Tasks 2/3/4; card shell → Task 7; sparklines → Task 5; tests added to the `package.json` list → Tasks 1/2/3/5/6; requirement linkage (REQ-028) → Task 1; read-only/no-events constraint → honored (no `emitEvent` in any dashboard read path; the only `emitEvent` is REQ-028's declaration). No spec section left unimplemented.

**Placeholder scan:** every code/test step contains complete code; every run step has an exact command + expected output. No TBD/TODO.

**Type consistency:** `digestSummary → { count, lastSentAt }`, `countRationales → number`, `structuralReconciliationForProject → { bound, specStale, requirementCount }`, `sparklinePath → { path, width, height }`, summarizer signatures, and `DashboardCard` props are used identically where the page consumes them. `DashboardIcon` is defined in Task 7 before its use in Tasks 8–9. Existing query return shapes (`ActivityItem`, `Heartbeat`, `LatestNarrative`, `VotingIdea`, `TaskListItem`, `QuickWin`, `PipelineStage`, `SpecMapRequirement`, `BurnUp`, `OpenDriftFlag`, `APPROVAL_GATE`) match how the page reads them.
