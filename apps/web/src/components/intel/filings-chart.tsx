"use client";

import { useMemo } from "react";
import type { FilingsMonthRow } from "@/lib/intel-types";

const SOURCE_COLORS: Record<string, string> = {
  edgar: "var(--chart-1, #2563eb)",
  sedar: "var(--chart-2, #16a34a)",
  newswire: "var(--chart-3, #d97706)",
};

const FALLBACK_COLORS = ["#64748b", "#7c3aed", "#db2777"];

export function FilingsChart({ rows }: { rows: FilingsMonthRow[] }) {
  const { sources, stacks, maxTotal } = useMemo(() => {
    const monthSet = Array.from(new Set(rows.map((row) => row.month))).sort();
    const sourceSet = Array.from(new Set(rows.map((row) => row.source ?? "unknown")));
    const byMonth = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const month = row.month;
      const source = row.source ?? "unknown";
      if (!byMonth.has(month)) byMonth.set(month, new Map());
      const inner = byMonth.get(month)!;
      inner.set(source, (inner.get(source) ?? 0) + row.total);
    }
    const computed = monthSet.map((month) => {
      const inner = byMonth.get(month) ?? new Map();
      let running = 0;
      const segments = sourceSet.map((source) => {
        const value = inner.get(source) ?? 0;
        const start = running;
        running += value;
        return { source, value, start };
      });
      return { month, total: running, segments };
    });
    const maxTotal = computed.reduce((highest, stack) => Math.max(highest, stack.total), 0);
    return { sources: sourceSet, stacks: computed, maxTotal };
  }, [rows]);

  if (rows.length === 0 || maxTotal === 0) {
    return <p className="text-sm text-muted-foreground">No dated filings to chart yet.</p>;
  }

  const width = Math.max(480, stacks.length * 36);
  const height = 180;
  const padLeft = 28;
  const padBottom = 28;
  const padTop = 8;
  const innerWidth = width - padLeft - 8;
  const innerHeight = height - padBottom - padTop;
  const barWidth = Math.max(8, innerWidth / Math.max(stacks.length, 1) - 6);

  return (
    <div className="flex flex-col gap-3">
      <svg
        role="img"
        aria-label="Filings per month by source"
        viewBox={`0 0 ${width} ${height}`}
        className="h-48 w-full"
      >
        {stacks.map((stack, index) => {
          const x = padLeft + index * (innerWidth / stacks.length) + 3;
          return (
            <g key={stack.month}>
              {stack.segments.map((segment) => {
                if (segment.value === 0) return null;
                const h = (segment.value / maxTotal) * innerHeight;
                const y = padTop + innerHeight - ((segment.start + segment.value) / maxTotal) * innerHeight;
                const fill =
                  SOURCE_COLORS[segment.source] ??
                  FALLBACK_COLORS[sources.indexOf(segment.source) % FALLBACK_COLORS.length];
                return (
                  <rect
                    key={segment.source}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={h}
                    fill={fill}
                  >
                    <title>
                      {stack.month} {segment.source}: {segment.value}
                    </title>
                  </rect>
                );
              })}
              <text
                x={x + barWidth / 2}
                y={height - 8}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize="9"
              >
                {stack.month.slice(2)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {sources.map((source, index) => (
          <span key={source} className="flex items-center gap-1">
            <span
              className="inline-block size-2 rounded-sm"
              style={{
                background:
                  SOURCE_COLORS[source] ??
                  FALLBACK_COLORS[index % FALLBACK_COLORS.length],
              }}
            />
            {source}
          </span>
        ))}
      </div>
    </div>
  );
}
