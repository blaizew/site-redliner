#!/usr/bin/env node
// Migrates slop-audit findings (findings-data.js) + the old review tools' triage
// exports into redline annotations. Idempotent on `source`.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadWindowScript(file) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
  return sandbox.window;
}

// Loads an ES-module-ish file (export const X = {...}) into plain bindings.
function loadModuleBindings(file) {
  const src = fs.readFileSync(file, "utf8")
    .replace(/\bexport\s+default\s+/g, "var __default = ")
    .replace(/\bexport\s+(const|let)\s+/g, "var ")
    .replace(/\bexport\s*\{[^}]*\};?/g, "");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

// Finds the EN→JA map: first object whose values are all strings and which has
// at least minSize entries (real i18n_ja.js has hundreds; guard avoids picking
// some small config object).
function loadJaMap(file, { minSize = 50 } = {}) {
  if (!file || !fs.existsSync(file)) return {};
  const bindings = loadModuleBindings(file);
  for (const v of Object.values(bindings)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const vals = Object.values(v);
      if (vals.length >= minSize && vals.every((x) => typeof x === "string")) return v;
    }
  }
  return {};
}

// Accepts: [{id,status,...}] | {decisions:{ID:{...}}} | {findings:[{id,...}]} | {ID: status|{...}}
// ALSO accepts the static review tools' export shape
// (index.html buildJson()): [{id, screen, location, decision: "pending"|"approve"|"edit"|
// "reject", current, finalText: <string|null>, note}]. decision maps: pending->open,
// approve->approved, edit->edited, reject->rejected. finalText only carries through as
// editedText for "edit" (for "approve" finalText just equals the accepted proposal —
// nothing new to store).
function loadTriage(file) {
  if (!file || !fs.existsSync(file)) return {};
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!j) return {};
  const out = {};
  const DECISION_MAP = { pending: "open", approve: "approved", edit: "edited", reject: "rejected" };
  const norm = (v) => {
    if (typeof v === "string") return { status: v };
    if (!v) return {};
    if (v.status == null && v.decision != null) {
      const status = DECISION_MAP[v.decision];
      const rest = { status };
      if (v.decision === "edit" && v.finalText != null) rest.editedText = v.finalText;
      if (v.note != null) rest.note = v.note;
      return rest;
    }
    return v;
  };
  if (Array.isArray(j)) for (const d of j) { if (d && d.id) out[d.id] = norm(d); }
  else if (j.decisions && typeof j.decisions === "object") for (const [k, v] of Object.entries(j.decisions)) out[k] = norm(v);
  else if (Array.isArray(j.findings)) for (const d of j.findings) { if (d && d.id) out[d.id] = norm(d); }
  else for (const [k, v] of Object.entries(j)) out[k] = norm(v);
  const known = new Set(["approved", "edited", "rejected", "open"]);
  for (const [k, v] of Object.entries(out)) if (!known.has(v.status)) delete out[k];
  return out;
}

function importFindings(opts) {
  const w = loadWindowScript(opts.findingsPath);
  const findings = w.SLOP_FINDINGS || [];
  const routeMap = fs.existsSync(opts.routeMapPath) ? JSON.parse(fs.readFileSync(opts.routeMapPath, "utf8")) : {};
  const triage = loadTriage(opts.triagePath);
  const ja = loadJaMap(opts.i18nPath, { minSize: opts.i18nMinSize || 50 });

  const doc = fs.existsSync(opts.outPath)
    ? JSON.parse(fs.readFileSync(opts.outPath, "utf8"))
    : { version: 1, target: opts.target, annotations: [] };

  let nextNum = 0;
  for (const a of doc.annotations) {
    const m = /^R-(\d+)$/.exec(a.id || "");
    if (m) nextNum = Math.max(nextNum, Number(m[1]));
  }
  const existing = new Set(doc.annotations.map((a) => a.source));

  const unmapped = new Set();
  const statusCounts = {};
  let imported = 0, skipped = 0;
  for (const f of findings) {
    const source = opts.sourcePrefix + " " + f.id;
    if (existing.has(source)) { skipped++; continue; }
    const mapped = routeMap[f.area] || routeMap[f.screen] || null;
    if (!mapped) unmapped.add(f.area || f.screen || "(none)");
    const t = triage[f.id] || {};
    const status = t.status || "open";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    const now = new Date().toISOString();
    nextNum++;
    doc.annotations.push({
      id: "R-" + String(nextNum).padStart(3, "0"),
      author: "claude",
      kind: "proposal",
      surface: mapped ? mapped.surface : null,
      route: mapped ? mapped.route : null,
      page: mapped ? mapped.page : null,
      state: {},
      anchor: { text: f.current || "", ...(ja[f.current] ? { textJa: ja[f.current] } : {}) },
      body: { current: f.current || "", proposed: f.proposed || "" },
      status,
      ...(t.editedText ? { editedText: t.editedText } : {}),
      thread: t.note ? [{ author: "blaize", ts: now, text: t.note }] : [],
      source,
      hint: [f.area, f.screen, f.location].filter(Boolean).join(" · "),
      why: f.pattern || "",
      createdAt: now,
      updatedAt: now,
    });
    imported++;
  }

  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  const tmp = opts.outPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
  fs.renameSync(tmp, opts.outPath);
  return { imported, skipped, total: doc.annotations.length, unmapped, statusCounts };
}

function main() {
  const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : d; };
  const findingsPath = arg("findings");
  if (!findingsPath) {
    console.error("usage: node tools/import-audit.js --findings <findings-data.js> [--triage export.json] [--i18n i18n_ja.js] [--route-map map.json] [--source-prefix name] [--target url] [--file annotations.json]");
    process.exit(1);
  }
  const target = arg("target", "https://example.com");
  const r = importFindings({
    findingsPath,
    triagePath: arg("triage", null),
    i18nPath: arg("i18n", null),
    routeMapPath: arg("route-map", path.join(__dirname, "route-map.json")),
    sourcePrefix: arg("source-prefix", "audit"),
    target,
    outPath: arg("file", path.join(__dirname, "..", "annotations", new URL(target).hostname + ".json")),
  });
  console.log(`imported: ${r.imported}  skipped(existing): ${r.skipped}  total: ${r.total}`);
  console.log("status counts:", JSON.stringify(r.statusCounts));
  if (r.unmapped.size) {
    console.log(`UNMAPPED screens (${r.unmapped.size}) — add to tools/route-map.json:`);
    for (const u of r.unmapped) console.log("  - " + u);
  }
}

if (require.main === module) main();
module.exports = { loadTriage, loadJaMap, loadWindowScript, importFindings };
