"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { redlineOrder, redlineDeriveAction } = require("../overlay/00-order");

const A = (id, rect) => ({ id, anchor: rect ? { rect } : {} });

test("orders by yPct then xPct then id; rectless last", () => {
  const out = redlineOrder([
    A("R-003", { yPct: 50, xPct: 10 }),
    A("R-001", { yPct: 10, xPct: 90 }),
    A("R-004", null),
    A("R-002", { yPct: 10, xPct: 5 }),
  ]);
  assert.deepStrictEqual(out.map((a) => a.id), ["R-002", "R-001", "R-003", "R-004"]);
});

test("does not mutate input", () => {
  const input = [A("R-002", { yPct: 2, xPct: 0 }), A("R-001", { yPct: 1, xPct: 0 })];
  redlineOrder(input);
  assert.strictEqual(input[0].id, "R-002");
});

test("deriveAction: explicit wins, proposal defaults edit, verbs classify", () => {
  assert.strictEqual(redlineDeriveAction({ kind: "instruction", body: { action: "add", instruction: "remove x" } }), "add");
  assert.strictEqual(redlineDeriveAction({ kind: "proposal", body: { current: "a", proposed: "b" } }), "edit");
  assert.strictEqual(redlineDeriveAction({ kind: "instruction", body: { instruction: "Remove this card" } }), "remove");
  assert.strictEqual(redlineDeriveAction({ kind: "instruction", body: { instruction: "delete the banner" } }), "remove");
  assert.strictEqual(redlineDeriveAction({ kind: "instruction", body: { instruction: "Add a tooltip here" } }), "add");
  assert.strictEqual(redlineDeriveAction({ kind: "instruction", body: { instruction: "make this Japanese" } }), "edit");
});
