import "server-only";
import { getSql } from "@/lib/db";
import {
  categoryTotals,
  economicsProgression,
  estimateDelta,
  groupEstimates,
  type EstimateDelta,
  type Totals,
  type HistEconomics,
  type Study,
} from "@/lib/history";
import { listResourcesForProjects } from "@/lib/intel";
import type { DrillRow } from "@/lib/intel-types";

/** Commodity switch options: code as stored in core.projects.commodities, label, drill ranking key. */
export const COMMODITIES = [
  { code: "Au", label: "Gold", key: "Au_gpt" },
  { code: "Cu", label: "Copper", key: "Cu_pct" },
  { code: "Ag", label: "Silver", key: "Ag_gpt" },
  { code: "Li", label: "Lithium", key: "Li2O_pct" },
  { code: "U3O8", label: "Uranium", key: "U3O8_pct" },
  { code: "Ni", label: "Nickel", key: "Ni_pct" },
  { code: "Zn", label: "Zinc", key: "Zn_pct" },
] as const;

export type CommodityCode = (typeof COMMODITIES)[number]["code"];

export function parseCommodity(value: string | null | undefined): CommodityCode | null {
  return COMMODITIES.find((c) => c.code === value)?.code ?? null;
}

const REPORT_TYPES = ["ni43101", "sk1300", "jorc", "pea", "pfs", "fs"];

export type DashboardCounts = { reports7d: number; studies90d: number; resourceUpdates90d: number };

export async function dashboardCounts(c: CommodityCode | null): Promise<DashboardCounts> {
  const sql = getSql();
  const empty = { reports7d: 0, studies90d: 0, resourceUpdates90d: 0 };
  if (!sql) return empty;
  try {
    const [row] = await sql<DashboardCounts[]>`
      SELECT
        (SELECT count(*)::int FROM raw.documents d LEFT JOIN core.projects p ON p.id = d.project_id
          WHERE d.doc_type = ANY(${REPORT_TYPES}) AND d.filed_at >= current_date - 6
            AND (${c}::text IS NULL OR ${c} = ANY(p.commodities))) AS "reports7d",
        (SELECT count(DISTINCT e.document_id)::int FROM core.project_economics e
          JOIN raw.documents d ON d.id = e.document_id JOIN core.projects p ON p.id = e.project_id
          WHERE d.filed_at >= current_date - 90 AND (e.irr_pct IS NOT NULL OR e.npv <> '{}'::jsonb)
            AND (${c}::text IS NULL OR ${c} = ANY(p.commodities))) AS "studies90d",
        (SELECT count(DISTINCT r.document_id)::int FROM core.resource_estimates r
          JOIN raw.documents d ON d.id = r.document_id JOIN core.projects p ON p.id = r.project_id
          WHERE d.filed_at >= current_date - 90
            AND (${c}::text IS NULL OR ${c} = ANY(p.commodities))) AS "resourceUpdates90d"
    `;
    return row ?? empty;
  } catch {
    return empty;
  }
}

type ProjectRef = { project_id: string; project_name: string; company_name: string | null };

export type Mover = ProjectRef & {
  document_id: string;
  date: string;
  /** null: first estimate on file, so there is nothing to compare against. */
  prevDate: string | null;
  delta: EstimateDelta | null;
  mi: Totals | null;
  inferred: Totals | null;
};

