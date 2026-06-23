# CLAUDE.md Sync Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-repo "Sync CLAUDE.md" button on Connect that upserts the managed THROUGHLINE block into the repo's CLAUDE.md, commits, and pushes (no-op → "already synced"; missing → create).

**Architecture:** Reuse the existing `upsertManagedBlock` + `managedBlockBody` + `commitFileInClone` + `claude_md.synced` event; add a `pushClone` helper and a `syncClaudeMdForProject` orchestrator that reads the clone's CLAUDE.md, short-circuits when unchanged, else commits+pushes+bumps+emits. Surface it as an auth-guarded server action + a client button under each bound repo.

**Tech Stack:** Next.js 16 App Router (server actions + `useActionState`), Drizzle/Postgres, git CLI via the App token, Node `tsx --test` + PGlite.

## Global Constraints

- **TypeScript; no `any`.** Reuse the ledger design system.
- **Reuse the canonical managed block** (`managedBlockBody()` + the existing `<!-- THROUGHLINE:START/END -->` markers) — no change to block text or markers.
- **`claude_md.synced` is emitted in the same transaction** as the `convention_version` bump, and **only on a real sync** (not a no-op). Commit + push are external, performed **after** the unchanged-check, never inside the event tx.
- **Push targets the repo's default branch** (no PR). Per-project: only that project's clone/repo.
- The Connect server action is **`auth()`-guarded**. `tasks.github_status` untouched.
- New `*.test.ts` files appended to the `package.json` test list. **Commits `[TASK-049]`**, REQ-014, branch `task-049-claude-md-sync-button`.
- **Build before typecheck** for the client-component task.

---

## File Structure

**New**
- `src/components/sync-claude-md-button.tsx` — the client button.
- `src/app/(app)/connect/actions.ts` — the `syncClaudeMd` server action.

**Modified**
- `src/github/commit.ts` — add `pushClone`.
- `src/integrity/claude-md.ts` — add `syncClaudeMdForProject`.
- `src/app/(app)/connect/page.tsx` — render the button under each bound repo.
- `src/github/commit.test.ts` (create if absent) + `src/integrity/claude-md.test.ts` — tests.

---

## Task 1: `pushClone` helper

**Files:** Modify `src/github/commit.ts`; Test `src/github/commit.test.ts` (create); Modify `package.json`.

**Interfaces:**
- Produces: `pushClone(clonePath: string, repoFullName: string, installationId: number, branch: string, deps?: { getToken?: (installationId: number) => Promise<string>; run?: (args: string[], cwd: string) => void }): Promise<void>`.

- [ ] **Step 1: Write the failing test** — `src/github/commit.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { pushClone } from "./commit";

test("pushClone pushes HEAD:<branch> to the token-authenticated origin url", async () => {
  const calls: { args: string[]; cwd: string }[] = [];
  await pushClone("/clones/acme__repo", "acme/repo", 42, "main", {
    getToken: async (id) => `tok-${id}`,
    run: (args, cwd) => calls.push({ args, cwd }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, "/clones/acme__repo");
  assert.deepEqual(calls[0].args, ["push", "https://x-access-token:tok-42@github.com/acme/repo.git", "HEAD:main"]);
});

test("pushClone propagates a git failure", async () => {
  await assert.rejects(
    pushClone("/c", "o/r", 1, "main", {
      getToken: async () => "t",
      run: () => { throw new Error("push rejected"); },
    }),
    /push rejected/,
  );
});
```

- [ ] **Step 2: Append the test to `package.json` and run it (fails)** — add ` src/github/commit.test.ts` to the `test` list. Run: `npx tsx --test src/github/commit.test.ts` → FAIL (`pushClone` not exported).

- [ ] **Step 3: Implement** — add to `src/github/commit.ts` (the file already has the private `git(args, cwd)` runner; add the import):

