import Link from "next/link";
import { FilingsChart } from "@/components/intel/filings-chart";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  listDrillHighlights,
  listFilingsByMonth,
  listRecentFilings,
  researchAggregates,
} from "@/lib/intel";
import { formatDate, formatGrade, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const [filings, drills, aggregates, byMonth] = await Promise.all([
    listRecentFilings(),
    listDrillHighlights(),
    researchAggregates(),
    listFilingsByMonth(),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Research</h1>
        <p className="text-sm text-muted-foreground">
          Recent filings, drill highlights, and corpus aggregates.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filings over time</CardTitle>
          <CardDescription>Monthly counts by source from raw.documents.filed_at.</CardDescription>
        </CardHeader>
        <CardContent>
          <FilingsChart rows={byMonth} />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By stage</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {aggregates.byStage.length === 0 ? (
              <p className="text-muted-foreground">No projects yet.</p>
            ) : (
              aggregates.byStage.map((row) => (
                <div key={row.stage ?? "none"} className="flex justify-between">
                  <span>{row.stage ?? "unspecified"}</span>
                  <span className="tabular-nums">{row.total}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By commodity</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {aggregates.byCommodity.length === 0 ? (
              <p className="text-muted-foreground">No commodities yet.</p>
            ) : (
              aggregates.byCommodity.map((row) => (
                <div key={row.commodity} className="flex justify-between">
                  <span>{row.commodity}</span>
                  <span className="tabular-nums">{row.total}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By document type</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {aggregates.byDocType.map((row) => (
              <div key={row.doc_type ?? "none"} className="flex justify-between">
                <span>{row.doc_type ?? "unspecified"}</span>
                <span className="tabular-nums">{row.total}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent filings</CardTitle>
          <CardDescription>Newest documents in the corpus.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {filings.map((filing) => {
            const question = `What does ${filing.title ?? "this filing"} say about resources and economics?`;
            return (
              <div key={filing.id} className="flex flex-col gap-1 border-b py-2 last:border-b-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/documents/${filing.id}`} className="font-medium hover:underline">
                    {filing.title ?? "Untitled"}
                  </Link>
                  <span className="text-xs text-muted-foreground">{formatDate(filing.filed_at)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {filing.doc_type ? <Badge variant="outline">{filing.doc_type}</Badge> : null}
                  {filing.company_id ? (
                    <Link href={`/companies/${filing.company_id}`} className="hover:underline">
                      {filing.company_name}
                    </Link>
                  ) : null}
                  {filing.project_id ? (
                    <Link href={`/projects/${filing.project_id}`} className="hover:underline">
                      {filing.project_name}
                    </Link>
                  ) : null}
                  <Link
                    href={`/chat?q=${encodeURIComponent(question)}${
                      filing.company_name
                        ? `&company=${encodeURIComponent(filing.company_name)}`
                        : ""
                    }${filing.doc_type ? `&doc_type=${encodeURIComponent(filing.doc_type)}` : ""}`}
                    className="hover:underline"
                  >
                    Ask in chat
                  </Link>
                </div>
                {filing.summary ? (
                  <p className="text-sm text-muted-foreground">{filing.summary}</p>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Drill highlights</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {drills.length === 0 ? (
            <p className="text-muted-foreground">No drill intercepts extracted yet.</p>
          ) : (
            drills.map((row) => (
              <div key={row.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  <Link href={`/projects/${row.project_id}`} className="hover:underline">
                    {row.project_name}
                  </Link>
                  {row.hole_id ? ` · ${row.hole_id}` : ""}
                  {row.interval_m != null ? ` · ${formatNumber(row.interval_m, 1)} m` : ""}
                  {" · "}
                  {formatGrade(row.assays)}
                </span>
                <span className="text-muted-foreground">{formatDate(row.announced_date)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
