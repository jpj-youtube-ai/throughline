// src/components/meter.tsx
export function Meter({ value, max, className = "" }: { value: number; max: number; className?: string }) {
  const fraction = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-paper-sunk ${className}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div className="h-full rounded-full bg-spine" style={{ width: `${fraction * 100}%` }} />
    </div>
  );
}
