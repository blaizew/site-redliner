# Known Issues (triaged ship-as-is at the v1 merge review)

1. **Corrupt or externally-deleted `annotations/<host>.json` crashes the server** on the
   next GET/PUT (uncaught JSON.parse/ENOENT in the request handler). Atomic writes + the
   agent contract (always write valid JSON, temp+rename) make this unlikely. Lowest-effort
   hardening if it ever bites: try/catch around `store.read()` in `lib/api.js` returning 500.
2. **Malformed CLI flags aren't validated** (`--port` with a missing/NaN value, trailing
   flag consumes the next token). The documented invocation is unaffected.
3. **Export numbering vs screenshot drift edge:** an item that resolved on a prior render
   but orphans at export time still carries a persisted rect, so `export-md` can number a
   row that's absent from the screenshot. Avoided by the documented recipe: capture
   screenshots and run `export-md` in one pass.
4. **`forPage` route fallback is not surface-aware** (latent): if a route name is ever
   reused across surfaces, annotations could bleed between pages. All current data carries
   exact `page` values, so this is dormant. Make the fallback surface-aware if it triggers.
5. **Text anchors can't match strings split across elements** (per-text-node matching) and
   fallback text search is O(DOM) on cache miss (debounced; fine at current scale).
6. **Healed-rect poisoning can lock in a wrong twin pick** (post R-379 fix): ambiguous
   selectors now tie-break by proximity to the stored draw-time rect, so that rect is
   load-bearing. Two ways it can go bad: (a) a tab still running an OLD overlay bundle
   re-heals anchors under the old first-match logic and persists them on its next PUT —
   after any overlay code change, reload every open redline tab; (b) a render that catches
   the page mid-paint can see only ONE twin (the wrong one), pick it unconditionally, and
   heal the rect onto it — after which nearest-wins is self-consistently wrong. Not
   guarded by a distance threshold because legitimate cross-viewport drift (~7 %-points
   observed) sits too close to the wrong-twin distance (~13) to separate reliably.
   Recovery: restore the annotation's draw-time rect in the JSON (incident R-379,
   2026-07-06 — poisoned via (a), repaired by hand).
