"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function revOf(text) {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function emptyDoc(target) {
  return { version: 1, target, annotations: [] };
}

// Annotations file store. The file is the single source of truth — agents edit it
// directly on disk, the browser edits it via PUT. Every read re-reads the file so
// external (agent) writes are always visible. Writes are atomic (tmp + rename).
class Store {
  constructor(file, target) {
    this.file = file;
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      this._writeRaw(JSON.stringify(emptyDoc(target), null, 2));
    }
  }
  _readRaw() { return fs.readFileSync(this.file, "utf8"); }
  _writeRaw(text) {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, this.file);
  }
  read() {
    const raw = this._readRaw();
    return { rev: revOf(raw), doc: JSON.parse(raw) };
  }
  rev() { return revOf(this._readRaw()); }
  // Whole-doc replace guarded by the rev the writer based its edit on.
  applyPut(baseRev, doc) {
    const current = this.read();
    if (baseRev !== current.rev) {
      return { ok: false, status: 409, rev: current.rev, doc: current.doc };
    }
    const text = JSON.stringify(doc, null, 2);
    this._writeRaw(text);
    return { ok: true, status: 200, rev: revOf(text) };
  }
}

module.exports = { Store, revOf, emptyDoc };
