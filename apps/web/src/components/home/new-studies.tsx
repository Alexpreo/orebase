import Link from "next/link";
import { PctChange } from "@/components/intel/resource-history";
import type { NewStudy } from "@/lib/dashboard";
import { npvComparable, pctChange } from "@/lib/history";
import { formatMoneyM, formatNumber, formatShortDate, studyLabel } from "@/lib/utils";

export function NewStudies({ studies, empty }: { studies: NewStudy[]; empty: string }) {
  if (studies.length === 0) return <p className="px-5 text-sm text-fg-3">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-[11px] tracking-[0.06em] text-fg-4 uppercase">
            <th scope="col" className="px-5 py-2 font-semibold">Project</th>
            <th scope="col" className="px-3 py-2 font-semibold">NPV</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">IRR</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Capex</th>
            <th scope="col" className="px-5 py-2 text-right font-semibold">Filed</th>
          </tr>
        </thead>
        <tbody>
          {studies.map(({ study, previous, ...p }) => {
            const s = study.row;
            const vsPrev = previous && npvComparable(previous, study) ? pctChange(previous.npv?.value, study.npv?.value) : null;
            return (
              <tr key={s.id} className="border-t border-line-soft align-top">
                <td className="px-5 py-2.5">
                  <Link href={`/projects/${p.project_id}`} className="font-medium hover:text-copper-2">
                    {p.project_name}
                  </Link>
                  <div className="text-xs text-fg-3">
                    {studyLabel(s.study_type)}
                    {p.company_name ? ` · ${p.company_name}` : ""}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {study.npv ? formatMoneyM(study.npv.value, s.currency) : "—"}
                  {study.npv ? <div className="text-xs text-fg-4">{study.npv.basis}</div> : null}
                  {vsPrev !== null ? (
                    <div className="text-xs">
                      <PctChange value={vsPrev} /> <span className="text-fg-4">vs {studyLabel(previous!.row.study_type)}</span>
                    </div>
                  ) : null}
                </td>
                <td className="num px-3 py-2.5 text-right">{s.irr_pct == null ? "—" : `${formatNumber(s.irr_pct, 1)}%`}</td>
                <td className="num px-3 py-2.5 text-right">{formatMoneyM(s.capex_initial, s.currency)}</td>
                <td className="num px-5 py-2.5 text-right whitespace-nowrap text-fg-3">{formatShortDate(p.filed_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
