// Redline overlay — side panel: list, detail, keyboard triage, page index.
(() => {
  const RL = window.__REDLINE__;
  if (!RL) return;

  let visible = false;
  let selIdx = 0;
  let query = "";
  let marginApplied = false;
  let savedMarginRight = "";
  // Gate for auto-scrolling the selected row into view: only scroll when the
  // selected annotation's id actually changed since the last render (keyboard
  // nav, click, or openPanelAt), never on a poll/mutation re-render that
  // redraws the same selection — that would fight manual scrolling.
  let lastScrolledId = null;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // Compact local-time formatter for thread timestamps (ISO string → e.g. "Jul 7, 5:21 PM").
  const fmtTs = (ts) => { if (!ts) return ""; const d = new Date(ts); return isNaN(d.getTime()) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
  const isTyping = (e) => /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || "") || e.target.isContentEditable;

  // A rel-anchored orphan (has anchor.rel + a captured refText) is not broken —
  // it's a box drawn on a modal/flow step whose container isn't mounted right now.
  // Distinguish it from a genuinely-broken anchor (a text/selector that failed to
  // match on a fully-rendered page), which is what actually needs attention.
  const isModalScoped = (a) => {
    const an = a.anchor || {};
    return !!(an.rel && (an.refText || "").trim());
  };
  const refTextOf = (a) => ((a.anchor && a.anchor.refText) || "").trim();

  // Which of the three list sections a row belongs to, given the current render's
  // pageNumbers/orphans. Placed rows are numbered; unresolved rows split by classifier.
  const sectionOf = (a) =>
    RL.pageNumbers.has(a.id) ? "placed"
    : (RL.suppressed && RL.suppressed.some((s) => s.id === a.id)) ? "suppressed"
    : isModalScoped(a) ? "modal"
    : "broken";

  // "open" is shared by two opposite owners — an agent proposal awaiting the human's
  // triage, and a human instruction queued for the agent — so derive a kind-aware
  // display label here; the underlying status value is unchanged (see pillClass
  // below for the matching kind-aware color split).
  const statusLabel = (a) => {
    if (a.status === "open" && a.kind === "instruction") return "queued";
    if (a.status === "open" && a.kind === "proposal") return "triage";
    if (a.status === "question") return "question?";
    return a.status;
  };

  // Color bucket for the pill: an open proposal (claude-authored, awaiting the
  // human's approve/edit/reject) and a question (agent asked, awaiting the
  // human's answer) both need the human's attention right now, so both render
  // in the amber/orange "needs-human" family. An open instruction is already
  // queued for the agent to execute, so it gets a distinctly different (blue)
  // color rather than sharing "open"'s amber. Every other status keeps its
  // existing rl-pill-<status> class/color unchanged.
  const pillClass = (a) => {
    if (a.status === "open") return a.kind === "instruction" ? "rl-pill-open-instruction" : "rl-pill-open-proposal";
    return "rl-pill-" + a.status;
  };

  // Fixed legend order + colors for the counts bar — mirrors pillClass's
  // buckets exactly (triage = open+proposal, queued = open+instruction) so
  // the counts bar, list pills, and on-page box colors read as one system.
  // Every bucket always renders, even at 0 — the bar doubles as a legend.
  const COUNT_BUCKETS = [
    ["triage", "#f59e0b"],
    ["queued", "#38bdf8"],
    ["question", "#ea580c"],
    ["approved", "#16a34a"],
    ["edited", "#16a34a"],
    ["rejected", "#4b5563"],
    ["implemented", "#2563eb"],
    ["verified", "#0d9488"],
  ];

  RL.initPanel = () => {
    const fab = document.createElement("button");
    fab.id = "__redline_fab";
    fab.textContent = "✎";
    fab.title = "Redline (`)";
    fab.addEventListener("click", () => RL.togglePanel());
    RL.els.root.appendChild(fab);

    for (const [id, key] of [["__redline_panel", "panel"], ["__redline_pageindex", "pageindex"]]) {
      const el = document.createElement("div");
      el.id = id;
      el.className = "rl-hidden";
      RL.els.root.appendChild(el);
      RL.els[key] = el;
    }
    document.addEventListener("keydown", onKey, true);
  };

  RL.togglePanel = () => { visible = !visible; RL.renderPanel(); };
  RL.openPanelAt = (id) => {
    visible = true;
    const i = listAnnos().findIndex((a) => a.id === id);
    if (i >= 0) selIdx = i;
    RL.renderPanel();
  };

  // Panel order = badge order, then flow/modal-step orphans, then broken orphans;
  // filtered by the search query. The three groups are CONTIGUOUS so renderPanel
  // can drop a section divider at each boundary (see below).
  const listAnnos = () => {
    const page = RL.forPage();
    const placed = page
      .filter((a) => RL.pageNumbers.has(a.id))
      .sort((a, b) => RL.pageNumbers.get(a.id) - RL.pageNumbers.get(b.id));
    const modal = RL.orphans.filter(isModalScoped);
    const broken = RL.orphans.filter((a) => !isModalScoped(a));
    const suppressed = RL.suppressed || [];
    const all = placed.concat(modal, broken, suppressed);
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter((a) => JSON.stringify(a).toLowerCase().includes(q));
  };

  const mutate = (id, fn) =>
    RL.put((doc) => {
      const a = doc.annotations.find((x) => x.id === id);
      if (a) { fn(a); a.updatedAt = new Date().toISOString(); }
    });

  // Reversible status keys: pressing a status key applies its target status and stashes the
  // prior status in `_undoStatus`; pressing the SAME key again (item already at that status)
  // reverts to the stashed status — a one-step undo for a mis-press. Persisted in the doc, so
  // it also survives a reload. Only the most recent status change is undoable.
  const toggleStatus = (id, to) => mutate(id, (a) => {
    if (a.status === to) { a.status = (a._undoStatus != null ? a._undoStatus : "open"); delete a._undoStatus; }
    else { a._undoStatus = a.status; a.status = to; }
  });

  function onKey(e) {
    if (RL.shot) return;
    if (e.isComposing || e.keyCode === 229) return; // ignore IME / dictation composition keystrokes
    // Never hijack browser/OS chords — Cmd+R / Ctrl+R reload, Cmd+Shift+R hard reload, Cmd+L, etc.
    // Single-key triage shortcuts (a/r/e/v/x/…) must fire ONLY with no modifier held, or a reload
    // keypress lands as "reject" on the selected item. No preventDefault: let the chord through.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "`" && !isTyping(e)) { e.preventDefault(); RL.togglePanel(); return; }
    if (!visible || isTyping(e)) return;
    const list = listAnnos();
    const sel = list[selIdx];
    const k = e.key;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };

    if (k === "Escape") {
      stop();
      if (!RL.els.pageindex.classList.contains("rl-hidden")) RL.els.pageindex.classList.add("rl-hidden");
      else RL.togglePanel();
      return;
    }
    if (k === "j" || k === "ArrowDown") { stop(); selIdx = Math.min(selIdx + 1, list.length - 1); RL.renderPanel(); return; }
    if (k === "k" || k === "ArrowUp") { stop(); selIdx = Math.max(selIdx - 1, 0); RL.renderPanel(); return; }
    if (k === "/") { stop(); const inp = RL.els.panel.querySelector("input"); if (inp) inp.focus(); return; }
    if (k === "p") { stop(); renderPageIndex(); return; }
    if (!sel) return;

    if (k === "Enter") { stop(); RL.flashBox(sel.id); return; }
    if (k === "a" && sel.kind === "proposal") { stop(); toggleStatus(sel.id, "approved"); return; }
    if (k === "r" && sel.kind === "proposal") { stop(); toggleStatus(sel.id, "rejected"); return; }
    if (k === "e") {
      stop();
      if (sel.kind === "proposal") {
        // Pre-fill with the current edit (or the proposal if not yet edited) so pressing `e`
        // again re-opens the previous edit text for refinement. To revert an edit, use `u`.
        const txt = prompt("Replacement text:", sel.editedText || (sel.body && sel.body.proposed) || "");
        if (txt != null) mutate(sel.id, (a) => { a.status = "edited"; a.editedText = txt; });
      } else if (sel.author === RL.cfg.author) {
        const txt = prompt("Instruction:", (sel.body && sel.body.instruction) || "");
        if (txt != null) mutate(sel.id, (a) => { a.body.instruction = txt; });
      }
      return;
    }
    if (k === "u") { stop(); toggleStatus(sel.id, "open"); return; }
    if (k === "v" && (sel.status === "implemented" || sel.status === "verified")) { stop(); mutate(sel.id, (a) => { a.status = a.status === "verified" ? "implemented" : "verified"; }); return; }
    if (k === "o" && sel.status === "question") {
      stop();
      const txt = prompt("Answer:");
      if (txt != null) mutate(sel.id, (a) => {
        a.thread = a.thread || [];
        a.thread.push({ author: RL.cfg.author, ts: new Date().toISOString(), text: txt });
        a.status = a.prevStatus || "open";
        delete a.prevStatus;
      });
      return;
    }
    if (k === "c") {
      stop();
      const txt = prompt("Comment:");
      if (txt) mutate(sel.id, (a) => {
        a.thread = a.thread || [];
        a.thread.push({ author: RL.cfg.author, ts: new Date().toISOString(), text: txt });
      });
      return;
    }
    if (k === "x" && sel.author === RL.cfg.author) {
      stop();
      if (confirm("Delete " + sel.id + "?")) RL.put((doc) => { doc.annotations = doc.annotations.filter((a) => a.id !== sel.id); });
      return;
    }
  }

  RL.renderPanel = () => {
    const panel = RL.els.panel;
    if (!panel) return;
    panel.classList.toggle("rl-hidden", !visible);

    // Panel visibility push: shove the page content over so the panel doesn't
    // cover it. Guarded by marginApplied so repeated renderPanel() calls while
    // visible can't stack/leak the margin.
    if (visible && !marginApplied) {
      savedMarginRight = document.body.style.marginRight;
      document.body.style.marginRight = "380px";
      marginApplied = true;
      window.dispatchEvent(new Event("resize"));
    } else if (!visible && marginApplied) {
      document.body.style.marginRight = savedMarginRight;
      marginApplied = false;
      window.dispatchEvent(new Event("resize"));
    }

    if (!visible) return;
    const list = listAnnos();
    selIdx = Math.max(0, Math.min(selIdx, list.length - 1));
    // Bucket the same way pillClass does: "open" splits by kind into
    // triage/queued so the legend matches the pill colors exactly.
    const counts = { triage: 0, queued: 0, question: 0, approved: 0, edited: 0, rejected: 0, implemented: 0, verified: 0 };
    for (const a of RL.forPage()) {
      if (a.status === "open") counts[a.kind === "instruction" ? "queued" : "triage"]++;
      else if (counts[a.status] != null) counts[a.status]++;
    }

    // Preserve search-input focus + exact caret across the innerHTML rebuild below.
    const prevInput = panel.querySelector("input");
    const hadFocus = !!prevInput && document.activeElement === prevInput;
    const selStart = hadFocus ? prevInput.selectionStart : null;
    const selEnd = hadFocus ? prevInput.selectionEnd : null;

    const modalCount = list.filter((a) => sectionOf(a) === "modal").length;
    const brokenCount = list.filter((a) => sectionOf(a) === "broken").length;
    const suppressedCount = list.filter((a) => sectionOf(a) === "suppressed").length;

    let prevSection = null;
    const items = list.map((a, i) => {
      const section = sectionOf(a);
      let divider = "";
      if (section !== prevSection && section === "modal") {
        divider = `<div class="rl-section rl-section-modal">◫ Flow / modal steps (${modalCount}) · open the flow to reveal</div>`;
      } else if (section !== prevSection && section === "broken") {
        divider = `<div class="rl-section rl-section-broken">⚠ Orphaned — anchor not found (${brokenCount})</div>`;
      } else if (section !== prevSection && section === "suppressed") {
        divider = `<div class="rl-section rl-section-suppressed">▤ Behind the open modal (${suppressedCount}) · base-page boxes, hidden while the modal is up</div>`;
      }
      prevSection = section;

      const n = RL.pageNumbers.has(a.id) ? RL.pageNumbers.get(a.id) : "—";
      const label = (a.body && (a.body.current || a.body.instruction)) || (a.anchor && a.anchor.text) || a.id;
      const sub = section === "modal" && refTextOf(a)
        ? `<span class="rl-sub">◫ ${esc(refTextOf(a))}</span>` : "";
      return `${divider}<div class="rl-item ${i === selIdx ? "rl-sel" : ""}" data-i="${i}">
        <span class="rl-num">${n}</span>
        <div class="rl-txtwrap"><span class="rl-txt">${esc(label)}</span>${sub}</div>
        <span class="rl-pill ${pillClass(a)}">${statusLabel(a)}</span></div>`;
    }).join("");

    const sel = list[selIdx];
    let detail = "";
    if (sel) {
      const rows = [];
      rows.push(`<h4>${sel.id} · ${sel.kind} · ${esc(sel.author)} · ${statusLabel(sel)}${sel.hint ? " · " + esc(sel.hint) : ""}</h4>`);
      if (sel.body && sel.body.current) rows.push(`<div class="rl-cur">− ${esc(sel.body.current)}</div>`);
      // Show claude's proposal AND the human's edit (if any) so the full evolution is visible.
      // editedText is what actually shipped, so surface it at EVERY status (not only while "edited").
      if (sel.body && sel.body.proposed) rows.push(`<div class="rl-pro">+ ${esc(sel.body.proposed)}</div>`);
      if (sel.editedText) rows.push(`<div class="rl-edit">✎ your edit: ${esc(sel.editedText)}</div>`);
      if (sel.body && sel.body.instruction) rows.push(`<div>${esc(sel.body.instruction)}</div>`);
      if (sel.why) rows.push(`<div>${esc(sel.why)}</div>`);
      if (sel.thread && sel.thread.length) {
        rows.push('<div class="rl-thread">' + sel.thread.map((c) => {
          const ts = fmtTs(c.ts);
          return `<div><span class="rl-author">${esc(c.author)}</span>${ts ? `<span class="rl-ts">${esc(ts)}</span>` : ""}${esc(c.text)}</div>`;
        }).join("") + "</div>");
      }
      detail = `<div class="rl-detail">${rows.join("")}</div>`;
    }

    panel.innerHTML = `
      <div class="rl-panel-head"><input placeholder="/ search" value="${esc(query)}"><span>${list.length}</span></div>
      <div class="rl-counts">${COUNT_BUCKETS.map(([label, color]) => `<span style="color:${color}">${label}:${counts[label]}</span>`).join("  ")}</div>
      <div class="rl-list">${items}</div>${detail}
      <div class="rl-hints">↑/↓ move · Enter jump · a approve · e edit/refine · r reject · u reopen · v verify · (a/r/u/v again = undo) · o answer · c comment · x delete yours · b draw: ⌥-click an element or drag a box · p pages · / search · \` close</div>`;

    const inp = panel.querySelector("input");
    if (hadFocus) { inp.focus(); inp.setSelectionRange(selStart, selEnd); }
    inp.addEventListener("input", () => { query = inp.value; selIdx = 0; RL.renderPanel(); });
    inp.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Escape" || ev.key === "Enter") ev.target.blur(); });
    panel.querySelectorAll(".rl-item").forEach((el) =>
      el.addEventListener("click", () => { selIdx = Number(el.dataset.i); RL.renderPanel(); const a = listAnnos()[selIdx]; if (a) RL.flashBox(a.id); }));

    // Keep the selected row centered in the list — but only when the selection
    // actually changed (see lastScrolledId comment above); a poll/mutation
    // re-render that redraws the same selection must not fight manual
    // scrolling. Computed via getBoundingClientRect deltas rather than
    // item.offsetTop: .rl-list is position:static, so an .rl-item's
    // offsetParent is actually #__redline_panel (position:fixed) several
    // levels up, not .rl-list — offsetTop would then include the head/counts
    // height above the list and center wrong. The rect delta is exact
    // regardless of the ancestor chain, and only ever mutates listEl.scrollTop
    // (never window/body scroll), and the browser clamps the assignment to
    // the valid scroll range for free at the top/bottom of the list.
    const curSelId = sel ? sel.id : null;
    if (curSelId !== lastScrolledId) {
      lastScrolledId = curSelId;
      const selEl = panel.querySelector(".rl-item.rl-sel");
      const listEl = panel.querySelector(".rl-list");
      if (selEl && listEl) {
        const itemRect = selEl.getBoundingClientRect();
        const listRect = listEl.getBoundingClientRect();
        listEl.scrollTop += (itemRect.top - listRect.top) - (listEl.clientHeight / 2) + (itemRect.height / 2);
      }
    }
  };

  function renderPageIndex() {
    const pi = RL.els.pageindex;
    const groups = new Map(); // page → counts
    for (const a of RL.doc.annotations) {
      const key = a.page || ((a.surface && a.route) ? `/${a.surface}#/${a.surface}/${a.route}` : "(unassigned)");
      if (!groups.has(key)) groups.set(key, { total: 0, open: 0 });
      const g = groups.get(key);
      g.total++;
      if (a.status === "open" || a.status === "question") g.open++;
    }
    pi.innerHTML = "<h3>Pages</h3>" + [...groups.entries()].sort().map(([page, g]) =>
      `<div class="rl-pi-row" data-page="${esc(page)}"><span>${esc(page)}</span><span>${g.open} open / ${g.total}</span></div>`).join("");
    pi.classList.remove("rl-hidden");
    pi.querySelectorAll(".rl-pi-row").forEach((el) =>
      el.addEventListener("click", () => {
        const page = el.dataset.page;
        pi.classList.add("rl-hidden");
        if (page !== "(unassigned)") { location.assign(page); setTimeout(RL.render, 300); }
      }));
  }
})();
