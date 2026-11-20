// Run: node --test --experimental-strip-types src/lib/format.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatContained, formatGrade, formatMoneyM, formatNpv, pickNpv } from "./utils.ts";

test("money is stored in millions", () => {
  assert.equal(formatMoneyM(1240, "USD"), "US$1.24B");
  assert.equal(formatMoneyM(235, "CAD"), "C$235M");
  assert.equal(formatMoneyM(22.1, "XYZ"), "XYZ 22.1M");
  assert.equal(formatMoneyM(-41, "USD"), "−US$41M");
  assert.equal(formatMoneyM(null, "USD"), "—");
});

test("headline NPV prefers post-tax 5%, then 8%", () => {
  assert.equal(pickNpv({ pre_tax_5pct: 9, post_tax_8pct: 5, post_tax_5pct: 7 })?.key, "post_tax_5pct");
  assert.equal(pickNpv({ pre_tax_8pct: 9, post_tax_8pct: 5 })?.key, "post_tax_8pct");
  assert.equal(formatNpv({ "post_tax_1.09pct": 257.1 }, "USD"), "US$257M (post-tax, 1.09%)");
  assert.equal(formatNpv({ unspecified: 71674 }, null), "—");
  assert.equal(formatNpv({ npv: 50 }, "USD"), "US$50M (basis not stated)");
  assert.equal(formatNpv({ post_tax: 50 }, "USD"), "US$50M (post-tax, rate not stated)");
  assert.equal(formatNpv({}, "USD"), "—");
});

test("contained metal and grade read as units, never raw keys", () => {
  assert.equal(formatContained({ Au_oz: 1_250_000, Cu_lb: 2.1e9 }), "1.25 Moz Au, 2.1 Blb Cu");
  assert.equal(formatContained({ LCE_t: 450_000 }), "450 kt LCE");
  assert.equal(formatGrade({ Li_mgL: 120 }), "120 mg/L Li");
  assert.ok(!formatGrade({ Foo_bar: 1 }).includes("_"));
});
