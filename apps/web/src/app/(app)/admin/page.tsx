import { getAdminData, getSedarIngestStatus } from "@/lib/admin";
import { extractionSpend } from "@/lib/intel";
import { formatDate, formatNumber } from "@/lib/utils";
import { RetryButton } from "@/components/admin/retry-button";
import { CanadaIngestForm } from "@/components/admin/canada-ingest";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
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

export const dynamic = "force-dynamic";

function statusVariant(
  status: string | null,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "failed":
      return "destructive";
    case "extracted":
    case "indexed":
    case "triaged":
      return "default";
    case "parsed":
      return "secondary";
    default:
      return "outline";
  }
}

export default async function AdminPage() {
  const [{ ok, message, documents, sourceStats, statusStats }, spend, sedar] =
    await Promise.all([getAdminData(), extractionSpend(), getSedarIngestStatus()]);
  const pendingOpen =
    sedar.pendingFetches.find((row) => row.status === "pending")?.total ?? 0;
  const searchLive = sedar.sedarDocs24h > 0 || pendingOpen > 0 || sedar.lastRun != null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Canada NI 43-101s are the core corpus. Manual upload still works.
          Automated search is {searchLive ? "running against the queue below" : "waiting on a headed SEDAR+ session and Path 1 env"}.
        </p>
        <div className="mt-3">
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/admin/review" />}>
            Open review queue
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Path 1 JSON</CardTitle>
            <CardDescription>Worker env SEDAR_JSON_SEARCH_URL (also set here to reflect status).</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant={sedar.path1Configured ? "default" : "outline"}>
              {sedar.path1Configured ? "configured" : "off — DOM fallback"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alert webhook</CardTitle>
            <CardDescription>POST /api/ingest/sedar-alert</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant={sedar.webhookConfigured ? "default" : "outline"}>
              {sedar.webhookConfigured ? "secret set" : "secret missing"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SEDAR docs (24h)</CardTitle>
            <CardDescription>raw.documents where source=sedar</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {sedar.sedarDocs24h}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">pending_fetches</CardTitle>
            <CardDescription>Alert and nightly enqueue depth.</CardDescription>
          </CardHeader>
          <CardContent>
            {sedar.pendingFetches.length === 0 ? (
              <p className="text-sm text-muted-foreground">Queue empty.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {sedar.pendingFetches.map((row) => (
                  <li key={row.status ?? "unknown"} className="flex justify-between">
                    <span>{row.status ?? "unknown"}</span>
                    <span className="tabular-nums">{row.total}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Last scrape run</CardTitle>
            <CardDescription>sedar.scrape_runs</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {sedar.lastRun ? (
              <div className="flex flex-col gap-1">
                <div>
                  {sedar.lastRun.mode ?? "run"}{" "}
                  {sedar.lastRun.slice ? `· ${sedar.lastRun.slice}` : ""}
                </div>
                <div className="text-muted-foreground">
                  started {formatDate(sedar.lastRun.started_at)}
                  {sedar.lastRun.finished_at
                    ? ` · finished ${formatDate(sedar.lastRun.finished_at)}`
                    : " · in progress"}
                </div>
                <div className="text-muted-foreground">
                  found {sedar.lastRun.docs_found ?? "—"} · fetched{" "}
                  {sedar.lastRun.docs_fetched ?? "—"} · challenges{" "}
                  {sedar.lastRun.challenges_hit ?? "—"}
                </div>
                {sedar.lastRun.notes ? (
                  <p className="text-muted-foreground">{sedar.lastRun.notes}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-muted-foreground">No scrape_runs yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <CanadaIngestForm />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Extract spend today</CardTitle>
            <CardDescription>Sum of app.extraction_costs since midnight.</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            ${formatNumber(spend.daily, 4)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Extract spend this month</CardTitle>
            <CardDescription>Hard cap is configured on the worker.</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            ${formatNumber(spend.monthly, 4)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Extract queue</CardTitle>
            <CardDescription>Pending extract jobs.</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {spend.queue}
          </CardContent>
        </Card>
      </div>

      {!ok && message ? (
        <Card>
          <CardHeader>
            <CardTitle>No data yet</CardTitle>
            <CardDescription>{message}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Documents per source</CardTitle>
            <CardDescription>Total and failed counts by source.</CardDescription>
          </CardHeader>
          <CardContent>
            {sourceStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sources yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sourceStats.map((s) => (
                  <li
                    key={s.source ?? "unknown"}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="font-medium">{s.source ?? "unknown"}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span>{s.total} docs</span>
                      {s.failed > 0 ? (
                        <Badge variant="destructive">{s.failed} failed</Badge>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Documents by status</CardTitle>
            <CardDescription>Pipeline stage distribution.</CardDescription>
          </CardHeader>
          <CardContent>
            {statusStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">No documents yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {statusStats.map((s) => (
                  <Badge key={s.status ?? "unknown"} variant={statusVariant(s.status)}>
                    {s.status ?? "unknown"}: {s.total}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
          <CardDescription>
            Most recent {documents.length} document
            {documents.length === 1 ? "" : "s"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Filed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Pages</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center text-sm text-muted-foreground"
                    >
                      No documents to show.
                    </TableCell>
                  </TableRow>
                ) : (
                  documents.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell>{doc.source ?? "—"}</TableCell>
                      <TableCell>{doc.doc_type ?? "—"}</TableCell>
                      <TableCell className="max-w-xs truncate" title={doc.title ?? ""}>
                        {doc.title ?? "—"}
                      </TableCell>
                      <TableCell>{formatDate(doc.filed_at)}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(doc.status)}>
                          {doc.status ?? "unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {doc.page_count ?? "—"}
                      </TableCell>
                      <TableCell>{formatDate(doc.created_at)}</TableCell>
                      <TableCell className="text-right">
                        {doc.status === "failed" ? (
                          <RetryButton documentId={doc.id} />
                        ) : null}
                      </TableCell>
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
