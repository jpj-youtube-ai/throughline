# Additive branch-spec merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator upload a branched-off spec of *only-new* `REQ-NNN` requirements, preview which will be added vs skipped (already on the board), confirm, add the new ones, and let the worker rematerialise `SPEC.md`.

**Architecture:** A pure classifier splits parsed requirements into add/skip by title; a transactional domain function inserts the new ones (`requirement.declared`, provenance `imported`) and records the skips (`requirement.merge_skipped`, a new event type) in one transaction; two server actions (`previewBranchSpec` read-only, `commitBranchSpec` mutating) drive a two-phase preview→confirm form on `/spec`. Rematerialisation reuses the worker's existing every-tick `materializeSpec` — no new code, no migration.

**Tech Stack:** TypeScript, Next.js App Router (React 19 `useActionState` server actions), Drizzle ORM, Postgres / PGlite (tests), `node:test` via `tsx --test`.

Design doc: `docs/superpowers/specs/2026-06-26-branch-spec-merge-design.md`. Requirement: **REQ-032** (new). Task: **TASK-074**, branch `task-074-branch-spec-merge` (already created; the design-doc commit is on it).

## Global Constraints

(Every task implicitly includes these — from `CLAUDE.md` and the design.)

- **No `any` in domain code** (events, tasks, requirements).
- **Every state change emits its event in the SAME `db.transaction`** as the mutable-table write, via the single `emitEvent(tx, …)` helper. Never emit an event outside a transaction that also wrote state.
- **Append-only events:** no code path updates or deletes `events`.
- **`tasks.github_status` is webhook-only** — not touched here.
- **Provenance reuses the existing enum** `imported|voted|drift` → added requirements use `imported`. **No migration.**
- **Register every new `*.test.ts`** in the `test` script in `package.json` (it is enumerated, not globbed — an unregistered test is silently skipped).
- **Branch** `task-074-branch-spec-merge`; **commits** small; the PR/squash message starts with `[TASK-074]`.
- **Surface `[3]` work** (the form) serves the ledger design system — reuse `Card`/`Field`/`fieldClass`/`buttonClass` and existing tones (`text-ink`/`text-graphite`/`text-shipped`/`text-risk`, `border-hairline`). The design system wins over plugin defaults.
- Keys are minted via `nextRequirementKey(tx, projectId)` — the doc's own `REQ-NNN` numbers are ignored (genesis already does this).

---

## File Structure

- **Create** `src/requirements/merge.ts` — pure classifier (`normalizeTitle`, `classifyForMerge`) + transactional domain (`mergeBranchSpec`). One responsibility: turn a parsed branch spec into adds + skips against a project's requirements.
- **Create** `src/requirements/merge.test.ts` — unit tests for the classifier (no DB) and the domain function (PGlite).
- **Modify** `src/db/events.ts` — add `"requirement.merge_skipped"` to the `EventType` union.
- **Modify** `src/app/(app)/spec/actions.ts` — add `previewBranchSpec` + `commitBranchSpec` actions (and their typed states).
- **Create** `src/app/(app)/spec/branch-spec-merge.tsx` — the `"use client"` preview→confirm form.
- **Modify** `src/app/(app)/spec/spec-upload.tsx` — render `<BranchSpecMerge />` in the already-imported branch.
- **Modify** `package.json` — add `src/requirements/merge.test.ts` to the `test` script.

---

## Task 1: Pure merge classifier

Splits parsed requirements into add/skip by normalized title. Pure, no DB — fast to test and the single source of the add/skip rule used by both the preview action and the domain merge.

**Files:**
- Create: `src/requirements/merge.ts`
- Create (test): `src/requirements/merge.test.ts`
- Modify: `package.json` (register the test)

