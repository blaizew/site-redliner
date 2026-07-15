// Redline overlay — box layer: numbered, colored outlines over the live page.
(() => {
  const RL = window.__REDLINE__;
  if (!RL) return;
  const DONE_STATUSES = new Set(["verified", "rejected"]);

  // Normal-mode box color: mirrors 04-panel.js's pillClass bucketing — an
  // open proposal (needs the human's triage) and an open instruction
  // (already queued for the agent) must render in visually distinct box
  // colors, not share plain "open"'s amber. Shot mode never reaches this
  // (it colors by rl-act-* instead, see below), so this has no effect there.
  const statusClass = (a) => {
    if (a.status === "open") return "rl-st-" + (a.kind === "instruction" ? "open-instruction" : "open-proposal");
    return "rl-st-" + a.status;
  };

  RL.initBoxes = () => {
    if (RL.showDoneBoxes === undefined) {
      try { RL.showDoneBoxes = localStorage.getItem("rl-show-done") === "1"; }
      catch { RL.showDoneBoxes = false; }
    }
    const layer = document.createElement("div");
    layer.id = "__redline_boxes";
    RL.els.root.appendChild(layer);
    RL.els.boxes = layer;
    let t = null;
    // DOM-mutation / resize triggers must only re-measure boxes, never rebuild
    // the panel — RL.render() also calls renderPanel(), which replaces
    // panel.innerHTML and would blow away focus/caret in the search input.
    const schedule = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const before = RL._placementSig;
        RL.renderBoxes();
        // A modal opening/closing moves boxes in/out of the orphan set; without
        // this the panel keeps listing a now-resolved box as orphaned until the
        // next panel action (the "click the number to un-orphan it" symptom).
        // Gate on membership CHANGE so ordinary scroll/resize re-measures don't
        // rebuild the panel — and renderPanel already preserves the search
        // input's focus + caret, so the reason initBoxes originally avoided it
        // (caret loss) doesn't apply to this rare, change-only call.
        if (!RL.shot && RL._placementSig !== before && RL.renderPanel) RL.renderPanel();
      }, 120);
    };
    window.addEventListener("resize", schedule);
    // Capture phase: catches scrolls on the inner main pane (overflow:auto),
    // which don't bubble like a window scroll event would.
    document.addEventListener("scroll", schedule, true);
    const mo = new MutationObserver((muts) => {
      // Ignore mutations we caused ourselves.
      if (muts.every((m) => m.target === layer || (m.target.closest && m.target.closest("#__redline_root")))) return;
      schedule();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  };

  RL.toggleDoneBoxes = () => {
    RL.showDoneBoxes = !RL.showDoneBoxes;
    try { localStorage.setItem("rl-show-done", RL.showDoneBoxes ? "1" : "0"); } catch {}
    RL.renderBoxes();
  };

  RL.renderBoxes = () => {
    const layer = RL.els.boxes;
    if (!layer) return;
    layer.innerHTML = "";
    // One scroller lookup per render pass — RL.rectOf/viewportToRectPct reuse
    // it (RL._scroller) so every anchor resolved in this pass agrees on the
    // same container, even though mainScroller() walks the whole DOM.
    RL._scroller = RL.mainScroller();
    RL._overlay = RL.openOverlay();
    const c = RL._scroller;
    const o = RL.scrollerOrigin(c);

    // Shared by both element-anchored and rel-anchored branches below: true
    // if the container-relative % rect moved since the last render pass.
    const rectMoved = (prevRect, rect) =>
      !prevRect ||
      prevRect.xPct !== rect.xPct ||
      prevRect.yPct !== rect.yPct ||
      prevRect.wPct !== rect.wPct ||
      prevRect.hPct !== rect.hPct;

    const annos = RL.visibleAnnos ? RL.visibleAnnos() : RL.forPage();
    RL.orphans = [];
    RL.suppressed = []; // page boxes hidden while a modal covers the base surface
    const placed = new Map(); // id → {rect, fellBack, gbcr?}
    for (const a of annos) {
      const M = RL._overlay;
      if (M) {
        a.anchor = a.anchor || {};
        // Legacy box (no scope yet): confirm it's a modal box ONLY on a positive
        // match inside the open modal, and only ever persist "overlay". A non-match
        // is ambiguous — it could be a base box, OR a modal box whose step isn't the
        // one currently showing (multi-step flows) — so leave it unscoped; it can
        // still migrate when its step appears. We must NOT persist "page": an
        // unscoped box already behaves as page in resolve, and locking it in would
        // strand a later-step modal box on the base page forever (the P1 bug).
        if (a.anchor.scope !== "overlay") {
          const asOverlay = RL.resolve({ ...a, anchor: { ...a.anchor, scope: "overlay" } });
          if (asOverlay) { a.anchor.scope = "overlay"; RL._anchorsDirty = true; }
        }
        // Anything not confirmed as an overlay box is hidden while the modal is up:
        // base boxes belong to the covered surface, and an unconfirmed (possibly
        // wrong-step) modal box must not draw over the modal either (P2 bleed-through).
        if (a.anchor.scope !== "overlay") { RL.suppressed.push(a); continue; }
      }
      const res = RL.resolve(a);
      if (!res) { RL.orphans.push(a); continue; }
      if (res.el && res.rel) {
        // Freeform box anchored element-relatively (05-draw.js): project the
        // stored offset/scale against the REFERENCE element's live box —
        // res.el is the reference, not the annotated region — so the box
        // reflows with layout changes (panel squeeze, resize) the same way
        // element-anchored boxes do.
        const R = res.el.getBoundingClientRect();
        const box = {
          left: R.left + res.rel.dx * R.width,
          top: R.top + res.rel.dy * R.height,
          width: res.rel.dw * R.width,
          height: res.rel.dh * R.height,
        };
        const rect = RL.viewportToRectPct(box.left, box.top, box.width, box.height);
        a.anchor = a.anchor || {};
        const changed = rectMoved(a.anchor.rect, rect);
        const selectorChanged = res.refreshedSelector && res.refreshedSelector !== a.anchor.refSelector;
        // Self-healing refText snapshot (fuzzy ref matching, see 02-anchor.js
        // RL.resolve): a volatile row (e.g. a live timer) means refText goes
        // stale on nearly every render, so re-snapshotting it is expected and
        // must dirty-flag like rect/selector so it actually persists.
        const refTextChanged = res.refreshedRefText && res.refreshedRefText !== a.anchor.refText;
        // Same self-healing for the ref's captured size (02-anchor.js's size
        // gate) — keeps refW/refH tracking the ref element's current box so
        // the gate stays meaningful (and legacy annotations gain refW/refH
        // the first time they successfully resolve).
        const refWChanged = res.refreshedRefW != null && res.refreshedRefW !== a.anchor.refW;
        const refHChanged = res.refreshedRefH != null && res.refreshedRefH !== a.anchor.refH;
        if (changed || refWChanged || refHChanged) RL._anchorsDirty = true;
        a.anchor.rect = rect; // container-% of the PROJECTED box, kept fresh
        if (res.refreshedRefW != null) a.anchor.refW = res.refreshedRefW;
        if (res.refreshedRefH != null) a.anchor.refH = res.refreshedRefH;
        // Anti-poison: an un-scoped box hasn't been confirmed page-vs-overlay yet
        // (no modal has ever been open this session to run the 2b migration) —
        // freeze its refText/refSelector snapshot so a wrong resolve can't
        // permanently weld it to a look-alike before it migrates. Rect/size
        // tracking above stays unconditional (geometry only, not identity).
        if (a.anchor.scope) {
          if (selectorChanged || refTextChanged) RL._anchorsDirty = true;
          if (res.refreshedSelector) a.anchor.refSelector = res.refreshedSelector;
          if (res.refreshedRefText) a.anchor.refText = res.refreshedRefText;
        }
        placed.set(a.id, { fellBack: false, gbcr: box });
      } else if (res.el) {
        const rect = RL.rectOf(res.el);
        a.anchor = a.anchor || {};
        const changed = rectMoved(a.anchor.rect, rect);
        const selectorChanged = res.refreshedSelector && res.refreshedSelector !== a.anchor.selector;
        if (changed) RL._anchorsDirty = true;
        a.anchor.rect = rect; // keep geometry fresh (persisted on next PUT)
        // Anti-poison (same reasoning as the rel branch above): freeze the
        // selector heal until a real scope is set.
        if (a.anchor.scope) {
          if (selectorChanged) RL._anchorsDirty = true;
          if (res.refreshedSelector) a.anchor.selector = res.refreshedSelector;
        }
        // Live viewport coords for the box itself — independent of the
        // container-relative % stored above, so the box tracks the element
        // exactly even mid-scroll or mid-resize.
        placed.set(a.id, { fellBack: false, gbcr: res.el.getBoundingClientRect() });
      } else {
        // Positioned by stored rect only. If it HAD a text/selector anchor that
        // failed, flag it visually — the element may have moved or changed.
        const an = a.anchor || {};
        placed.set(a.id, { rect: res.rect, fellBack: !!(an.text || an.textJa || an.selector) });
      }
    }

    // Number placed items in shared deterministic order (rects just refreshed).
    RL.pageNumbers = new Map();
    const ordered = redlineOrder(annos.filter((a) => placed.has(a.id)));
    ordered.forEach((a, i) => {
      const n = i + 1;
      RL.pageNumbers.set(a.id, n);
      // Done items (verified/rejected) keep their panel number but draw no on-page
      // box unless the reviewer toggles them on (h). Never suppress in shot mode —
      // export relies on the shot statuses filter, not this flag.
      if (!RL.shot && !RL.showDoneBoxes && DONE_STATUSES.has(a.status)) return;
      const info = placed.get(a.id);
      const box = document.createElement("div");
      box.className =
        "rl-box " +
        (RL.shot ? "rl-act-" + RL.deriveAction(a) : statusClass(a)) +
        (info.fellBack ? " rl-stale" : "");
      if (info.gbcr) {
        // Placed element: live viewport coords, straight from the DOM.
        const r = info.gbcr;
        box.style.left = r.left + "px";
        box.style.top = r.top + "px";
        box.style.width = r.width + "px";
        box.style.height = r.height + "px";
      } else {
        // Rect-fallback (orphaned selector/text, or a manually-drawn box):
        // map the stored container-relative % back to current viewport coords.
        const rect = info.rect;
        box.style.left = (rect.xPct / 100) * c.scrollWidth - c.scrollLeft + o.left + "px";
        box.style.top = (rect.yPct / 100) * c.scrollHeight - c.scrollTop + o.top + "px";
        box.style.width = (rect.wPct / 100) * c.scrollWidth + "px";
        box.style.height = (rect.hPct / 100) * c.scrollHeight + "px";
      }
      // Box layer is position:fixed/inset:0 (overlay.css), so these are
      // viewport-relative — off-viewport boxes are still appended (harmless,
      // e.g. clipped by the layer's overflow, no need to cull them here).
      box.dataset.rlId = a.id;
      const badge = document.createElement("span");
      badge.className = "rl-badge";
      badge.textContent = String(n);
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        if (RL.openPanelAt) RL.openPanelAt(a.id);
      });
      box.appendChild(badge);
      layer.appendChild(box);
    });

    // Shot mode: geometry just refreshed above may differ from what's persisted
    // (e.g. the app rendered its real page after a consent/landing gate, or an
    // SPA hash-navigation swapped content). Debounce a PUT rather than persisting
    // on every render — see RL.schedulePersist in 06-shot.js for the loop-safety
    // invariant that keeps this from firing forever.
    if (RL.shot && RL._anchorsDirty && RL.schedulePersist) RL.schedulePersist();

    // Signature of which annotations are currently orphaned — lets the mutation/
    // scroll/resize path below detect a modal open/close (boxes moving in/out of
    // the orphan set) and refresh the panel, without rebuilding it on every pass.
    RL._placementSig = [...RL.orphans, ...RL.suppressed].map((a) => a.id).sort().join(",");
  };

  RL.flashBox = (id) => {
    const box = RL.els.boxes && RL.els.boxes.querySelector('[data-rl-id="' + id + '"]');
    if (!box) return;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    box.classList.add("rl-flash");
    setTimeout(() => box.classList.remove("rl-flash"), 1600);
  };
})();
