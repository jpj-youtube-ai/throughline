# HTML prototypes → frontend issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prototype *image* pipeline with HTML-only: generation works from prototype labels, the model flags which tasks are frontend, and each frontend task's branch gets the prototype HTML committed + referenced in its issue.

**Architecture:** Delete the render/PNG/vision/serve pipeline. Add a `task_prototypes` join table; the model emits per-task prototype labels at generation; persist writes the links in the `tasks.generated` tx; the issue gets a "Design prototype" section and the branch-creation sweep commits the HTML to `prototypes/<slug>.html` via the GitHub Contents API.

**Tech Stack:** TypeScript, Postgres + Drizzle (PGlite tests, `node:test`), Anthropic SDK (structured output), Octokit (Contents API), Next.js (App Router).

**Design doc:** `docs/superpowers/specs/2026-06-25-prototype-html-to-issues-design.md`

## Global Constraints

- **Requirement:** REQ-030 (Design prototype context) — **no new REQ**. Branch `task-071-prototype-html-to-issues`; PR/squash start `[TASK-071]`.
- **Truth model:** no new event types. `task_prototypes` links are written **in the same tx** as `tasks.generated` (task content, like pointers). `prototype.added/removed` unchanged. The branch HTML commit is an external git op (Contents API) **outside any DB tx**, idempotent + best-effort (mirrors branch/issue creation). No `github_status` write. LLM output still validated (`semanticErrors` now also validates prototype labels) — no partial/garbage persist.
- **No `any`** in domain code. New `*.test.ts` files registered in `package.json`'s enumerated `test` script.
- **Migration not auto-applied to live DB** — generate it; controller hand-applies (`CREATE TABLE task_prototypes`, later `DROP COLUMN image`) at deploy.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Setup

```bash
git switch -c task-071-prototype-html-to-issues   # already created — confirm you're on it
```

---

## File Structure

- `src/prototypes/store.ts` — `loadProjectPrototypes` → `{id,label}[]`; `listProjectPrototypes` removed (callers use `loadProjectPrototypes`); add `loadTaskPrototypes` (modify).
- `src/prototypes/render.ts`, `render.test.ts`, `serve.ts`, `serve.test.ts` — **deleted**.
- `src/app/prototype/[id]/route.ts` — **deleted**.
- `src/worker/index.ts` — render step + `renderPrototypes` dep removed.
- `src/generation/run.ts` — drop `images`/`buildUserContent`; add `prototypeLabels` thread to `semanticErrors`.
- `src/generation/orchestrate.ts` — drop image load/budget; load labels; pass to prompt + `generateTasks`.
- `src/prompt.ts` — `buildUserMessage` prototype-labels block; SYSTEM_PROMPT rule.
- `src/schema.ts` — `TaskSchema.prototypes`; `semanticErrors`/`SemanticContext` validate labels.
- `src/db/schema.ts` — drop `prototypes.image`; add `task_prototypes`.
- `src/generation/persist.ts` — write `task_prototypes` from labels (both functions).
- `src/github/issues.ts` — "Design prototype" section.
- `src/github/branches.ts` — commit prototype HTML on branch creation.
- `src/github/contents.ts` — new `commitFileToBranch` (create).
- `src/app/(app)/connect/prototypes.tsx`, `prototype-upload-form.tsx` — drop thumbnails/render status.

---

## Task 1: Remove the image pipeline (keep the column, unused)

Make prototypes HTML-only in behavior. The `prototypes.image` **column stays** (dropped in Task 7) so every step compiles; we just stop producing/consuming it.

**Files:**
- Delete: `src/prototypes/render.ts`, `src/prototypes/render.test.ts`, `src/prototypes/serve.ts`, `src/prototypes/serve.test.ts`, `src/app/prototype/[id]/route.ts`
- Modify: `src/prototypes/store.ts`, `src/worker/index.ts`, `src/worker/worker.test.ts`, `src/generation/run.ts`, `src/generation/run.test.ts`, `src/generation/orchestrate.ts`, `src/prompt.ts`, `src/prompt.test.ts`, `src/github/issues.ts`, `src/github/issues.test.ts`, `src/app/(app)/connect/prototypes.tsx`, `src/app/(app)/connect/prototype-upload-form.tsx`, `package.json`

**Interfaces:**
- Produces: `loadProjectPrototypes(db, projectId): Promise<{ id: string; label: string }[]>` (newest-first); `generateTasks` no longer takes `images`; `createIssuesForTasks` no longer links PNGs; `SYSTEM_PROMPT` has no screenshot rule.

- [ ] **Step 1: Delete the render/serve/route files + their tests**

```bash
git rm src/prototypes/render.ts src/prototypes/render.test.ts src/prototypes/serve.ts src/prototypes/serve.test.ts "src/app/prototype/[id]/route.ts"
```

