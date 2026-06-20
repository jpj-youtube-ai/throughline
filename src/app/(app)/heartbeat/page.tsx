import { getDb } from "@/db/client";
import { heartbeatSeries } from "@/metrics/heartbeat";
import { HeartbeatChart } from "@/components/heartbeat-chart";
import { PageHeader, Card, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-display text-3xl font-bold text-ink">{value}</div>
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">{label}</div>
    </div>
  );
}

export default async function HeartbeatPage() {
  const hb = await heartbeatSeries(getDb());
  const busiestLabel = hb.busiest
    ? new Date(hb.busiest.t).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
    : "—";

  return (
    <>
      <PageHeader
        eyebrow="Cadence"
        title="Heartbeat"
        lede={`The rhythm of decisions over the last ${hb.windowDays} days — one bar per day, drawn from the log.`}
      />

      {hb.total === 0 ? (
        <Empty title="No activity yet.">The heartbeat traces itself as decisions are made and logged.</Empty>
      ) : (
        <>
          <div className="mb-7 flex flex-wrap gap-10">
            <Stat label="events" value={String(hb.total)} />
            <Stat label="active days" value={String(hb.activeDays)} />
            <Stat label={`busiest · ${busiestLabel}`} value={String(hb.busiest?.count ?? 0)} />
          </div>
          <Card className="p-5">
            <HeartbeatChart data={hb} />
          </Card>
        </>
      )}
    </>
  );
}
