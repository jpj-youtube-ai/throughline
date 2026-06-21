# Spec-map "View SPEC.md" Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "View SPEC.md" button on the spec map that opens the bound project's materialized `SPEC.md` in a drawer.

**Architecture:** A read-only `readSpec(db)` helper reads the spec file from the bound project's local clone. A `SpecDocument` server component renders it raw (monospace). Two routes mirror the existing `/spec/[key]` pattern — a full page `/spec/document` and an intercepting `@drawer/(.)spec/document` wrapping `SpecDocument` in `DrawerShell`. A `"quiet"` link-button on `/spec` opens it.

**Tech Stack:** Next.js (App Router) · Drizzle (PGlite for tests) · `node:test` via `tsx --test`.

## Global Constraints

- **TypeScript throughout; no `any`** in domain code.
- **Read-only feature.** This surfaces an existing artifact; it makes **no state change and emits no event**. Do not add any DB write or `emitEvent` call.
- **Follow the existing drawer pattern** (`/spec/[key]` page + `@drawer/(.)spec/[key]` intercept reusing `DrawerShell`). Reuse `DrawerShell` unchanged — do not modify it.
- **No new dependency.** Render `SPEC.md` as raw monospace text; do not add a markdown library.
- Tests run via `npx tsx --test <file>`; the full suite is `npm test`. A new test file must be appended to the `"test"` script's file list in `package.json` or it never runs.
- Branch: **`task-043-spec-document-drawer`** (already created off `main`; design committed there). Commit messages start with `[TASK-043]`.

---

## File Structure

