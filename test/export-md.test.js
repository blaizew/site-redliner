"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { buildMarkdown } = require("../tools/export-md");

const doc = {
  version: 1, target: "t",
  annotations: [
    { id: "R-002", kind: "proposal", surface: "bank", route: "bankhome", status: "approved",
      anchor: { text: "Lower text", rect: { yPct: 60, xPct: 10, wPct: 10, hPct: 5 } },
      body: { current: "Lower text", proposed: "Better | text" }, why: "puffery", thread: [] },
    { id: "R-001", kind: "instruction", surface: "bank", route: "bankhome", status: "implemented", author: "blaize",
      anchor: { rect: { yPct: 10, xPct: 10, wPct: 10, hPct: 5 } },
      body: { instruction: "remove this banner" }, thread: [{ author: "blaize", ts: "t", text: "redundant" }] },
    { id: "R-003", kind: "proposal", surface: "bank", route: "bankhome", status: "open",
      anchor: { text: "x", rect: { yPct: 5, xPct: 5, wPct: 1, hPct: 1 } }, body: { current: "x", proposed: "y" }, thread: [] },
    { id: "R-004", kind: "proposal", surface: "bank", route: null, status: "approved",
      anchor: { text: "no geometry yet" }, body: { current: "no geometry yet", proposed: "z" }, thread: [] }
  ]
};

test("filters to decided statuses by default; numbers by rect order", () => {
  const r = buildMarkdown(doc);
  assert.strictEqual(r.pages.length, 1);
  const md = r.pages[0].md;
  assert.ok(!md.includes("| x |"), "open finding excluded by default");
  // R-001 (yPct 10) is #1, R-002 (yPct 60) is #2
  assert.ok(md.indexOf("| 1 | Remove |") < md.indexOf("| 2 | Edit |"));
});

test("remove rows get em-dash After; pipes escaped; why falls back to thread note", () => {
  const md = buildMarkdown(doc).pages[0].md;
  assert.ok(md.includes("| 1 | Remove | remove this banner | remove this banner | — | redundant |"));
  assert.ok(md.includes("Better \\| text"));
});

test("export furniture: heading, color key, image line, table header", () => {
  const md = buildMarkdown(doc).pages[0].md;
  assert.ok(md.startsWith("## Bank: bankhome"));
  assert.ok(md.includes("Color key: **red = remove"));
  assert.ok(md.includes("![bank/bankhome — annotated](screenshots/bank-bankhome.png)"));
  assert.ok(md.includes("| # | Action | Element | Before | After | Why |"));
});

test("unplaced section lists rectless items; statuses=all widens", () => {
  const r = buildMarkdown(doc, { statuses: ["all"] });
  assert.strictEqual(r.unplacedCount, 1);
  assert.ok(r.full.includes("## Unplaced"));
  assert.ok(r.full.includes("no geometry yet"));
  assert.ok(r.full.includes("| x |"), "open finding included with statuses=all");
});
