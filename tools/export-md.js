#!/usr/bin/env node
// Annotations → review-ticket markdown: per-page color key + screenshot line +
// numbered change table. Numbering = overlay/00-order (same as shot-mode badges).
"use strict";
const fs = require("fs");
const path = require("path");
const { redlineOrder, redlineDeriveAction } = require("../overlay/00-order");

const cell = (s) => {
  const t = String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
  return t || "—";
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : String(s));
const lastHumanNote = (a) => {
  const t = (a.thread || []).filter((c) => c.author !== "claude");
  return t.length ? t[t.length - 1].text : "";
};

function buildMarkdown(doc, opts = {}) {
  const statuses = opts.statuses || ["approved", "edited", "implemented"];
  const wide = statuses.includes("all");
  const all = wide ? doc.annotations : doc.annotations.filter((a) => statuses.includes(a.status));
  const placed = all.filter((a) => a.anchor && a.anchor.rect);
  const unplaced = all.filter((a) => !(a.anchor && a.anchor.rect));

  const groups = new Map();
  for (const a of placed) {
    const k = (a.surface || "unknown") + "\n" + (a.route || "");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }

  const pages = [];
  for (const [k, annos] of groups) {
    const [surface, route] = k.split("\n");
    const shotFile = `screenshots/${surface}-${route}.png`;
    const lines = [
      `## ${cap(surface)}: ${route}`,
      "",
      "Color key: **red = remove · orange (dashed) = edit · green = add**",
      "",
      `![${surface}/${route} — annotated](${shotFile})`,
      "",
      "| # | Action | Element | Before | After | Why |",
      "| -- | -- | -- | -- | -- | -- |",
    ];
    redlineOrder(annos).forEach((a, i) => {
      const action = redlineDeriveAction(a);
      const el = cell(a.hint || (a.anchor && (a.anchor.text || a.anchor.refText)) || (a.body && a.body.instruction) || "(region)");
      const before = cell((a.body && a.body.current) || (a.anchor && (a.anchor.text || a.anchor.refText)) || (a.body && a.body.instruction) || "");
      const after = action === "remove" ? "—" : cell(a.editedText || (a.body && (a.body.proposed || a.body.instruction)) || "");
      const why = cell(a.why || lastHumanNote(a) || "");
      lines.push(`| ${i + 1} | ${cap(action)} | ${el} | ${before} | ${after} | ${why} |`);
    });
    pages.push({ surface, route, shotFile, md: lines.join("\n") });
  }

  let full = pages.map((p) => p.md).join("\n\n");
  if (unplaced.length) {
    const lines = ["", "## Unplaced (no geometry — not in any screenshot)", "",
      "| Source | Element | Before | After |", "| -- | -- | -- | -- |"];
    for (const a of unplaced) {
      lines.push(`| ${cell(a.source)} | ${cell(a.hint || (a.anchor && a.anchor.text))} | ${cell(a.body && a.body.current)} | ${cell(a.editedText || (a.body && (a.body.proposed || a.body.instruction)))} |`);
    }
    full += "\n" + lines.join("\n");
  }
  return { full, pages, unplacedCount: unplaced.length };
}

function arg(argv, n, d) {
  const i = argv.indexOf("--" + n);
  return i > -1 ? argv[i + 1] : d;
}

function resolveWorkspace(value, cwd) {
  return path.resolve(cwd, value || ".");
}

function resolveInWorkspace(file, workspace) {
  return path.isAbsolute(file) ? file : path.join(workspace, file);
}

function resolveCliOptions(argv = process.argv, cwd = process.cwd()) {
  const workspace = resolveWorkspace(arg(argv, "workspace", null), cwd);
  const fileArg = arg(argv, "file");
  if (!fileArg) return { error: "usage: node tools/export-md.js --file annotations/<f>.json [--statuses a,b|all] [--out export/redline-export.md] [--workspace dir]" };
  const statuses = arg(argv, "statuses", "approved,edited,implemented").split(",");
  const out = arg(argv, "out", path.join(workspace, "export", "redline-export.md"));
  return {
    workspace,
    file: resolveInWorkspace(fileArg, workspace),
    statuses,
    out,
  };
}

function main() {
  const opts = resolveCliOptions();
  if (opts.error) {
    console.error(opts.error);
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(opts.file, "utf8"));
  const r = buildMarkdown(doc, { statuses: opts.statuses });
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, r.full);
  console.log(`wrote ${opts.out} — ${r.pages.length} page section(s), ${r.unplacedCount} unplaced`);
  console.log("NOTE: capture shot-mode screenshots BEFORE running this, so persisted rects make numbering match badges.");
}

if (require.main === module) main();
module.exports = { buildMarkdown, resolveCliOptions };
