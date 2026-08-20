import { getAdminData } from "@/lib/admin";
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
      return "default";
    case "parsed":
      return "secondary";
    default:
      return "outline";
  }
}

export default async function AdminPage() {
  const [{ ok, message, documents, sourceStats, statusStats }, spend] =
    await Promise.all([getAdminData(), extractionSpend()]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Canada NI 43-101s are the core corpus. Upload a SEDAR+ PDF below, then
          run the processor and extractor. Automated SEDAR search is not live.
        </p>
        <div className="mt-3">
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/admin/review" />}>
            Open review queue
          </Button>
        </div>
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
