import "server-only";
import { getSql } from "@/lib/db";

export type CorpusDocument = {
  id: string;
  source: string | null;
  source_url: string | null;
  doc_type: string | null;
  title: string | null;
  filed_at: string | Date | null;
  status: string | null;
  page_count: number | null;
  chunk_count: number;
  created_at: string | Date | null;
};

export type DocumentDetail = CorpusDocument & {
  storage_path: string | null;
  source_storage_path: string | null;
  source_content_type: string | null;
  render_engine: string | null;
};

export type DocumentFilters = {
  search?: string;
  docType?: string;
  status?: string;
  source?: string;
};

export type DocumentFacets = {
  docTypes: string[];
  statuses: string[];
  sources: string[];
};

export type CorpusResult = {
  ok: boolean;
  message?: string;
  documents: CorpusDocument[];
  facets: DocumentFacets;
};

const DOCUMENTS_LIMIT = 500;

const EMPTY_FACETS: DocumentFacets = { docTypes: [], statuses: [], sources: [] };

const DB_UNCONFIGURED =
  "Database is not configured. Set DATABASE_URL_POOLED to browse the corpus.";
const QUERY_FAILED =
  "Could not query the corpus. The documents tables may not exist yet.";

/** Treats blank and the "all" sentinel from the filter UI as no filter. */
function activeFilter(value: string | undefined): string | null {
  if (!value || value === "all" || value.trim().length === 0) {
    return null;
  }
  return value;
}

export async function getCorpus(filters: DocumentFilters = {}): Promise<CorpusResult> {
  const sql = getSql();
  if (!sql) {
    return { ok: false, message: DB_UNCONFIGURED, documents: [], facets: EMPTY_FACETS };
  }

  const search = activeFilter(filters.search);
  const docType = activeFilter(filters.docType);
  const status = activeFilter(filters.status);
  const source = activeFilter(filters.source);

  try {
    const [documents, facetRows] = await Promise.all([
      sql<CorpusDocument[]>`
        SELECT
          d.id,
          d.source,
          d.source_url,
          d.doc_type,
          d.title,
          d.filed_at,
          d.status,
          d.page_count,
          d.created_at,
          (SELECT count(*)::int FROM raw.document_chunks c WHERE c.document_id = d.id)
            AS chunk_count
        FROM raw.documents d
        WHERE (${search}::text IS NULL OR d.title ILIKE '%' || ${search} || '%')
          AND (${docType}::text IS NULL OR d.doc_type = ${docType})
          AND (${status}::text IS NULL OR d.status = ${status})
          AND (${source}::text IS NULL OR d.source = ${source})
        ORDER BY d.filed_at DESC NULLS LAST, d.created_at DESC NULLS LAST
        LIMIT ${DOCUMENTS_LIMIT}
      `,
      // Facets come from the whole corpus, not the filtered set, so choosing one value
      // never hides the others and strands the user with no way back.
      sql<{ kind: string; value: string }[]>`
        SELECT 'doc_type' AS kind, doc_type AS value FROM raw.documents
          WHERE doc_type IS NOT NULL GROUP BY doc_type
        UNION ALL
        SELECT 'status', status FROM raw.documents
          WHERE status IS NOT NULL GROUP BY status
        UNION ALL
        SELECT 'source', source FROM raw.documents
          WHERE source IS NOT NULL GROUP BY source
      `,
    ]);

    const pick = (kind: string) =>
      facetRows.filter((r) => r.kind === kind).map((r) => r.value).sort();

    return {
      ok: true,
      documents: [...documents],
      facets: {
        docTypes: pick("doc_type"),
        statuses: pick("status"),
        sources: pick("source"),
      },
    };
  } catch {
    return { ok: false, message: QUERY_FAILED, documents: [], facets: EMPTY_FACETS };
  }
}

export async function getDocument(id: string): Promise<DocumentDetail | null> {
  const sql = getSql();
  if (!sql) {
    return null;
  }

  try {
    const rows = await sql<DocumentDetail[]>`
      SELECT
        d.id,
        d.source,
        d.source_url,
        d.doc_type,
        d.title,
        d.filed_at,
        d.status,
        d.page_count,
        d.created_at,
        d.storage_path,
        d.source_storage_path,
        d.source_content_type,
        d.render_engine,
        (SELECT count(*)::int FROM raw.document_chunks c WHERE c.document_id = d.id)
          AS chunk_count
      FROM raw.documents d
      WHERE d.id = ${id}
    `;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
