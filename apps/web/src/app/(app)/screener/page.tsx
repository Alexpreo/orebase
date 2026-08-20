import Link from "next/link";
import { Suspense } from "react";
import { ScreenerFilters } from "@/components/intel/screener-filters";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ensureUserId, resolveClerkId } from "@/lib/chat";
import { listSavedFilters, listScreener, screenerFacets } from "@/lib/intel";
import type { ScreenerFilters as FilterValues } from "@/lib/intel-types";
import { formatDate, formatGrade, formatNumber, formatTonnes } from "@/lib/utils";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ScreenerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters: FilterValues = {
    commodity: firstValue(params.commodity),
    country: firstValue(params.country),
    stage: firstValue(params.stage),
    studyType: firstValue(params.studyType),
    minGradeKey: firstValue(params.minGradeKey),
    minGrade: firstValue(params.minGrade),
    filedSince: firstValue(params.filedSince),
  };

  const clerkId = await resolveClerkId();
  const userId = await ensureUserId(clerkId);
  const [rows, facets, saved] = await Promise.all([
    listScreener(filters),
    screenerFacets(),
    listSavedFilters(userId),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Screener</h1>
        <p className="text-sm text-muted-foreground">
          Compare projects by commodity, grade, stage, and economics.
        </p>
      </div>

      <Suspense fallback={null}>
        <ScreenerFilters facets={facets} saved={saved} />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {rows.length} project{rows.length === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>
            Latest resource row and latest economics row per project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Tonnes</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Study</TableHead>
                  <TableHead className="text-right">IRR</TableHead>
                  <TableHead>Resource date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                      No projects match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link href={`/projects/${row.id}`} className="font-medium hover:underline">
                          {row.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {row.company_id ? (
                          <Link href={`/companies/${row.company_id}`} className="hover:underline">
                            {row.company_name ?? "—"}
                          </Link>
                        ) : (
                          (row.company_name ?? "—")
                        )}
                      </TableCell>
                      <TableCell>
                        {row.stage ? <Badge variant="outline">{row.stage}</Badge> : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatTonnes(row.tonnes)}
                      </TableCell>
                      <TableCell>{formatGrade(row.grade)}</TableCell>
                      <TableCell>{row.study_type ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.irr_pct == null ? "—" : `${formatNumber(row.irr_pct)}%`}
                      </TableCell>
                      <TableCell>{formatDate(row.resource_date)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
