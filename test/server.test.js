"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { parseArgs } = require("../server");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "redline-server-"));
}

test("parseArgs resolves config and default annotations from workspace", () => {
  const workspace = tempDir();
  fs.writeFileSync(
    path.join(workspace, "config.json"),
    JSON.stringify({ target: "https://example.com", port: 4655, author: "t" })
  );

  const args = parseArgs(["node", "server.js", "--workspace", workspace], { cwd: "/" });

  assert.strictEqual(args.workspace, workspace);
  assert.strictEqual(args.target, "https://example.com");
  assert.strictEqual(args.port, 4655);
  assert.strictEqual(args.author, "t");
  assert.strictEqual(args.file, path.join(workspace, "annotations", "example.com.json"));
});

test("parseArgs resolves relative workspace and relative file against cwd/workspace", () => {
  const cwd = tempDir();
  const workspace = path.join(cwd, "project-a");
  fs.mkdirSync(workspace);

  const args = parseArgs([
    "node", "server.js",
    "--workspace", "project-a",
    "--target", "https://example.com",
    "--file", "annotations/custom.json",
  ], { cwd });

  assert.strictEqual(args.workspace, workspace);
  assert.strictEqual(args.file, path.join(workspace, "annotations", "custom.json"));
});