```ts
import { getInstallationToken } from "./app";

export interface PushDeps {
  getToken?: (installationId: number) => Promise<string>;
  run?: (args: string[], cwd: string) => void;
}

/**
 * Push a clone's branch to origin using a fresh App installation token (REQ-014).
 * Run after committing a managed file (e.g. CLAUDE.md) into the clone. The token
 * getter and git runner are injectable for tests.
 */
export async function pushClone(
  clonePath: string,
  repoFullName: string,
  installationId: number,
  branch: string,
  deps: PushDeps = {},
): Promise<void> {
  const getToken = deps.getToken ?? getInstallationToken;
  const run = deps.run ?? ((args, cwd) => { git(args, cwd); });
  const token = await getToken(installationId);
  const url = `https://x-access-token:${token}@github.com/${repoFullName}.git`;
  run(["push", url, `HEAD:${branch}`], clonePath);
}
```

- [ ] **Step 4: Run the test (passes) + typecheck** — `npx tsx --test src/github/commit.test.ts` → PASS; `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `git add src/github/commit.ts src/github/commit.test.ts package.json && git commit -m "[TASK-049] pushClone: push a clone's branch via the App token (REQ-014)"`

---

## Task 2: `syncClaudeMdForProject` orchestrator

**Files:** Modify `src/integrity/claude-md.ts`, `src/integrity/claude-md.test.ts`.

**Interfaces:**
- Consumes: `upsertManagedBlock`, `managedBlockBody` (same file); `commitFileInClone`, `pushClone` (`../github/commit`).
- Produces: `syncClaudeMdForProject(db, projectId: string, deps?: { readFile?: (p: string) => string; commit?: typeof commitFileInClone; push?: typeof pushClone }): Promise<{ status: "synced" | "already-synced"; sha?: string; conventionVersion?: number }>`.

- [ ] **Step 1: Write the failing tests** — append to `src/integrity/claude-md.test.ts` (add imports: `syncClaudeMdForProject`, `managedBlockBody`, `upsertManagedBlock`, `events`, `eq`):

```ts
import { syncClaudeMdForProject, managedBlockBody, upsertManagedBlock } from "./claude-md";
import { events } from "../db/schema";
import { eq } from "drizzle-orm";

async function seedProj(db: Awaited<ReturnType<typeof createTestDb>>["db"]) {
  const [p] = await db.insert(project).values({
    repoFullName: "acme/repo", installationId: 7, defaultBranch: "main",
    localClonePath: "/clones/acme__repo", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
  }).returning({ id: project.id, conventionVersion: project.conventionVersion });
  return p;
}

test("syncClaudeMdForProject: already-synced when the block is present + identical (no commit/push/event)", async () => {
  const { db, close } = await createTestDb();
  try {
    const p = await seedProj(db);
    const existing = upsertManagedBlock("# CLAUDE.md\n", managedBlockBody()); // already up to date
    let committed = false, pushed = false;
    const r = await syncClaudeMdForProject(db, p.id, {
      readFile: () => existing,
      commit: () => { committed = true; return { sha: "x" }; },
      push: async () => { pushed = true; },
    });
    assert.equal(r.status, "already-synced");
    assert.equal(committed, false);
    assert.equal(pushed, false);
    const evs = await db.select().from(events).where(eq(events.type, "claude_md.synced"));
    assert.equal(evs.length, 0);
  } finally { await close(); }
});

test("syncClaudeMdForProject: creates + commits + pushes + bumps + emits when missing", async () => {
  const { db, close } = await createTestDb();
  try {
    const p = await seedProj(db);
    let committedContent = "", pushedArgs: unknown[] = [];
    const r = await syncClaudeMdForProject(db, p.id, {
      readFile: () => "", // no CLAUDE.md
      commit: (_clone, _rel, content) => { committedContent = content; return { sha: "sha1" }; },
      push: async (clone, repo, inst, branch) => { pushedArgs = [clone, repo, inst, branch]; },
    });
    assert.equal(r.status, "synced");
    assert.equal(r.sha, "sha1");
    assert.match(committedContent, /THROUGHLINE:START/);
    assert.deepEqual(pushedArgs, ["/clones/acme__repo", "acme/repo", 7, "main"]);
    const [ev] = await db.select().from(events).where(eq(events.type, "claude_md.synced"));
    assert.ok(ev);
    assert.equal(ev.projectId, p.id);
    const [proj] = await db.select({ v: project.conventionVersion }).from(project).where(eq(project.id, p.id));
    assert.equal(proj.v, p.conventionVersion + 1);
  } finally { await close(); }
});

test("syncClaudeMdForProject: upserts the block into an existing CLAUDE.md (synced)", async () => {
  const { db, close } = await createTestDb();
  try {
    const p = await seedProj(db);
    let committedContent = "";
    const r = await syncClaudeMdForProject(db, p.id, {
      readFile: () => "# CLAUDE.md\n\nSome notes.\n", // present, no block
      commit: (_c, _r, content) => { committedContent = content; return { sha: "s" }; },
      push: async () => {},
    });
    assert.equal(r.status, "synced");
    assert.match(committedContent, /Some notes\./); // surrounding content preserved
    assert.match(committedContent, /THROUGHLINE:START/);
  } finally { await close(); }
});
```

