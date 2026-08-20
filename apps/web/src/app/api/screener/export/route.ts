import { NextResponse } from "next/server";
import { listScreener } from "@/lib/intel";
import type { ScreenerFilters } from "@/lib/intel-types";
import { formatGrade, formatNumber, formatTonnes } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: ScreenerFilters = {
    commodity: url.searchParams.get("commodity") ?? undefined,
    country: url.searchParams.get("country") ?? undefined,
    stage: url.searchParams.get("stage") ?? undefined,
    studyType: url.searchParams.get("studyType") ?? undefined,
    minGradeKey: url.searchParams.get("minGradeKey") ?? undefined,
    minGrade: url.searchParams.get("minGrade") ?? undefined,
    filedSince: url.searchParams.get("filedSince") ?? undefined,
  };
  const rows = await listScreener(filters);
  const header = [
    "project",
    "company",
    "country",
    "stage",
    "commodities",
    "category",
    "tonnes",
    "grade",
    "study",
    "irr_pct",
    "capex",
  ];
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.name,
        row.company_name ?? "",
        row.country ?? "",
        row.stage ?? "",
        (row.commodities ?? []).join("|"),
        row.resource_category ?? "",
        formatTonnes(row.tonnes),
        formatGrade(row.grade),
        row.study_type ?? "",
        row.irr_pct == null ? "" : formatNumber(row.irr_pct),
        row.capex_initial == null ? "" : formatNumber(row.capex_initial, 0),
      ]
        .map((value) => csvEscape(String(value)))
        .join(","),
    ),
  ];
  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=screener.csv",
    },
  });
}
