# Multi-project Phase C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-project real end-to-end — bind multiple repos, switch the active one per-user, and have all operations + the worker target the correct project.

**Architecture:** `bindProject` adds a project (unique repo); a per-user switcher sets `users.active_project_id`; every operation (generation/issues/branches/spec/digest/reconcile) loads the **subject's** project instead of "the one project"; the worker iterates all projects. Reads already scope (Phase B); the data model already scopes (Phase A).

**Tech Stack:** Next.js 16 App Router (server components + `useActionState`/server actions), Drizzle/Postgres (+ one migration), octokit, Node `tsx --test` + PGlite.

## Global Constraints

- **TypeScript; no `any`.** Reuse the ledger design system — no new theme.
- **Operations resolve the SUBJECT's project** — load the `project` row by the subject's `projectId` (idea/requirement/task), or take an explicit `projectId` param called per-project; never `select().from(project).limit(1)` ("the one project") anymore.
- **The worker tick iterates every project** (`listProjects(db)`); each operation runs scoped to a project's id + clone.
- **Per-project clone + `SPEC.md`** — each project materializes/commits its own spec into its own clone; never cross-write. **`tasks.github_status` stays webhook-only**; the webhook maps the incoming repo → its `project` row.
- **Switching active project is per-user UI state** (`users.active_project_id`) — **not an event** (it's a preference, not project history). `setActiveProject` is **`auth()`-guarded** and only writes the caller's row.
- `bindProject` **adds** a project, refusing a **duplicate `repoFullName`**; a `unique(project.repo_full_name)` migration is added and **applied to the live DB by hand** (db:migrate is fresh-provision only — see the migrations memory).
- New `*.test.ts` files appended to the `package.json` test list. **Commits `[TASK-047]`**, REQ-029, branch `task-047-multiproject-phase-c`.
- **Build before typecheck** when adding client components / layout changes.

---

## File Structure

**New**
- `src/project/list.ts` — `listProjects(db): { id, repoFullName, defaultBranch }[]`.
- `src/components/project-switcher.tsx` — client switcher.
- `src/app/(app)/active/actions.ts` — `setActiveProject`.
- A migration `drizzle/NNNN_*.sql` — `unique(project.repo_full_name)`.

**Modified**
- `src/db/schema.ts` — `unique` on `project.repoFullName`.
- `src/project/bind.ts` — add (not refuse) + duplicate-repo guard.
- `src/project/connect.ts` + `src/app/(app)/connect/page.tsx` — bind-another + activate.
- `src/app/(app)/layout.tsx` — render the switcher.
- `src/generation/orchestrate.ts`, `src/github/issues.ts`, `src/github/branches.ts` — load the subject's project / per-project param.
- `src/spec/materialize.ts`, `src/spec/commit.ts`, `src/spec/read.ts`, `src/digest/send.ts`, `src/integrity/reconcile.ts`, `src/integrity/claude-md.ts`, `src/quality/queries.ts` — per-project.
- `src/worker/index.ts` — iterate projects.
- `src/github/webhook.ts` — map repo → project.
- Dashboard + `/reconcile` panel — pass the active project to the carry-in reads.

---

## Task 1: Multi-bind core

**Files:** Modify `src/db/schema.ts`, `src/project/bind.ts`, `src/project/bind.test.ts`; Create `src/project/list.ts`, `src/project/list.test.ts`; generate `drizzle/NNNN_*.sql`; Modify `package.json`.

**Interfaces:**
- `bindProject(db, input)` — now inserts an additional project; throws on a duplicate `repoFullName`.
- `listProjects(db): Promise<{ id: string; repoFullName: string; defaultBranch: string }[]>` (ordered by `createdAt`).

- [ ] **Step 1: Schema unique** — in `src/db/schema.ts`, add a table-level unique on `project.repoFullName`: change the `project` table definition to include `(t) => [unique("project_repo_full_name_unique").on(t.repoFullName)]`. Run `npm run db:generate` → new `drizzle/NNNN_*.sql` with `ADD CONSTRAINT … UNIQUE("repo_full_name")`. (One project today → no conflict.)

- [ ] **Step 2: `bindProject` adds, not refuses** — in `src/project/bind.ts`, replace the "second bind refused" block with a duplicate-repo check:

```ts
    const dup = await tx.select({ id: project.id }).from(project).where(eq(project.repoFullName, input.repoFullName)).limit(1);
    if (dup.length > 0) {
      throw new Error(`A project is already bound to ${input.repoFullName}.`);
    }
```

(add `import { eq } from "drizzle-orm";`). The insert + `project.bound` emit are unchanged.

- [ ] **Step 3: `listProjects`** — `src/project/list.ts`:

```ts
import { asc } from "drizzle-orm";
import type { Db } from "../db/client";
import { project } from "../db/schema";

export async function listProjects(db: Db): Promise<{ id: string; repoFullName: string; defaultBranch: string }[]> {
  return db.select({ id: project.id, repoFullName: project.repoFullName, defaultBranch: project.defaultBranch })
    .from(project).orderBy(asc(project.createdAt));
}
```

- [ ] **Step 4: Tests** — extend `src/project/bind.test.ts`: binding a second (different) repo succeeds → two project rows; binding the **same** repo again throws `/already bound/`. Add `src/project/list.test.ts`: `listProjects` returns all bound projects ordered. Append to `package.json`. Run → PASS.

- [ ] **Step 5: Verify** — `npx tsx --test src/project/bind.test.ts src/project/list.test.ts` → PASS; `npm run typecheck` clean.

- [ ] **Step 6: Commit** `git add -A && git commit -m "[TASK-047] bindProject adds a project (unique repo) + listProjects (REQ-029)"`

---

## Task 2: `setActiveProject` + the switcher

**Files:** Create `src/app/(app)/active/actions.ts`, `src/components/project-switcher.tsx`; Modify `src/app/(app)/layout.tsx`.

**Interfaces:**
- `setActiveProject(projectId: string): Promise<void>` (server action; auth-guarded; sets the caller's `users.active_project_id`).
- `ProjectSwitcher({ projects, activeId }: { projects: {id;repoFullName}[]; activeId: string })`.

- [ ] **Step 1: The action** — `src/app/(app)/active/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { users, project } from "@/db/schema";

export async function setActiveProject(projectId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  // guard: the project must exist (don't let a user point at a deleted/foreign id)
  const [p] = await getDb().select({ id: project.id }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!p) throw new Error("Unknown project.");
  await getDb().update(users).set({ activeProjectId: projectId }).where(eq(users.id, session.user.id));
  revalidatePath("/", "layout");
}
```

- [ ] **Step 2: The switcher** — `src/components/project-switcher.tsx` (`"use client"`): a `<details>`-based dropdown (no extra deps) — a summary button showing the active repo + a list of projects (each a `<form action={setActiveProject.bind(null, p.id)}>` submit) and a "Link a repo…" link to `/connect`. Use the ledger tokens (`font-mono text-xs`, `bg-paper-raised`, `border-hairline`, `rounded-md`, `text-spine-deep`). Mark the active one (e.g. a `●` vs `○`). Keep it keyboard-accessible (`<details>`/`<summary>` is).

```tsx
"use client";
import Link from "next/link";
import { setActiveProject } from "@/app/(app)/active/actions";

export function ProjectSwitcher({ projects, activeId }: { projects: { id: string; repoFullName: string }[]; activeId: string }) {
  const active = projects.find((p) => p.id === activeId) ?? projects[0];
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 font-mono text-xs hover:bg-paper-sunk">
        <span className="size-1.5 rounded-full bg-shipped" />
        <span className="text-ink">{active?.repoFullName ?? "Link a repository"}</span>
        <span className="text-graphite">▾</span>
      </summary>
      <div className="absolute left-0 z-20 mt-1 min-w-56 rounded-md border border-hairline bg-paper-raised p-1 shadow-sm">
        {projects.map((p) => (
          <form key={p.id} action={setActiveProject.bind(null, p.id)}>
            <button type="submit" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-xs hover:bg-paper-sunk">
              <span className={p.id === activeId ? "text-spine-deep" : "text-graphite"}>{p.id === activeId ? "●" : "○"}</span>
              <span className="truncate text-ink">{p.repoFullName}</span>
            </button>
          </form>
        ))}
        <Link href="/connect" className="mt-1 block border-t border-hairline px-2 py-1 font-mono text-xs text-spine-deep hover:bg-paper-sunk">+ Link a repo…</Link>
      </div>
    </details>
  );
}
```

- [ ] **Step 3: Wire the layout** — in `src/app/(app)/layout.tsx`: replace the single-repo `<a href="/connect">…</a>` header indicator with the switcher. Resolve the data:

```ts
import { listProjects } from "@/project/list";
import { getActiveProjectId } from "@/project/active";
import { ProjectSwitcher } from "@/components/project-switcher";
// …in the component, after auth():
const projects = await listProjects(getDb());
const activeId = await getActiveProjectId(getDb(), session.user.id).catch(() => "");
// header: {projects.length > 0 ? <ProjectSwitcher projects={projects} activeId={activeId} /> : <a href="/connect">Link a repository →</a>}
```

(Keep the no-project fallback link. Remove the now-unused single-repo `project.limit(1)` lookup in the layout.)

- [ ] **Step 4: Build + typecheck** — `npm run build` then `npm run typecheck` → clean.

- [ ] **Step 5: Commit** `git add -A && git commit -m "[TASK-047] active-project switcher + setActiveProject (REQ-029)"`

> Runtime switch behavior is verified end-to-end in Task 7 (needs a 2nd project).

---

## Task 3: Connect page binds additional repos

**Files:** Modify `src/app/(app)/connect/page.tsx` (+ its action — find where it calls `bindAndClone`).

- [ ] **Step 1:** The Connect page currently binds the single repo. Change it to: show **bound projects** (`listProjects`) at the top; below, the pick-list from `listConnectableRepos` **filtered to exclude already-bound `repoFullName`s**. The bind action calls `bindAndClone(...)` then sets the actor's active project:

```ts
const bound = await bindAndClone(getDb(), { repoFullName, installationId, defaultBranch, actorId: session.user.id });
await getDb().update(users).set({ activeProjectId: bound.id }).where(eq(users.id, session.user.id));
revalidatePath("/", "layout");
```

(The action must be `auth()`-guarded — verify/add.)

- [ ] **Step 2: Verify** — `npm run build` + `npm run typecheck` clean. (Binding a real 2nd repo is exercised in Task 7.)

- [ ] **Step 3: Commit** `git add -A && git commit -m "[TASK-047] Connect binds additional repos + activates (REQ-029)"`

---

## Task 4: GitHub-write operations resolve the subject's project

**Files:** Modify `src/generation/orchestrate.ts`, `src/github/issues.ts`, `src/github/branches.ts`; their tests.

**Interfaces:**
- `createIssuesForTasks(db, projectId: string, openIssue?)` — opens issues for **that project's** issue-less tasks, using that project's installation/repo.
- `createBranchesForClaimedTasks(db, projectId: string, createBranchFn?, commentOnIssueFn?)` — that project's claimed tasks, from that project's default branch.
- generation loads the **idea's / requirement's** project.

- [ ] **Step 1: Generation** — in `src/generation/orchestrate.ts`, both `generateForApprovedIdea` and `generateForRequirement` currently `const [proj] = await db.select().from(project).limit(1)`. Replace with loading the **subject's** project: the idea/requirement already has `projectId` (load it alongside the subject, then `db.select().from(project).where(eq(project.id, subject.projectId)).limit(1)`). Fail clearly if that project is missing. Everything downstream (clone path, persist) already uses `proj`.

- [ ] **Step 2: Issues** — `createIssuesForTasks(db, projectId, openIssue = realOpenIssue)`: load the project by `projectId` (not limit(1)); select pending tasks `WHERE project_id = projectId AND github_issue_number IS NULL`; open on that project's repo. Update the test to seed a project + pass its id.

- [ ] **Step 3: Branches** — `createBranchesForClaimedTasks(db, projectId, createBranchFn = createBranch, commentOnIssueFn = commentOnIssue)`: load project by `projectId`; the claimed+unbranched select already filters `project_id`? (Phase A added project_id to tasks; add `eq(tasks.projectId, projectId)` to the WHERE). Use that project's defaultBranch/installationId. Update the test (it already seeds a project + passes nothing → now pass the project id).

- [ ] **Step 4: Tests** — generation: a requirement in project B loads B's clone (assert via the injected generator + a 2-project seed); issues/branches: with two projects, `createIssuesForTasks(db, pB)` only touches B's tasks. Run the affected tests → PASS.

- [ ] **Step 5: Verify + Commit** — typecheck clean; `git add -A && git commit -m "[TASK-047] generation/issues/branches resolve the subject's project (REQ-029)"`

---

## Task 5: Spec / digest / reconcile / claude-md per project + carry-in reads

**Files:** Modify `src/spec/materialize.ts`, `src/spec/commit.ts`, `src/spec/read.ts`, `src/digest/send.ts`, `src/integrity/reconcile.ts`, `src/integrity/claude-md.ts`, `src/quality/queries.ts`; their tests; the dashboard + `/reconcile` panel.

**Interfaces:**
- `materializeSpec(db, projectId)`, `commitSpec(db, projectId, …)`, `readSpec(db, projectId)` (readSpec already takes optional projectId from Phase B — make it use it for the clone/spec path too).
- `reconcileStructural(db, currentSpec, projectId)` + `structuralReconciliationForProject(db, projectId)`; `countRationales(db, projectId)`.

- [ ] **Step 1:** Each of these does `select().from(project).limit(1)` or counts unscoped — change to load/scope by the passed `projectId`. `materializeSpec`/`commitSpec` build the spec from `requirements WHERE project_id = projectId` and write into **that project's** clone (`localClonePath`). `reconcileStructural` filters `requirements`/`tasks` by `projectId`; `structuralReconciliationForProject(db, projectId)` loads that project + calls it. `countRationales(db, projectId)` filters `events.projectId`.
- [ ] **Step 2: Tests** — two projects: each materialize/reconcile/countRationales returns/writes only its project's data. Run → PASS.
- [ ] **Step 3: Wire dashboard + /reconcile** — `dashboard/page.tsx`: `structuralReconciliationForProject(db, pid)` and `countRationales(db, pid)` (pid already resolved on the page). `src/app/(app)/reconcile/reconcile-panel.tsx`: resolve `activeProjectId()` + pass it.
- [ ] **Step 4: Verify + Commit** — affected tests PASS; typecheck clean; `git add -A && git commit -m "[TASK-047] spec/digest/reconcile/claude-md per project + carry-in reads (REQ-029)"`

---

## Task 6: Worker iterates all projects + webhook repo→project

**Files:** Modify `src/worker/index.ts`, `src/github/webhook.ts`; their tests.

- [ ] **Step 1: Worker** — in `src/worker/index.ts`, change `tick(db)` to iterate projects: `for (const proj of await listProjects(db)) { … }`. Inside the loop, scope each step to `proj.id`: poll approved ideas **for that project** (`WHERE state='approved' AND project_id = proj.id`); `generateForApprovedIdea` (already loads the idea's project); `createIssuesForTasks(db, proj.id)`; `createBranchesForClaimedTasks(db, proj.id)`; `materializeSpec(db, proj.id)` (when that project generated); `sendDigestIfDue(db, proj.id)`. Keep the per-step try/catch.
- [ ] **Step 2: Webhook** — in `src/github/webhook.ts`, when handling an incoming event, resolve the `project` by the **incoming repo** (`WHERE repo_full_name = <payload repo>`), and use it for the task lookup (the task is found by issue number **within that project**). Confirm `task.github_status_changed` carries that project's id (Phase A reads the task's projectId — keep). Add a test: a webhook for repo B's issue updates B's task, not a same-numbered task in project A.
- [ ] **Step 3: Tests** — worker: two projects each with an approved idea → the tick generates for both (injected generator); webhook: repo-scoped task resolution. Run → PASS.
- [ ] **Step 4: Verify + Commit** — typecheck clean; `git add -A && git commit -m "[TASK-047] worker iterates projects + webhook maps repo→project (REQ-029)"`

---

## Task 7: Verify + migration + runtime

- [ ] **Step 1: Full suite** — stop any `:3000` server; `npm test` → all pass.
- [ ] **Step 2: Build + typecheck** — both clean.
- [ ] **Step 3: Apply the migration to the live DB** (by hand, like Phase A): the new `unique(project_repo_full_name)` constraint. Verify it's present and the existing single orbit row is unaffected.
- [ ] **Step 4: Runtime walkthrough (controller + user)** — rebuild + restart. Confirm: the switcher shows orbit; **Connect → bind a second repo** (clones, becomes active); the board shows the new (empty) project; the switcher lists both; **switch back to orbit** → orbit's ideas/spec/tasks reappear. (Optionally generate for the 2nd repo to confirm operations target it.)
- [ ] **Step 5: Hand off** — report; ready for finishing-a-development-branch (merge to main + apply migration).

---

## Self-Review

**Spec coverage:** multi-bind (add + duplicate guard + unique migration) → Task 1; switcher + setActiveProject → Task 2; Connect binds-another + activate → Task 3; generation/issues/branches resolve the subject's project → Task 4; spec/digest/reconcile/claude-md per project + carry-in reads (reconcile, countRationales) → Task 5; worker iterates projects + webhook repo→project → Task 6; migration + two-repo runtime → Task 7. Truth model: per-project clone/SPEC.md (Tasks 4/5), github_status webhook-only (Task 6 keeps the single writer), switching is per-user state not an event (Task 2), events stay project-scoped (Phase A).

**Placeholder scan:** code shown for the novel pieces (bindProject guard, listProjects, setActiveProject, ProjectSwitcher, the operation transformations). The per-file operation edits are the uniform "replace `from(project).limit(1)` with load-by-subject-projectId / add a `projectId` param" transform — the actionable specifics are named per file. Run steps carry commands + expectations.

**Type consistency:** `listProjects(db) → {id,repoFullName,defaultBranch}[]`; `setActiveProject(projectId)`; `ProjectSwitcher({projects,activeId})`; `createIssuesForTasks(db, projectId, openIssue?)` and `createBranchesForClaimedTasks(db, projectId, createBranchFn?, commentOnIssueFn?)` gain `projectId` as the 2nd param (callers: the worker passes `proj.id`); `materializeSpec(db, projectId)`, `reconcileStructural(db, currentSpec, projectId)`, `structuralReconciliationForProject(db, projectId)`, `countRationales(db, projectId)`. `users.activeProjectId` (Phase A) is the switch target. `project.repoFullName` unique.
