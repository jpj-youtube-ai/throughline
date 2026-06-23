# Per-project Context Pins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator pin a small set of always-include paths/globs per project so load-bearing modules (event log, `emitEvent`, schema) enter the curated generation slice regardless of the idea's keywords.

**Architecture:** Persist `context_pins` on the `project` row; pass it as `buildSlice`'s already-existing `includes` option (currently hardcoded `[]`), which `buildSlice` prioritizes ahead of anchors and keyword-ranked files. Pins are set from a per-repo editor on `/connect` via a server action that writes the column and emits `project.context_pins_changed` in one transaction.

**Tech Stack:** Next.js App Router (server components + form actions), Postgres + Drizzle, PGlite for tests, `node:test` + `node:assert/strict`.

## Global Constraints

- **TypeScript throughout; no `any` in domain code** (events, tasks, requirements, pins).
- **Every state change emits its event in the same DB transaction as the mutable-table write**, via the single `emitEvent(tx, ...)` helper. Pins changes emit `project.context_pins_changed`.
- **Append-only events:** no code path updates or deletes `events`.
- **`tasks.github_status` is webhook-only** — untouched here.
- **New Drizzle migrations must be applied to the live Postgres by hand** — `db:migrate` is fresh-provision only; tests get the column automatically because `schemaSql()` concatenates all `drizzle/*.sql` files.
- **Dogfood:** this is `TASK-049` → **REQ-008**. Branch `task-049-context-pins`. PR title + squash message start with `[TASK-049]`.
- **New test files must be registered** in the `test` script in `package.json` (the runner takes an explicit file list).

---

### Task 1: Schema column, event type, migration

**Files:**
- Modify: `src/db/schema.ts` (project table)
- Modify: `src/db/events.ts` (EventType union)
- Test: `src/db/multiproject-schema.test.ts` (already registered)
- Generated: `drizzle/0007_*.sql` (via `db:generate`)

**Interfaces:**
- Produces: `project.contextPins` column (`string[]`, default `[]`); event type `"project.context_pins_changed"` (no rationale required).

- [ ] **Step 1: Add the column to the schema**

In `src/db/schema.ts`, add a `contextPins` field to the `project` table (after `conventionVersion`). `jsonb` is already imported.

```ts
  conventionVersion: integer("convention_version").notNull().default(1),
  // Always-include paths/globs for the generation slice (REQ-008). Operator-curated.
  contextPins: jsonb("context_pins").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
```

- [ ] **Step 2: Add the event type**

In `src/db/events.ts`, add the new member to the `EventType` union (after `"project.bound"`). Do **not** add it to `RATIONALE_REQUIRED`.

```ts
  | "project.bound"
  | "project.context_pins_changed"
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `drizzle/0007_<word>.sql` containing `ALTER TABLE "project" ADD COLUMN "context_pins" jsonb DEFAULT '[]'::jsonb NOT NULL;` and a matching `drizzle/meta/0007_snapshot.json`.

- [ ] **Step 4: Write the round-trip test**

Append to `src/db/multiproject-schema.test.ts`:

```ts
test("project.context_pins defaults to empty and round-trips", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db
      .insert(project)
      .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id, contextPins: project.contextPins });
    assert.deepEqual(p.contextPins, []);
    await db.update(project).set({ contextPins: ["src/db/events.ts"] }).where(eq(project.id, p.id));
    const [r] = await db.select({ contextPins: project.contextPins }).from(project).where(eq(project.id, p.id));
    assert.deepEqual(r.contextPins, ["src/db/events.ts"]);
  } finally {
    await close();
  }
});
```

- [ ] **Step 5: Run the test (and typecheck) to verify green**

Run: `npx tsx --test src/db/multiproject-schema.test.ts`
Expected: PASS (all tests in the file, including the new one). The column exists because `schemaSql()` picked up the new migration.

Run: `npm run typecheck`
Expected: no errors.

> Note: this deviates slightly from red-first — a declarative column can't be referenced by a test until it exists. That's expected for schema steps.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/events.ts drizzle/ src/db/multiproject-schema.test.ts
git commit -m "[TASK-049] add project.context_pins column + event type (REQ-008)"
```

