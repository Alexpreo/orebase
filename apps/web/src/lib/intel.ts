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
import { changeForDocument, snapshot, type HistEconomics, type HistResource, type Snapshot } from "@/lib/history";

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
      (SELECT count(*)::int FROM raw.documents d WHERE d.company_id = c.id) AS document_count,
      (SELECT array_agg(DISTINCT x) FROM core.projects p, unnest(p.commodities) x
        WHERE p.company_id = c.id) AS commodities,
      (SELECT max(d.filed_at) FROM raw.documents d WHERE d.company_id = c.id) AS last_filed
    FROM core.companies c
    ORDER BY c.name
    LIMIT 2000
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

/** Resource rows (with filing dates) for many projects, grouped by project id. */
export async function listResourcesForProjects(ids: string[]): Promise<Map<string, HistResource[]>> {
  const out = new Map<string, HistResource[]>();
  const sql = getSql();
  if (!sql || ids.length === 0) return out;
  const rows = await sql<HistResource[]>`
    SELECT r.id, r.project_id, r.document_id, r.effective_date, r.category, r.domain, r.tonnes,
           r.grade, r.contained_metal, r.cutoff, r.standard, r.extraction_confidence, r.reviewed,
           d.filed_at
    FROM core.resource_estimates r
    LEFT JOIN raw.documents d ON d.id = r.document_id
    WHERE r.project_id = ANY(${ids}::uuid[])
  `;
  for (const r of rows) out.set(r.project_id, [...(out.get(r.project_id) ?? []), r]);
  return out;
}

/** Latest estimate, latest study and last change for each project (cards, watchlist). */
export async function projectSnapshots(ids: string[]): Promise<Map<string, Snapshot>> {
  const out = new Map<string, Snapshot>();
  const sql = getSql();
  if (!sql || ids.length === 0) return out;
  try {
    const [resources, econ] = await Promise.all([
      listResourcesForProjects(ids),
      sql<HistEconomics[]>`
        SELECT e.id, e.project_id, e.document_id, e.study_type, e.effective_date, e.currency, e.npv,
               e.irr_pct, e.capex_initial, e.aisc, e.mine_life_years, e.payback_years,
               e.metal_price_assumptions, e.extraction_confidence, e.reviewed, d.filed_at
        FROM core.project_economics e
        LEFT JOIN raw.documents d ON d.id = e.document_id
        WHERE e.project_id = ANY(${ids}::uuid[])
      `,
    ]);
    const econBy = new Map<string, HistEconomics[]>();
    for (const e of econ) econBy.set(e.project_id, [...(econBy.get(e.project_id) ?? []), e]);
    for (const id of ids) out.set(id, snapshot(resources.get(id) ?? [], econBy.get(id) ?? []));
  } catch {
    // Figures are an enhancement; cards still render without them.
  }
  return out;
}

