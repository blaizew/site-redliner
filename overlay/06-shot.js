// Redline overlay — shot mode: clean marked-up page for export screenshots.
// Action-color visual language via rl-act-* classes (03-boxes switches when RL.shot set).
(() => {
  const RL = window.__REDLINE__;
  if (!RL) return;

  const DEFAULT_STATUSES = ["approved", "edited", "implemented"];

  RL.initShot = () => {
    let statuses;
    // (a) sessionStorage — set by GET /__redline/shot, survives the proxied
    // app's own landing/consent redirect rewriting location.search away.
    const stored = sessionStorage.getItem("__redline_shot");
    if (stored !== null) {
      statuses = stored === "__default__" ? DEFAULT_STATUSES : stored === "all" ? null : stored.split(",");
    } else {
      // (b) legacy location.search path — unchanged semantics. Only works on
      // pages that don't rewrite the URL before the overlay boots.
      const params = new URLSearchParams(location.search);
      if (params.get("__redline") !== "shot") return;
      const raw = params.get("statuses");
      statuses = raw === "all" ? null : raw ? raw.split(",") : DEFAULT_STATUSES;
    }
    RL.shot = { statuses };
    RL.visibleAnnos = () => {
      const page = RL.forPage();
      return statuses ? page.filter((a) => statuses.includes(a.status)) : page;
    };
    // Persist freshly-resolved rects so tools/export-md.js numbers rows exactly
    // like the badges in the screenshot taken from this render. Debounced (not
    // one-shot): renderBoxes (03-boxes.js) flags RL._anchorsDirty whenever a
    // refreshed rect/selector actually differs from what's stored, and calls
    // RL.schedulePersist() at the end of every render. This fires ~0.8s after
    // the LAST dirty render, which covers renders that happen well after boot
    // — clicking through a consent/landing gate, or an SPA hash-navigation swap.
    // Loop-safety: persistAnchors → RL.put → RL.render → renderBoxes recomputes
    // identical rects on an unchanged layout → no coordinate delta → dirty stays
    // false → no further PUT. The debounce never self-perpetuates.
    RL.schedulePersist = () => {
      clearTimeout(RL._persistT);
      RL._persistT = setTimeout(async () => {
        if (!RL._anchorsDirty) return;
        RL._anchorsDirty = false;
        await RL.persistAnchors();
      }, 800);
    };
    // Order-safety net: initShot runs before initBoxes/render in boot(), so
    // schedulePersist always exists by the time renderBoxes first runs and can
    // set the dirty flag itself. This call just covers any future re-ordering.
    RL.schedulePersist();
  };
})();