> After merge, apply the new migration's `ALTER TABLE` to the live Postgres by hand.

---

### Task 2: `matchPins` + the `buildSlice` force-include contract

**Files:**
- Modify: `src/repoSlice.ts` (add `matchPins` export)
- Create: `src/repoSlice.test.ts`
- Modify: `package.json` (register the new test file)

**Interfaces:**
- Consumes: `buildSlice(opts)` (existing), private `walk`, `isContentEligible`, `matchesGlob` (same module).
- Produces: `matchPins(repoPath: string, pins: string[]): string[]` — the subset of `pins` matching ≥1 content-eligible file.

- [ ] **Step 1: Create the test file with the force-include contract test**

Create `src/repoSlice.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSlice, matchPins } from "./repoSlice";

function tmpRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slice-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

test("buildSlice force-includes a pinned file under a tight budget, omitting a higher-scoring file", () => {
  const dir = tmpRepo({
    "src/relevant.ts": "leaderboard ".repeat(500), // high keyword score, large
    "src/db/events.ts": "// pinned marker\n", // zero keyword score, tiny
  });
  try {
    const slice = buildSlice({
      repoPath: dir,
      excludeAbs: [],
      ideaTitle: "leaderboard",
      ideaWhy: "leaderboard widget",
      includes: ["src/db/events.ts"],
      relevantPaths: [],
      budgetTokens: 100, // fits the tiny pinned file only
    });
    const paths = slice.files.map((f) => f.relPath);
    assert.ok(paths.includes("src/db/events.ts"), "pinned file is force-included");
    assert.ok(!paths.includes("src/relevant.ts"), "higher-scoring file is omitted under budget");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("matchPins returns the pins matching at least one eligible file", () => {
  const dir = tmpRepo({ "src/db/events.ts": "x", "src/app/page.tsx": "y" });
  try {
    const matched = matchPins(dir, ["src/db/events.ts", "src/missing.ts", "src/app/**"]);
    assert.deepEqual(matched.sort(), ["src/app/**", "src/db/events.ts"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Register the test file**

In `package.json`, append ` src/repoSlice.test.ts` to the end of the `"test"` script's file list.

- [ ] **Step 3: Run to verify the force-include test passes and `matchPins` test fails**

Run: `npx tsx --test src/repoSlice.test.ts`
Expected: the `buildSlice` test PASSES (locks existing `includes` behavior); the `matchPins` test FAILS with `matchPins is not a function` / export missing.

- [ ] **Step 4: Implement `matchPins`**

Append to `src/repoSlice.ts` (it has access to the private `walk`, `isContentEligible`, `matchesGlob`):

```ts
/**
 * The subset of `pins` that match at least one content-eligible file in the repo.
 * Mirrors how buildSlice resolves `includes`, so the count shown to the operator
 * reflects what will actually be force-included. Advisory only — a pin that
 * matches nothing is simply ignored by the slice.
 */
export function matchPins(repoPath: string, pins: string[]): string[] {
  if (pins.length === 0) return [];
  const eligible = walk(repoPath, new Set<string>()).filter((rel) => isContentEligible(repoPath, rel));
  return pins.filter((pin) => eligible.some((rel) => matchesGlob(rel, [pin])));
}
```

- [ ] **Step 5: Run to verify both pass**

Run: `npx tsx --test src/repoSlice.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/repoSlice.ts src/repoSlice.test.ts package.json
git commit -m "[TASK-049] matchPins + lock buildSlice includes force-inclusion (REQ-008)"
```

---

### Task 3: `pins.ts` — `normalizePins` + `setContextPins`

**Files:**
- Create: `src/project/pins.ts`
- Create: `src/project/pins.test.ts`
- Modify: `package.json` (register the new test file)

**Interfaces:**
- Consumes: `matchPins` (Task 2), `emitEvent` (`src/db/events.ts`), `project` schema, `Db`.
- Produces:
  - `normalizePins(raw: string | string[]): string[]`
  - `setContextPins(db: Db, input: { projectId: string; pins: string | string[]; actorId?: string | null }): Promise<{ pins: string[]; matched: number; total: number }>`

- [ ] **Step 1: Write the failing tests**

Create `src/project/pins.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { project, events } from "../db/schema";
import { normalizePins, setContextPins } from "./pins";

