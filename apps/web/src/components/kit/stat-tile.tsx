import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  unit,
  chart,
  foot,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  chart?: ReactNode;
  foot?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2.5 rounded-2xl border border-line bg-panel p-[18px]", className)}>
      <span className="text-xs font-medium text-fg-3">{label}</span>
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="num text-[34px] leading-none font-medium tracking-[-0.02em]">{value}</span>
          {unit ? <span className="text-[13px] text-fg-3">{unit}</span> : null}
        </div>
        {chart}
      </div>
      {foot ? <div className="text-xs text-fg-3">{foot}</div> : null}
    </div>
  );
}

/** "▲ 6 vs prior week" in green, "▼" in muted red, "no change" in grey. */
export function Delta({ value, suffix }: { value: number; suffix: string }) {
  if (value === 0) return <span className="text-fg-3">No change {suffix}</span>;
  const up = value > 0;
  return (
    <span className={up ? "text-ok-2" : "text-bad"}>
      {up ? "▲" : "▼"} {Math.abs(value)} {suffix}
    </span>
  );
}
