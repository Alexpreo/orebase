// Change over time for one project: group resource rows into estimates, total them by
// category, and diff consecutive estimates and studies. Pure functions, no DB.
import type { EconomicsRow, ResourceRow } from "./intel-types.ts";
import { pickNpv } from "./utils.ts";

type Dated = { filed_at?: string | Date | null };
export type HistResource = ResourceRow & Dated;
export type HistEconomics = EconomicsRow & Dated;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
};
const iso = (v: string | Date | null | undefined): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

export type Estimate = {
  date: string;
  documentId: string | null;
  /** Other filings that restate the same estimate (same effective date). */
  alsoIn: number;
  rows: HistResource[];
};

/**
 * One estimate per effective date (filing date when the effective date is missing).
 * A date filed in several documents is a refiling: keep the document with the most rows,
 * so totals are not double counted. Oldest first.
 */
export function groupEstimates(rows: HistResource[]): Estimate[] {
  const byDate = new Map<string, Map<string, HistResource[]>>();
  for (const r of rows) {
    const date = iso(r.effective_date) ?? iso(r.filed_at);
    if (!date) continue;
    const docs = byDate.get(date) ?? new Map<string, HistResource[]>();
    const doc = r.document_id ?? "none";
    docs.set(doc, [...(docs.get(doc) ?? []), r]);
    byDate.set(date, docs);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, docs]) => {
      const [docId, docRows] = [...docs.entries()].sort(
        ([, a], [, b]) => b.length - a.length || (iso(b[0].filed_at) ?? "").localeCompare(iso(a[0].filed_at) ?? ""),
      )[0];
      return { date, documentId: docId === "none" ? null : docId, alsoIn: docs.size - 1, rows: docRows };
    });
}

export type Group = "mi" | "inferred" | "reserves";
export const GROUP_LABEL: Record<Group, string> = {
  mi: "Measured & Indicated",
  inferred: "Inferred",
  reserves: "Reserves (P&P)",
};

/** Rows that make up a category group, without counting a combined row and its parts twice. */
function groupRows(rows: HistResource[], group: Group): HistResource[] {
  const pick = (combined: string, parts: string[]) => {
    const c = rows.filter((r) => r.category === combined);
    return c.length ? c : rows.filter((r) => parts.includes(r.category ?? ""));
  };
  const chosen =
    group === "mi" ? pick("measured+indicated", ["measured", "indicated"])
    : group === "reserves" ? pick("2p", ["proven", "probable"])
    : rows.filter((r) => r.category === "inferred");
  // A report-wide total row ("Total", "Grand total", "Santa Cruz - Total") beats summing its zones;
  // a zone subtotal like "COP DF total" does not.
  const totals = chosen.filter((r) => /^(grand |overall |project )?total\b|[-–—:]\s*total$/i.test((r.domain ?? "").trim()));
  return totals.length && totals.length < chosen.length ? totals : chosen;
}

export type Totals = {
  tonnes: number;
  /** Tonnage-weighted grade per grade key, e.g. { Au_gpt: 1.2 }. */
  grades: Record<string, number>;
  rowCount: number;
};

export function categoryTotals(rows: HistResource[], group: Group): Totals | null {
  const picked = groupRows(rows, group);
  let tonnes = 0;
  const gt: Record<string, number> = {};
  const gtTonnes: Record<string, number> = {};
  for (const r of picked) {
    const t = num(r.tonnes);
    if (t === null || t <= 0) continue;
    tonnes += t;
    for (const [k, g] of Object.entries(r.grade ?? {})) {
      const gv = num(g);
      if (gv === null) continue;
      gt[k] = (gt[k] ?? 0) + gv * t;
      gtTonnes[k] = (gtTonnes[k] ?? 0) + t;
    }
  }
  if (tonnes === 0) return null;
  const grades: Record<string, number> = {};
  for (const k of Object.keys(gt)) grades[k] = gt[k] / gtTonnes[k];
  return { tonnes, grades, rowCount: picked.length };
}

/** Contained metal from tonnes x grade: g/t and ppm -> troy oz, % -> tonnes. */
export function containedFromGrade(tonnes: number, key: string, grade: number): { value: number; unit: "oz" | "t" } | null {
  const unit = key.slice(key.lastIndexOf("_") + 1);
  if (unit === "gpt" || unit === "ppm") return { value: (tonnes * grade) / 31.1035, unit: "oz" };
  if (unit === "pct") return { value: (tonnes * grade) / 100, unit: "t" };
  return null;
}

