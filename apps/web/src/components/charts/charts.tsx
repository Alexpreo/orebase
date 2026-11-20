import Link from "next/link";
import { cn } from "@/lib/utils";
import { absMax, niceScale, scaleTo } from "./scale";

/*
 * Dependency-free SVG charts. Server-renderable; entry motion is CSS only
 * (bar-grow / line-draw / fade-late), so it plays once on mount.
 * Every chart takes an aria-label the page builds from the real numbers.
 */

export const SERIES = { copper: "#E0985A", slate: "#5B8DEF", grey: "#4A5462" } as const;

const GRID = "#1E232B";
const AXIS = "num text-[11px] text-fg-4";

/** Small bar sparkline (stat tiles). The last bar is full strength. */
export function MiniBars({ values, label, width = 96, height = 32 }: { values: number[]; label: string; width?: number; height?: number }) {
  if (values.length === 0) return null;
  const { top } = niceScale(Math.max(...values, 1));
  const slot = width / values.length;
  const w = Math.max(2, slot - 5);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <g fill={SERIES.copper}>
        {values.map((v, i) => {
          const h = Math.max(v > 0 ? 2 : 1, scaleTo(v, top, height - 2));
          return (
            <rect key={i} className="bar-grow" x={i * slot + 2} y={height - h} width={w} height={h} rx={1.5}
              opacity={i === values.length - 1 ? 1 : 0.45} style={{ animationDelay: `${i * 60}ms` }} />
          );
        })}
      </g>
    </svg>
  );
}

/** Stacked vertical bars with y-axis ticks and x labels (Filings pulse). */
export function StackedBars({
  data,
  series,
  label,
  height = 220,
}: {
  data: { label: string; values: number[]; highlight?: boolean }[];
  series: { name: string; color: string }[];
  label: string;
  height?: number;
}) {
  const W = 720;
  const H = 204;
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const { top, ticks } = niceScale(Math.max(...totals, 1));
  const slot = W / Math.max(1, data.length);
  const bw = Math.min(28, slot * 0.5);
  return (
    <div className="flex gap-2.5">
      <div className={cn(AXIS, "flex flex-col-reverse justify-between pt-0.5 pb-[22px] text-right")} aria-hidden="true">
        {ticks.map((t) => <span key={t}>{t}</span>)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height }} role="img" aria-label={label}>
          <g stroke={GRID} strokeWidth={1} vectorEffect="non-scaling-stroke">
            {ticks.map((t) => {
              const y = H - 4 - scaleTo(t, top, H - 4);
              return <line key={t} x1={0} x2={W} y1={y} y2={y} vectorEffect="non-scaling-stroke" />;
            })}
          </g>
          {data.map((d, i) => {
            let base = H - 4;
            return (
              <g key={d.label + i}>
                {d.values.map((v, s) => {
                  const h = scaleTo(v, top, H - 4);
                  base -= h;
                  if (h <= 0) return null;
                  // Gap between stacked segments, as in the design.
                  const gap = s > 0 ? 4 : 0;
                  return (
                    <rect key={s} className="bar-grow" x={i * slot + (slot - bw) / 2} y={base} width={bw}
                      height={Math.max(0, h - gap)} rx={3} fill={series[s]?.color}
                      style={{ animationDelay: `${i * 40}ms` }} />
                  );
                })}
              </g>
            );
          })}
        </svg>
        <div className={cn(AXIS, "grid text-center")} style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }} aria-hidden="true">
          {data.map((d, i) => (
            <span key={i} className={cn("whitespace-nowrap", d.highlight && "text-copper-2")}>{d.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Single-series vertical bars (spend per day, filings per month). Optional reference line. */
export function Bars({
  data,
  label,
  height = 200,
  refLine,
  color = SERIES.grey,
  highlightLast = true,
}: {
  data: { label: string; value: number }[];
  label: string;
  height?: number;
  refLine?: { value: number; label: string };
  color?: string;
  highlightLast?: boolean;
}) {
  const W = 720;
  const H = 200;
  const { top, ticks } = niceScale(Math.max(...data.map((d) => d.value), refLine?.value ?? 0, 1));
  const slot = W / Math.max(1, data.length);
  const bw = Math.max(3, Math.min(28, slot * 0.6));
  return (
    <div className="flex gap-2.5">
      <div className={cn(AXIS, "flex flex-col-reverse justify-between pb-[22px] text-right")} aria-hidden="true">
        {ticks.map((t) => <span key={t}>{t}</span>)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height }} role="img" aria-label={label}>
          <g stroke={GRID}>
            {ticks.map((t) => {
              const y = H - scaleTo(t, top, H);
              return <line key={t} x1={0} x2={W} y1={y} y2={y} vectorEffect="non-scaling-stroke" />;
            })}
          </g>
          {data.map((d, i) => {
            const h = scaleTo(d.value, top, H);
            return (
              <rect key={i} className="bar-grow" x={i * slot + (slot - bw) / 2} y={H - h} width={bw} height={h} rx={3}
                fill={highlightLast && i === data.length - 1 ? SERIES.copper : color}
                style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }} />
            );
          })}
          {refLine ? (
            <line x1={0} x2={W} y1={H - scaleTo(refLine.value, top, H)} y2={H - scaleTo(refLine.value, top, H)}
              stroke={SERIES.copper} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" opacity={0.7}>
              <title>{refLine.label}</title>
            </line>
          ) : null}
        </svg>
        <div className={cn(AXIS, "grid text-center")} style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }} aria-hidden="true">
          {data.map((d, i) => <span key={i} className="truncate">{d.label}</span>)}
        </div>
      </div>
    </div>
  );
}

