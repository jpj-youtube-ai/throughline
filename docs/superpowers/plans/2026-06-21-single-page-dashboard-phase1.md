# Single-page Dashboard — Phase 1 (shell + layout + viz) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tabbed dashboard-home with a reference-style, single-page card dashboard and a 3-item icon rail (Dashboard · Spec · Connect), reusing all existing data.

**Architecture:** Phase 1 of the redesign in `docs/superpowers/specs/2026-06-21-single-page-dashboard-design.md`. The shell becomes a narrow icon rail; `/dashboard` becomes a curated grid (KPI row · Heartbeat hero + Progress donut · Quick-wins/Pipeline · Reconcile/Why-quality · right rail of Narrative/Pulse/Digest). Cards link to the **existing** area routes for now; drawers replace those links in a later phase. All card data comes from the queries/summarizers/cheap-proxies already built in TASK-031.

**Tech Stack:** Next.js 16 App Router (React 19 server components), Tailwind v4 (theme-color stroke/fill utilities like `stroke-spine`), Drizzle/Postgres, Node `tsx --test` + pglite.

## Global Constraints

- **TypeScript throughout; no `any`** in domain code.
- **The dashboard page and every card summary are READ-ONLY** — no events, no writes, **no LLM call on load**. The three LLM areas (Digest, Reconcile, Why-quality) keep showing their cheap proxies (`digestSummary`, `structuralReconciliationForProject`, `countRationales`).
- **`tasks.github_status` is webhook-only** — do not write it.
- **Reuse the existing ledger design system** — no new theme. SVGs are colored with Tailwind theme utilities (`stroke-spine`, `stroke-hairline`, `fill-spine`, `fill-ink`, `fill-graphite`, `fill-spine-wash`), per `burnup-chart.tsx`/`heartbeat-chart.tsx`.
- **Commits start with `[TASK-032]`** on branch `task-032-single-page-dashboard`. This phase implements **REQ-028** (the dashboard, evolved IA).
- New `*.test.ts` files **must be appended to the `test` script list in `package.json`** (explicit file list, not a glob).
- This phase **keeps the existing 13 area routes working** (cards link to them); it does **not** build drawers or the Spec-upload UI (later phases).

---

## File Structure

**New**
- `src/components/donut.tsx` — `Donut` (progress ring; presentational, uses `pct`).
- `src/components/icons.tsx` — add `ConnectIcon` (modify).

**Modified**
- `src/components/sparkline-math.ts` — add `sparklineAreaPath` (pure).
- `src/components/sparkline.tsx` — `Sparkline` gains an optional `area` fill.
- `src/components/sparkline.test.ts` — test `sparklineAreaPath`.
- `src/dashboard/summarize.ts` — add `ideasAwaitingVote` (pure).
- `src/dashboard/summarize.test.ts` — test it.
- `src/components/nav-rail.tsx` — rewrite to the 3-item icon rail.
- `src/app/(app)/layout.tsx` — narrow rail column; wider main; avatar/sign-out in the rail footer.
- `src/app/(app)/dashboard/page.tsx` — rewrite into the reference grid.

---

## Task 1: Sparkline area fill (for the Heartbeat hero)

**Files:**
- Modify: `src/components/sparkline-math.ts`, `src/components/sparkline.tsx`
- Test: `src/components/sparkline.test.ts`

**Interfaces:**
- Consumes: existing `sparklinePath(values, width?, height?)` in `sparkline-math.ts`.
- Produces: `sparklineAreaPath(values: number[], width?: number, height?: number): string` (a closed path for the fill, baseline at `height`); `Sparkline` gains `area?: boolean`.

- [ ] **Step 1: Write the failing test** (append to `src/components/sparkline.test.ts`)

