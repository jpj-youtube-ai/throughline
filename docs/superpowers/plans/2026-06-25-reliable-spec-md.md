# Reliable SPEC.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "View SPEC.md" always show the current spec (render from the DB) and make materialization robust + idempotent (sync → commit → push, emit-only-on-change) so the committed SPEC.md stays current on GitHub across all paths.

**Architecture:** Extract `buildSpecContent(db, projectId)` (the requirements+tasks projection) and use it for both the board view and materialize. Refactor `materializeSpec` to mirror the proven CLAUDE.md-sync pipeline (reconcile clone to remote → write → commit → push → emit, no-op when unchanged) and have the worker run it every tick. The board's `SpecDocument` renders `buildSpecContent` directly, decoupled from the clone file.

**Tech Stack:** TypeScript, Next.js (App Router), Postgres + Drizzle, `node:test` + PGlite, git via `node:child_process` (existing `src/github/commit.ts` helpers).

**Design doc:** `docs/superpowers/specs/2026-06-25-reliable-spec-md-design.md`

## Global Constraints

- **Requirement linkage:** REQ-012 (materialization) for materialize+worker; REQ-017 (spec surface) for the view. (Confirm the split at review.)
- **Truth model:** the DB requirements are the source; SPEC.md is the projection. The view renders it read-only (no events). `materializeSpec` emits `spec.materialized` **in the same transaction** as the commit, and **only when the content actually changed** (parity with `claude_md.synced`). `github_status` untouched. Events append-only.
- **External git/network is best-effort in the worker:** the worker's materialize step is wrapped in try/catch + log (a failure never aborts the tick). External calls run **outside** any DB transaction.
- **Sole writer of SPEC.md:** materialize is the only writer, so comparing the rendered content to the clone's SPEC.md is a reliable staleness signal (used for the no-op fast path).
- **No `any` in domain code.**
- **Conventions:** branch `task-066-reliable-spec-md`; PR title + squash start with `[TASK-066]`. (Confirm `TASK-066` is the next free id.)
- **Every commit message ends with:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **New `*.test.ts` MUST be registered** in the `package.json` `test` script (enumerated, not globbed).
- **No schema change → no migration.**

## Setup (before Task 1)

```bash
git switch -c task-066-reliable-spec-md
```

---

## File Structure

- `src/spec/content.ts` — `buildSpecContent` (create; shared by view + materialize).
- `src/spec/content.test.ts` — tests (create + register).
- `src/spec/materialize.ts` — idempotent sync→commit→push; uses `buildSpecContent` (modify).
- `src/spec/materialize.test.ts` — rewrite the materialize tests (keep the `renderSpec` test).
- `src/spec/commit.ts` — delete (`repoCommit` becomes unused).
- `src/worker/index.ts` — materialize every tick; status-aware log (modify).
- `src/worker/worker.test.ts` — update stubs + add an every-tick test (modify).
- `src/app/(app)/spec/spec-document.tsx` — render from `buildSpecContent` (modify).
- `src/spec/read.ts` + `src/spec/read.test.ts` — delete (`readSpec` becomes unused); unregister the test.

---

## Task 1: Extract `buildSpecContent`

**Files:**
- Create: `src/spec/content.ts`
- Create: `src/spec/content.test.ts`
- Modify: `src/spec/materialize.ts` (use `buildSpecContent`; no behavior change)
- Modify: `package.json` (register the test)

**Interfaces:**
- Consumes: `renderSpec`, `SpecRequirement`, `SpecTaskRef` (`./render`).
- Produces: `buildSpecContent(db: Db, projectId: string): Promise<{ content: string; requirementCount: number }>`. Consumed by Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests**