/** Adds "M&I +12% tonnes vs the 2024 estimate" to events whose filing carried a new estimate. */
async function withChange<T extends EventRow>(events: T[]): Promise<T[]> {
  try {
    const byProject = await listResourcesForProjects([...new Set(events.map((e) => e.project_id))]);
    return events.map((e) => ({
      ...e,
      change: e.document_id ? changeForDocument(byProject.get(e.project_id) ?? [], e.document_id) : null,
    }));
  } catch {
    return events;
  }
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
    SELECT r.id, r.project_id, r.document_id, r.effective_date, r.category, r.domain, r.tonnes,
           r.grade, r.contained_metal, r.cutoff, r.standard, r.extraction_confidence, r.reviewed,
           r.review_source, d.filed_at
    FROM core.resource_estimates r
    LEFT JOIN raw.documents d ON d.id = r.document_id
    WHERE r.project_id = ${projectId}
    ORDER BY r.effective_date DESC NULLS LAST, r.category, r.domain NULLS FIRST
  `;
  return [...rows];
}

export async function listProjectEconomics(projectId: string): Promise<EconomicsRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<EconomicsRow[]>`
    SELECT e.id, e.project_id, e.document_id, e.study_type, e.effective_date, e.currency, e.npv,
           e.irr_pct, e.capex_initial, e.aisc, e.mine_life_years, e.payback_years,
           e.metal_price_assumptions, e.extraction_confidence, e.reviewed, e.review_source,
           d.filed_at
    FROM core.project_economics e
    LEFT JOIN raw.documents d ON d.id = e.document_id
    WHERE e.project_id = ${projectId}
    ORDER BY e.effective_date DESC NULLS LAST
  `;
  return [...rows];
}

export async function listProjectDrills(projectId: string): Promise<DrillRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<DrillRow[]>`
    SELECT id, project_id, document_id, hole_id, announced_date, from_m, to_m, interval_m,
           assays, true_width_noted, extraction_confidence, reviewed
    FROM core.drill_results
    WHERE project_id = ${projectId}
    ORDER BY announced_date DESC NULLS LAST, hole_id, from_m
    LIMIT 300
  `;
  return [...rows];
}

/** What was extracted from one filing, for the document page. */
export async function listDocumentFacts(documentId: string): Promise<{
  resources: ResourceRow[];
  economics: EconomicsRow[];
  drills: DrillRow[];
}> {
  const sql = getSql();
  if (!sql) return { resources: [], economics: [], drills: [] };
  const [resources, economics, drills] = await Promise.all([
    sql<ResourceRow[]>`
      SELECT id, project_id, document_id, effective_date, category, domain, tonnes, grade,
             contained_metal, cutoff, standard, extraction_confidence, reviewed, review_source
      FROM core.resource_estimates WHERE document_id = ${documentId}
      ORDER BY category, domain NULLS FIRST`,
    sql<EconomicsRow[]>`
      SELECT id, project_id, document_id, study_type, effective_date, currency, npv, irr_pct,
             capex_initial, aisc, mine_life_years, payback_years, metal_price_assumptions,
             extraction_confidence, reviewed, review_source
      FROM core.project_economics WHERE document_id = ${documentId}`,
    sql<DrillRow[]>`
      SELECT id, project_id, document_id, hole_id, announced_date, from_m, to_m, interval_m,
             assays, true_width_noted, extraction_confidence, reviewed
      FROM core.drill_results WHERE document_id = ${documentId}
      ORDER BY hole_id, from_m LIMIT 300`,
  ]);
  return { resources: [...resources], economics: [...economics], drills: [...drills] };
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
  return withChange([...rows]);
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
  return withChange([...rows]);
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
    return withChange(rows.map(({ created_at, ...event }) => ({
      ...event,
      isNew:
        seenMs != null &&
        created_at != null &&
        Number.isFinite(new Date(created_at).getTime()) &&
        new Date(created_at).getTime() > seenMs,
    })));
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

type ExtractionSpend = { daily: number; monthly: number; queue: number; dailyAlert: number };

export async function extractionSpend(): Promise<ExtractionSpend> {
  // Mirrors the worker's EXTRACTION_DAILY_ALERT_USD; the alert never halts extraction.
  const dailyAlert = Number(process.env.EXTRACTION_DAILY_ALERT_USD ?? 15);
  const sql = getSql();
  if (!sql) return { daily: 0, monthly: 0, queue: 0, dailyAlert };
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
      dailyAlert,
    };
  } catch {
    return { daily: 0, monthly: 0, queue: 0, dailyAlert };
  }
}

export async function screenerFacets(): Promise<{
  commodities: string[];
  countries: string[];
  stages: string[];
  studyTypes: string[];
  gradeKeys: string[];
}> {
  const sql = getSql();
  if (!sql) return { commodities: [], countries: [], stages: [], studyTypes: [], gradeKeys: [] };
  const [commodities, countries, stages, studyTypes, gradeKeys] = await Promise.all([
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
    sql<{ key: string }[]>`
      SELECT key FROM core.resource_estimates, jsonb_object_keys(grade) AS key
      GROUP BY key HAVING count(*) >= 5 ORDER BY count(*) DESC LIMIT 40
    `,
  ]);
  return {
    commodities: commodities.map((r) => r.commodity),
    countries: countries.map((r) => r.country),
    stages: stages.map((r) => r.stage),
    studyTypes: studyTypes.map((r) => r.study_type),
    gradeKeys: gradeKeys.map((r) => r.key),
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

export type CorpusCounts = {
  documents: number;
  companies: number;
  projects: number;
  resources: number;
  drills: number;
};

export async function corpusCounts(): Promise<CorpusCounts> {
  const sql = getSql();
  const empty = { documents: 0, companies: 0, projects: 0, resources: 0, drills: 0 };
  if (!sql) return empty;
  const rows = await sql<CorpusCounts[]>`
    SELECT (SELECT count(*) FROM raw.documents)::int AS documents,
           (SELECT count(*) FROM core.companies)::int AS companies,
           (SELECT count(*) FROM core.projects)::int AS projects,
           (SELECT count(*) FROM core.resource_estimates)::int AS resources,
           (SELECT count(*) FROM core.drill_results)::int AS drills
  `;
  return rows[0] ?? empty;
}

export async function listRecentEvents(eventType: string | null, limit = 8): Promise<EventRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<EventRow[]>`
    SELECT e.id, e.project_id, p.name AS project_name, co.name AS company_name,
           e.document_id, e.event_type, e.event_date, e.summary
    FROM core.project_events e
    JOIN core.projects p ON p.id = e.project_id
    LEFT JOIN core.companies co ON co.id = p.company_id
    WHERE ${eventType}::text IS NULL OR e.event_type = ${eventType}
    ORDER BY e.event_date DESC NULLS LAST, e.created_at DESC
    LIMIT ${limit}
  `;
  return [...rows];
}

// Technical-report doc types (excludes press releases, MD&A, financials).
const REPORT_TYPES = ["ni43101", "sk1300", "pea", "pfs", "fs"];

export type BriefingData = {
  /** Oldest → newest; week_start is a Monday (ISO date). */
  pulse: { week_start: string; sedar: number; edgar: number }[];
  /** Oldest → newest, one entry per day for the last 7 days including today. */
  last7: { day: string; n: number }[];
  prior7: number;
  resources: { total: number; avg_confidence: number | null; unreviewed: number };
};

export async function homeBriefing(): Promise<BriefingData> {
  const empty: BriefingData = {
    pulse: [],
    last7: [],
    prior7: 0,
    resources: { total: 0, avg_confidence: null, unreviewed: 0 },
  };
  const sql = getSql();
  if (!sql) return empty;
  try {
    const [pulse, last7, prior, resources] = await Promise.all([
      sql<{ week_start: string; sedar: number; edgar: number }[]>`
        SELECT to_char(w, 'YYYY-MM-DD') AS week_start,
               count(d.id) FILTER (WHERE d.source = 'sedar')::int AS sedar,
               count(d.id) FILTER (WHERE d.source = 'edgar')::int AS edgar
        FROM generate_series(date_trunc('week', now()) - interval '11 weeks',
                             date_trunc('week', now()), interval '1 week') AS w
        LEFT JOIN raw.documents d
          ON d.filed_at >= w AND d.filed_at < w + interval '1 week'
         AND d.doc_type = ANY(${REPORT_TYPES})
        GROUP BY w ORDER BY w
      `,
      sql<{ day: string; n: number }[]>`
        SELECT to_char(g, 'YYYY-MM-DD') AS day, count(d.id)::int AS n
        FROM generate_series(current_date - 6, current_date, interval '1 day') AS g
        LEFT JOIN raw.documents d
          ON d.filed_at::date = g::date AND d.doc_type = ANY(${REPORT_TYPES})
        GROUP BY g ORDER BY g
      `,
      sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM raw.documents
        WHERE doc_type = ANY(${REPORT_TYPES})
          AND filed_at >= current_date - 13 AND filed_at < current_date - 6
      `,
      sql<{ total: number; avg_confidence: string | null; unreviewed: number }[]>`
        SELECT count(*)::int AS total,
               avg(extraction_confidence) AS avg_confidence,
               count(*) FILTER (WHERE reviewed = false)::int AS unreviewed
        FROM core.resource_estimates
      `,
    ]);
    const r = resources[0];
    return {
      pulse: [...pulse],
      last7: [...last7],
      prior7: prior[0]?.n ?? 0,
      resources: {
        total: r?.total ?? 0,
        avg_confidence: r?.avg_confidence == null ? null : Number(r.avg_confidence),
        unreviewed: r?.unreviewed ?? 0,
      },
    };
  } catch {
    return empty;
  }
}