/** Reports filed in the window whose estimate has a predecessor, biggest real moves first. */
export async function resourceMovers(c: CommodityCode | null, days = 90, limit = 8): Promise<Mover[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const docs = await sql<(ProjectRef & { document_id: string })[]>`
      SELECT DISTINCT r.document_id, r.project_id, p.name AS project_name, co.name AS company_name
      FROM core.resource_estimates r
      JOIN raw.documents d ON d.id = r.document_id
      JOIN core.projects p ON p.id = r.project_id
      LEFT JOIN core.companies co ON co.id = p.company_id
      WHERE d.filed_at >= current_date - ${days}::int
        AND (${c}::text IS NULL OR ${c} = ANY(p.commodities))
    `;
    const rows = await listResourcesForProjects([...new Set(docs.map((d) => d.project_id))]);
    const seen = new Set<string>();
    const movers: Mover[] = [];
    for (const doc of docs) {
      const est = groupEstimates(rows.get(doc.project_id) ?? []);
      const i = est.findIndex((e) => e.rows.some((r) => r.document_id === doc.document_id));
      // Refilings of one estimate land on the same entry; show each estimate once.
      if (i < 0 || seen.has(`${doc.project_id}|${est[i].date}`)) continue;
      seen.add(`${doc.project_id}|${est[i].date}`);
      let delta: EstimateDelta | null = i > 0 ? estimateDelta(est[i - 1], est[i]) : null;
      if (delta && delta.miPct === null && delta.infPct === null && delta.metalPct === null) delta = null;
      const mi = categoryTotals(est[i].rows, "mi");
      const inferred = categoryTotals(est[i].rows, "inferred");
      if (!delta && !mi && !inferred) continue;
      movers.push({ ...doc, date: est[i].date, prevDate: delta ? est[i - 1].date : null, delta, mi, inferred });
    }
    // Real changes first (biggest move first), then scope changes, then first estimates (newest first).
    const rank = (m: Mover) => (!m.delta ? 2 : m.delta.scopeChange ? 1 : 0);
    const size = (d: EstimateDelta | null) =>
      d ? Math.max(...[d.metalPct, d.miPct, d.infPct].map((p) => Math.abs(p ?? 0))) : 0;
    const newest = new Map<string, Mover>();
    for (const m of movers) if (!newest.has(m.project_id) || m.date > newest.get(m.project_id)!.date) newest.set(m.project_id, m);
    return [...newest.values()]
      .sort((a, b) => rank(a) - rank(b) || size(b.delta) - size(a.delta) || b.date.localeCompare(a.date))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export type NewStudy = ProjectRef & { filed_at: string | Date | null; study: Study; previous: Study | null };

/** Studies with figures filed in the window, newest first, each with the project's previous study. */
export async function newStudies(c: CommodityCode | null, days = 90, limit = 10): Promise<NewStudy[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = await sql<(HistEconomics & ProjectRef & { recent: boolean })[]>`
      SELECT e.id, e.project_id, e.document_id, e.study_type, e.effective_date, e.currency, e.npv,
             e.irr_pct, e.capex_initial, e.aisc, e.mine_life_years, e.payback_years,
             e.metal_price_assumptions, e.extraction_confidence, e.reviewed, d.filed_at,
             p.name AS project_name, co.name AS company_name,
             (d.filed_at >= current_date - ${days}::int) AS recent
      FROM core.project_economics e
      JOIN raw.documents d ON d.id = e.document_id
      JOIN core.projects p ON p.id = e.project_id
      LEFT JOIN core.companies co ON co.id = p.company_id
      WHERE e.project_id IN (
        SELECT e2.project_id FROM core.project_economics e2
        JOIN raw.documents d2 ON d2.id = e2.document_id
        WHERE d2.filed_at >= current_date - ${days}::int
      )
      AND (${c}::text IS NULL OR ${c} = ANY(p.commodities))
    `;
    const byProject = new Map<string, typeof rows[number][]>();
    for (const r of rows) byProject.set(r.project_id, [...(byProject.get(r.project_id) ?? []), r]);
    const out: NewStudy[] = [];
    // A filing often reports several cases (base, spot price, alternative plans). Keep one per
    // filing: the case with the most figures, ties to the first listed. Compare only across filings.
    const filled = (s: Study) =>
      [s.npv, s.row.irr_pct, s.row.capex_initial, s.row.mine_life_years, s.row.payback_years].filter((v) => v != null).length;
    for (const list of byProject.values()) {
      const perDoc = new Map<string, Study>();
      for (const s of economicsProgression(list)) {
        const doc = s.row.document_id ?? s.row.id;
        const kept = perDoc.get(doc);
        if (!kept || filled(s) > filled(kept)) perDoc.set(doc, s);
      }
      const studies = [...perDoc.values()].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
      const i = studies.length - 1;
      const latest = studies[i];
      const row = latest?.row as (typeof list)[number] | undefined;
      if (!row?.recent) continue;
      out.push({
        project_id: row.project_id,
        project_name: row.project_name,
        company_name: row.company_name,
        filed_at: row.filed_at ?? null,
        study: latest,
        previous: i > 0 ? studies[i - 1] : null,
      });
    }
    const t = (v: string | Date | null) => (v ? new Date(v).getTime() : 0);
    return out.sort((a, b) => t(b.filed_at) - t(a.filed_at)).slice(0, limit);
  } catch {
    return [];
  }
}

