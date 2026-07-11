# Site Redliner — Design Spec

**Date:** 2026-07-05
**Status:** Shipped (v1)
**Owner:** Blaize Wallace

## What it is

A live markup layer over a web app. A local zero-dependency proxy serves the real site (a deployed target or a local dev server) with an injected overlay that lets a human draw numbered, anchored annotation boxes on any page and lets a coding agent read and write the same annotations through a JSON file on disk. Human and agent converge on a finalized change list; the agent implements approved changes and exports business-reviewable output (marked-up screenshots + before/after tables) to an issue tracker.

Replaces screenshot-per-finding static review tools with a single live surface where **all change areas on a page are outlined at once**.

## Goals

1. The human marks up any page of the live site: draw a box, get a number, type an instruction ("remove", "change the translation to …").
2. The agent proposes changes the same way: numbered boxes + current→proposed text, triaged in-page with a keyboard flow (j/k, a/e/r).
3. Both sides see each other's annotations near-live (file ↔ browser sync within ~2s).
4. Existing audit backlogs seed in via the importer, carrying over prior triage decisions.
5. Output for a business/review audience: tracker tickets with marked-up page screenshots + numbered before/after change tables (numbering matches the boxes).
6. Packaged so any teammate can run it with their own coding-agent instance: clone → `node server.js` → open browser; `SKILL.md` teaches their agent the workflow.

## Non-goals (v1)

- No multi-user shared state / merge story. One annotations file per user per target; sharing = export or passing the file around. Deliberate YAGNI.
- No forcing open hover tooltips from the injected script. Tooltip findings box the ⓘ trigger; the panel carries the full text diff.
- No writes to the target site or its repo. The redliner is local-only tooling with zero footprint in the reviewed product's codebase.
- No auth/deployment of the redliner itself. It runs on localhost only.

## Decisions made (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Audience | One human + their agent; team-distributable packaging | Team use = same local setup per teammate |
| Repo home | Standalone repo; never committed into the reviewed product's repo | Zero footprint in the reviewed codebase |
| Approach | Injection proxy + live overlay | Live, bidirectional, structured; no vision/token cost in either direction; works against deployed targets. Rejected: static annotated screenshots (stale, pixel-ambiguous human markup), hosted review toolbars (can't see arbitrary targets, agent can't create threads, unstructured) |
| Primary anchor | Text snippet (source language + translation) | Survives reflows and language toggles; in source-keyed i18n apps the source string doubles as the code lookup key, so text → code mapping is mechanical |
| Agent interface | The JSON file on disk, not HTTP | Any coding-agent instance can participate by reading/writing a file; no client library needed |

## Architecture

```
Browser (localhost:4600)
   │  real site pages + injected /__redline/overlay.js
   ▼
server.js  ── proxies ──▶  target (https://site.example.com  OR  http://localhost:5173)
   │
   ├─ injects <script src="/__redline/overlay.js"> into HTML responses; strips CSP headers
   ├─ passes cookies through (password gates work normally)
   └─ /__redline/* API: GET/PUT annotations (atomic file writes), GET poll endpoint (~2s pickup)
   ▲
annotations/<target>.json  ◀── read/written directly by the agent (the agent API)
```

- **server.js**: Node ≥18, stdlib only (`http`, `https`, `fs`). No npm install — zero supply-chain surface and trivially clonable.
- Target switchable per run: `node server.js --target https://site.example.com` (review deployed state) or `--target http://localhost:5173` (review a working branch).
- HTML injection only on `text/html` responses; everything else streams through untouched.
- CSP headers stripped at proxy so the injected same-origin script always runs. Service workers: verify absence on the target stack day one.

### Folder layout

```
site-redliner/
  server.js               # proxy + API, zero-dep
  overlay/                # injected UI (JS + CSS)
  annotations/            # per-target JSON state (gitignored)
  config.json             # default target, port, author (gitignored; see config.example.json)
  README.md               # human setup guide
  SKILL.md                # agent contract: schema, statuses, workflow, export recipe
  tools/import-audit.js   # audit findings + triage export → annotations
  tools/export-md.js      # annotations → per-page markdown change tables
  docs/DESIGN.md          # this file
```

## Data model

`annotations/<target>.json`:

```json
{
  "version": 1,
  "target": "https://site.example.com",
  "annotations": [
    {
      "id": "R-014",
      "author": "human | claude",
      "kind": "instruction | proposal",
      "surface": "app",
      "route": "home",
      "state": { "persona": "admin", "lang": "ja" },
      "anchor": {
        "text": "Exact source-language string (primary)",
        "textJa": "対応する翻訳（アプリのi18nマップから自動付与）",
        "selector": "cached CSS selector (secondary)",
        "rect": { "xPct": 12, "yPct": 30, "wPct": 40, "hPct": 8 }
      },
      "body": {
        "instruction": "free text (kind=instruction)",
        "current": "…", "proposed": "…"
      },
      "status": "open | question | approved | edited | rejected | implemented | verified",
      "editedText": "present when status=edited",
      "thread": [ { "author": "claude", "ts": "ISO-8601", "text": "PR #112" } ],
      "source": "audit BK1 | TICKET-123 | manual",
      "createdAt": "ISO-8601", "updatedAt": "ISO-8601"
    }
  ]
}
```