test("normalizePins trims, drops empties, converts separators, dedupes, preserves order", () => {
  const out = normalizePins("  src/db/events.ts \n\n src\\db\\schema.ts \n src/db/events.ts \n");
  assert.deepEqual(out, ["src/db/events.ts", "src/db/schema.ts"]);
});

test("normalizePins accepts an array too", () => {
  assert.deepEqual(normalizePins(["a.ts", "", "a.ts", "b.ts"]), ["a.ts", "b.ts"]);
});

async function seedProject(db: Awaited<ReturnType<typeof createTestDb>>["db"], clonePath: string) {
  const [p] = await db
    .insert(project)
    .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: clonePath, specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
    .returning({ id: project.id });
  return p.id;
}

test("setContextPins persists normalized pins and emits exactly one event", async () => {
  const { db, close } = await createTestDb();
  try {
    const id = await seedProject(db, "/nonexistent");
    const r = await setContextPins(db, { projectId: id, pins: " src/db/events.ts \n src/db/events.ts ", actorId: null });
    assert.deepEqual(r.pins, ["src/db/events.ts"]);

    const [row] = await db.select({ contextPins: project.contextPins }).from(project).where(eq(project.id, id));
    assert.deepEqual(row.contextPins, ["src/db/events.ts"]);

    const evs = await db.select().from(events).where(eq(events.type, "project.context_pins_changed"));
    assert.equal(evs.length, 1);
    assert.equal((evs[0].payload as { count: number }).count, 1);
    assert.equal(evs[0].subjectId, id);
  } finally {
    await close();
  }
});

