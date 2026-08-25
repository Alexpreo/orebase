import "server-only";
import { getSql } from "@/lib/db";
import type {
  CompanyDetail,
  CompanyListItem,
  DrillRow,
  EconomicsRow,
  EventRow,
  FilingRow,
  FilingsMonthRow,
  GeoOccurrence,
  ProjectSummary,
  ResourceRow,
  ReviewItem,
  SavedFilter,
  ScreenerFilters,
  ScreenerRow,
  WatchlistItemRecord,
  WatchlistRecord,
} from "@/lib/intel-types";
import { LOW_CONFIDENCE_MAX } from "@/lib/intel-types";

const LIST_LIMIT = 200;

function active(value: string | undefined): string | null {
  if (!value || value === "all" || value.trim().length === 0) return null;
  return value;
}

function asFilters(raw: unknown): ScreenerFilters {
  if (!raw || typeof raw !== "object") return {};
  return raw as ScreenerFilters;
}

export async function listCompanies(): Promise<CompanyListItem[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = await sql<CompanyListItem[]>`
    SELECT
      c.id, c.name, c.cik, c.tickers, c.hq_country,
      (SELECT count(*)::int FROM core.projects p WHERE p.company_id = c.id) AS project_count,
      (SELECT count(*)::int FROM raw.documents d WHERE d.company_id = c.id) AS document_count
    FROM core.companies c
    ORDER BY c.name
    LIMIT ${LIST_LIMIT}
  `;
    return [...rows];
  } catch {
    return [];
  }
}