- **kind=proposal** (agent-authored): carries `current`/`proposed`; human triages → `approved` / `edited` (+`editedText`) / `rejected`.
- **kind=instruction** (human-authored): free-text directive; agent executes → `implemented`, PR link in `thread`.
- **status=question**: the agent found the item ambiguous during its clarify sweep — it posts the question into `thread` and sets this status (distinct color in the overlay). The human answers in the thread (or chat) and flips it back to `open`/`approved`; the agent never guesses on a `question` item.
- **Anchor resolution order at render time:** selector → text (source language, then translation) → rect. The selector is only a fast cache — text is the durable primary anchor: whenever the selector misses but text matches, re-anchor succeeds and the cached selector is refreshed. No match on any rung → flagged **orphaned** in the panel (page changed since annotation), never silently dropped.
- Freeform boxes (whitespace, regions, "this whole card") are rect-only by design.
- Display numbers are per-page render order, assigned at render/export time — not stored.
- Writes are last-writer-wins whole-file atomic replaces (temp file + rename), single user per file (see Non-goals).

## Overlay UX

- **Toggle:** backtick (`` ` ``) or floating button → side panel. Page remains fully interactive underneath.
- **Panel:** annotations for the current route; `j/k` navigate, `Enter` jump + flash box, `a/e/r` triage proposals, `c` comment, `/` search; filters by status/author. A **page index** lists every route with outstanding-item counts — the "walk all pages with open items" view.
- **Boxes:** numbered outlines over live elements, color-coded by status (open amber, approved green, rejected gray, implemented blue, verified checkmark). Hover = summary tooltip.
- **Draw mode (`b`):** option-click snaps to the element under the cursor (captures selector + trimmed text snippet + rect); click-drag draws freeform (rect only); an inline input takes the instruction text; ESC cancels.
- **SPA-aware:** re-resolves and re-renders boxes on `hashchange` and via a MutationObserver (routes render asynchronously).
- **Live sync:** overlay polls the server (~2s); agent file edits appear without reload. PUTs are whole-file with a revision check (409 on stale → reload + retry).
- **Export mode** (`?__redline=shot`): boxes + numbers only, panel and controls hidden — the clean marked-up page for screenshots.

## The collaboration loop

1. **Seed** — agent writes proposals into the file (audit imports or fresh review work).
2. **Triage/markup** — human browses the proxied site: triages proposals in-page, draws instructions.
3. **Clarify sweep** — before touching code, the agent reads every actionable item (`approved`/`edited` proposals, open `instruction`s). Ambiguous ones get a question posted in-thread + status `question`; everything unambiguous proceeds without waiting. Batched and targeted — no blanket review gate, no mid-implementation guessing. (Decided 2026-07-05: clarify-before beats ask-during — questions asked mid-build arrive after context has formed around a wrong reading; a formal review step for every item taxes the clear majority. The PR/localhost gate remains the second net.)
4. **Implement** — agent groups actionable items by surface/ticket, implements in the target site's repo per that repo's own branch/PR rules, flips items to `implemented` with PR links in threads.
5. **Verify** — after merge/deploy, human re-opens against the deployed target and marks `verified`.
6. **Report** — the agent runs the tracker export (below) whenever business-side review is needed. (Agent-run, not a panel button: the export requires screenshot capture + tracker upload, which are agent work anyway.)

## Tracker export (business review output)

Per page:

1. Page heading + color key: **red solid = remove · orange dashed = edit/change · green = add**.
2. The annotated screenshot: agent drives a headless browser through the proxy in export mode; boxes and numbered badges are baked in by the browser renderer (no LLM vision cost in either direction). Export-mode boxes are **action-colored** (red/orange/green + circular number badges), not status-colored like the live triage view.
3. The change table, numbers matching the boxes, multi-number rows allowed ("2, 3" when one change covers several boxes): **# | Action | Element | Before | After | Why**. Before/After carry the copy diff for edits; Before alone describes removals; Why is the one-line rationale.
4. Optional **"Kept (load-bearing)"** section listing what was deliberately not touched.

- Default export filter: `approved` / `edited` / `implemented` — the decided set, not raw triage noise. Flag to include all.
- Screenshots attach via your tracker's upload flow; ticket body = per-page sections as above. Numbering frozen at export time so image and table always agree.

## Seeding (first run against an existing review backlog)

1. Export prior triage from whatever review tool held it (the importer accepts both a keyed statuses shape and a decision/finalText export shape).
2. `tools/import-audit.js` ingests a findings file (`window.SLOP_FINDINGS` with id/area/screen/location/current/proposed) + the triage export → annotations with statuses carried over.
3. The importer attaches translations by looking up each `current` string in the app's i18n map (read-only, path via flag).
4. Old static review tools retire after import is verified (spot-check counts + a sample of carried-over statuses).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| CSP blocks injected script | Proxy strips CSP headers; verify against the real target on day one |
| Target password gate | Cookies pass through the proxy; log in once through it |
| Anchors break when pages change | Resolution ladder (selector→text→rect) + explicit orphaned state |
| Translated view can't match source-language text anchors | Translation auto-attached from the app's i18n map at import/creation |
| Hover-only copy not visible in-page | Box the ⓘ trigger; full diff lives in the panel and export table |
| Concurrent writes (human tab + agent) | Revision check on PUT (409 → reload/retry); agent writes route through the guarded endpoint under concurrency |
| Screenshot/table drift | Numbering frozen at export time; single export pass produces both |

## Size estimate

server.js ~200 lines · overlay ~700 · importer ~150 · exporter ~100. All stdlib.
