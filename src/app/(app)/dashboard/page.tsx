// src/app/(app)/dashboard/page.tsx
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { listActivity } from "@/events/feed";
import { heartbeatSeries } from "@/metrics/heartbeat";
import { getLatestNarrative } from "@/narrative/queries";
import { digestSummary } from "@/digest/queries";
import { listVotingIdeas } from "@/ideas/queries";
import { APPROVAL_GATE } from "@/ideas/gate";
import { listTasks } from "@/tasks/queries";
import { listQuickWins } from "@/metrics/quickwins";
import { listPipeline } from "@/pipeline/queries";
import { listSpecMap } from "@/spec/map";
import { burnUpSeries } from "@/metrics/burnup";
import { listOpenDriftFlags } from "@/drift/queries";
import { structuralReconciliationForProject } from "@/integrity/reconcile";
import { countRationales } from "@/quality/queries";
import {
  PulseIcon, HeartbeatIcon, NarrativeIcon, DigestIcon, IdeaIcon, TaskIcon,
  QuickWinIcon, PipelineIcon, SpecIcon, ProgressIcon, DriftIcon, ReconcileIcon, WhyQualityIcon,
} from "@/components/icons";
import { PageHeader, Pill } from "@/components/ui";
import { DashboardCard } from "@/components/dashboard-card";
import { Sparkline } from "@/components/sparkline";
import { Meter } from "@/components/meter";
import { eventsSince, taskBreakdown, topTasks, reqBreakdown, pct } from "@/dashboard/summarize";

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

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-mono mb-3 text-[11px] uppercase tracking-[0.18em] text-graphite">{label}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

