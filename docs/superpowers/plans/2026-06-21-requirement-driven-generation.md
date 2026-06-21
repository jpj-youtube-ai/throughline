# Requirement-driven Task Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user generate tasks for an approved/imported **requirement** (not just an approved idea), from a "Generate tasks" button in a per-requirement drawer on the spec map.

**Architecture:** Add a requirement-driven sibling to the existing idea-driven generation: `generateForRequirement` (reuses the `generateTasks` engine, seeds from the requirement) → `persistGenerationForRequirement` (inserts tasks all linked to that requirement, emits `tasks.generated`, advances it `planned → building`). The UI clicks a spec-map cell → an intercepting `/spec/[key]` drawer with the requirement detail + a synchronous, auth-guarded "Generate tasks" action that also opens GitHub issues.

**Tech Stack:** Next.js 16 App Router (React 19 server components + `useActionState`, parallel/intercepting routes), Drizzle/Postgres, Anthropic (Opus, via the existing `generateTasks`), Node `tsx --test` + pglite.

## Global Constraints

- **TypeScript; no `any`** in domain code. Reuse the existing ledger design system — no new theme.
- **Reuse the generation engine** (`generateTasks`, `buildUserMessage`, `buildSlice`, the prompt) — do not reimplement generation. **No partial tasks:** persist only on a complete, validated result.
- **Every state change emits its event in the same transaction via `emitEvent`.** The new writer is `persistGenerationForRequirement` (emits `tasks.generated`).
- **`tasks.github_status` is webhook-only** — issue creation sets `github_issue_number`/`url`, never `github_status`.
- **No LLM on render** — generation runs only from the explicit server action. **The server action is `auth()`-guarded** (server actions are not gated by the layout redirect).
- **Tasks-only:** a requirement-generate produces only tasks, all linked to the target requirement (ignore the model's `requirement_key`/`new_requirements`). It refuses if the requirement already has tasks.
- New `*.test.ts` files **must be appended to the `test` script list in `package.json`**.
- **Commits start with `[TASK-038]`** on branch `task-038-requirement-generation`. Implements **REQ-008** (generation, extended to requirements).
- **Build before typecheck** when adding the intercepting route (Next regenerates parallel-slot types — confirmed in earlier phases).

---

## File Structure

**New**
- `src/generation/persist-helpers.ts` — shared `pad3`, `maxNumber`, `renderBody`.
- `src/generation/persist-requirement.test.ts` — tests for the new persist path.
- `src/generation/orchestrate-requirement.test.ts` — tests for `generateForRequirement` (guards + injected-generator happy path).
- `src/spec/detail.ts` — `getRequirementDetail(db, key)`.
- `src/spec/detail.test.ts`.
- `src/app/(app)/spec/requirement-detail.tsx` — the detail panel (server component).
- `src/app/(app)/spec/spec-generate.tsx` — the "Generate tasks" client button.
- `src/app/(app)/spec/[key]/page.tsx` — full-page fallback.
- `src/app/(app)/spec/[key]/actions.ts` — the generate server action.
- `src/app/(app)/@drawer/(.)spec/[key]/page.tsx` — the intercepted drawer.

**Modified**
- `src/generation/persist.ts` — use the shared helpers; add `persistGenerationForRequirement`.
- `src/generation/orchestrate.ts` — add `generateForRequirement`.
- `src/app/(app)/spec/spec-grid.tsx` — cells become `<Link>` to `/spec/[key]`.

---

## Task 1: Extract shared persist helpers

**Files:** Create `src/generation/persist-helpers.ts`; Modify `src/generation/persist.ts`.

**Interfaces:** Produces `pad3(n: number): string`, `maxNumber(keys: string[]): number`, `renderBody(body: { pointers: string[]; acceptance_check: string }): string`.

> Pure refactor (no behavior change) so both persist paths share these. Covered by the existing `src/generation/persist.test.ts`.

- [ ] **Step 1: Create the helpers module**

```ts
// src/generation/persist-helpers.ts
export const pad3 = (n: number): string => String(n).padStart(3, "0");

export function maxNumber(keys: string[]): number {
  let max = 0;
  for (const k of keys) {
    const m = /-(\d+)$/.exec(k);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

export function renderBody(body: { pointers: string[]; acceptance_check: string }): string {
  const pointers = body.pointers.map((p) => `- ${p}`).join("\n");
  return `**Pointers**\n${pointers}\n\n**Acceptance check:** ${body.acceptance_check}`;
}
```

- [ ] **Step 2: Use them in `persist.ts`**

In `src/generation/persist.ts`, delete the local `pad3`, `maxNumber`, and `renderBody` definitions and add at the top:

```ts
import { pad3, maxNumber, renderBody } from "./persist-helpers";
```

Leave `persistGeneration` otherwise unchanged.

- [ ] **Step 3: Verify no regression**

Run: `npx tsx --test src/generation/persist.test.ts`
Expected: PASS (unchanged behavior).
Run: `npm run typecheck` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/generation/persist-helpers.ts src/generation/persist.ts
git commit -m "[TASK-038] extract shared generation persist helpers (REQ-008)"
```

---

## Task 2: `persistGenerationForRequirement`

**Files:** Modify `src/generation/persist.ts`; Test `src/generation/persist-requirement.test.ts`; Modify `package.json`.

**Interfaces:**
- Consumes: `pad3`/`maxNumber`/`renderBody` (Task 1); `emitEvent`; `reconcileRequirementStatus`; `GenerationOutput`; `Usage` (from `./run`).
- Produces: `persistGenerationForRequirement(db: Db, input: { reqId: string; output: GenerationOutput; model: string; usage: Usage; actorId?: string | null }): Promise<{ taskKeys: string[] }>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/generation/persist-requirement.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { requirements, tasks, events } from "../db/schema";
import { persistGenerationForRequirement } from "./persist";
import type { GenerationOutput } from "../schema";

function output(n: number): GenerationOutput {
  return {
    new_requirements: [],
    tasks: Array.from({ length: n }, (_, i) => ({
      title: `Task ${i + 1}`,
      requirement_key: "REQ-999", // ignored — forced to the target requirement
      body: { pointers: ["src/foo.ts"], acceptance_check: "it works" },
      effort: 2,
      risk: "low" as const,
      confidence: 80,
    })),
  };
}

test("persistGenerationForRequirement links all tasks to the requirement, emits the event, and advances it to building", async () => {
  const { db, close } = await createTestDb();
  try {
    const [r] = await db
      .insert(requirements)
      .values({ key: "REQ-005", title: "Search", description: "d", provenance: "imported" })
      .returning({ id: requirements.id });

    const { taskKeys } = await persistGenerationForRequirement(db, {
      reqId: r.id,
      output: output(2),
      model: "claude-opus-4-8",
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    assert.deepEqual(taskKeys, ["TASK-001", "TASK-002"]);

    const rows = await db.select().from(tasks).where(eq(tasks.requirementId, r.id));
    assert.equal(rows.length, 2);
    assert.ok(rows.every((t) => t.requirementId === r.id)); // forced link
    assert.equal(rows[0].originIdeaId, null); // no idea

    const evs = await db.select().from(events).where(eq(events.subjectId, r.id));
    const gen = evs.find((e) => e.type === "tasks.generated");
    assert.ok(gen, "tasks.generated emitted");
    assert.equal(gen!.subjectType, "requirement");

    const [req] = await db.select({ status: requirements.status }).from(requirements).where(eq(requirements.id, r.id));
    assert.equal(req.status, "building"); // planned -> building

    await assert.rejects(
      () => persistGenerationForRequirement(db, { reqId: r.id, output: output(1), model: "m", usage: null }),
      /already has tasks/,
    );
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Append the test to `package.json` and run it (fails)**

Add ` src/generation/persist-requirement.test.ts` to the `test` script list.
Run: `npx tsx --test src/generation/persist-requirement.test.ts` → FAIL (`persistGenerationForRequirement` not exported).

- [ ] **Step 3: Implement** (append to `src/generation/persist.ts`)

```ts
import type { Usage } from "./run";

export interface PersistForRequirementInput {
  reqId: string;
  output: GenerationOutput;
  model: string;
  usage: Usage;
  actorId?: string | null;
}

/**
 * Persist generation for a single requirement (REQ-008, requirement-driven): mint
 * TASK-NNN for each output task, ALL linked to reqId (the requirement is the unit —
 * the model's requirement_key and new_requirements are ignored), emit one
 * tasks.generated (subject = the requirement), and advance it planned→building —
 * one transaction. Refuses if the requirement already has tasks. No idea involved.
 */
export async function persistGenerationForRequirement(
  db: Db,
  input: PersistForRequirementInput,
): Promise<{ taskKeys: string[] }> {
  return db.transaction(async (tx) => {
    const [req] = await tx
      .select({ id: requirements.id })
      .from(requirements)
      .where(eq(requirements.id, input.reqId))
      .for("update")
      .limit(1);
    if (!req) throw new Error("Requirement not found.");

    const existingForReq = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.requirementId, input.reqId)).limit(1);
    if (existingForReq.length > 0) throw new Error("Requirement already has tasks — refusing to generate.");

    const allTasks = await tx.select({ key: tasks.key }).from(tasks);
    let taskMax = maxNumber(allTasks.map((t) => t.key));

    const taskKeys: string[] = [];
    for (const t of input.output.tasks) {
      const taskKey = `TASK-${pad3(++taskMax)}`;
      await tx.insert(tasks).values({
        key: taskKey,
        title: t.title,
        body: renderBody(t.body),
        requirementId: input.reqId, // forced link — the requirement is the unit
        effort: t.effort,
        risk: t.risk,
        confidence: t.confidence,
      });
      taskKeys.push(taskKey);
    }

    await emitEvent(tx, {
      type: "tasks.generated",
      subjectType: "requirement",
      subjectId: input.reqId,
      actorId: input.actorId ?? null,
      payload: { task_keys: taskKeys, req_keys: [], model: input.model, tokens: input.usage },
    });

    await reconcileRequirementStatus(tx, input.reqId, input.actorId ?? null);

    return { taskKeys };
  });
}
```

(`persist.ts` already imports `eq`, `requirements`, `tasks`, `emitEvent`, `reconcileRequirementStatus`, `Db`, `GenerationOutput` — reuse them; add only the `Usage` import.)

- [ ] **Step 4: Run the test (passes) + typecheck**

Run: `npx tsx --test src/generation/persist-requirement.test.ts` → PASS.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/generation/persist.ts src/generation/persist-requirement.test.ts package.json
git commit -m "[TASK-038] persistGenerationForRequirement (tasks-only, req->building) (REQ-008)"
```

---

## Task 3: `generateForRequirement`

**Files:** Modify `src/generation/orchestrate.ts`; Test `src/generation/orchestrate-requirement.test.ts`; Modify `package.json`.

**Interfaces:**
- Consumes: existing `reqContextFromDb`, `MODEL_ID`, `MAX_CONTEXT_TOKENS`, `buildSlice`, `buildUserMessage`, `SYSTEM_PROMPT`, `estimateTokens`, `generateTasks`, `persistGenerationForRequirement`; `requirements`, `tasks`, `project`.
- Produces: `generateForRequirement(db: Db, reqId: string, opts?: { generate?: typeof generateTasks }): Promise<{ ok: boolean; failure?: string; taskKeys?: string[] }>`.

- [ ] **Step 1: Write the failing test** (guards + injected-generator happy path)

```ts
// src/generation/orchestrate-requirement.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { requirements, tasks, project } from "../db/schema";
import { generateForRequirement } from "./orchestrate";
import type { GenerateTasksResult } from "./run";

const fakeGenerate = async (): Promise<GenerateTasksResult> => ({
  ok: true,
  model: "fake",
  usage: null,
  output: {
    new_requirements: [],
    tasks: [{ title: "Do it", requirement_key: "REQ-001", body: { pointers: ["src/x.ts"], acceptance_check: "ok" }, effort: 1, risk: "low", confidence: 90 }],
  },
});

test("generateForRequirement guards: missing requirement", async () => {
  const { db, close } = await createTestDb();
  try {
    const r = await generateForRequirement(db, "00000000-0000-0000-0000-000000000000");
    assert.equal(r.ok, false);
    assert.match(r.failure ?? "", /requirement not found/i);
  } finally { await close(); }
});

test("generateForRequirement guards: no project bound", async () => {
  const { db, close } = await createTestDb();
  try {
    const [req] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported" }).returning({ id: requirements.id });
    const r = await generateForRequirement(db, req.id, { generate: fakeGenerate });
    assert.equal(r.ok, false);
    assert.match(r.failure ?? "", /no project bound/i);
  } finally { await close(); }
});

test("generateForRequirement happy path with an injected generator persists tasks", async () => {
  const { db, close } = await createTestDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-"));
  fs.writeFileSync(path.join(dir, "SPEC.md"), "# Spec\n");
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Conventions\n");
  try {
    const [req] = await db.insert(requirements).values({ key: "REQ-001", title: "Search", description: "Full-text search", provenance: "imported" }).returning({ id: requirements.id });
    await db.insert(project).values({
      repoFullName: "o/orbit", installationId: 1, defaultBranch: "main",
      localClonePath: dir, specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
    });

    const r = await generateForRequirement(db, req.id, { generate: fakeGenerate });
    assert.equal(r.ok, true);
    assert.deepEqual(r.taskKeys, ["TASK-001"]);

    const rows = await db.select().from(tasks).where(eq(tasks.requirementId, req.id));
    assert.equal(rows.length, 1);

    // already-has-tasks guard on a second run
    const again = await generateForRequirement(db, req.id, { generate: fakeGenerate });
    assert.equal(again.ok, false);
    assert.match(again.failure ?? "", /already has tasks/i);
  } finally {
    await close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

> The `project` insert uses the columns the schema requires (`repoFullName`, `installationId`, `defaultBranch`, `localClonePath`, `specPath`, `claudeMdPath`). If the schema names differ, match them — read `src/db/schema.ts`'s `project` table first.

- [ ] **Step 2: Append the test to `package.json` and run it (fails)**

Add ` src/generation/orchestrate-requirement.test.ts` to the `test` list.
Run: `npx tsx --test src/generation/orchestrate-requirement.test.ts` → FAIL (`generateForRequirement` not exported).

- [ ] **Step 3: Implement** (append to `src/generation/orchestrate.ts`, importing `tasks` and `persistGenerationForRequirement`)

Add to the imports at the top of `orchestrate.ts`:

```ts
import { tasks } from "../db/schema";
import { persistGenerationForRequirement } from "./persist";
import type { generateTasks as GenerateTasksFn } from "./run";
```

(`orchestrate.ts` already imports `fs`, `path`, `eq`, `requirements`, `project`, `buildSlice`, `SYSTEM_PROMPT`, `buildUserMessage`, `estimateTokens`, `generateTasks`, and has `MODEL_ID`/`MAX_CONTEXT_TOKENS`/`reqContextFromDb`.)

```ts
export interface GenerateForRequirementResult {
  ok: boolean;
  failure?: string;
  taskKeys?: string[];
}

/**
 * Generate and persist tasks for one approved/imported requirement (REQ-008,
 * requirement-driven). Mirrors generateForApprovedIdea but seeds the generator
 * from the requirement (title + description). Produces tasks only — persist forces
 * every task onto this requirement. `opts.generate` is injectable for tests.
 */
export async function generateForRequirement(
  db: Db,
  reqId: string,
  opts?: { generate?: typeof GenerateTasksFn },
): Promise<GenerateForRequirementResult> {
  const generate = opts?.generate ?? generateTasks;

  const [req] = await db
    .select({ id: requirements.id, title: requirements.title, description: requirements.description })
    .from(requirements)
    .where(eq(requirements.id, reqId))
    .limit(1);
  if (!req) return { ok: false, failure: "requirement not found" };

  const existingForReq = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.requirementId, reqId)).limit(1);
  if (existingForReq.length > 0) return { ok: false, failure: "requirement already has tasks" };

  const [proj] = await db.select().from(project).limit(1);
  if (!proj) return { ok: false, failure: "no project bound (REQ-002)" };

  const specPath = path.join(proj.localClonePath, proj.specPath);
  const claudePath = path.join(proj.localClonePath, proj.claudeMdPath);
  const specText = fs.existsSync(specPath) ? fs.readFileSync(specPath, "utf8") : "";
  const conventions = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, "utf8") : null;

  const ctx = reqContextFromDb(await db.select({ key: requirements.key, title: requirements.title }).from(requirements));
  const seedWhy = req.description || req.title;

  const fixed =
    estimateTokens(specText) +
    estimateTokens(conventions ?? "") +
    estimateTokens(req.title + seedWhy) +
    estimateTokens(SYSTEM_PROMPT) +
    800;
  const slice = buildSlice({
    repoPath: proj.localClonePath,
    excludeAbs: [specPath, claudePath],
    ideaTitle: req.title,
    ideaWhy: seedWhy,
    includes: [],
    relevantPaths: [],
    budgetTokens: Math.max(0, MAX_CONTEXT_TOKENS - fixed),
  });

  const userMessage = buildUserMessage({
    conventions,
    existingList: ctx.existingList,
    nextKey: ctx.nextKey,
    specText,
    idea: { title: req.title, why: seedWhy, feasibility: null, viability: null },
    slice,
  });

  const result = await generate({
    modelId: MODEL_ID,
    userMessage,
    existingKeys: ctx.existingKeys,
    nextNumber: ctx.nextNumber,
    maxRetries: 2,
    thinking: true,
  });
  if (!result.ok) return { ok: false, failure: result.failure };

  const { taskKeys } = await persistGenerationForRequirement(db, {
    reqId,
    output: result.output,
    model: result.model,
    usage: result.usage,
  });
  return { ok: true, taskKeys };
}
```

- [ ] **Step 4: Run the tests (pass) + typecheck**

Run: `npx tsx --test src/generation/orchestrate-requirement.test.ts` → PASS (3 tests).
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/generation/orchestrate.ts src/generation/orchestrate-requirement.test.ts package.json
git commit -m "[TASK-038] generateForRequirement (seed from requirement, injectable generator) (REQ-008)"
```

---

## Task 4: `getRequirementDetail` query

**Files:** Create `src/spec/detail.ts`; Test `src/spec/detail.test.ts`; Modify `package.json`.

**Interfaces:**
- Produces: `getRequirementDetail(db: Db, key: string): Promise<RequirementDetail | null>` where
  `RequirementDetail = { id: string; key: string; title: string; description: string; status: "planned"|"building"|"shipped"; provenance: "imported"|"voted"|"drift"; tasks: { key: string; title: string; githubStatus: "open"|"closed"; claimState: "unclaimed"|"claimed"; githubIssueUrl: string | null }[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/spec/detail.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { requirements, tasks } from "../db/schema";
import { getRequirementDetail } from "./detail";

test("getRequirementDetail returns the requirement with its tasks; null for unknown", async () => {
  const { db, close } = await createTestDb();
  try {
    assert.equal(await getRequirementDetail(db, "REQ-404"), null);

    const [r] = await db.insert(requirements).values({ key: "REQ-001", title: "Search", description: "d", provenance: "imported" }).returning({ id: requirements.id });
    await db.insert(tasks).values({ key: "TASK-001", title: "a", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, githubIssueUrl: "http://x/1" });

    const detail = await getRequirementDetail(db, "REQ-001");
    assert.ok(detail);
    assert.equal(detail!.key, "REQ-001");
    assert.equal(detail!.tasks.length, 1);
    assert.equal(detail!.tasks[0].key, "TASK-001");
    assert.equal(detail!.tasks[0].githubIssueUrl, "http://x/1");
  } finally { await close(); }
});
```

- [ ] **Step 2: Append the test to `package.json` and run it (fails)**

Add ` src/spec/detail.test.ts` to the `test` list. Run it → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/spec/detail.ts
import { eq, asc } from "drizzle-orm";
import type { Db } from "../db/client";
import { requirements, tasks } from "../db/schema";

export interface RequirementDetail {
  id: string;
  key: string;
  title: string;
  description: string;
  status: "planned" | "building" | "shipped";
  provenance: "imported" | "voted" | "drift";
  tasks: { key: string; title: string; githubStatus: "open" | "closed"; claimState: "unclaimed" | "claimed"; githubIssueUrl: string | null }[];
}

// One requirement + its tasks (for the spec detail drawer). null if the key is unknown.
export async function getRequirementDetail(db: Db, key: string): Promise<RequirementDetail | null> {
  const [req] = await db
    .select({ id: requirements.id, key: requirements.key, title: requirements.title, description: requirements.description, status: requirements.status, provenance: requirements.provenance })
    .from(requirements)
    .where(eq(requirements.key, key))
    .limit(1);
  if (!req) return null;

  const taskRows = await db
    .select({ key: tasks.key, title: tasks.title, githubStatus: tasks.githubStatus, claimState: tasks.claimState, githubIssueUrl: tasks.githubIssueUrl })
    .from(tasks)
    .where(eq(tasks.requirementId, req.id))
    .orderBy(asc(tasks.key));

  return { ...req, tasks: taskRows };
}
```

- [ ] **Step 4: Run the test (passes) + typecheck**

Run: `npx tsx --test src/spec/detail.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/spec/detail.ts src/spec/detail.test.ts package.json
git commit -m "[TASK-038] getRequirementDetail query (REQ-008)"
```

---

## Task 5: Requirement detail drawer (spike the nested intercept)

**Files:** Create `src/app/(app)/spec/requirement-detail.tsx`, `src/app/(app)/spec/[key]/page.tsx`, `src/app/(app)/@drawer/(.)spec/[key]/page.tsx`; Modify `src/app/(app)/spec/spec-grid.tsx`.

**Interfaces:**
- Consumes: `getRequirementDetail` (Task 4); `DrawerShell` (`@/components/drawer-shell`); `Pill`/`Empty` (`@/components/ui`).
- Produces: `RequirementDetail({ reqKey }: { reqKey: string })` (async server component).

> This is the **spike** for the nested `/spec/[key]` interception. The detail panel renders the requirement + its tasks, and a **"No tasks yet."** placeholder where Task 6 will put the Generate button.

- [ ] **Step 1: Write the detail panel**

```tsx
// src/app/(app)/spec/requirement-detail.tsx
import { getDb } from "@/db/client";
import { getRequirementDetail } from "@/spec/detail";
import { Pill, Empty, type Tone } from "@/components/ui";

const STATUS_LABEL: Record<string, string> = { shipped: "shipped", building: "in progress", planned: "not started" };
const PROV_LABEL: Record<string, string> = { imported: "genesis", voted: "voted", drift: "drift" };
const PROV_TONE: Record<string, Tone> = { imported: "neutral", voted: "spine", drift: "risk" };

export async function RequirementDetail({ reqKey }: { reqKey: string }) {
  const r = await getRequirementDetail(getDb(), reqKey);
  if (!r) return <Empty title="Unknown requirement.">No requirement with key {reqKey}.</Empty>;

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-spine-deep">{r.key}</span>
        <Pill tone={PROV_TONE[r.provenance] ?? "neutral"} dot={false}>{PROV_LABEL[r.provenance]}</Pill>
        <span className="ml-auto font-mono text-[11px] uppercase tracking-wide text-graphite">{STATUS_LABEL[r.status] ?? r.status}</span>
      </div>
      <h2 className="font-display mt-2 text-lg font-semibold text-ink">{r.title}</h2>
      {r.description && <p className="font-serif mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-soft">{r.description}</p>}

      <div className="mt-5 border-t border-hairline pt-4">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-graphite">Tasks</h3>
        {r.tasks.length === 0 ? (
          <p className="mt-3 text-[13px] text-graphite">No tasks yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {r.tasks.map((t) => (
              <li key={t.key} className="flex items-center gap-2 text-[13px]">
                <span className={`size-1.5 rounded-full ${t.githubStatus === "closed" ? "bg-shipped" : "bg-graphite"}`} />
                <span className="font-mono text-spine-deep">{t.key}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{t.title}</span>
                {t.claimState === "claimed" && <Pill tone="spine" dot={false}>claimed</Pill>}
                {t.githubIssueUrl && (
                  <a href={t.githubIssueUrl} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-spine-deep hover:underline">issue ↗</a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Full-page fallback** `src/app/(app)/spec/[key]/page.tsx`

```tsx
import { PageHeader } from "@/components/ui";
import { RequirementDetail } from "../requirement-detail";

export const dynamic = "force-dynamic";

export default async function RequirementPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <>
      <PageHeader eyebrow="Specification" title={key} lede="Requirement detail." />
      <RequirementDetail reqKey={key} />
    </>
  );
}
```

- [ ] **Step 3: Intercepted drawer** `src/app/(app)/@drawer/(.)spec/[key]/page.tsx`

```tsx
import { DrawerShell } from "@/components/drawer-shell";
import { RequirementDetail } from "../../../spec/requirement-detail";

export const dynamic = "force-dynamic";

export default async function RequirementDrawer({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <DrawerShell title={key}>
      <RequirementDetail reqKey={key} />
    </DrawerShell>
  );
}
```

> Verify the relative import path to `requirement-detail.tsx` resolves from `@drawer/(.)spec/[key]/` (it is three levels up to `(app)/`, then `spec/requirement-detail`). Adjust the `../` depth if the build complains; the import target is `src/app/(app)/spec/requirement-detail.tsx`.

- [ ] **Step 4: Make spec cells link** — in `src/app/(app)/spec/spec-grid.tsx`, add `import Link from "next/link";`, change the cell `<div … >…</div>` to `<Link href={`/spec/${r.key}`} …>…</Link>` (keep all classes, the status dot, the number, and the hover card inside; the hover card stays `pointer-events-none`).

- [ ] **Step 5: Build + typecheck**

Run: `npm run build` then `npm run typecheck` → both clean; `/spec/[key]` appears in the route list.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/spec/requirement-detail.tsx" "src/app/(app)/spec/[key]" "src/app/(app)/@drawer/(.)spec" "src/app/(app)/spec/spec-grid.tsx"
git commit -m "[TASK-038] requirement detail drawer via intercepting /spec/[key] (REQ-008)"
```

> **Controller runtime check (spike acceptance):** clicking a spec cell opens the detail as a drawer over `/spec`; Esc/scrim/✕ close; a hard visit/refresh of `/spec/REQ-001` renders the full page. If the nested intercept does not fire, apply the spec's `?req=` client-drawer fallback and report.

---

## Task 6: Generate action + button

**Files:** Create `src/app/(app)/spec/[key]/actions.ts`, `src/app/(app)/spec/spec-generate.tsx`; Modify `src/app/(app)/spec/requirement-detail.tsx`.

**Interfaces:**
- Consumes: `generateForRequirement` (Task 3); `createIssuesForTasks` (`@/github/issues`); `auth`; `getDb`; `requirements`.
- Produces: `generateTasksForRequirement(prev: GenState, formData: FormData): Promise<GenState>` where `GenState = { ok: true; taskKeys: string[] } | { ok: false; error: string } | null`; `SpecGenerate({ reqKey }: { reqKey: string })`.

- [ ] **Step 1: Write the server action**

```ts
// src/app/(app)/spec/[key]/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { requirements } from "@/db/schema";
import { generateForRequirement } from "@/generation/orchestrate";
import { createIssuesForTasks } from "@/github/issues";

export type GenState = { ok: true; taskKeys: string[] } | { ok: false; error: string } | null;

export async function generateTasksForRequirement(_prev: GenState, formData: FormData): Promise<GenState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };

  const key = String(formData.get("key") ?? "");
  const db = getDb();
  const [req] = await db.select({ id: requirements.id }).from(requirements).where(eq(requirements.key, key)).limit(1);
  if (!req) return { ok: false, error: `Unknown requirement ${key}.` };

  const r = await generateForRequirement(db, req.id);
  if (!r.ok) return { ok: false, error: r.failure ?? "Generation failed." };

  // Open GitHub issues for the new tasks (idempotent; outside the generation tx).
  try {
    await createIssuesForTasks(db);
  } catch {
    // tasks are persisted; issue creation can be retried by the worker — don't fail the action.
  }

  revalidatePath("/spec");
  revalidatePath("/dashboard");
  revalidatePath(`/spec/${key}`);
  return { ok: true, taskKeys: r.taskKeys ?? [] };
}
```

- [ ] **Step 2: Write the client button**

```tsx
// src/app/(app)/spec/spec-generate.tsx
"use client";

import { useActionState } from "react";
import { generateTasksForRequirement, type GenState } from "./[key]/actions";
import { buttonClass } from "@/components/ui";

export function SpecGenerate({ reqKey }: { reqKey: string }) {
  const [state, action, pending] = useActionState<GenState, FormData>(generateTasksForRequirement, null);
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="key" value={reqKey} />
      <button type="submit" disabled={pending} className={buttonClass("primary")}>
        {pending ? "Generating…" : "Generate tasks"}
      </button>
      {state?.ok === true && <p className="mt-2 text-[13px] text-shipped">Generated {state.taskKeys.length} task(s) — refresh to see them.</p>}
      {state?.ok === false && <p className="mt-2 text-[13px] text-risk">{state.error}</p>}
      <p className="mt-1 text-[11px] text-graphite">Runs one generation pass against the bound repo and opens a GitHub issue per task.</p>
    </form>
  );
}
```

> Importing a server action from a `[key]/actions.ts` into a client component is fine — server actions are callable from client components. The `revalidatePath` calls refresh the drawer's underlying server render so the new tasks appear (the success line tells the user as a fallback).

- [ ] **Step 3: Wire into the detail panel** — in `src/app/(app)/spec/requirement-detail.tsx`, add `import { SpecGenerate } from "./spec-generate";` and replace the no-tasks placeholder:

```tsx
        {r.tasks.length === 0 ? (
          <SpecGenerate reqKey={r.key} />
        ) : (
```

(leave the populated-tasks `<ul>` branch unchanged).

- [ ] **Step 4: Build + typecheck**

Run: `npm run build` then `npm run typecheck` → both clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/spec/[key]/actions.ts" "src/app/(app)/spec/spec-generate.tsx" "src/app/(app)/spec/requirement-detail.tsx"
git commit -m "[TASK-038] Generate-tasks action + button on the requirement drawer (REQ-008)"
```

---

## Task 7: Verify + finish

- [ ] **Step 1: Full suite** — stop any `:3000` server, then `npm test` → all pass (existing + the 3 new test files: persist-requirement, orchestrate-requirement, detail).
- [ ] **Step 2: Typecheck + build** — `npm run typecheck` clean; `npm run build` succeeds; `/spec` and `/spec/[key]` present.
- [ ] **Step 3: Real runtime verification (controller + user):** rebuild + restart the prod server. On `/spec`: click a requirement cell → the drawer opens with its detail and a **"Generate tasks"** button (since it has no tasks). Click it → after ~10–30s ("Generating…"), tasks are created for that requirement, a GitHub issue opens on `orbit`, and (after the drawer refreshes) the tasks list shows with issue links; the cell turns **amber**; the dashboard Tasks card increments. Try a requirement that already has tasks → no button, just the task list. Confirm no LLM fires merely on opening a drawer.
- [ ] **Step 4: Hand off** — report. Ready for finishing-a-development-branch.

---

## Self-Review

**Spec coverage:** requirement-driven engine → Tasks 2 (persist) + 3 (orchestrate); tasks-only/forced-link/refuse-if-tasks → Task 2; detail drawer via intercepting `/spec/[key]` → Task 5 (with the spike + `?req=` fallback noted); auth-guarded synchronous generate that opens issues → Task 6; per-requirement on-demand trigger → Task 6 button; DRY helper extraction → Task 1; tests for the new pure/DB logic → Tasks 2/3/4; real-generation verification → Task 7. The "no LLM on render" and "no partial tasks" constraints are honored (generation only in the action; persist only on `result.ok`).

**Placeholder scan:** every code/test step is complete; run steps have commands + expected results. No TBD.

**Type consistency:** `persistGenerationForRequirement(db, { reqId, output, model, usage, actorId? }) → { taskKeys }`; `generateForRequirement(db, reqId, opts?: { generate?: typeof generateTasks }) → { ok, failure?, taskKeys? }`; `getRequirementDetail(db, key) → RequirementDetail | null`; `generateTasksForRequirement(prev: GenState, formData) ` matches `useActionState<GenState, FormData>`; `SpecGenerate({ reqKey })` is consumed by `RequirementDetail` with `reqKey={r.key}`. `Usage`/`GenerationOutput`/`GenerateTasksResult` come from `./run` and `../schema`. `tasks` insert omits the nullable `originIdeaId` (verified nullable in the schema). The generate action's `createIssuesForTasks(db)` matches its `(db, openIssue?)` signature.
