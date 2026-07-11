"use strict";
const LINK_TAG = '<link rel="stylesheet" href="/__redline/overlay.css">';
const SCRIPT_TAG = '<script src="/__redline/overlay.js" defer></script>';

function injectOverlay(html) {
  if (html.includes("/__redline/overlay.js")) return html; // idempotent
  const snippet = LINK_TAG + SCRIPT_TAG;
  const i = html.toLowerCase().lastIndexOf("</body>");
  if (i === -1) return html + snippet;
  return html.slice(0, i) + snippet + html.slice(i);
}

// Strip attributes that stop target cookies (password gate) sticking on localhost:
// Domain (host mismatch), Secure (proxy is http), SameSite=None (requires Secure).
function rewriteSetCookie(values) {
  return values.map((v) =>
    v
      .split(";")
      .map((part) => part.trim())
      .filter((part) => {
        const key = part.split("=")[0].trim().toLowerCase();
        return key !== "domain" && key !== "secure" && key !== "samesite";
      })
      .join("; ")
  );
}

const DROP_ALWAYS = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
]);
const DROP_WHEN_TRANSFORMED = new Set(["content-length", "content-encoding", "transfer-encoding"]);

function filterResponseHeaders(headers, { transformed }) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (DROP_ALWAYS.has(key)) continue;
    if (transformed && DROP_WHEN_TRANSFORMED.has(key)) continue;
    out[k] = key === "set-cookie" ? rewriteSetCookie(Array.isArray(v) ? v : [v]) : v;
  }
  return out;
}

module.exports = { injectOverlay, filterResponseHeaders, rewriteSetCookie, SCRIPT_TAG, LINK_TAG };
