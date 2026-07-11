#!/usr/bin/env node
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Store } = require("./lib/store");
const { makeProxyHandler } = require("./lib/proxy");
const { makeApiHandler } = require("./lib/api");

const USAGE = "usage: node server.js --target <url> [--port 4600] [--file annotations/<name>.json] [--author name] [--workspace dir]";

function resolveWorkspace(value, cwd) {
  return path.resolve(cwd, value || ".");
}

function resolveInWorkspace(file, workspace) {
  return path.isAbsolute(file) ? file : path.join(workspace, file);
}

function parseArgs(argv, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  let workspace = cwd;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--workspace") workspace = resolveWorkspace(argv[++i], cwd);
  }
  const cfgPath = path.join(workspace, "config.json");
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
  const args = { target: cfg.target, port: cfg.port || 4600, file: null, author: cfg.author || "user", workspace };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--target") args.target = argv[++i];
    else if (argv[i] === "--port") args.port = Number(argv[++i]);
    else if (argv[i] === "--file") args.file = argv[++i];
    else if (argv[i] === "--author") args.author = argv[++i];
    else if (argv[i] === "--workspace") i++;
  }
  if (!args.target) {
    throw new Error(USAGE);
  }
  if (!args.file) {
    args.file = path.join(workspace, "annotations", new URL(args.target).hostname + ".json");
  } else {
    args.file = resolveInWorkspace(args.file, workspace);
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const { target, port, file, author, workspace } = args;
  const store = new Store(file, target);
  const api = makeApiHandler(store, path.join(__dirname, "overlay"), { author, target });
  const proxy = makeProxyHandler(target);

  http
    .createServer((req, res) => { if (!api(req, res)) proxy(req, res); })
    .listen(port, () => {
      console.log(`redline: http://localhost:${port}  →  ${target}`);
      console.log(`workspace: ${workspace}`);
      console.log(`annotations: ${file}`);
    });
}

if (require.main === module) main();
module.exports = { parseArgs, resolveWorkspace };
