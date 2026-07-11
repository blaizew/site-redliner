---
name: redline
description: Process redline annotations - a live markup layer over a proxied web app where a human draws numbered instruction boxes and the agent proposes, clarifies, implements, and reports changes through a shared JSON file. Use when asked to "process the redline annotations", "seed proposals into redline", "implement the approved redline changes", or "export the redline ticket".
---

# Site Redliner — Agent Contract

The annotations file (`annotations/<target-host>.json` in the active workspace)
is your API. The human's browser (via the proxy at localhost:4600) and you both
read/write it; the browser picks up your changes within ~2 s.

**Project workspaces:** the workspace is the server cwd unless `--workspace`
points elsewhere. If you are working in a project workspace directory (a folder
holding that project's `config.json` / `annotations/`), check it for a
`WORKSPACE.md` and read it FIRST — it carries the project-specific rules (target
auth, repo and PR conventions, ticket/export format, route map) that extend and
override this generic contract.

**How you WRITE the annotations file depends on whether anyone else is writing at the same time:**

- **Single agent, no one else active** — you may edit the file directly: read the CURRENT
  file, apply your change, write the whole file back atomically (temp + rename), never
  regenerate content you didn't change.
- **Concurrent / multi-agent** (two+ sessions running, or the human is triaging in the browser
  while you work) — **NEVER write the file directly.** A direct write has no conflict check and
  silently clobbers other writers (lost updates — this cost a full day once). Write ONLY through
  the server's PUT endpoint, which guards every write with a revision and rebase-retries on
  conflict (the same optimistic-concurrency mechanism the browser's `RL.put` uses). Use the
  helper:

  ```
  node /path/to/site-redliner/tools/set-status.mjs --ids R-375,R-377 --status implemented --comment "PR #124"
  ```

  It GETs the current doc+rev, applies ONLY the ids you name, PUTs with that baseRev, and retries
  on 409 (up to 12×) by re-fetching and re-applying — so many agents can write at once with no
  lost updates. **Only ever pass your OWN item ids.** `--status` and `--comment` are both optional
  (do at least one). This is the safe path; direct file writes are the single thing never to do
  under concurrency.

## Schema (per annotation)

id "R-###" · author · kind instruction|proposal · surface · route · page ·
state{} · anchor{text, textJa?, selector?, scope?"overlay"|"page", rect{xPct,yPct,wPct,hPct}} ·
body{instruction?|current+proposed, action?} · status · editedText? ·
prevStatus? · thread[{author,ts,text}] · source · hint? · why? · createdAt · updatedAt

scope marks a box drawn inside a modal overlay; overlay boxes resolve only while their modal
is open and otherwise orphan into the Flow/modal-steps bucket.

Statuses: open → (question ⇄) → approved | edited | rejected → implemented → verified.

## Who sets what

- You CREATE `kind:"proposal"` items (author "claude", status "open") — always with
  anchor.text set to the EXACT on-screen source string, textJa (or the equivalent
  translation) from the app's i18n map when known, and body.current/proposed.
- The human triages proposals (approved/edited/rejected, `u` reopens back to open) and CREATES
  `kind:"instruction"` items for you to execute.
- You NEVER change a human's triage decision. You may append thread comments anywhere.

## The clarify sweep (run BEFORE implementing anything)

1. Collect actionable items: proposals with status approved|edited, instructions with status open.
2. For each AMBIGUOUS item (unclear scope, conflicting with another item, multiple
   plausible readings): push a thread comment with your question, set
   prevStatus = current status, set status = "question". Never guess on these.
3. Proceed immediately with the unambiguous rest. Re-check questions on later passes;
   the human answers via the panel (restores status automatically).

## Implement pass

- Group actionable items by surface/page and implement them in the target site's
  own repository, following THAT repo's branch/PR/review conventions (a project
  WORKSPACE.md spells them out; when in doubt, ask).
- anchor.text is the exact on-screen source string. If the target app translates
  through a source-keyed i18n map (source string → translation), every copy change
  to a source string must also re-key its map entry, or the translated view silently
  falls back to the source language.
- After the change is shipped (branch/PR up): set each item status = "implemented"
  and append a thread comment with the PR/commit reference.
- The human flips implemented → verified after reviewing the deployed result.

## Export recipe (ticket-style review output)

1. Start the server against the target the changes shipped to. If the target is
   auth-gated, log in once through the proxy — cookies pass through, so the
   session persists for headless capture too.
2. For every surface/route that has decided items: drive a headless browser to
   `localhost:4600/__redline/shot?statuses=all&to=<url-encoded path + hash>`
   (e.g. `to=%2Fapp%23%2Fhome`). This sets `sessionStorage.__redline_shot`
   and redirects into the app, so shot mode survives an app's own
   landing/consent redirect (which can rewrite `location.search`/hash away before
   the overlay boots — the reason plain `?__redline=shot` silently fails to engage
   on pages behind such a gate). Wait ~2 s AFTER the target page fully renders —
   geometry persists automatically ~0.8 s after each render settles
   (debounced, dirty-flagged), including after clicking through consent/landing
   gates and after SPA hash-navigation, not just once at boot — then
   screenshot full page → `export/screenshots/<surface>-<route>.png`.
   - Exit shot mode by hitting `localhost:4600/__redline/unshot` (or open a fresh tab —
     sessionStorage doesn't carry across tabs/sessions).
   - GOTCHA for browser-driving agents: navigating between hash routes is a
     same-document navigation — the overlay bundle is NOT refetched. After the
     overlay code changes, force a real reload (`location.reload()`) or the tab
     keeps running the old bundle.
   - The legacy `?__redline=shot` (and `#...`) query-param path still works standalone
     on any page that doesn't rewrite its URL on load; sessionStorage is just the
     activation path that also survives a rewrite.
3. THEN run `node /path/to/site-redliner/tools/export-md.js --file annotations/<f>.json`
   from the workspace, or pass `--workspace <dir>` (order matters — the persisted
   geometry is what makes table numbers match badge numbers).
4. File the output into your tracker: attach each screenshot, then paste each
   page section (image + table). Add a "Kept (load-bearing)" section if items
   were deliberately rejected as load-bearing.

## Seeding audits or ticket backlogs

- Slop-audit format: run `node /path/to/site-redliner/tools/import-audit.js
  --findings <findings-data.js> --triage <export.json> --i18n <i18n-map.js>
  --source-prefix <name>` from the workspace, or pass `--workspace <dir>`.
  `--triage` also accepts a review tool's Export JSON directly (the
  decision/finalText shape) — the importer normalizes it (decision→status,
  finalText→editedText), so you don't need to convert it first.
- Anything else (e.g. ticket tables): write annotations directly into the
  file following the schema — source = the ticket id, kind = proposal, status = open.
  Unknown page? Leave route/page null; it appears in the panel's Unassigned bucket.
