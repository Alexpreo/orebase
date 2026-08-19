import Link from "next/link";
import { Suspense } from "react";
import { FileText } from "lucide-react";
import { DocumentFilters } from "@/components/documents/document-filters";
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
import { getCorpus } from "@/lib/documents";
import { formatDate } from "@/lib/utils";

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

type DocumentsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DocumentsPage({ searchParams }: DocumentsPageProps) {
  const params = await searchParams;
  const { ok, message, documents, facets } = await getCorpus({
    search: firstValue(params.search),
    docType: firstValue(params.docType),
    status: firstValue(params.status),
    source: firstValue(params.source),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground">
          Browse the ingested corpus of filings and technical reports.
        </p>
      </div>

      {!ok && message ? (
        <Card>
          <CardHeader>
            <CardTitle>No data yet</CardTitle>
            <CardDescription>{message}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Suspense fallback={null}>
        <DocumentFilters facets={facets} />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {documents.length} document{documents.length === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>
            Select a document to read it with page-level citations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Filed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Pages</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-sm text-muted-foreground"
                    >
                      No documents match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  documents.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="max-w-md">
                        <Link
                          href={`/documents/${doc.id}`}
                          className="flex items-center gap-2 font-medium hover:underline"
                        >
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate" title={doc.title ?? ""}>
                            {doc.title ?? "Untitled"}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell>{doc.doc_type ?? "—"}</TableCell>
                      <TableCell>{formatDate(doc.filed_at)}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(doc.status)}>
                          {doc.status ?? "unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {doc.page_count ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {doc.chunk_count || "—"}
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