**Interfaces:**
- Consumes: `ParsedRequirement` from `../genesis/import` (already exported: `{ key: string; title: string; description: string }`).
- Produces:
  - `normalizeTitle(title: string): string` — `title.trim().toLowerCase()`.
  - `interface ExistingReq { id: string; key: string; title: string }`
  - `interface MergeClassification { toAdd: ParsedRequirement[]; toSkip: { req: ParsedRequirement; existing: { id: string; key: string } }[] }`
  - `classifyForMerge(existing: ExistingReq[], parsed: ParsedRequirement[]): MergeClassification` — preserves `parsed` order in `toAdd`.

- [ ] **Step 1: Write the failing test**

Create `src/requirements/merge.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTitle, classifyForMerge } from "./merge";
import type { ParsedRequirement } from "../genesis/import";

const parsed = (title: string, key = "REQ-999", description = "desc"): ParsedRequirement => ({ key, title, description });

test("normalizeTitle trims and lowercases", () => {
  assert.equal(normalizeTitle("  Payments "), "payments");
  assert.equal(normalizeTitle("PAYMENTS"), "payments");
});

test("classifyForMerge skips titles already on the board (trimmed + case-insensitive), keeps order", () => {
  const existing = [
    { id: "id-1", key: "REQ-001", title: "Payments" },
    { id: "id-2", key: "REQ-002", title: "Sign-in" },
  ];
  const input = [parsed("Refunds", "REQ-031"), parsed(" payments ", "REQ-032"), parsed("Audit log", "REQ-033")];

  const { toAdd, toSkip } = classifyForMerge(existing, input);

  assert.deepEqual(toAdd.map((r) => r.title), ["Refunds", "Audit log"]);
  assert.equal(toSkip.length, 1);
  assert.equal(toSkip[0].req.title, " payments ");
  assert.deepEqual(toSkip[0].existing, { id: "id-1", key: "REQ-001" });
});

test("classifyForMerge with no existing requirements adds everything", () => {
  const input = [parsed("A", "REQ-031"), parsed("B", "REQ-032")];
  const { toAdd, toSkip } = classifyForMerge([], input);
  assert.equal(toAdd.length, 2);
  assert.equal(toSkip.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/requirements/merge.test.ts`
