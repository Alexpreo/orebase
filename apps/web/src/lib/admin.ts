import "server-only";
import { getSql } from "@/lib/db";

export type DocumentRow = {
  id: string;
  source: string | null;
  doc_type: string | null;
  title: string | null;
  filed_at: string | Date | null;
  status: string | null;
  page_count: number | null;
  created_at: string | Date | null;
};

export type SourceStat = {
  source: string | null;
  total: number;
  failed: number;
};

export type StatusStat = {
  status: string | null;
  total: number;
};

export type AdminData = {
  ok: boolean;
  message?: string;
  documents: DocumentRow[];
  sourceStats: SourceStat[];
  statusStats: StatusStat[];
};

const DOCUMENTS_LIMIT = 200;

const EMPTY: Omit<AdminData, "ok" | "message"> = {
  documents: [],
  sourceStats: [],
  statusStats: [],
};

export async function getAdminData(): Promise<AdminData> {
  const sql = getSql();
  if (!sql) {
    return {
      ok: false,
      message: "Database is not configured. Set DATABASE_URL_POOLED to load documents.",
      ...EMPTY,
    };
  }

  try {
    const [documents, sourceStats, statusStats] = await Promise.all([
      sql<DocumentRow[]>`
        SELECT id, source, doc_type, title, filed_at, status, page_count, created_at
        FROM raw.documents
        ORDER BY created_at DESC NULLS LAST
        LIMIT ${DOCUMENTS_LIMIT}
      `,
      sql<SourceStat[]>`
        SELECT
          source,
          count(*)::int AS total,
          count(*) FILTER (WHERE status = 'failed')::int AS failed
        FROM raw.documents
        GROUP BY source
        ORDER BY total DESC
      `,
      sql<StatusStat[]>`
        SELECT status, count(*)::int AS total
        FROM raw.documents
        GROUP BY status
        ORDER BY total DESC
      `,
    ]);

    return {
      ok: true,
      documents: [...documents],
      sourceStats: [...sourceStats],
      statusStats: [...statusStats],
    };
  } catch {
    return {
      ok: false,
      message:
        "Could not query the documents tables yet. They may not exist or the database is unreachable.",
      ...EMPTY,
    };
  }
}
