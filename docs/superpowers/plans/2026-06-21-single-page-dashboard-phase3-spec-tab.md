# Single-page Dashboard — Phase 3 (Spec upload + map tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/spec` a self-contained tab that can **import the genesis spec from the browser** (the in-app surface of REQ-004, currently CLI-only) above the existing requirement map (REQ-017).

**Architecture:** The final phase of the redesign in `docs/superpowers/specs/2026-06-21-single-page-dashboard-design.md`. Add a genesis-upload section to the top of the existing `/spec` page: a form (file upload or paste) that calls a server action wrapping the existing `importGenesisSpec`. Genesis import is a **one-time bootstrap** (it refuses if requirements already exist), so when requirements exist the upload is replaced by a quiet "already imported" note; the requirement map renders below in both states.

**Tech Stack:** Next.js 16 App Router (React 19 — `useActionState` for the form result), Drizzle/Postgres, Tailwind v4.

## Global Constraints

- **TypeScript; no `any`.** Reuse the existing ledger design system — no new theme.
- **Reuse, don't reimplement, genesis import.** The action calls the existing `importGenesisSpec(db, specText, filename)` (`src/genesis/import.ts`), which parses (`parseSpecRequirements`), inserts requirements, and emits `project.genesis_imported` + one `requirement.declared` each **in one transaction** — untouched. Already covered by `src/genesis/import.test.ts`.
- **One-time bootstrap:** `importGenesisSpec` throws if requirements already exist; the UI shows the upload only when the table is empty and a friendly "already imported" note otherwise. Surface the thrown message as a friendly error, never an unhandled crash.
- **Commits start with `[TASK-036]`** on branch `task-036-spec-upload-tab`. This implements **REQ-004** (genesis import's in-app UI); the map below is the existing REQ-017.
- The import action **revalidates `/spec` and `/dashboard`** (the dashboard's Reconcile/Progress cards derive from requirements).
- No change to the drawer system; `/spec` stays a full routed tab (it is in the icon rail, not a drawer).

---

## File Structure

**New**
- `src/app/(app)/spec/actions.ts` — `importSpec` server action (file-or-paste → `importGenesisSpec`).
- `src/app/(app)/spec/spec-upload.tsx` — `"use client"` upload form (uses `useActionState`) + the "already imported" note.

**Modified**
- `src/app/(app)/spec/page.tsx` — render `<SpecUpload/>` above the existing map; pass whether requirements already exist.

---

## Task 1: Genesis-import server action

**Files:** Create `src/app/(app)/spec/actions.ts`

**Interfaces:**
- Consumes: `importGenesisSpec` from `@/genesis/import`; `getDb`.
- Produces: `type ImportState = { ok: true; count: number; keys: string[] } | { ok: false; error: string } | null;` and `importSpec(prev: ImportState, formData: FormData): Promise<ImportState>` (shaped for `useActionState`).

- [ ] **Step 1: Write the action**

```ts
// src/app/(app)/spec/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { importGenesisSpec } from "@/genesis/import";

export type ImportState =
  | { ok: true; count: number; keys: string[] }
  | { ok: false; error: string }
  | null;

// Import the genesis spec from the browser (REQ-004's in-app surface). Accepts a
// .md file or pasted text; delegates to importGenesisSpec (one-time bootstrap that
// emits project.genesis_imported + a requirement.declared each, in one tx).
export async function importSpec(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const file = formData.get("file");
  let text = "";
  let filename = "pasted-spec.md";
  if (file instanceof File && file.size > 0) {
    text = await file.text();
    filename = file.name || filename;
  } else {
    text = String(formData.get("text") ?? "");
  }
  if (!text.trim()) return { ok: false, error: "Paste the spec markdown or choose a file." };
  try {
    const r = await importGenesisSpec(getDb(), text, filename);
    revalidatePath("/spec");
    revalidatePath("/dashboard");
    return { ok: true, count: r.count, keys: r.keys };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Import failed." };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/spec/actions.ts"
git commit -m "[TASK-036] genesis-import server action for the Spec tab (REQ-004)"
```

---

## Task 2: Spec-upload UI + wire into the page

**Files:**
- Create `src/app/(app)/spec/spec-upload.tsx`
- Modify `src/app/(app)/spec/page.tsx`

**Interfaces:**
- Consumes: `importSpec`, `ImportState` from `./actions`; `Card`, `Field`, `fieldClass`, `buttonClass` from `@/components/ui`.
- Produces: `SpecUpload({ alreadyImported, count }: { alreadyImported: boolean; count: number })`.

- [ ] **Step 1: Write the upload component**

```tsx
// src/app/(app)/spec/spec-upload.tsx
"use client";

import { useActionState } from "react";
import { importSpec, type ImportState } from "./actions";
import { Card, Field, fieldClass, buttonClass } from "@/components/ui";

export function SpecUpload({ alreadyImported, count }: { alreadyImported: boolean; count: number }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importSpec, null);

  if (alreadyImported) {
    return (
      <Card className="mb-8 p-4">
        <p className="text-sm text-graphite">
          Genesis spec imported — <span className="text-ink">{count}</span> requirements. Import is a one-time bootstrap; further
          requirements come from approved ideas or resolved drift.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mb-8 p-4">
      <form action={action} className="grid gap-3">
        <p className="text-[13px] text-graphite">
          Import the genesis spec — upload a Markdown file or paste it. It parses into <span className="font-mono">REQ-NNN</span>{" "}
          requirements (a one-time bootstrap).
        </p>
        <Field label="Spec file (.md)">
          <input type="file" name="file" accept=".md,.markdown,text/markdown,text/plain" className={fieldClass} />
        </Field>
        <Field label="…or paste the spec">
          <textarea name="text" rows={8} className={fieldClass} placeholder="**REQ-001 — Title.** description…" />
        </Field>
        <button type="submit" disabled={pending} className={`${buttonClass("primary")} justify-self-start`}>
          {pending ? "Importing…" : "Import spec"}
        </button>
        {state?.ok === true && (
          <p className="text-[13px] text-shipped">
            Imported {state.count} requirements ({state.keys[0]}…{state.keys[state.keys.length - 1]}).
          </p>
        )}
        {state?.ok === false && <p className="text-[13px] text-risk">{state.error}</p>}
      </form>
    </Card>
  );
}
```

- [ ] **Step 2: Wire it into `src/app/(app)/spec/page.tsx`**

Add the import and render `<SpecUpload/>` between the `<PageHeader>` and the map. Change only these two spots; leave `ReqCard` and the map/groups logic unchanged.

Add to the imports at the top:

```tsx
import { SpecUpload } from "./spec-upload";
```

Then immediately after the closing `</PageHeader>` (before the `{reqs.length === 0 ? (` block), insert:

```tsx
      <SpecUpload alreadyImported={reqs.length > 0} count={reqs.length} />
```

(Optionally update the `PageHeader` `title` from `"Spec map"` to `"Spec"` and the `lede` to mention import — keep it short. The map section and its empty-state stay as-is; when the table is empty the upload form is the primary affordance and the `Empty` "Import the genesis spec…" message sits below it.)

- [ ] **Step 3: Build + typecheck**

Run: `npm run build` (regenerates route types) then `npm run typecheck` → both clean. Confirm `/spec` is still in the route list.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/spec/spec-upload.tsx" "src/app/(app)/spec/page.tsx"
git commit -m "[TASK-036] Spec tab: genesis-upload UI above the requirement map (REQ-004)"
```

---

## Task 3: Verify + finish

- [ ] **Step 1: Full suite** — stop any `:3000` server, then `npm test` → all pass (no test files added; `importGenesisSpec` is already covered by `src/genesis/import.test.ts`).
- [ ] **Step 2: Typecheck + build** — `npm run typecheck` clean; `npm run build` succeeds; `/spec` present.
- [ ] **Step 3: Runtime walkthrough (controller + user):** rebuild + restart the prod server; sign in → open the **Spec** tab. Two states:
  - **Empty DB:** the upload form shows. Paste a small valid spec (e.g. `**REQ-001 — Test.** A test requirement.`) or choose a `.md` file → **Import** → success message ("Imported N requirements"), the form is replaced by the "already imported" note, and the requirement map populates below. Pasting garbage / empty → friendly error, no crash.
  - **Already-imported DB:** the "already imported (N requirements)" note shows instead of the form; the map renders below.
  > Note: on the live deployment requirements may already exist (REQ-001…027 from the dogfood build), so the **already-imported** state is the likely one — verify that path; the empty-form path can be confirmed against a fresh/empty DB if available.
- [ ] **Step 4: Hand off** — report. Ready for finishing-a-development-branch. **This completes the single-page redesign** (Phases 1, 2a, 2b, 3).

---

## Self-Review

**Spec coverage (Phase 3):** genesis upload (file or paste) → Tasks 1–2; one-time-bootstrap "already imported" state → `SpecUpload`'s `alreadyImported` branch; requirement map below → unchanged existing page; reuse `importGenesisSpec`/`parseSpecRequirements` (not reimplemented) → Task 1 delegates; revalidate `/spec` + `/dashboard` → Task 1. The spec's "preview the parsed REQs" step is intentionally **dropped (YAGNI)** for a one-time bootstrap: `importGenesisSpec` validates input (throws on no-requirements) and the success message reports exactly what was imported (count + first…last keys); a separate preview would need a client parse path that can't import the server-only genesis module. Note this deviation.

**Placeholder scan:** all code is complete; run steps have commands + expected results. No TBD.

**Type consistency:** `ImportState` is shared by the action and the component; `importSpec(prev: ImportState, formData: FormData)` matches React 19 `useActionState<ImportState, FormData>` (state, formAction, isPending). `SpecUpload({ alreadyImported, count })` is consumed by `page.tsx` with `alreadyImported={reqs.length > 0} count={reqs.length}`. `importGenesisSpec(db, specText, filename) → { filename, count, keys }` matches Task 1's usage. `Field`/`fieldClass`/`buttonClass`/`Card` exist in `@/components/ui`.

**REQ linkage:** implements REQ-004 (genesis import's in-app UI); precedent: TASK-028 = REQ-002's binding UI. The map is existing REQ-017. (If the user prefers a new REQ instead, declare it via `declareRequirement` and relabel before merge.)