- [ ] **Step 2: Repoint `store.ts` to labels-only**

In `src/prototypes/store.ts`: change `loadProjectPrototypes` to select `{ id, label }` (drop `image`, `isNotNull(image)`, the `limit`/cap, and the `Buffer` map), newest-first:

```ts
export async function loadProjectPrototypes(
  db: Db,
  projectId: string,
): Promise<{ id: string; label: string }[]> {
  return db
    .select({ id: prototypes.id, label: prototypes.label })
    .from(prototypes)
    .where(eq(prototypes.projectId, projectId))
    .orderBy(desc(prototypes.createdAt));
}
```

Delete `listProjectPrototypes` entirely (the `/connect` UI will call `loadProjectPrototypes` in Step 9). Drop now-unused imports (`and`, `isNotNull`, `sql` if unused). In `src/prototypes/store.test.ts`: delete the `getPrototypePng` test and its `import { getPrototypePng } from "./serve"`; change the `loadProjectPrototypes` test to assert `{id,label}` rows for the project (no image, no cap), still newest-first and project-scoped.

- [ ] **Step 3: Remove the worker render step**

In `src/worker/index.ts`: delete the `renderPrototypeImages` import, the `WorkerDeps.renderPrototypes` field, its destructuring default, and the whole "Render any newly-uploaded design prototypes" try/catch step. In `src/worker/worker.test.ts`: remove every `renderPrototypes: …` stub line (all 6 deps objects + the dedicated "tick renders prototypes…" test — delete that test).

- [ ] **Step 4: Strip vision from generation**

In `src/generation/run.ts`: delete `buildUserContent` and the `images?` field from `GenerateTasksArgs`; change the initial messages to plain text:

```ts
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: args.userMessage }];
```

In `src/generation/run.test.ts`: delete the two `buildUserContent` tests (the file may then be empty of tests — if so, `git rm` it and remove its `package.json` entry).

In `src/generation/orchestrate.ts`: in **both** `generateForApprovedIdea` and `generateForRequirement`, delete the `loadProjectPrototypes`+`images` lines, the `+ images.length * 1500` budget term, and `images,` from the `generateTasks(...)` call. Leave the `loadProjectPrototypes` import in place only if Task 3 will re-add a labels load here (it will — keep the import).

- [ ] **Step 5: SYSTEM_PROMPT — drop the screenshot rule**

In `src/prompt.ts`, delete the bullet beginning "- You may be given design-prototype screenshots…". In `src/prompt.test.ts`, delete the test asserting `/design[- ]prototype screenshots/i`.

- [ ] **Step 6: Remove the PNG "Design references" from issues**

In `src/github/issues.ts`: delete the `prototypes` import usage for the PNG section, the `designRefs` block, and the `+ designRefs` on the issue body (revert to `bodyPrefix + t.body`). In `src/github/issues.test.ts`: delete the two "Design references" tests (the section returns in Task 5 in a new form).

- [ ] **Step 7: `/connect` — drop thumbnails + render status**

In `src/app/(app)/connect/prototypes.tsx`: replace `listProjectPrototypes` with `loadProjectPrototypes` (returns `{id,label}`); remove the thumbnail `<div>`/`<img>` + "rendering…" + "PNG pending worker" markup; each list row shows the **label** + the Remove form only. Keep the empty state. `src/app/(app)/connect/prototype-upload-form.tsx` is unchanged (it already only uploads).

- [ ] **Step 8: Run the affected tests + typecheck + build**

Run: `npx tsx --test src/prototypes/store.test.ts src/worker/worker.test.ts src/github/issues.test.ts src/prompt.test.ts`
Expected: PASS (with the deletions applied).
Run: `npm run typecheck` → clean (no dangling `image`/`images`/`renderPrototypes`/`getPrototypePng` references).
Run: `npm run build` → clean (the `/prototype/[id]` route is gone).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
[TASK-071] remove the prototype image pipeline (render/serve/vision/thumbnails) (REQ-030)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `task_prototypes` join table + migration

**Files:**
- Modify: `src/db/schema.ts`
- Create (generated): `drizzle/00NN_*.sql`
- Create: `src/db/task-prototypes-schema.test.ts`; Modify: `package.json`

**Interfaces:**
- Produces: `taskPrototypes` table — `{ taskId: uuid → tasks.id, prototypeId: uuid → prototypes.id }`, composite PK, both FKs `onDelete: "cascade"`.

- [ ] **Step 1: Write the failing round-trip test**