Create `src/spec/content.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { project, requirements, tasks } from "../db/schema";
import { buildSpecContent } from "./content";

async function seed(db: Db, repo: string, inst: number): Promise<string> {
  const [p] = await db.insert(project).values({ repoFullName: repo, defaultBranch: "main", installationId: inst, localClonePath: "/x" }).returning({ id: project.id });
  return p.id;
}

test("buildSpecContent renders the project's requirements + linked tasks", async () => {
  const { db, close } = await createTestDb();
  try {
    const pid = await seed(db, "a/b", 1);
    const [r] = await db.insert(requirements).values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported", status: "shipped", projectId: pid }).returning({ id: requirements.id });
    await db.insert(tasks).values({ key: "TASK-001", title: "Build the log", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: pid });

    const { content, requirementCount } = await buildSpecContent(db, pid);
    assert.equal(requirementCount, 1);
    assert.match(content, /### REQ-003 — Event log/);
    assert.match(content, /TASK-001/);
  } finally { await close(); }
});

test("buildSpecContent is project-scoped; zero for an empty project", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seed(db, "a/alpha", 1);
    const b = await seed(db, "a/beta", 2);
    await db.insert(requirements).values({ key: "REQ-001", title: "Alpha req", description: "d", provenance: "imported", status: "planned", projectId: a });

    const ra = await buildSpecContent(db, a);
    assert.equal(ra.requirementCount, 1);
    assert.match(ra.content, /Alpha req/);

    const rb = await buildSpecContent(db, b);
    assert.equal(rb.requirementCount, 0);
    assert.doesNotMatch(rb.content, /Alpha req/);
  } finally { await close(); }
});
```

- [ ] **Step 2: Register the test in `package.json`**

Append ` src/spec/content.test.ts` to the `"test"` script list.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx tsx --test src/spec/content.test.ts`
Expected: FAIL — `buildSpecContent` not exported (module missing).

- [ ] **Step 4: Create `buildSpecContent`**

Create `src/spec/content.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { requirements, tasks } from "../db/schema";
import { renderSpec, type SpecRequirement, type SpecTaskRef } from "./render";

/**
 * Build the materialized SPEC.md content for a project from its requirements +
 * linked tasks (REQ-012/017). The DB requirements are the source of truth; this
 * renders the projection. Read-only. Returns the markdown and the requirement
 * count (for the empty-state check and the materialize event payload).
 */
export async function buildSpecContent(
  db: Db,
  projectId: string,
): Promise<{ content: string; requirementCount: number }> {
  const reqs: SpecRequirement[] = await db
    .select({ key: requirements.key, title: requirements.title, description: requirements.description, status: requirements.status })
    .from(requirements)
    .where(eq(requirements.projectId, projectId));
  const taskRefs: SpecTaskRef[] = await db
    .select({ key: tasks.key, title: tasks.title, requirementKey: requirements.key })
    .from(tasks)
    .innerJoin(requirements, eq(tasks.requirementId, requirements.id))
    .where(eq(requirements.projectId, projectId));
  return { content: renderSpec(reqs, taskRefs), requirementCount: reqs.length };
}
```

- [ ] **Step 5: Refactor `materializeSpec` to use it (no behavior change)**

In `src/spec/materialize.ts`, after the project is resolved (the `const projectId = proj.id;` line), replace the inline `reqs`/`taskRefs` selects + `renderSpec` (the block that builds `content`) with:

```ts
  const { content, requirementCount } = await buildSpecContent(db, projectId);
```

Update the event payload + return to use `requirementCount` instead of `reqs.length`:

```ts
  const { sha } = await commit(content);
  await db.transaction(async (tx) => {
    await emitEvent(tx, {
      type: "spec.materialized",
      subjectType: "project",
      payload: { count: requirementCount, commit_sha: sha },
      projectId,
    });
  });
  return { requirementCount, sha };
```

Add the import `import { buildSpecContent } from "./content";` and remove the now-unused `renderSpec`/`SpecRequirement`/`SpecTaskRef` imports and the `requirements`/`tasks` imports if they're no longer referenced in `materialize.ts`. (Leave the rest of the overload/commit logic unchanged for now — Task 2 rewrites it.)

- [ ] **Step 6: Run the tests**

Run: `npx tsx --test src/spec/content.test.ts src/spec/materialize.test.ts`
Expected: PASS (the new content tests + the existing materialize tests, unchanged behavior).

- [ ] **Step 7: Commit**

```bash
git add src/spec/content.ts src/spec/content.test.ts src/spec/materialize.ts package.json
git commit -m "$(cat <<'EOF'
[TASK-066] extract buildSpecContent (shared spec projection) (REQ-012)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Idempotent materialize (sync→commit→push) + worker every tick

**Files:**
- Modify: `src/spec/materialize.ts` (rewrite signature + pipeline)
- Modify: `src/spec/materialize.test.ts` (rewrite the materialize tests; keep the `renderSpec` test)
- Delete: `src/spec/commit.ts` (`repoCommit` unused)
- Modify: `src/worker/index.ts` (materialize every tick; status-aware log)
- Modify: `src/worker/worker.test.ts` (update `specMaterialize` stubs; add every-tick test)