export type HomeFiling = FilingRow & { source: string | null; region: string | null; country: string | null };

export async function listLatestReports(limit = 7): Promise<HomeFiling[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = await sql<HomeFiling[]>`
      SELECT d.id, d.title, d.doc_type, d.filed_at, d.status, d.source, d.company_id,
             c.name AS company_name, d.project_id, p.name AS project_name, d.summary,
             p.region, p.country
      FROM raw.documents d
      LEFT JOIN core.companies c ON c.id = d.company_id
      LEFT JOIN core.projects p ON p.id = d.project_id
      WHERE d.doc_type = ANY(${REPORT_TYPES})
      ORDER BY d.filed_at DESC NULLS LAST, d.created_at DESC
      LIMIT ${limit}
    `;
    return [...rows];
  } catch {
    return [];
  }
}

/** Unreviewed extracted rows across resources, economics and drills (sidebar badge). */
export async function reviewQueueCount(): Promise<number> {
  const sql = getSql();
  if (!sql) return 0;
  try {
    const rows = await sql<{ n: number }[]>`
      SELECT ((SELECT count(*) FROM core.resource_estimates WHERE reviewed = false)
            + (SELECT count(*) FROM core.project_economics WHERE reviewed = false)
            + (SELECT count(*) FROM core.drill_results WHERE reviewed = false))::int AS n
    `;
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Mirrors the worker's EXTRACTION_MONTHLY_CAP_USD default (workers/common/config.py). */
export function extractionMonthlyCap(): number {
  const cap = Number(process.env.EXTRACTION_MONTHLY_CAP_USD ?? 80);
  return Number.isFinite(cap) && cap > 0 ? cap : 80;
}
