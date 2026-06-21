export interface SparklineGeom {
  path: string;
  width: number;
  height: number;
}

// Map a numeric series to an SVG polyline path in a width×height box. Min sits at
// the bottom, max at the top. Empty -> a centered flat line; single point -> a dot
// at the center x. Coordinates are fixed to 2dp for stable, testable output.
export function sparklinePath(values: number[], width = 96, height = 24): SparklineGeom {
  const n = values.length;
  if (n === 0) return { path: `M0,${height / 2} L${width},${height / 2}`, width, height };
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = n === 1 ? width / 2 : (i * width) / (n - 1);
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return { path: `M${pts.join(" L")}`, width, height };
}

// A closed area path under the same polyline as sparklinePath: the line, then
// down to the baseline (y=height) and back to x=0. Empty series -> "".
export function sparklineAreaPath(values: number[], width = 96, height = 24): string {
  const n = values.length;
  if (n === 0) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = n === 1 ? width / 2 : (i * width) / (n - 1);
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const lastX = n === 1 ? width / 2 : width;
  const firstX = n === 1 ? width / 2 : 0;
  return `M${pts.join(" L")} L${lastX.toFixed(2)},${height.toFixed(2)} L${firstX.toFixed(2)},${height.toFixed(2)} Z`;
}
