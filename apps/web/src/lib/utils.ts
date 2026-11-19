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
      return `${formatNumber(v)} ${key}`
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
