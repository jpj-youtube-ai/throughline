import { getDb } from "@/db/client";
import { burnUpSeries } from "@/metrics/burnup";
import { BurnUpChart } from "@/components/burnup-chart";
import { Card, Empty } from "@/components/ui";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-display text-3xl font-bold text-ink">{value}</div>
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">{label}</div>
    </div>
  );
}

export async function BurnUpPanel() {
  const data = await burnUpSeries(getDb());
  const pct = data.scope ? Math.round((data.done / data.scope) * 100) : 0;

  return (
    <>
      {data.scope === 0 ? (
        <Empty title="No tasks yet.">The burn-up draws itself once approved ideas are generated into tasks.</Empty>
      ) : (
        <>
          <div className="mb-7 flex flex-wrap gap-10">
            <Stat label="merged" value={`${data.done} / ${data.scope}`} />
            <Stat label="complete" value={`${pct}%`} />
          </div>

          <Card className="p-5">
            <div className="mb-4 flex items-center gap-5 font-mono text-[11px] text-graphite">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-4 rounded-sm border-b-2 border-spine bg-spine-wash" /> merged
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block w-4 border-t border-dashed border-ink" /> scope
              </span>
            </div>
            <BurnUpChart data={data} now={Date.now()} />
          </Card>
        </>
      )}
    </>
  );
}