export async function getCompany(id: string): Promise<CompanyDetail | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql<CompanyDetail[]>`
    SELECT id, name, cik, tickers, hq_country, website, sedar_profile
    FROM core.companies
    WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function listCompanyProjects(companyId: string): Promise<ProjectSummary[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<ProjectSummary[]>`
    SELECT p.id, p.company_id, c.name AS company_name, p.name, p.country, p.region,
           p.commodities, p.stage, p.lat, p.lng
    FROM core.projects p
    LEFT JOIN core.companies c ON c.id = p.company_id
    WHERE p.company_id = ${companyId}
    ORDER BY p.name
  `;
  return [...rows];
}

export async function listCompanyFilings(companyId: string): Promise<FilingRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<FilingRow[]>`
    SELECT d.id, d.title, d.doc_type, d.filed_at, d.status, d.company_id,
           c.name AS company_name, d.project_id, p.name AS project_name, d.summary
    FROM raw.documents d
    LEFT JOIN core.companies c ON c.id = d.company_id
    LEFT JOIN core.projects p ON p.id = d.project_id
    WHERE d.company_id = ${companyId}
    ORDER BY d.filed_at DESC NULLS LAST
    LIMIT ${LIST_LIMIT}
  `;
  return [...rows];
}

export async function getProject(id: string): Promise<ProjectSummary | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql<ProjectSummary[]>`
    SELECT p.id, p.company_id, c.name AS company_name, p.name, p.country, p.region,
           p.commodities, p.stage, p.lat, p.lng
    FROM core.projects p
    LEFT JOIN core.companies c ON c.id = p.company_id
    WHERE p.id = ${id}
  `;
  return rows[0] ?? null;
}

export async function listProjectResources(projectId: string): Promise<ResourceRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<ResourceRow[]>`
    SELECT id, project_id, document_id, effective_date, category, tonnes, grade,
           contained_metal, cutoff, standard, extraction_confidence, reviewed
    FROM core.resource_estimates
    WHERE project_id = ${projectId}
    ORDER BY effective_date DESC NULLS LAST, category
  `;
  return [...rows];
}

export async function listProjectEconomics(projectId: string): Promise<EconomicsRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<EconomicsRow[]>`
    SELECT id, project_id, document_id, study_type, effective_date, currency, npv,
           irr_pct, capex_initial, aisc, mine_life_years, payback_years,
           metal_price_assumptions, extraction_confidence, reviewed
    FROM core.project_economics
    WHERE project_id = ${projectId}
    ORDER BY effective_date DESC NULLS LAST
  `;
  return [...rows];
}

export async function listProjectEvents(projectId: string): Promise<EventRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<EventRow[]>`
    SELECT e.id, e.project_id, p.name AS project_name, c.name AS company_name,
           e.document_id, e.event_type, e.event_date, e.summary
    FROM core.project_events e
    JOIN core.projects p ON p.id = e.project_id
    LEFT JOIN core.companies c ON c.id = p.company_id
    WHERE e.project_id = ${projectId}
    ORDER BY e.event_date DESC NULLS LAST, e.id DESC
  `;
  return [...rows];
}

export async function listCompanyEvents(companyId: string): Promise<EventRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<EventRow[]>`
    SELECT e.id, e.project_id, p.name AS project_name, c.name AS company_name,
           e.document_id, e.event_type, e.event_date, e.summary
    FROM core.project_events e
    JOIN core.projects p ON p.id = e.project_id
    LEFT JOIN core.companies c ON c.id = p.company_id
    WHERE p.company_id = ${companyId}
    ORDER BY e.event_date DESC NULLS LAST, e.id DESC
    LIMIT ${LIST_LIMIT}
  `;
  return [...rows];
}

export async function listProjectFilings(projectId: string): Promise<FilingRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<FilingRow[]>`
    SELECT d.id, d.title, d.doc_type, d.filed_at, d.status, d.company_id,
           c.name AS company_name, d.project_id, p.name AS project_name, d.summary
    FROM raw.documents d
    LEFT JOIN core.companies c ON c.id = d.company_id
    LEFT JOIN core.projects p ON p.id = d.project_id
    WHERE d.project_id = ${projectId}
    ORDER BY d.filed_at DESC NULLS LAST
  `;
  return [...rows];
}

export async function listScreener(filters: ScreenerFilters): Promise<ScreenerRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const commodity = active(filters.commodity);
  const country = active(filters.country);
  const stage = active(filters.stage);
  const studyType = active(filters.studyType);
  const minGradeKey = active(filters.minGradeKey);
  const minGrade = active(filters.minGrade);
  const minGradeNum = minGrade ? Number(minGrade) : null;
  const filedSince = active(filters.filedSince);
  const sortKey = active(filters.sort) ?? "tonnes";
  const dir = filters.dir === "asc" ? "asc" : "desc";

  try {
    const rows = await sql<ScreenerRow[]>`
    SELECT
      p.id, p.company_id, c.name AS company_name, p.name, p.country, p.region,
      p.commodities, p.stage, p.lat, p.lng,
      r.category AS resource_category, r.tonnes, r.grade,
      r.document_id AS resource_document_id, r.effective_date AS resource_date,
      e.study_type, e.irr_pct, e.capex_initial, e.npv, e.currency,
      e.document_id AS economics_document_id
    FROM core.projects p
    LEFT JOIN core.companies c ON c.id = p.company_id
    LEFT JOIN LATERAL (
      SELECT category, tonnes, grade, document_id, effective_date
      FROM core.resource_estimates re
      WHERE re.project_id = p.id
      ORDER BY re.effective_date DESC NULLS LAST, re.extraction_confidence DESC NULLS LAST
      LIMIT 1
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT study_type, irr_pct, capex_initial, npv, currency, document_id
      FROM core.project_economics pe
      WHERE pe.project_id = p.id
      ORDER BY pe.effective_date DESC NULLS LAST
      LIMIT 1
    ) e ON true
    WHERE (${commodity}::text IS NULL OR ${commodity} = ANY(p.commodities))
      AND (${country}::text IS NULL OR p.country ILIKE ${country})
      AND (${stage}::text IS NULL OR p.stage = ${stage})
      AND (${studyType}::text IS NULL OR e.study_type = ${studyType})
      AND (
        ${minGradeKey}::text IS NULL
        OR ${minGradeNum}::float8 IS NULL
        OR (r.grade ->> ${minGradeKey})::float8 >= ${minGradeNum}
      )
      AND (
        ${filedSince}::date IS NULL
        OR EXISTS (
          SELECT 1 FROM raw.documents d
          WHERE d.project_id = p.id AND d.filed_at >= ${filedSince}::date
        )
      )
    ORDER BY
      CASE WHEN ${sortKey} = 'irr_pct' AND ${dir} = 'desc' THEN e.irr_pct END DESC NULLS LAST,
      CASE WHEN ${sortKey} = 'irr_pct' AND ${dir} = 'asc' THEN e.irr_pct END ASC NULLS LAST,
      CASE WHEN ${sortKey} = 'resource_date' AND ${dir} = 'desc' THEN r.effective_date END DESC NULLS LAST,
      CASE WHEN ${sortKey} = 'resource_date' AND ${dir} = 'asc' THEN r.effective_date END ASC NULLS LAST,
      CASE WHEN ${sortKey} = 'name' AND ${dir} = 'desc' THEN p.name END DESC,
      CASE WHEN ${sortKey} = 'name' AND ${dir} = 'asc' THEN p.name END ASC,
      CASE WHEN ${sortKey} = 'tonnes' AND ${dir} = 'asc' THEN r.tonnes END ASC NULLS LAST,
      CASE WHEN ${sortKey} <> 'irr_pct' AND ${sortKey} <> 'resource_date' AND ${sortKey} <> 'name' AND ${dir} = 'asc' THEN NULL END,
      r.tonnes DESC NULLS LAST,
      p.name
    LIMIT ${LIST_LIMIT}
  `;
    return [...rows];
  } catch {
    return [];
  }
}

export async function listSavedFilters(userId: string): Promise<SavedFilter[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<{ id: string; name: string; criteria: unknown; created_at: string | Date }[]>`
    SELECT id, name, criteria, created_at
    FROM app.saved_filters
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    criteria: asFilters(row.criteria),
    created_at: row.created_at,
  }));
}