```ts
import { sparklineAreaPath } from "./sparkline-math";

test("sparklineAreaPath closes the line down to the baseline", () => {
  const d = sparklineAreaPath([0, 1, 2], 96, 24);
  // starts at the first point on the line, ends by closing along the baseline (y=height) back to x=0
  assert.ok(d.startsWith("M0.00,24.00"));
  assert.ok(d.includes("96.00,0.00")); // the max point (top)
  assert.ok(d.trimEnd().endsWith("L96.00,24.00 L0.00,24.00 Z")); // down to baseline, back, closed
});

test("sparklineAreaPath is empty-safe", () => {
  assert.equal(sparklineAreaPath([], 100, 20), "");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/components/sparkline.test.ts`
Expected: FAIL — `sparklineAreaPath` is not exported.

- [ ] **Step 3: Implement the pure area path** (append to `src/components/sparkline-math.ts`)

```ts
// A closed area path under the same polyline as sparklinePath: the line, then
// down to the baseline (y=height) and back to x=0. Empty series -> "".
export function sparklineAreaPath(values: number[], width = 96, height = 24): string {
  const n = values.length;
  if (n === 0) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = n === 1 ? width / 2 : (i * width) / (n - 1);
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const lastX = n === 1 ? width / 2 : width;
  const firstX = n === 1 ? width / 2 : 0;
  return `M${pts.join(" L")} L${lastX.toFixed(2)},${height.toFixed(2)} L${firstX.toFixed(2)},${height.toFixed(2)} Z`;
}
```

- [ ] **Step 4: Add the `area` option to the component** (`src/components/sparkline.tsx`)

```tsx
import { sparklinePath, sparklineAreaPath } from "./sparkline-math";

export function Sparkline({
  values,
  width = 96,
  height = 24,
  area = false,
  className = "",
}: {
  values: number[];
  width?: number;
  height?: number;
  area?: boolean;
  className?: string;
}) {
  const { path } = sparklinePath(values, width, height);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden="true" className={className}>
      {area && <path d={sparklineAreaPath(values, width, height)} className="fill-spine-wash" stroke="none" />}
      <path d={path} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
```

- [ ] **Step 5: Run the test + typecheck**

Run: `npx tsx --test src/components/sparkline.test.ts` → Expected: PASS (all sparkline tests).
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/sparkline-math.ts src/components/sparkline.tsx src/components/sparkline.test.ts
git commit -m "[TASK-032] Sparkline optional area fill for the dashboard hero (REQ-028)"
```

---

## Task 2: Donut component (Progress ring)

**Files:**
- Create: `src/components/donut.tsx`

**Interfaces:**
- Consumes: `pct` from `@/dashboard/summarize`.
- Produces: `Donut({ value: number; max: number; size?: number })`.

> Presentational — no unit test (the math is `pct`, already tested). Verified by typecheck + visual.

- [ ] **Step 1: Write the component**

```tsx
// src/components/donut.tsx
import { pct } from "@/dashboard/summarize";