/** The grade key to chart: the most common one, skipping equivalents and acid-soluble splits. */
export function primaryGradeKey(rows: HistResource[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows)
    for (const k of Object.keys(r.grade ?? {}))
      if (!/Eq_|^AS/.test(k) && containedFromGrade(1, k, 1)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Percent change, or null when there is no base to compare against. */
export function pctChange(prev: number | null | undefined, next: number | null | undefined): number | null {
  if (prev == null || next == null || prev === 0) return null;
  return ((next - prev) / Math.abs(prev)) * 100;
}

/** Zone names as filed vary ("Konkola Mine, exclusive reserves" vs "Konkola UG"); match loosely. */
export function zoneKey(domain: string | null | undefined): string {
  return (domain ?? "total")
    .toLowerCase()
    .replace(/\b(mine|tailings|complex|dam|deposit|project|the|of|underground|ug|open pit|op|inclusive|exclusive|reserves?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim() || "total";
}

export type ZoneRow = { group: Group; label: string; cells: (HistResource | null)[] };

/** Zone x estimate matrix for one category group; one row per loosely matched zone name. */
export function zoneMatrix(estimates: Estimate[], group: Group): ZoneRow[] {
  const rows = new Map<string, ZoneRow>();
  estimates.forEach((est, i) => {
    for (const r of groupRows(est.rows, group)) {
      const key = zoneKey(r.domain);
      const row = rows.get(key) ?? { group, label: r.domain ?? "Total", cells: estimates.map(() => null) };
      if (!row.cells[i]) row.cells[i] = r;
      row.label = r.domain ?? row.label;
      rows.set(key, row);
    }
  });
  return [...rows.values()];
}

export type Study = {
  row: HistEconomics;
  date: string | null;
  npv: ReturnType<typeof pickNpv>;
};

/** One study per filing, oldest first; restated studies (same type and date) collapse to one. */
export function economicsProgression(rows: HistEconomics[]): Study[] {
  const seen = new Set<string>();
  return rows
    .map((row) => ({ row, date: iso(row.effective_date) ?? iso(row.filed_at), npv: pickNpv(row.npv) }))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    // A study with no usable figure says nothing; skip it rather than show a column of dashes.
    .filter((s) => s.npv || [s.row.irr_pct, s.row.capex_initial, s.row.mine_life_years].some((v) => v != null))
    .filter((s) => {
      const k = `${s.row.study_type}|${s.date}|${s.npv?.value ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** NPVs are only comparable on the same basis (tax, discount rate) and currency. */
export function npvComparable(a: Study, b: Study): boolean {
  return !!a.npv && !!b.npv && a.npv.key === b.npv.key && a.row.currency === b.row.currency;
}

/** "M&I +12% tonnes, Au −0.03 g/t" for event lines; null when there is nothing to compare. */
export function changeLine(prev: Estimate, next: Estimate): string | null {
  const parts: string[] = [];
  for (const g of ["mi", "inferred"] as Group[]) {
    const a = categoryTotals(prev.rows, g);
    const b = categoryTotals(next.rows, g);
    if (!a || !b) continue;
    const p = pctChange(a.tonnes, b.tonnes);
    if (p === null) continue;
    const name = g === "mi" ? "M&I" : "Inferred";
    parts.push(Math.abs(p) < 0.5 ? `${name} tonnes unchanged` : `${name} ${p > 0 ? "+" : "−"}${Math.abs(p).toFixed(0)}% tonnes`);
  }
  return parts.length ? `${parts.join(", ")} vs the ${prev.date.slice(0, 4)} estimate` : null;
}

/** Change line for the estimate a given filing reported, against the estimate before it. */
export function changeForDocument(rows: HistResource[], documentId: string): string | null {
  const own = rows.find((r) => r.document_id === documentId);
  if (!own) return null;
  const date = iso(own.effective_date) ?? iso(own.filed_at);
  const est = groupEstimates(rows);
  const i = est.findIndex((e) => e.date === date);
  return i > 0 ? changeLine(est[i - 1], est[i]) : null;
}

/** Change between the two most recent estimates, or null with fewer than two. */
export function latestChange(rows: HistResource[]): string | null {
  const est = groupEstimates(rows);
  return est.length > 1 ? changeLine(est[est.length - 2], est[est.length - 1]) : null;
}

export type Snapshot = {
  date: string | null;
  mi: Totals | null;
  inferred: Totals | null;
  gradeKey: string | null;
  study: Study | null;
  change: string | null;
};

/** The figures a project card or watchlist row shows: latest estimate, latest study, last change. */
export function snapshot(resources: HistResource[], economics: HistEconomics[]): Snapshot {
  const est = groupEstimates(resources);
  const latest = est[est.length - 1];
  const studies = economicsProgression(economics);
  return {
    date: latest?.date ?? null,
    mi: latest ? categoryTotals(latest.rows, "mi") : null,
    inferred: latest ? categoryTotals(latest.rows, "inferred") : null,
    gradeKey: primaryGradeKey(resources),
    study: studies[studies.length - 1] ?? null,
    change: est.length > 1 ? changeLine(est[est.length - 2], latest) : null,
  };
}
