import Link from "next/link";
import { rankIntercepts } from "@/components/intel/drill-results";
import type { InterceptRow } from "@/lib/dashboard";
import { formatGrade, formatNumber } from "@/lib/utils";

function List({ rows, gradeKey, title }: { rows: InterceptRow[]; gradeKey: string; title: string }) {
  const ranked = rankIntercepts(rows, gradeKey, 6, true);
  const unit = gradeKey.endsWith("_pct") ? "%·m" : "g/t·m";
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="text-xs font-medium text-fg-3">{title}</div>
      {ranked.length === 0 ? (
        <p className="text-sm text-fg-3">No intercepts with this grade in the window.</p>
      ) : (
        <ol className="flex flex-col">
          {ranked.map(({ r, w, g }) => (
            <li key={r.id} className="flex items-baseline justify-between gap-3 border-t border-line-soft py-2 text-[13px] first:border-t-0">
              <div className="min-w-0">
                <Link href={`/projects/${r.project_id}`} className="font-medium hover:text-copper-2">
                  {r.project_name}
                </Link>
                <div className="truncate text-xs text-fg-3">
                  {r.hole_id ?? "Hole"} · {formatNumber(w, 1)} m @ {formatGrade({ [gradeKey]: g })}
                  {r.from_m != null ? ` from ${formatNumber(r.from_m, 0)} m` : ""}
                </div>
              </div>
              <span className="num shrink-0 text-xs text-fg-1">
                {formatNumber(g * w, 0)} {unit}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Best recent intercepts by grade x width. "All" shows gold and copper side by side. */
export function TopIntercepts({ rows, gradeKey, label }: { rows: InterceptRow[]; gradeKey: string | null; label: string | null }) {
  if (gradeKey && label) return <List rows={rows} gradeKey={gradeKey} title={`${label} · ranked by grade × width`} />;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <List rows={rows} gradeKey="Au_gpt" title="Gold · gram-metres" />
      <List rows={rows} gradeKey="Cu_pct" title="Copper · %-metres" />
    </div>
  );
}
