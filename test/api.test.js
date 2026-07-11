"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Store } = require("../lib/store");
const { makeApiHandler } = require("../lib/api");

async function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "redline-api-"));
  const overlayDir = path.join(dir, "overlay");
  fs.mkdirSync(overlayDir);
  fs.writeFileSync(path.join(overlayDir, "00-a.js"), "// a");
  fs.writeFileSync(path.join(overlayDir, "01-b.js"), "// b");
  fs.writeFileSync(path.join(overlayDir, "overlay.css"), ".x{}");
  const store = new Store(path.join(dir, "annotations.json"), "t");
  const api = makeApiHandler(store, overlayDir, { author: "blaize" });
  const server = http.createServer((req, res) => {
    if (!api(req, res)) { res.writeHead(418); res.end("fallthrough"); }
  });
  await new Promise((r) => server.listen(0, r));
  return { store, base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { "content-type": "application/json" } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test("bundle = cfg + files in filename order", async () => {
  const r = await rig();
  const { status, headers, body } = await request("GET", r.base + "/__redline/overlay.js");
  assert.strictEqual(status, 200);
  assert.ok(headers["content-type"].includes("javascript"));
  assert.ok(body.startsWith('window.__REDLINE_CFG__ = {"author":"blaize"};'));
  assert.ok(body.indexOf("// a") < body.indexOf("// b"));
  r.close();
});

test("serves css", async () => {
  const r = await rig();
  const { body, headers } = await request("GET", r.base + "/__redline/overlay.css");
  assert.strictEqual(body, ".x{}");
  assert.ok(headers["content-type"].includes("css"));
  r.close();
});

test("GET rev and annotations", async () => {
  const r = await rig();
  const rev = JSON.parse((await request("GET", r.base + "/__redline/rev")).body).rev;
  const g = JSON.parse((await request("GET", r.base + "/__redline/annotations")).body);
  assert.strictEqual(g.rev, rev);
  assert.deepStrictEqual(g.doc.annotations, []);
  r.close();
});

test("PUT happy path then 409 on stale", async () => {
  const r = await rig();
  const g = JSON.parse((await request("GET", r.base + "/__redline/annotations")).body);
  const doc = g.doc;
  doc.annotations.push({ id: "R-001" });
  const ok = await request("PUT", r.base + "/__redline/annotations", { baseRev: g.rev, doc });
  assert.strictEqual(ok.status, 200);
  const stale = await request("PUT", r.base + "/__redline/annotations", { baseRev: g.rev, doc });
  assert.strictEqual(stale.status, 409);
  const j = JSON.parse(stale.body);
  assert.strictEqual(j.error, "conflict");
  assert.strictEqual(j.doc.annotations.length, 1);
  r.close();
});

// Buffer-safe request helper: accumulates response chunks as Buffers and decodes
// once at the end, so the test's own read side can't mask/confound the PUT-body
// fix under test with the same class of chunk-boundary UTF-8 bug.
function requestUtf8Safe(method, url, rawBodyChunks) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { "content-type": "application/json" } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    for (const c of rawBodyChunks || []) req.write(c);
    req.end();
  });
}

test("PUT round-trips multi-byte UTF-8 across chunk boundaries", async () => {
  const r = await rig();
  const g = JSON.parse((await request("GET", r.base + "/__redline/annotations")).body);
  const doc = g.doc;
  const jaText = "シームレスなグローバル決済を確認する".repeat(500);
  doc.annotations.push({ id: "R-002", text: jaText });

  const payload = JSON.stringify({ baseRev: g.rev, doc });
  const buf = Buffer.from(payload, "utf8");

  // Find a split index that lands mid-character: the byte at splitIndex must be
  // a UTF-8 continuation byte (top two bits == 10), meaning it's the 2nd/3rd byte
  // of a multi-byte sequence, not a sequence start.
  let splitIndex = -1;
  for (let i = Math.floor(buf.length / 2); i < buf.length; i++) {
    if ((buf[i] & 0xc0) === 0x80) { splitIndex = i; break; }
  }
  assert.ok(splitIndex > 0, "must find a mid-character split point in the payload");
  assert.strictEqual(buf[splitIndex] & 0xc0, 0x80, "split point must land on a UTF-8 continuation byte");

  const put = await requestUtf8Safe("PUT", r.base + "/__redline/annotations", [
    buf.subarray(0, splitIndex),
    buf.subarray(splitIndex),
  ]);
  assert.strictEqual(put.status, 200);

  const check = JSON.parse((await requestUtf8Safe("GET", r.base + "/__redline/annotations")).body);
  const stored = check.doc.annotations.find((a) => a.id === "R-002");
  assert.strictEqual(stored.text, jaText);
  r.close();
});

test("GET /__redline/shot emits sessionStorage.setItem + location.replace", async () => {
  const r = await rig();
  const { status, headers, body } = await request("GET", r.base + "/__redline/shot?statuses=all&to=/bank");
  assert.strictEqual(status, 200);
  assert.ok(headers["content-type"].includes("html"));
  assert.ok(body.includes("sessionStorage.setItem"));
  assert.ok(body.includes('"all"'));
  assert.ok(body.includes('location.replace("/bank")'));
  r.close();
});

test("GET /__redline/unshot emits sessionStorage.removeItem", async () => {
  const r = await rig();
  const { status, body } = await request("GET", r.base + "/__redline/unshot");
  assert.strictEqual(status, 200);
  assert.ok(body.includes("sessionStorage.removeItem"));
  assert.ok(body.includes('location.replace("/")'));
  r.close();
});

test("bad JSON body → 400; non-redline path → fallthrough", async () => {
  const r = await rig();
  const bad = await new Promise((resolve, reject) => {
    const req = http.request(r.base + "/__redline/annotations", { method: "PUT" }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode }));
    });
    req.on("error", reject); req.write("not json"); req.end();
  });
  assert.strictEqual(bad.status, 400);
  const fall = await request("GET", r.base + "/anything");
  assert.strictEqual(fall.status, 418);
  r.close();
});
