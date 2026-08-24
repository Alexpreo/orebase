import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { ExtractButton } from "@/components/admin/extract-button";
import { PdfViewer } from "@/components/documents/pdf-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDocument } from "@/lib/documents";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type DocumentPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
};

export default async function DocumentPage({ params, searchParams }: DocumentPageProps) {
  const { id } = await params;
  const { page } = await searchParams;

  const document = await getDocument(id);
  if (!document) {
    notFound();
  }

  const parsedPage = Number.parseInt(page ?? "", 10);
  const initialPage = Number.isNaN(parsedPage) ? 1 : parsedPage;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-1"
            nativeButton={false}
            render={<Link href="/documents" />}
          >
            <ArrowLeft className="size-4" />
            All documents
          </Button>
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {document.title ?? "Untitled document"}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{document.doc_type ?? "unknown"}</Badge>
            <span>Filed {formatDate(document.filed_at)}</span>
            <span>·</span>
            <span>{document.page_count ?? "—"} pages</span>
            <span>·</span>
            <span>{document.chunk_count} indexed chunks</span>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          {document.source_url ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <a href={document.source_url} target="_blank" rel="noreferrer noopener" />
              }
            >
              <ExternalLink className="size-4" />
              View original filing
            </Button>
          ) : null}
          <ExtractButton documentId={document.id} />
        </div>
      </div>

      {document.render_engine ? (
        <p className="text-xs text-muted-foreground">
          Rendered from {document.source_content_type ?? "source"} by{" "}
          <code className="rounded bg-muted px-1 py-0.5">{document.render_engine}</code>.
          Page numbers below are the citation anchors.
        </p>
      ) : null}

      <PdfViewer
        fileUrl={`/api/documents/${document.id}/file`}
        initialPage={initialPage}
      />
    </div>
  );
}