- Create `src/spec/read.ts` — `readSpec(db)` helper (reads the clone's spec file, null-safe).
- Create `src/spec/read.test.ts` — unit tests for `readSpec`.
- Create `src/app/(app)/spec/spec-document.tsx` — `SpecDocument` server component (raw render + empty state).
- Create `src/app/(app)/spec/document/page.tsx` — full page route.
- Create `src/app/(app)/@drawer/(.)spec/document/page.tsx` — intercepting drawer route.
- Modify `src/app/(app)/spec/page.tsx` — add the "View SPEC.md" link-button.
- Modify `package.json` — register `src/spec/read.test.ts` in the `"test"` script.

---

## Task 1: `readSpec` helper

**Files:**
- Create: `src/spec/read.ts`
- Test: `src/spec/read.test.ts`
- Modify: `package.json` (test list)

**Interfaces:**
- Produces: `readSpec(db: Db): Promise<{ content: string | null; path: string | null }>` — exported `SpecDoc` interface with fields `content` and `path`.
- Consumes: existing `project` schema (`localClonePath`, `specPath`), `Db` type from `../db/client`.

- [ ] **Step 1: Write the failing test.** Create `src/spec/read.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestDb } from "../db/client";
import { project } from "../db/schema";
import { readSpec } from "./read";

function tmpClone(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tl-spec-"));
}

test("readSpec returns the clone's SPEC.md content and path", async () => {
  const { db, close } = await createTestDb();
  const dir = tmpClone();
  try {
    fs.writeFileSync(path.join(dir, "SPEC.md"), "# Orbit — Specification\n## Shipped (1)\n");
    await db.insert(project).values({
      repoFullName: "acme/repo",
      defaultBranch: "main",
      installationId: 1,
      localClonePath: dir,
    });
    const r = await readSpec(db);
    assert.equal(r.path, "SPEC.md");
    assert.match(r.content ?? "", /Orbit — Specification/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await close();
  }
});

test("readSpec returns null content when the SPEC.md file is absent", async () => {
  const { db, close } = await createTestDb();
  const dir = tmpClone(); // empty dir, no SPEC.md
  try {
    await db.insert(project).values({
      repoFullName: "acme/repo",
      defaultBranch: "main",
      installationId: 1,
      localClonePath: dir,
    });
    const r = await readSpec(db);
    assert.equal(r.content, null);
    assert.equal(r.path, "SPEC.md"); // project.specPath default
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await close();
  }
});

test("readSpec returns nulls when no project is bound", async () => {
  const { db, close } = await createTestDb();
  try {
    assert.deepEqual(await readSpec(db), { content: null, path: null });
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run the test, verify it fails.**

Run: `npx tsx --test src/spec/read.test.ts`
Expected: FAIL — cannot find module `./read`.

- [ ] **Step 3: Implement the helper.** Create `src/spec/read.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/client";
import { project } from "../db/schema";

export interface SpecDoc {
  content: string | null;
  path: string | null;
}

/**
 * Read the materialized spec document from the bound project's local clone
 * (REQ-017 surface). Read-only — surfaces an existing artifact, no state change,
 * no event. Returns null content when no project is bound or the file does not
 * exist yet (e.g. before the first materialize); never throws on a missing file.
 */
export async function readSpec(db: Db): Promise<SpecDoc> {
  const [proj] = await db.select().from(project).limit(1);
  if (!proj) return { content: null, path: null };
  const file = path.join(proj.localClonePath, proj.specPath);
  try {
    return { content: fs.readFileSync(file, "utf8"), path: proj.specPath };
  } catch {
    return { content: null, path: proj.specPath };
  }
}
```

- [ ] **Step 4: Register the test.** In `package.json`, append ` src/spec/read.test.ts` to the end of the space-separated file list in the `"test"` script.

- [ ] **Step 5: Run the test, verify it passes.**

Run: `npx tsx --test src/spec/read.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + full suite.**

Run: `npm run typecheck && npm test`
Expected: PASS, including the new `read.test.ts`.

- [ ] **Step 7: Commit.**

```bash
git add src/spec/read.ts src/spec/read.test.ts package.json
git commit -m "[TASK-043] readSpec helper for the materialized spec document (REQ-017)"
```

---

## Task 2: `SpecDocument` component, routes, and the button

**Files:**
- Create: `src/app/(app)/spec/spec-document.tsx`
- Create: `src/app/(app)/spec/document/page.tsx`
- Create: `src/app/(app)/@drawer/(.)spec/document/page.tsx`
- Modify: `src/app/(app)/spec/page.tsx`

**Interfaces:**
- Consumes: `readSpec` (Task 1) via `getDb()`; `Empty`, `PageHeader`, `buttonClass` from `@/components/ui`; `DrawerShell` from `@/components/drawer-shell`.
- Produces: `SpecDocument` async server component (no props); routes `/spec/document` (page) and its `@drawer` intercept.

These are presentational/route components — verified by typecheck + build (the gate used by the prior 12 drawers), then a runtime check after merge.

- [ ] **Step 1: Create the content component.** Create `src/app/(app)/spec/spec-document.tsx`:

```tsx
import { getDb } from "@/db/client";
import { readSpec } from "@/spec/read";
import { Empty } from "@/components/ui";

// Renders the bound project's materialized SPEC.md verbatim (raw monospace).
// Read-only; the empty state covers an unbound project or a pre-materialize repo.
export async function SpecDocument() {
  const { content } = await readSpec(getDb());
  if (!content) {
    return <Empty title="No SPEC.md yet.">It is written when requirements are first materialized.</Empty>;
  }
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6] text-ink">{content}</pre>
  );
}
```

- [ ] **Step 2: Create the full page route.** Create `src/app/(app)/spec/document/page.tsx`:

```tsx
import { PageHeader } from "@/components/ui";
import { SpecDocument } from "../spec-document";

export const dynamic = "force-dynamic";

export default function SpecDocumentPage() {
  return (
    <>
      <PageHeader
        eyebrow="Specification"
        title="SPEC.md"
        lede="The materialized spec document — generated from the requirement log, never hand-edited."
      />
      <SpecDocument />
    </>
  );
}
```

- [ ] **Step 3: Create the intercepting drawer route.** Create `src/app/(app)/@drawer/(.)spec/document/page.tsx`:

```tsx
import { DrawerShell } from "@/components/drawer-shell";
import { SpecDocument } from "../../../spec/spec-document";

export const dynamic = "force-dynamic";

export default function SpecDocumentDrawer() {
  return (
    <DrawerShell title="SPEC.md">
      <SpecDocument />
    </DrawerShell>
  );
}
```

(The `../../../spec/spec-document` relative path mirrors the existing `@drawer/(.)spec/[key]/page.tsx`, which imports `../../../spec/requirement-detail`.)

- [ ] **Step 4: Add the button to the spec page.** In `src/app/(app)/spec/page.tsx`:

Change the imports line:
```tsx
import { PageHeader, Empty } from "@/components/ui";
```
to:
```tsx
import Link from "next/link";
import { PageHeader, Empty, buttonClass } from "@/components/ui";
```

Replace the `PageHeader` children block (the shipped-count `span`) with a flex row that keeps the count and adds the button:
```tsx
        <div className="flex items-center gap-4">
          {reqs.length > 0 && (
            <span className="font-mono text-xs text-graphite">
              <span className="text-shipped">{shipped}</span> / {reqs.length} shipped
            </span>
          )}
          <Link href="/spec/document" className={buttonClass("quiet")}>
            View SPEC.md
          </Link>
        </div>
```

- [ ] **Step 5: Typecheck + build.**

Run: `npm run typecheck && npm run build`
Expected: PASS. In the build route list, confirm BOTH `/spec/document` and `/spec/[key]` appear (the static `document` segment coexists with the dynamic `[key]` — static wins for the literal path `/spec/document`). No route-collision error.

- [ ] **Step 6: Commit.**

```bash
git add "src/app/(app)/spec/spec-document.tsx" "src/app/(app)/spec/document/page.tsx" "src/app/(app)/@drawer/(.)spec/document/page.tsx" "src/app/(app)/spec/page.tsx"
git commit -m "[TASK-043] spec map: View SPEC.md drawer (REQ-017)"
```

---

## Post-merge runtime check (operator)

After merge + a server rebuild/restart (`npm run build` then restart `next start`):
- `/spec` shows a "View SPEC.md" button; clicking it opens the drawer with orbit's raw `SPEC.md`.
- A direct visit to `/spec/document` renders the full page.
- `/spec/REQ-026` still opens the requirement-detail drawer (no regression from the static/dynamic sibling).

---

## Self-Review

**Spec coverage:**
- readSpec helper + null-safety (no project / missing file) → Task 1 (3 tests).
- `SpecDocument` raw render + empty state → Task 2 Step 1.
- page + intercept drawer mirroring `/spec/[key]` → Task 2 Steps 2–3.
- "View SPEC.md" `quiet` button in the header → Task 2 Step 4.
- Read-only / no event → no DB write or `emitEvent` anywhere in the plan (Global Constraints).
- REQ-017 mapping, no markdown dep → honored (raw `<pre>`).
- Routing precedence note → Task 2 Step 5 build check + post-merge runtime check.

**Placeholder scan:** none — every code step is complete; the only deferral is the clearly-marked post-merge runtime check.

**Type consistency:** `readSpec` returns `{ content, path }` (`SpecDoc`); `SpecDocument` destructures `{ content }` from it — consistent. Component/route names (`SpecDocument`, `SpecDocumentPage`, `SpecDocumentDrawer`) and import paths match the file structure. `buttonClass("quiet")` matches the real signature `buttonClass(variant: "primary" | "quiet")`.
