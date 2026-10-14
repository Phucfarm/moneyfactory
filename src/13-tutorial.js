/* ============================================================
   13-tutorial.js — Guidance Core (interactive onboarding + contextual tips).

   An ADD-ON LAYER that sits on top of the game. It OBSERVES gameplay and
   RENDERS guidance. It never mutates gameplay state:

     gameplay (unchanged)  --events/state-->  Guidance Core  -->  #tutorial-layer

   Integration surface with the rest of the game (all optional / null-safe):
     12-main.js   G.Tutorial.update(state, dt, mechanicUi)   once per frame
                  G.Tutorial.observeEvent(ev)                for events already
                                                             passing processEvents
     11-ui.js     G.Tutorial.settingsHtml()/wireSettings()   Settings toggle row
   Removing this subsystem = delete src/13-tutorial*.js, the #tutorial-layer
   element, the CSS block "Guidance Core" and those few null-safe call sites.

   PERSISTENCE (separate from the gameplay save on purpose)
     localStorage["moneyFactoryTycoon.guidance"] =
       { v, layer1:{status,reason,flags,...}, layer2:{enabled,seen{}} }
     Game.Save.hardReset() only removes the gameplay save keys, so first-time
     onboarding completion, the Contextual Guidance toggle and hint history all
     survive a gameplay reset. Save/Import/Export never include this record.

   UI LAYERING
     #tutorial-layer normally lives inside #app between the gameplay HUD and modal.
     A newly actionable urgent Layer 2 opportunity may briefly interrupt Layer 1;
     acknowledging it returns to the current Layer 1 step. For eligible urgent Rooms
     or Zone Atlas hints, the same element may move into #modal-overlay to point to
     an in-panel purchase/upgrade/unlock control. It stays pointer-transparent except
     for the hint acknowledgement button; unrelated panels keep the original hiding.
   ============================================================ */
