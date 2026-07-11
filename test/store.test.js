"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Store, revOf, emptyDoc } = require("../lib/store");

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "redline-")), "a.json");
}

test("creates file with empty doc on first construction", () => {
  const f = tmpFile();
  new Store(f, "https://x.example");
  const doc = JSON.parse(fs.readFileSync(f, "utf8"));
  assert.deepStrictEqual(doc, { version: 1, target: "https://x.example", annotations: [] });
});

test("read returns rev matching content hash", () => {
  const f = tmpFile();
  const s = new Store(f, "t");
  const { rev, doc } = s.read();
  assert.strictEqual(rev, revOf(fs.readFileSync(f, "utf8")));
  assert.strictEqual(doc.version, 1);
  assert.strictEqual(s.rev(), rev);
});

test("applyPut succeeds with current rev and bumps rev", () => {
  const f = tmpFile();
  const s = new Store(f, "t");
  const { rev, doc } = s.read();
  doc.annotations.push({ id: "R-001" });
  const r = s.applyPut(rev, doc);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.status, 200);
  assert.notStrictEqual(r.rev, rev);
  assert.strictEqual(s.read().doc.annotations.length, 1);
});

test("applyPut with stale rev returns 409 + current state, file unchanged", () => {
  const f = tmpFile();
  const s = new Store(f, "t");
  const first = s.read();
  const d1 = JSON.parse(JSON.stringify(first.doc));
  d1.annotations.push({ id: "R-001" });
  s.applyPut(first.rev, d1);
  const d2 = JSON.parse(JSON.stringify(first.doc));
  d2.annotations.push({ id: "R-002" });
  const r = s.applyPut(first.rev, d2); // stale base
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.doc.annotations[0].id, "R-001");
  assert.strictEqual(s.read().doc.annotations.length, 1);
});

test("picks up external file edits (agent wrote directly)", () => {
  const f = tmpFile();
  const s = new Store(f, "t");
  const before = s.rev();
  const doc = emptyDoc("t");
  doc.annotations.push({ id: "R-009" });
  fs.writeFileSync(f, JSON.stringify(doc, null, 2));
  assert.notStrictEqual(s.rev(), before);
  assert.strictEqual(s.read().doc.annotations[0].id, "R-009");
});
