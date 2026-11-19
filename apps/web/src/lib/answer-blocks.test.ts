// Run: node --test --experimental-strip-types src/lib/answer-blocks.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAnswer, parseInline } from "./answer-blocks.ts";

test("bold spans", () => {
  assert.deepEqual(parseInline("a **b** c"), [
    { text: "a ", bold: false },
    { text: "b", bold: true },
    { text: " c", bold: false },
  ]);
});

test("pipe table with rule row", () => {
  const [b] = parseAnswer("| Cat | Mt |\n|---|---|\n| **M** | 6.5 |\n| I | 27.2 |");
  assert.equal(b.kind, "table");
  if (b.kind !== "table") return;
  assert.equal(b.head.length, 2);
  assert.equal(b.rows.length, 2);
  assert.deepEqual(b.rows[0][0], [{ text: "M", bold: true }]);
});

test("paragraphs, lists and headings split on blank lines", () => {
  const blocks = parseAnswer("Intro line\nsecond\n\n**Notes:**\n- one\n- two\n\n## Head\n1. a\n2. b");
  assert.deepEqual(blocks.map((b) => b.kind), ["p", "p", "ul", "h", "ol"]);
  const ul = blocks[2];
  assert.ok(ul.kind === "ul" && ul.items.length === 2);
});

test("pipes without a rule row stay as text", () => {
  assert.equal(parseAnswer("| not | a table |")[0].kind, "p");
});
