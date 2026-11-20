import Link from "next/link";
import { HBars } from "@/components/charts/charts";
import type { DrillRow } from "@/lib/intel-types";
import { documentHref, formatDate, formatGrade, formatNumber } from "@/lib/utils";

const unitOf = (k: string) => k.slice(k.lastIndexOf("_") + 1);

/** Most common assay key that has a grade unit, skipping equivalents. */
export function mainKey(rows: DrillRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows)
    for (const k of Object.keys(r.assays ?? {}))
      if (!k.includes("Eq_") && ["gpt", "pct", "ppm"].includes(unitOf(k))) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export const width = (r: DrillRow) => {
  const w = Number(r.interval_m ?? (r.to_m != null && r.from_m != null ? Number(r.to_m) - Number(r.from_m) : NaN));
  return Number.isFinite(w) && w > 0 ? w : null;
};

/** Grade x width (gram-metres or %-metres): how geologists compare intercepts. Best per hole first. */
export function rankIntercepts<T extends DrillRow>(rows: T[], key: string, limit = 8, perHole = false) {
  const ranked = rows
    .map((r) => ({ r, w: width(r), g: Number(r.assays?.[key]) }))
    .filter((x): x is { r: T; w: number; g: number } => x.w !== null && Number.isFinite(x.g) && x.g > 0)
    .sort((a, b) => b.g * b.w - a.g * a.w);
  if (!perHole) return ranked.slice(0, limit);
  const seen = new Set<string>();
  return ranked.filter((x) => {
    const hole = `${x.r.project_id}|${x.r.hole_id ?? x.r.id}`;
    if (seen.has(hole)) return false;
    seen.add(hole);
    return true;
  }).slice(0, limit);
}

export function DrillResults({ rows, showProject = false }: { rows: (DrillRow & { project_name?: string })[]; showProject?: boolean }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No drill intercepts extracted.</p>;
  }
  const key = mainKey(rows);
  const unit = key ? unitOf(key) : "";
  const ranked = key ? rankIntercepts(rows, key) : [];

  return (
    <div className="flex flex-col gap-5">
      {ranked.length >= 3 && key ? (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">
            Best intercepts by {key.split("_")[0]} grade × width ({unit === "pct" ? "%·m" : "g/t·m"})
          </div>
          <HBars
            label="Best drill intercepts"
            data={ranked.map(({ r, w, g }) => ({
              // Hole + depth keeps labels unique when one hole has several intercepts.
              label: `${r.hole_id ?? "hole"} · ${formatNumber(w, 1)} m${r.from_m == null ? "" : ` from ${formatNumber(r.from_m, 0)} m`}`,
              value: g * w,
            }))}
            format={(v) => formatNumber(v, 0)}
          />
        </div>
      ) : null}
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-panel">
            <tr className="border-b border-line text-left text-xs text-fg-3">
              {showProject ? <th className="py-2 pr-3 font-medium">Project</th> : null}
              <th className="py-2 pr-3 font-medium">Hole</th>
              <th className="py-2 pr-3 text-right font-medium">From–to (m)</th>
              <th className="py-2 pr-3 text-right font-medium">Width</th>
              <th className="py-2 pr-3 font-medium">Grade</th>
              <th className="py-2 pr-3 font-medium">Announced</th>
              <th className="py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const href = documentHref(r.document_id);
              const w = width(r);
              return (
                <tr key={r.id} className="border-b border-line/50">
                  {showProject ? (
                    <td className="py-1.5 pr-3">
                      <Link href={`/projects/${r.project_id}`} className="hover:underline">{r.project_name}</Link>
                    </td>
                  ) : null}
                  <td className="py-1.5 pr-3 font-medium">{r.hole_id ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-fg-2">
                    {r.from_m == null ? "—" : `${formatNumber(r.from_m, 1)}–${formatNumber(r.to_m, 1)}`}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {w ? `${formatNumber(w, 1)} m` : "—"}
                    {r.true_width_noted ? <span className="text-fg-3" title="Reported as true width"> TW</span> : null}
                  </td>
                  <td className="py-1.5 pr-3">{formatGrade(r.assays)}</td>
                  <td className="py-1.5 pr-3 text-fg-2">{formatDate(r.announced_date)}</td>
                  <td className="py-1.5">
                    {href ? <Link href={href} className="hover:underline">Report</Link> : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