- [ ] **Step 2: Run it (fails)** — `npx tsx --test src/integrity/claude-md.test.ts` → FAIL (`syncClaudeMdForProject` not exported).

- [ ] **Step 3: Implement** — append to `src/integrity/claude-md.ts` (add imports `fs`, `path`, and `commitFileInClone`/`pushClone` from `../github/commit`):

```ts
import fs from "node:fs";
import path from "node:path";
import { commitFileInClone, pushClone } from "../github/commit";

export interface SyncForProjectDeps {
  readFile?: (absPath: string) => string;
  commit?: typeof commitFileInClone;
  push?: typeof pushClone;
}

/**
 * Sync the managed CLAUDE.md block for one project (REQ-014), in-app: read the
 * repo's CLAUDE.md from its clone, upsert the managed region, and — only if it
 * changed — commit, push to the default branch, bump convention_version, and emit
 * claude_md.synced. No-op (already-synced) when the block is already current;
 * creates the file when absent. fs/commit/push are injectable for tests.
 */
export async function syncClaudeMdForProject(
  db: Db,
  projectId: string,
  deps: SyncForProjectDeps = {},
): Promise<{ status: "synced" | "already-synced"; sha?: string; conventionVersion?: number }> {
  const [proj] = await db
    .select({
      id: project.id,
      localClonePath: project.localClonePath,
      claudeMdPath: project.claudeMdPath,
      repoFullName: project.repoFullName,
      installationId: project.installationId,
      defaultBranch: project.defaultBranch,
      conventionVersion: project.conventionVersion,
    })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!proj) throw new Error("Project not found.");

  const readFile = deps.readFile ?? ((p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } });
  const commit = deps.commit ?? commitFileInClone;
  const push = deps.push ?? pushClone;

  const current = readFile(path.join(proj.localClonePath, proj.claudeMdPath));
  const next = upsertManagedBlock(current, managedBlockBody());
  if (next === current) return { status: "already-synced" };

  const { sha } = await commit(proj.localClonePath, proj.claudeMdPath, next, "[claude-md] sync conventions");
  await push(proj.localClonePath, proj.repoFullName, proj.installationId, proj.defaultBranch);

  const nextVersion = proj.conventionVersion + 1;
  await db.transaction(async (tx) => {
    await tx.update(project).set({ conventionVersion: nextVersion }).where(eq(project.id, proj.id));
    await emitEvent(tx, {
      type: "claude_md.synced",
      subjectType: "project",
      subjectId: proj.id,
      payload: { convention_version: nextVersion },
      projectId: proj.id,
    });
  });
  return { status: "synced", sha, conventionVersion: nextVersion };
}
```

