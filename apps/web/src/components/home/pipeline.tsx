import { HBars, SERIES } from "@/components/charts/charts";
import type { Pipeline } from "@/lib/dashboard";
import { COMMODITIES } from "@/lib/dashboard";
import { stageLabel } from "@/lib/utils";

export function PipelinePanel({ data, empty }: { data: Pipeline; empty: string }) {
  if (data.breakdown.length === 0 && data.stages.length === 0) return <p className="text-sm text-fg-3">{empty}</p>;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="text-xs font-medium text-fg-3">
          New reports by {data.breakdownBy}
        </div>
        <HBars
          label={`New technical reports by ${data.breakdownBy}`}
          data={data.breakdown.map((b) => ({ ...b, label: COMMODITIES.find((c) => c.code === b.label)?.label ?? b.label }))}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="text-xs font-medium text-fg-3">Projects with new reports, by stage</div>
        <HBars
          label="Projects with new reports by stage"
          color={SERIES.slate}
          data={data.stages.map((s) => ({ ...s, label: stageLabel(s.label) }))}
        />
      </div>
    </div>
  );
}