export async function listReviewQueue(): Promise<ReviewItem[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
  const resources = await sql<(ResourceRow & { project_name: string })[]>`
    SELECT r.*, p.name AS project_name
    FROM core.resource_estimates r
    JOIN core.projects p ON p.id = r.project_id
    WHERE r.reviewed = false
    ORDER BY r.extraction_confidence ASC NULLS FIRST
    LIMIT 100
  `;
  const economics = await sql<(EconomicsRow & { project_name: string })[]>`
    SELECT e.*, p.name AS project_name
    FROM core.project_economics e
    JOIN core.projects p ON p.id = e.project_id
    WHERE e.reviewed = false
    ORDER BY e.extraction_confidence ASC NULLS FIRST
    LIMIT 100
  `;
  const drills = await sql<(DrillRow & { project_name: string })[]>`
    SELECT d.*, p.name AS project_name
    FROM core.drill_results d
    JOIN core.projects p ON p.id = d.project_id
    WHERE d.reviewed = false
    ORDER BY d.extraction_confidence ASC NULLS FIRST
    LIMIT 100
  `;
  const items: ReviewItem[] = [
    ...resources.map((row) => ({
      kind: "resource" as const,
      id: row.id,
      project_id: row.project_id,
      project_name: row.project_name,
      document_id: row.document_id,
      extraction_confidence: row.extraction_confidence,
      reviewed: row.reviewed,
      label: `${row.category ?? "resource"} · ${row.tonnes ?? "?"} t`,
      payload: { ...row },
      attention: Number(row.extraction_confidence ?? 0) < LOW_CONFIDENCE_MAX,
    })),
    ...economics.map((row) => ({
      kind: "economics" as const,
      id: row.id,
      project_id: row.project_id,
      project_name: row.project_name,
      document_id: row.document_id,
      extraction_confidence: row.extraction_confidence,
      reviewed: row.reviewed,
      label: `${row.study_type ?? "study"} · IRR ${row.irr_pct ?? "—"}%`,
      payload: { ...row },
      attention: Number(row.extraction_confidence ?? 0) < LOW_CONFIDENCE_MAX,
    })),
    ...drills.map((row) => ({
      kind: "drill" as const,
      id: row.id,
      project_id: row.project_id,
      project_name: row.project_name,
      document_id: row.document_id,
      extraction_confidence: row.extraction_confidence,
      reviewed: row.reviewed,
      label: `${row.hole_id ?? "hole"} · ${row.interval_m ?? "—"} m`,
      payload: { ...row },
      attention: Number(row.extraction_confidence ?? 0) < LOW_CONFIDENCE_MAX,
    })),
  ];
  items.sort((a, b) => {
    const ac = Number(a.extraction_confidence ?? 1);
    const bc = Number(b.extraction_confidence ?? 1);
    return ac - bc;
  });
  return items;
  } catch {
    return [];
  }
}

export async function listUnresolvedFilings(): Promise<FilingRow[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = await sql<FilingRow[]>`
      SELECT d.id, d.title, d.doc_type, d.filed_at, d.status, d.company_id,
             c.name AS company_name, d.project_id, p.name AS project_name, d.summary
      FROM raw.documents d
      LEFT JOIN core.companies c ON c.id = d.company_id
      LEFT JOIN core.projects p ON p.id = d.project_id
      WHERE d.project_id IS NULL
      ORDER BY d.filed_at DESC NULLS LAST
      LIMIT 50
    `;
    return [...rows];
  } catch {
    return [];
  }
}