// A progress ring. Track in hairline, progress arc in the spine accent, percent
// centered. pathLength=100 lets the dasharray be the percent directly.
export function Donut({ value, max, size = 88 }: { value: number; max: number; size?: number }) {
  const p = pct(value, max); // 0..100, clamped + rounded
  return (
    <svg width={size} height={size} viewBox="0 0 42 42" role="img" aria-label={`${p}% complete`}>
      <circle cx="21" cy="21" r="15.9" fill="none" className="stroke-hairline" strokeWidth={4} />
      <circle
        cx="21"
        cy="21"
        r="15.9"
        fill="none"
        className="stroke-spine"
        strokeWidth={4}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${p} 100`}
        transform="rotate(-90 21 21)"
      />
      <text x="21" y="24" textAnchor="middle" className="fill-ink font-display text-[9px] font-bold">
        {p}%
      </text>
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean. (If a `stroke-spine`/`stroke-hairline`/`fill-ink` class produced no color in the visual check later, it's a Tailwind theme gap — but `burnup-chart.tsx` already uses exactly these, so they resolve.)

- [ ] **Step 3: Commit**

```bash
git add src/components/donut.tsx
git commit -m "[TASK-032] Donut progress ring component (REQ-028)"
```

---

## Task 3: `ideasAwaitingVote` summarizer

**Files:**
- Modify: `src/dashboard/summarize.ts`
- Test: `src/dashboard/summarize.test.ts`

**Interfaces:**
- Consumes: `VotingIdea` type from `@/ideas/queries`.
- Produces: `ideasAwaitingVote(ideas: VotingIdea[], votedIds: string[]): VotingIdea[]` — ideas the viewer has NOT yet voted on (their `id` not in `votedIds`).

- [ ] **Step 1: Write the failing test** (append to `src/dashboard/summarize.test.ts`)

```ts
import type { VotingIdea } from "../ideas/queries";
import { ideasAwaitingVote } from "./summarize";

function idea(p: Partial<VotingIdea> & { id: string }): VotingIdea {
  return {
    id: p.id, title: p.id, why: null, feasibility: null, viability: null,
    authorLogin: "a", voteCount: 0, createdAt: new Date(0), lastActivityAt: new Date(0), ...p,
  };
}

test("ideasAwaitingVote excludes ideas the viewer already voted on", () => {
  const ideas = [idea({ id: "i1" }), idea({ id: "i2" }), idea({ id: "i3" })];
  const out = ideasAwaitingVote(ideas, ["i2"]);
  assert.deepEqual(out.map((i) => i.id), ["i1", "i3"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/dashboard/summarize.test.ts`
Expected: FAIL — `ideasAwaitingVote` not exported.

- [ ] **Step 3: Implement** (append to `src/dashboard/summarize.ts`; add the import at top)

```ts
import type { VotingIdea } from "../ideas/queries";

// Ideas the current viewer has not yet voted on (drives the "needs votes" badge).
export function ideasAwaitingVote(ideas: VotingIdea[], votedIds: string[]): VotingIdea[] {
  const voted = new Set(votedIds);
  return ideas.filter((i) => !voted.has(i.id));
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx tsx --test src/dashboard/summarize.test.ts` → PASS.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/summarize.ts src/dashboard/summarize.test.ts
git commit -m "[TASK-032] ideasAwaitingVote summarizer (REQ-028)"
```

---

## Task 4: Icon-rail shell

**Files:**
- Modify: `src/components/icons.tsx` (add `ConnectIcon`)
- Modify: `src/components/nav-rail.tsx` (rewrite to 3 icon items)
- Modify: `src/app/(app)/layout.tsx` (narrow rail, wider main, avatar/sign-out in rail)

**Interfaces:**
- Consumes: `DashboardIcon`, `SpecIcon` (exist), new `ConnectIcon`.
- Produces: an icon-only `NavRail` with three links (`/dashboard`, `/spec`, `/connect`).

- [ ] **Step 1: Add `ConnectIcon` to `src/components/icons.tsx`** (reuses the file's `Svg` helper)

```tsx
export function ConnectIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M9 15l6-6" />
      <path d="M7.5 10.5l-1.8 1.8a3.2 3.2 0 004.5 4.5l1.8-1.8" />
      <path d="M16.5 13.5l1.8-1.8a3.2 3.2 0 00-4.5-4.5l-1.8 1.8" />
    </Svg>
  );
}
```

- [ ] **Step 2: Rewrite `src/components/nav-rail.tsx`** to an icon-only 3-item rail

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SVGProps, ComponentType } from "react";
import { DashboardIcon, SpecIcon, ConnectIcon } from "./icons";

const ITEMS: { href: string; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { href: "/dashboard", label: "Dashboard", Icon: DashboardIcon },
  { href: "/spec", label: "Spec", Icon: SpecIcon },
  { href: "/connect", label: "Connect", Icon: ConnectIcon },
];

export function NavRail() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Sections" className="flex flex-col items-center gap-1.5">
      {ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            title={label}
            className={`group flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
              active ? "bg-spine-wash text-spine-deep" : "text-graphite hover:bg-paper-sunk hover:text-ink"
            }`}
          >
            <Icon className={active ? "text-spine" : ""} />
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 3: Update `src/app/(app)/layout.tsx`** — narrow rail column, avatar/sign-out in the rail footer, wider main

Replace the returned JSX (keep the `auth()`/`redirect`/`repo` logic above it unchanged):

```tsx
  return (
    <div className="grid min-h-dvh grid-cols-[64px_1fr]">
      <aside className="sticky top-0 flex h-dvh flex-col items-center border-r border-hairline bg-paper-raised py-4">
        <Link href="/dashboard" aria-label="Throughline" className="mb-5 text-spine">
          <Mark width={24} height={24} />
        </Link>
        <NavRail />
        <div className="mt-auto flex flex-col items-center gap-2">
          <div className="truncate px-1 text-center font-mono text-[9px] text-graphite" title={who}>
            {who.slice(0, 8)}
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-graphite transition-colors hover:bg-paper-sunk hover:text-ink"
            >
              ⎋
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-hairline bg-paper/85 px-8 py-3 backdrop-blur">
          <a
            href="/connect"
            className="flex items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-colors hover:bg-paper-sunk"
            title="Connect or view the linked repository"
          >
            {repo ? (
              <>
                <span className="size-1.5 rounded-full bg-shipped" />
                <span className="text-ink">{repo}</span>
              </>
            ) : (
              <span className="text-spine-deep">Link a repository →</span>
            )}
          </a>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
```

Add `import Link from "next/link";` to the layout's imports (it already imports `Mark`, `NavRail`, `auth`, `signOut`, `getDb`, `project`).

- [ ] **Step 4: Typecheck + visual sanity**

Run: `npm run typecheck` → clean.
(Visual confirmation happens in Task 5/6 once the dashboard renders.)

- [ ] **Step 5: Commit**

```bash
git add src/components/icons.tsx src/components/nav-rail.tsx "src/app/(app)/layout.tsx"
git commit -m "[TASK-032] 3-item icon-rail shell (REQ-028)"
```

---

## Task 5: Dashboard layout rewrite (reference grid)

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `getDb`; `auth` (for `session.user.id`); `listActivity`, `heartbeatSeries`, `getLatestNarrative`, `digestSummary`, `listVotingIdeas`, `idsUserVotedFor`, `APPROVAL_GATE`, `listTasks`, `listQuickWins`, `listPipeline`, `burnUpSeries`, `listOpenDriftFlags`, `structuralReconciliationForProject`, `countRationales`; summarizers `eventsSince`, `taskBreakdown`, `topTasks`, `pct`, `ideasAwaitingVote`; components `PageHeader`/`Pill` (`@/components/ui`), `DashboardCard` (`@/components/dashboard-card`), `Sparkline`, `Donut`; icons.

> Composition over tested pieces — verified by typecheck + the visual walkthrough. Cards link to the existing routes (drawers are a later phase).

- [ ] **Step 1: Rewrite the page**

```tsx
// src/app/(app)/dashboard/page.tsx
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { listActivity } from "@/events/feed";
import { heartbeatSeries } from "@/metrics/heartbeat";
import { getLatestNarrative } from "@/narrative/queries";
import { digestSummary } from "@/digest/queries";
import { listVotingIdeas, idsUserVotedFor } from "@/ideas/queries";
import { APPROVAL_GATE } from "@/ideas/gate";
import { listTasks } from "@/tasks/queries";
import { listQuickWins } from "@/metrics/quickwins";
import { listPipeline } from "@/pipeline/queries";
import { burnUpSeries } from "@/metrics/burnup";
import { listOpenDriftFlags } from "@/drift/queries";
import { structuralReconciliationForProject } from "@/integrity/reconcile";
import { countRationales } from "@/quality/queries";
import {
  PulseIcon, HeartbeatIcon, NarrativeIcon, DigestIcon, IdeaIcon, TaskIcon,
  QuickWinIcon, PipelineIcon, ProgressIcon, DriftIcon, ReconcileIcon, WhyQualityIcon,
} from "@/components/icons";
import { PageHeader, Pill } from "@/components/ui";
import { DashboardCard } from "@/components/dashboard-card";
import { Sparkline } from "@/components/sparkline";
import { Donut } from "@/components/donut";
import { eventsSince, taskBreakdown, topTasks, pct, ideasAwaitingVote } from "@/dashboard/summarize";

export const dynamic = "force-dynamic";

function ago(d: Date): string {
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function startOfTodayMs(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

function RailCard({ href, Icon, title, children }: { href: string; Icon: typeof PulseIcon; title: string; children: ReactNode }) {
  return (
    <a href={href} className="group block rounded-leaf border border-hairline bg-paper-raised p-4 transition-colors hover:border-spine/40 hover:bg-paper-sunk">
      <div className="flex items-center gap-2 text-graphite">
        <Icon className="text-spine" />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em]">{title}</span>
      </div>
      <div className="mt-2">{children}</div>
    </a>
  );
}

export default async function DashboardPage() {
  const db = getDb();
  const session = await auth();
  const userId = session?.user?.id ?? "";
  const [
    activity, heartbeat, narrative, digest, ideas, votedIds, tasks, quickWins, pipeline, burnup, drift, reconcile, rationales,
  ] = await Promise.all([
    listActivity(db, 120),
    heartbeatSeries(db, Date.now(), 14),
    getLatestNarrative(db),
    digestSummary(db),
    listVotingIdeas(db),
    userId ? idsUserVotedFor(db, userId) : Promise.resolve<string[]>([]),
    listTasks(db),
    listQuickWins(db),
    listPipeline(db),
    burnUpSeries(db),
    listOpenDriftFlags(db),
    structuralReconciliationForProject(db),
    countRationales(db),
  ]);

  const today = eventsSince(activity, startOfTodayMs());
  const tb = taskBreakdown(tasks);
  const awaiting = ideasAwaitingVote(ideas, votedIds);
  const topWin = quickWins[0] ?? null;
  const burnPct = pct(burnup.done, burnup.scope);

  return (
    <>
      <PageHeader eyebrow="The whole board" title="Dashboard" lede="Every part of the project, on one page." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* MAIN COLUMN */}
        <div className="flex flex-col gap-4">
          {/* KPI ROW */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <DashboardCard href="/tasks" Icon={TaskIcon} title="Tasks" stat={`${tasks.length}`}>
              <span>{tb.open} open · {tb.claimed} claimed · {tb.merged} merged</span>
            </DashboardCard>
            <DashboardCard
              href="/ideas"
              Icon={IdeaIcon}
              title={(
                <span className="flex items-center gap-2">Ideas{awaiting.length > 0 && (
                  <span className="rounded-md bg-planned-wash px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wide text-planned">NEEDS VOTES</span>
                )}</span>
              )}
              stat={`${awaiting.length}`}
            >
              <span>awaiting your vote · {ideas.length} in voting</span>
            </DashboardCard>
            <DashboardCard
              href="/drift"
              Icon={DriftIcon}
              title={(
                <span className="flex items-center gap-2">Drift{drift.length > 0 && (
                  <span className="rounded-md bg-risk-wash px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wide text-risk">ATTENTION</span>
                )}</span>
              )}
              stat={drift.length === 0 ? "—" : `${drift.length}`}
            >
              <span>{drift.length === 0 ? "no open drift" : `open flag${drift.length === 1 ? "" : "s"}`}</span>
            </DashboardCard>
          </div>

          {/* HERO ROW: Heartbeat line + Progress donut */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
            <a href="/heartbeat" className="group rounded-leaf border border-hairline bg-paper-raised p-5 transition-colors hover:border-spine/40">
              <div className="flex items-center gap-2 text-graphite">
                <HeartbeatIcon className="text-spine" />
                <span className="font-mono text-[11px] uppercase tracking-[0.14em]">Heartbeat — 14 days</span>
                <span className="ml-auto font-display text-lg text-ink tabular-nums">active {heartbeat.activeDays}/{heartbeat.windowDays}</span>
              </div>
              <div className="mt-3 text-spine">
                <Sparkline values={heartbeat.days.map((d) => d.count)} width={640} height={96} area className="w-full" />
              </div>
            </a>
            <a href="/burnup" className="group flex flex-col items-center justify-center rounded-leaf border border-hairline bg-paper-raised p-5 transition-colors hover:border-spine/40">
              <div className="self-start flex items-center gap-2 text-graphite">
                <ProgressIcon className="text-spine" />
                <span className="font-mono text-[11px] uppercase tracking-[0.14em]">Progress</span>
              </div>
              <Donut value={burnup.done} max={burnup.scope} size={104} />
              <div className="text-[13px] text-graphite tabular-nums">{burnup.done}/{burnup.scope} merged</div>
            </a>
          </div>

          {/* MID ROW: Quick wins + Pipeline */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
            <DashboardCard href="/quick-wins" Icon={QuickWinIcon} title="Quick wins" stat={topWin ? `top ${topWin.score}/100` : "none"}>
              {topWin ? (
                <ul className="flex flex-col gap-1">
                  {quickWins.slice(0, 3).map((w) => (
                    <li key={w.key} className="truncate"><span className="font-mono text-spine-deep">{w.key}</span> {w.score}/100 <span className="text-graphite">({w.risk})</span></li>
                  ))}
                </ul>
              ) : <span>No open unclaimed tasks.</span>}
            </DashboardCard>
            <a href="/pipeline" className="group rounded-leaf border border-hairline bg-paper-raised p-5 transition-colors hover:border-spine/40">
              <div className="flex items-center gap-2 text-graphite">
                <PipelineIcon className="text-spine" />
                <span className="font-mono text-[11px] uppercase tracking-[0.14em]">Pipeline</span>
              </div>
              <div className="mt-3 flex items-end gap-3" style={{ height: 64 }}>
                {pipeline.map((s) => {
                  const maxC = Math.max(1, ...pipeline.map((x) => x.count));
                  return (
                    <div key={s.key} className="flex flex-1 flex-col items-center justify-end gap-1">
                      <span className="font-display text-sm text-ink tabular-nums">{s.count}</span>
                      <div className="w-full rounded-t bg-spine" style={{ height: `${Math.max(4, (s.count / maxC) * 44)}px`, opacity: 0.85 }} />
                      <span className="font-mono text-[9px] text-graphite">{s.label}</span>
                    </div>
                  );
                })}
              </div>
            </a>
          </div>

          {/* SMALL ROW: Reconcile + Why-quality */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DashboardCard href="/reconcile" Icon={ReconcileIcon} title="Reconcile" stat={!reconcile.bound ? "no repo" : reconcile.specStale ? "spec STALE" : "spec fresh"}>
              <span>{reconcile.requirementCount} requirements{reconcile.bound ? "" : " · bind a repo"}</span>
            </DashboardCard>
            <DashboardCard href="/why-quality" Icon={WhyQualityIcon} title="Why-quality" stat={`${rationales}`}>
              <span>rationales logged · run the review →</span>
            </DashboardCard>
          </div>
        </div>

        {/* RIGHT RAIL */}
        <div className="flex flex-col gap-4">
          <RailCard href="/narrative" Icon={NarrativeIcon} title="Narrative">
            {narrative ? (
              <>
                <div className="font-display text-ink">{narrative.content.chapters[0]?.heading ?? "—"}</div>
                <div className="text-[12px] text-graphite">{narrative.content.chapters.length} chapters · {ago(narrative.generatedAt)}</div>
              </>
            ) : <span className="text-[13px] text-graphite">Not generated yet.</span>}
          </RailCard>

          <RailCard href="/pulse" Icon={PulseIcon} title="Recent activity">
            {activity.length === 0 ? (
              <span className="text-[13px] text-graphite">Nothing logged yet.</span>
            ) : (
              <ol className="flex flex-col gap-2.5">
                {activity.slice(0, 7).map((it) => (
                  <li key={it.seq} className="flex gap-2 text-[12px]">
                    <span className="mt-1.5 size-1.5 flex-none rounded-full bg-spine" />
                    <span className="min-w-0">
                      <span className="text-ink">{it.actor ?? "system"}</span> <span className="text-graphite">{it.verb}</span>{" "}
                      {it.subject && <span className="font-mono text-spine-deep">{it.subject}</span>}
                    </span>
                    <span className="ml-auto whitespace-nowrap font-mono text-[10px] text-graphite">{ago(it.createdAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </RailCard>

          <RailCard href="/digest" Icon={DigestIcon} title="Digest">
            <span className="text-[13px] text-graphite">{digest.lastSentAt ? `Last sent ${ago(digest.lastSentAt)}` : "Never sent"} · {digest.count} sent</span>
          </RailCard>
        </div>
      </div>
    </>
  );
}
```

> Note: `DashboardCard`'s `title` prop must accept `ReactNode` (the KPI cards pass a `<span>` with a badge). Confirm in Step 2; if it is typed `string`, widen it to `ReactNode` in `src/components/dashboard-card.tsx` (it already renders `{title}` so only the prop type changes).

- [ ] **Step 2: Widen `DashboardCard.title` to `ReactNode` if needed**

In `src/components/dashboard-card.tsx`, ensure the prop type is `title: ReactNode` (not `string`). `ReactNode` is already imported there.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. Fix any signature mismatch against the real exports (do not loosen types or add `any`).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx" src/components/dashboard-card.tsx
git commit -m "[TASK-032] dashboard rewritten as the single-page reference grid (REQ-028)"
```

---

## Task 6: Verify + finish

**Files:** none (verification).

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: PASS — all prior tests plus the new `sparklineAreaPath` and `ideasAwaitingVote` tests. (If the suite is slow/flaky, ensure no `next dev`/`npm start` is competing for CPU.)

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck` → clean.
Run: `npm run build` → succeeds; `/dashboard` present.

- [ ] **Step 3: Visual walkthrough**

Start the prod server (`npm run build` already done → `npm start`), sign in, open `/dashboard`. Confirm: 3-item icon rail (Dashboard/Spec/Connect); KPI row (Tasks/Ideas/Drift with badges when applicable); Heartbeat hero line+area; Progress donut; Quick-wins + Pipeline bars; Reconcile + Why-quality; right rail Narrative→Pulse feed→Digest. Each card navigates to its existing route. Stop the server when done so it doesn't starve the test runner.

- [ ] **Step 4: Hand off**

Report completion. The branch is ready for the finishing-a-development-branch step (merge/PR). Drawers and the Spec-upload tab are the next phases (separate plans).

---

## Self-Review

**Spec coverage (Phase 1 scope):** shell → Task 4; reference layout (KPI/hero/rail/mid/small) → Task 5; Donut + hero line viz → Tasks 1–2; `ideasAwaitingVote` for the NEEDS-VOTES badge → Task 3; read-only/no-LLM-on-load → honored (page calls only reads + cheap proxies; `auth()` is a read). Out-of-Phase-1 (drawers, Spec-upload) are explicitly deferred to later plans, consistent with the spec's phasing.

**Placeholder scan:** every code step has complete code; every run step has a command + expected result. No TBD/TODO.

**Type consistency:** `sparklineAreaPath(values,width?,height?) → string`; `Donut({value,max,size?})`; `ideasAwaitingVote(VotingIdea[], string[]) → VotingIdea[]`; `Sparkline` gains `area?: boolean`; `DashboardCard.title` widened to `ReactNode`. Page consumes the existing query/summarizer signatures verified during the TASK-031 build (`listActivity(db,120)`, `heartbeatSeries(db,now,14)`, `idsUserVotedFor(db,userId)`, `structuralReconciliationForProject(db) → {bound,specStale,requirementCount}`, etc.). `ConnectIcon` defined in Task 4 before use.
