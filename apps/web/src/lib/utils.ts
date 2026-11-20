import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—"
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toISOString().slice(0, 10)
}

export function formatNumber(
  value: number | string | null | undefined,
  digits = 2,
): string {
  if (value === null || value === undefined || value === "") return "—"
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

export function formatTonnes(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—"
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return "—"
  if (n >= 1_000_000_000) return `${formatNumber(n / 1_000_000_000)} Bt`
  if (n >= 1_000_000) return `${formatNumber(n / 1_000_000)} Mt`
  if (n >= 1_000) return `${formatNumber(n / 1_000)} kt`
  return `${formatNumber(n, 0)} t`
}

export function formatGrade(grade: Record<string, number> | null | undefined): string {
  if (!grade) return "—"
  const parts = Object.entries(grade)
    .filter(([, v]) => Number.isFinite(v))
    .map(([key, v]) => {
      const [metal, unit] = key.split("_")
      if (unit === "pct") return `${formatNumber(v)}% ${metal}`
      if (unit === "gpt") return `${formatNumber(v)} g/t ${metal}`
      if (unit === "ppm") return `${formatNumber(v)} ppm ${metal}`
      if (unit === "opt") return `${formatNumber(v)} oz/t ${metal}`
      if (unit === "mgL") return `${formatNumber(v)} mg/L ${metal}`
      return `${formatNumber(v)} ${key.replaceAll("_", " ")}`
    })
  return parts.length ? parts.join(", ") : "—"
}

export function documentHref(documentId: string | null | undefined): string | null {
  if (!documentId) return null
  return `/documents/${documentId}`
}

/** "Nov 17" (UTC, so server and client agree). */
export function formatShortDate(value: string | Date | null | undefined): string {
  if (!value) return "—"
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

/** Compact age: "12 min", "5h", "2d". `nowMs` is passed in so render stays pure. */
export function formatAgo(value: string | Date | null | undefined, nowMs: number): string {
  if (!value) return "—"
  const t = (value instanceof Date ? value : new Date(value)).getTime()
  if (!Number.isFinite(t)) return "—"
  const min = Math.max(0, Math.round((nowMs - t) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

export const SOURCE_LABEL: Record<string, string> = {
  sedar: "SEDAR+",
  edgar: "EDGAR",
  newswire: "Newswire",
}

export const DOC_TYPE_LABEL: Record<string, string> = {
  ni43101: "NI 43-101 technical report",
  sk1300: "S-K 1300 technical report summary",
  pea: "Preliminary economic assessment",
  pfs: "Pre-feasibility study",
  fs: "Feasibility study",
  press_release: "Press release",
  mda: "MD&A",
  financials: "Financial statements",
}

const GRADE_UNIT_LABEL: Record<string, string> = { pct: "%", gpt: "g/t", ppm: "ppm", opt: "oz/t", mgL: "mg/L" }

/** "Cu_pct" -> "Cu (%)" for pickers. */
export function gradeKeyLabel(key: string): string {
  const i = key.lastIndexOf("_")
  if (i < 0) return key
  const unit = key.slice(i + 1)
  return `${key.slice(0, i)} (${GRADE_UNIT_LABEL[unit] ?? unit})`
}

/** Readable label for a snake_case code we have no explicit label for. */
export function humanize(code: string | null | undefined): string {
  if (!code) return "—"
  const s = code.replaceAll("_", " ")
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function docTypeLabel(code: string | null | undefined): string {
  return code ? DOC_TYPE_LABEL[code] ?? humanize(code) : "Filing"
}

export const STUDY_LABEL: Record<string, string> = {
  pea: "PEA",
  pfs: "PFS",
  fs: "Feasibility",
  other: "Technical report",
}

export function studyLabel(code: string | null | undefined): string {
  return code ? STUDY_LABEL[code] ?? humanize(code) : "—"
}

export const CATEGORY_LABEL: Record<string, string> = {
  "measured+indicated": "M&I",
  "2p": "Proven + probable",
}

export function categoryLabel(code: string | null | undefined): string {
  return code ? CATEGORY_LABEL[code] ?? humanize(code) : "—"
}

const CURRENCY_PREFIX: Record<string, string> = { USD: "US$", CAD: "C$", AUD: "A$", EUR: "€", GBP: "£" }

/** Economics money values are stored in millions of the row currency: 1240 USD -> "US$1.24B". */
export function formatMoneyM(
  millions: number | string | null | undefined,
  currency: string | null | undefined,
): string {
  if (millions === null || millions === undefined || millions === "") return "—"
  const n = typeof millions === "number" ? millions : Number(millions)
  if (!Number.isFinite(n)) return "—"
  const prefix = currency ? CURRENCY_PREFIX[currency] ?? `${currency} ` : "$"
  const sign = n < 0 ? "−" : ""
  const a = Math.abs(n)
  if (a >= 1000) return `${sign}${prefix}${formatNumber(a / 1000, 2)}B`
  return `${sign}${prefix}${formatNumber(a, a >= 100 ? 0 : 1)}M`
}

/** The headline NPV: post-tax 5%, else post-tax 8%, else any post-tax, else the first key. */
export function pickNpv(
  npv: Record<string, number> | null | undefined,
): { key: string; value: number; basis: string } | null {
  if (!npv) return null
  // "unspecified" rows are mostly mis-extracted revenue or cash-flow totals, not NPVs.
  const entries = Object.entries(npv).filter(([k, v]) => Number.isFinite(v) && k !== "unspecified")
  if (entries.length === 0) return null
  const pick =
    entries.find(([k]) => k === "post_tax_5pct") ??
    entries.find(([k]) => k === "post_tax_8pct") ??
    entries.find(([k]) => k.startsWith("post_tax")) ??
    entries[0]
  const m = pick[0].match(/^(pre|post)_tax(?:_([\d.]+)pct)?$/)
  const basis = m
    ? `${m[1] === "pre" ? "pre-tax" : "post-tax"}, ${m[2] ? `${m[2]}%` : "rate not stated"}`
    : "basis not stated"
  return { key: pick[0], value: pick[1], basis }
}

export function formatNpv(
  npv: Record<string, number> | null | undefined,
  currency: string | null | undefined,
): string {
  const p = pickNpv(npv)
  return p ? `${formatMoneyM(p.value, currency)} (${p.basis})` : "—"
}

/** {"Au_usd_per_oz": 954} -> "US$954/oz Au". AISC/price keys have no fixed convention, so stay lenient. */
export function formatPerUnit(map: Record<string, number> | null | undefined): string {
  if (!map) return "—"
  const parts = Object.entries(map)
    .filter(([, v]) => Number.isFinite(v))
    .map(([key, v]) => {
      const m = key.match(/^([A-Za-z0-9]+)_usd(?:_per)?_(oz|lb|t|kg)(?:_([a-z]+))?$/)
      if (m) return `US$${formatNumber(v)}/${m[2]} ${m[1]}${m[3] ? ` (${m[3]})` : ""}`
      return `${formatNumber(v)} (${key.replaceAll("_", " ")})`
    })
  return parts.length ? parts.join(", ") : "—"
}

/** {"Au_oz": 1250000, "Cu_lb": 2.1e9} -> "1.25 Moz Au, 2.1 Blb Cu". */
export function formatContained(metal: Record<string, number> | null | undefined): string {
  if (!metal) return "—"
  const parts = Object.entries(metal)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .map(([key, v]) => {
      const i = key.lastIndexOf("_")
      const name = i > 0 ? key.slice(0, i) : key
      const unit = i > 0 ? key.slice(i + 1) : ""
      return `${scaleUnit(v, unit)} ${name}`
    })
  return parts.length ? parts.join(", ") : "—"
}

function scaleUnit(v: number, unit: string): string {
  if (unit === "oz") return v >= 1e6 ? `${formatNumber(v / 1e6)} Moz` : `${formatNumber(v / 1e3, 0)} koz`
  if (unit === "lb") return v >= 1e9 ? `${formatNumber(v / 1e9)} Blb` : `${formatNumber(v / 1e6, 1)} Mlb`
  if (unit === "t") return v >= 1e6 ? `${formatNumber(v / 1e6)} Mt` : v >= 1e3 ? `${formatNumber(v / 1e3, 1)} kt` : `${formatNumber(v, 0)} t`
  if (unit === "kt") return v >= 1e3 ? `${formatNumber(v / 1e3)} Mt` : `${formatNumber(v, 1)} kt`
  return `${formatNumber(v)} ${unit}`
}