(function (G) {
  "use strict";

  const STORE_KEY = "moneyFactoryTycoon.guidance";
  const STORE_VERSION = 1;
  const REFRESH_MS = 250;
  const EMPTY_UI = Object.freeze({ machineStatuses: [], zoneIndicators: [], actions: [], machineDecorations: [], hudEffects: {} });

  // ============================================================
  // Helpers
  // ============================================================
  const warned = new Set();
  function tr(key, params) {
    let s = G.i18n.t(key, params);
    // Never leak raw placeholders such as "{count}" to the player.
    if (/\{[A-Za-z0-9_]+\}/.test(s)) {
      if (!warned.has(key)) { warned.add(key); console.warn("[Guidance] unresolved placeholder in", key); }
      s = s.replace(/\s*\{[A-Za-z0-9_]+\}/g, "").replace(/\s{2,}/g, " ").trim();
    }
    return s;
  }
  function escapeHtml(v) { return String(v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch])); }
  function cssEsc(v) { return (window.CSS && CSS.escape) ? CSS.escape(String(v)) : String(v).replace(/[^A-Za-z0-9_-]/g, "\\$&"); }
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi < lo ? lo : hi, v)); }

  // ============================================================
  // Store — guidance persistence, independent from the gameplay save.
  // ============================================================
  const Store = (function () {
    let data = null;
    let storageOk = null;
    function available() {
      if (storageOk !== null) return storageOk;
      try { const k = "__mft_guid_test__"; localStorage.setItem(k, "1"); localStorage.removeItem(k); storageOk = true; }
      catch (_) { storageOk = false; }
      return storageOk;
    }
    function blank() {
      return {
        v: STORE_VERSION,
        layer1: { status: "pending", reason: null, flags: { selected: false, collected: false, reward100Granted: false, basicDoneAcknowledged: false, reward1000Granted: false }, startedAt: 0, finishedAt: 0 },
        layer2: { enabled: true, seen: {} },
      };
    }
    function sanitize(raw) {
      const out = blank();
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
      const l1 = raw.layer1;
      if (l1 && typeof l1 === "object") {
        if (l1.status === "pending" || l1.status === "active" || l1.status === "done") out.layer1.status = l1.status;
        if (typeof l1.reason === "string") out.layer1.reason = l1.reason.slice(0, 24);
        if (l1.flags && typeof l1.flags === "object") {
          out.layer1.flags.selected = l1.flags.selected === true;
          out.layer1.flags.collected = l1.flags.collected === true;
          out.layer1.flags.reward100Granted = l1.flags.reward100Granted === true;
          out.layer1.flags.basicDoneAcknowledged = l1.flags.basicDoneAcknowledged === true;
          out.layer1.flags.reward1000Granted = l1.flags.reward1000Granted === true;
        }
        if (Number.isFinite(l1.startedAt)) out.layer1.startedAt = l1.startedAt;
        if (Number.isFinite(l1.finishedAt)) out.layer1.finishedAt = l1.finishedAt;
      }
      const l2 = raw.layer2;
      if (l2 && typeof l2 === "object") {
        if (typeof l2.enabled === "boolean") out.layer2.enabled = l2.enabled;
        if (l2.seen && typeof l2.seen === "object" && !Array.isArray(l2.seen)) {
          Object.keys(l2.seen).slice(0, 600).forEach((k) => {
            if (/^[A-Za-z0-9_.:\-]{1,120}$/.test(k) && k !== "__proto__" && Number.isFinite(l2.seen[k])) out.layer2.seen[k] = l2.seen[k];
          });
        }
      }
      return out;
    }
    function load() {
      let raw = null;
      if (available()) { try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) { raw = null; } }
      data = sanitize(raw);
      return data;
    }
    function get() { return data || load(); }
    function save() {
      if (!data || !available()) return false;
      try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); return true; } catch (_) { return false; }
    }
    return { get, load, save };
  })();

  // ============================================================
  // Runtime
  // ============================================================
  let initialized = false;
  let layerEl = null;
  let canvasEl = null;
  let lastState = null;
  let lastMechanicUi = EMPTY_UI;
  let lastRefreshAt = -1e9;
  let dirty = true;
  let active = null;               // { source, id, view, shownAt }
  let outroUntil = 0;
  let nextHintAt = 0;
  let layer1ClearedAt = 0;
  const pendingEvents = { bonus: null };
  const slotMemory = { empty: null, machine: null };
  let lastCtx = null;
  let lastCandidateIds = new Set();

  // ============================================================
  // Read-only context handed to content definitions
  // ============================================================
  function countMachines(state) {
    let n = 0;
    state.zones.forEach((z) => z.floors.forEach((f) => f.grid.forEach((s) => { if (s.machine) n++; })));
    return n;
  }
  function currentFloorOf(state) { return G.Factory.currentFloor(state); }

  function buildContext(state, mechanicUi) {
    const D = G.DATA, E = G.Econ;
    const store = Store.get();
    const floor = currentFloorOf(state);
    const starterMachineId = D.MACHINE_TYPES[0].id;
    const ctx = {
      state,
      mechanicUi: mechanicUi || EMPTY_UI,
      now: performance.now(),
      machineCount: countMachines(state),
      starterMachineId,
      selectedMachineId: state.selectedMachineId || starterMachineId,
      nextMachineId: (() => {
        const nextTier = (D.TIERS || []).find((tier) => tier.id !== D.machineById(starterMachineId)?.tierId && E.tierUnlocked(state, tier.id));
        return nextTier ? "printer_" + nextTier.id : null;
      })(),
      currentFloor: floor,
      events: pendingEvents,
      t: tr,
      flag(name) { return !!store.layer1.flags[name]; },
      cost(id) { try { return E.machineCostById(state, id); } catch (_) { return Infinity; } },
      canAfford(id) { const c = ctx.cost(id); return Number.isFinite(c) && state.money >= c; },
      money$(n) { return "$" + E.formatMoney(n); },
      machineName(id) { const d = D.machineById(id); return d ? tr(d.nameKey) : String(id); },
      catalogCollapsed() { const h = qs("#zone-machine-selector"); return !!(h && h.classList.contains("is-collapsed")); },
      bestMachineSlot() { return pickMachineSlot(floor, false); },
      ui: {
        upgradeReady() { return !!TARGETS["machinePanel.upgrade"]({}); },
        upgradeSlot() {
          if (!floor || !Array.isArray(floor.grid)) return null;
          const slots = floor.grid.slice();
          // Prefer the selected machine so the hint's identity matches its target.
          const selected = G.UI && G.UI.selectedSlot;
          if (selected) {
            const i = slots.findIndex((slot) => slot && slot.r === selected.r && slot.c === selected.c);
            if (i > 0) slots.unshift(slots.splice(i, 1)[0]);
          }
          for (const slot of slots) {
            const machine = slot && slot.machine;
            if (!machine) continue;
            for (const uid of Object.keys(D.UPGRADES || {})) {
              const def = D.UPGRADES[uid];
              const level = Math.max(0, Number(machine.levels && machine.levels[uid]) || 0);
              if (!def || level >= def.maxLevel) continue;
              let cost;
              try { cost = E.upgradeCost(uid, level, state); } catch (_) { continue; }
              if (Number.isFinite(cost) && state.money >= cost) return { r: slot.r, c: slot.c, upgradeId: uid, level };
            }
          }
          return null;
        },
      },
    };
    return ctx;
  }

  // ============================================================
  // Targets — semantic ids -> live screen rectangles.
  // ALL DOM selectors used by guidance live in this single table, built only
  // on identifiers the game UI already exposes (ids, data-* attributes).
  // ============================================================
  function toRect(left, top, width, height) {
    return { left, top, width, height, right: left + width, bottom: top + height, cx: left + width / 2, cy: top + height / 2 };
  }
  function viewportRect() { return toRect(0, 0, window.innerWidth, window.innerHeight); }
  function domTarget(el) {
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const vp = viewportRect();
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vp.width || r.top >= vp.height) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden") return null;
    // Interactive elements must really be reachable (not clipped by a scroller or covered by
    // another UI layer). Purely informational pills (pointer-events:none) cannot be hit-tested.
    if (cs.pointerEvents !== "none") {
      const px = clamp(r.left + r.width / 2, 1, vp.width - 1), py = clamp(r.top + r.height / 2, 1, vp.height - 1);
      const hit = document.elementFromPoint(px, py);
      if (!hit || !(hit === el || el.contains(hit))) return null;
    }
    return { rect: toRect(r.left, r.top, r.width, r.height), kind: "dom", el };
  }

  function slotRect(r, c) {
    if (!G.Render || !lastState) return null;
    const vp = G.Render.getViewportRect();
    const w = G.Render.slotWorldPos(r, c);
    const s = G.Render.worldToScreen(w.x, w.y);
    const zoom = Number(lastState.camera && lastState.camera.zoom) || 1;
    const size = G.Render.CELL * zoom * 0.88;
    return toRect(vp.left + s.x - size / 2, vp.top + s.y - size / 2, size, size);
  }
  // 0..5 : how many sample points of the slot are visible AND tappable on the canvas.
  function slotCoverage(rect) {
    if (!rect || !canvasEl) return 0;
    const vp = viewportRect();
    const pts = [[0, 0], [-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]];
    let n = 0;
    pts.forEach((p) => {
      const x = rect.cx + p[0] * rect.width, y = rect.cy + p[1] * rect.height;
      if (x <= 0 || y <= 0 || x >= vp.width || y >= vp.height) return;
      if (document.elementFromPoint(x, y) === canvasEl) n++;
    });
    return n;
  }
  function slotTarget(r, c) {
    const rect = slotRect(r, c);
    if (!rect) return null;
    const vp = viewportRect();
    const off = rect.right < 0 || rect.bottom < 0 || rect.left > vp.width || rect.top > vp.height;
    return { rect, kind: "slot", offscreen: off, r, c };
  }
  function floorKey(state) { return state.currentZoneId + "/" + state.currentFloorId; }

  function pickEmptySlot(floor) {
    if (!floor || !lastState) return null;
    const key = floorKey(lastState);
    const empties = floor.grid.filter((s) => !s.machine);
    if (!empties.length) return null;
    const mem = slotMemory.empty;
    if (mem && mem.key === key) {
      const s = empties.find((e) => e.r === mem.r && e.c === mem.c);
      if (s && slotCoverage(slotRect(s.r, s.c)) >= 4) return s;
    }
    // Onboarding placement must teach a clean factory layout, not merely find the
    // nearest visible slot. Prefer the first reachable empty slot in row-major
    // order so a fresh run naturally builds left-to-right across the top row
    // (then continues downward only when needed). This remains camera/render based
    // and never hard-codes screen pixels.
    const ordered = empties.slice().sort((a, b) => (a.r - b.r) || (a.c - b.c));
    let best = null;
    for (const s of ordered) {
      const rect = slotRect(s.r, s.c);
      if (slotCoverage(rect) >= 4) { best = s; break; }
    }
    slotMemory.empty = best ? { key, r: best.r, c: best.c } : null;
    return best;
  }
  function pickMachineSlot(floor) {
    if (!floor || !lastState) return null;
    const key = floorKey(lastState);
    const withMachine = floor.grid.filter((s) => s.machine);
    if (!withMachine.length) return null;
    const mem = slotMemory.machine;
    if (mem && mem.key === key) {
      const s = withMachine.find((m) => m.r === mem.r && m.c === mem.c);
      if (s) return s;
    }
    let best = withMachine[0];
    withMachine.forEach((s) => { if ((s.machine.banked || 0) > (best.machine.banked || 0)) best = s; });
    slotMemory.machine = { key, r: best.r, c: best.c };
    return best;
  }

  const TARGETS = {
    none() { return { rect: null, kind: "none" }; },
    "catalog.machine"(p) { return domTarget(qs('#zone-machine-selector [data-machine-id="' + cssEsc(p.machineId) + '"]')); },
    "catalog.toggle"() { return domTarget(qs("#zone-machine-selector .machine-selector-toggle")); },
    "hud.zone"() { return domTarget(qs("#hud-location")); },
    menu(p) { return domTarget(qs('#bottom-menu .menu-btn[data-panel="' + cssEsc(p.panel) + '"]')); },
    "zone.button"(p) { return domTarget(qsa("#zone-buttons .lb-btn")[p.index]); },
    "zone.unlock"(p) {
      const id = cssEsc(p.zoneId);
      const unlock = domTarget(qs('#modal-content #btn-atlas-unlock[data-zone-unlock="' + id + '"]'));
      if (unlock) return unlock;
      // If the Atlas is open but showing a different Zone, guide the player to
      // select the right preview; the next refresh will retarget the unlock button.
      const preview = domTarget(qs('#modal-content [data-preview-zone="' + id + '"]'));
      if (preview) return preview;
      return null;
    },
    "floor.button"(p) { return domTarget(qsa("#floor-buttons .lb-btn")[p.index]); },
    "machinePanel.upgrade"() { return domTarget(qs("#machine-panel:not(.hidden) [data-upgrade]:not([disabled])")); },
    "mechanic.action"(p) { return domTarget(qs('#mechanic-indicator-stack [data-mechanic-action="' + cssEsc(p.actionId) + '"][data-mechanic-id="' + cssEsc(p.mechanicId) + '"]')); },
    "mechanic.indicator"(p) { return domTarget(qsa("#mechanic-indicator-stack .mechanic-indicator")[p.index]); },
    "rooms.room"(p) { return domTarget(qs('#modal-content [data-room="' + cssEsc(p.roomId) + '"]:not([disabled])')); },
    "rooms.floorSystem"(p) { return domTarget(qs('#modal-content [data-floorsys="' + cssEsc(p.systemId) + '"]:not([disabled])')); },
    "rooms.zoneContent"(p) { return domTarget(qs('#modal-content [data-zone-content="' + cssEsc(p.contentId) + '"][data-zone-content-kind="' + cssEsc(p.kind) + '"]:not([disabled])')); },
    slot(p) {
      const floor = lastState ? currentFloorOf(lastState) : null;
      if (!floor) return null;
      let s = null;
      if (p.pick === "empty") s = pickEmptySlot(floor);
      else if (p.pick === "machine") s = pickMachineSlot(floor);
      else if (p.pick === "at") s = floor.grid.find((x) => x.r === p.r && x.c === p.c) || null;
      return s ? slotTarget(s.r, s.c) : null;
    },
  };

  function resolveTarget(spec) {
    if (!spec) return null;
    const fn = TARGETS[spec.id];
    const res = fn ? fn(spec.params || {}) : null;
    if (res) return res;
    return spec.fallback ? resolveTarget(spec.fallback) : null;
  }

  // ============================================================
  // Presenter — spotlight / pointer / card, positioned from live rects.
  // ============================================================
  const P = { spot: null, pointer: null, card: null, tag: null, title: null, text: null, actions: null,
    sig: "", size: { w: 0, h: 0 }, insets: { top: 0, right: 0, bottom: 0, left: 0 }, vpSig: "", style: {} };

  function buildPresenter() {
    layerEl.innerHTML =
      '<div class="tut-spot"></div>' +
      '<div class="tut-pointer"><i></i></div>' +
      '<div class="tut-card" role="status"><div class="tut-tag"></div><div class="tut-title"></div><div class="tut-text"></div><div class="tut-actions"></div></div>';
    P.spot = qs(".tut-spot", layerEl); P.pointer = qs(".tut-pointer", layerEl); P.card = qs(".tut-card", layerEl);
    P.tag = qs(".tut-tag", layerEl); P.title = qs(".tut-title", layerEl); P.text = qs(".tut-text", layerEl); P.actions = qs(".tut-actions", layerEl);
    layerEl.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-tut]");
      if (b) onButton(b.getAttribute("data-tut"));
    });
  }

  function measureInsets() {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    P.insets = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
    probe.remove();
  }

  function setStyle(el, name, value) {
    const k = name;
    const map = P.style[k] || (P.style[k] = new WeakMap());
    if (map.get(el) === value) return;
    map.set(el, value);
    if (name.charAt(0) === "-") el.style.setProperty(name, value); else el.style[name] = value;
  }
  function setClass(el, cls, on) { if (el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on); }

  function setContent(view) {
    const buttons = view.buttons || [];
    const sig = [view.mode, view.tag || "", view.title || "", view.text || "", buttons.join(",")].join("\u0001");
    if (sig === P.sig) return false;
    P.sig = sig;
    P.tag.textContent = view.tag || ""; setClass(P.tag, "tut-empty", !view.tag);
    P.title.textContent = view.title || ""; setClass(P.title, "tut-empty", !view.title);
    P.text.textContent = view.text || ""; setClass(P.text, "tut-empty", !view.text);
    P.actions.innerHTML = buttons.map((b) => {
      const label = b === "skip" ? tr("tutorial.skip") : b === "off" ? tr("tutorial.turnOff") : tr("tutorial.gotIt");
      return '<button type="button" class="tut-btn' + (b === "ok" ? " tut-btn-primary" : "") + '" data-tut="' + b + '">' + escapeHtml(label) + "</button>";
    }).join("");
    setClass(P.actions, "tut-empty", !buttons.length);
    return true;
  }

  function place(view, tgt) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const vpSig = vw + "x" + vh;
    if (vpSig !== P.vpSig) { P.vpSig = vpSig; measureInsets(); P.sig = P.sig + "~"; }
    const mode = view.mode;
    setClass(layerEl, "tut-mode-spotlight", mode === "spotlight");
    setClass(layerEl, "tut-mode-bubble", mode === "bubble");
    setClass(layerEl, "tut-mode-card", mode === "card");

    const changed = setContent(view);
    if (changed || !P.size.w) { P.size = { w: P.card.offsetWidth, h: P.card.offsetHeight }; }
    const cw = P.size.w, ch = P.size.h;
    const I = P.insets, M = 10, gap = 18;
    const minX = I.left + M, maxX = vw - I.right - M - cw, minY = I.top + M, maxY = vh - I.bottom - M - ch;

    const rect = tgt && tgt.rect && !tgt.offscreen && mode !== "card" ? tgt.rect : null;
    let x, y, side = null;
    if (view.cardAnchor === "top-left") {
      setStyle(P.spot, "display", rect ? "block" : "none");
      if (rect) {
        const pad = 6;
        setStyle(P.spot, "left", (rect.left - pad).toFixed(1) + "px");
        setStyle(P.spot, "top", (rect.top - pad).toFixed(1) + "px");
        setStyle(P.spot, "width", (rect.width + pad * 2).toFixed(1) + "px");
        setStyle(P.spot, "height", (rect.height + pad * 2).toFixed(1) + "px");
      }
      x = minX; y = minY;
    } else if (rect) {
      const pad = 6;
      setStyle(P.spot, "left", (rect.left - pad).toFixed(1) + "px");
      setStyle(P.spot, "top", (rect.top - pad).toFixed(1) + "px");
      setStyle(P.spot, "width", (rect.width + pad * 2).toFixed(1) + "px");
      setStyle(P.spot, "height", (rect.height + pad * 2).toFixed(1) + "px");
      setStyle(P.spot, "display", "block");
      const space = { below: vh - I.bottom - M - (rect.bottom + gap), above: rect.top - gap - minY, right: vw - I.right - M - (rect.right + gap), left: rect.left - gap - (I.left + M) };
      const fits = { below: space.below >= ch, above: space.above >= ch, right: space.right >= cw, left: space.left >= cw };
      const order = ["below", "above", "right", "left"];
      side = order.find((s) => fits[s]);
      if (!side) side = order.sort((a, b) => (space[b] / (b === "below" || b === "above" ? ch : cw)) - (space[a] / (a === "below" || a === "above" ? ch : cw)))[0];
      if (side === "below") { x = rect.cx - cw / 2; y = rect.bottom + gap; }
      else if (side === "above") { x = rect.cx - cw / 2; y = rect.top - gap - ch; }
      else if (side === "right") { x = rect.right + gap; y = rect.cy - ch / 2; }
      else { x = rect.left - gap - cw; y = rect.cy - ch / 2; }
    } else {
      setStyle(P.spot, "display", "none");
      x = (vw - cw) / 2; y = I.top + 78;
    }
    x = clamp(x, minX, maxX); y = clamp(y, minY, maxY);
    setStyle(P.card, "left", x.toFixed(1) + "px");
    setStyle(P.card, "top", y.toFixed(1) + "px");

    // Pointer: on the target edge facing the card; or an edge arrow for off-screen targets.
    if (rect && view.cardAnchor === "top-left") {
      const px = clamp(rect.cx, rect.left + 14, rect.right - 14);
      const py = clamp(rect.top - 10, 10, vh - 10);
      const dx = px - (x + cw / 2), dy = py - (y + ch / 2);
      const rot = Math.atan2(dy, dx) * 180 / Math.PI + 90;
      setStyle(P.pointer, "left", px.toFixed(1) + "px"); setStyle(P.pointer, "top", py.toFixed(1) + "px");
      setStyle(P.pointer, "--tut-rot", rot.toFixed(1) + "deg"); setStyle(P.pointer, "display", "block");
      P.pointer.classList.remove("tut-pointer-edge");
    } else if (rect && side) {
      let px, py, rot;
      if (side === "below") { px = clamp(rect.cx, rect.left + 14, rect.right - 14); py = rect.bottom + 6 + 2; rot = 0; }
      else if (side === "above") { px = clamp(rect.cx, rect.left + 14, rect.right - 14); py = rect.top - 6 - 2; rot = 180; }
      else if (side === "right") { px = rect.right + 6 + 2; py = clamp(rect.cy, rect.top + 14, rect.bottom - 14); rot = -90; }
      else { px = rect.left - 6 - 2; py = clamp(rect.cy, rect.top + 14, rect.bottom - 14); rot = 90; }
      setStyle(P.pointer, "left", px.toFixed(1) + "px"); setStyle(P.pointer, "top", py.toFixed(1) + "px");
      setStyle(P.pointer, "--tut-rot", rot + "deg"); setStyle(P.pointer, "display", "block");
      P.pointer.classList.remove("tut-pointer-edge");
    } else if (tgt && tgt.offscreen && tgt.rect && mode !== "card") {
      const dx = tgt.rect.cx - vw / 2, dy = tgt.rect.cy - vh / 2;
      const k = Math.min((vw / 2 - 28 - I.right) / Math.max(1, Math.abs(dx)), (vh / 2 - 28 - I.bottom) / Math.max(1, Math.abs(dy)));
      const px = vw / 2 + dx * k, py = vh / 2 + dy * k;
      const rot = Math.atan2(dy, dx) * 180 / Math.PI + 90;
      setStyle(P.pointer, "left", px.toFixed(1) + "px"); setStyle(P.pointer, "top", py.toFixed(1) + "px");
      setStyle(P.pointer, "--tut-rot", rot.toFixed(1) + "deg"); setStyle(P.pointer, "display", "block");
      P.pointer.classList.add("tut-pointer-edge");
    } else {
      setStyle(P.pointer, "display", "none");
    }
  }

  function syncTutorialUiState() {
    const app = document.getElementById("app");
    if (!app) return;
    const source = active ? active.source : "none";
    const step = active && active.id ? active.id.replace(/^l1:/, "") : "";
    setClass(app, "tut-l1-active", source === "l1");
    app.dataset.tutorialSource = source;
    if (source === "l1") app.dataset.tutorialStep = step;
    else delete app.dataset.tutorialStep;
  }

  function showLayer(on) {
    setClass(layerEl, "tut-on", on);
    syncTutorialUiState();
  }

  // ============================================================
  // Controller
  // ============================================================
  function panelGuidanceAllowed(hintId, allowUrgentDuringLayer1) {
    const store = Store.get();
    const layer1AllowsContext = store.layer1.status === "done" || (store.layer1.status === "active" && !!allowUrgentDuringLayer1);
    if (!G.UI || !layer1AllowsContext || !store.layer2.enabled) return false;
    const id = hintId || (active && active.source === "l2" ? active.id : "");
    if (!id) return false;
    if (G.UI.activePanel === "rooms") return id.startsWith("rooms:");
    if (G.UI.activePanel === "zones") return id.startsWith("zone:");
    return false;
  }

  function syncLayerParent() {
    if (!layerEl) return;
    const app = document.getElementById("app");
    const modal = document.getElementById("modal-overlay");
    const inModal = panelGuidanceAllowed(undefined, !!(active && active.source === "l2" && active.urgent)) && modal;
    const parent = inModal ? modal : app;
    if (parent && layerEl.parentElement !== parent) parent.appendChild(layerEl);
    layerEl.classList.toggle("tut-in-modal", !!inModal);
  }

  function isEnvironmentBlocked() {
    const r = document.getElementById("rotate-overlay"); if (r && !r.classList.contains("hidden")) return true;
    const f = document.getElementById("fullscreen-recovery"); if (f && !f.classList.contains("hidden")) return true;
    const s = document.getElementById("start-screen"); if (s && !s.classList.contains("hidden")) return true;
    return false;
  }
  function isBlocked() {
    if (G.UI && G.UI.isPanelOpen && !panelGuidanceAllowed(undefined, !!(active && active.source === "l2" && active.urgent))) return true;
    return isEnvironmentBlocked();
  }

  function persist() { Store.save(); }
  function setFlag(name) {
    const store = Store.get();
    if (store.layer1.status !== "active" || store.layer1.flags[name]) return;
    store.layer1.flags[name] = true; persist(); dirty = true;
  }
  function grantLayer1Bonus(state, milestoneId, flagName) {
    const store = Store.get();
    if (store.layer1.flags[flagName]) return false;
    if (!G.Factory || typeof G.Factory.grantTutorialBonus !== "function") return false;
    const amount = G.Factory.grantTutorialBonus(state, milestoneId);
    if (!(amount > 0)) return false;
    store.layer1.flags[flagName] = true;
    persist();
    dirty = true;
    if (G.UI && typeof G.UI.refreshHUD === "function") G.UI.refreshHUD();
    return true;
  }
  function finishLayer1(reason, withOutro) {
    const store = Store.get();
    store.layer1.status = "done"; store.layer1.reason = reason; store.layer1.finishedAt = Date.now();
    persist();
    layer1ClearedAt = performance.now();
    active = null; P.sig = "";
    if (withOutro) outroUntil = performance.now() + G.TutorialContent.layer1.outro.displayMs;
    dirty = true;
  }
  function isFreshGame(state) {
    const first = G.DATA.ZONES[0];
    return countMachines(state) === 0 && (state.stats.totalMachinesPlaced || 0) === 0
      && (state.lifetimeEarned || 0) === 0 && (!first || state.currentZoneId === first.id);
  }

  function onButton(id) {
    if (!active) return;
    if (id === "ok" && active.source === "l1" && active.id === "l1:basicDone") {
      const store = Store.get();
      store.layer1.flags.basicDoneAcknowledged = true;
      persist();
      grantLayer1Bonus(lastState, "basicDone", "reward1000Granted");
      active = null; P.sig = ""; dirty = true;
      return;
    }
    if (id === "ok") {
      if (active.source === "l2") {
        const store = Store.get();
        store.layer2.seen[active.id] = Date.now();
        persist();
      }
      endActive();
    }
  }
  function endActive() {
    const wasOutro = active && active.source === "outro";
    active = null; P.sig = "";
    if (wasOutro) outroUntil = 0;
    nextHintAt = performance.now() + G.TutorialContent.layer2.gapMs;
    dirty = true;
  }

  function makeView(def, source) {
    const text = def.text && typeof def.text === "object" ? tr(def.text.key, def.text.params) : (def.text || "");
    const view = { mode: def.mode, target: def.target, text, cardAnchor: def.cardAnchor };
    if (source === "l1") {
      view.buttons = Array.isArray(def.buttons) ? def.buttons.slice() : [];
      view.title = def.title || (def.titleKey ? tr(def.titleKey) : "");
    }
    else if (source === "outro") { view.buttons = ["ok"]; view.title = tr(def.titleKey); }
    else {
      view.buttons = ["ok"];
      view.tag = def.tagKey ? tr(def.tagKey) : "";
      view.title = def.title || (def.titleKey ? tr(def.titleKey) : "");
    }
    return view;
  }

  function refresh(state, mechanicUi) {
    const ctx = buildContext(state, mechanicUi);
    lastCtx = ctx;
    const store = Store.get();
    const content = G.TutorialContent;
    const now = ctx.now;
    const l2 = store.layer2;
    const cfg = content.layer2;
    const freshLayer1Boot = store.layer1.status === "pending" && isFreshGame(state);

    // Build the contextual candidates before Layer 1 decides what to render. This
    // lets a newly actionable purchase/unlock briefly interrupt onboarding, while
    // ordinary contextual tips still wait until Layer 1 is complete.
    const candidates = [];
    if (l2.enabled) {
      cfg.generators.forEach((gen) => {
        try { (gen(ctx) || []).forEach((cnd) => candidates.push(cnd)); }
        catch (e) { console.error("[Guidance] hint generator failed", e); }
      });
    }
    const environmentBlocked = isEnvironmentBlocked();
    const panelOpen = !!(G.UI && G.UI.isPanelOpen);
    const selectableCandidates = panelOpen
      ? candidates.filter((c) => panelGuidanceAllowed(c.id, !!c.urgent))
      : candidates;
    const previousCandidateIds = lastCandidateIds;
    const newlyUrgentCandidates = selectableCandidates
      .filter((c) => c.urgent && !l2.seen[c.id] && !previousCandidateIds.has(c.id));
    const newlyAvailableUrgent = !freshLayer1Boot && newlyUrgentCandidates.length > 0;
    const unseenUrgentCandidates = selectableCandidates.filter((c) => c.urgent && !l2.seen[c.id]);
    // Opening the correct panel is itself a useful context signal: present an
    // eligible in-panel purchase/unlock tip even if its affordability predated the
    // panel opening. Keep the first fresh-game onboarding frame protected.
    const urgentForLayer1 = freshLayer1Boot ? [] : (newlyUrgentCandidates.length
      ? newlyUrgentCandidates
      : (panelOpen ? unseenUrgentCandidates : []));
    if (!environmentBlocked) {
      // Track the full candidate set, not the panel-filtered subset, so opening
      // Rooms/Atlas does not make every gameplay hint look newly available later.
      lastCandidateIds = new Set(candidates.map((c) => c.id));
    }

    // ---- Layer 1 lifecycle ----
    if (store.layer1.status === "pending") {
      if (isFreshGame(state)) { store.layer1.status = "active"; store.layer1.startedAt = Date.now(); persist(); }
      else { finishLayer1("existing-player", false); }
    }
    if (store.layer1.status === "active") {
      if (store.layer1.flags.collected) grantLayer1Bonus(state, "firstCollect", "reward100Granted");
      const steps = content.layer1.steps;
      const idx = steps.findIndex((step) => { try { return !step.done(ctx); } catch (_) { return false; } });
      if (idx < 0) {
        finishLayer1("completed", false);
      } else {
        let def = null;
        try { def = steps[idx].view(ctx); } catch (e) { console.error("[Guidance] step view failed", e); }

        // Keep a valid urgent Layer 2 card alive while Layer 1 is active. If its
        // action disappeared, release it without marking it seen and let the new
        // candidate (or the pending Layer 1 step) take over in this same refresh.
        if (active && active.source === "l2") {
          const still = candidates.find((c) => c.id === active.id);
          const canRemain = still && selectableCandidates.some((c) => c.id === active.id);
          if (canRemain && now - active.shownAt <= cfg.maxVisibleMs) {
            const preempt = newlyUrgentCandidates
              .filter((c) => c.id !== active.id)
              .sort((a, b) => (b.priority || 0) - (a.priority || 0))
              .find((c) => { const t = resolveTarget(c.target); return !!t && !t.offscreen; });
            if (preempt) {
              active = { source: "l2", id: preempt.id, urgent: !!preempt.urgent, priority: Number(preempt.priority) || 0, view: makeView(preempt, "l2"), shownAt: now };
              P.sig = "";
            } else {
              active.view = makeView(still, "l2");
              active.urgent = !!still.urgent;
              active.priority = Number(still.priority) || 0;
            }
            return;
          }
          if (still && now - active.shownAt > cfg.maxVisibleMs) {
            l2.seen[active.id] = Date.now(); persist();
            nextHintAt = now + cfg.gapMs;
          } else if (!still && newlyAvailableUrgent) {
            nextHintAt = 0;
          }
          active = null; P.sig = "";
        }

        if (def) {
          // Only a newly available urgent action may interrupt a visible Layer 1
          // step. The first-ever frame of a fresh game is baselined above so
          // starter-zone tips do not jump ahead of the onboarding introduction.
          if (urgentForLayer1.length && !environmentBlocked) {
            const urgent = urgentForLayer1
              .slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
            const chosen = urgent.find((c) => {
              const t = resolveTarget(c.target);
              return !!t && !t.offscreen;
            });
            if (chosen) {
              active = { source: "l2", id: chosen.id, urgent: true, priority: Number(chosen.priority) || 0, view: makeView(chosen, "l2"), shownAt: now };
              P.sig = "";
              return;
            }
          }
          active = { source: "l1", id: "l1:" + steps[idx].id, view: makeView(def, "l1"), shownAt: active && active.id === "l1:" + steps[idx].id ? active.shownAt : now };
          return;
        }
        // A conditional Layer 1 step with no useful target must not deadlock
        // contextual guidance; it will resume as soon as its view becomes valid.
        if (active && active.source === "l1") { active = null; P.sig = ""; }
      }
    }

    // ---- Layer 1 outro card ----
    if (outroUntil > 0) {
      if (now < outroUntil) {
        if (!active || active.source !== "outro") active = { source: "outro", id: "outro", view: makeView(content.layer1.outro, "outro"), shownAt: now };
        else active.view = makeView(content.layer1.outro, "outro");
        return;
      }
      outroUntil = 0; active = null; nextHintAt = now + cfg.gapMs;
    }

    // ---- Layer 2 ----
    if (!l2.enabled) { if (active && active.source === "l2") active = null; return; }
    if (panelOpen && !selectableCandidates.length) return;

    if (active && active.source === "l2") {
      const still = candidates.find((c) => c.id === active.id);
      if (!still) {
        // The player completed the action or changed context. Do not consume the
        // hint, and let a newly available urgent action use this same refresh.
        active = null; P.sig = "";
        if (newlyAvailableUrgent) nextHintAt = 0;
        else nextHintAt = Math.max(nextHintAt, now + cfg.gapMs);
      } else if (now - active.shownAt > cfg.maxVisibleMs) {
        l2.seen[active.id] = Date.now(); persist();
        endActive(); return;
      } else {
        const urgent = selectableCandidates
          .filter((c) => c.urgent && !l2.seen[c.id] && (c.priority || 0) > (still.priority || 0))
          .sort((a, b) => (b.priority || 0) - (a.priority || 0));
        const preempt = urgent.find((c) => { const t = resolveTarget(c.target); return !!t && !t.offscreen; });
        if (preempt) {
          active = { source: "l2", id: preempt.id, urgent: !!preempt.urgent, priority: Number(preempt.priority) || 0, view: makeView(preempt, "l2"), shownAt: now };
          P.sig = "";
        } else {
          active.view = makeView(still, "l2");
          active.urgent = !!still.urgent;
          active.priority = Number(still.priority) || 0;
          return;
        }
      }
    }

    if (active) return;
    if (now < nextHintAt && !newlyAvailableUrgent) return;
    if (layer1ClearedAt && now - layer1ClearedAt < cfg.firstGapMs && !newlyAvailableUrgent) return;
    if (environmentBlocked || (panelOpen && !selectableCandidates.length)) return;
    selectableCandidates.sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || (b.priority || 0) - (a.priority || 0));
    for (let i = 0; i < selectableCandidates.length; i++) {
      const cnd = selectableCandidates[i];
      if (l2.seen[cnd.id]) continue;
      const tgt = resolveTarget(cnd.target);
      if (!tgt) continue;
      if (tgt.offscreen) continue;
      active = { source: "l2", id: cnd.id, urgent: !!cnd.urgent, priority: Number(cnd.priority) || 0, view: makeView(cnd, "l2"), shownAt: now };
      return;
    }
  }

  function update(state, dt, mechanicUi) {
    try {
      if (!state) return;
      if (!initialized) init();
      if (lastState && state !== lastState) onStateReplaced(state);
      lastState = state;
      lastMechanicUi = mechanicUi || EMPTY_UI;

      syncLayerParent();
      const roomsOpen = !!(G.UI && G.UI.activePanel === "rooms");
      const zonesOpen = !!(G.UI && G.UI.activePanel === "zones");
      if (roomsOpen && active && active.source === "l2" && !active.id.startsWith("rooms:")) {
        // The previous hint belongs to the gameplay canvas, not this panel. Do not
        // consume it; forget its baseline so it can become eligible after closing.
        lastCandidateIds.delete(active.id);
        active = null; P.sig = "";
      }
      if (zonesOpen && active && active.source === "l2" && !active.id.startsWith("zone:")) {
        lastCandidateIds.delete(active.id);
        active = null; P.sig = "";
      }
      const blocked = isBlocked();
      if (blocked && active && active.source === "l2") {
        lastCandidateIds.delete(active.id);
        active = null; P.sig = ""; nextHintAt = performance.now() + G.TutorialContent.layer2.gapMs;
      }

      const now = performance.now();
      if (dirty || now - lastRefreshAt >= REFRESH_MS) {
        lastRefreshAt = now; dirty = false;
        refresh(state, lastMechanicUi);
      }
      if (!active || blocked) { showLayer(false); return; }

      const tgt = active.view.mode === "card" || (active.view.target && active.view.target.id === "none") ? null : resolveTarget(active.view.target);
      if (active.source === "l1" && !tgt && active.view.mode !== "card") {
        // Target momentarily unavailable (e.g. catalogue scrolled / covered): show text only, no pointer.
        place(active.view, null);
      } else {
        place(active.view, tgt);
      }
      showLayer(true);
    } catch (e) {
      console.error("[Guidance] recovered from error:", e);
      try { active = null; showLayer(false); } catch (_) {}
    }
  }

  function onStateReplaced(state) {
    // Hard reset / save import swapped the whole state tree.
    const store = Store.get();
    slotMemory.empty = slotMemory.machine = null;
    lastCandidateIds = new Set();
    pendingEvents.bonus = null;
    if (store.layer1.status === "active") {
      // First-time onboarding was never finished: it simply starts from the real new state.
      store.layer1.flags.selected = false;
      store.layer1.flags.collected = false;
      store.layer1.flags.reward100Granted = false;
      store.layer1.flags.basicDoneAcknowledged = false;
      store.layer1.flags.reward1000Granted = false;
      persist();
    }
    active = null; P.sig = ""; dirty = true;
  }

  function observeEvent(ev) {
    if (!ev || !initialized) return;
    try {
      const store = Store.get();
      if (ev.type === "machinePlaced") { dirty = true; }
      else if (ev.type === "machineCollected") {
        if (!ev.automatic && ev.amount > 0) setFlag("collected");
        dirty = true;
      } else if (ev.type === "bonusReady") {
        if (store.layer2.enabled) pendingEvents.bonus = { zoneId: ev.zoneId, floorId: ev.floorId, r: ev.r, c: ev.c, at: performance.now() };
      }
    } catch (_) { /* observers never throw into gameplay */ }
  }

  // ============================================================
  // Init + DOM listeners (passive observers of real player input)
  // ============================================================
  function init() {
    initialized = true;
    Store.load();
    layerEl = document.getElementById("tutorial-layer");
    if (!layerEl) {
      layerEl = document.createElement("div"); layerEl.id = "tutorial-layer";
      (document.getElementById("app") || document.body).appendChild(layerEl);
    }
    canvasEl = document.getElementById("gameCanvas");
    nextHintAt = performance.now() + G.TutorialContent.layer2.firstGapMs;
    buildPresenter();
    measureInsets();

    // Selecting a machine through the catalogue: observe the real click AFTER the game handled it.
    const host = document.getElementById("zone-machine-selector");
    if (host) host.addEventListener("click", (e) => {
      const card = e.target.closest && e.target.closest("[data-machine-id]");
      if (!card || !lastState) return;
      const id = card.getAttribute("data-machine-id");
      if (id === G.DATA.MACHINE_TYPES[0].id && lastState.selectedMachineId === id) setFlag("selected");
    });
    window.addEventListener("keydown", (e) => {
      if (!lastState || !/^Digit[1-8]$/.test(e.code)) return;
      if (lastState.selectedMachineId === G.DATA.MACHINE_TYPES[0].id) setFlag("selected");
    });
    window.addEventListener("resize", () => { P.vpSig = ""; dirty = true; });
    if (G.i18n && G.i18n.onChange) G.i18n.onChange(() => { P.sig = ""; dirty = true; });
  }

  // ============================================================
  // Settings integration (follows the existing .setting-row / .switch markup)
  // ============================================================
  function isGuidanceEnabled() { return !!Store.get().layer2.enabled; }
  function setGuidanceEnabled(on) {
    const store = Store.get();
    store.layer2.enabled = !!on; persist();
    if (!on && active && active.source === "l2") { active = null; P.sig = ""; }
    dirty = true;
  }
  function settingsHtml() {
    const on = isGuidanceEnabled();
    return '<div class="setting-row setting-guidance"><span class="setting-guidance-label"><b>' + escapeHtml(tr("tutorial.settings.guidance")) +
      '</b><small>' + escapeHtml(tr("tutorial.settings.guidanceHint")) + '</small></span>' +
      '<label class="switch"><input type="checkbox" id="chk-guidance" ' + (on ? "checked" : "") + '><span class="track"></span><span class="knob"></span></label></div>' +
      '<div class="setting-row"><button type="button" class="btn" id="btn-guidance-reset">' + escapeHtml(tr("tutorial.settings.resetHints")) + "</button></div>";
  }
  function resetFirstTime() {
    const store = Store.get();
    store.layer1.status = "pending";
    store.layer1.reason = "manual-reset";
    store.layer1.flags.selected = false;
    store.layer1.flags.collected = false;
    store.layer1.flags.reward100Granted = false;
    store.layer1.flags.basicDoneAcknowledged = false;
    store.layer1.flags.reward1000Granted = false;
    store.layer1.startedAt = 0;
    store.layer1.finishedAt = 0;
    active = null;
    outroUntil = 0;
    layer1ClearedAt = 0;
    nextHintAt = 0;
    P.sig = "";
    slotMemory.empty = slotMemory.machine = null;
    lastCandidateIds = new Set();
    pendingEvents.bonus = null;
    persist();
    dirty = true;
    showLayer(false);
  }

  function wireSettings(root) {
    const chk = root && root.querySelector("#chk-guidance");
    if (chk) chk.addEventListener("change", (e) => setGuidanceEnabled(e.target.checked));
    const btn = root && root.querySelector("#btn-guidance-reset");
    if (btn) btn.addEventListener("click", () => {
      Store.get().layer2.seen = {}; persist(); nextHintAt = 0; dirty = true;
      btn.textContent = tr("tutorial.settings.resetHintsDone");
    });
  }

  // Read-only snapshot for diagnostics/tests. Never exposes mutators for gameplay.
  function inspect() {
    const s = Store.get();
    return JSON.parse(JSON.stringify({ store: s, active: active ? { source: active.source, id: active.id, mode: active.view.mode, text: active.view.text, title: active.view.title || "" } : null, storeKey: STORE_KEY }));
  }

  G.Tutorial = { update, observeEvent, settingsHtml, wireSettings, isGuidanceEnabled, setGuidanceEnabled, resetFirstTime, inspect };
})(window.Game = window.Game || {});
