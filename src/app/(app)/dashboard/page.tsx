// src/app/(app)/dashboard/page.tsx
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { listActivity } from "@/events/feed";
import { heartbeatSeries } from "@/metrics/heartbeat";
import { getLatestNarrative } from "@/narrative/queries";
import { digestSummary } from "@/digest/queries";
import { listVotingIdeas, idsUserVotedFor } from "@/ideas/queries";
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
import { PageHeader } from "@/components/ui";
import { DashboardCard } from "@/components/dashboard-card";
import { Sparkline } from "@/components/sparkline";
import { Donut } from "@/components/donut";
import { taskBreakdown, ideasAwaitingVote } from "@/dashboard/summarize";

export const dynamic = "force-dynamic";

function ago(d: Date): string {
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
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

  const tb = taskBreakdown(tasks);
  const awaiting = ideasAwaitingVote(ideas, votedIds);
  const topWin = quickWins[0] ?? null;

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
