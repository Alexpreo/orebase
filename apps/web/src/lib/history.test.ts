// Run: node --test --experimental-strip-types src/lib/history.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  categoryTotals,
  changeForDocument,
  changeLine,
  containedFromGrade,
  economicsProgression,
  groupEstimates,
  npvComparable,
  primaryGradeKey,
  zoneMatrix,
  type HistEconomics,
  type HistResource,
} from "./history.ts";

let n = 0;
function r(p: Partial<HistResource>): HistResource {
  return {
    id: String(n++), project_id: "p", document_id: "d1", effective_date: "2025-01-01",
    category: "indicated", domain: null, tonnes: 1_000_000, grade: { Au_gpt: 1 },
    contained_metal: null, cutoff: null, standard: null, extraction_confidence: 0.9,
    reviewed: true, ...p,
  };
}

test("a refiled estimate counts once, from the fuller document", () => {
  const est = groupEstimates([
    r({ document_id: "a" }),
    r({ document_id: "b" }), r({ document_id: "b", category: "inferred" }),
    r({ document_id: "c", effective_date: "2026-01-01" }),
  ]);
  assert.equal(est.length, 2);
  assert.equal(est[0].documentId, "b");
  assert.equal(est[0].alsoIn, 1);
  assert.equal(est[1].date, "2026-01-01");
});

test("missing effective date falls back to filing date", () => {
  const est = groupEstimates([r({ effective_date: null, filed_at: "2024-05-02" })]);
  assert.equal(est[0].date, "2024-05-02");
});

test("M&I uses the combined row when present, and a report total beats its zones", () => {
  const rows = [
    r({ category: "measured", tonnes: 1 }),
    r({ category: "measured+indicated", domain: "Zone A", tonnes: 2_000_000, grade: { Au_gpt: 1 } }),
    r({ category: "measured+indicated", domain: "Zone B", tonnes: 2_000_000, grade: { Au_gpt: 3 } }),
  ];
  const t = categoryTotals(rows, "mi")!;
  assert.equal(t.tonnes, 4_000_000);
  assert.equal(t.grades.Au_gpt, 2);
  const withTotal = [...rows, r({ category: "measured+indicated", domain: "Total", tonnes: 4_100_000 })];
  assert.equal(categoryTotals(withTotal, "mi")!.tonnes, 4_100_000);
  assert.equal(categoryTotals(rows, "reserves"), null);
  const subtotal = [...rows, r({ category: "measured+indicated", domain: "Zone B total", tonnes: 2_000_000 })];
  assert.equal(categoryTotals(subtotal, "mi")!.tonnes, 6_000_000);
  const dashed = [
    r({ category: "indicated", domain: "Santa Cruz - Oxide", tonnes: 53 }),
    r({ category: "indicated", domain: "Santa Cruz - Total", tonnes: 274 }),
    r({ category: "indicated", domain: null, tonnes: 7 }),
  ];
  assert.equal(categoryTotals(dashed, "mi")!.tonnes, 274);
});

test("contained metal and primary metal", () => {
  assert.equal(Math.round(containedFromGrade(31_103.5, "Au_gpt", 1)!.value), 1000);
  assert.deepEqual(containedFromGrade(1000, "Cu_pct", 2), { value: 20, unit: "t" });
  assert.equal(primaryGradeKey([r({ grade: { AuEq_gpt: 1, Cu_pct: 1 } }), r({ grade: { Cu_pct: 2 } })]), "Cu_pct");
});

test("zones line up across estimates despite naming drift", () => {
  const est = groupEstimates([
    r({ domain: "Konkola Mine, exclusive of reserves" }),
    r({ effective_date: "2026-01-01", document_id: "d2", domain: "Konkola UG" }),
  ]);
  const m = zoneMatrix(est, "mi");
  assert.equal(m.length, 1);
  assert.ok(m[0].cells.every(Boolean));
  assert.equal(changeLine(est[0], est[1]), "M&I tonnes unchanged vs the 2025 estimate");
  assert.equal(changeForDocument([...est[0].rows, ...est[1].rows], "d2"), "M&I tonnes unchanged vs the 2025 estimate");
  assert.equal(changeForDocument(est[0].rows, "d1"), null);
});

test("studies sort oldest first; NPV compared only on the same basis", () => {
  const e = (p: Partial<HistEconomics>): HistEconomics => ({
    id: String(n++), project_id: "p", document_id: "d", study_type: "pea", effective_date: "2023-01-01",
    currency: "USD", npv: { post_tax_5pct: 100 }, irr_pct: 20, capex_initial: 300, aisc: null,
    mine_life_years: 10, payback_years: 3, metal_price_assumptions: null, extraction_confidence: 1,
    reviewed: true, ...p,
  });
  const s = economicsProgression([
    e({ study_type: "pfs", effective_date: "2025-01-01", npv: { post_tax_8pct: 90 } }),
    e({}),
    e({}),
  ]);
  assert.deepEqual(s.map((x) => x.row.study_type), ["pea", "pfs"]);
  assert.equal(npvComparable(s[0], s[1]), false);
});
