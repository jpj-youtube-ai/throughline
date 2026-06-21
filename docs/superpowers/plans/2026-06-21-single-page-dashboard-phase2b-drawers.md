# Single-page Dashboard — Phase 2b (convert remaining 11 areas to drawers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the remaining 11 dashboard areas into drawers using the proven Ideas pattern, and harden the shared `DrawerShell` with focus management so every drawer is an accessible modal.

**Architecture:** Mechanical replication of the **Phase 2a Ideas pattern** (already on `main`): for each area, extract the page body into a self-fetching `<area>-panel.tsx` server component reused by both the full page (fallback) and an intercepted `@drawer/(.)<area>` route; move inline server actions to `<area>/actions.ts` and add `/dashboard` revalidation. The Ideas trio is the literal template: `src/app/(app)/ideas/{ideas-panel.tsx,actions.ts,page.tsx}` + `src/app/(app)/@drawer/(.)ideas/page.tsx`.

**Tech Stack:** Next.js 16 App Router (parallel + intercepting routes, server components + the client `DrawerShell`), Tailwind v4, Drizzle/Postgres.

## Global Constraints

- **TypeScript; no `any`.** Reuse the existing ledger design system — no new theme.
- **Pure relocation — NO domain-logic changes.** Each `<area>-panel.tsx` is the **verbatim move** of the content currently inside that page's returned JSX (below `<PageHeader>`), including its data fetches; the only behavioral change is adding `revalidatePath("/dashboard")` to each moved action.
- **State-changing actions keep emitting events via the existing tested code** (`logWorkRetroactively`, `claimTask`/`unclaimTask`, `resolveDrift`, `materializeNarrative`, `sendDigest`, `materializeSpec`). `tasks.github_status` stays webhook-only.
- **LLM/expensive work stays click-/param-triggered, NEVER on panel render.** narrative (`regenerate`), digest (`sendNow`), reconcile (`rematerialize`) run only on their button; why-quality runs `reviewWhyQuality` only when `?run=1`. The panel must reproduce this gating exactly.
- **Each moved action revalidates BOTH its own route AND `/dashboard`** (so the dashboard card stays in sync).
- **Commits start with `[TASK-034]`** on branch `task-034-dashboard-drawers-2b`. Implements **REQ-028**.
- **Build before typecheck** when adding interceptor routes (Next regenerates `.next/types` for the `@drawer` slot; typecheck shows false errors otherwise — confirmed in Phase 2a).
- No new test files (relocation + routing; the underlying logic is already unit-tested). The gate is typecheck + build + the runtime drawer behavior.

---

## The Conversion Recipe (applied per area in Tasks 1–8)

For an area `<a>` at route `/<a>` with panel component `<A>Panel` and drawer title `<Title>`:

1. **Create `src/app/(app)/<a>/<a>-panel.tsx`** — `export async function <A>Panel(props)`: a server component whose body is **the exact JSX + data fetching currently inside `<a>/page.tsx` below the `<PageHeader>`**, moved verbatim (same queries, same markup, same classes). It imports the area's actions from `./actions` (if any).
2. **If the page defines inline `"use server"` actions:** create `src/app/(app)/<a>/actions.ts` with `"use server"` at the top, export each action moved verbatim, and add `revalidatePath("/dashboard")` next to the existing `revalidatePath("/<a>")`. The panel uses them in its `<form action={…}>`.
3. **Rewrite `src/app/(app)/<a>/page.tsx`** to: keep `export const dynamic = "force-dynamic"`, render the existing `<PageHeader …>` (same eyebrow/title/lede and any header button) followed by `<<A>Panel … />`. No data fetching left in the page itself (it moved to the panel) unless a prop (e.g. searchParams) must be threaded.
4. **Create `src/app/(app)/@drawer/(.)<a>/page.tsx`** — `export const dynamic = "force-dynamic"`; render `<DrawerShell title="<Title>"><<A>Panel … /></DrawerShell>` (import `DrawerShell` from `@/components/drawer-shell`, the panel via the relative path `../../<a>/<a>-panel`).

