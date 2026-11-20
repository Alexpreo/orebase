import Link from "next/link";
import { PctChange } from "@/components/intel/resource-history";
import type { Mover } from "@/lib/dashboard";
import { formatDate, formatTonnes } from "@/lib/utils";

const metal = (key: string | null) => (key ? key.slice(0, key.lastIndexOf("_")) : "metal");

function Change({ m }: { m: Mover }) {
  const d = m.delta;
  if (!d) {
    return (
      <>
        {m.mi ? <span>M&amp;I {formatTonnes(m.mi.tonnes)}</span> : null}
        {m.inferred ? <span>Inferred {formatTonnes(m.inferred.tonnes)}</span> : null}
        <span className="text-fg-4">First estimate on file</span>
      </>
    );
  }
  if (d.scopeChange) {
    return (
      <span className="text-fg-3" title="Swings this large usually mean one report covers more or fewer zones">
        Likely a change in scope; check the report
      </span>
    );
  }
  return (
    <>
      {d.miPct !== null ? <span>M&amp;I tonnes <PctChange value={d.miPct} /></span> : null}
      {d.infPct !== null ? <span>Inferred <PctChange value={d.infPct} /></span> : null}
      {d.metalPct !== null ? <span>Contained {metal(d.metalKey)} <PctChange value={d.metalPct} /></span> : null}
    </>
  );
}

export function ResourceMovers({ movers, empty }: { movers: Mover[]; empty: string }) {
  if (movers.length === 0) return <p className="text-sm text-fg-3">{empty}</p>;
  return (
    <ul className="flex flex-col">
      {movers.map((m) => (
        <li key={`${m.project_id}-${m.date}`} className="border-t border-line-soft py-3 first:border-t-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link href={`/projects/${m.project_id}`} className="text-sm font-medium hover:text-copper-2">
              {m.project_name}
            </Link>
            <Link href={`/documents/${m.document_id}`} className="num text-xs text-fg-4 hover:text-fg-2">
              {formatDate(m.date)}
              {m.prevDate ? ` vs ${formatDate(m.prevDate)}` : ""}
            </Link>
          </div>
          {m.company_name ? <div className="text-xs text-fg-3">{m.company_name}</div> : null}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-2">
            <Change m={m} />
          </div>
        </li>
      ))}
    </ul>
  );
}
