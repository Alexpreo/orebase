import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { ExtractButton } from "@/components/admin/extract-button";
import { PdfViewer } from "@/components/documents/pdf-viewer";
import { DrillResults } from "@/components/intel/drill-results";
import { EconomicsTable } from "@/components/intel/economics-table";
import { ResourceTable } from "@/components/intel/resource-table";
import { Panel } from "@/components/kit/panel";
import { Button } from "@/components/ui/button";
import { isAdmin } from "@/lib/admin-auth";
import { getDocument } from "@/lib/documents";
import { listDocumentFacts } from "@/lib/intel";
import { docTypeLabel, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type DocumentPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
};

export default async function DocumentPage({ params, searchParams }: DocumentPageProps) {
  const { id } = await params;
  const { page } = await searchParams;

  const [document, facts, admin] = await Promise.all([getDocument(id), listDocumentFacts(id), isAdmin()]);
  if (!document) {
    notFound();
  }

  const parsedPage = Number.parseInt(page ?? "", 10);
  // A citation link (?page=N) means the reader wants the source page, so lead with the PDF.
  const cited = !Number.isNaN(parsedPage);
  const initialPage = cited ? parsedPage : 1;
  const hasFacts = facts.resources.length + facts.economics.length + facts.drills.length > 0;

  const pdf = (
    <PdfViewer fileUrl={`/api/documents/${document.id}/file`} initialPage={initialPage} />
  );

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
          <h1 className="text-xl font-semibold tracking-tight">
            {document.project_name ?? document.company_name ?? document.title ?? "Untitled document"}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{docTypeLabel(document.doc_type)}</span>
            <span>·</span>
            <span>Filed {formatDate(document.filed_at)}</span>
            {document.company_id && document.company_name ? (
              <>
                <span>·</span>
                <Link href={`/companies/${document.company_id}`} className="hover:underline">
                  {document.company_name}
                </Link>
              </>
            ) : null}
            {document.project_id ? (
              <>
                <span>·</span>
                <Link href={`/projects/${document.project_id}`} className="hover:underline">
                  Project page and history
                </Link>
              </>
            ) : null}
            <span>·</span>
            <span>{document.page_count ?? "—"} pages</span>
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
              Original filing
            </Button>
          ) : null}
          {admin ? <ExtractButton documentId={document.id} /> : null}
        </div>
      </div>

      {cited ? pdf : null}

      {document.summary || hasFacts ? (
        <Panel title="What this filing says">
          {document.summary ? <p className="max-w-3xl text-sm leading-relaxed text-fg-2">{document.summary}</p> : null}
          {facts.resources.length ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Resources and reserves</h3>
              <ResourceTable rows={facts.resources} />
            </div>
          ) : null}
          {facts.economics.length ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Study economics</h3>
              <EconomicsTable rows={facts.economics} />
            </div>
          ) : null}
          {facts.drills.length ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Drill results</h3>
              <DrillResults rows={facts.drills} />
            </div>
          ) : null}
        </Panel>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing has been extracted from this filing yet, so only the PDF is available.
        </p>
      )}

      {cited ? null : pdf}
    </div>
  );
}