export async function listRecentFilings(): Promise<FilingRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<FilingRow[]>`
    SELECT d.id, d.title, d.doc_type, d.filed_at, d.status, d.company_id,
           c.name AS company_name, d.project_id, p.name AS project_name, d.summary
    FROM raw.documents d
    LEFT JOIN core.companies c ON c.id = d.company_id
    LEFT JOIN core.projects p ON p.id = d.project_id
    ORDER BY d.filed_at DESC NULLS LAST, d.created_at DESC
    LIMIT 50
  `;
  return [...rows];
}

export async function listDrillHighlights(): Promise<(DrillRow & { project_name: string })[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<(DrillRow & { project_name: string })[]>`
    SELECT d.*, p.name AS project_name
    FROM core.drill_results d
    JOIN core.projects p ON p.id = d.project_id
    ORDER BY d.announced_date DESC NULLS LAST, d.interval_m DESC NULLS LAST
    LIMIT 25
  `;
  return [...rows];
}

export async function researchAggregates(): Promise<{
  byStage: { stage: string | null; total: number }[];
  byCommodity: { commodity: string; total: number }[];
  byDocType: { doc_type: string | null; total: number }[];
}> {
  const sql = getSql();
  if (!sql) return { byStage: [], byCommodity: [], byDocType: [] };
  const [byStage, byCommodity, byDocType] = await Promise.all([
    sql<{ stage: string | null; total: number }[]>`
      SELECT stage, count(*)::int AS total
      FROM core.projects
      GROUP BY stage
      ORDER BY total DESC
    `,
    sql<{ commodity: string; total: number }[]>`
      SELECT unnest(commodities) AS commodity, count(*)::int AS total
      FROM core.projects
      WHERE commodities IS NOT NULL
      GROUP BY 1
      ORDER BY total DESC
      LIMIT 20
    `,
    sql<{ doc_type: string | null; total: number }[]>`
      SELECT doc_type, count(*)::int AS total
      FROM raw.documents
      GROUP BY doc_type
      ORDER BY total DESC
    `,
  ]);
  return { byStage: [...byStage], byCommodity: [...byCommodity], byDocType: [...byDocType] };
}

