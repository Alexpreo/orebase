/** Round a max up to a "nice" axis top and return evenly spaced ticks (0 … top). */
export function niceScale(max: number, tickCount = 4): { top: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { top: 1, ticks: [0, 1] };
  const rough = max / tickCount;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag;
  const top = step * Math.ceil(max / step);
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { top, ticks };
}

/** Linear map of v in [0, top] to [0, size]. */
export function scaleTo(v: number, top: number, size: number): number {
  if (top <= 0) return 0;
  return (Math.max(0, v) / top) * size;
}

/** Symmetric scale for signed values (tornado / delta charts). */
export function absMax(values: number[]): number {
  return values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
}
