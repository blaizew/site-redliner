"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { injectOverlay, filterResponseHeaders, rewriteSetCookie, SCRIPT_TAG } = require("../lib/inject");

test("injects overlay tags before </body>", () => {
  const out = injectOverlay("<html><body><h1>x</h1></body></html>");
  assert.ok(out.includes(SCRIPT_TAG));
  assert.ok(out.indexOf(SCRIPT_TAG) < out.indexOf("</body>"));
  assert.ok(out.includes('href="/__redline/overlay.css"'));
});

test("appends when no </body> present", () => {
  const out = injectOverlay("<p>bare</p>");
  assert.ok(out.endsWith(SCRIPT_TAG));
});

test("is idempotent", () => {
  const once = injectOverlay("<body></body>");
  assert.strictEqual(injectOverlay(once), once);
});

test("case-insensitive </BODY>", () => {
  const out = injectOverlay("<BODY>x</BODY>");
  assert.ok(out.indexOf(SCRIPT_TAG) < out.toLowerCase().indexOf("</body>"));
});

test("always drops CSP and frame headers", () => {
  const out = filterResponseHeaders(
    { "content-security-policy": "default-src 'self'", "x-frame-options": "DENY", "content-type": "text/html" },
    { transformed: false }
  );
  assert.strictEqual(out["content-security-policy"], undefined);
  assert.strictEqual(out["x-frame-options"], undefined);
  assert.strictEqual(out["content-type"], "text/html");
});

test("drops length/encoding only when transformed", () => {
  const h = { "content-length": "10", "content-encoding": "gzip", "content-type": "text/html" };
  const kept = filterResponseHeaders(h, { transformed: false });
  assert.strictEqual(kept["content-length"], "10");
  const dropped = filterResponseHeaders(h, { transformed: true });
  assert.strictEqual(dropped["content-length"], undefined);
  assert.strictEqual(dropped["content-encoding"], undefined);
});

test("rewrites set-cookie: strips Domain, Secure, SameSite", () => {
  const out = rewriteSetCookie(["gate=abc; Path=/; Domain=example.com; Secure; SameSite=None; HttpOnly"]);
  assert.strictEqual(out[0], "gate=abc; Path=/; HttpOnly");
});

test("filterResponseHeaders applies cookie rewrite", () => {
  const out = filterResponseHeaders({ "set-cookie": ["a=1; Secure"] }, { transformed: false });
  assert.deepStrictEqual(out["set-cookie"], ["a=1"]);
});