/** Line with area fill: line draws in 1.4 s, the area fades in at +1 s. */
export function LineArea({
  points,
  label,
  height = 180,
  color = SERIES.copper,
  id,
}: {
  points: { label: string; value: number }[];
  label: string;
  height?: number;
  color?: string;
  /** Unique per page, for the gradient id. */
  id: string;
}) {
  const W = 560;
  const H = 160;
  const pad = 8;
  if (points.length < 2) return null;
  const { top, ticks } = niceScale(Math.max(...points.map((p) => p.value), 1));
  const xy = points.map((p, i) => [pad + (i / (points.length - 1)) * (W - 2 * pad), H - pad - scaleTo(p.value, top, H - 2 * pad)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)} ${H - pad} L${xy[0][0].toFixed(1)} ${H - pad} Z`;
  const last = xy[xy.length - 1];
  return (
    <div className="flex gap-2.5">
      <div className={cn(AXIS, "flex flex-col-reverse justify-between pb-[22px] text-right")} aria-hidden="true">
        {ticks.map((t) => <span key={t}>{t.toLocaleString("en-US")}</span>)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height }} role="img" aria-label={label}>
          <defs>
            <linearGradient id={`la-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.3} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <line x1={0} x2={W} y1={H - pad} y2={H - pad} stroke={GRID} vectorEffect="non-scaling-stroke" />
          <path className="fade-late" d={area} fill={`url(#la-${id})`} />
          <path className="line-draw" pathLength={1} d={line} fill="none" stroke={color} strokeWidth={2.5}
            strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <circle className="fade-late" cx={last[0]} cy={last[1]} r={4} fill={color} />
        </svg>
        <div className={cn(AXIS, "flex justify-between")} aria-hidden="true">
          {points.map((p, i) => <span key={i}>{p.label}</span>)}
        </div>
      </div>
    </div>
  );
}

/** Tiny line sparkline, no axes. */
export function Sparkline({ values, label, width = 96, height = 28, color = SERIES.copper }: { values: number[]; label: string; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const d = values
    .map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)} ${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path className="line-draw" pathLength={1} d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </svg>
  );
}

/** Horizontal bars with a label column and value (breakdowns). */
export function HBars({
  data,
  label,
  color = SERIES.copper,
  format = (v: number) => v.toLocaleString("en-US"),
}: {
  data: { label: string; value: number; href?: string }[];
  label: string;
  color?: string;
  format?: (v: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="flex flex-col gap-2.5" aria-label={label}>
      {data.map((d, i) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[13px]">
          {d.href ? (
            <Link href={d.href} className="truncate text-fg-2 hover:text-copper-2" title={d.label}>{d.label}</Link>
          ) : (
            <span className="truncate text-fg-2" title={d.label}>{d.label}</span>
          )}
          <span className="h-2 overflow-hidden rounded-full bg-track">
            <span className="block h-full origin-left rounded-full rise" style={{ width: `${(d.value / max) * 100}%`, background: color, animationDelay: `${i * 40}ms` }} />
          </span>
          <span className="num text-xs text-fg-1">{format(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Tornado: signed low/high deltas around a base value, largest swing first. */
export function Tornado({
  rows,
  label,
  format = (v: number) => v.toLocaleString("en-US"),
}: {
  rows: { label: string; low: number; high: number }[];
  label: string;
  format?: (v: number) => string;
}) {
  const max = absMax(rows.flatMap((r) => [r.low, r.high])) || 1;
  const sorted = [...rows].sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {sorted.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,8rem)_1fr] items-center gap-3 text-[13px]">
          <span className="truncate text-fg-2">{r.label}</span>
          <span className="relative h-5">
            <span className="absolute inset-y-0 left-1/2 w-px bg-line-3" />
            {[r.low, r.high].map((v, i) => (
              <span key={i} title={format(v)} className="absolute inset-y-0.5 rounded-sm"
                style={{
                  background: v < 0 ? SERIES.slate : SERIES.copper,
                  left: v < 0 ? `${50 - (Math.abs(v) / max) * 50}%` : "50%",
                  width: `${(Math.abs(v) / max) * 50}%`,
                }} />
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
