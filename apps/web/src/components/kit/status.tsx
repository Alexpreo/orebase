import Link from "next/link";
import { cn } from "@/lib/utils";
import { AUTO_APPROVE_MIN, LOW_CONFIDENCE_MAX } from "@/lib/intel-types";

const PILL = "inline-block rounded-full px-2.5 py-[3px] text-xs font-medium whitespace-nowrap";

/** raw.documents.status → design pipeline chip. */
const PIPELINE: Record<string, { label: string; cls: string }> = {
  ingested: { label: "Queued", cls: "bg-[#1A1E24] text-fg-3" },
  triaged: { label: "Queued", cls: "bg-[#1A1E24] text-fg-3" },
  parsing: { label: "Parsing", cls: "shimmer-copper text-copper-2" },
  parsed: { label: "Parsed", cls: "bg-[#1A1E24] text-fg-2" },
  indexed: { label: "Indexed", cls: "bg-slate-tint text-slate-2" },
  extracted: { label: "Extracted", cls: "bg-ok-tint text-ok-2" },
  failed: { label: "Failed", cls: "bg-bad-tint text-bad" },
};

export function PipelineStatusChip({ status }: { status: string | null }) {
  const s = PIPELINE[status ?? ""] ?? { label: status ?? "Unknown", cls: "bg-[#1A1E24] text-fg-3" };
  return <span className={cn(PILL, s.cls)}>{s.label}</span>;
}

export function StagePill({ stage }: { stage: string | null }) {
  if (!stage) return <span className="text-fg-4">—</span>;
  return <span className={cn(PILL, "bg-[#1A1E24] text-fg-2 capitalize")}>{stage.replaceAll("_", " ")}</span>;
}

const COMMODITY_COLOR: Record<string, string> = {
  Cu: "#E0985A",
  Au: "#E8C468",
  Ag: "#B7C0CA",
  Li: "#5B8DEF",
  Ni: "#6FD3A0",
  Zn: "#8DBBF2",
  U: "#C99BF0",
};

export function CommodityDot({ commodity, label = true }: { commodity: string; label?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-2">
      <span
        aria-hidden="true"
        className="size-2 flex-none rounded-full"
        style={{ background: COMMODITY_COLOR[commodity] ?? "#7C8591" }}
      />
      {label ? commodity : <span className="sr-only">{commodity}</span>}
    </span>
  );
}

export function confidenceTone(c: number): "ok" | "warn" | "low" {
  if (c >= AUTO_APPROVE_MIN) return "ok";
  if (c > LOW_CONFIDENCE_MAX) return "warn";
  return "low";
}

const TONE = {
  ok: { text: "text-ok-2", bar: "bg-ok-2" },
  warn: { text: "text-copper-2", bar: "bg-copper" },
  low: { text: "text-bad", bar: "bg-bad" },
};

export function ConfidenceBadge({
  value,
  bar = false,
}: {
  value: number | string | null | undefined;
  bar?: boolean;
}) {
  const n = value == null || value === "" ? NaN : Number(value);
  if (!Number.isFinite(n)) return <span className="num text-fg-4">—</span>;
  const tone = TONE[confidenceTone(n)];
  const text = <span className={cn("num text-xs", tone.text)}>{n.toFixed(2)}</span>;
  if (!bar) return text;
  return (
    <span className="flex items-center gap-2.5">
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-track">
        <span className={cn("block h-full", tone.bar)} style={{ width: `${Math.round(n * 100)}%` }} />
      </span>
      {text}
    </span>
  );
}

/** Numbered citation chip linking to the cited page. */
export function SourceChip({
  documentId,
  page,
  n,
  className,
}: {
  documentId: string;
  page?: number | null;
  n?: number | string;
  className?: string;
}) {
  const href = `/documents/${documentId}${page ? `?page=${page}` : ""}`;
  return (
    <Link
      href={href}
      aria-label={`Source${n != null ? ` ${n}` : ""}${page ? `, page ${page}` : ""}`}
      className={cn(
        "num inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-copper-tint px-[5px] align-[1px] text-[11px] font-semibold text-copper-2 transition-colors hover:bg-copper hover:text-on-copper",
        className,
      )}
    >
      {n ?? (page ? `p.${page}` : "src")}
    </Link>
  );
}