Expected: FAIL — `Cannot find module './merge'` (file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/requirements/merge.ts`:

```ts
import type { ParsedRequirement } from "../genesis/import";

/** Title identity for merge matching: trimmed, case-insensitive. */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

export interface ExistingReq {
  id: string;
  key: string;
  title: string;
}

export interface MergeClassification {
  toAdd: ParsedRequirement[];
  toSkip: { req: ParsedRequirement; existing: { id: string; key: string } }[];
}

/**
 * Split parsed branch-spec requirements into the genuinely-new ones (toAdd) and
 * the ones whose title already exists on the board (toSkip), matching by
 * normalized title. Preserves the parsed order in toAdd so keys mint in order.
 */
export function classifyForMerge(existing: ExistingReq[], parsed: ParsedRequirement[]): MergeClassification {
  const byTitle = new Map<string, { id: string; key: string }>();
  for (const e of existing) byTitle.set(normalizeTitle(e.title), { id: e.id, key: e.key });

  const toAdd: ParsedRequirement[] = [];
  const toSkip: MergeClassification["toSkip"] = [];
  for (const r of parsed) {
    const hit = byTitle.get(normalizeTitle(r.title));
    if (hit) toSkip.push({ req: r, existing: hit });
    else toAdd.push(r);
  }
  return { toAdd, toSkip };
}
```

- [ ] **Step 4: Register the test file in `package.json`**

In `package.json`, append ` src/requirements/merge.test.ts` to the end of the `test` script string (after `src/narrative/regen.test.ts`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx --test src/requirements/merge.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/requirements/merge.ts src/requirements/merge.test.ts package.json
git commit -m "[TASK-074] pure merge classifier (add/skip by title) (REQ-032)"
```

---

## Task 2: Transactional `mergeBranchSpec` + `requirement.merge_skipped` event

Adds the new requirements (each `requirement.declared`, provenance `imported`, `source: "branch-merge"`) and records each skip (`requirement.merge_skipped`, subject = the existing requirement) — all in one transaction, on a non-empty board.

**Files:**
- Modify: `src/db/events.ts` (add the event type)
- Modify: `src/requirements/merge.ts` (add the domain function)
- Modify (test): `src/requirements/merge.test.ts` (add DB tests)

**Interfaces:**
- Consumes: `classifyForMerge` (Task 1); `parseSpecRequirements` from `../genesis/import`; `nextRequirementKey` from `./keys`; `emitEvent` from `../db/events`; `requirements` from `../db/schema`; `Db` from `../db/client`.
- Produces:
  - `interface MergeResult { filename: string; added: { key: string; title: string }[]; skipped: { title: string; existingKey: string }[] }`
  - `mergeBranchSpec(db: Db, specText: string, filename: string, projectId: string): Promise<MergeResult>`
  - New `EventType` member `"requirement.merge_skipped"`.

- [ ] **Step 1: Add the new event type**

In `src/db/events.ts`, add to the `EventType` union (place it next to `"requirement.amended"`):

```ts
  | "requirement.amended"
  | "requirement.merge_skipped"
```

Do **not** add it to `RATIONALE_REQUIRED` (a skip needs no "why").

- [ ] **Step 2: Write the failing DB tests**

Append to `src/requirements/merge.test.ts`:

```ts
import { createTestDb } from "../db/client";
import { requirements, events, project } from "../db/schema";
import { eq } from "drizzle-orm";
import { mergeBranchSpec } from "./merge";

async function seedProject(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string> {
  const [p] = await db
    .insert(project)
    .values({ repoFullName: "acme/repo", defaultBranch: "main", installationId: 1, localClonePath: "/x", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
    .returning({ id: project.id });
  return p.id;
}

async function seedReq(db: Awaited<ReturnType<typeof createTestDb>>["db"], projectId: string, key: string, title: string): Promise<void> {
  await db.insert(requirements).values({ key, title, description: "x", status: "planned", provenance: "imported", projectId });
}

const BRANCH = `**REQ-100 — Refunds.** Issue refunds. *Accept:* works.

**REQ-101 — Sign-in.** Already exists on the board. *Accept:* works.
`;

test("mergeBranchSpec adds new reqs on a non-empty board, minting keys that continue the sequence", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    await seedReq(db, projectId, "REQ-001", "Sign-in");
    await seedReq(db, projectId, "REQ-002", "Existing two");

    const res = await mergeBranchSpec(db, BRANCH, "branch.md", projectId);

    // One added ("Refunds"), one skipped ("Sign-in").
    assert.deepEqual(res.added.map((a) => a.title), ["Refunds"]);
    assert.equal(res.added[0].key, "REQ-003"); // continues the board's sequence, ignores REQ-100
    assert.deepEqual(res.skipped, [{ title: "Sign-in", existingKey: "REQ-001" }]);

    const reqs = await db.select().from(requirements).where(eq(requirements.projectId, projectId));
    assert.equal(reqs.length, 3); // 2 seeded + 1 added (Sign-in NOT duplicated)
    const added = reqs.find((r) => r.title === "Refunds")!;
    assert.equal(added.status, "planned");
    assert.equal(added.provenance, "imported");
  } finally {
    await close();
  }
});

test("mergeBranchSpec emits requirement.declared for adds and requirement.merge_skipped for skips, in-tx", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    await seedReq(db, projectId, "REQ-001", "Sign-in");

    await mergeBranchSpec(db, BRANCH, "branch.md", projectId);

    const declared = await db.select().from(events).where(eq(events.type, "requirement.declared"));
    assert.equal(declared.length, 1);
    const dp = declared[0].payload as { provenance: string; source: string; filename: string };
    assert.equal(dp.provenance, "imported");
    assert.equal(dp.source, "branch-merge");
    assert.equal(dp.filename, "branch.md");

    const skipped = await db.select().from(events).where(eq(events.type, "requirement.merge_skipped"));
    assert.equal(skipped.length, 1);
    const existing = (await db.select().from(requirements).where(eq(requirements.key, "REQ-001")))[0];
    assert.equal(skipped[0].subjectId, existing.id); // points at the EXISTING requirement
    const sp = skipped[0].payload as { filename: string; skipped_title: string; existing_key: string };
    assert.deepEqual(sp, { filename: "branch.md", skipped_title: "Sign-in", existing_key: "REQ-001" });
    // Every event is project-scoped.
    for (const e of [...declared, ...skipped]) assert.equal(e.projectId, projectId);
  } finally {
    await close();
  }
});

test("mergeBranchSpec throws and writes nothing when no requirements parse", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    await assert.rejects(mergeBranchSpec(db, "no requirements here", "branch.md", projectId), /No requirements found/i);
    assert.equal((await db.select().from(requirements).where(eq(requirements.projectId, projectId))).length, 0);
    assert.equal((await db.select().from(events)).length, 0);
  } finally {
    await close();
  }
});

test("mergeBranchSpec is project-scoped: skip-matching and minting use only the target project", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seedProject(db);
    const [pb] = await db
      .insert(project)
      .values({ repoFullName: "acme/repo-b", defaultBranch: "main", installationId: 2, localClonePath: "/y", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const b = pb.id;
    // "Refunds" exists in B only. Merging into A must still ADD Refunds (not skip).
    await seedReq(db, b, "REQ-050", "Refunds");

    const res = await mergeBranchSpec(db, `**REQ-100 — Refunds.** x.`, "branch.md", a);
    assert.deepEqual(res.added.map((x) => x.title), ["Refunds"]);
    assert.equal(res.added[0].key, "REQ-001"); // A's own sequence, independent of B
  } finally {
    await close();
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx tsx --test src/requirements/merge.test.ts`
Expected: FAIL — `mergeBranchSpec` is not exported from `./merge`.

- [ ] **Step 4: Write the domain function**

Append to `src/requirements/merge.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { requirements } from "../db/schema";
import { emitEvent } from "../db/events";
import { parseSpecRequirements } from "../genesis/import";
import { nextRequirementKey } from "./keys";

export interface MergeResult {
  filename: string;
  added: { key: string; title: string }[];
  skipped: { title: string; existingKey: string }[];
}

/**
 * Additive branch-spec merge (REQ-032): parse a Markdown spec of NEW requirements
 * and fold them into an already-populated project. New titles are inserted
 * (status=planned, provenance=imported) each with requirement.declared; titles
 * already on the board are NOT inserted but recorded with requirement.merge_skipped.
 * Keys are minted within the project's own sequence (the doc's REQ-NNN are ignored).
 * All writes happen in one transaction. Throws (writing nothing) if 0 requirements parse.
 */
export async function mergeBranchSpec(db: Db, specText: string, filename: string, projectId: string): Promise<MergeResult> {
  const parsed = parseSpecRequirements(specText);
  if (parsed.length === 0) {
    throw new Error("No requirements found in the spec (expected **REQ-NNN — Title.** headings).");
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: requirements.id, key: requirements.key, title: requirements.title })
      .from(requirements)
      .where(eq(requirements.projectId, projectId));

    const { toAdd, toSkip } = classifyForMerge(existing, parsed);

    for (const s of toSkip) {
      await emitEvent(tx, {
        type: "requirement.merge_skipped",
        subjectType: "requirement",
        subjectId: s.existing.id,
        payload: { filename, skipped_title: s.req.title, existing_key: s.existing.key },
        projectId,
      });
    }

    const added: { key: string; title: string }[] = [];
    for (const r of toAdd) {
      const key = await nextRequirementKey(tx, projectId);
      const [row] = await tx
        .insert(requirements)
        .values({ key, title: r.title, description: r.description, status: "planned", provenance: "imported", projectId })
        .returning({ id: requirements.id });
      await emitEvent(tx, {
        type: "requirement.declared",
        subjectType: "requirement",
        subjectId: row.id,
        payload: { provenance: "imported", key, origin_idea_id: null, source: "branch-merge", filename },
        projectId,
      });
      added.push({ key, title: r.title });
    }

    return { filename, added, skipped: toSkip.map((s) => ({ title: s.req.title, existingKey: s.existing.key })) };
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsx --test src/requirements/merge.test.ts`
Expected: PASS — all 7 tests (3 from Task 1 + 4 here) pass.

- [ ] **Step 6: Commit**

```bash
git add src/db/events.ts src/requirements/merge.ts src/requirements/merge.test.ts
git commit -m "[TASK-074] mergeBranchSpec + requirement.merge_skipped event (REQ-032)"
```

---

## Task 3: Server actions — preview (read-only) + commit

Wires the domain into `/spec`. `previewBranchSpec` parses + classifies without mutating; `commitBranchSpec` re-parses the same raw text server-side and runs the merge. Both re-check `auth()` (server actions aren't gated by the layout redirect — same as the existing `importSpec`).

**Files:**
- Modify: `src/app/(app)/spec/actions.ts`

**Interfaces:**
- Consumes: `auth` (`@/auth`); `getDb` (`@/db/client`); `getActiveProjectId` (`@/project/active`); `parseSpecRequirements` (`@/genesis/import`); `classifyForMerge`, `mergeBranchSpec` (`@/requirements/merge`); `requirements` (`@/db/schema`); `eq` (`drizzle-orm`); `revalidatePath` (`next/cache`).
- Produces:
  - `type BranchPreviewState = { ok: true; filename: string; toAdd: string[]; toSkip: { title: string; existingKey: string }[]; rawText: string } | { ok: false; error: string } | null`
  - `type BranchMergeState = { ok: true; addedCount: number; skippedCount: number; addedKeys: string[] } | { ok: false; error: string } | null`
  - `previewBranchSpec(_prev: BranchPreviewState, formData: FormData): Promise<BranchPreviewState>`
  - `commitBranchSpec(_prev: BranchMergeState, formData: FormData): Promise<BranchMergeState>`

> No unit test — this is a `"use server"` UI-adjacent module (repo convention: server actions aren't unit-tested; the heavy logic is already covered in Tasks 1–2). It is verified by typecheck/build (Task 5) and runtime.

- [ ] **Step 1: Add the actions**

Append to `src/app/(app)/spec/actions.ts` (keep the existing `importSpec`; add these imports at the top alongside the current ones):

```ts
import { eq } from "drizzle-orm";
import { parseSpecRequirements } from "@/genesis/import";
import { classifyForMerge, mergeBranchSpec } from "@/requirements/merge";
import { requirements } from "@/db/schema";
```

Then add:

```ts
export type BranchPreviewState =
  | { ok: true; filename: string; toAdd: string[]; toSkip: { title: string; existingKey: string }[]; rawText: string }
  | { ok: false; error: string }
  | null;

// Preview a branch-spec merge (REQ-032): parse + classify against the active
// project's requirements. Read-only — writes nothing. Echoes rawText so the
// confirm step re-parses the exact same input.
export async function previewBranchSpec(_prev: BranchPreviewState, formData: FormData): Promise<BranchPreviewState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const file = formData.get("file");
  let text = "";
  let filename = "branch-spec.md";
  if (file instanceof File && file.size > 0) {
    text = await file.text();
    filename = file.name || filename;
  } else {
    text = String(formData.get("text") ?? "");
  }
  if (!text.trim()) return { ok: false, error: "Paste the branch spec markdown or choose a file." };
  try {
    const db = getDb();
    const projectId = await getActiveProjectId(db, session.user.id);
    const parsed = parseSpecRequirements(text);
    if (parsed.length === 0) return { ok: false, error: "No requirements found (expected **REQ-NNN — Title.** headings)." };
    const existing = await db
      .select({ id: requirements.id, key: requirements.key, title: requirements.title })
      .from(requirements)
      .where(eq(requirements.projectId, projectId));
    const { toAdd, toSkip } = classifyForMerge(existing, parsed);
    return {
      ok: true,
      filename,
      toAdd: toAdd.map((r) => r.title),
      toSkip: toSkip.map((s) => ({ title: s.req.title, existingKey: s.existing.key })),
      rawText: text,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Preview failed." };
  }
}

export type BranchMergeState =
  | { ok: true; addedCount: number; skippedCount: number; addedKeys: string[] }
  | { ok: false; error: string }
  | null;

// Commit a previewed branch-spec merge (REQ-032): re-parse the same raw text
// server-side (never trust client-sent requirement data) and run mergeBranchSpec.
export async function commitBranchSpec(_prev: BranchMergeState, formData: FormData): Promise<BranchMergeState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const text = String(formData.get("rawText") ?? "");
  const filename = String(formData.get("filename") ?? "branch-spec.md");
  if (!text.trim()) return { ok: false, error: "Nothing to merge — preview a spec first." };
  try {
    const db = getDb();
    const projectId = await getActiveProjectId(db, session.user.id);
    const r = await mergeBranchSpec(db, text, filename, projectId);
    revalidatePath("/spec");
    revalidatePath("/dashboard");
    return { ok: true, addedCount: r.added.length, skippedCount: r.skipped.length, addedKeys: r.added.map((a) => a.key) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Merge failed." };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no type errors (no `any`; both state unions resolve).

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/spec/actions.ts
git commit -m "[TASK-074] preview + commit branch-spec server actions (REQ-032)"
```

---

## Task 4: The preview→confirm UI

A `"use client"` form on `/spec` (only when the board is already imported): upload/paste → Preview → review the add/skip split → Confirm and add.

**Files:**
- Create: `src/app/(app)/spec/branch-spec-merge.tsx`
- Modify: `src/app/(app)/spec/spec-upload.tsx`

**Interfaces:**
- Consumes: `previewBranchSpec`, `commitBranchSpec`, `BranchPreviewState`, `BranchMergeState` (Task 3); `Card`, `Field`, `fieldClass`, `buttonClass` (`@/components/ui`); `useActionState` (`react`).
- Produces: `BranchSpecMerge()` (default-styled component), rendered inside `SpecUpload`'s already-imported branch.

> UI — not unit-tested (repo convention). Verified by typecheck/build (Task 5) and runtime in a signed-in browser.

- [ ] **Step 1: Create the form component**

Create `src/app/(app)/spec/branch-spec-merge.tsx`:

```tsx
// src/app/(app)/spec/branch-spec-merge.tsx
"use client";

import { useActionState } from "react";
import { previewBranchSpec, commitBranchSpec, type BranchPreviewState, type BranchMergeState } from "./actions";
import { Card, Field, fieldClass, buttonClass } from "@/components/ui";

export function BranchSpecMerge() {
  const [preview, previewAction, previewing] = useActionState<BranchPreviewState, FormData>(previewBranchSpec, null);
  const [merged, mergeAction, merging] = useActionState<BranchMergeState, FormData>(commitBranchSpec, null);

  if (merged?.ok) {
    return (
      <Card className="mt-4 p-4">
        <p className="text-[13px] text-shipped">
          Added {merged.addedCount} requirement{merged.addedCount === 1 ? "" : "s"}
          {merged.addedKeys.length > 0 ? ` (${merged.addedKeys.join(", ")})` : ""}
          {merged.skippedCount > 0 ? ` · skipped ${merged.skippedCount} already on board` : ""}. SPEC.md rematerialises on the next worker tick.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mt-4 p-4">
      <form action={previewAction} className="grid gap-3">
        <p className="text-[13px] text-graphite">
          Merge a <span className="font-medium text-ink">branch spec</span> — upload or paste a Markdown file of <em>new</em>{" "}
          <span className="font-mono">REQ-NNN</span> requirements to fold into this board. You preview before anything is added.
        </p>
        <Field label="Branch spec (.md)">
          <input type="file" name="file" accept=".md,.markdown,text/markdown,text/plain" className={fieldClass} />
        </Field>
        <Field label="…or paste it">
          <textarea name="text" rows={6} className={fieldClass} placeholder="**REQ-031 — New thing.** description…" />
        </Field>
        <button type="submit" disabled={previewing} className={`${buttonClass("quiet")} justify-self-start`}>
          {previewing ? "Reading…" : "Preview"}
        </button>
        {preview?.ok === false && <p className="text-[13px] text-risk">{preview.error}</p>}
      </form>

      {preview?.ok && (
        <div className="mt-4 grid gap-3 border-t border-hairline pt-4">
          <p className="text-[13px] text-graphite">
            <span className="font-medium text-ink">{preview.toAdd.length}</span> to add
            {preview.toSkip.length > 0 && (
              <>
                {" "}· <span className="font-medium text-ink">{preview.toSkip.length}</span> already on board (will be skipped)
              </>
            )}
            .
          </p>
          {preview.toAdd.length > 0 && (
            <ul className="grid gap-1 text-[13px] text-ink">
              {preview.toAdd.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-shipped">+</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
          {preview.toSkip.length > 0 && (
            <ul className="grid gap-1 text-[13px] text-graphite">
              {preview.toSkip.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span>·</span>
                  <span>
                    {s.title} <span className="font-mono text-xs">(already {s.existingKey})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {preview.toAdd.length > 0 ? (
            <form action={mergeAction} className="justify-self-start">
              <input type="hidden" name="rawText" value={preview.rawText} />
              <input type="hidden" name="filename" value={preview.filename} />
              <button type="submit" disabled={merging} className={buttonClass("primary")}>
                {merging ? "Adding…" : `Confirm and add ${preview.toAdd.length}`}
              </button>
            </form>
          ) : (
            <p className="text-[13px] text-graphite">Nothing new to add — every requirement in this file already exists on the board.</p>
          )}
          {merged?.ok === false && <p className="text-[13px] text-risk">{merged.error}</p>}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Render it in `SpecUpload`**

In `src/app/(app)/spec/spec-upload.tsx`, add the import near the top:

```tsx
import { BranchSpecMerge } from "./branch-spec-merge";
```

Replace the `alreadyImported` early-return block (the `<Card className="mb-8 p-4">…</Card>` with the "Genesis spec imported" note) with the note **plus** the merge form:

```tsx
  if (alreadyImported) {
    return (
      <div className="mb-8 grid gap-0">
        <Card className="p-4">
          <p className="text-sm text-graphite">
            Genesis spec imported — <span className="text-ink">{count}</span> requirements. Import is a one-time bootstrap; further
            requirements come from approved ideas, resolved drift, or a branch-spec merge below.
          </p>
        </Card>
        <BranchSpecMerge />
      </div>
    );
  }
```

(The empty-board genesis form below stays unchanged.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/spec/branch-spec-merge.tsx src/app/(app)/spec/spec-upload.tsx
git commit -m "[TASK-074] /spec branch-spec merge form: preview then confirm (REQ-032)"
```

---

## Task 5: Verify, review, finalize

Full verification, event-integrity review, and the merge/deploy handoff. No new code unless a check fails.

**Files:** none (verification + docs/process).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — the previous count (260) **+ the new `merge.test.ts` tests** (so 267), 0 failures. Confirm `merge.test.ts` actually ran (it must appear in the run — verifying it was registered in `package.json`).

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both PASS — no type errors, build completes (`/spec` compiles with the new client component).

- [ ] **Step 3: Event-integrity review**

Dispatch the `event-integrity-reviewer` agent over the branch diff. Confirm it passes on: the new `requirement.merge_skipped` event type (append-only, emitted in-tx, references an existing row — justified non-state-change per the design); `requirement.declared` for adds carries provenance + `source` marker in-tx; no `github_status` writes; no `any` in `src/requirements/merge.ts`; no migration needed (provenance reuses `imported`). Address any Important/Critical findings; re-run the relevant tests.

- [ ] **Step 4: Runtime smoke (signed-in browser)**

On the live deploy or a local `next dev`, open `/spec` on an already-imported board. Paste a small branch spec with one new title and one existing title → **Preview** shows "1 to add · 1 already on board" → **Confirm** → success line shows the new `REQ-NNN`. Reload `/spec`: the new requirement is in the map immediately. Re-paste the same spec → Preview shows "0 to add" (re-upload is safe). (UI isn't unit-tested — this is the verification.)

- [ ] **Step 5: Open the PR**

```bash
git push -u origin task-074-branch-spec-merge
gh pr create --title "[TASK-074] additive branch-spec merge (REQ-032)" --body "Upload a branched-off spec of only-new requirements; preview add/skip, confirm, add the new ones, record skips (requirement.merge_skipped), worker rematerialises SPEC.md. No migration."
```

Squash-merge so `[TASK-074]` lands as one line on `main`.

- [ ] **Step 6: Deploy + operator follow-ups (after merge)**

- **Deploy = web only.** No worker code changed (the worker already runs `materializeSpec` every tick), **no migration**. Fast-forward the deploy worktree to the new `main` HEAD and restart **only** the Next web server (per the redeploy recipe in project memory). The worker is left running untouched.
- **REQ-032 declaration:** like REQ-028/030/031, REQ-032 is a throughline **dev-convention** key, not declared into a live client project (the live DB projects are clients — orbit/nbcc). No `declare-req` against a client board. Just record TASK-074 / REQ-032 in project memory.
- **Verify post-deploy:** on a real bound board, run one branch-spec merge end-to-end and confirm the next worker tick re-materialises and pushes `SPEC.md` (look for `spec materialized (N reqs, <sha>)` in the worker log).

---

## Self-Review

**1. Spec coverage** (design § → task):
- Matching (title, trimmed + case-insensitive, active-project) → Task 1 (`normalizeTitle`/`classifyForMerge`) + Task 2 (project-scoped existing load).
- Merge domain (non-empty board, mint fresh keys, `requirement.declared` w/ `imported` + `source` marker, in-tx) → Task 2.
- `requirement.merge_skipped` event (new type, subject = existing req, payload) → Task 2.
- Server actions (preview read-only, commit re-parses raw text, auth re-check) → Task 3.
- Surface (`/spec` non-empty branch, preview→confirm, ledger primitives) → Task 4.
- Rematerialise (worker every tick; no new code) → Task 5 deploy note (no code task — correctly nothing to build).
- Truth model / no migration / web-only deploy → Global Constraints + Task 5.
- Testing (parse reuse, domain DB tests, project-scoping, 0-parse throw) → Tasks 1–2; verification → Task 5.
- Edge cases: all-exist (Task 4 "nothing new to add" branch + Task 2 covers 0 adds), re-upload safe (Task 5 smoke), 0-parse throw (Task 2 test), within-file dup out-of-scope (design — not implemented, by design).

**2. Placeholder scan:** none — every code step carries full code; no "TBD"/"handle errors"/"similar to".

**3. Type consistency:** `mergeBranchSpec(db, specText, filename, projectId)` and `MergeResult` identical across Tasks 2–3; `classifyForMerge(existing, parsed)`/`ExistingReq`/`MergeClassification` identical Tasks 1–3; `BranchPreviewState`/`BranchMergeState` and action names `previewBranchSpec`/`commitBranchSpec` identical Tasks 3–4; payload keys (`skipped_title`, `existing_key`, `source: "branch-merge"`) identical between the Task 2 implementation and its tests.
