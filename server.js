#!/usr/bin/env node
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Store } = require("./lib/store");
const { makeProxyHandler } = require("./lib/proxy");
const { makeApiHandler } = require("./lib/api");

function parseArgs(argv) {
  const cfgPath = path.join(__dirname, "config.json");
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
  const args = { target: cfg.target, port: cfg.port || 4600, file: null, author: cfg.author || "user" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--target") args.target = argv[++i];
    else if (argv[i] === "--port") args.port = Number(argv[++i]);
    else if (argv[i] === "--file") args.file = argv[++i];
    else if (argv[i] === "--author") args.author = argv[++i];
  }
  if (!args.target) {
    console.error("usage: node server.js --target <url> [--port 4600] [--file annotations/<name>.json] [--author name]");
    process.exit(1);
  }
  if (!args.file) {
    args.file = path.join(__dirname, "annotations", new URL(args.target).hostname + ".json");
  }
  return args;
}

const { target, port, file, author } = parseArgs(process.argv);
const store = new Store(file, target);
const api = makeApiHandler(store, path.join(__dirname, "overlay"), { author, target });
const proxy = makeProxyHandler(target);

http
  .createServer((req, res) => { if (!api(req, res)) proxy(req, res); })
  .listen(port, () => {
    console.log(`redline: http://localhost:${port}  →  ${target}`);
    console.log(`annotations: ${file}`);
  });
