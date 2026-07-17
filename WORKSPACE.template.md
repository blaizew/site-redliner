# Redliner Workspace — <PROJECT NAME>

> Copy this file into a project workspace folder as `WORKSPACE.md`, then fill in the
> angle-bracket placeholders and delete the `>` guidance lines. `SKILL.md` (the generic
> agent contract in the tool repo) tells every agent to read this file FIRST; the rules
> here EXTEND and override that contract with the project-specific parts. Read both.

This folder is the **<project> workspace** for Site Redliner. The tool itself lives in
its own repo — keep client/project data OUT of that repo. This folder holds everything
project-specific:

- `config.json` — target, port, author
- `annotations/` — per-target annotation state. **USER DATA — never reset or regenerate.**
- `export/` — exported tickets + marked-up screenshots
- `route-map.json` *(optional)* — area/screen → surface/route/page map (pass via `--route-map`)

**Run it from this folder:**

```
cd <this folder>
node /path/to/site-redliner/server.js
```

(The tool resolves `config.json`, `annotations/`, and `export/` from cwd — or pass
`--workspace <dir>` to run from elsewhere.)

## Auth — how to get into the target

> How does a browser get past the target's login/gate? Claude-in-Chrome (the primary
> driver) operates your real Chrome, so a session you're already signed into carries
> through — note only what's extra. For the browse-multi headless fallback, note where a
> saved session cookie lives and any `sessionStorage`/`localStorage` bypass to set before
> capture. Cookies pass through the proxy either way.

- **Sign-in steps:** <e.g. click "Team access" → password `<...>` → accept disclaimer → set language toggle>
- **Saved session (browse-multi fallback):** `<path to <domain>.json>` — pass to the headless start
- **Pre-capture bypass, if any:** `js: <sessionStorage/localStorage setup>; location.reload()`

## Route / navigation map

> How do you drive the app to each surface for capture? Give the shot-mode entry URL per
> surface, and the app's OWN client-side navigation call. Do NOT navigate by
> `location.hash` — see the SPA-state-reset gotcha in `SKILL.md`'s export recipe.

- **<surface>:** shot URL `localhost:<port>/__redline/shot?statuses=all&to=<url-encoded path+hash>`; navigate in-app via `<app router call, e.g. window.SomeApi.goRoute('...')>`

## Implement — target-repo ship conventions

> How do changes ship to the TARGET's repo? Fill in the specifics; the generic implement
> pass is in `SKILL.md`.

- **Where to work:** <git worktree of the target repo vs shared checkout — and why>
- **Branch / PR:** <branch naming; draft vs ready rules; obey the target repo's own CLAUDE.md / CONTRIBUTING>
- **Ticket linking:** <tracker + id format, e.g. a `Ticket: ABC-123` line in the PR body>
- **Granularity:** <one PR per page / per surface / per ticket>
- After a PR is up: set each item `status = "implemented"` and append a thread comment with the PR/commit ref. The human flips `implemented → verified` after reviewing the deployed result.

## i18n — copy-change re-keying *(delete this section if the target isn't source-keyed)*

> If the app translates via a source-string-keyed map (source string → translation), every
> copy change to a source string must also re-key its map entry, or the translated view
> silently falls back to the source language.

- **Source screens:** `<path>`
- **Translation map(s):** `<path>`

## Export / ticket format

> Your canonical ticket format and where exports get filed. Anchor to one exemplar ticket.

- **Format:** <per-page color key · annotated screenshot · `# | Action | Element | Before | After | Why` table · optional "Kept (load-bearing)" section>
- **Destination:** <tracker; how screenshots get attached>
- **Before closing a ticket:** reconcile it with what actually shipped — every open question
  resolved inline or listed with an owner, the After column matching the merged result, the
  PR link + state set. The ticket is the client-facing record; it must read as settled facts,
  not a stale mid-flight snapshot.

## Multi-PR review status board *(optional — for review rounds spanning many PRs)*

> When a round produces many PRs, a generated, **single-writer** status board (an HTML view
> + a refresh script that pulls PR state from `gh` and open-comment counts from the
> annotations file) lets the reviewer track them from one place. Same single-writer
> discipline as the annotations file: never hand-edit the generated view, never let two
> agents write it. Note where the instance lives if you build one.
