import Link from "next/link";
import { Suspense } from "react";
import { MiniMap } from "@/components/intel/mini-map";
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

function sortHref(
  params: Record<string, string | string[] | undefined>,
  key: string,
  currentSort: string,
  currentDir: string,
): string {
  const next = new URLSearchParams();
  for (const [name, raw] of Object.entries(params)) {
    const value = firstValue(raw);
    if (value) next.set(name, value);
  }
  const dir = currentSort === key && currentDir === "desc" ? "asc" : "desc";
  next.set("sort", key);
  next.set("dir", dir);
  return `/screener?${next.toString()}`;
}

function sortMark(key: string, currentSort: string, currentDir: string): string {
  if (currentSort !== key) return "";
  return currentDir === "asc" ? " ↑" : " ↓";
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
    sort: firstValue(params.sort) ?? "tonnes",
    dir: firstValue(params.dir) ?? "desc",
  };

  const view = firstValue(params.view);
  const sortKey = filters.sort ?? "tonnes";
  const sortDir = filters.dir ?? "desc";
  if (process.env.NODE_ENV !== "production") {
    console.debug("[screener] query", {
      commodity: filters.commodity ?? null,
      country: filters.country ?? null,
      stage: filters.stage ?? null,
      sort: sortKey,
      dir: sortDir,
      view: view ?? "table",
    });
  }
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
          {view === "map" ? (
            <MiniMap
              points={rows.map((row) => ({
                id: row.id,
                name: row.name,
                lat: row.lat,
                lng: row.lng,
                href: `/projects/${row.id}`,
              }))}
            />
          ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Link href={sortHref(params, "name", sortKey, sortDir)} className="hover:underline">
                      Project{sortMark("name", sortKey, sortDir)}
                    </Link>
                  </TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">
                    <Link href={sortHref(params, "tonnes", sortKey, sortDir)} className="hover:underline">
                      Tonnes{sortMark("tonnes", sortKey, sortDir)}
                    </Link>
                  </TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Study</TableHead>
                  <TableHead className="text-right">
                    <Link href={sortHref(params, "irr_pct", sortKey, sortDir)} className="hover:underline">
                      IRR{sortMark("irr_pct", sortKey, sortDir)}
                    </Link>
                  </TableHead>
                  <TableHead>
                    <Link href={sortHref(params, "resource_date", sortKey, sortDir)} className="hover:underline">
                      Resource date{sortMark("resource_date", sortKey, sortDir)}
                    </Link>
                  </TableHead>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
