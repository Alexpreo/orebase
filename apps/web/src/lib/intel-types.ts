export type JsonMap = Record<string, number>;

export type CompanyListItem = {
  id: string;
  name: string;
  cik: string | null;
  tickers: unknown;
  hq_country: string | null;
  project_count: number;
  document_count: number;
};

export type CompanyDetail = {
  id: string;
  name: string;
  cik: string | null;
  tickers: unknown;
  hq_country: string | null;
  website: string | null;
  sedar_profile: string | null;
};

export type ProjectSummary = {
  id: string;
  company_id: string | null;
  company_name: string | null;
  name: string;
  country: string | null;
  region: string | null;
  commodities: string[] | null;
  stage: string | null;
  lat: number | string | null;
  lng: number | string | null;
};

export type ResourceRow = {
  id: string;
  project_id: string;
  document_id: string | null;
  effective_date: string | Date | null;
  category: string | null;
  tonnes: number | string | null;
  grade: JsonMap | null;
  contained_metal: JsonMap | null;
  cutoff: string | null;
  standard: string | null;
  extraction_confidence: number | string | null;
  reviewed: boolean;
};

export type EconomicsRow = {
  id: string;
  project_id: string;
  document_id: string | null;
  study_type: string | null;
  effective_date: string | Date | null;
  currency: string | null;
  npv: JsonMap | null;
  irr_pct: number | string | null;
  capex_initial: number | string | null;
  aisc: JsonMap | null;
  mine_life_years: number | string | null;
  payback_years: number | string | null;
  metal_price_assumptions: JsonMap | null;
  extraction_confidence: number | string | null;
  reviewed: boolean;
};

export type DrillRow = {
  id: string;
  project_id: string;
  document_id: string | null;
  hole_id: string | null;
  announced_date: string | Date | null;
  from_m: number | string | null;
  to_m: number | string | null;
  interval_m: number | string | null;
  assays: JsonMap | null;
  true_width_noted: boolean | null;
  extraction_confidence: number | string | null;
  reviewed: boolean;
};

export type EventRow = {
  id: string;
  project_id: string;
  project_name: string;
  company_name: string | null;
  document_id: string | null;
  event_type: string | null;
  event_date: string | Date | null;
  summary: string | null;
};

export type FilingRow = {
  id: string;
  title: string | null;
  doc_type: string | null;
  filed_at: string | Date | null;
  status: string | null;
  company_id: string | null;
  company_name: string | null;
  project_id: string | null;
  project_name: string | null;
  summary: string | null;
};

export type ScreenerRow = ProjectSummary & {
  resource_category: string | null;
  tonnes: number | string | null;
  grade: JsonMap | null;
  resource_document_id: string | null;
  resource_date: string | Date | null;
  study_type: string | null;
  irr_pct: number | string | null;
  capex_initial: number | string | null;
  npv: JsonMap | null;
  currency: string | null;
  economics_document_id: string | null;
};

export type ScreenerFilters = {
  commodity?: string;
  country?: string;
  stage?: string;
  studyType?: string;
  minGradeKey?: string;
  minGrade?: string;
  filedSince?: string;
};

export type SavedFilter = {
  id: string;
  name: string;
  criteria: ScreenerFilters;
  created_at: string | Date;
};

export const LOW_CONFIDENCE_MAX = 0.5;
export const AUTO_APPROVE_MIN = 0.7;

export type ReviewKind = "resource" | "economics" | "drill";

export type ReviewItem = {
  kind: ReviewKind;
  id: string;
  project_id: string;
  project_name: string;
  document_id: string | null;
  extraction_confidence: number | string | null;
  reviewed: boolean;
  label: string;
  payload: Record<string, unknown>;
  attention: boolean;
};

export type GeoOccurrence = {
  id: string;
  source: string;
  external_id: string;
  name: string;
  country: string | null;
  region: string | null;
  lat: number | string;
  lng: number | string;
  commodities: string[] | null;
};

export type WatchlistRecord = {
  id: string;
  name: string;
  created_at: string | Date;
};

export type WatchlistItemRecord = {
  id: string;
  watchlist_id: string;
  project_id: string | null;
  company_id: string | null;
  project_name: string | null;
  company_name: string | null;
};