The dashboard cards already link to `/<a>` (Phase 1), so soft-nav from the dashboard intercepts into the drawer; a hard visit/refresh of `/<a>` renders the full page. **Verify each area** by: card → drawer opens; the action/trigger works; Esc/scrim/✕ close; refresh on `/<a>` = full page.

---

## Task 0: Focus management in DrawerShell

**Files:** Modify `src/components/drawer-shell.tsx`

**Interfaces:** Same `DrawerShell({ title, children })`; now traps focus and restores it on close. Every drawer inherits this.

- [ ] **Step 1: Add focus-on-open, focus-restore-on-close, and a Tab trap**

Replace the body of `src/components/drawer-shell.tsx` with (keeps the existing markup, adds a ref + focus effect):

```tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export function DrawerShell({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Move focus into the drawer on open.
    panel?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        router.back();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus(); // restore focus to the triggering card on close
    };
  }, [router]);

  return (
    <div className="fixed inset-0 z-30">
      <button aria-label="Dismiss" onClick={() => router.back()} className="absolute inset-0 cursor-default bg-ink/15" tabIndex={-1} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-hairline bg-paper shadow-2xl outline-none"
      >
        <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h2 className="font-display text-lg text-ink">{title}</h2>
          <button onClick={() => router.back()} aria-label="Close" className="flex size-8 items-center justify-center rounded-md text-graphite transition-colors hover:bg-paper-sunk hover:text-ink">
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </aside>
    </div>
  );
}
```

(Changes vs Phase 2a: `panelRef` on the `<aside>` with `tabIndex={-1}`+`outline-none`; focus the panel on open; restore `previouslyFocused` on cleanup; the scrim is now `tabIndex={-1}` + `aria-label="Dismiss"`; Tab/Shift+Tab wrap within the panel.)

- [ ] **Step 2: Build + typecheck**

Run: `npm run build` (regenerates slot types) then `npm run typecheck` → both clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/drawer-shell.tsx
git commit -m "[TASK-034] DrawerShell focus trap + restore (REQ-028)"
```

---

## Task 1: Read-only area drawers (heartbeat, quick-wins, pipeline, burnup)

**Files (create per area + modify each page + add interceptor):**
- heartbeat: `src/app/(app)/heartbeat/heartbeat-panel.tsx`, modify `heartbeat/page.tsx`, create `@drawer/(.)heartbeat/page.tsx`
- quick-wins: `quick-wins/quick-wins-panel.tsx`, modify `quick-wins/page.tsx`, `@drawer/(.)quick-wins/page.tsx`
- pipeline: `pipeline/pipeline-panel.tsx`, modify `pipeline/page.tsx`, `@drawer/(.)pipeline/page.tsx`
- burnup: `burnup/burnup-panel.tsx`, modify `burnup/page.tsx`, `@drawer/(.)burnup/page.tsx`

**Interfaces:** Produces `HeartbeatPanel`, `QuickWinsPanel`, `PipelinePanel`, `BurnUpPanel` (all `async` server components, no props, no actions).

> These 4 have **no server actions and no LLM** — pure read-only. Apply the Recipe steps 1, 3, 4 (skip step 2, no actions.ts). Drawer titles: "Heartbeat", "Quick wins", "Pipeline", "Burn-up". Panel body = the verbatim move of each page's content below its `<PageHeader>` (heartbeat renders `HeartbeatChart`/data via `heartbeatSeries`; quick-wins `listQuickWins`; pipeline `listPipeline`; burnup `BurnUpChart` via `burnUpSeries`).

- [ ] **Step 1:** For EACH of the 4 areas, create `<area>-panel.tsx` by moving the page's post-header body + its data fetch into `export async function <A>Panel()`, then rewrite `<area>/page.tsx` to `<PageHeader …/> + <<A>Panel/>`, then create `@drawer/(.)<area>/page.tsx` = `<DrawerShell title="<Title>"><<A>Panel/></DrawerShell>` (with `export const dynamic = "force-dynamic"`). Keep all markup/classes identical to the current page.
- [ ] **Step 2:** `npm run build` then `npm run typecheck` → both clean; build's route list still shows `/heartbeat`, `/quick-wins`, `/pipeline`, `/burnup`.
- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/heartbeat" "src/app/(app)/quick-wins" "src/app/(app)/pipeline" "src/app/(app)/burnup" "src/app/(app)/@drawer"
git commit -m "[TASK-034] read-only area drawers: heartbeat, quick-wins, pipeline, burnup (REQ-028)"
```

