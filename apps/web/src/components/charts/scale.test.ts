// Run: node --test --experimental-strip-types src/components/charts/scale.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { absMax, niceScale, scaleTo } from "./scale.ts";

test("niceScale rounds up to readable ticks", () => {
  assert.deepEqual(niceScale(20), { top: 20, ticks: [0, 5, 10, 15, 20] });
  assert.deepEqual(niceScale(17).top, 20);
  assert.deepEqual(niceScale(3), { top: 3, ticks: [0, 1, 2, 3] });
  assert.deepEqual(niceScale(0.84, 4).top, 1);
});

test("niceScale survives empty data", () => {
  assert.deepEqual(niceScale(0), { top: 1, ticks: [0, 1] });
  assert.deepEqual(niceScale(Number.NaN), { top: 1, ticks: [0, 1] });
});

test("scaleTo clamps negatives and zero top", () => {
  assert.equal(scaleTo(10, 20, 200), 100);
  assert.equal(scaleTo(-5, 20, 200), 0);
  assert.equal(scaleTo(5, 0, 200), 0);
  assert.equal(absMax([-7, 3, 5]), 7);
});
