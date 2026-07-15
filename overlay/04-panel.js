// Redline overlay — side panel: list, detail, keyboard triage, page index.
(() => {
  const RL = window.__REDLINE__;
  if (!RL) return;

  let visible = false;
  let selIdx = 0;
  let selectedId = null;
  let query = "";
  let theme = "dark";
  let marginApplied = false;
  let savedMarginRight = "";
  const collapsed = {};
  // Gate for auto-scrolling the selected row into view: only scroll when the
  // selected annotation's id actually changed since the last render (keyboard
  // nav, click, or openPanelAt), never on a poll/mutation re-render that
  // redraws the same selection — that would fight manual scrolling.
  let lastScrolledId = null;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtTs = (ts) => { if (!ts) return ""; const d = new Date(ts); return isNaN(d.getTime()) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
  const isTyping = (e) => /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || "") || e.target.isContentEditable;

  const STATUS_GROUPS = [
    ["triage", "Triage", "#D9932E"],
    ["queued", "Queued", "#3E82E6"],
    ["question", "Question", "#9B6BE0"],
    ["approved", "Approved", "#3FA45A"],
    ["edited", "Edited", "#17A2A8"],
    ["implemented", "Implemented", "#5E6BE0"],
    ["verified", "Verified", "#2E9E6B"],
    ["rejected", "Rejected", "#CB5C6B"],
  ];
  const STATUS_COLORS = STATUS_GROUPS.reduce((acc, [key, , color]) => { acc[key] = color; return acc; }, {});
  const ORPHAN_COLORS = { modal: "#9B6BE0", broken: "#CB5C6B", suppressed: "#686A73" };

  const isModalScoped = (a) => {
    const an = a.anchor || {};
    return !!(an.rel && (an.refText || "").trim());
  };
  const refTextOf = (a) => ((a.anchor && a.anchor.refText) || "").trim();

  const statusKey = (a) => {
    if (a.status === "open") return a.kind === "instruction" ? "queued" : "triage";
    if (a.status === "question") return "question";
    return a.status || "queued";
  };

  const statusLabel = (a) => {
    if (a.status === "open" && a.kind === "instruction") return "queued";
    if (a.status === "open" && a.kind === "proposal") return "triage";
    if (a.status === "question") return "question?";
    return a.status;
  };

  const titleOf = (a) => (a.body && (a.body.current || a.body.instruction)) || (a.anchor && a.anchor.text) || a.id;

  const sectionOf = (a) =>
    RL.pageNumbers.has(a.id) ? "placed"
    : (RL.suppressed && RL.suppressed.some((s) => s.id === a.id)) ? "suppressed"
    : isModalScoped(a) ? "modal"
    : "broken";

  const annoMatches = (a) => {
    if (!query) return true;
    return JSON.stringify(a).toLowerCase().includes(query.toLowerCase());
  };

  const placedAnnos = () => RL.forPage()
    .filter((a) => RL.pageNumbers.has(a.id) && annoMatches(a))
    .sort((a, b) => RL.pageNumbers.get(a.id) - RL.pageNumbers.get(b.id));

  function buildGroups(includeCollapsedRows) {
    const buckets = STATUS_GROUPS.map(([key, label, color]) => ({ id: "status-" + key, key, label, color, rows: [] }));
    const byKey = new Map(buckets.map((g) => [g.key, g]));
    for (const a of placedAnnos()) {
      const group = byKey.get(statusKey(a));
      if (group) group.rows.push(a);
    }
    const groups = buckets.filter((g) => g.rows.length);
    const modal = RL.orphans.filter(isModalScoped).filter(annoMatches);
    const broken = RL.orphans.filter((a) => !isModalScoped(a)).filter(annoMatches);
    const suppressed = (RL.suppressed || []).filter(annoMatches);
    if (modal.length) groups.push({ id: "orphan-modal", key: "modal", label: "Flow / modal steps", color: ORPHAN_COLORS.modal, rows: modal });
    if (broken.length) groups.push({ id: "orphan-broken", key: "broken", label: "Orphaned — anchor not found", color: ORPHAN_COLORS.broken, rows: broken });
    if (suppressed.length) groups.push({ id: "orphan-suppressed", key: "suppressed", label: "Behind the open modal", color: ORPHAN_COLORS.suppressed, rows: suppressed });
    if (!includeCollapsedRows) return groups;
    return groups.map((g) => ({ ...g, visibleRows: collapsed[g.id] ? [] : g.rows }));
  }

  const listAnnos = () => buildGroups(true).flatMap((g) => g.visibleRows);
  const allGroupedAnnos = () => buildGroups(false).flatMap((g) => g.rows);

  function expandGroupFor(id) {
    const group = buildGroups(false).find((g) => g.rows.some((a) => a.id === id));
    if (group) collapsed[group.id] = false;
  }

  const mutate = (id, fn) =>
    RL.put((doc) => {
      const a = doc.annotations.find((x) => x.id === id);
      if (a) { fn(a); a.updatedAt = new Date().toISOString(); }
    });

  const targetGroupId = (a, status) => "status-" + (status === "open" ? (a.kind === "instruction" ? "queued" : "triage") : status);

  const toggleStatus = (id, to) => {
    const current = allGroupedAnnos().find((a) => a.id === id);
    if (current) collapsed[targetGroupId(current, current.status === to ? (current._undoStatus || "open") : to)] = false;
    return mutate(id, (a) => {
      if (a.status === to) { a.status = (a._undoStatus != null ? a._undoStatus : "open"); delete a._undoStatus; }
      else { a._undoStatus = a.status; a.status = to; }
    });
  };

  const editAnno = (a) => {
    if (a.kind === "proposal") {
      const txt = prompt("Replacement text:", a.editedText || (a.body && a.body.proposed) || "");
      if (txt != null) {
        collapsed["status-edited"] = false;
        mutate(a.id, (x) => { x.status = "edited"; x.editedText = txt; });
      }
    } else if (a.author === RL.cfg.author) {
      const txt = prompt("Instruction:", (a.body && a.body.instruction) || "");
      if (txt != null) mutate(a.id, (x) => { x.body = x.body || {}; x.body.instruction = txt; });
    }
  };

  const answerAnno = (a) => {
    const txt = prompt("Answer:");
    if (txt != null) mutate(a.id, (x) => {
      x.thread = x.thread || [];
      x.thread.push({ author: RL.cfg.author, ts: new Date().toISOString(), text: txt });
      x.status = x.prevStatus || "open";
      delete x.prevStatus;
    });
  };

  const commentAnno = (a) => {
    const txt = prompt("Comment:");
    if (txt) mutate(a.id, (x) => {
      x.thread = x.thread || [];
      x.thread.push({ author: RL.cfg.author, ts: new Date().toISOString(), text: txt });
    });
  };

  const deleteAnno = (a) => {
    if (a.author === RL.cfg.author && confirm("Delete " + a.id + "?")) {
      RL.put((doc) => { doc.annotations = doc.annotations.filter((x) => x.id !== a.id); });
    }
  };

  const actionHandlers = {
    approve: (a) => toggleStatus(a.id, "approved"),
    edit: editAnno,
    reject: (a) => toggleStatus(a.id, "rejected"),
    reopen: (a) => toggleStatus(a.id, "open"),
    verify: (a) => {
      collapsed[a.status === "verified" ? "status-implemented" : "status-verified"] = false;
      mutate(a.id, (x) => { x.status = x.status === "verified" ? "implemented" : "verified"; });
    },
    answer: answerAnno,
    comment: commentAnno,
    delete: deleteAnno,
  };

  function runAction(name, a) {
    if (!a || !actionHandlers[name]) return;
    actionHandlers[name](a);
  }

  function actionSet(a) {
    if (!a) return [];
    if (a.status === "implemented") return [["verify", "Verify", "pos"], ["reopen", "Reopen", "neutral"], ["comment", "Comment", "neutral"]];
    if (a.status === "verified") return [["reopen", "Reopen", "neutral"], ["comment", "Comment", "neutral"]];
    if (a.status === "rejected") return [["reopen", "Reopen", "neutral"]];
    if (a.status === "question") return [["answer", "Answer", "pos"], ["reject", "Reject", "neg"]];
    return [["approve", "Approve", "pos"], ["edit", "Edit", "neutral"], ["reject", "Reject", "neg"]];
  }

  RL.initPanel = () => {
    try {
      const stored = localStorage.getItem("rl-theme");
      theme = stored === "light" ? "light" : "dark";
    } catch { theme = "dark"; }

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
    selectedId = id;
    expandGroupFor(id);
    const i = allGroupedAnnos().findIndex((a) => a.id === id);
    if (i >= 0) selIdx = i;
    RL.renderPanel();
  };

  function selectedFromList(list) {
    if (selectedId) {
      const i = list.findIndex((a) => a.id === selectedId);
      if (i >= 0) {
        selIdx = i;
        return list[i];
      }
    }
    selIdx = Math.max(0, Math.min(selIdx, list.length - 1));
    const sel = list[selIdx] || null;
    selectedId = sel ? sel.id : null;
    return sel;
  }

  function onKey(e) {
    if (RL.shot) return;
    if (e.isComposing || e.keyCode === 229) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "`" && !isTyping(e)) { e.preventDefault(); RL.togglePanel(); return; }
    if (!visible || isTyping(e)) return;
    const list = listAnnos();
    const sel = selectedFromList(list);
    const k = e.key;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };

    if (k === "Escape") {
      stop();
      if (!RL.els.pageindex.classList.contains("rl-hidden")) RL.els.pageindex.classList.add("rl-hidden");
      else RL.togglePanel();
      return;
    }
    if (k === "j" || k === "ArrowDown") { stop(); selIdx = Math.min(selIdx + 1, list.length - 1); selectedId = list[selIdx] && list[selIdx].id; RL.renderPanel(); return; }
    if (k === "k" || k === "ArrowUp") { stop(); selIdx = Math.max(selIdx - 1, 0); selectedId = list[selIdx] && list[selIdx].id; RL.renderPanel(); return; }
    if (k === "/") { stop(); const inp = RL.els.panel.querySelector("input"); if (inp) inp.focus(); return; }
    if (k === "p") { stop(); renderPageIndex(); return; }
    if (k === "h") { stop(); if (RL.toggleDoneBoxes) RL.toggleDoneBoxes(); return; }
    if (!sel) return;

    if (k === "Enter") { stop(); RL.flashBox(sel.id); return; }
    if (k === "a") { stop(); runAction("approve", sel); return; }
    if (k === "r") { stop(); runAction("reject", sel); return; }
    if (k === "e") { stop(); runAction("edit", sel); return; }
    if (k === "u") { stop(); runAction("reopen", sel); return; }
    if (k === "v" && (sel.status === "implemented" || sel.status === "verified")) { stop(); runAction("verify", sel); return; }
    if (k === "o" && sel.status === "question") { stop(); runAction("answer", sel); return; }
    if (k === "c") { stop(); runAction("comment", sel); return; }
    if (k === "x") { stop(); runAction("delete", sel); return; }
  }

  function prInfo(a) {
    const texts = (a.thread || []).map((c) => c.text || "");
    const all = texts.join(" ");
    const pr = /PR ?#?(\d+)/i.exec(all);
    if (!pr) return null;
    const state = /Merged/i.test(all) ? "Merged" : (/Mergeable/i.test(all) ? "Mergeable" : "");
    const hash = /@?\s*([a-f0-9]{7,40})\b/i.exec(all);
    return { num: pr[1], state, hash: hash ? hash[1].slice(0, 7) : "" };
  }

  function detailHtml(sel) {
    if (!sel) return "";
    const sk = statusKey(sel);
    const target = [sel.surface, sel.route].filter(Boolean).join(" · ") +
      ((sel.anchor && sel.anchor.text) ? " › " + sel.anchor.text : "") +
      (sel.hint ? " ⓘ " + sel.hint : "");
    const thread = sel.thread && sel.thread.length
      ? '<div class="rl-thread">' + sel.thread.map((c) => {
        const ts = fmtTs(c.ts);
        return `<div class="rl-thread-row"><span class="rl-author">${esc(c.author)}</span>${ts ? `<span class="rl-ts">${esc(ts)}</span>` : ""}<span class="rl-thread-text">${esc(c.text)}</span></div>`;
      }).join("") + "</div>" : "";
    const actions = actionSet(sel).map(([name, label, tone]) =>
      `<button type="button" class="rl-action rl-action-${tone}" data-action="${name}">${esc(label)}</button>`).join("");
    const header = `<div class="rl-detail-head">
      <span class="rl-detail-id">${esc(sel.id)}</span>
      <span class="rl-detail-meta"> · ${esc(sel.kind || "instruction")} · ${esc(sel.author || "")}</span>
      <span class="rl-status-pill rl-status-${esc(sk)}"><span></span>${esc(statusLabel(sel))}</span>
    </div>`;
    const crumb = target ? `<div class="rl-target">${esc(target)}</div>` : "";

    let variant = "";
    if (sel.kind === "proposal") {
      const proposed = (sel.body && sel.body.proposed) || "";
      const edited = sel.editedText || "";
      variant += sel.body && sel.body.current ? `<div class="rl-diff rl-diff-minus"><b>−</b><span>${esc(sel.body.current)}</span></div>` : "";
      if (proposed) variant += `<div class="rl-diff rl-diff-plus"><b>+</b><span>${esc(proposed)}</span></div>`;
      if (edited && edited !== proposed) variant += `<div class="rl-edit">✎ your edit: ${esc(edited)}</div>`;
      if (sel.why) variant += `<div class="rl-why"><b>claude</b>${esc(sel.why)}</div>`;
    } else {
      const latest = (sel.thread || []).slice().reverse().find((c) => c.text) || null;
      const info = prInfo(sel);
      variant += sel.body && sel.body.instruction ? `<div class="rl-title">${esc(sel.body.instruction)}</div>` : "";
      if (latest) variant += `<div class="rl-message"><b>${esc(latest.author || "")}</b>${esc(latest.text || "")}</div>`;
      if (info) {
        variant += `<div class="rl-prchip"><span>⎇</span><b>PR #${esc(info.num)}</b>${info.state ? `<em><i></i>${esc(info.state)}</em>` : ""}${info.hash ? `<small>@ ${esc(info.hash)}</small>` : ""}</div>`;
      }
    }
    return `<div class="rl-detail">${header}${crumb}${variant}${thread}<div class="rl-actions">${actions}</div></div>`;
  }

  function footerHtml() {
    const commands = [["↑↓", "move"], ["↵", "jump"], ["a", "approve"], ["e", "edit"], ["r", "reject"], ["u", "reopen"], ["o", "answer"], ["c", "comment"], ["v", "verify"], ["x", "delete"], ["b", "draw"], ["p", "pages"], ["h", "view done"], ["/", "search"], ["`", "close"]];
    return `<div class="rl-command-footer">${commands.map(([key, label]) => `<span><kbd>${esc(key)}</kbd>${esc(label)}</span>`).join("")}</div>`;
  }

  RL.renderPanel = () => {
    const panel = RL.els.panel;
    if (!panel) return;
    panel.classList.toggle("rl-hidden", !visible);
    panel.dataset.rlTheme = theme;

    const fab = document.getElementById("__redline_fab");
    if (fab) fab.style.display = visible ? "none" : "";

    if (visible && !marginApplied) {
      savedMarginRight = document.body.style.marginRight;
      document.body.style.marginRight = "460px";
      marginApplied = true;
      window.dispatchEvent(new Event("resize"));
    } else if (!visible && marginApplied) {
      document.body.style.marginRight = savedMarginRight;
      marginApplied = false;
      window.dispatchEvent(new Event("resize"));
    }

    if (!visible) return;
    const groups = buildGroups(true);
    const list = groups.flatMap((g) => g.visibleRows);
    const sel = selectedFromList(list);

    const prevInput = panel.querySelector("input");
    const hadFocus = !!prevInput && document.activeElement === prevInput;
    const selStart = hadFocus ? prevInput.selectionStart : null;
    const selEnd = hadFocus ? prevInput.selectionEnd : null;

    let rowIdx = 0;
    const groupHtml = groups.map((g) => {
      const open = !collapsed[g.id];
      const rows = open ? g.rows.map((a) => {
        const i = rowIdx++;
        const sk = statusKey(a);
        const selected = a.id === (sel && sel.id);
        const n = RL.pageNumbers.has(a.id) ? RL.pageNumbers.get(a.id) : "—";
        const sub = sectionOf(a) === "modal" && refTextOf(a) ? `<span class="rl-sub">◫ ${esc(refTextOf(a))}</span>` : "";
        return `<div class="rl-item ${selected ? "rl-sel" : ""} rl-row-status-${esc(sk)}" data-i="${i}" style="--rl-row-color:${esc(STATUS_COLORS[sk] || g.color)}">
          <span class="rl-num">${esc(n)}</span>
          <div class="rl-txtwrap"><span class="rl-txt">${esc(titleOf(a))}</span>${sub}</div>
          ${a.kind === "proposal" ? '<span class="rl-proposal-tag">PROPOSAL</span>' : ""}
        </div>`;
      }).join("") : "";
      return `<section class="rl-group">
        <button type="button" class="rl-group-head ${open ? "rl-open" : ""}" data-group="${esc(g.id)}" style="--rl-group-color:${esc(g.color)}">
          <span class="rl-chev">▸</span><span class="rl-dot"></span><span class="rl-group-label">${esc(g.label)}</span><span class="rl-group-count">${g.rows.length}</span>
        </button>${rows}
      </section>`;
    }).join("");

    panel.innerHTML = `
      <div class="rl-panel-head">
        <span class="rl-search-icon">⌕</span>
        <input placeholder="Search reviews" value="${esc(query)}">
        <span class="rl-count-pill">${allGroupedAnnos().length}</span>
        <button type="button" class="rl-theme-toggle" aria-label="Toggle theme">
          <span class="${theme === "dark" ? "rl-active" : ""}">☾</span><span class="${theme === "light" ? "rl-active" : ""}">☀</span>
        </button>
      </div>
      <div class="rl-list">${groupHtml}</div>
      ${detailHtml(sel)}
      ${footerHtml()}`;

    const inp = panel.querySelector("input");
    if (hadFocus) { inp.focus(); inp.setSelectionRange(selStart, selEnd); }
    inp.addEventListener("input", () => { query = inp.value; selIdx = 0; selectedId = null; RL.renderPanel(); });
    inp.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Escape" || ev.key === "Enter") ev.target.blur(); });
    panel.querySelector(".rl-theme-toggle").addEventListener("click", () => {
      theme = theme === "dark" ? "light" : "dark";
      try { localStorage.setItem("rl-theme", theme); } catch {}
      RL.renderPanel();
    });
    panel.querySelectorAll(".rl-group-head").forEach((el) =>
      el.addEventListener("click", () => { collapsed[el.dataset.group] = !collapsed[el.dataset.group]; RL.renderPanel(); }));
    panel.querySelectorAll(".rl-item").forEach((el) =>
      el.addEventListener("click", () => {
        selIdx = Number(el.dataset.i);
        const a = listAnnos()[selIdx];
        selectedId = a && a.id;
        RL.renderPanel();
        if (a) RL.flashBox(a.id);
      }));
    panel.querySelectorAll(".rl-action").forEach((el) =>
      el.addEventListener("click", () => { const a = selectedFromList(listAnnos()); runAction(el.dataset.action, a); }));

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
    const groups = new Map();
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