---

## Task 2: Pulse drawer (log-work action)

**Files:** Create `pulse/pulse-panel.tsx`, `pulse/actions.ts`, `@drawer/(.)pulse/page.tsx`; modify `pulse/page.tsx`.

**Interfaces:** `PulsePanel` (async server component, renders the activity feed + the "log work" `<details>` form); `logWork` server action in `actions.ts`.

- [ ] **Step 1:** Move `pulse/page.tsx`'s `logWork` server action into `pulse/actions.ts` (`"use server"`), and make it `revalidatePath("/pulse")` AND `revalidatePath("/dashboard")`. It calls the existing `logWorkRetroactively` exactly as today.
- [ ] **Step 2:** Move the page body (the `listActivity` fetch, the day-grouping, the activity `<ol>`, and the "Log work done off-platform" `<details>` form) into `export async function PulsePanel()` in `pulse-panel.tsx`, importing `logWork` from `./actions`. Keep markup identical.
- [ ] **Step 3:** Rewrite `pulse/page.tsx` → `<PageHeader eyebrow="The throughline" title="Pulse" lede="…"/> + <PulsePanel/>`.
- [ ] **Step 4:** Create `@drawer/(.)pulse/page.tsx` → `<DrawerShell title="Pulse"><PulsePanel/></DrawerShell>`.
- [ ] **Step 5:** `npm run build` then `npm run typecheck` → clean.
- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/pulse" "src/app/(app)/@drawer/(.)pulse"
git commit -m "[TASK-034] Pulse drawer (log-work action revalidates dashboard) (REQ-028)"
```

---

## Task 3: Tasks drawer (claim / unclaim actions)

**Files:** Create `tasks/tasks-panel.tsx`, `tasks/actions.ts`, `@drawer/(.)tasks/page.tsx`; modify `tasks/page.tsx`.

**Interfaces:** `TasksPanel` (async server component, renders the task board with claim/unclaim forms); `claim` + `unclaim` server actions.

- [ ] **Step 1:** Move the `claim` and `unclaim` `"use server"` actions into `tasks/actions.ts`; each calls the existing `claimTask`/`unclaimTask` as today and revalidates `/tasks` AND `/dashboard`.
- [ ] **Step 2:** Move the page body (`listTasks` fetch + the task board markup + the claim/unclaim forms, with the existing auth-conditional rendering) into `export async function TasksPanel()`, importing the actions from `./actions`.
- [ ] **Step 3:** Rewrite `tasks/page.tsx` → `<PageHeader …/> + <TasksPanel/>`.
- [ ] **Step 4:** Create `@drawer/(.)tasks/page.tsx` → `<DrawerShell title="Tasks"><TasksPanel/></DrawerShell>`.
- [ ] **Step 5:** `npm run build` then `npm run typecheck` → clean.
- [ ] **Step 6: Commit** `[TASK-034] Tasks drawer (claim/unclaim revalidate dashboard) (REQ-028)` (`git add "src/app/(app)/tasks" "src/app/(app)/@drawer/(.)tasks"`).

---

## Task 4: Drift drawer (resolve action)

**Files:** Create `drift/drift-panel.tsx`, `drift/actions.ts`, `@drawer/(.)drift/page.tsx`; modify `drift/page.tsx`.

- [ ] **Step 1:** Move the `resolve` `"use server"` action into `drift/actions.ts` (calls existing `resolveDrift`; revalidate `/drift` AND `/dashboard`).
- [ ] **Step 2:** Move the body (`listOpenDriftFlags` + the flags list + the resolve form) into `export async function DriftPanel()`.
- [ ] **Step 3:** Rewrite `drift/page.tsx` → `<PageHeader …/> + <DriftPanel/>`.
- [ ] **Step 4:** Create `@drawer/(.)drift/page.tsx` → `<DrawerShell title="Drift"><DriftPanel/></DrawerShell>`.
- [ ] **Step 5:** `npm run build` then `npm run typecheck` → clean.
- [ ] **Step 6: Commit** `[TASK-034] Drift drawer (resolve revalidates dashboard) (REQ-028)`.

---

## Task 5: Narrative drawer (regenerate — click-triggered LLM)

**Files:** Create `narrative/narrative-panel.tsx`, `narrative/actions.ts`, `@drawer/(.)narrative/page.tsx`; modify `narrative/page.tsx`.

- [ ] **Step 1:** Move the `regenerate` `"use server"` action (calls the LLM `materializeNarrative`) into `narrative/actions.ts`; revalidate `/narrative` AND `/dashboard`. **Do not change when it runs — it stays bound to the existing button only.**
- [ ] **Step 2:** Move the body (`getLatestNarrative` fetch + the narrative render + the "Generate/Regenerate" button form) into `export async function NarrativePanel()`. **The LLM must NOT run on render** — only `getLatestNarrative` (a read) runs on load, exactly as today.
- [ ] **Step 3:** Rewrite `narrative/page.tsx` → `<PageHeader …/> + <NarrativePanel/>`.
- [ ] **Step 4:** Create `@drawer/(.)narrative/page.tsx` → `<DrawerShell title="Narrative"><NarrativePanel/></DrawerShell>`.
- [ ] **Step 5:** `npm run build` then `npm run typecheck` → clean.
- [ ] **Step 6: Commit** `[TASK-034] Narrative drawer (regenerate stays click-only) (REQ-028)`.

---

## Task 6: Digest drawer (send-now — click-triggered)

**Files:** Create `digest/digest-panel.tsx`, `digest/actions.ts`, `@drawer/(.)digest/page.tsx`; modify `digest/page.tsx`.

- [ ] **Step 1:** Move the `sendNow` `"use server"` action (calls `sendDigest`) into `digest/actions.ts`; revalidate `/digest` AND `/dashboard`. Stays bound to the existing button only.
- [ ] **Step 2:** Move the body (the project + `digest.sent` events read + the digest render + the "Send now" button) into `export async function DigestPanel()`. No expensive work on render — only the existing reads.
- [ ] **Step 3:** Rewrite `digest/page.tsx` → `<PageHeader …/> + <DigestPanel/>`.
- [ ] **Step 4:** Create `@drawer/(.)digest/page.tsx` → `<DrawerShell title="Digest"><DigestPanel/></DrawerShell>`.
- [ ] **Step 5:** `npm run build` then `npm run typecheck` → clean.
- [ ] **Step 6: Commit** `[TASK-034] Digest drawer (send-now stays click-only) (REQ-028)`.

---

## Task 7: Reconcile drawer (re-materialize — click-triggered LLM)

**Files:** Create `reconcile/reconcile-panel.tsx`, `reconcile/actions.ts`, `@drawer/(.)reconcile/page.tsx`; modify `reconcile/page.tsx`.

- [ ] **Step 1:** Move the `rematerialize` `"use server"` action (calls `materializeSpec`) into `reconcile/actions.ts`; revalidate `/reconcile` AND `/dashboard`. Click-only.
- [ ] **Step 2:** Move the body (the project read + `fs.readFileSync(specFile)` + `reconcileStructural` + the render + the "Re-materialize SPEC.md" button) into `export async function ReconcilePanel()`. **`reconcileStructural` is the cheap no-LLM read that already runs on load (fine); the LLM `materializeSpec` stays button-only — do NOT call it on render.**
- [ ] **Step 3:** Rewrite `reconcile/page.tsx` → `<PageHeader …/> + <ReconcilePanel/>`.
- [ ] **Step 4:** Create `@drawer/(.)reconcile/page.tsx` → `<DrawerShell title="Reconciliation"><ReconcilePanel/></DrawerShell>`.
- [ ] **Step 5:** `npm run build` then `npm run typecheck` → clean.
- [ ] **Step 6: Commit** `[TASK-034] Reconcile drawer (re-materialize stays click-only) (REQ-028)`.

---

## Task 8: Why-quality drawer (?run=1 searchParam — LLM only on run)

**Files:** Create `why-quality/why-quality-panel.tsx`, `@drawer/(.)why-quality/page.tsx`; modify `why-quality/page.tsx`. (No actions.ts — it has no form action; the trigger is a `?run=1` link.)

**Interfaces:** `WhyQualityPanel({ run }: { run?: string })` — runs the LLM `reviewWhyQuality` **only when `run === "1"`**, else shows the idle "run the review" UI.

- [ ] **Step 1:** Move the page body into `export async function WhyQualityPanel({ run }: { run?: string })` — preserving the exact gating: `reviewWhyQuality(...)` is awaited **only if `run === "1"`**; otherwise render the idle CTA linking to `?run=1`. Keep the "Run review" link/markup identical.
- [ ] **Step 2:** Rewrite `why-quality/page.tsx` to read its `searchParams` and pass `run` down: `export default async function WhyQualityPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) { const { run } = await searchParams; return (<><PageHeader …/><WhyQualityPanel run={run} /></>); }` (Next 16 passes `searchParams` as a Promise).
- [ ] **Step 3:** Create `@drawer/(.)why-quality/page.tsx` that ALSO reads searchParams and forwards `run`: `export default async function WhyQualityDrawer({ searchParams }: { searchParams: Promise<{ run?: string }> }) { const { run } = await searchParams; return (<DrawerShell title="Why-quality"><WhyQualityPanel run={run} /></DrawerShell>); }` with `export const dynamic = "force-dynamic"`.
- [ ] **Step 4:** `npm run build` then `npm run typecheck` → clean.
- [ ] **Step 5: Runtime check the trigger forwarding:** confirm that opening the Why-quality drawer shows the idle CTA, and clicking "Run review" (→ `/why-quality?run=1`) re-renders the drawer with the graded results (i.e., the interceptor receives `?run=1`). If interception drops the searchParam, note it for the controller. (The controller does the signed-in browser check.)
- [ ] **Step 6: Commit** `[TASK-034] Why-quality drawer (?run=1 stays the only LLM trigger) (REQ-028)` (`git add "src/app/(app)/why-quality" "src/app/(app)/@drawer/(.)why-quality"`).

---

## Task 9: Verify + finish

- [ ] **Step 1: Full suite** — stop any `:3000` server, then `npm test` → all pass (no test files changed; suite stays green).
- [ ] **Step 2: Typecheck + build** — `npm run build` succeeds; `npm run typecheck` clean; route list shows all 11 routes.
- [ ] **Step 3: Runtime walkthrough (controller + user):** rebuild + restart the prod server; for EACH of the 11 areas confirm: dashboard card → drawer opens over the dashboard; the area's action/trigger works (log work, claim/unclaim, resolve, regenerate, send, re-materialize, run review); **no LLM fires merely on opening narrative/digest/reconcile/why-quality**; Esc/scrim/✕ close; refresh on `/<area>` = full page. Confirm focus moves into the drawer on open and back to the card on close.
- [ ] **Step 4: Hand off** — report. Ready for finishing-a-development-branch. Phase 3 (Spec upload+map tab) is the last plan.

---

## Self-Review

**Spec coverage (Phase 2b scope):** all 11 remaining areas → Tasks 1–8; focus trap (the 2a-review follow-up) → Task 0; revalidate `/dashboard` from every moved action → Tasks 2–7; LLM stays click/param-triggered (narrative/digest/reconcile/why-quality) → Tasks 5–8 explicit gating notes; the full-page fallback + URL-addressable drawer → the Recipe's page+interceptor split. Spec tab is Phase 3 (out of scope).

**Placeholder scan:** the Recipe is a complete mechanical transformation; each task names exact files, the specific action(s) to move with the exact revalidation change, and the title; the panel body is a *verbatim move of the existing page file* (the code already exists — there is nothing to invent). Task 0 and the why-quality searchParam handling are shown in full because they are the only non-mechanical parts. No "TBD".

**Type consistency:** every panel is `async function <A>Panel()` except `WhyQualityPanel({ run?: string })`; actions are `(formData: FormData) => Promise<void>` server actions in `<area>/actions.ts`; `DrawerShell({title,children})` unchanged in signature (focus behavior added internally). Drawer interceptors import `DrawerShell` from `@/components/drawer-shell` and the panel via the relative `../../<a>/<a>-panel`. The dashboard cards already point at `/<a>` (Phase 1), so no card edits are needed.
