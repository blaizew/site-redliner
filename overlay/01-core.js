// Redline overlay — core: state, API client, polling, page identity, boot.
(() => {
  if (window.__REDLINE__ || window !== window.top) return;
  const RL = (window.__REDLINE__ = {
    cfg: window.__REDLINE_CFG__ || { author: "user" },
    rev: null,
    doc: null,
    els: {},
    shot: null, // set by 06-shot.js when URL has ?__redline=shot
    orphans: [],
    pageNumbers: new Map(),
  });

  // Canonical page key, e.g. "/bank#/bank/bankhome" (hash query stripped).
  RL.pageKey = () => location.pathname + (location.hash ? location.hash.split("?")[0] : "");
  // App route = last hash-path segment, e.g. "bankhome"; pathname fallback for non-hash apps.
  RL.currentRoute = () => {
    const h = (location.hash || "").replace(/^#\/?/, "").split("?")[0];
    const segs = h.split("/").filter(Boolean);
    if (segs.length) return segs[segs.length - 1];
    const p = location.pathname.split("/").filter(Boolean);
    return p[p.length - 1] || "root";
  };
  RL.forPage = () => {
    if (!RL.doc) return [];
    const pk = RL.pageKey();
    const route = RL.currentRoute();
    return RL.doc.annotations.filter((a) => a.page === pk || (a.route && a.route === route));
  };

  RL.nextId = (doc) => {
    let max = 0;
    for (const a of doc.annotations) {
      const m = /^R-(\d+)$/.exec(a.id || "");
      if (m) max = Math.max(max, Number(m[1]));
    }
    return "R-" + String(max + 1).padStart(3, "0");
  };

  RL.deriveAction = (a) => redlineDeriveAction(a);

  RL.fetchAll = async () => {
    const r = await fetch("/__redline/annotations");
    const j = await r.json();
    RL.rev = j.rev;
    RL.doc = j.doc;
  };

  // Optimistic mutate-and-PUT with rebase-retry on 409. mutate(docClone) edits in place.
  RL.put = async (mutate) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const doc = JSON.parse(JSON.stringify(RL.doc));
      mutate(doc);
      const r = await fetch("/__redline/annotations", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseRev: RL.rev, doc }),
      });
      const j = await r.json();
      if (r.status === 200) { RL.rev = j.rev; RL.doc = doc; RL.render(); return true; }
      if (r.status === 409) { RL.rev = j.rev; RL.doc = j.doc; RL.render(); continue; }
      break;
    }
    console.warn("redline: save failed after retries");
    return false;
  };

  // Persist geometry refreshed by renderBoxes (it mutates RL.doc in place).
  RL.persistAnchors = () => RL.put(() => {});

  RL.startPolling = () => {
    setInterval(async () => {
      try {
        const j = await (await fetch("/__redline/rev")).json();
        if (j.rev !== RL.rev) { await RL.fetchAll(); RL.render(); }
      } catch { /* server restarting; retry next tick */ }
    }, 2000);
  };

  RL.render = () => {
    if (RL.renderBoxes) RL.renderBoxes();
    if (RL.renderPanel && !RL.shot) RL.renderPanel();
  };

  const boot = async () => {
    await RL.fetchAll();
    const root = document.createElement("div");
    root.id = "__redline_root";
    document.body.appendChild(root);
    RL.els.root = root;
    if (RL.initShot) RL.initShot();
    if (RL.initBoxes) RL.initBoxes();
    if (!RL.shot && RL.initPanel) RL.initPanel();
    if (!RL.shot && RL.initDraw) RL.initDraw();
    RL.render();
    if (!RL.shot) RL.startPolling();
    // SPA route changes render asynchronously — re-render after paint settles.
    window.addEventListener("hashchange", () => setTimeout(RL.render, 150));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
