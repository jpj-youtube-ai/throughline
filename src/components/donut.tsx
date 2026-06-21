// A progress ring. Track in hairline, progress arc in the spine accent, percent
// centered. pathLength=100 lets the dasharray be the percent directly.
export function Donut({ value, max, size = 88 }: { value: number; max: number; size?: number }) {
  const p = max <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((100 * value) / max))); // 0..100, clamped + rounded
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
