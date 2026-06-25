# Per-repo design prototypes on /connect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/connect` "Design prototypes" section per bound repo (it currently shows only the active project's library), consistent with the per-repo context-pins pattern on the same page.

**Architecture:** Pass an explicit `projectId` into the prototype UI instead of resolving the active project. `DesignPrototypes` and `PrototypeUploadForm` take props; the page renders one block per bound repo; `addPrototypeAction` reads `projectId` from the form (like `savePins`).

**Tech Stack:** Next.js (App Router, React server + client components, server actions), TypeScript, Tailwind (ledger design tokens).

**Design doc:** `docs/superpowers/specs/2026-06-25-per-repo-prototypes-design.md`

## Global Constraints

- **Requirement:** REQ-030 (Design prototype context) — refinement, **no new REQ**. Branch `task-069-per-repo-prototypes`; PR title + squash start `[TASK-069]`.
- **Truth model unchanged:** `addPrototype`/`removePrototype` still emit `prototype.added`/`prototype.removed` in-tx. The only change is `addPrototypeAction` sources `projectId` from the form instead of the active project — the event's `projectId` is the same value (the project being uploaded to). No schema change, no new events, no `github_status` write.
- **No `any`.** Use the existing ledger design tokens (`text-graphite`, `text-ink`, `border-hairline`, `Card`, `Empty`, etc.) — no new palette.
- **No unit tests for this change:** React components and auth-gated server actions are not unit-tested in this repo (same as TASK-068's UI task and the other `/connect` actions). Store-level per-project scoping is already covered by `src/prototypes/store.test.ts`. Verify via `typecheck` + `build` + runtime.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- `src/app/(app)/connect/prototype-upload-form.tsx` — client upload form; gains a `projectId` prop + hidden input (modify).
- `src/app/(app)/connect/actions.ts` — `addPrototypeAction` reads `projectId` from the form (modify).
- `src/app/(app)/connect/prototypes.tsx` — `DesignPrototypes` takes `{ projectId, repoFullName }` props, drops `activeProjectId()` (modify).
- `src/app/(app)/connect/page.tsx` — render one `DesignPrototypes` per bound repo (modify).

---

## Task 1: Per-repo design prototypes on /connect

**Files:**
- Modify: `src/app/(app)/connect/prototype-upload-form.tsx`
- Modify: `src/app/(app)/connect/actions.ts`
- Modify: `src/app/(app)/connect/prototypes.tsx`
- Modify: `src/app/(app)/connect/page.tsx`

**Interfaces:**
- Consumes: `listProjectPrototypes(db, projectId)`, `addPrototype`, `removePrototype` (from `@/prototypes/store`, unchanged); `boundProjects` (already fetched in `page.tsx` via `listProjectsWithPins`, each `{ id, repoFullName, … }`).
- Produces: `DesignPrototypes({ projectId, repoFullName })`; `PrototypeUploadForm({ projectId })`; `addPrototypeAction` reads `formData.get("projectId")`.

- [ ] **Step 1: Give the upload form an explicit `projectId`**

In `src/app/(app)/connect/prototype-upload-form.tsx`, change the component signature to accept `projectId` and render it as a hidden field so the action receives the explicit project (mirrors `savePins`'s `<input type="hidden" name="projectId">`):

```tsx
export function PrototypeUploadForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<ProtoState, FormData>(addPrototypeAction, null);

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <Field label="Label">
```

(Leave the rest of the form — label input, file input, submit button, banner — exactly as is.)

- [ ] **Step 2: Read `projectId` from the form in `addPrototypeAction`**

In `src/app/(app)/connect/actions.ts`, in `addPrototypeAction`, replace the active-project lookup with the form value. Change:

```ts
  const db = getDb();
  const pid = await activeProjectId();
  await addPrototype(db, { projectId: pid, label, html, actorId: session.user.id });
```

to:

```ts
  const db = getDb();
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { ok: false, error: "Missing project." };
  await addPrototype(db, { projectId, label, html, actorId: session.user.id });
```

Then remove the now-unused `activeProjectId` import **only if** no other action in this file still uses it (grep first; `removePrototypeAction` does not use it — but other actions in the file might). If still used elsewhere, leave the import.

- [ ] **Step 3: Make `DesignPrototypes` take props instead of the active project**

In `src/app/(app)/connect/prototypes.tsx`, change the component to accept `{ projectId, repoFullName }`, drop the `activeProjectId()` call, add a repo-name header, and pass `projectId` to the form:

```tsx
export async function DesignPrototypes({ projectId, repoFullName }: { projectId: string; repoFullName: string }) {
  const db = getDb();
  const protos = await listProjectPrototypes(db, projectId);

  return (
    <div className="mb-4">
      <div className="mb-2 font-mono text-[12px] text-ink">{repoFullName}</div>
      <Card className="p-4">
        <p className="mb-4 text-[13px] text-graphite">
          Upload HTML prototypes to give the generation model a visual reference. Each is rendered to a PNG by the
          background worker and included in this repo&apos;s generation context.
        </p>

        <PrototypeUploadForm projectId={projectId} />
```

Keep the list + empty-state markup below exactly as is (it already uses `protos`, `/prototype/${p.id}.png`, and `removePrototypeAction`). Remove the now-unused imports: `activeProjectId` (from `@/project/current`) and the outer `<section className="mb-6">` wrapper + its "Design prototypes" heading move to the page (Step 4), so this component now returns the per-repo `<div>` shown above. Drop the `import { activeProjectId } from "@/project/current";` line.

- [ ] **Step 4: Render one block per bound repo on the page**

In `src/app/(app)/connect/page.tsx`, replace the single `<DesignPrototypes />` (the `{/* Design prototypes */}` line, currently `<DesignPrototypes />`) with a section that maps over `boundProjects` and gives the section its own heading:

```tsx
      {/* Design prototypes — per bound repo */}
      {boundProjects.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">Design prototypes</div>
          {boundProjects.map((p) => (
            <DesignPrototypes key={p.id} projectId={p.id} repoFullName={p.repoFullName} />
          ))}
        </section>
      )}
```

(`boundProjects` is already in scope, each entry has `id` and `repoFullName` — both are already used in the "Bound repos" list above.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean (no errors). If it flags an unused `activeProjectId` import in `prototypes.tsx` or `actions.ts`, remove that import line.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: success; `/connect` compiles as a dynamic route.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/connect/prototype-upload-form.tsx" "src/app/(app)/connect/actions.ts" "src/app/(app)/connect/prototypes.tsx" "src/app/(app)/connect/page.tsx"
git commit -m "$(cat <<'EOF'
[TASK-069] design prototypes are managed per bound repo on /connect (REQ-030)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification & wrap-up (controller, after Task 1)

- [ ] `npm test` (the full suite — confirm the store/prototype tests and everything else still pass; no test changes, so this is a regression check). `npm run typecheck`, `npm run build`.
- [ ] Event-integrity review of the diff: confirm the only behavioral change is the `projectId` source; events still emitted in-tx; no `github_status`/schema/`any` impact. (Small diff — a focused review.)
- [ ] Runtime walkthrough on the deploy: with ≥2 repos bound, `/connect` shows a "Design prototypes" block per repo; uploading under repo A adds to A only; the thumbnail renders within a tick; removing is scoped to its own repo. (No migration, no new REQ — web-only restart on deploy; the worker render sweep is unchanged.)
- [ ] PR `[TASK-069] design prototypes per bound repo on /connect (REQ-030)`; squash-merge.

---

## Self-Review

**Spec coverage** (against `2026-06-25-per-repo-prototypes-design.md`):
- §Design change 1 (`DesignPrototypes` props) → Step 3. ✔
- §Design change 2 (page loops over bound repos) → Step 4. ✔
- §Design change 3 (`addPrototypeAction` reads form `projectId`) → Step 2. ✔
- §Design change 4 (`PrototypeUploadForm` projectId prop + hidden input) → Step 1. ✔
- §Design change 5 (`removePrototypeAction` unchanged) → not touched, correct. ✔
- §Edge: no bound repos → section renders nothing (Step 4 `boundProjects.length > 0` guard). ✔
- §Edge: repo with no prototypes → existing empty state inside its block (Step 3 keeps the empty-state markup). ✔
- §Testing → Verification section (typecheck/build/runtime; store scoping already covered). ✔

**Placeholder scan:** no TBD/TODO. The import-removal steps are conditional-on-grep, with the exact line to drop named — concrete, not a placeholder.

**Type consistency:** `DesignPrototypes({ projectId: string; repoFullName: string })` (Step 3) is called with exactly those props in Step 4; `PrototypeUploadForm({ projectId: string })` (Step 1) is rendered with `projectId={projectId}` in Step 3; `addPrototypeAction` reads `formData.get("projectId")` (Step 2) matching the hidden input name `"projectId"` (Step 1). Consistent.
