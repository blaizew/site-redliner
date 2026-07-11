#!/usr/bin/env node
// set-status.mjs — safely set a redline annotation's status and/or append a thread
// comment, THROUGH the server's PUT endpoint (never a direct file write).
//
// Concurrency-safe: the endpoint guards every write with a rev (optimistic
// concurrency). On a conflict (409 — someone else wrote in between) this re-fetches
// the fresh doc and re-applies ONLY your own item ids, then retries. Because each
// caller only ever patches its own ids onto the latest doc, many per-PR terminals
// can call this at the same time with no lost updates. This is the same mechanism
// the browser's RL.put uses.
//
// Usage:
//   node set-status.mjs --ids R-375,R-377 --comment "Addressed in PR #124: removed the duplicate on all modal pages"
//   node set-status.mjs --ids R-219 --status implemented --comment "PR #131"
//
// Flags:
//   --ids      comma-separated ids (required), e.g. R-375,R-377
//   --status   new status (optional), e.g. implemented
//   --comment  thread comment to append (optional) — do at least one of status/comment
//   --author   thread author (default: claude)
//   --server   redline server (default: http://localhost:4600)

const argv = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) argv[a.slice(2)] = process.argv[++i];
}
const ids = (argv.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
const status = argv.status || null;
const comment = argv.comment || null;
const author = argv.author || "claude";
const server = (argv.server || "http://localhost:4600").replace(/\/$/, "");
const url = server + "/__redline/annotations";
const MAX = 12;

function halt(msg) { console.error("HALT: " + msg); process.exit(1); }
if (!ids.length) halt("--ids is required (comma-separated, e.g. R-375,R-377)");
if (!status && !comment) halt("nothing to do — pass --status and/or --comment");

for (let attempt = 1; attempt <= MAX; attempt++) {
  let cur;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("GET returned " + r.status);
    cur = await r.json(); // { rev, doc }
  } catch (e) {
    halt("cannot read redline server at " + url + " — is it running? (" + e.message + ")");
  }

  const doc = cur.doc;
  const ts = new Date().toISOString();
  const found = new Set();
  for (const a of doc.annotations) {
    if (!ids.includes(a.id)) continue;
    found.add(a.id);
    if (status) a.status = status;
    if (comment) { a.thread = a.thread || []; a.thread.push({ author, ts, text: comment }); }
    a.updatedAt = ts;
  }
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) halt("id(s) not found: " + missing.join(", ") + " — refusing to write anything.");

  const put = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRev: cur.rev, doc }),
  });
  if (put.status === 200) {
    const j = await put.json();
    console.log(
      "OK: " + ids.join(", ") +
      (status ? " -> status=" + status : "") +
      (comment ? " (+comment)" : "") +
      "; rev " + j.rev + (attempt > 1 ? " (after " + attempt + " tries)" : "")
    );
    process.exit(0);
  }
  if (put.status === 409) continue; // someone else wrote; refetch + reapply
  halt("PUT failed with status " + put.status);
}
halt("could not save after " + MAX + " attempts (heavy write contention) — wait a moment and retry.");