**Interfaces:**
- Consumes: `buildSpecContent` (Task 1); `syncCloneToRemote`, `commitFileInClone`, `pushClone` (`../github/commit`).
- Produces:
  - `interface MaterializeDeps { syncRemote?: typeof syncCloneToRemote; readFile?: (absPath: string) => string; commit?: typeof commitFileInClone; push?: typeof pushClone }`
  - `interface MaterializeResult { status: "materialized" | "already-materialized"; requirementCount: number; sha?: string }`
  - `materializeSpec(db: Db, projectId?: string, deps?: MaterializeDeps): Promise<MaterializeResult>`

- [ ] **Step 1: Write the failing materialize tests**

Replace the two `materializeSpec(...)` tests in `src/spec/materialize.test.ts` (keep the first `renderSpec` test). New imports at top: add `path`? no — use injected `readFile`. Ensure imports include `createTestDb`, `project`, `requirements`, `tasks`, `events`, `eq`, `buildSpecContent` (from `./content`), `materializeSpec` (from `./materialize`):

```ts
import { buildSpecContent } from "./content";

async function seedProj(db: Awaited<ReturnType<typeof createTestDb>>["db"]) {
  const [p] = await db.insert(project).values({
    repoFullName: "acme/repo", installationId: 7, defaultBranch: "main",
    localClonePath: "/clones/acme__repo", specPath: "SPEC.md",
  }).returning({ id: project.id });
  return p.id;
}

test("materializeSpec is a no-op when the clone already matches (no fetch/commit/push/event)", async () => {
  const { db, close } = await createTestDb();
  try {
    const pid = await seedProj(db);
    await db.insert(requirements).values({ key: "REQ-001", title: "A", description: "d", provenance: "imported", status: "planned", projectId: pid });
    const { content } = await buildSpecContent(db, pid); // exactly what the clone "has"

    let synced = false, committed = false, pushed = false;
    const r = await materializeSpec(db, pid, {
      syncRemote: async () => { synced = true; },
      readFile: () => content,
      commit: () => { committed = true; return { sha: "x" }; },
      push: async () => { pushed = true; },
    });
    assert.equal(r.status, "already-materialized");
    assert.equal(synced, false, "fast path: no fetch when local already matches");
    assert.equal(committed, false);
    assert.equal(pushed, false);
    assert.equal((await db.select().from(events).where(eq(events.type, "spec.materialized"))).length, 0);
  } finally { await close(); }
});

test("materializeSpec reconciles, commits, pushes, and emits when content differs", async () => {
  const { db, close } = await createTestDb();
  try {
    const pid = await seedProj(db);
    const [r1] = await db.insert(requirements).values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported", status: "shipped", projectId: pid }).returning({ id: requirements.id });
    await db.insert(tasks).values({ key: "TASK-001", title: "Build the log", body: "b", requirementId: r1.id, effort: 1, risk: "low", confidence: 50, projectId: pid });

    let committedContent = "", syncedArgs: unknown[] = [], pushedArgs: unknown[] = [];
    const r = await materializeSpec(db, pid, {
      syncRemote: async (clone, repo, inst, branch) => { syncedArgs = [clone, repo, inst, branch]; },
      readFile: () => "", // clone has no SPEC.md
      commit: (_clone, _rel, content) => { committedContent = content; return { sha: "sha1" }; },
      push: async (clone, repo, inst, branch) => { pushedArgs = [clone, repo, inst, branch]; },
    });
    assert.equal(r.status, "materialized");
    assert.equal(r.sha, "sha1");
    assert.equal(r.requirementCount, 1);
    assert.match(committedContent, /### REQ-003 — Event log/);
    assert.deepEqual(syncedArgs, ["/clones/acme__repo", "acme/repo", 7, "main"]); // reconciled first
    assert.deepEqual(pushedArgs, ["/clones/acme__repo", "acme/repo", 7, "main"]);
    const [ev] = await db.select().from(events).where(eq(events.type, "spec.materialized"));
    assert.ok(ev);
    assert.deepEqual(ev.payload, { count: 1, commit_sha: "sha1" });
    assert.equal(ev.projectId, pid);
  } finally { await close(); }
});

test("materializeSpec scopes to the target project's requirements", async () => {
  const { db, close } = await createTestDb();
  try {
    const [pa] = await db.insert(project).values({ repoFullName: "acme/alpha", installationId: 1, defaultBranch: "main", localClonePath: "/a", specPath: "SPEC.md" }).returning({ id: project.id });
    const [pb] = await db.insert(project).values({ repoFullName: "acme/beta", installationId: 2, defaultBranch: "main", localClonePath: "/b", specPath: "SPEC.md" }).returning({ id: project.id });
    await db.insert(requirements).values({ key: "REQ-001", title: "Alpha req", description: "d", provenance: "imported", status: "planned", projectId: pa.id });
    await db.insert(requirements).values({ key: "REQ-001", title: "Beta req", description: "d", provenance: "imported", status: "planned", projectId: pb.id });

    let captured = "";
    await materializeSpec(db, pa.id, { syncRemote: async () => {}, readFile: () => "", commit: (_c, _r, content) => { captured = content; return { sha: "s" }; }, push: async () => {} });
    assert.match(captured, /Alpha req/);
    assert.doesNotMatch(captured, /Beta req/);
  } finally { await close(); }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/spec/materialize.test.ts`