Create `src/db/task-prototypes-schema.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./client";
import { project, prototypes, tasks, requirements, taskPrototypes } from "./schema";

test("task_prototypes links a task to a prototype, cascades on delete", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const [r] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", status: "planned", provenance: "voted", projectId: p.id }).returning({ id: requirements.id });
    const [t] = await db.insert(tasks).values({ key: "TASK-001", title: "UI", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: p.id }).returning({ id: tasks.id });
    const [proto] = await db.insert(prototypes).values({ projectId: p.id, label: "Home", html: "<h1>h</h1>" }).returning({ id: prototypes.id });

    await db.insert(taskPrototypes).values({ taskId: t.id, prototypeId: proto.id });
    const links = await db.select().from(taskPrototypes).where(and(eq(taskPrototypes.taskId, t.id), eq(taskPrototypes.prototypeId, proto.id)));
    assert.equal(links.length, 1);

    // deleting the prototype cascades the link away
    await db.delete(prototypes).where(eq(prototypes.id, proto.id));
    assert.equal((await db.select().from(taskPrototypes).where(eq(taskPrototypes.taskId, t.id))).length, 0);
  } finally { await close(); }
});
```

Append ` src/db/task-prototypes-schema.test.ts` to the `package.json` `test` script.

- [ ] **Step 2: Run it — fails (no `taskPrototypes` export)**

Run: `npx tsx --test src/db/task-prototypes-schema.test.ts` → FAIL.

- [ ] **Step 3: Add the table**

In `src/db/schema.ts`, after the `prototypes` table:

```ts
export const taskPrototypes = pgTable(
  "task_prototypes",
  {
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    prototypeId: uuid("prototype_id").notNull().references(() => prototypes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.prototypeId] })],
);
```

Ensure `primaryKey` is imported from `drizzle-orm/pg-core` (add it to that import if missing).

- [ ] **Step 4: Generate the migration + run the test**

Run: `npm run db:generate` → new `drizzle/00NN_*.sql` with `CREATE TABLE "task_prototypes"` + the two FKs.
Run: `npx tsx --test src/db/task-prototypes-schema.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/task-prototypes-schema.test.ts package.json drizzle/
git commit -m "$(cat <<'EOF'
[TASK-071] task_prototypes join table (task ↔ prototype) (REQ-030)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Generation — prototype labels + `TaskSchema.prototypes` + validation + prompt

**Files:**
- Modify: `src/schema.ts`, `src/schema.test.ts` (if present; else create), `src/prompt.ts`, `src/prompt.test.ts`, `src/generation/run.ts`, `src/generation/orchestrate.ts`
- Modify: `package.json` if a new test file is added

**Interfaces:**
- Produces: `TaskSchema` with `prototypes: string[]`; `SemanticContext` with `prototypeLabels: Set<string>`; `semanticErrors` validates them; `generateTasks` takes `prototypeLabels: string[]`; `buildUserMessage` takes `prototypeLabels?: string[]`.

- [ ] **Step 1: Write the failing schema/semantic tests**

Add to `src/schema.test.ts` (create it + register if absent):

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { GenerationOutputSchema, semanticErrors } from "./schema";

const base = { new_requirements: [], tasks: [{ title: "UI", requirement_key: "REQ-001", body: { pointers: ["x"], acceptance_check: "y" }, effort: 1, risk: "low", confidence: 50, prototypes: [] as string[] }] };
const ctx = { existingKeys: new Set(["REQ-001"]), nextNumber: 2, prototypeLabels: new Set(["Search page"]) };

test("a task may carry valid prototype labels", () => {
  const out = GenerationOutputSchema.parse({ ...base, tasks: [{ ...base.tasks[0], prototypes: ["Search page"] }] });
  assert.deepEqual(semanticErrors(out, ctx), []);
});

test("an unknown prototype label is a semantic error", () => {
  const out = GenerationOutputSchema.parse({ ...base, tasks: [{ ...base.tasks[0], prototypes: ["Nope"] }] });
  assert.ok(semanticErrors(out, ctx).some((e) => /prototype/i.test(e) && /Nope/.test(e)));
});

test("empty prototypes is always valid", () => {
  const out = GenerationOutputSchema.parse(base);
  assert.deepEqual(semanticErrors(out, ctx), []);
});
```

In `src/prompt.test.ts` add:

```ts
test("SYSTEM_PROMPT instructs marking frontend tasks with prototype labels", () => {
  assert.ok(/prototypes/i.test(SYSTEM_PROMPT) && /label/i.test(SYSTEM_PROMPT));
});
```

- [ ] **Step 2: Run — fails**

Run: `npx tsx --test src/schema.test.ts src/prompt.test.ts` → FAIL (`prototypes` not in schema; SYSTEM_PROMPT lacks the rule).

- [ ] **Step 3: Add the schema field + validation (`src/schema.ts`)**

Add to `TaskSchema` (inside the `.object({...})`, before `.strict()`):

