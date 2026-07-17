# Site Redliner

Live markup layer over a web app. Run a local proxy in front of the site, draw
numbered annotation boxes on the real pages, and let your coding agent (e.g. a
Claude Code instance) read/write the same annotations to propose, clarify,
implement, and report changes.

## Quick start

Requires Node 18+. Nothing to install.

    git clone https://github.com/blaizew/site-redliner && cd site-redliner
    node server.js --target https://your-site.example.com
    # open http://localhost:4600

For a separate project workspace, create a folder anywhere, copy
`config.example.json` into that folder as `config.json`, edit the target/port/author,
and run the server from that folder:

    mkdir my-redline-workspace && cd my-redline-workspace
    cp /path/to/site-redliner/config.example.json config.json
    node /path/to/site-redliner/server.js

`annotations/` and `export/` are created in the workspace. The clone-and-run path
above still works: the repo folder is also a valid workspace because
`config.json`, `annotations/`, and `export/` are gitignored. Point either mode at
a local dev build with `--target http://localhost:5173`.

## Starting a new project redline

For anything you'll return to — an ongoing engagement, a recurring review — set up a
dedicated **workspace folder** instead of running against the repo. The tool never holds
project data; each redline runs against its own workspace. The one step that turns
"scratch markup" into "a project" is the `WORKSPACE.md` (step 3).

1. **Make a workspace folder outside this repo.** Keep client/project data out of the
   tool's own repo.
2. **Add `config.json`** (copy `config.example.json`): set `target`, `port`, `author`.
3. **Write a `WORKSPACE.md` in the folder** — the project's own contract. `SKILL.md`
   tells your agent to read it FIRST, and it extends/overrides the generic contract.
   Copy `WORKSPACE.template.md` from this repo and fill in the headings: how to get past
   the target's auth gate, the route/navigation map, the target repo's branch/PR/ticket
   conventions, and your export format.
4. **Start the server from the folder** (or `--workspace <dir>`). `annotations/` and
   `export/` are created there; the annotations file is auto-named
   `annotations/<target-host>.json`.
5. **Log in once if the target is auth-gated.** Claude-in-Chrome drives your real Chrome,
   so a session you're already signed into carries through; with the browse-multi headless
   fallback, save a session cookie and pass it in. Cookies pass through the proxy either way.
6. **Populate annotations** — mark up live (`b`), have your agent seed proposals ("Read
   SKILL.md and process the redline annotations"), or import an existing audit backlog with
   `tools/import-audit.js`.

## Using the overlay

- **`** (backtick) — toggle the review panel
- **↑/↓ (or j/k) / Enter** — move through findings, jump to the box
- **a / e / r** — approve / edit / reject a proposal · **u** — reopen (undo a decision)
- **o** — answer a question · **c** — comment · **v** — mark verified · **x** — delete yours
- **b** — draw mode: Option-click an element or drag a box, type the instruction — the action dropdown sets the export color (auto infers it from your verb)
- **p** — page index (which pages still have open items)
- **h** — view done: reveal the on-page boxes for verified/rejected findings (hidden by default so closed work doesn't clutter the page)

Box colors: amber = open (a proposal awaiting your triage, or your instruction queued for the agent) · purple = question waiting on you · green = approved ·
gray = rejected · blue = implemented · teal = verified.

Findings whose text isn't visible on the page (e.g. hover-tooltip copy) can't be
boxed — they appear under **Orphaned** at the bottom of the panel instead. Never lost.

## Working with your coding agent

Annotations live in the workspace at `annotations/<target-host>.json` — your
agent reads and writes that file directly. Tell it: "Read SKILL.md in this repo
and process the redline annotations." SKILL.md is the full agent contract.

## Exporting for review (issue trackers etc.)

1. Capture marked-up screenshots: drive a browser (Claude-in-Chrome, or browse-multi as a
   headless fallback) to
   `localhost:4600/__redline/shot?statuses=all&to=<url-encoded path>` (e.g.
   `to=%2Fapp%23%2Fhome`), then screenshot the page it lands on.
   This stores shot mode in `sessionStorage` before redirecting in, so it
   survives an app's own landing/consent redirect rewriting the URL out from
   under `?__redline=shot` (which is why that param alone doesn't engage shot
   mode on pages behind such a gate). Exit shot mode via
   `localhost:4600/__redline/unshot`, or just open a fresh tab.
   - The legacy `?__redline=shot` query param (e.g.
     `localhost:4600/app?__redline=shot#/home`) still works directly
     on pages that don't rewrite their URL on load.
2. From the workspace, `node /path/to/site-redliner/tools/export-md.js --file annotations/<f>.json`
   → per-page tables whose numbers match the screenshot badges. Red = remove,
   orange dashed = edit, green = add.

## Notes

- One annotations file per user per target — no shared server, no merge story.
  Share by exporting or passing the file.
- The proxy strips CSP headers and rewrites cookies so password gates work on localhost.
- Nothing is ever written to the target site or its repo by this tool.
