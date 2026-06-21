# Single-page Dashboard — Phase 2a (drawer foundation, proven on Ideas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the drawer mechanism — clicking a dashboard card opens that area *over* the dashboard as a right-side drawer — and prove it end-to-end on the interactive **Ideas** area (list + vote + submit), so the remaining areas can be converted mechanically in Phase 2b.

**Architecture:** Next.js **parallel + intercepting routes**. A `@drawer` parallel slot in the `(app)` layout renders an intercepted route as an overlay; a soft navigation from `/dashboard` to `/ideas` is intercepted into the drawer, while a hard visit/refresh of `/ideas` still renders the full page. The area's content is extracted into a shared server component reused by both the full page and the drawer, and its server actions move to a shared `actions.ts`. **This is the spike for the whole drawer phase** — if interception cannot be made to work in this Next 16 + `(app)` route-group setup, fall back to a client-rendered drawer (see Task 1's fallback note) and report it.

**Tech Stack:** Next.js 16 App Router (React 19 server components + a small client `DrawerShell`), Tailwind v4, Drizzle/Postgres, Node `tsx --test` + pglite.

## Global Constraints

- **TypeScript; no `any`** in domain code.
- **Reuse, don't rewrite, the domain logic.** Drawer content is the existing Ideas content + the existing server actions (`castVote`, `promoteIdea`, `submitIdea`); only their *location* changes (page → shared component/`actions.ts`). Every state change still emits its event in-transaction via the existing tested code.
- **`tasks.github_status` is webhook-only.**
- **Reuse the existing ledger design system** — no new theme/colors.
- **Commits start with `[TASK-033]`** on branch `task-033-dashboard-drawers`. Implements **REQ-028**.
- **Drawer actions must revalidate BOTH `/dashboard` and `/ideas`** so the dashboard card and the open drawer stay consistent after a mutation.
- Phase 2a converts **only Ideas**; the other 11 cards keep linking to their full routes until Phase 2b.

---

## File Structure

**New**
- `src/components/drawer-shell.tsx` — `"use client"` overlay (scrim + right panel; closes on Esc / scrim / back).
- `src/app/(app)/@drawer/default.tsx` — parallel-slot default (renders `null`).
- `src/app/(app)/@drawer/(.)ideas/page.tsx` — the intercepted Ideas drawer.
- `src/app/(app)/ideas/ideas-panel.tsx` — the extracted Ideas content (server component), reused by the full page + the drawer.
- `src/app/(app)/ideas/actions.ts` — `"use server"` `approve` + `promote` actions (revalidate `/ideas` + `/dashboard`).

**Modified**
- `src/components/donut.tsx` — inline the percent; drop the `@/dashboard/summarize` import (client-safety, flagged by Phase 1 review).
- `src/app/(app)/layout.tsx` — accept the `drawer` parallel slot and render it.
- `src/app/(app)/ideas/page.tsx` — render `<IdeasPanel/>` + the existing header; use the shared actions.

---

## Task 0: Make Donut client-safe

**Files:** Modify `src/components/donut.tsx`

**Interfaces:** Produces the same `Donut({ value, max, size? })` — but with no `@/dashboard` import.

> Phase 1's review flagged that `Donut` imports `pct` from `@/dashboard/summarize`, which transitively pulls server-only query types. Drawers will render viz inside client boundaries, so inline the tiny calc now.

- [ ] **Step 1: Inline the percent and remove the summarize import**

In `src/components/donut.tsx`, delete `import { pct } from "@/dashboard/summarize";` and replace the `const p = pct(value, max);` line with an inline clamp identical in behavior to `pct`:

```tsx
const p = max <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((100 * value) / max)));
```

Leave the rest of the component unchanged.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`pct` stays exported/tested in `summarize.ts` for other callers; only `Donut` stops importing it.)

- [ ] **Step 3: Commit**

```bash
git add src/components/donut.tsx
git commit -m "[TASK-033] make Donut client-safe (inline percent, drop @/dashboard import) (REQ-028)"
```

---

