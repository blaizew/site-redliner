// Redline overlay — anchoring: selector builder, text search, resolution ladder.
(() => {
  const RL = window.__REDLINE__;
  if (!RL) return;

  RL.buildSelector = (el) => {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.body && parts.length < 6) {
      if (n.id) { parts.unshift("#" + CSS.escape(n.id)); break; }
      let part = n.tagName.toLowerCase();
      const parent = n.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === n.tagName);
        if (sibs.length > 1) part += ":nth-of-type(" + (sibs.indexOf(n) + 1) + ")";
      }
      parts.unshift(part);
      n = parent;
    }
    return parts.join(" > ");
  };

  const needleOf = (text) => (text || "").trim().slice(0, 120);

  // The topmost open modal overlay, or null. In this app a modal is an UNLABELED
  // fixed <div> (no role/aria/class) whose backdrop covers the whole viewport;
  // nothing else fixed covers ≥60% when no modal is open (verified both states).
  // Excludes redline's own fixed DOM (panel/FAB/capture). Requires ≥1 child so a
  // bare decorative full-screen fixed layer wouldn't count as a modal.
  RL.openOverlay = () => {
    const area = (window.innerWidth * window.innerHeight) || 1;
    let best = null, bestCov = 0;
    for (const el of document.querySelectorAll("*")) {
      if (el.closest && el.closest("#__redline_root")) continue;
      // Browser-automation artifact (Claude-in-Chrome's control-indicator border):
      // a full-viewport fixed div that isn't app UI. Never treat it as a modal.
      if (el.id === "claude-agent-glow-border") continue;
      if (el.childElementCount === 0) continue;
      const s = getComputedStyle(el);
      if (s.position !== "fixed") continue;
      // A real modal backdrop CAPTURES pointer events (it blocks the content behind
      // it — clicking it is how you dismiss the modal). Decorative full-screen fixed
      // overlays (glow borders, gradients) are pointer-events:none — skip them.
      if (s.pointerEvents === "none") continue;
      const r = el.getBoundingClientRect();
      const cov = (r.width * r.height) / area;
      if (cov >= 0.6 && cov > bestCov) { best = el; bestCov = cov; }
    }
    return best;
  };

  // Tokenized overlap scorer — tolerant alternative to exact substring
  // matching for rel-anchored ref elements. Rows containing VOLATILE text
  // (e.g. a live "delivered 4m 38s" timer) change on every tick, so an exact
  // `textContent.includes(refText)` check breaks the moment the snapshot
  // goes stale. Instead, score how much of the ORIGINAL ref text's word
  // tokens (len >= 3, so short volatile fragments like "4m"/"38s" don't
  // dominate the score) still appear in the candidate's current text.
  const refTokens = (t) => (t || "").split(/\s+/).filter((w) => w.length >= 3);
  const refScore = (needleText, el) => {
    const toks = refTokens(needleText);
    if (!toks.length) return 0;
    const hay = el.textContent || "";
    return toks.filter((w) => hay.includes(w)).length / toks.length;
  };
  RL.refTokens = refTokens;
  RL.refScore = refScore;

  // Attribute-borne label of a form control: the value of a submit/button/reset
  // input (its rendered label), else aria-label. Complements text-node matching —
  // these controls have no text node carrying their visible label.
  const attrLabelOf = (el) => {
    if (el.tagName === "INPUT" && /^(submit|button|reset)$/i.test(el.type)) return el.value || "";
    return el.getAttribute && (el.getAttribute("aria-label") || "");
  };

  // Element containing the needle (overlay's own DOM excluded).
  // Selection order: (1) exact match — a node whose trimmed textContent or
  // attribute label equals the needle wins immediately; it's unambiguous.
  // (2) Otherwise the candidate with the SHORTEST trimmed textContent/label
  // wins (ties keep the first encountered) — less surrounding text means a
  // more specific node.
  // This avoids prefix collisions: a short needle like "Your customers" is
  // also a substring of an unrelated, larger block ("Your customers move
  // money and hold...") that can appear earlier in the DOM than the actual
  // "Your customers" heading — shortest-containing picks the heading.
  // Needles are truncated to 120 chars (see needleOf), so long paragraphs
  // never hit the exact-match branch; for those the paragraph's own text
  // node is the shortest node containing the needle, so behavior for
  // long-text anchors is unchanged.
  RL.findByText = (text, accept) => {
    const needle = needleOf(text);
    if (!needle) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let best = null;
    let bestLen = Infinity;
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!el || el.closest("#__redline_root")) continue;
      if (accept && !accept(el)) continue;
      // Skip candidates with no rendered box — display:none templates,
      // detached nodes (zero client rects), or a hidden tooltip's copy that's
      // measurable but effectively zero-size. Without this, a hit here can
      // produce a thin "ghost" box at the wrong position.
      const rects = el.getClientRects();
      if (rects.length === 0 || rects[0].width < 2 || rects[0].height < 2) continue;
      const content = walker.currentNode.textContent || "";
      if (!content.includes(needle)) continue;
      const trimmed = content.trim();
      if (trimmed === needle) return el; // exact match — unambiguous, return immediately
      if (trimmed.length < bestLen) {
        best = el;
        bestLen = trimmed.length;
      }
    }
    for (const el of document.querySelectorAll('input[type=submit i],input[type=button i],input[type=reset i],[aria-label]')) {
      if (el.closest("#__redline_root")) continue;
      if (accept && !accept(el)) continue;
      const rects = el.getClientRects();
      if (rects.length === 0 || rects[0].width < 2 || rects[0].height < 2) continue;
      const label = (attrLabelOf(el) || "").trim();
      if (!label.includes(needle)) continue;
      if (label === needle) return el;
      if (label.length < bestLen) {
        best = el;
        bestLen = label.length;
      }
    }
    return best;
  };

  // Size gate: does el's own rendered box plausibly match a ref captured at
  // refW x refH (both within 2x either direction)? This is what stops a
  // token-overlap match from validating against an ANCESTOR row/card just
  // because it contains the same text as the small span the user actually
  // drew on — the ancestor's box is typically many times larger. Legacy rel
  // annotations captured before refW/refH existed pass refW/refH as
  // null/undefined here, in which case the gate is a no-op (current
  // behavior for old annotations is preserved).
  const sizeGateOk = (rect, refW, refH) => {
    if (refW == null || refH == null) return true;
    return (
      rect.width >= 0.5 * refW && rect.width <= 2 * refW &&
      rect.height >= 0.5 * refH && rect.height <= 2 * refH
    );
  };
  RL.sizeGateOk = sizeGateOk;

  // Ambiguous-selector disambiguation: cached selectors are un-rooted
  // positional paths (buildSelector caps its walk at 6 levels), so a page
  // with repeated components — e.g. two identical 23x23 InfoTip icons, one
  // per h1 — yields MULTIPLE matches for the same selector, and first-match
  // querySelector picks whichever is earliest in document order, not the one
  // the user drew on. Text and size can't break the tie for icons (refText
  // is empty, both icons are identical), but the stored draw-time rect can:
  // pick the candidate whose geometry (projectPct — the caller supplies the
  // projection appropriate to its anchor type) lands closest to it.
  // Manhattan distance on the container-% top-left; candidates on this page
  // separate by whole percentage points while legitimate reflow drift stays
  // small, so nearest-wins needs no absolute threshold. Zero or one
  // candidate, or no stored rect (never persisted): first match, the
  // pre-existing behavior. (Origin: R-379 — a box drawn on the "Receive"
  // h1's info icon rendering on the page header's identical icon instead.)
  const closestToRect = (cands, storedRect, projectPct) => {
    if (cands.length < 2 || !storedRect) return cands[0] || null;
    let best = null, bestD = Infinity;
    for (const el of cands) {
      const pct = projectPct(el);
      const d = Math.abs(pct.xPct - storedRect.xPct) + Math.abs(pct.yPct - storedRect.yPct);
      if (d < bestD) { best = el; bestD = d; }
    }
    return best;
  };

  // Fuzzy fallback for rel-anchored ref elements whose cached refSelector
  // misses (or is invalid/invisible). Unlike RL.findByText (exact substring,
  // used by the proposal-text ladder below — untouched), this tolerates a
  // stale refText snapshot: rows containing VOLATILE text (e.g. a live
  // "delivered 4m 38s" timer) change on every tick, so the ORIGINAL snapshot
  // is never an exact substring of the row's current text again. Candidates
  // are first narrowed by the size gate (refW/refH — the ref's dimensions at
  // draw time), THEN scored by token overlap (refScore); this ordering
  // matters because without the gate an ancestor containing the same text
  // (near-)always scores as well as the real target, and text length alone
  // doesn't reliably distinguish a padded container from its content. Ranked
  // by score desc, then by how close the candidate's height is to refH (log
  // ratio, so a candidate half as tall and one twice as tall tie — either is
  // an equally plausible near-match), then shortest textContent (same
  // specificity heuristic as findByText's shortest-wins rule).
  RL.fuzzyFindRef = (refText, refW, refH, accept) => {
    if (!refTokens(refText).length) return null;
    const refLen = (refText || "").length;
    let best = null, bestScore = 0, bestHeightDiff = Infinity, bestLen = Infinity;
    for (const el of document.querySelectorAll("*")) {
      if (el.closest && el.closest("#__redline_root")) continue;
      if (accept && !accept(el)) continue;
      const rects = el.getClientRects();
      if (rects.length === 0 || rects[0].width < 2 || rects[0].height < 2) continue;
      if (!sizeGateOk(rects[0], refW, refH)) continue;
      const len = (el.textContent || "").length;
      if (len < refLen * 0.3 || len > refLen * 4) continue;
      const score = refScore(refText, el);
      if (score < 0.6) continue;
      const heightDiff = refH != null ? Math.abs(Math.log(rects[0].height / refH)) : 0;
      const better =
        score > bestScore ||
        (score === bestScore && heightDiff < bestHeightDiff) ||
        (score === bestScore && heightDiff === bestHeightDiff && len < bestLen);
      if (better) {
        best = el;
        bestScore = score;
        bestHeightDiff = heightDiff;
        bestLen = len;
      }
    }
    return best;
  };

  // Ladder: rel-anchored reference → cached selector (validated against text)
  // → text EN → text JA → stored rect. Selector is only a cache — a text hit
  // refreshes it (see renderBoxes).
  RL.resolve = (a) => {
    const an = a.anchor || {};
    // Scope boundary: a modal overlay partitions the page. An overlay-scoped box
    // only matches inside the open modal; a page box never matches modal content.
    // Legacy boxes (no scope) are treated as "page" here — renderBoxes migrates
    // them to a real scope on the first modal-open (see 03-boxes.js).
    const scope = an.scope === "overlay" ? "overlay" : "page";
    const M = RL._overlay !== undefined ? RL._overlay : RL.openOverlay();
    // Overlay box with no modal open → its modal isn't showing. Orphan now;
    // never fall through to a base-page look-alike (that was the P1 bug).
    if (scope === "overlay" && !M) return null;
    // Every candidate must pass this: overlay box → inside M; page box → NOT
    // inside any open modal (that content belongs to the modal, not this box).
    const inM = (el) => !!(M && M.contains(el));
    const scopeOk = (el) => scope === "overlay" ? inM(el) : !inM(el);
    // Freeform boxes drawn relative to an element (an.rel set by 05-draw.js):
    // resolve the REFERENCE element here, not the annotated region itself —
    // 03-boxes.js projects the drawn rect's stored offsets against the ref's
    // live box so the box reflows with the ref's layout. Cached refSelector
    // first (validated visible + against refText via TOKEN-OVERLAP score,
    // not exact substring — a volatile row (e.g. a live timer) drifts off an
    // exact match within one tick, so refScore >= 0.6 tolerates that drift +
    // the SIZE GATE below), else a fuzzy text search when refText is
    // non-empty. Unresolved → fall through to the ladder below (rect
    // fallback).
    //
    // Size gate (an.refW/an.refH, captured at draw time — see 05-draw.js):
    // token overlap alone validates ANY ancestor of the drawn span too, since
    // an ancestor's textContent contains the same tokens as its child — that
    // was the actual mis-anchor bug (a box drawn on a ~20px span resolving
    // against a card-sized ancestor and rendering card-sized). Requiring the
    // candidate's own box to be within 2x either direction of the ref's
    // captured size rejects those oversized (or undersized) ancestors/
    // descendants while still tolerating ordinary reflow. Legacy annotations
    // with no refW/refH skip the gate entirely (sizeGateOk no-ops) — old
    // behavior is unchanged for them.
    if (an.rel) {
      let refEl = null, refreshedSelector = null;
      if (an.refSelector) {
        try {
          // ALL selector matches, filtered by the same guards a single hit
          // had to pass (visible, size gate, text score when refText is
          // non-empty — for a text-less icon the score check is vacuous and
          // the other two can't distinguish identical repeated components).
          // A hit that fails every guard is a miss — falls through to the
          // fuzzy search below rather than validating.
          const needle = needleOf(an.refText);
          const cands = [];
          for (const el of document.querySelectorAll(an.refSelector)) {
            if (el.closest("#__redline_root")) continue;
            if (!scopeOk(el)) continue;
            const rects = el.getClientRects();
            if (rects.length === 0 || rects[0].width < 2 || rects[0].height < 2) continue;
            if (!sizeGateOk(rects[0], an.refW, an.refH)) continue;
            if (needle && refScore(an.refText, el) < 0.6) continue;
            cands.push(el);
          }
          // Tie-break multiple survivors by projecting each through the
          // stored rel offsets (same math 03-boxes.js renders with) and
          // taking the one that lands nearest the stored draw-time rect.
          refEl = closestToRect(cands, an.rect, (el) => {
            const R = el.getBoundingClientRect();
            return RL.viewportToRectPct(
              R.left + an.rel.dx * R.width,
              R.top + an.rel.dy * R.height,
              an.rel.dw * R.width,
              an.rel.dh * R.height
            );
          });
        } catch { /* invalid cached selector — fall through */ }
      }
      if (!refEl && needleOf(an.refText)) {
        const el = RL.fuzzyFindRef(an.refText, an.refW, an.refH, scopeOk);
        if (el) { refEl = el; refreshedSelector = RL.buildSelector(el); }
      }
      if (refEl) {
        // Self-healing snapshot: whichever path resolved refEl, re-derive
        // the selector, refText, AND size snapshots against its CURRENT
        // state, same in-memory refresh pattern renderBoxes uses for
        // rect/selector (03-boxes.js applies these + flags RL._anchorsDirty,
        // persisted on next PUT). Refreshing refW/refH here is what lets an
        // annotation that heals onto a (legitimately) resized element keep
        // the size gate meaningful going forward, same reasoning as
        // refreshing refText for a volatile row.
        const refRect = refEl.getBoundingClientRect();
        const out = {
          el: refEl,
          rel: an.rel,
          refreshedRefText: (refEl.textContent || "").trim().slice(0, 120),
          refreshedRefW: Math.round(refRect.width),
          refreshedRefH: Math.round(refRect.height),
        };
        out.refreshedSelector = refreshedSelector || RL.buildSelector(refEl);
        return out;
      }
      // Reference element unresolved — do NOT fall through to the
      // selector/text/rect ladder below. rel-anchored boxes are almost
      // always drawn on a modal, and their stored container-% rect was
      // captured relative to the modal's own (now-gone) geometry — boxing
      // it against the page produces a solid box at a meaningless position.
      // Treat as orphaned instead: intended UX is that modal-drawn boxes
      // live in the Orphaned list while the modal is closed and re-appear
      // automatically the moment it reopens and the ref resolves again
      // (see the MutationObserver-driven re-render in 03-boxes.js).
      return null;
    }
    if (an.selector) {
      try {
        // Same ambiguous-selector handling as the rel branch above: collect
        // ALL matches passing the guards, then closestToRect breaks ties by
        // the element's own stored rect (an Option-click anchor's rect IS
        // the element's rect — no rel projection involved). A cached
        // selector pointing at an element that's no longer visible (e.g. a
        // hover-only panel that's currently closed) must not validate —
        // fall through to text search rather than boxing a hidden node.
        const needle = needleOf(an.text) || needleOf(an.textJa);
        const cands = [];
        for (const el of document.querySelectorAll(an.selector)) {
          if (el.closest("#__redline_root")) continue;
          if (!scopeOk(el)) continue;
          const rects = el.getClientRects();
          if (rects.length === 0 || rects[0].width < 2 || rects[0].height < 2) continue;
          if (needle && !(el.textContent || "").includes(needle) && !(attrLabelOf(el) || "").includes(needle)) continue;
          cands.push(el);
        }
        const el = closestToRect(cands, an.rect, (x) => RL.rectOf(x));
        if (el) return { el };
      } catch { /* invalid cached selector — fall through */ }
    }
    const el = RL.findByText(an.text, scopeOk) || RL.findByText(an.textJa, scopeOk);
    if (el) return { el, refreshedSelector: RL.buildSelector(el) };
    if (an.rect) {
      // Overlay box: only a PURE rect-only box (no selector/text to match) falls
      // back to its stored modal-relative rect while the modal is open. A box that
      // HAD a selector/text but didn't match inside the modal belongs to another
      // step (or isn't a modal box at all) — orphan it rather than pinning it at a
      // stale rect. (Without this guard every rect-bearing box "resolves" whenever a
      // modal is open, which false-migrates base boxes to overlay scope.) The rel
      // branch already returns null above, so an.rel never reaches here.
      if (scope === "overlay") {
        const hadAnchor = an.selector || an.text || an.textJa;
        return (M && !hadAnchor) ? { rect: an.rect } : null;
      }
      return { rect: an.rect };
    }
    return null; // orphaned
  };

  // The app scrolls an INNER container (overflow:auto main pane), not the
  // document body, on most surfaces — so geometry must be relative to
  // whichever element actually scrolls, not window.scroll/documentElement.
  // Prefer the document scroller if IT scrolls (rare but possible); otherwise
  // find the tallest overflow:auto/scroll/overlay descendant (overlay's own
  // DOM excluded) whose content overflows its box.
  RL.mainScroller = () => {
    const de = document.scrollingElement || document.documentElement;
    if (de.scrollHeight > de.clientHeight + 4) return de;
    let best = de, max = 0;
    for (const el of document.querySelectorAll("*")) {
      if (el.closest && el.closest("#__redline_root")) continue;
      const s = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(s.overflowY)) continue;
      if (el.scrollHeight > el.clientHeight + 4 && el.scrollHeight > max) {
        max = el.scrollHeight;
        best = el;
      }
    }
    return best;
  };

  const isDocScroller = (c) => c === document.scrollingElement || c === document.documentElement;
  // Where the scroller's own box sits in the viewport (0,0 for the document
  // scroller; its getBoundingClientRect() top/left otherwise). Shared by
  // rectOf, viewportToRectPct, and 03-boxes.js's rect-fallback placement so
  // all three agree on the same container-relative coordinate space.
  RL.scrollerOrigin = (c) => {
    if (isDocScroller(c)) return { top: 0, left: 0 };
    const g = c.getBoundingClientRect();
    return { top: g.top, left: g.left };
  };

  // Container-relative percentages — scroll-independent, ordering-stable.
  // c defaults to the render pass's cached scroller (RL._scroller, set by
  // 03-boxes.js renderBoxes) so repeated calls within one pass agree; falls
  // back to a fresh RL.mainScroller() lookup outside a render pass (e.g. draw
  // mode's Option-click path).
  RL.rectOf = (el) => {
    const c = RL._scroller || RL.mainScroller();
    const o = RL.scrollerOrigin(c);
    const r = el.getBoundingClientRect();
    const W = c.scrollWidth || 1, H = c.scrollHeight || 1;
    return {
      xPct: +((100 * (r.left - o.left + c.scrollLeft)) / W).toFixed(2),
      yPct: +((100 * (r.top - o.top + c.scrollTop)) / H).toFixed(2),
      wPct: +((100 * r.width) / W).toFixed(2),
      hPct: +((100 * r.height) / H).toFixed(2),
    };
  };

  // Same container-relative math as rectOf, but from raw viewport coords —
  // used by draw mode's freeform rubber-band (no element to read a rect from).
  RL.viewportToRectPct = (x, y, w, h) => {
    const c = RL._scroller || RL.mainScroller();
    const o = RL.scrollerOrigin(c);
    const W = c.scrollWidth || 1, H = c.scrollHeight || 1;
    return {
      xPct: +((100 * (x - o.left + c.scrollLeft)) / W).toFixed(2),
      yPct: +((100 * (y - o.top + c.scrollTop)) / H).toFixed(2),
      wPct: +((100 * w) / W).toFixed(2),
      hPct: +((100 * h) / H).toFixed(2),
    };
  };
})();