test("setContextPins reports how many pins matched the clone", async () => {
  const { db, close } = await createTestDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pins-"));
  fs.mkdirSync(path.join(dir, "src", "db"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/db/events.ts"), "x");
  try {
    const id = await seedProject(db, dir);
    const r = await setContextPins(db, { projectId: id, pins: ["src/db/events.ts", "src/db/missing.ts"], actorId: null });
    assert.equal(r.total, 2);
    assert.equal(r.matched, 1);
  } finally {
    await close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("setContextPins throws on an unknown project", async () => {
  const { db, close } = await createTestDb();
  try {
    await assert.rejects(
      setContextPins(db, { projectId: "00000000-0000-0000-0000-000000000000", pins: [], actorId: null }),
      /not found/i,
    );
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Register the test file**

In `package.json`, append ` src/project/pins.test.ts` to the `"test"` script's file list.

- [ ] **Step 3: Run to verify failure**

Run: `npx tsx --test src/project/pins.test.ts`
Expected: FAIL — `./pins` cannot be found / `setContextPins` not exported.

- [ ] **Step 4: Implement `pins.ts`**

Create `src/project/pins.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { project } from "../db/schema";
import { emitEvent } from "../db/events";
import { matchPins } from "../repoSlice";

/** Clean operator input into a stable pin list: trim, posix separators, drop
 *  empties, dedupe (first occurrence wins). Accepts a textarea string or array. */
export function normalizePins(raw: string | string[]): string[] {
  const items = Array.isArray(raw) ? raw : raw.split(/\r?\n/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const v = item.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export interface SetContextPinsResult {
  pins: string[];
  matched: number;
  total: number;
}

/**
 * Set a project's context pins (REQ-008). Normalizes input, records the pins on
 * the project, and emits `project.context_pins_changed` in the same transaction.
 * Returns advisory match feedback (how many pins resolve to a real file in the
 * clone) — unmatched pins are stored, not rejected; the slice ignores them.
 */
export async function setContextPins(
  db: Db,
  input: { projectId: string; pins: string | string[]; actorId?: string | null },
): Promise<SetContextPinsResult> {
  const pins = normalizePins(input.pins);

  const [proj] = await db
    .select({ id: project.id, localClonePath: project.localClonePath })
    .from(project)
    .where(eq(project.id, input.projectId))
    .limit(1);
  if (!proj) throw new Error(`Project ${input.projectId} not found.`);

  const matched = matchPins(proj.localClonePath, pins).length;

  await db.transaction(async (tx) => {
    await tx.update(project).set({ contextPins: pins }).where(eq(project.id, proj.id));
    await emitEvent(tx, {
      type: "project.context_pins_changed",
      subjectType: "project",
      subjectId: proj.id,
      actorId: input.actorId ?? null,
      payload: { pins, count: pins.length },
      projectId: proj.id,
    });
  });

  return { pins, matched, total: pins.length };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx tsx --test src/project/pins.test.ts`
Expected: PASS (all five tests).

- [ ] **Step 6: Commit**

```bash
git add src/project/pins.ts src/project/pins.test.ts package.json
git commit -m "[TASK-049] setContextPins writes pins + emits event in one tx (REQ-008)"
```

---

### Task 4: Thread pins into generation

**Files:**
- Modify: `src/generation/orchestrate.ts` (both call sites + an injectable slice builder on the requirement path)
- Test: `src/generation/orchestrate-requirement.test.ts` (already registered)

**Interfaces:**
- Consumes: `proj.contextPins` (Task 1), `buildSlice` / `BuildSliceOptions` / `RepoSlice` (`src/repoSlice.ts`).
- Produces: `generateForRequirement(db, reqId, opts?)` gains `opts.buildSlice?: (o: BuildSliceOptions) => RepoSlice` (defaults to the real `buildSlice`); both generators pass `includes: proj.contextPins`.

- [ ] **Step 1: Add the injectable slice builder (no behavior change yet)**

In `src/generation/orchestrate.ts`, import the slice types alongside the existing `buildSlice` import:

```ts
import { buildSlice, type BuildSliceOptions, type RepoSlice } from "../repoSlice";
```

Extend `generateForRequirement`'s `opts` and resolve a builder. Change the signature and add the resolver at the top of the function body:

```ts
export async function generateForRequirement(
  db: Db,
  reqId: string,
  opts?: { generate?: typeof GenerateTasksFn; buildSlice?: (o: BuildSliceOptions) => RepoSlice },
): Promise<GenerateForRequirementResult> {
  const generate = opts?.generate ?? generateTasks;
  const buildSliceFn = opts?.buildSlice ?? buildSlice;
```

Then, in `generateForRequirement` only, replace the `const slice = buildSlice({ ... })` call with `buildSliceFn`, keeping `includes: []` for now:

```ts
  const slice = buildSliceFn({
    repoPath: proj.localClonePath,
    excludeAbs: [specPath, claudePath],
    ideaTitle: req.title,
    ideaWhy: seedWhy,
    includes: [],
    relevantPaths: [],
    budgetTokens: Math.max(0, MAX_CONTEXT_TOKENS - fixed),
  });
```

Run: `npm run typecheck` → no errors. Run: `npx tsx --test src/generation/orchestrate-requirement.test.ts` → still PASS (no behavior change).

- [ ] **Step 2: Write the failing wiring test**

Append to `src/generation/orchestrate-requirement.test.ts`. (`project` and `requirements` are already imported; add `BuildSliceOptions` import at the top: `import type { BuildSliceOptions } from "../repoSlice";`)

```ts
test("generateForRequirement passes the project's context pins as the slice includes", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({
      repoFullName: "o/r", installationId: 1, defaultBranch: "main",
      localClonePath: "/nonexistent", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
      contextPins: ["src/db/events.ts", "src/db/schema.ts"],
    }).returning({ id: project.id });
    const [req] = await db.insert(requirements).values({
      key: "REQ-001", title: "Add a leaderboard", description: "top scorers", provenance: "imported", projectId: p.id,
    }).returning({ id: requirements.id });

    let capturedIncludes: string[] | undefined;
    const recordingSlice = (o: BuildSliceOptions) => {
      capturedIncludes = o.includes;
      return { repoLabel: "r", fileCount: 0, nearEmpty: true, tree: "", treeTruncated: false, files: [], omitted: [] };
    };

    const r = await generateForRequirement(db, req.id, { generate: fakeGenerate, buildSlice: recordingSlice });
    assert.equal(r.ok, true, r.failure);
    assert.deepEqual(capturedIncludes, ["src/db/events.ts", "src/db/schema.ts"]);
  } finally {
    await close();
  }
});
```

Run: `npx tsx --test src/generation/orchestrate-requirement.test.ts`
Expected: the new test FAILS — `capturedIncludes` is `[]`, not the pins.

- [ ] **Step 3: Thread the pins through both generators**

In `generateForRequirement`, change `includes: []` to `includes: proj.contextPins`.

In `generateForApprovedIdea`, change its `buildSlice({ ... })` call's `includes: []` to `includes: proj.contextPins` (this path keeps the direct `buildSlice` import — no injection seam needed).

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx --test src/generation/orchestrate-requirement.test.ts`
Expected: PASS (all tests, including the new wiring test).

- [ ] **Step 5: Commit**

```bash
git add src/generation/orchestrate.ts src/generation/orchestrate-requirement.test.ts
git commit -m "[TASK-049] generation force-includes project context pins (REQ-008)"
```

---

### Task 5: Connect-page pins editor

**Files:**
- Modify: `src/project/list.ts` (add `listProjectsWithPins`)
- Modify: `src/project/list.test.ts` (test the new query — already registered)
- Modify: `src/app/(app)/connect/page.tsx` (editor + `savePins` action + match feedback)

**Interfaces:**
- Consumes: `setContextPins` (Task 3), `matchPins` (Task 2), `project` schema.
- Produces: `listProjectsWithPins(db): Promise<{ id; repoFullName; defaultBranch; localClonePath; contextPins }[]>`.

- [ ] **Step 1: Write the failing query test**

Append to `src/project/list.test.ts`. Add imports at the top of the file:

```ts
import { eq } from "drizzle-orm";
import { project } from "../db/schema";
import { listProjects, listProjectsWithPins } from "./list";
```

(Replace the existing `import { listProjects } from "./list";` line with the combined import above.) Then add:

```ts
test("listProjectsWithPins returns clone path and context pins", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await bindProject(db, { ...BASE, repoFullName: "acme/alpha" });
    await db.update(project).set({ contextPins: ["src/db/events.ts"] }).where(eq(project.id, a.id));
    const [row] = await listProjectsWithPins(db);
    assert.equal(row.repoFullName, "acme/alpha");
    assert.equal(row.localClonePath, "/tmp/clone");
    assert.deepEqual(row.contextPins, ["src/db/events.ts"]);
  } finally {
    await close();
  }
});
```

Run: `npx tsx --test src/project/list.test.ts`
Expected: FAIL — `listProjectsWithPins` is not exported.

- [ ] **Step 2: Implement `listProjectsWithPins`**

Append to `src/project/list.ts`:

```ts
export async function listProjectsWithPins(
  db: Db,
): Promise<{ id: string; repoFullName: string; defaultBranch: string; localClonePath: string; contextPins: string[] }[]> {
  return db
    .select({
      id: project.id,
      repoFullName: project.repoFullName,
      defaultBranch: project.defaultBranch,
      localClonePath: project.localClonePath,
      contextPins: project.contextPins,
    })
    .from(project)
    .orderBy(asc(project.createdAt));
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npx tsx --test src/project/list.test.ts`
Expected: PASS (existing `listProjects` shape test still green — it is untouched; the new test passes).

- [ ] **Step 4: Wire the editor into the Connect page**

In `src/app/(app)/connect/page.tsx`:

Update imports:

```ts
import { listProjects, listProjectsWithPins } from "@/project/list";
import { setContextPins } from "@/project/pins";
import { matchPins } from "@/repoSlice";
import { PageHeader, Card, Pill, buttonClass, fieldClass } from "@/components/ui";
```

(Remove the now-unused `listProjects` import only if nothing else uses it — it is still used for `boundRepoNames`/active checks, so keep it.)

Add a `savePins` server action next to the existing `bind` action:

```ts
async function savePins(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  const db = getDb();
  await setContextPins(db, {
    projectId: String(formData.get("projectId")),
    pins: String(formData.get("pins") ?? ""),
    actorId: session.user.id,
  });
  revalidatePath("/connect");
}
```

Replace `const boundProjects = await listProjects(db);` with:

```ts
  const boundProjects = await listProjectsWithPins(db);
  const matchedCounts: Record<string, number> = {};
  for (const p of boundProjects) {
    matchedCounts[p.id] = p.contextPins.length ? matchPins(p.localClonePath, p.contextPins).length : 0;
  }
```

Inside the bound-projects `<Card>` (after the repo-name/active-pill row, before `</Card>`), add the editor:

```tsx
                    <form action={savePins} className="mt-3 w-full border-t border-hairline pt-3">
                      <input type="hidden" name="projectId" value={p.id} />
                      <label className="block">
                        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
                          Context pins — always in the generation slice (one path or glob per line)
                        </span>
                        <textarea
                          name="pins"
                          rows={3}
                          defaultValue={p.contextPins.join("\n")}
                          placeholder={"src/db/events.ts\nsrc/db/schema.ts\ndrizzle/**"}
                          className={`${fieldClass} font-mono`}
                        />
                      </label>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span className="font-mono text-[11px] text-graphite">
                          {p.contextPins.length === 0
                            ? "No pins — generation uses keyword-ranked files only."
                            : `${matchedCounts[p.id]} of ${p.contextPins.length} paths matched the clone · pins fill the budget first, keep the list small`}
                        </span>
                        <button type="submit" className={buttonClass("quiet")}>Save pins</button>
                      </div>
                    </form>
```

Note: the bound-project `<Card>` currently uses `flex items-center` — wrap its existing top row (`repo link + active pill`) in a `<div className="flex w-full items-center gap-3">` and place the `<form>` as a sibling so the editor sits below, or change the Card to `flex-col`. Keep the existing row markup intact inside the new wrapper.

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: PASS — entire suite, including the new `src/repoSlice.test.ts`, `src/project/pins.test.ts`, and the additions to the schema / list / orchestrate tests.

- [ ] **Step 6: Commit**

```bash
git add src/project/list.ts src/project/list.test.ts "src/app/(app)/connect/page.tsx"
git commit -m "[TASK-049] connect page: per-project context-pins editor (REQ-008)"
```

---

## Self-Review

**Spec coverage:**
- Data model (§1) → Task 1.
- Setting pins / `setContextPins` + event in-tx + advisory match (§2) → Task 3.
- UI on `/connect` (§3) → Task 5.
- Reading into generation via `includes` (§4) → Task 4.
- Truth model: `project.context_pins_changed`, not rationale-required (§5) → Task 1 (type) + Task 3 (emission).
- Tests (§6): `setContextPins` normalization/event/match → Task 3; generation threading → Task 4; `buildSlice` `includes` force-include → Task 2.
- Tradeoff hint (budget) → surfaced in the editor copy (Task 5). Deferred items (arch note, auto-seed, budget cap) → intentionally absent.

**Placeholder scan:** none — every code/test step shows complete content and exact commands.

**Type consistency:** `setContextPins` returns `{ pins, matched, total }` (Task 3) and the connect action ignores the return (Task 5, fine). `matchPins(repoPath, pins): string[]` used identically in Tasks 2/3/5. `listProjectsWithPins` shape matches its consumer in the page. `generateForRequirement`'s new `opts.buildSlice` type `(o: BuildSliceOptions) => RepoSlice` matches the recording fake in the test and the real `buildSlice` signature.

## Dogfood note

One PR per task is the convention, but these five commits all serve **TASK-049 / REQ-008** and are sized for review; they can land as one squash-merged PR titled `[TASK-049] per-project context pins for generation (REQ-008)`, or split if a reviewer prefers. Branch: `task-049-context-pins`.
