import Link from "next/link";
import { HBars } from "@/components/charts/charts";
import { ResourceTable } from "@/components/intel/resource-table";
import {
  GROUP_LABEL,
  categoryTotals,
  containedFromGrade,
  groupEstimates,
  pctChange,
  primaryGradeKey,
  zoneMatrix,
  type Estimate,
  type Group,
  type HistResource,
} from "@/lib/history";
import { formatContained, formatDate, formatGrade, formatTonnes } from "@/lib/utils";

const GROUPS: Group[] = ["mi", "inferred", "reserves"];

/** "+12%" in green, "−8%" in red, nothing when there is no base. */
export function PctChange({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null || !Number.isFinite(value)) return null;
  if (Math.abs(value) < 0.5) return <span className="text-xs text-fg-3">no change</span>;
  const good = invert ? value < 0 : value > 0;
  return (
    <span className={`text-xs tabular-nums ${good ? "text-ok-2" : "text-bad"}`}>
      {value > 0 ? "▲" : "▼"} {Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}%
    </span>
  );
}

function contained(est: Estimate, group: Group, key: string | null) {
  const t = categoryTotals(est.rows, group);
  const g = key ? t?.grades[key] : undefined;
  if (!t || !key || g === undefined) return null;
  return containedFromGrade(t.tonnes, key, g);
}

function metalName(key: string) {
  return key.slice(0, key.lastIndexOf("_"));
}

function formatMetal(v: { value: number; unit: "oz" | "t" }, key: string) {
  return formatContained({ [`${metalName(key)}_${v.unit}`]: v.value });
}

export function ResourceHistory({ rows }: { rows: HistResource[] }) {
  const estimates = groupEstimates(rows);
  if (estimates.length === 0) {
    return <p className="text-sm text-muted-foreground">No resource estimates extracted for this project yet.</p>;
  }
  const latest = estimates[estimates.length - 1];
  const prev = estimates.length > 1 ? estimates[estimates.length - 2] : null;
  const key = primaryGradeKey(rows);
  const groups = GROUPS.filter((g) => estimates.some((e) => categoryTotals(e.rows, g)));

  return (
    <div className="flex flex-col gap-5">
      {/* Headline: latest totals per category, with change vs the previous estimate. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {groups.map((g) => {
          const now = categoryTotals(latest.rows, g);
          const before = prev ? categoryTotals(prev.rows, g) : null;
          const metalNow = contained(latest, g, key);
          const metalBefore = prev ? contained(prev, g, key) : null;
          return (
            <div key={g} className="rounded-xl border border-line p-4">
              <div className="text-xs font-medium text-fg-3">{GROUP_LABEL[g]}</div>
              {now ? (
                <>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="num text-2xl font-medium">{formatTonnes(now.tonnes)}</span>
                    <PctChange value={pctChange(before?.tonnes, now.tonnes)} />
                  </div>
                  <div className="mt-1 text-[13px] text-fg-2">
                    {key && now.grades[key] !== undefined ? formatGrade({ [key]: now.grades[key] }) : formatGrade(now.grades)}
                    {key && before?.grades[key] !== undefined && now.grades[key] !== undefined ? (
                      <> <PctChange value={pctChange(before.grades[key], now.grades[key])} /></>
                    ) : null}
                  </div>
                  {metalNow && key ? (
                    <div className="mt-1 text-[13px] text-fg-2">
                      {formatMetal(metalNow, key)} contained{" "}
                      <PctChange value={pctChange(metalBefore?.value, metalNow.value)} />
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="mt-1 text-sm text-fg-3">Not in latest estimate</div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-fg-3">
        Latest estimate effective {formatDate(latest.date)}
        {prev ? <>; changes are against the {formatDate(prev.date)} estimate</> : null}. Totals add the zones each
        report lists, or use the report&apos;s own total row when it has one; grades are tonnage-weighted.
      </p>

      {estimates.length > 1 ? (
        <>
          {key ? (
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium">
                {`Contained ${metalName(key)} in M&I + Inferred, by estimate`}
              </div>
              <HBars
                label={`Contained ${metalName(key)} by estimate`}
                data={estimates.map((e) => ({
                  label: formatDate(e.date),
                  value: (["mi", "inferred"] as Group[]).reduce((s, g) => s + (contained(e, g, key)?.value ?? 0), 0),
                }))}
                format={(v) => formatMetal({ value: v, unit: containedFromGrade(1, key, 1)!.unit }, key)}
              />
            </div>
          ) : null}

          <ZoneTable estimates={estimates} groups={groups} />
        </>
      ) : null}

      <details className="text-sm">
        <summary className="cursor-pointer text-fg-2">
          Latest estimate, zone by zone ({latest.rows.length} rows)
          {latest.alsoIn ? ` · also restated in ${latest.alsoIn} other filing${latest.alsoIn > 1 ? "s" : ""}` : ""}
        </summary>
        <div className="mt-3">
          <ResourceTable rows={latest.rows} showDate={false} />
        </div>
      </details>
    </div>
  );
}

function ZoneTable({ estimates, groups }: { estimates: Estimate[]; groups: Group[] }) {
  const shown = estimates.slice(-4);
  return (
    <div className="overflow-x-auto">
      <div className="mb-2 text-sm font-medium">Zone by zone across estimates</div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-3">
            <th className="py-2 pr-3 font-medium">Zone</th>
            {shown.map((e) => (
              <th key={e.date} className="py-2 pr-3 font-medium">
                {e.documentId ? (
                  <Link href={`/documents/${e.documentId}`} className="hover:underline">
                    {formatDate(e.date)}
                  </Link>
                ) : (
                  formatDate(e.date)
                )}
              </th>
            ))}
            <th className="py-2 font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const matrix = zoneMatrix(shown, g);
            if (matrix.length === 0) return null;
            return [
              <tr key={`${g}-h`}>
                <td colSpan={shown.length + 2} className="pt-3 pb-1 text-xs font-medium tracking-wide text-fg-3 uppercase">
                  {GROUP_LABEL[g]}
                </td>
              </tr>,
              ...matrix.map((z) => {
                const last = z.cells[z.cells.length - 1];
                const before = z.cells[z.cells.length - 2];
                return (
                  <tr key={`${g}-${z.label}`} className="border-b border-line/50">
                    <td className="py-1.5 pr-3 text-fg-2">{z.label}</td>
                    {z.cells.map((c, i) => (
                      <td key={i} className="py-1.5 pr-3 tabular-nums">
                        {c ? (
                          <>
                            {formatTonnes(c.tonnes)}
                            <span className="text-fg-3"> @ {formatGrade(c.grade).split(", ")[0]}</span>
                          </>
                        ) : (
                          <span className="text-fg-4">—</span>
                        )}
                      </td>
                    ))}
                    <td className="py-1.5">
                      {last && before ? (
                        <PctChange value={pctChange(Number(before.tonnes), Number(last.tonnes))} />
                      ) : last && !before ? (
                        <span className="text-xs text-copper">new</span>
                      ) : !last && before ? (
                        <span className="text-xs text-fg-3">not reported</span>
                      ) : null}
                    </td>
                  </tr>
                );
              }),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
