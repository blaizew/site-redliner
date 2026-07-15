"use strict";
const fs = require("fs");
const path = require("path");
const { URLSearchParams } = require("url");

const SHOT_KEY = "__redline_shot";

function safeTo(raw) {
  if (typeof raw === "string" && raw.startsWith("/")) return raw;
  return "/";
}

function shotActivationHtml(setOrRemoveJs) {
  return `<!doctype html><meta charset="utf-8"><script>${setOrRemoveJs}</script>`;
}

function makeApiHandler(store, overlayDir, clientCfg) {
  const cfgLine = "window.__REDLINE_CFG__ = " + JSON.stringify(clientCfg) + ";";
  function bundleJs() {
    const files = fs.readdirSync(overlayDir).filter((f) => f.endsWith(".js")).sort();
    return cfgLine + "\n" + files.map((f) => fs.readFileSync(path.join(overlayDir, f), "utf8")).join("\n;\n");
  }
  return function api(req, res) {
    const p = req.url.split("?")[0];
    if (!p.startsWith("/__redline/")) return false;
    if (p === "/__redline/overlay.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(bundleJs());
      return true;
    }
    if (p === "/__redline/overlay.css") {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      res.end(fs.readFileSync(path.join(overlayDir, "overlay.css"), "utf8"));
      return true;
    }
    const fontMatch = /^\/__redline\/fonts\/([\w.-]+\.woff2)$/.exec(p);
    if (fontMatch && req.method === "GET") {
      const file = path.join(overlayDir, "fonts", fontMatch[1]);
      if (!fs.existsSync(file)) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end('{"error":"font not found"}');
        return true;
      }
      res.writeHead(200, {
        "content-type": "font/woff2",
        "cache-control": "public, max-age=31536000, immutable",
      });
      res.end(fs.readFileSync(file));
      return true;
    }
    if (p === "/__redline/rev") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ rev: store.rev() }));
      return true;
    }
    if (p === "/__redline/annotations" && req.method === "GET") {
      const { rev, doc } = store.read();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ rev, doc }));
      return true;
    }
    if (p === "/__redline/annotations" && req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("error", () => { try { res.destroy(); } catch {} });
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let parsed;
        try { parsed = JSON.parse(body); } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end('{"error":"bad json"}');
          return;
        }
        const r = store.applyPut(parsed.baseRev, parsed.doc);
        res.writeHead(r.status, { "content-type": "application/json" });
        res.end(JSON.stringify(r.ok ? { rev: r.rev } : { rev: r.rev, doc: r.doc, error: "conflict" }));
      });
      return true;
    }
    if (p === "/__redline/shot" && req.method === "GET") {
      const q = new URLSearchParams((req.url.split("?")[1] || ""));
      const to = safeTo(q.get("to"));
      const statusesRaw = q.get("statuses");
      const value = statusesRaw === null ? "__default__" : statusesRaw;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        shotActivationHtml(
          `sessionStorage.setItem(${JSON.stringify(SHOT_KEY)}, ${JSON.stringify(value)});location.replace(${JSON.stringify(to)});`
        )
      );
      return true;
    }
    if (p === "/__redline/unshot" && req.method === "GET") {
      const q = new URLSearchParams((req.url.split("?")[1] || ""));
      const to = safeTo(q.get("to"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        shotActivationHtml(
          `sessionStorage.removeItem(${JSON.stringify(SHOT_KEY)});location.replace(${JSON.stringify(to)});`
        )
      );
      return true;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"unknown redline endpoint"}');
    return true;
  };
}

module.exports = { makeApiHandler };
