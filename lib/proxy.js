"use strict";
const http = require("http");
const https = require("https");
const { injectOverlay, filterResponseHeaders } = require("./inject");

function makeProxyHandler(target) {
  const t = new URL(target);
  const client = t.protocol === "https:" ? https : http;
  return function proxy(req, res) {
    const headers = { ...req.headers };
    delete headers["accept-encoding"]; // identity responses so HTML is transformable
    headers.host = t.host;
    if (headers.origin) headers.origin = t.origin;
    if (headers.referer) {
      try {
        const ref = new URL(headers.referer);
        headers.referer = t.origin + ref.pathname + ref.search;
      } catch { delete headers.referer; }
    }
    const upstream = client.request(
      { protocol: t.protocol, hostname: t.hostname, port: t.port || undefined, method: req.method, path: req.url, headers },
      (up) => {
        const isHtml = String(up.headers["content-type"] || "").includes("text/html");
        const outHeaders = filterResponseHeaders(up.headers, { transformed: isHtml });
        if (typeof outHeaders.location === "string") {
          try {
            const parsed = new URL(outHeaders.location);
            if (parsed.origin === t.origin) {
              outHeaders.location = parsed.pathname + parsed.search + parsed.hash || "/";
            }
          } catch {
            // not a parseable absolute URL - leave untouched
          }
        }
        up.on("error", () => res.destroy());
        if (!isHtml) {
          res.writeHead(up.statusCode, outHeaders);
          up.pipe(res);
          return;
        }
        const chunks = [];
        up.on("data", (c) => chunks.push(c));
        up.on("end", () => {
          const body = injectOverlay(Buffer.concat(chunks).toString("utf8"));
          outHeaders["content-length"] = String(Buffer.byteLength(body));
          res.writeHead(up.statusCode, outHeaders);
          res.end(body);
        });
      }
    );
    upstream.on("error", (err) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("redline proxy error: " + err.message);
    });
    req.on("error", () => upstream.destroy());
    req.pipe(upstream);
  };
}

module.exports = { makeProxyHandler };