export default async function DashboardPage() {
  const db = getDb();
  const [activity, heartbeat, narrative, digest, ideas, tasks, quickWins, pipeline, specMap, burnup, drift, reconcile, rationales] =
    await Promise.all([
      listActivity(db, 120),
      heartbeatSeries(db, Date.now(), 14),
      getLatestNarrative(db),
      digestSummary(db),
      listVotingIdeas(db),
      listTasks(db),
      listQuickWins(db),
      listPipeline(db),
      listSpecMap(db),
      burnUpSeries(db),
      listOpenDriftFlags(db),
      structuralReconciliationForProject(db),
      countRationales(db),
    ]);

  const today = eventsSince(activity, startOfTodayMs());
  const tb = taskBreakdown(tasks);
  const topT = topTasks(tasks, 2);
  const rb = reqBreakdown(specMap);
  const topWin = quickWins[0] ?? null;
  const burnPct = pct(burnup.done, burnup.scope);

  return (
    <>
      <PageHeader eyebrow="The whole board" title="Dashboard" lede="Every part of the project, at a glance." />
      <div className="flex flex-col gap-8">
        <Group label="Story">
          <DashboardCard href="/pulse" Icon={PulseIcon} title="Pulse" stat={`${today} ${today === 1 ? "event" : "events"} today`}>
            {activity.length === 0 ? (
              <span>Nothing logged yet.</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {activity.slice(0, 2).map((it) => (
                  <li key={it.seq} className="truncate">
                    <span className="text-ink">{it.actor ?? "system"}</span> {it.verb}{" "}
                    {it.subject && <span className="font-mono text-spine-deep">{it.subject}</span>}
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>

          <DashboardCard href="/heartbeat" Icon={HeartbeatIcon} title="Heartbeat" stat={`active ${heartbeat.activeDays}/${heartbeat.windowDays} days`}>
            <span className="text-spine">
              <Sparkline values={heartbeat.days.map((d) => d.count)} />
            </span>
          </DashboardCard>

          <DashboardCard
            href="/narrative"
            Icon={NarrativeIcon}
            title="Narrative"
            stat={narrative ? `${narrative.content.chapters.length} ${narrative.content.chapters.length === 1 ? "chapter" : "chapters"}` : "not generated"}
          >
            {narrative ? (
              <span className="truncate">
                {narrative.content.chapters[0]?.heading ?? "—"} · {ago(narrative.generatedAt)}
              </span>
            ) : (
              <span>Generate it from the log.</span>
            )}
          </DashboardCard>

          <DashboardCard href="/digest" Icon={DigestIcon} title="Digest" stat={digest.lastSentAt ? `sent ${ago(digest.lastSentAt)}` : "never sent"}>
            <span>{digest.count} {digest.count === 1 ? "digest" : "digests"} sent</span>
          </DashboardCard>
        </Group>

        <Group label="Work">
          <DashboardCard href="/ideas" Icon={IdeaIcon} title="Ideas" stat={`${ideas.length} in voting`}>
            {ideas.length === 0 ? (
              <span>No ideas in voting.</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {ideas.slice(0, 2).map((i) => (
                  <li key={i.id} className="truncate">
                    <span className="text-ink">{i.title}</span> <span className="font-mono">({i.voteCount}/{APPROVAL_GATE})</span>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>

          <DashboardCard href="/tasks" Icon={TaskIcon} title="Tasks" stat={`${tb.open} open · ${tb.claimed} claimed · ${tb.merged} merged`}>
            {tasks.length === 0 ? (
              <span>No tasks yet.</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {topT.map((t) => (
                  <li key={t.key} className="truncate">
                    <span className="font-mono text-spine-deep">{t.key}</span>{" "}
                    <span>{t.claimerLogin ? `claimed by ${t.claimerLogin}` : t.githubStatus === "closed" ? "merged" : "open"}</span>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>

          <DashboardCard href="/quick-wins" Icon={QuickWinIcon} title="Quick wins" stat={topWin ? `top ${topWin.score}/100` : "none open"}>
            {topWin ? (
              <ul className="flex flex-col gap-1">
                {quickWins.slice(0, 2).map((w) => (
                  <li key={w.key} className="truncate">
                    <span className="font-mono text-spine-deep">{w.key}</span> {w.score}/100 <span className="text-graphite">({w.risk} risk)</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span>No open unclaimed tasks.</span>
            )}
          </DashboardCard>

          <DashboardCard href="/pipeline" Icon={PipelineIcon} title="Pipeline" stat={pipeline.map((s) => s.count).join(" → ")}>
            <span className="truncate">{pipeline.map((s) => s.label).join(" · ")}</span>
          </DashboardCard>
        </Group>

        <Group label="Spec">
          <DashboardCard href="/spec" Icon={SpecIcon} title="Spec" stat={`${specMap.length} ${specMap.length === 1 ? "requirement" : "requirements"}`}>
            <span className="flex flex-wrap gap-1.5">
              <Pill tone="shipped">{rb.shipped} shipped</Pill>
              <Pill tone="spine">{rb.building} building</Pill>
              <Pill tone="planned">{rb.planned} planned</Pill>
            </span>
          </DashboardCard>

          <DashboardCard href="/burnup" Icon={ProgressIcon} title="Progress" stat={`${burnup.done}/${burnup.scope} merged · ${burnPct}%`}>
            <Meter value={burnup.done} max={burnup.scope} />
          </DashboardCard>
        </Group>

        <Group label="Integrity">
          <DashboardCard
            href="/drift"
            Icon={DriftIcon}
            title="Drift"
            stat={drift.length === 0 ? "no drift" : `${drift.length} open ${drift.length === 1 ? "flag" : "flags"}`}
          >
            {drift.length === 0 ? (
              <span>Everything maps to a requirement.</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {drift.slice(0, 2).map((f) => (
                  <li key={f.id} className="truncate">
                    <span className="font-mono text-spine-deep">{f.taskKey}</span> PR #{f.prNumber} · {f.unmappedItems.length} items
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>

          <DashboardCard
            href="/reconcile"
            Icon={ReconcileIcon}
            title="Reconcile"
            stat={!reconcile.bound ? "no repo bound" : reconcile.specStale ? "spec STALE" : "spec fresh"}
          >
            <span>
              {reconcile.requirementCount} requirements{reconcile.bound ? "" : " · bind a repo to check"}
            </span>
          </DashboardCard>

          <DashboardCard
            href="/why-quality"
            Icon={WhyQualityIcon}
            title="Why-quality"
            stat={`${rationales} ${rationales === 1 ? "rationale" : "rationales"} logged`}
          >
            <span>Run the quality review →</span>
          </DashboardCard>
        </Group>
      </div>
    </>
  );
}