Expected: FAIL — the new `deps`/`status` shape isn't implemented (the current `materializeSpec(db, commit)` overload + `MaterializeResult` lack `status`/deps).

- [ ] **Step 3: Rewrite `materializeSpec`**

Replace `src/spec/materialize.ts` with:

```ts
import fs from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { project } from "../db/schema";
import { emitEvent } from "../db/events";
import { buildSpecContent } from "./content";
import { commitFileInClone, pushClone, syncCloneToRemote } from "../github/commit";

export interface MaterializeDeps {
  syncRemote?: typeof syncCloneToRemote;
  readFile?: (absPath: string) => string;
  commit?: typeof commitFileInClone;
  push?: typeof pushClone;
}

export interface MaterializeResult {
  status: "materialized" | "already-materialized";
  requirementCount: number;
  sha?: string;
}

/**
 * Materialize the spec (REQ-012): render the requirements projection, and — only
 * when it differs from the committed SPEC.md — reconcile the clone with the remote,
 * commit, push to the default branch, and emit spec.materialized (in-tx). Idempotent:
 * a no-op (no fetch/commit/push/event) when the projection already matches the clone.
 * Mirrors syncClaudeMdForProject. fs/commit/push/sync injectable for tests. When
 * projectId is omitted, defaults to the oldest project.
 */
export async function materializeSpec(
  db: Db,
  projectId?: string,
  deps: MaterializeDeps = {},
): Promise<MaterializeResult> {
  const cols = {
    id: project.id,
    localClonePath: project.localClonePath,
    specPath: project.specPath,
    repoFullName: project.repoFullName,
    installationId: project.installationId,
    defaultBranch: project.defaultBranch,
  };
  const [proj] = projectId
    ? await db.select(cols).from(project).where(eq(project.id, projectId)).limit(1)
    : await db.select(cols).from(project).orderBy(asc(project.createdAt)).limit(1);
  if (!proj) throw new Error("No project bound (REQ-002).");

  const syncRemote = deps.syncRemote ?? syncCloneToRemote;
  const readFile = deps.readFile ?? ((p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } });
  const commit = deps.commit ?? commitFileInClone;
  const push = deps.push ?? pushClone;

  const { content, requirementCount } = await buildSpecContent(db, proj.id);
  const specFile = path.join(proj.localClonePath, proj.specPath);

  // Fast no-op: we are the sole writer of SPEC.md, so the local file reflects the
  // last pushed projection. If it already matches, skip the fetch entirely.
  if (content === readFile(specFile)) {
    return { status: "already-materialized", requirementCount };
  }

  // Differs — reconcile with the remote tip (kills divergence/clobber), then
  // re-check before committing (the remote may already carry the same content).
  await syncRemote(proj.localClonePath, proj.repoFullName, proj.installationId, proj.defaultBranch);
  if (content === readFile(specFile)) {
    return { status: "already-materialized", requirementCount };
  }

  const { sha } = commit(proj.localClonePath, proj.specPath, content, "[spec] materialize requirements");
  await push(proj.localClonePath, proj.repoFullName, proj.installationId, proj.defaultBranch);

  await db.transaction(async (tx) => {
    await emitEvent(tx, {
      type: "spec.materialized",
      subjectType: "project",
      payload: { count: requirementCount, commit_sha: sha },
      projectId: proj.id,
    });
  });
  return { status: "materialized", requirementCount, sha };
}
```