export type InterceptRow = DrillRow & { project_name: string; company_name: string | null };

/** Drill rows filed in the window; ranking happens in the component (rankIntercepts). */
export async function recentIntercepts(c: CommodityCode | null, days = 30): Promise<InterceptRow[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = await sql<InterceptRow[]>`
      SELECT r.id, r.project_id, r.document_id, r.hole_id, r.announced_date, r.from_m, r.to_m,
             r.interval_m, r.assays, r.true_width_noted, r.extraction_confidence, r.reviewed,
             p.name AS project_name, co.name AS company_name
      FROM core.drill_results r
      JOIN raw.documents d ON d.id = r.document_id
      JOIN core.projects p ON p.id = r.project_id
      LEFT JOIN core.companies co ON co.id = p.company_id
      WHERE d.filed_at >= current_date - ${days}::int
        AND (${c}::text IS NULL OR ${c} = ANY(p.commodities))
      LIMIT 5000
    `;
    return [...rows];
  } catch {
    return [];
  }
}

export type PipelineBar = { label: string; value: number; href: string };
export type Pipeline = { breakdown: PipelineBar[]; breakdownBy: "commodity" | "country"; stages: PipelineBar[] };

/** New technical filings in the window by commodity (or by country when a commodity is picked), plus stage mix. */
export async function pipeline(c: CommodityCode | null, days = 90): Promise<Pipeline> {
  const sql = getSql();
  const breakdownBy = c ? "country" : "commodity";
  if (!sql) return { breakdown: [], breakdownBy, stages: [] };
  try {
    const [breakdown, stages] = await Promise.all([
      c
        ? sql<{ label: string; value: number }[]>`
            SELECT p.country AS label, count(*)::int AS value
            FROM raw.documents d JOIN core.projects p ON p.id = d.project_id
            WHERE d.filed_at >= current_date - ${days}::int AND d.doc_type = ANY(${REPORT_TYPES})
              AND ${c} = ANY(p.commodities) AND p.country IS NOT NULL
            GROUP BY 1 ORDER BY 2 DESC LIMIT 8`
        : sql<{ label: string; value: number }[]>`
            SELECT x AS label, count(*)::int AS value
            FROM raw.documents d JOIN core.projects p ON p.id = d.project_id, unnest(p.commodities) x
            WHERE d.filed_at >= current_date - ${days}::int AND d.doc_type = ANY(${REPORT_TYPES})
            GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
      sql<{ label: string; value: number }[]>`
        SELECT p.stage AS label, count(DISTINCT p.id)::int AS value
        FROM raw.documents d JOIN core.projects p ON p.id = d.project_id
        WHERE d.filed_at >= current_date - ${days}::int AND p.stage IS NOT NULL
          AND (${c}::text IS NULL OR ${c} = ANY(p.commodities))
        GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    ]);
    const q = (k: string, v: string) => `/screener?${k}=${encodeURIComponent(v)}${c && k !== "commodity" ? `&commodity=${c}` : ""}`;
    return {
      breakdownBy,
      breakdown: breakdown.map((b) => ({ ...b, href: q(c ? "country" : "commodity", b.label) })),
      stages: stages.map((s) => ({ ...s, href: q("stage", s.label) })),
    };
  } catch {
    return { breakdown: [], breakdownBy, stages: [] };
  }
}