```ts
    prototypes: z
      .array(z.string())
      .describe("Labels of the design prototype(s) this task builds against (from the provided list). Empty unless this is frontend work matching a prototype."),
```

Extend `SemanticContext`:

```ts
export interface SemanticContext {
  existingKeys: Set<string>;
  nextNumber: number;
  prototypeLabels: Set<string>;
}
```

In `semanticErrors`, inside the `out.tasks.forEach((t, i) => { … })` loop (after the acceptance_check check), add:

```ts
    for (const label of t.prototypes) {
      if (!ctx.prototypeLabels.has(label)) {
        errors.push(`${label2}: prototype "${label}" is not one of the available design prototypes.`);
      }
    }
```

(Use the existing `label` loop variable name there — it's `const label = \`task[${i}] …\``; rename the inner loop var to `proto` to avoid shadowing: `for (const proto of t.prototypes) { if (!ctx.prototypeLabels.has(proto)) errors.push(\`${label}: prototype "${proto}" is not one of the available design prototypes.\`); }`.)

- [ ] **Step 4: SYSTEM_PROMPT rule + `buildUserMessage` block (`src/prompt.ts`)**

In `SYSTEM_PROMPT` rules, add:

```
- You may be given the project's design prototypes by label (see "## DESIGN PROTOTYPES"). For any task that builds one of those UIs, list the exact matching label(s) in that task's "prototypes" field; the prototype's HTML will be committed to the task's branch for the agent to build against. Leave "prototypes" empty for non-frontend tasks. Use only labels from the provided list.
```

Add `prototypeLabels?: string[];` to `UserMessageParts`, and render a block in `buildUserMessage` (before `## APPROVED IDEA`):

```ts
  const prototypesBlock =
    p.prototypeLabels && p.prototypeLabels.length
      ? `## DESIGN PROTOTYPES (available by label)\n${p.prototypeLabels.map((l) => `- ${l}`).join("\n")}\n\n`
      : "";
```

and splice `${prototypesBlock}` into the returned template immediately before `## APPROVED IDEA`.

- [ ] **Step 5: Thread labels through `run.ts`**

Add `prototypeLabels: string[]` to `GenerateTasksArgs`. Pass it to `semanticErrors`:

```ts
    const errs = semanticErrors(parsed.data, {
      existingKeys: args.existingKeys,
      nextNumber: args.nextNumber,
      prototypeLabels: new Set(args.prototypeLabels),
    });
```

- [ ] **Step 6: Load + pass labels in `orchestrate.ts`**

In **both** generators, after `proj` is resolved, add:

```ts
  const prototypeLabels = (await loadProjectPrototypes(db, proj.id)).map((p) => p.label);
```

Pass `prototypeLabels` to `buildUserMessage({ …, prototypeLabels })` and `prototypeLabels` to the `generateTasks({ … })` / `generate({ … })` call.

- [ ] **Step 7: Run tests + typecheck**

Run: `npx tsx --test src/schema.test.ts src/prompt.test.ts src/generation/orchestrate-requirement.test.ts` → PASS (the orchestrate test's empty clone ⇒ no prototypes ⇒ `prototypeLabels: []` ⇒ unchanged). 

> The `orchestrate-requirement.test.ts` calls `generate` with a fake — confirm that fake's args type now includes `prototypeLabels`; if it constructs `GenerateTasksArgs` explicitly, add `prototypeLabels: []`.

Run: `npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/schema.ts src/schema.test.ts src/prompt.ts src/prompt.test.ts src/generation/run.ts src/generation/orchestrate.ts package.json
git commit -m "$(cat <<'EOF'
[TASK-071] generation: model marks frontend tasks with prototype labels (REQ-030)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Persist `task_prototypes` from the model's labels

**Files:**
- Modify: `src/generation/persist.ts`, `src/generation/persist.test.ts`, `src/generation/persist-requirement.test.ts`

**Interfaces:**
- Consumes: `taskPrototypes`, `prototypes` (Task 2); `output.tasks[].prototypes` (Task 3).
- Produces: both persist functions insert `task_prototypes` rows for each task's labels, in the same tx.

- [ ] **Step 1: Write the failing test**

Add to `src/generation/persist.test.ts` (it already seeds an approved idea + project; add `prototypes`, `taskPrototypes` to the schema import):

```ts
test("persistGeneration links a task to the prototype(s) it named", async () => {
  const { db, close } = await createTestDb();
  try {
    const { ideaId, projectId } = await seedApprovedIdea(db); // existing helper
    const [proto] = await db.insert(prototypes).values({ projectId, label: "Search page", html: "<h1>s</h1>" }).returning({ id: prototypes.id });
    const output = { new_requirements: [{ key: "REQ-001", title: "Search", description: "d" }], tasks: [
      { title: "Build search UI", requirement_key: "REQ-001", body: { pointers: ["x"], acceptance_check: "y" }, effort: 2, risk: "low", confidence: 60, prototypes: ["Search page"] },
      { title: "Indexer", requirement_key: "REQ-001", body: { pointers: ["x"], acceptance_check: "y" }, effort: 2, risk: "low", confidence: 60, prototypes: [] },
    ]};
    await persistGeneration(db, { ideaId, output, model: "m", usage: null });
    const links = await db.select().from(taskPrototypes);
    assert.equal(links.length, 1, "only the frontend task links a prototype");
    assert.equal(links[0].prototypeId, proto.id);
  } finally { await close(); }
});
```

(Match the exact shape `seedApprovedIdea` returns; if it returns only an id, fetch `projectId` as the test already does elsewhere.)

- [ ] **Step 2: Run — fails (no links written)**

Run: `npx tsx --test src/generation/persist.test.ts` → FAIL.

- [ ] **Step 3: Write the links (`src/generation/persist.ts`)**

Import `prototypes, taskPrototypes` from `../db/schema` and `inArray` from `drizzle-orm`. In **`persistGeneration`**, after the task-mint loop builds `taskKeys`, first capture each task's id + its labels. Change the insert in the loop to return the id and collect a worklist:

```ts
    const protoLinks: { taskId: string; labels: string[] }[] = [];
    for (const t of input.output.tasks) {
      // …existing reqKey/requirementId resolution…
      const taskKey = `TASK-${pad3(++taskMax)}`;
      const [taskRow] = await tx.insert(tasks).values({ /* …existing… */ }).returning({ id: tasks.id });
      taskKeys.push(taskKey);
      touchedReqs.add(requirementId);
      if (t.prototypes.length) protoLinks.push({ taskId: taskRow.id, labels: t.prototypes });
    }
```

After the loop (still in the tx, before/after the `tasks.generated` emit), resolve labels → ids within this project and insert links:

```ts
    if (protoLinks.length) {
      const labelSet = new Set(protoLinks.flatMap((l) => l.labels));
      const protoRows = projectId !== null
        ? await tx.select({ id: prototypes.id, label: prototypes.label }).from(prototypes).where(and(eq(prototypes.projectId, projectId), inArray(prototypes.label, [...labelSet])))
        : [];
      const byLabel = new Map<string, string[]>();
      for (const r of protoRows) byLabel.set(r.label, [...(byLabel.get(r.label) ?? []), r.id]);
      const rows = protoLinks.flatMap((l) =>
        [...new Set(l.labels.flatMap((lab) => byLabel.get(lab) ?? []))].map((prototypeId) => ({ taskId: l.taskId, prototypeId })),
      );
      if (rows.length) await tx.insert(taskPrototypes).values(rows);
    }
```

(Add `and` to the drizzle import in this file if missing.) Apply the **same** pattern to `persistGenerationForRequirement` — capture `taskRow.id` from `.returning({ id: tasks.id })`, collect `protoLinks`, and insert the same way (its `projectId` is `req.projectId ?? null`).

- [ ] **Step 4: Run persist tests + typecheck**

Run: `npx tsx --test src/generation/persist.test.ts src/generation/persist-requirement.test.ts` → PASS.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/generation/persist.ts src/generation/persist.test.ts src/generation/persist-requirement.test.ts
git commit -m "$(cat <<'EOF'
[TASK-071] persist task↔prototype links in the tasks.generated tx (REQ-030)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Issue "Design prototype" section

**Files:**
- Modify: `src/github/issues.ts`, `src/github/issues.test.ts`; Create: `src/prototypes/slug.ts`, `src/prototypes/slug.test.ts`; Modify: `package.json`
- Modify: `src/prototypes/store.ts` (add `loadTaskPrototypes`)

**Interfaces:**
- Produces: `slugify(label): string`; `loadTaskPrototypes(db, taskId): Promise<{ id: string; label: string; html: string }[]>`; issue body gains a "## Design prototype" section for tasks with prototypes.

- [ ] **Step 1: `slugify` test + impl**

Create `src/prototypes/slug.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { slugify } from "./slug";

test("slugify lowercases and dashes non-alphanumerics", () => {
  assert.equal(slugify("Search Page v2!"), "search-page-v2");
  assert.equal(slugify("  Idea — board  "), "idea-board");
  assert.equal(slugify("???"), "prototype"); // fallback for empty
});
```

Create `src/prototypes/slug.ts`:

```ts
/** A filesystem-safe slug for a prototype label (REQ-030). Falls back to
 *  "prototype" when the label has no alphanumerics. */
export function slugify(label: string): string {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "prototype";
}
```

Register both `src/prototypes/slug.test.ts` in `package.json`. Run: `npx tsx --test src/prototypes/slug.test.ts` → PASS.

- [ ] **Step 2: `loadTaskPrototypes` (store.ts)**

```ts
import { taskPrototypes } from "../db/schema";
// …
/** The prototypes a task is linked to (REQ-030) — id, label, and the HTML to
 *  commit onto the task's branch. */
export async function loadTaskPrototypes(
  db: Db,
  taskId: string,
): Promise<{ id: string; label: string; html: string }[]> {
  return db
    .select({ id: prototypes.id, label: prototypes.label, html: prototypes.html })
    .from(taskPrototypes)
    .innerJoin(prototypes, eq(prototypes.id, taskPrototypes.prototypeId))
    .where(eq(taskPrototypes.taskId, taskId));
}
```

- [ ] **Step 3: Failing issue test**

In `src/github/issues.test.ts` add (import `prototypes`, `taskPrototypes`, and `slugify` from `@/prototypes/slug`):

```ts
test("createIssuesForTasks adds a Design prototype section only for tasks with prototypes", async () => {
  const { db, close } = await createTestDb();
  try {
    const { projId, reqId } = await seedProject(db, "acme/repo", 7);
    const [proto] = await db.insert(prototypes).values({ projectId: projId, label: "Search page", html: "<h1>s</h1>" }).returning({ id: prototypes.id });
    const [front] = await db.insert(tasks).values({ key: "TASK-001", title: "UI", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId }).returning({ id: tasks.id });
    await db.insert(tasks).values({ key: "TASK-002", title: "API", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId });
    await db.insert(taskPrototypes).values({ taskId: front.id, prototypeId: proto.id });

    const bodies: Record<string, string> = {};
    await createIssuesForTasks(db, projId, async (_i, _r, title, body) => { bodies[title.split(" ")[0]] = body; return { number: 1, url: "u" }; });

    assert.match(bodies["[TASK-001]"], /## Design prototype/);
    assert.match(bodies["[TASK-001]"], /prototypes\/search-page\.html/);
    assert.doesNotMatch(bodies["[TASK-002]"], /Design prototype/);
  } finally { await close(); }
});
```

Run it → FAIL.

- [ ] **Step 4: Add the section (`src/github/issues.ts`)**

Import `loadTaskPrototypes` from `@/prototypes/store` and `slugify` from `@/prototypes/slug`. Inside the `for (const t of pending)` loop, build a per-task section:

```ts
    const protos = await loadTaskPrototypes(db, t.id);
    const designSection = protos.length
      ? "\n\n## Design prototype\nBuild the UI to match the design prototype(s) committed to this task's branch:\n" +
        protos.map((p) => `- **${p.label}** → \`prototypes/${slugify(p.label)}.html\``).join("\n")
      : "";
```

and append `designSection` to the issue body (`bodyPrefix + t.body + designSection`). Ensure `t.id` is in the `pending` select (add `id: tasks.id` if missing).

- [ ] **Step 5: Run + commit**

Run: `npx tsx --test src/github/issues.test.ts src/prototypes/slug.test.ts` → PASS. `npm run typecheck` → clean.

```bash
git add src/github/issues.ts src/github/issues.test.ts src/prototypes/store.ts src/prototypes/slug.ts src/prototypes/slug.test.ts package.json
git commit -m "$(cat <<'EOF'
[TASK-071] issues: Design prototype section for frontend tasks (REQ-030)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Commit prototype HTML onto the task branch

**Files:**
- Create: `src/github/contents.ts`, `src/github/contents.test.ts`; Modify: `src/github/branches.ts`, `src/github/branches.test.ts`, `package.json`

**Interfaces:**
- Produces: `commitFileToBranch(installationId, repoFullName, branch, filePath, content, message, client?): Promise<{ committed: boolean }>`; `createBranchesForClaimedTasks` gains a `commitPrototypesFn` dep that commits each linked prototype's HTML.

- [ ] **Step 1: `commitFileToBranch` test + impl**

Create `src/github/contents.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { commitFileToBranch, type ContentsClient } from "./contents";

function fakeClient(existing: { content?: string; sha?: string } | { status: 404 }): { client: ContentsClient; puts: any[] } {
  const puts: any[] = [];
  const client: ContentsClient = {
    rest: { repos: {
      getContent: async () => { if ("status" in existing) throw Object.assign(new Error("nf"), { status: 404 }); return { data: { sha: existing.sha!, content: Buffer.from(existing.content!, "utf8").toString("base64") } }; },
      createOrUpdateFileContents: async (p) => { puts.push(p); return {}; },
    } },
  };
  return { client, puts };
}

test("creates the file when absent (404)", async () => {
  const { client, puts } = fakeClient({ status: 404 });
  const r = await commitFileToBranch(1, "a/b", "task-1", "prototypes/x.html", "<h1>x</h1>", "msg", client);
  assert.equal(r.committed, true);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].branch, "task-1");
  assert.equal(Buffer.from(puts[0].content, "base64").toString("utf8"), "<h1>x</h1>");
  assert.equal(puts[0].sha, undefined);
});

test("skips when the file already has identical content", async () => {
  const { client, puts } = fakeClient({ content: "<h1>x</h1>", sha: "abc" });
  const r = await commitFileToBranch(1, "a/b", "task-1", "prototypes/x.html", "<h1>x</h1>", "msg", client);
  assert.equal(r.committed, false);
  assert.equal(puts.length, 0);
});

test("updates with the blob sha when content differs", async () => {
  const { client, puts } = fakeClient({ content: "<h1>old</h1>", sha: "abc" });
  const r = await commitFileToBranch(1, "a/b", "task-1", "prototypes/x.html", "<h1>new</h1>", "msg", client);
  assert.equal(r.committed, true);
  assert.equal(puts[0].sha, "abc");
} );
```

Create `src/github/contents.ts`:

```ts
import { getInstallationOctokit } from "./app";

export interface ContentsClient {
  rest: {
    repos: {
      getContent: (p: { owner: string; repo: string; path: string; ref: string }) => Promise<{ data: { sha: string; content?: string } | unknown }>;
      createOrUpdateFileContents: (p: { owner: string; repo: string; path: string; message: string; content: string; branch: string; sha?: string }) => Promise<unknown>;
    };
  };
}

/** Create or update a single file on a branch via the GitHub Contents API
 *  (REQ-030). Idempotent: skips when the file already holds identical content;
 *  updates with the blob sha otherwise; creates when absent (404). */
export async function commitFileToBranch(
  installationId: number,
  repoFullName: string,
  branch: string,
  filePath: string,
  content: string,
  message: string,
  client?: ContentsClient,
): Promise<{ committed: boolean }> {
  const [owner, repo] = repoFullName.split("/");
  const kit = client ?? ((await getInstallationOctokit(installationId)) as unknown as ContentsClient);
  let sha: string | undefined;
  try {
    const existing = await kit.rest.repos.getContent({ owner, repo, path: filePath, ref: branch });
    const data = existing.data as { sha?: string; content?: string };
    if (data && typeof data.sha === "string") {
      if (data.content && Buffer.from(data.content, "base64").toString("utf8") === content) return { committed: false };
      sha = data.sha;
    }
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
  }
  await kit.rest.repos.createOrUpdateFileContents({ owner, repo, path: filePath, message, content: Buffer.from(content, "utf8").toString("base64"), branch, sha });
  return { committed: true };
}
```

Register `src/github/contents.test.ts`. Run: `npx tsx --test src/github/contents.test.ts` → PASS.

- [ ] **Step 2: Wire branch creation (`src/github/branches.ts`)**

Add a `CommitPrototypesFn` dep that, given a task, commits its linked prototypes' HTML:

```ts
import { loadTaskPrototypes } from "../prototypes/store";
import { slugify } from "../prototypes/slug";
import { commitFileToBranch } from "./contents";

export type CommitPrototypesFn = (
  db: Db, installationId: number, repoFullName: string, branch: string, taskId: string,
) => Promise<void>;

export const commitTaskPrototypes: CommitPrototypesFn = async (db, installationId, repoFullName, branch, taskId) => {
  const protos = await loadTaskPrototypes(db, taskId);
  for (const p of protos) {
    await commitFileToBranch(installationId, repoFullName, branch, `prototypes/${slugify(p.label)}.html`, p.html, `[design] prototype "${p.label}" for the task on this branch`);
  }
};
```

Add `commitPrototypesFn: CommitPrototypesFn = commitTaskPrototypes` as the last parameter of `createBranchesForClaimedTasks`, and call it best-effort after the branch is created (before the kickoff comment), so a Contents failure doesn't abort the sweep:

```ts
    await createBranchFn(proj.installationId, proj.repoFullName, t.branchName, proj.defaultBranch);
    try {
      await commitPrototypesFn(db, proj.installationId, proj.repoFullName, t.branchName, t.id);
    } catch (e) {
      console.error(`[branches] prototype commit skipped for ${t.key}:`, e instanceof Error ? e.message : e);
    }
```

Add `id: tasks.id` to the `pending` select.

- [ ] **Step 3: Branch test**

In `src/github/branches.test.ts`, add a test that a claimed task with a linked prototype triggers a `commitPrototypesFn` call (inject a fake that records `(branch, taskId)`), and that branch creation still succeeds when it throws (best-effort). Use the existing claimed-task seeding in that file; pass the fake as the new param. Run: `npx tsx --test src/github/branches.test.ts` → PASS.

- [ ] **Step 4: typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add src/github/contents.ts src/github/contents.test.ts src/github/branches.ts src/github/branches.test.ts package.json
git commit -m "$(cat <<'EOF'
[TASK-071] commit prototype HTML onto the task branch on creation (REQ-030)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Drop the `image` column + verify + review + PR

**Files:** `src/db/schema.ts` (+ generated migration); then verification/review/integration.

- [ ] **Step 1: Drop the column**

In `src/db/schema.ts`, remove the `image: bytea("image")` line from `prototypes`. Run `npm run db:generate` → a migration with `ALTER TABLE "prototypes" DROP COLUMN "image";`. (The `bytea` customType may now be unused — leave it; `tasks.previewImage` still uses it. Confirm with a grep before removing anything else.)

- [ ] **Step 2: Full verify**

Run: `npm test` (all pass — new tests + the suite; transient first-run V8 crash on this box ⇒ re-run once). `npm run typecheck`. `npm run build`. Grep the tree for any remaining `prototypes.image` / `getPrototypePng` / `renderPrototype` / `images.length * 1500` references — expect none.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "$(cat <<'EOF'
[TASK-071] drop the unused prototypes.image column (REQ-030)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Event-integrity review**

Dispatch `event-integrity-reviewer` on the branch diff. Confirm: `task_prototypes` links written in the same tx as `tasks.generated` (no new event type); LLM output still validated (`semanticErrors` rejects unknown labels → retry, no partial persist); the branch HTML commit is an external git op outside any tx, idempotent + best-effort; no `github_status` write; no `any`; maps to REQ-030.

- [ ] **Step 5: Live DB migrations (deploy-time, controller)**

Hand-apply both migrations to live Postgres: `CREATE TABLE task_prototypes …` (Task 2) and `ALTER TABLE prototypes DROP COLUMN image` (Task 1 left the column; Task 7 drops it). Then `npm run db:check` → no drift.

- [ ] **Step 6: Runtime walkthrough**

On the deploy: upload a prototype on `/connect` (no thumbnail now, label-only) → generate tasks for a UI-ish requirement → confirm a frontend task's issue has the "## Design prototype" section → claim it → confirm the worker commits `prototypes/<slug>.html` onto the branch (GitHub shows the file) and the kickoff comment.

- [ ] **Step 7: PR**

```bash
git push -u origin task-071-prototype-html-to-issues
gh pr create --title "[TASK-071] HTML prototypes to frontend issues, drop the image pipeline (REQ-030)" --body "…"
```

Body: summarize the redesign (image pipeline removed; label-based generation; model flags frontend tasks; HTML committed to branch + referenced in issue); note the two migrations (hand-applied), no new REQ, worker+web deploy. Squash-merge.

---

## Self-Review

**Spec coverage** (against `2026-06-25-prototype-html-to-issues-design.md`):
- §1 drop `image` → Task 7; `task_prototypes` → Task 2. ✔
- §2 generation labels + `TaskSchema.prototypes` + validation + SYSTEM_PROMPT + persist links → Tasks 3, 4. ✔ Label resolution (non-unique → all matching) → Task 4 Step 3 (`byLabel` map links every matching id). ✔
- §3 issue section → Task 5; branch commit via Contents API + slug → Tasks 5 (slug), 6. ✔
- §4 removals (render/serve/route/worker/vision/thumbnails/column) → Tasks 1, 7. ✔
- §5 `/connect` label-only → Task 1 Step 7. ✔
- Truth model / testing / migration → Global Constraints + Task 7. ✔
- Edge: no prototypes → labels empty, `prototypes: []`, no section, no commit (Tasks 3–6 guard on non-empty). ✔ Cascade on prototype delete → Task 2 FK `onDelete: cascade` (+ Task 2 test). ✔ Slug collision → `slugify` + (acceptable: same-label prototypes share a path; documented). ✔

**Placeholder scan:** the only `…` is the PR body. No TBD/TODO. Removal steps name exact symbols/files.

**Type consistency:** `loadProjectPrototypes → {id,label}[]` (Task 1) consumed in Task 3 (`.map(p=>p.label)`); `SemanticContext.prototypeLabels: Set<string>` (Task 3) matches `semanticErrors` + `generateTasks`'s `new Set(args.prototypeLabels)`; `TaskSchema.prototypes: string[]` (Task 3) read in persist (Task 4) + the issue test (Task 5); `loadTaskPrototypes → {id,label,html}[]` (Task 5) consumed in Task 6; `commitFileToBranch(...)→{committed}` (Task 6) — consistent across tasks.