export async function listFilingsByMonth(): Promise<FilingsMonthRow[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = await sql<FilingsMonthRow[]>`
      SELECT to_char(date_trunc('month', filed_at), 'YYYY-MM') AS month,
             source,
             count(*)::int AS total
      FROM raw.documents
      WHERE filed_at IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;
    if (process.env.NODE_ENV !== "production") {
      console.debug("[research] filings by month", {
        monthCount: new Set(rows.map((row) => row.month)).size,
        rowCount: rows.length,
      });
    }
    return [...rows];
  } catch {
    return [];
  }
}

export async function listWatchlists(userId: string): Promise<WatchlistRecord[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<WatchlistRecord[]>`
    SELECT id, name, created_at, last_seen_at FROM app.watchlists
    WHERE user_id = ${userId}
    ORDER BY created_at
  `;
  return [...rows];
}

export async function listWatchlistItems(watchlistId: string): Promise<WatchlistItemRecord[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<WatchlistItemRecord[]>`
    SELECT i.id, i.watchlist_id, i.project_id, i.company_id,
           p.name AS project_name, c.name AS company_name
    FROM app.watchlist_items i
    LEFT JOIN core.projects p ON p.id = i.project_id
    LEFT JOIN core.companies c ON c.id = i.company_id
    WHERE i.watchlist_id = ${watchlistId}
    ORDER BY i.created_at DESC
  `;
  return [...rows];
}

export async function listWatchlistEvents(
  watchlistId: string,
  lastSeenAt?: string | Date | null,
): Promise<EventRow[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = await sql<(EventRow & { created_at: string | Date | null })[]>`
    SELECT e.id, e.project_id, p.name AS project_name, co.name AS company_name,
           e.document_id, e.event_type, e.event_date, e.summary, e.created_at
    FROM core.project_events e
    JOIN core.projects p ON p.id = e.project_id
    LEFT JOIN core.companies co ON co.id = p.company_id
    WHERE e.project_id IN (
      SELECT project_id FROM app.watchlist_items
      WHERE watchlist_id = ${watchlistId} AND project_id IS NOT NULL
    ) OR p.company_id IN (
      SELECT company_id FROM app.watchlist_items
      WHERE watchlist_id = ${watchlistId} AND company_id IS NOT NULL
    )
    ORDER BY e.event_date DESC NULLS LAST, e.id DESC
    LIMIT 100
  `;
    const seenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : null;
    return rows.map(({ created_at, ...event }) => ({
      ...event,
      isNew:
        seenMs != null &&
        created_at != null &&
        Number.isFinite(new Date(created_at).getTime()) &&
        new Date(created_at).getTime() > seenMs,
    }));
  } catch {
    return [];
  }
}

export async function ensureDefaultWatchlist(userId: string): Promise<WatchlistRecord> {
  const existing = await listWatchlists(userId);
  if (existing[0]) return existing[0];
  const sql = getSql();
  if (!sql) {
    throw new Error("Database is not configured.");
  }
  const rows = await sql<WatchlistRecord[]>`
    INSERT INTO app.watchlists (user_id, name)
    VALUES (${userId}, 'Default')
    RETURNING id, name, created_at, last_seen_at
  `;
  return rows[0];
}

export async function markWatchlistSeen(watchlistId: string, userId: string): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  try {
    await sql`
      UPDATE app.watchlists
         SET last_seen_at = now()
       WHERE id = ${watchlistId} AND user_id = ${userId}
    `;
  } catch {
    // Column missing until phase5 migration is applied.
  }
}

export async function extractionSpend(): Promise<{ daily: number; monthly: number; queue: number }> {
  const sql = getSql();
  if (!sql) return { daily: 0, monthly: 0, queue: 0 };
  try {
    const [daily, monthly, queue] = await Promise.all([
      sql<{ spent: string | number }[]>`
        SELECT COALESCE(sum(cost_usd), 0) AS spent
        FROM app.extraction_costs
        WHERE created_at >= date_trunc('day', now())
      `,
      sql<{ spent: string | number }[]>`
        SELECT COALESCE(sum(cost_usd), 0) AS spent
        FROM app.extraction_costs
        WHERE created_at >= date_trunc('month', now())
      `,
      sql<{ n: number }[]>`
        SELECT count(*)::int AS n
        FROM raw.processing_jobs
        WHERE job_type = 'extract' AND status = 'pending'
      `,
    ]);
    return {
      daily: Number(daily[0]?.spent ?? 0),
      monthly: Number(monthly[0]?.spent ?? 0),
      queue: queue[0]?.n ?? 0,
    };
  } catch {
    return { daily: 0, monthly: 0, queue: 0 };
  }
}

export async function screenerFacets(): Promise<{
  commodities: string[];
  countries: string[];
  stages: string[];
  studyTypes: string[];
}> {
  const sql = getSql();
  if (!sql) return { commodities: [], countries: [], stages: [], studyTypes: [] };
  const [commodities, countries, stages, studyTypes] = await Promise.all([
    sql<{ commodity: string }[]>`
      SELECT DISTINCT unnest(commodities) AS commodity
      FROM core.projects WHERE commodities IS NOT NULL ORDER BY 1
    `,
    sql<{ country: string }[]>`
      SELECT DISTINCT country FROM core.projects
      WHERE country IS NOT NULL ORDER BY 1
    `,
    sql<{ stage: string }[]>`
      SELECT DISTINCT stage FROM core.projects
      WHERE stage IS NOT NULL ORDER BY 1
    `,
    sql<{ study_type: string }[]>`
      SELECT DISTINCT study_type FROM core.project_economics
      WHERE study_type IS NOT NULL ORDER BY 1
    `,
  ]);
  return {
    commodities: commodities.map((r) => r.commodity),
    countries: countries.map((r) => r.country),
    stages: stages.map((r) => r.stage),
    studyTypes: studyTypes.map((r) => r.study_type),
  };
}

export async function listUnmatchedOccurrences(): Promise<GeoOccurrence[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = await sql<GeoOccurrence[]>`
      SELECT id, source, external_id, name, country, region, lat, lng, commodities
        FROM core.geo_occurrences
       WHERE project_id IS NULL
       ORDER BY name
       LIMIT 50
    `;
    return [...rows];
  } catch {
    return [];
  }
}
