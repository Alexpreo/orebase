import Link from "next/link";
import { EconomicsTable } from "@/components/intel/economics-table";
import { PctChange } from "@/components/intel/resource-history";
import {
  economicsProgression,
  npvComparable,
  pctChange,
  type HistEconomics,
  type Study,
} from "@/lib/history";
import { formatDate, formatMoneyM, formatNumber, formatPerUnit, studyLabel } from "@/lib/utils";

const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

type Metric = {
  label: string;
  show: (s: Study) => string;
  value: (s: Study) => number | null;
  /** Lower is better (capex, payback). */
  invert?: boolean;
  comparable?: (a: Study, b: Study) => boolean;
};

const METRICS: Metric[] = [
  {
    label: "NPV",
    show: (s) => (s.npv ? `${formatMoneyM(s.npv.value, s.row.currency)} (${s.npv.basis})` : "—"),
    value: (s) => s.npv?.value ?? null,
    comparable: npvComparable,
  },
  { label: "IRR", show: (s) => (n(s.row.irr_pct) == null ? "—" : `${formatNumber(s.row.irr_pct, 1)}%`), value: (s) => n(s.row.irr_pct) },
  {
    label: "Initial capex",
    show: (s) => formatMoneyM(s.row.capex_initial, s.row.currency),
    value: (s) => n(s.row.capex_initial),
    invert: true,
    comparable: (a, b) => a.row.currency === b.row.currency,
  },
  { label: "AISC", show: (s) => formatPerUnit(s.row.aisc), value: (s) => firstValue(s.row.aisc), invert: true },
  { label: "Mine life", show: (s) => (n(s.row.mine_life_years) == null ? "—" : `${formatNumber(s.row.mine_life_years, 1)} yr`), value: (s) => n(s.row.mine_life_years) },
  { label: "Payback", show: (s) => (n(s.row.payback_years) == null ? "—" : `${formatNumber(s.row.payback_years, 1)} yr`), value: (s) => n(s.row.payback_years), invert: true },
  { label: "Metal prices", show: (s) => formatPerUnit(s.row.metal_price_assumptions), value: () => null },
];

function firstValue(map: Record<string, number> | null | undefined): number | null {
  const v = map ? Object.values(map).find((x) => Number.isFinite(x)) : undefined;
  return v ?? null;
}

export function StudyProgression({ rows }: { rows: HistEconomics[] }) {
  const studies = economicsProgression(rows);
  if (studies.length === 0) {
    return <p className="text-sm text-muted-foreground">No study economics extracted for this project yet.</p>;
  }
  if (studies.length === 1) return <EconomicsTable rows={studies.map((s) => s.row)} />;

  const shown = studies.slice(-4);
  const last = shown[shown.length - 1];
  const before = shown[shown.length - 2];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-3">
            <th className="py-2 pr-3 font-medium" />
            {shown.map((s) => (
              <th key={s.row.id} className="py-2 pr-3 font-medium">
                <div className="text-fg-1">{studyLabel(s.row.study_type)}</div>
                {s.row.document_id ? (
                  <Link href={`/documents/${s.row.document_id}`} className="hover:underline">
                    {formatDate(s.date)}
                  </Link>
                ) : (
                  formatDate(s.date)
                )}
              </th>
            ))}
            <th className="py-2 font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => {
            const ok = !m.comparable || m.comparable(before, last);
            return (
              <tr key={m.label} className="border-b border-line/50 align-top">
                <td className="py-1.5 pr-3 text-fg-3">{m.label}</td>
                {shown.map((s) => (
                  <td key={s.row.id} className="py-1.5 pr-3 tabular-nums">{m.show(s)}</td>
                ))}
                <td className="py-1.5">
                  {ok ? (
                    <PctChange value={pctChange(m.value(before), m.value(last))} invert={m.invert} />
                  ) : (
                    <span className="text-xs text-fg-3" title="Different tax basis, discount rate or currency">
                      not like-for-like
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
