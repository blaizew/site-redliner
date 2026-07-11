"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { makeProxyHandler } = require("../lib/proxy");

// Boots a stub target + a proxy in front of it; returns URLs + captured upstream reqs.
async function rig(targetBehavior) {
  const seen = [];
  const target = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url, method: req.method, headers: req.headers, body });
      targetBehavior(req, res);
    });
  });
  await new Promise((r) => target.listen(0, r));
  const tPort = target.address().port;
  const proxy = http.createServer(makeProxyHandler(`http://127.0.0.1:${tPort}`));
  await new Promise((r) => proxy.listen(0, r));
  const pPort = proxy.address().port;
  return {
    seen,
    base: `http://127.0.0.1:${pPort}`,
    targetOrigin: `http://127.0.0.1:${tPort}`,
    close: () => { target.close(); proxy.close(); },
  };
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

test("injects overlay into html responses", async () => {
  const r = await rig((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><body>hi</body></html>");
  });
  const { body, headers } = await get(r.base + "/");
  assert.ok(body.includes("/__redline/overlay.js"));
  assert.strictEqual(Number(headers["content-length"]), Buffer.byteLength(body));
  r.close();
});

test("streams non-html untouched", async () => {
  const r = await rig((req, res) => {
    res.writeHead(200, { "content-type": "application/javascript" });
    res.end("console.log(1)");
  });
  const { body } = await get(r.base + "/app.js");
  assert.strictEqual(body, "console.log(1)");
  r.close();
});

test("rewrites host and strips accept-encoding upstream", async () => {
  const r = await rig((req, res) => { res.writeHead(204); res.end(); });
  await get(r.base + "/x", { "accept-encoding": "gzip, br" });
  assert.strictEqual(r.seen[0].headers["accept-encoding"], undefined);
  assert.ok(r.seen[0].headers.host.startsWith("127.0.0.1"));
  r.close();
});

test("rewrites absolute redirect Location back through proxy", async () => {
  let r; // assigned before the first request arrives (rig resolves first)
  r = await rig((req, res) => {
    res.writeHead(302, { location: r.targetOrigin + "/login" });
    res.end();
  });
  const { status, headers } = await get(r.base + "/old");
  assert.strictEqual(status, 302);
  assert.strictEqual(headers.location, "/login");
  r.close();
});

test("502 on upstream failure", async () => {
  const proxy = http.createServer(makeProxyHandler("http://127.0.0.1:1")); // nothing listens
  await new Promise((r) => proxy.listen(0, r));
  const { status } = await get(`http://127.0.0.1:${proxy.address().port}/`);
  assert.strictEqual(status, 502);
  proxy.close();
});

test("drops CSP header from target responses", async () => {
  const r = await rig((req, res) => {
    res.writeHead(200, { "content-type": "text/html", "content-security-policy": "default-src 'self'" });
    res.end("<body></body>");
  });
  const { headers } = await get(r.base + "/");
  assert.strictEqual(headers["content-security-policy"], undefined);
  r.close();
});

test("leaves foreign-origin redirect with colliding string prefix untouched", async () => {
  // String concatenation of targetOrigin + "1/foo" produces a DIFFERENT origin
  // (e.g. http://127.0.0.1:3000 + "1/foo" -> http://127.0.0.1:30001/foo) whose
  // string representation happens to start with the real target origin.
  let r;
  r = await rig((req, res) => {
    res.writeHead(302, { location: r.targetOrigin + "1/foo" });
    res.end();
  });
  const { status, headers } = await get(r.base + "/old");
  assert.strictEqual(status, 302);
  assert.strictEqual(headers.location, r.targetOrigin + "1/foo");
  r.close();
});

// Wraps http.get so a socket error resolves (with completed: false) instead of rejecting.
function getTolerant(url, headers = {}) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ completed: true, status: res.statusCode, body }));
      res.on("error", () => resolve({ completed: false }));
    });
    req.on("error", () => resolve({ completed: false }));
  });
}

test("survives upstream dying mid-response", async () => {
  const r = await rig((req, res) => {
    if (req.url === "/die") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.write("partial-chunk");
      // Delay so headers/data actually reach the client before the socket dies,
      // exercising the up.on("error") path rather than a pre-response connection reset.
      setTimeout(() => res.destroy(), 20);
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });

  const dieResult = await getTolerant(r.base + "/die");
  // Either the client request errors, or it completes truncated - both are acceptable;
  // the real assertion is that the proxy process itself doesn't crash (see below).
  assert.ok(dieResult.completed === false || typeof dieResult.body === "string");

  // A second request through the SAME proxy must still succeed - proves the dead
  // upstream stream didn't take down the process or leave the proxy wedged.
  const { status, body } = await get(r.base + "/ok");
  assert.strictEqual(status, 200);
  assert.strictEqual(body, "ok");

  r.close();
});
