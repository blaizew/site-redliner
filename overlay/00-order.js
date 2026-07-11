// Shared by the live overlay, shot mode, and tools/export-md.js (CommonJS guard below).
// Deterministic per-page numbering: sort by stored rect (yPct, xPct), then id.
// The overlay refreshes anchor.rect every time an anchor resolves, and shot mode
// persists those rects before export — so this order matches the rendered badges.
function redlineOrder(annos) {
  const key = (a) => (a.anchor && a.anchor.rect) || { yPct: 1e9, xPct: 1e9 };
  return annos.slice().sort((a, b) => {
    const ra = key(a), rb = key(b);
    return ra.yPct - rb.yPct || ra.xPct - rb.xPct || String(a.id).localeCompare(String(b.id));
  });
}

// remove | edit | add. Explicit body.action wins; proposals are copy edits;
// instructions classified by their leading verb.
function redlineDeriveAction(a) {
  if (a.body && a.body.action) return a.body.action;
  if (a.kind === "proposal") return "edit";
  const t = ((a.body && a.body.instruction) || "").trim().toLowerCase();
  if (/^(remove|delete|drop|kill)\b/.test(t)) return "remove";
  if (/^(add|create|insert)\b/.test(t)) return "add";
  return "edit";
}

if (typeof module !== "undefined") module.exports = { redlineOrder, redlineDeriveAction };
