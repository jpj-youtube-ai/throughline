import { sparklinePath } from "./sparkline";

export function Sparkline({
  values,
  width = 96,
  height = 24,
  className = "",
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const { path } = sparklinePath(values, width, height);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden="true" className={className}>
      <path d={path} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