- [ ] **Step 4: Delete the now-unused `repoCommit`**

```bash
git rm src/spec/commit.ts
```

(Confirm no other importer: `grep -rn "spec/commit" src` should return nothing after this. `repoCommit` had only `materialize.ts` as a consumer.)

- [ ] **Step 5: Run the materialize tests**

Run: `npx tsx --test src/spec/materialize.test.ts`
Expected: PASS (renderSpec test + the three rewritten tests).

- [ ] **Step 6: Worker — materialize every tick**

In `src/worker/index.ts`, replace the `if (didGenerate) { … specMaterialize … }` block with an unconditional, status-aware step (place it where the materialize step currently is):

```ts
  // Re-materialize the spec every tick (REQ-012). materializeSpec is a cheap no-op
  // when the projection already matches the committed SPEC.md, so this safely covers
  // every path that changes requirements/tasks (genesis import, requirement-driven
  // generation, idea generation) and self-heals. Best-effort: a git/network failure
  // is logged and never aborts the tick.
  try {
    const m = await specMaterialize(db, proj.id);
    if (m.status === "materialized") {
      console.error(`[worker][${proj.id}] spec materialized (${m.requirementCount} reqs, ${m.sha?.slice(0, 7)})`);
    }
  } catch (e) {
    console.error(`[worker][${proj.id}] spec materialization skipped:`, formatError(e));
  }
```

`didGenerate` is still set by the generation loop and returned by `tickForProject`; only the materialize gate is removed. (`MaterializeResult` is already imported in this file.)

- [ ] **Step 7: Update worker test stubs + add the every-tick test**

In `src/worker/worker.test.ts`, every existing `deps: WorkerDeps` object has a `specMaterialize` stub like `async () => ({ requirementCount: 0, sha: "abc1234" })`. Update each to include the new required `status` field:

```ts
      specMaterialize: async () => ({ status: "already-materialized", requirementCount: 0 }),
```

Then append a new test:

```ts
test("tick materializes every project each tick, even when nothing was generated", async () => {
  const { db, close } = await createTestDb();
  try {
    const projAId = await seedProject(db, "acme/repo-a"); // no approved ideas → no generation
    const materializeCalls: string[] = [];
    const deps: WorkerDeps = {
      refreshClone: async () => {},
      generate: async () => ({ ok: true, taskKeys: [] }),
      createIssues: async () => ({ created: [] }),
      createBranches: async () => ({ created: [] }),
      closeIssues: async () => ({ closed: [] }),
      specMaterialize: async (_d, pid) => { materializeCalls.push(pid); return { status: "already-materialized", requirementCount: 0 }; },
      digest: async () => ({ generated: false, reason: "nothing new" }),
    };
    await tick(db, deps);
    assert.deepEqual(materializeCalls, [projAId], "materialize runs each tick regardless of generation");
  } finally { await close(); }
});
```

- [ ] **Step 8: Run worker tests + typecheck**

Run: `npx tsx --test src/worker/worker.test.ts`
Expected: PASS (all existing + the new every-tick test).
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/spec/materialize.ts src/spec/materialize.test.ts src/worker/index.ts src/worker/worker.test.ts
git rm src/spec/commit.ts 2>/dev/null; git add -A src/spec/commit.ts 2>/dev/null
git commit -m "$(cat <<'EOF'
[TASK-066] idempotent materialize (sync/commit/push) + worker every tick (REQ-012)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Board view renders from the DB

**Files:**
- Modify: `src/app/(app)/spec/spec-document.tsx`
- Delete: `src/spec/read.ts`, `src/spec/read.test.ts`
- Modify: `package.json` (unregister `src/spec/read.test.ts`)

**Interfaces:**
- Consumes: `buildSpecContent` (Task 1).

> No unit test for the React component (repo convention) — verified by typecheck + build + the runtime walkthrough (Task 4).

- [ ] **Step 1: Render from `buildSpecContent`**

In `src/app/(app)/spec/spec-document.tsx`, replace the `readSpec` import and the data read. Change the import line:

```ts
import { buildSpecContent } from "@/spec/content";
```

(remove `import { readSpec } from "@/spec/read";`). Then change the body of `SpecDocument`:

```ts
export async function SpecDocument() {
  const pid = await activeProjectId();
  const { content, requirementCount } = await buildSpecContent(getDb(), pid);
  if (requirementCount === 0) {
    return <Empty title="No requirements yet.">SPEC.md is generated from the requirements — import or vote some in first.</Empty>;
  }
  return (
    <div className="max-w-prose">
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  );
}
```

(The `components` map and other imports stay.)

- [ ] **Step 2: Delete the dead `readSpec`**

Confirm no remaining consumer, then delete:

```bash
grep -rn "spec/read" src   # expect: no hits after the spec-document edit
git rm src/spec/read.ts src/spec/read.test.ts
```

Remove ` src/spec/read.test.ts` from the `package.json` `"test"` script.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck` then `npm run build`
Expected: both clean (no dangling `readSpec` references).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/spec/spec-document.tsx" package.json
git rm src/spec/read.ts src/spec/read.test.ts 2>/dev/null; git add -A
git commit -m "$(cat <<'EOF'
[TASK-066] render SPEC.md view from the DB projection; retire readSpec (REQ-017)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Verify, review, and open the PR

**Files:** none (verification + review + integration).

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all pass (incl. the new `content` tests, rewritten `materialize` tests, and the worker every-tick test; `read.test.ts` gone). (Transient V8/JIT crash on first run on this Windows/Node 24 box → re-run once.)

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck` then `npm run build`
Expected: both clean.

- [ ] **Step 3: Event-integrity review**

Dispatch the `event-integrity-reviewer` agent on the diff. It must confirm: `spec.materialized` is still emitted in the same tx as the commit and ONLY when content changed (no event on the no-op path); the external git ops run outside any tx; the worker step is best-effort; the view is read-only (no events); `github_status` untouched; no `any`; maps to REQ-012/REQ-017. Address findings (apply `receiving-code-review` rigor), re-running the suite after changes.

- [ ] **Step 4: Runtime walkthrough**

With the worker + web on the merged code, against a project that has requirements but a never-materialized SPEC.md (or a fresh test project): (a) "View SPEC.md" shows the rendered spec immediately (from the DB), no empty state; (b) within a tick, the worker logs `spec materialized (...)` and the SPEC.md commit appears on the project's GitHub default branch; (c) subsequent ticks log nothing for materialize (no-op) — confirm no `spec.materialized` event spam. Confirm an empty (no-requirements) project still shows the empty state.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin task-066-reliable-spec-md
gh pr create --title "[TASK-066] reliable SPEC.md: view from source + robust materialize (REQ-012, REQ-017)" --body "…"
```

PR body: summarize the view-from-DB + idempotent sync→commit→push materialize + worker-every-tick; note SPEC.md now reaches GitHub and the clone-divergence fragility is resolved; no schema change → no migration; link the design doc. Squash-merge so `[TASK-066]` lands as one line.

---

## Self-Review

**Spec coverage** (against `2026-06-25-reliable-spec-md-design.md`):
- Part A (view renders from DB; empty only when no reqs; retire readSpec) → Task 3. ✔
- Part B (idempotent materialize: no-op pre-check, sync→commit→push, emit-on-change) → Task 2 (+ `buildSpecContent` Task 1). ✔
- Part C (worker materializes every tick) → Task 2 (Steps 6-8). ✔
- Truth model (event in-tx + only on change; external outside tx; best-effort worker; view read-only) → Global Constraints + Task 2 + Task 4 Step 3. ✔
- `buildSpecContent` shared by view + materialize → Tasks 1, 2, 3. ✔
- Remove `repoCommit` / `readSpec` → Tasks 2, 3. ✔
- REQ-012 + REQ-017 linkage → Global Constraints. ✔

**Placeholder scan:** the only `…` is the `gh pr create` body — intentional. No TBD/TODO.

**Type consistency:** `buildSpecContent(db, projectId) → { content, requirementCount }` used identically in Tasks 1/2/3. `materializeSpec(db, projectId?, deps?) → MaterializeResult { status, requirementCount, sha? }` defined in Task 2 and consumed by the worker (Task 2 Steps 6-7) + the worker stubs (`status` added). `MaterializeDeps { syncRemote, readFile, commit, push }` matches the injected fakes in the tests and the real `syncCloneToRemote`/`commitFileInClone`/`pushClone` signatures. Existing callers `materializeSpec(db, pid)` / `materializeSpec(db)` remain valid under the new `(db, projectId?, deps?)` signature.