- [ ] **Step 4: Run the tests (pass) + typecheck** — `npx tsx --test src/integrity/claude-md.test.ts` → PASS (existing + 3 new); `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `git add src/integrity/claude-md.ts src/integrity/claude-md.test.ts && git commit -m "[TASK-049] syncClaudeMdForProject: read clone, upsert block, commit+push (REQ-014)"`

---

## Task 3: Connect action + button + verify

**Files:** Create `src/app/(app)/connect/actions.ts`, `src/components/sync-claude-md-button.tsx`; Modify `src/app/(app)/connect/page.tsx`.

**Interfaces:**
- `syncClaudeMd(prev: SyncState, formData: FormData): Promise<SyncState>` where `SyncState = { ok: true; status: "synced" | "already-synced" } | { ok: false; error: string } | null`.
- `SyncClaudeMdButton({ projectId }: { projectId: string })`.

- [ ] **Step 1: The server action** — `src/app/(app)/connect/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { syncClaudeMdForProject } from "@/integrity/claude-md";

export type SyncState = { ok: true; status: "synced" | "already-synced" } | { ok: false; error: string } | null;

export async function syncClaudeMd(_prev: SyncState, formData: FormData): Promise<SyncState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { ok: false, error: "Missing project." };
  try {
    const r = await syncClaudeMdForProject(getDb(), projectId);
    revalidatePath("/connect");
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sync failed." };
  }
}
```

- [ ] **Step 2: The client button** — `src/components/sync-claude-md-button.tsx`:

```tsx
"use client";
import { useActionState } from "react";
import { syncClaudeMd, type SyncState } from "@/app/(app)/connect/actions";
import { buttonClass } from "@/components/ui";

export function SyncClaudeMdButton({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<SyncState, FormData>(syncClaudeMd, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <button type="submit" disabled={pending} className={buttonClass("quiet")}>
        {pending ? "Syncing…" : "Sync CLAUDE.md"}
      </button>
      {state?.ok === true && (
        <span className="text-xs text-shipped">{state.status === "synced" ? "✓ synced + pushed" : "already synced"}</span>
      )}
      {state?.ok === false && <span className="text-xs text-risk">{state.error}</span>}
    </form>
  );
}
```

- [ ] **Step 3: Wire into the Connect page** — in `src/app/(app)/connect/page.tsx`, import `{ SyncClaudeMdButton } from "@/components/sync-claude-md-button";` and render `<SyncClaudeMdButton projectId={p.id} />` inside each bound-project row (the `boundProjects.map(...)` block, near the active marker). Keep the existing bind form + active-project rendering unchanged.

- [ ] **Step 4: Build + typecheck** — `npm run build` then `npm run typecheck` → both clean.

- [ ] **Step 5: Full suite** — stop any `:3000` server; `npm test` → all pass.

- [ ] **Step 6: Runtime (controller + user)** — rebuild + restart; on `/connect`, click **Sync CLAUDE.md** under orbit → the managed block appears on `orbit`'s `CLAUDE.md` on GitHub (committed + pushed to the default branch); a second click → **"already synced"**.

- [ ] **Step 7: Commit + hand off** — `git add "src/app/(app)/connect/actions.ts" "src/components/sync-claude-md-button.tsx" "src/app/(app)/connect/page.tsx" && git commit -m "[TASK-049] Connect: per-repo Sync CLAUDE.md button (REQ-014)"`; ready for finishing-a-development-branch.

---

## Self-Review

**Spec coverage:** `pushClone` → Task 1; `syncClaudeMdForProject` (no-op/create/upsert + commit+push+bump+event) → Task 2; Connect action + per-repo button → Task 3; runtime push-to-default-branch → Task 3 Step 6. Truth model: event+bump in one tx and only on a real sync (Task 2 test asserts the no-op emits nothing); commit/push external + after the unchanged-check; auth-guarded action.

**Placeholder scan:** every code/test step is complete with commands + expected results. No TBD.

**Type consistency:** `pushClone(clonePath, repoFullName, installationId, branch, deps?) → Promise<void>`; `syncClaudeMdForProject(db, projectId, deps?) → { status; sha?; conventionVersion? }` (deps `commit: typeof commitFileInClone`, `push: typeof pushClone`); `SyncState`/`syncClaudeMd(prev, formData)` match `useActionState<SyncState, FormData>`; `SyncClaudeMdButton({ projectId })` consumed in the page with `projectId={p.id}`. Reuses `upsertManagedBlock`/`managedBlockBody`/`commitFileInClone`/`emitEvent` unchanged.
