import type { Snapshot } from "@/lib/history";
import { formatDate, formatGrade, formatMoneyM, formatTonnes, studyLabel } from "@/lib/utils";

/** Latest M&I / Inferred, latest study NPV and the last change, in three short lines. */
export function ProjectFigures({ snap }: { snap: Snapshot | undefined }) {
  if (!snap || (!snap.mi && !snap.inferred && !snap.study)) {
    return <p className="text-xs text-muted-foreground">No figures extracted yet.</p>;
  }
  const grade = (t: Snapshot["mi"]) =>
    t && snap.gradeKey && t.grades[snap.gradeKey] !== undefined
      ? ` @ ${formatGrade({ [snap.gradeKey]: t.grades[snap.gradeKey] })}`
      : "";
  return (
    <div className="flex flex-col gap-0.5 text-[13px]">
      {snap.mi || snap.inferred ? (
        <div>
          {snap.mi ? <span>M&amp;I {formatTonnes(snap.mi.tonnes)}{grade(snap.mi)}</span> : null}
          {snap.mi && snap.inferred ? <span className="text-muted-foreground"> · </span> : null}
          {snap.inferred ? <span>Inferred {formatTonnes(snap.inferred.tonnes)}{grade(snap.inferred)}</span> : null}
          <span className="text-muted-foreground"> ({formatDate(snap.date)})</span>
        </div>
      ) : null}
      {snap.study?.npv ? (
        <div className="text-muted-foreground">
          {studyLabel(snap.study.row.study_type)} NPV {formatMoneyM(snap.study.npv.value, snap.study.row.currency)} (
          {snap.study.npv.basis})
        </div>
      ) : null}
      {snap.change ? <div className="text-copper-2">{snap.change}</div> : null}
    </div>
  );
}
