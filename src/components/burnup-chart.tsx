import type { BurnUp } from "@/metrics/burnup";

const W = 720;
const H = 260;
const PAD = { l: 34, r: 16, t: 16, b: 28 };

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// A bespoke SVG burn-up — no chart library. Ink dashed "scope" line, verdigris
// "merged" area climbing toward it; counts are step functions extended to now.
export function BurnUpChart({ data, now }: { data: BurnUp; now: number }) {
  const { points, scope } = data;
  if (points.length === 0) return null;

  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const tMin = points[0].t;
  const tMax = Math.max(points[points.length - 1].t, now);
  const yMax = Math.max(scope, 1);

  const x = (t: number) => PAD.l + (tMax === tMin ? innerW : ((t - tMin) / (tMax - tMin)) * innerW);
  const y = (v: number) => PAD.t + innerH - (v / yMax) * innerH;

  const step = (key: "scope" | "done"): string => {
    let d = `M ${x(points[0].t).toFixed(1)} ${y(points[0][key]).toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${x(points[i].t).toFixed(1)} ${y(points[i - 1][key]).toFixed(1)}`;
      d += ` L ${x(points[i].t).toFixed(1)} ${y(points[i][key]).toFixed(1)}`;
    }
    d += ` L ${x(tMax).toFixed(1)} ${y(points[points.length - 1][key]).toFixed(1)}`;
    return d;
  };

  const doneLine = step("done");
  const doneArea = `${doneLine} L ${x(tMax).toFixed(1)} ${y(0).toFixed(1)} L ${x(tMin).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const gridYs = Array.from(new Set([0, Math.round(yMax / 2), yMax]));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`Burn-up: ${data.done} of ${data.scope} tasks merged`}
      preserveAspectRatio="xMidYMid meet"
    >
      {gridYs.map((g) => (
        <g key={g}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} className="stroke-hairline" strokeWidth={1} />
          <text x={PAD.l - 7} y={y(g) + 3} textAnchor="end" className="fill-graphite font-mono text-[10px]">
            {g}
          </text>
        </g>
      ))}

      <path d={doneArea} className="fill-spine-wash" />
      <path d={doneLine} fill="none" className="stroke-spine" strokeWidth={2} strokeLinejoin="round" />
      <path d={step("scope")} fill="none" className="stroke-ink" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />

      <text x={PAD.l} y={H - 8} className="fill-graphite font-mono text-[10px]">
        {fmtDate(tMin)}
      </text>
      <text x={W - PAD.r} y={H - 8} textAnchor="end" className="fill-graphite font-mono text-[10px]">
        {fmtDate(tMax)}
      </text>
    </svg>
  );
}
