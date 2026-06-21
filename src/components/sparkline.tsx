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
