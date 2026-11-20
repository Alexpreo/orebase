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

export type IngestionStatus = {
  /** Jobs running now, or touched in the last 15 minutes. */
  active: number;
  pending: number;
  lastBySource: { source: string; last: string }[];
};

export async function ingestionStatus(): Promise<IngestionStatus> {
  const empty: IngestionStatus = { active: 0, pending: 0, lastBySource: [] };
  const sql = getSql();
  if (!sql) return empty;
  try {
    const [jobs, sources] = await Promise.all([
      sql<{ active: number; pending: number }[]>`
        SELECT count(*) FILTER (WHERE status = 'running'
                  OR (status = 'done' AND updated_at >= now() - interval '15 minutes'))::int AS active,
               count(*) FILTER (WHERE status = 'pending')::int AS pending
        FROM raw.processing_jobs
      `,
      sql<{ source: string; last: Date }[]>`
        SELECT source, max(created_at) AS last
        FROM raw.documents WHERE source IS NOT NULL
        GROUP BY source ORDER BY last DESC
      `,
    ]);
    return {
      active: jobs[0]?.active ?? 0,
      pending: jobs[0]?.pending ?? 0,
      lastBySource: sources.map((s) => ({ source: s.source, last: new Date(s.last).toISOString() })),
    };
  } catch {
    return empty;
  }
}

export type DataCoverage = {
  noProject: number;
  noCompany: number;
  noFacts: number;
  projectsOneEstimate: number;
  projectsWithHistory: number;
  historyBackfillFilings: number;
};

/** How much of the corpus can feed history views; the gaps a backfill would close. */
export async function dataCoverage(): Promise<DataCoverage | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const [row] = await sql<DataCoverage[]>`
      WITH est AS (
        SELECT project_id, count(DISTINCT document_id) AS n FROM core.resource_estimates GROUP BY 1
      )
      SELECT
        (SELECT count(*)::int FROM raw.documents WHERE project_id IS NULL) AS "noProject",
        (SELECT count(*)::int FROM raw.documents WHERE company_id IS NULL) AS "noCompany",
        (SELECT count(*)::int FROM raw.documents d
          WHERE NOT EXISTS (SELECT 1 FROM core.resource_estimates r WHERE r.document_id = d.id)
            AND NOT EXISTS (SELECT 1 FROM core.project_economics e WHERE e.document_id = d.id)) AS "noFacts",
        (SELECT count(*)::int FROM est WHERE n = 1) AS "projectsOneEstimate",
        (SELECT count(*)::int FROM est WHERE n >= 2) AS "projectsWithHistory",
        (SELECT count(*)::int FROM raw.documents d
          WHERE d.project_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM core.resource_estimates r WHERE r.document_id = d.id)
            AND d.project_id IN (SELECT project_id FROM raw.documents GROUP BY 1 HAVING count(*) >= 2)
        ) AS "historyBackfillFilings"
    `;
    return row ?? null;
  } catch {
    return null;
  }
}
