// Redline overlay — draw mode: Option-click snaps to an element, drag draws freeform.
(() => {
  const RL = window.__REDLINE__;
  if (!RL) return;

  let drawing = false, start = null, rubber = null, capture = null, hint = null;
  const isTyping = (e) => /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || "") || e.target.isContentEditable;

  // True if `el` sits inside a currently-open modal overlay — marks a box as
  // drawn "on the modal" so it scopes to it (02-anchor.js RL.openOverlay).
  const drawnInOverlay = (el) => { const M = RL.openOverlay(); return !!(el && M && M.contains(el)); };

  RL.initDraw = () => {
    document.addEventListener("keydown", (e) => {
      if (e.key === "b" && !isTyping(e)) { e.preventDefault(); drawing ? exit() : enter(); }
      else if (e.key === "Escape" && drawing) exit();
    }, true);
  };

  function enter() {
    drawing = true;
    document.body.classList.add("rl-drawing");
    capture = document.createElement("div");
    capture.id = "__redline_capture";
    capture.addEventListener("mousedown", onDown);
    RL.els.root.appendChild(capture);
    hint = document.createElement("div");
    hint.className = "rl-drawhint";
    hint.textContent = "Draw: drag a box, or Option-click an element. Esc exits.";
    RL.els.root.appendChild(hint);
  }

  function exit() {
    drawing = false;
    document.body.classList.remove("rl-drawing");
    for (const el of [capture, rubber, hint, document.getElementById("__redline_draw_input")]) if (el) el.remove();
    capture = rubber = hint = null;
  }

  function onDown(e) {
    e.preventDefault();
    start = { x: e.clientX, y: e.clientY, alt: e.altKey };
    rubber = document.createElement("div");
    rubber.className = "rl-rubber";
    capture.appendChild(rubber);
    capture.addEventListener("mousemove", onMove);
    capture.addEventListener("mouseup", onUp, { once: true });
  }

  function onMove(e) {
    if (!start || !rubber) return;
    rubber.style.left = Math.min(e.clientX, start.x) + "px";
    rubber.style.top = Math.min(e.clientY, start.y) + "px";
    rubber.style.width = Math.abs(e.clientX - start.x) + "px";
    rubber.style.height = Math.abs(e.clientY - start.y) + "px";
  }

  // Find a reference element under a point (the center of a freeform-drawn
  // rect), so the drawn box can be re-anchored relative to real content
  // instead of stuck at fixed viewport coords. Uses the FULL element stack at
  // that point (document.elementsFromPoint — topmost/deepest first), not a
  // parentElement walk-up: a walk-up from whatever's frontmost at the point
  // (often the deepest, smallest span) only ever gets BIGGER as it ascends,
  // so it readily overshoots past the drawn span into an ancestor row/card —
  // exactly the mis-anchor bug this replaces. Instead, scan the stack
  // top-down and take the FIRST (deepest) element whose own box is already
  // big enough to plausibly contain the drawn rect (area >= half the drawn
  // area) — i.e. stop descending only when we'd go too small, rather than
  // stopping ascending only when we've gone big enough. drawnArea is the
  // drawn rect's width*height, in the same viewport px^2 units as the
  // candidate's getClientRects() box. Skips the overlay's own DOM and
  // anything with no rendered box (getClientRects/2px, consistent with the
  // visibility checks elsewhere in the overlay). Falls back to the first
  // visible non-overlay element in the stack if none clears the size bar,
  // and to null (caller keeps the container-% rect as the sole anchor) if
  // the stack itself has nothing usable.
  function findRefEl(cx, cy, drawnArea) {
    capture.style.pointerEvents = "none"; // look under the capture layer
    const stack = document.elementsFromPoint(cx, cy);
    capture.style.pointerEvents = "";
    let firstVisible = null;
    for (const n of stack) {
      if (n.closest && n.closest("#__redline_root")) continue;
      const rects = n.getClientRects();
      if (rects.length === 0 || rects[0].width < 2 || rects[0].height < 2) continue;
      if (!firstVisible) firstVisible = n;
      const area = rects[0].width * rects[0].height;
      if (area >= 0.5 * drawnArea) return n;
    }
    return firstVisible;
  }

  function onUp(e) {
    capture.removeEventListener("mousemove", onMove);
    const dx = Math.abs(e.clientX - start.x), dy = Math.abs(e.clientY - start.y);
    let anchor = null;
    if (dx < 5 && dy < 5 && start.alt) {
      capture.style.pointerEvents = "none"; // look under the capture layer
      const el = document.elementFromPoint(e.clientX, e.clientY);
      capture.style.pointerEvents = "";
      if (el && !el.closest("#__redline_root")) {
        const rect = RL.rectOf(el); // container-relative % — stored anchor
        anchor = { selector: RL.buildSelector(el), text: (el.textContent || "").trim().slice(0, 120), rect };
        if (drawnInOverlay(el)) anchor.scope = "overlay";
        // Rubber band: set directly from the element's live viewport rect
        // rather than round-tripping through %/scroll math — capture (the
        // rubber's parent) is position:fixed/inset:0, so viewport coords are
        // exactly what's needed.
        const r = el.getBoundingClientRect();
        rubber.style.left = r.left + "px";
        rubber.style.top = r.top + "px";
        rubber.style.width = r.width + "px";
        rubber.style.height = r.height + "px";
      }
    } else if (dx >= 5 || dy >= 5) {
      const x = Math.min(start.x, e.clientX), y = Math.min(start.y, e.clientY);
      anchor = { rect: RL.viewportToRectPct(x, y, dx, dy) };
      // Element-relative anchor: express the drawn rect as an offset/scale
      // against a reference element found under its center, so it reflows
      // with layout changes (panel squeeze, resize) the same way
      // element-anchored boxes do. No qualifying ref → keep the container-%
      // rect above as the sole (fixed) anchor.
      const refEl = findRefEl(x + dx / 2, y + dy / 2, dx * dy);
      if (refEl) {
        const R = refEl.getBoundingClientRect();
        if (R.width >= 1 && R.height >= 1) {
          anchor.refSelector = RL.buildSelector(refEl);
          anchor.refText = (refEl.textContent || "").trim().slice(0, 120);
          // Ref's own size at capture time — lets resolution-time validation
          // (02-anchor.js RL.resolve/fuzzyFindRef) reject a same-text
          // candidate whose box is wildly bigger/smaller than what was drawn
          // on (the ancestor-mis-anchor failure mode this whole fix targets).
          anchor.refW = Math.round(R.width);
          anchor.refH = Math.round(R.height);
          anchor.rel = {
            dx: (x - R.left) / R.width,
            dy: (y - R.top) / R.height,
            dw: dx / R.width,
            dh: dy / R.height,
          };
        }
      }
      const scopeEl = refEl || (() => {
        capture.style.pointerEvents = "none"; // look under the capture layer
        const cx = x + dx / 2, cy = y + dy / 2; // center of the drawn rect
        const hit = document.elementFromPoint(cx, cy);
        capture.style.pointerEvents = "";
        return hit;
      })();
      if (drawnInOverlay(scopeEl)) anchor.scope = "overlay";
    }
    if (!anchor) { rubber.remove(); rubber = null; return; }
    askInstruction(anchor, e);
  }

  function askInstruction(anchor, e) {
    const wrap = document.createElement("div");
    wrap.id = "__redline_draw_input";
    wrap.style.left = Math.max(8, Math.min(e.clientX, window.innerWidth - 430)) + "px";
    wrap.style.top = Math.min(e.clientY + 12, window.innerHeight - 60) + "px";
    const input = document.createElement("input");
    input.placeholder = "Instruction (remove this / change JA to ... / add ...)";
    const sel = document.createElement("select");
    sel.title = "Export color: auto infers from your verb (remove/delete→red, add/create→green, else edit/orange)";
    for (const o of ["auto", "remove", "edit", "add"]) sel.add(new Option(o, o));
    wrap.append(input, sel);
    RL.els.root.appendChild(wrap);
    input.focus();
    input.addEventListener("keydown", async (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") { wrap.remove(); if (rubber) { rubber.remove(); rubber = null; } return; }
      if (ev.key !== "Enter" || !input.value.trim()) return;
      const now = new Date().toISOString();
      const anno = {
        id: null,
        author: RL.cfg.author,
        kind: "instruction",
        surface: location.pathname.split("/").filter(Boolean)[0] || null,
        route: RL.currentRoute(),
        page: RL.pageKey(),
        state: {},
        anchor,
        body: { instruction: input.value.trim(), ...(sel.value !== "auto" ? { action: sel.value } : {}) },
        status: "open",
        thread: [],
        source: "manual",
        createdAt: now,
        updatedAt: now,
      };
      await RL.put((doc) => { anno.id = RL.nextId(doc); doc.annotations.push(anno); });
      wrap.remove();
      if (rubber) { rubber.remove(); rubber = null; }
    });
  }
})();