## Task 1: Drawer foundation (shell + parallel slot)

**Files:**
- Create `src/components/drawer-shell.tsx`, `src/app/(app)/@drawer/default.tsx`
- Modify `src/app/(app)/layout.tsx`

**Interfaces:**
- Produces: `DrawerShell({ title, children })` (client); the `(app)` layout now renders a `drawer` parallel slot.

> No user-visible drawer yet (no interceptor until Task 2) — this task wires the plumbing. The existing pages and dashboard must still render unchanged.

- [ ] **Step 1: Write the DrawerShell client component**

```tsx
// src/components/drawer-shell.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

// A right-side drawer over the dashboard. Closing returns to the underlying
// page via router.back() (the drawer is an intercepted route).
export function DrawerShell({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <div className="fixed inset-0 z-30">
      <button
        aria-label="Close"
        onClick={() => router.back()}
        className="absolute inset-0 cursor-default bg-ink/15"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-hairline bg-paper shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h2 className="font-display text-lg text-ink">{title}</h2>
          <button
            onClick={() => router.back()}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-md text-graphite transition-colors hover:bg-paper-sunk hover:text-ink"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Add the parallel-slot default**

```tsx
// src/app/(app)/@drawer/default.tsx
export default function DrawerDefault() {
  return null;
}
```

- [ ] **Step 3: Wire the `drawer` slot into the layout**

In `src/app/(app)/layout.tsx`, change the component signature and render the slot. Update the signature:

```tsx
export default async function AppLayout({
  children,
  drawer,
}: {
  children: ReactNode;
  drawer: ReactNode;
}) {
```

and render `{drawer}` immediately after the `<main>…</main>` (still inside the right-hand `<div className="flex min-h-dvh flex-col">`), e.g.:

```tsx
        <main className="mx-auto w-full max-w-7xl flex-1 px-8 py-8">{children}</main>
        {drawer}
```

- [ ] **Step 4: Typecheck + confirm nothing regressed**

Run: `npm run typecheck` → clean.
(With only `default.tsx` (null) in the slot and no interceptor yet, every existing route renders exactly as before.)

- [ ] **Step 5: Commit**

```bash
git add src/components/drawer-shell.tsx "src/app/(app)/@drawer/default.tsx" "src/app/(app)/layout.tsx"
git commit -m "[TASK-033] drawer foundation: DrawerShell + @drawer parallel slot (REQ-028)"
```

**Fallback (if Task 2's interception proves unworkable):** if a soft nav to `/ideas` does not intercept into the slot (renders full-page or 404s) and it can't be resolved, abandon interception and instead make `DrawerShell` open from a client `<DrawerLink>` that `router.push`es a `?drawer=ideas` query param, with the layout reading the param and rendering the panel. Report this as a BLOCKED escalation with what you observed before switching.

---

## Task 2: Ideas drawer (the end-to-end proof)

**Files:**
- Create `src/app/(app)/ideas/ideas-panel.tsx`, `src/app/(app)/ideas/actions.ts`, `src/app/(app)/@drawer/(.)ideas/page.tsx`
- Modify `src/app/(app)/ideas/page.tsx`

**Interfaces:**
- Consumes: `DrawerShell`; existing `listVotingIdeas`, `idsUserVotedFor`, `castVote`, `promoteIdea`, `listScratchIdeas`, `promoteIdea`, `ideaDecay`, `APPROVAL_GATE`, ui primitives.
- Produces: `IdeasPanel()` (async server component, self-fetches); `approve`/`promote` server actions in `actions.ts`.

- [ ] **Step 1: Extract the server actions** into `src/app/(app)/ideas/actions.ts`

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { castVote } from "@/ideas/vote";
import { promoteIdea } from "@/ideas/scratch";

async function revalidate() {
  revalidatePath("/ideas");
  revalidatePath("/dashboard"); // keep the dashboard's Ideas card in sync
}

export async function approve(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await castVote(getDb(), String(formData.get("ideaId")), session.user.id);
  await revalidate();
}

export async function promote(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await promoteIdea(getDb(), String(formData.get("ideaId")), session.user.id);
  await revalidate();
}
```

- [ ] **Step 2: Extract the Ideas content** into `src/app/(app)/ideas/ideas-panel.tsx` (self-fetching server component — the body of the current page, minus the `PageHeader`/submit link, using the shared actions)

```tsx
// src/app/(app)/ideas/ideas-panel.tsx
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { listVotingIdeas, idsUserVotedFor } from "@/ideas/queries";
import { APPROVAL_GATE } from "@/ideas/gate";
import { ideaDecay } from "@/ideas/decay";
import { listScratchIdeas } from "@/ideas/scratch";
import { Card, Pill, Empty, buttonClass } from "@/components/ui";
import { approve, promote } from "./actions";

export async function IdeasPanel() {
  const session = await auth();
  const db = getDb();
  const votedIds = session?.user?.id ? new Set(await idsUserVotedFor(db, session.user.id)) : new Set<string>();
  const scratch = session?.user?.id ? await listScratchIdeas(db, session.user.id) : [];
  const now = Date.now();
  const ideas = (await listVotingIdeas(db))
    .map((i) => ({ ...i, decay: ideaDecay(i.lastActivityAt, now) }))
    .sort((a, b) => b.decay.idleDays - a.decay.idleDays || b.voteCount - a.voteCount);

  return (
    <>
      {ideas.length === 0 ? (
        <Empty title="No ideas in voting.">Submit one to open it for the team&apos;s votes.</Empty>
      ) : (
        <ul className="grid gap-3">
          {ideas.map((i) => {
            const passed = i.voteCount >= APPROVAL_GATE;
            return (
              <li key={i.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <strong className="font-display text-lg text-ink">{i.title}</strong>
                    <div className="flex shrink-0 items-center gap-2">
                      {i.decay.level === "stale" && <Pill tone="planned">stale {i.decay.idleDays}d</Pill>}
                      {i.decay.level === "quiet" && <Pill tone="neutral" dot={false}>quiet {i.decay.idleDays}d</Pill>}
                      <Pill tone={passed ? "shipped" : "neutral"} dot={!passed}>{i.voteCount} / {APPROVAL_GATE} approvals</Pill>
                    </div>
                  </div>
                  <div className="mt-1 font-mono text-xs text-graphite">
                    by {i.authorLogin}
                    {i.feasibility != null && ` · feasibility ${i.feasibility}`}
                    {i.viability != null && ` · viability ${i.viability}`}
                  </div>
                  <p className="font-serif mt-3 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-soft">{i.why}</p>
                  <div className="mt-3 border-t border-hairline pt-3 text-sm">
                    {!session?.user?.id ? (
                      <span className="text-graphite">Sign in to vote.</span>
                    ) : votedIds.has(i.id) ? (
                      <Pill tone="shipped">you approved this</Pill>
                    ) : (
                      <form action={approve}>
                        <input type="hidden" name="ideaId" value={i.id} />
                        <button type="submit" className={buttonClass("primary")}>Approve</button>
                      </form>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {scratch.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex items-center gap-2.5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-graphite">Scratch · yours</h2>
            <span className="font-mono text-[11px] text-graphite">{scratch.length}</span>
            <div className="h-px flex-1 bg-hairline" />
          </div>
          <ul className="grid gap-2">
            {scratch.map((s) => (
              <li key={s.id}>
                <Card className="flex items-center gap-3 border-dashed p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ink">{s.title}</div>
                    {s.why && <div className="truncate text-[13px] text-graphite">{s.why}</div>}
                  </div>
                  <form action={promote} className="shrink-0">
                    <input type="hidden" name="ideaId" value={s.id} />
                    <button type="submit" className={buttonClass("quiet")}>Submit for voting</button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
```

- [ ] **Step 3: Rewrite the full page** to use the shared panel (`src/app/(app)/ideas/page.tsx`)

```tsx
import { PageHeader, buttonClass } from "@/components/ui";
import { IdeasPanel } from "./ideas-panel";

export const dynamic = "force-dynamic";

export default function IdeasPage() {
  return (
    <>
      <PageHeader
        eyebrow="Intake"
        title="Ideas in voting"
        lede="Two approvals carry an idea through the gate. Ideas left untended drift to the top — vote them up or let them go."
      >
        <a href="/ideas/new" className={buttonClass("primary")}>Submit an idea</a>
      </PageHeader>
      <IdeasPanel />
    </>
  );
}
```

- [ ] **Step 4: Add the intercepted drawer route** (`src/app/(app)/@drawer/(.)ideas/page.tsx`)

```tsx
import { DrawerShell } from "@/components/drawer-shell";
import { IdeasPanel } from "../../ideas/ideas-panel";

export const dynamic = "force-dynamic";

export default function IdeasDrawer() {
  return (
    <DrawerShell title="Ideas in voting">
      <a href="/ideas/new" className="mb-4 inline-block text-sm text-spine-deep hover:underline">+ Submit an idea</a>
      <IdeasPanel />
    </DrawerShell>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Prove it in the browser (this is the spike's acceptance test)**

`npm run build` then `npm start` (stop any other server on :3000 first). Sign in, then:
1. On `/dashboard`, click the **Ideas** KPI card → URL becomes `/ideas` and a right drawer opens **over** the dashboard showing the ideas list.
2. **Approve** an idea in the drawer → it records the vote and the drawer + the dashboard card both reflect it (revalidated).
3. Press **Esc**, click the **scrim**, and the **✕** — each closes the drawer back to `/dashboard`.
4. **Refresh** while on `/ideas` (or open `/ideas` directly) → it renders the **full page** (header + list), not the drawer.

If step 1 shows a full page instead of a drawer (interception not firing), iterate on the file conventions; if it cannot be made to work, invoke the Task 1 fallback and report BLOCKED with observations.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/ideas/ideas-panel.tsx" "src/app/(app)/ideas/actions.ts" "src/app/(app)/@drawer/(.)ideas/page.tsx" "src/app/(app)/ideas/page.tsx"
git commit -m "[TASK-033] Ideas drawer via intercepting route (REQ-028)"
```

---

## Task 3: Verify + finish

- [ ] **Step 1: Full suite** — `npm test` → all pass (no test files changed this phase; the suite must stay green). Stop any `:3000` server first so the parallel pglite tests don't get starved.
- [ ] **Step 2: Typecheck + build** — `npm run typecheck` clean; `npm run build` succeeds; `/ideas` and `/dashboard` present.
- [ ] **Step 3: Final manual confirm** — re-run the Task 2 Step 6 checklist once more on the production build.
- [ ] **Step 4: Hand off** — report. Ready for finishing-a-development-branch. Phase 2b (convert the other 11 areas to drawers, mechanically following this exact pattern) is the next plan.

---

## Self-Review

**Spec coverage (Phase 2a scope):** drawer-from-card mechanism → Tasks 1–2; reuse existing page body + server actions (not rewritten) → Task 2 (`IdeasPanel` + `actions.ts`); URL-addressable + back/Esc/scrim close + full-page fallback on direct visit → DrawerShell + intercepting route + `default.tsx`; LLM-never-on-load preserved (Ideas has no LLM; the pattern carries to LLM areas in 2b where the run-buttons stay explicit). The "spike first" mandate → this whole plan is the spike, with a stated fallback. Out of scope (other 11 areas, Spec tab) deferred to later plans.

**Placeholder scan:** every code step has complete code; every run step a command + expected result. No TBD.

**Type consistency:** `DrawerShell({title,children})`; layout gains `drawer: ReactNode`; `IdeasPanel()` async server component; `approve`/`promote` are `(formData: FormData) => Promise<void>` server actions imported by both the panel and (transitively) the page. `promoteIdea` is imported from `@/ideas/scratch` (matches the original page's import), `castVote` from `@/ideas/vote`. Donut keeps its `{value,max,size?}` signature. The dashboard Ideas card already links to `/ideas` (Phase 1), so no card change is needed for interception.
