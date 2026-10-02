
/* ============================================================
   04-background-core.js — Background Core.

   Backgrounds are visual-only. They may draw CSS, animate and react to
   pointer input, but they must never mutate economy, unlocks, skills or save.
   ============================================================ */
(function (G) {
  "use strict";

  const registry = new Map();
  let root = null;
  let styleTag = null;
  let activeZoneId = null;
  let activeDef = null;
  let activeBehavior = null;
  let activeZoneSnapshot = null;
  let activeDefSnapshot = null;
  let cachedUpdateStateView = null;
  let cachedUpdateState = null;
  let cachedUpdateZoneId = null;
  let cachedUpdateViewAt = -Infinity;
  let updateContext = null;
  let updateContextDt = 0;
  let updateContextState = null;

  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function sanitizeClassName(value, fallback) { return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) ? value : fallback; }

  class ZoneBackground {
    constructor(def) {
      if (new.target === ZoneBackground) throw new Error("ZoneBackground is abstract");
      if (!def || typeof def.id !== "string" || !def.id) throw new Error("ZoneBackground id is required");
      this.id = def.id;
      this.config = isPlainObject(def.config) ? def.config : {};
    }
    onEnter(_ctx) {}
    onExit(_ctx) {}
    update(_ctx) {}
    onPointerMove(_ctx) {}
    onPointerDown(_ctx) {}
    onPointerUp(_ctx) {}
  }

  function registerBackground(scriptId, BehaviorClass) {
    if (typeof scriptId !== "string" || !scriptId.trim()) throw new Error("Background script id is required");
    if (typeof BehaviorClass !== "function" || !(BehaviorClass.prototype instanceof ZoneBackground)) throw new Error("Background behavior must extend ZoneBackground");
    const existing = registry.get(scriptId);
    if (existing && existing !== BehaviorClass) throw new Error("Background script id already registered: " + scriptId);
    registry.set(scriptId, BehaviorClass);
  }

  function getDef(id) {
    const list = G.BackgroundContent && Array.isArray(G.BackgroundContent.backgrounds) ? G.BackgroundContent.backgrounds : [];
    return list.find((item) => item.id === id) || null;
  }

  function ensureRoot() { if (!root) root = document.getElementById("zone-background"); return root; }

  function installBackgroundStyles() {
    if (styleTag) return;
    const list = G.BackgroundContent && Array.isArray(G.BackgroundContent.backgrounds) ? G.BackgroundContent.backgrounds : [];
    const css = list.map((bg) => typeof bg.cssText === "string" ? bg.cssText : "").filter(Boolean).join("\n\n");
    if (!css) return;
    styleTag = document.createElement("style");
    styleTag.id = "mft-zone-background-styles";
    styleTag.textContent = css;
    document.head.appendChild(styleTag);
  }

  function setStyleObject(el, style) {
    if (!el || !isPlainObject(style)) return;
    Object.entries(style).forEach(([key, value]) => {
      if (!/^(--[A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9-]*)$/.test(key)) return;
      if (typeof value !== "string" && typeof value !== "number") return;
      el.style.setProperty(key, String(value));
    });
  }

  function currentZoneState(state, zoneId) { return G.Zone ? G.Zone.getZoneState(state, zoneId) : null; }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key]));
    return Object.freeze(value);
  }

  function buildStateView(state, zoneId) {
    const zone = currentZoneState(state, zoneId);
    const view = {
      zoneId,
      money: Number(state?.money) || 0,
      maxMoney: Number(state?.maxMoney) || 0,
      research: Number(state?.research) || 0,
      skills: { points: Number(state?.skills?.points) || 0 },
      zone: zone ? {
        unlocked: !!zone.unlocked,
        floorCount: Array.isArray(zone.floors) ? zone.floors.length : 0,
        unlockedMachineCount: Array.isArray(zone.unlockedMachineIds) ? zone.unlockedMachineIds.length : 0,
        occupiedMachineCount: Array.isArray(zone.floors) ? zone.floors.reduce((sum, floor) => sum + (Array.isArray(floor.grid) ? floor.grid.filter((slot) => slot && slot.machine).length : 0), 0) : 0,
        gridCapacity: Array.isArray(zone.floors) ? zone.floors.reduce((sum, floor) => sum + (Array.isArray(floor.grid) ? floor.grid.length : 0), 0) : 24,
        secretCount: Array.isArray(zone.secrets) ? zone.secrets.length : 0,
        stats: isPlainObject(zone.stats) ? Object.assign({}, zone.stats) : {},
      } : null,
    };
    return deepFreeze(view);
  }

  function getCachedUpdateStateView(state) {
    const now = performance.now();
    if (!cachedUpdateStateView || cachedUpdateState !== state || cachedUpdateZoneId !== activeZoneId || now - cachedUpdateViewAt >= 100) {
      cachedUpdateStateView = buildStateView(state, activeZoneId);
      cachedUpdateState = state;
      cachedUpdateZoneId = activeZoneId;
      cachedUpdateViewAt = now;
    }
    return cachedUpdateStateView;
  }

  function context(state, extra, cacheStateView) {
    return Object.assign({
      stateView: cacheStateView ? getCachedUpdateStateView(state) : buildStateView(state, activeZoneId),
      zoneId: activeZoneId,
      zoneDef: activeZoneSnapshot,
      element: root,
      config: activeDefSnapshot && isPlainObject(activeDefSnapshot.config) ? activeDefSnapshot.config : {},
    }, extra || {});
  }

  function detach(state) {
    if (!activeBehavior) return;
    try { activeBehavior.onExit(context(state)); } catch (error) { console.error("Background onExit failed:", activeZoneId, error); }
    activeBehavior = null;
    activeZoneSnapshot = null;
    activeDefSnapshot = null;
    cachedUpdateStateView = null;
    updateContext = null;
    updateContextState = null;
    cachedUpdateState = null;
    cachedUpdateZoneId = null;
  }

  function sync(state) {
    const host = ensureRoot();
    if (!host || !state) return;
    installBackgroundStyles();
    const zone = G.DATA.zoneById(state.currentZoneId);
    const def = zone ? getDef(zone.backgroundId) : null;
    if (!zone || !def) return;
    if (activeZoneId === zone.id) return;

    detach(state);
    activeZoneId = zone.id;
    activeDef = def;
    activeZoneSnapshot = deepFreeze(JSON.parse(JSON.stringify(zone || {})));
    activeDefSnapshot = deepFreeze(JSON.parse(JSON.stringify(def || {})));
    host.className = sanitizeClassName(def.className, "zone-background--default");
    host.style.cssText = "";
    setStyleObject(host, def.css);

    if (def.script) {
      const BehaviorClass = registry.get(def.script);
      if (!BehaviorClass) { console.warn("Background behavior not registered:", def.script); return; }
      try {
        activeBehavior = new BehaviorClass(activeDefSnapshot);
        activeBehavior.onEnter(context(state));
      } catch (error) {
        console.error("Background behavior quarantined:", zone.id, def.script, error);
        activeBehavior = null;
      }
    }
  }

  function update(state, dt) {
    if (!activeBehavior) return;
    updateContextState = state;
    updateContextDt = Math.max(0, Number(dt) || 0);
    if (!updateContext) {
      updateContext = Object.freeze({
        get stateView() { return getCachedUpdateStateView(updateContextState); },
        zoneId: activeZoneId,
        zoneDef: activeZoneSnapshot,
        element: root,
        config: activeDefSnapshot && isPlainObject(activeDefSnapshot.config) ? activeDefSnapshot.config : {},
        get dt() { return updateContextDt; },
      });
    }
    try { activeBehavior.update(updateContext); }
    catch (error) { console.error("Background behavior disabled:", activeZoneId, error); activeBehavior = null; updateContext = null; updateContextState = null; }
  }

  function pointer(method, state, x, y, pointerType) {
    if (!activeBehavior || !state || (G.UI && G.UI.isInputBlocked && G.UI.isInputBlocked())) return;
    try { activeBehavior[method](context(state, { x, y, pointerType })); }
    catch (error) { console.error("Background input behavior disabled:", activeZoneId, error); activeBehavior = null; }
  }

  function previewStyle(zoneId, element) {
    installBackgroundStyles();
    const zone = G.DATA.zoneById(zoneId);
    const def = zone ? getDef(zone.backgroundId) : null;
    if (!def || !element) return false;
    element.className = sanitizeClassName(def.className, "zone-background--default");
    element.style.cssText = "";
    setStyleObject(element, def.css);
    return true;
  }

  G.Background = {
    ZoneBackground,
    registerBackground,
    getDef,
    sync,
    update,
    pointerMove: (state, x, y, type) => pointer("onPointerMove", state, x, y, type),
    pointerDown: (state, x, y, type) => pointer("onPointerDown", state, x, y, type),
    pointerUp: (state, x, y, type) => pointer("onPointerUp", state, x, y, type),
    previewStyle,
    get activeZoneId() { return activeZoneId; },
    get registeredBehaviors() { return Array.from(registry.keys()); },
  };
})(window.Game = window.Game || {});
