"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { loadTriage, loadJaMap, loadWindowScript, importFindings, resolveCliOptions } = require("../tools/import-audit");

const FIX = path.join(__dirname, "..", "fixtures");
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "redline-imp-")), "a.json");

test("loadWindowScript reads SLOP_FINDINGS", () => {
  const w = loadWindowScript(path.join(FIX, "findings-mini.js"));
  assert.strictEqual(w.SLOP_FINDINGS.length, 2);
});

test("loadJaMap finds the EN→JA object in an ES-module file", () => {
  // mini map has < 50 entries; loadJaMap's size guard is exercised with big=false option
  const ja = loadJaMap(path.join(FIX, "i18n-mini.js"), { minSize: 1 });
  assert.strictEqual(ja["Seamless global payments"], "シームレスなグローバル決済");
});

test("loadTriage accepts array and keyed shapes; drops unknown statuses", () => {
  const a = loadTriage(path.join(FIX, "triage-array.json"));
  assert.strictEqual(a.BK1.status, "edited");
  assert.strictEqual(a.BK1.editedText, "Payments, globally");
  assert.strictEqual(a.BK2.status, "rejected");
  const k = loadTriage(path.join(FIX, "triage-keyed.json"));
  assert.strictEqual(k.BK1.status, "approved");
  assert.strictEqual(k.BK2, undefined); // unknown status dropped
});

test("loadTriage accepts the real slop-audit export shape (decision/finalText)", () => {
  const r = loadTriage(path.join(FIX, "triage-real-export.json"));
  assert.strictEqual(r.BK1.status, "edited");
  assert.strictEqual(r.BK1.editedText, "Payments, globally");
  assert.strictEqual(r.BK1.note, "shorter");
  assert.strictEqual(r.BK2.status, "rejected");
  assert.strictEqual(r.BK3.status, "approved");
  assert.strictEqual("editedText" in r.BK3, false); // approve: finalText == proposed, not stored
  assert.strictEqual(r.BK4.status, "open");
});

test("loadTriage returns {} for a file containing literal null", () => {
  const r = loadTriage(path.join(FIX, "triage-null.json"));
  assert.deepStrictEqual(r, {});
});

test("importFindings maps, carries triage, attaches JA, flags unmapped, is idempotent", () => {
  const out = tmp();
  const opts = {
    findingsPath: path.join(FIX, "findings-mini.js"),
    triagePath: path.join(FIX, "triage-array.json"),
    i18nPath: path.join(FIX, "i18n-mini.js"),
    i18nMinSize: 1,
    routeMapPath: path.join(__dirname, "..", "tools", "route-map.json"),
    sourcePrefix: "mini-audit",
    target: "https://example.com",
    outPath: out,
  };
  const r1 = importFindings(opts);
  assert.strictEqual(r1.imported, 2);
  assert.deepStrictEqual([...r1.unmapped], ["Demo: Mystery"]);
  assert.deepStrictEqual(r1.statusCounts, { edited: 1, rejected: 1 });
  const doc = JSON.parse(fs.readFileSync(out, "utf8"));
  const bk1 = doc.annotations.find((a) => a.source === "mini-audit BK1");
  assert.strictEqual(bk1.status, "edited");
  assert.strictEqual(bk1.editedText, "Payments, globally");
  assert.strictEqual(bk1.anchor.textJa, "シームレスなグローバル決済");
  assert.strictEqual(bk1.route, "home");
  assert.strictEqual(bk1.kind, "proposal");
  assert.strictEqual(bk1.thread[0].text, "shorter");
  const bk2 = doc.annotations.find((a) => a.source === "mini-audit BK2");
  assert.strictEqual(bk2.route, null);
  assert.strictEqual(bk2.anchor.textJa, undefined);
  const r2 = importFindings(opts); // idempotent
  assert.strictEqual(r2.imported, 0);
  assert.strictEqual(r2.skipped, 2);
});

test("resolveCliOptions route-map precedence: explicit beats workspace beats repo sample", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "redline-route-map-"));
  const workspaceMap = path.join(workspace, "route-map.json");
  const explicitMap = path.join(workspace, "explicit-map.json");
  fs.writeFileSync(workspaceMap, "{}");
  fs.writeFileSync(explicitMap, "{}");
  const findings = path.join(FIX, "findings-mini.js");

  const withExplicit = resolveCliOptions([
    "node", "tools/import-audit.js",
    "--workspace", workspace,
    "--findings", findings,
    "--route-map", explicitMap,
  ], "/");
  assert.strictEqual(withExplicit.routeMapPath, explicitMap);

  const withWorkspace = resolveCliOptions([
    "node", "tools/import-audit.js",
    "--workspace", workspace,
    "--findings", findings,
  ], "/");
  assert.strictEqual(withWorkspace.routeMapPath, workspaceMap);

  fs.unlinkSync(workspaceMap);
  const withRepoFallback = resolveCliOptions([
    "node", "tools/import-audit.js",
    "--workspace", workspace,
    "--findings", findings,
  ], "/");
  assert.strictEqual(withRepoFallback.routeMapPath, path.join(__dirname, "..", "tools", "route-map.json"));
});
