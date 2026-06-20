import type { Heartbeat } from "@/metrics/heartbeat";

const W = 720;
const H = 130;
const PAD = { l: 4, r: 4, t: 8, b: 20 };

function fmt(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

// A bespoke bar-per-day rhythm (no chart library). Verdigris bars on the bone
// ground; empty days leave gaps so the cadence reads. Heights scale to the
// busiest day.
export function HeartbeatChart({ data }: { data: Heartbeat }) {
  const { days } = data;
  if (days.length === 0) return null;

  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const max = Math.max(1, ...days.map((d) => d.count));
  const slot = innerW / days.length;
  const barW = Math.max(2, slot - 1.5);
  const baseY = PAD.t + innerH;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`Activity: ${data.total} events across ${data.activeDays} active days`}
      preserveAspectRatio="xMidYMid meet"
    >
      <line x1={PAD.l} x2={W - PAD.r} y1={baseY + 0.5} y2={baseY + 0.5} className="stroke-hairline" strokeWidth={1} />
      {days.map((d, i) => {
        if (d.count === 0) return null;
        const h = Math.max(2, (d.count / max) * innerH);
        const x = PAD.l + i * slot + (slot - barW) / 2;
        return (
          <rect key={d.t} x={x} y={baseY - h} width={barW} height={h} rx={1} className="fill-spine">
            <title>{`${fmt(d.t)}: ${d.count} event${d.count === 1 ? "" : "s"}`}</title>
          </rect>
        );
      })}
      <text x={PAD.l} y={H - 6} className="fill-graphite font-mono text-[10px]">
        {fmt(days[0].t)}
      </text>
      <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-graphite font-mono text-[10px]">
        {fmt(days[days.length - 1].t)}
      </text>
    </svg>
  );
}
