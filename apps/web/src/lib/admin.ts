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

export type FetchStatusCount = {
  status: string | null;
  total: number;
};

export type ScrapeRunRow = {
  id: string;
  mode: string | null;
  slice: string | null;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  docs_found: number | null;
  docs_fetched: number | null;
  challenges_hit: number | null;
  notes: string | null;
};

export type SedarIngestStatus = {
  path1Configured: boolean;
  webhookConfigured: boolean;
  pendingFetches: FetchStatusCount[];
  sedarDocs24h: number;
  lastRun: ScrapeRunRow | null;
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

export async function getSedarIngestStatus(): Promise<SedarIngestStatus> {
  const empty: SedarIngestStatus = {
    path1Configured: Boolean(process.env.SEDAR_JSON_SEARCH_URL?.trim()),
    webhookConfigured: Boolean(process.env.SEDAR_ALERT_WEBHOOK_SECRET?.trim()),
    pendingFetches: [],
    sedarDocs24h: 0,
    lastRun: null,
  };
  const sql = getSql();
  if (!sql) return empty;
  try {
    const [pendingFetches, docs, runs] = await Promise.all([
      sql<FetchStatusCount[]>`
        SELECT status, count(*)::int AS total
        FROM sedar.pending_fetches
        GROUP BY status
        ORDER BY total DESC
      `,
      sql<{ n: number }[]>`
        SELECT count(*)::int AS n
        FROM raw.documents
        WHERE source = 'sedar'
          AND created_at >= now() - interval '24 hours'
      `,
      sql<ScrapeRunRow[]>`
        SELECT id, mode, slice, started_at, finished_at, docs_found, docs_fetched,
               challenges_hit, notes
        FROM sedar.scrape_runs
        ORDER BY started_at DESC NULLS LAST
        LIMIT 1
      `,
    ]);
    if (process.env.NODE_ENV !== "production") {
      console.debug("[admin] sedar ingest status", {
        path1Configured: empty.path1Configured,
        webhookConfigured: empty.webhookConfigured,
        pendingStatuses: pendingFetches.length,
        sedarDocs24h: docs[0]?.n ?? 0,
        hasLastRun: Boolean(runs[0]),
      });
    }
    return {
      ...empty,
      pendingFetches: [...pendingFetches],
      sedarDocs24h: docs[0]?.n ?? 0,
      lastRun: runs[0] ?? null,
    };
  } catch {
    return empty;
  }
}
