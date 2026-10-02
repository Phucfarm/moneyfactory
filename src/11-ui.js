
/* ============================================================
   11-ui.js — DOM/UI layer.
   Machine selection is global; Zone Atlas can preview locked Zones.
   ============================================================ */
(function (G) {
  "use strict";

  const D = G.DATA, E = G.Econ, F = G.Factory;
  let state = null;
  let els = {};
  let selectedSlotRef = null;
  let activePanel = null;
  let selectedZonePreviewId = null;
  let onAfterAction = () => {};
  let onStateImported = () => {};
  let machineSelectorCollapsed = false;
  let hardResetReturnPanel = null;

  function $(id) { return document.getElementById(id); }
  function money(n) { return "$" + E.formatMoney(n); }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[ch])); }

  function init(initialState, opts) {
    state = initialState;
    try { machineSelectorCollapsed = localStorage.getItem("factory.machineSelectorCollapsed") === "1"; } catch (_) { machineSelectorCollapsed = false; }
    opts = opts || {};
    onAfterAction = opts.onAfterAction || (() => {});
    onStateImported = opts.onStateImported || (() => {});
    els = {
      moneyVal: $("hud-money-val"), mpsVal: $("hud-mps-val"), researchVal: $("hud-research-val"), powerVal: $("hud-power-val"), powerWrap: $("hud-power-wrap"),
      skillVal: $("hud-skill-val"), skillProgress: $("hud-skill-progress"),
      zoneName: $("hud-zone-name"), floorName: $("hud-floor-name"), zoneLocation: $("hud-location"),
      zoneButtons: $("zone-buttons"), floorButtons: $("floor-buttons"), zoneMachineSelector: $("zone-machine-selector"),
      machinePanel: $("machine-panel"), mechanicIndicators: $("mechanic-indicator-stack"), modalOverlay: $("modal-overlay"), modalContent: $("modal-content"), toastStack: $("toast-stack"),
      drawer: $("mobile-drawer"), drawerToggle: $("drawer-toggle"), dotTech: $("dot-tech"),
      mechanicDecorationLayer: $("mechanic-decoration-layer"), oceanFishEncyclopedia: $("ocean-fish-encyclopedia"),
    };

    document.querySelectorAll(".menu-btn[data-panel]").forEach((btn) => btn.addEventListener("click", () => {
      G.Audio.unlock(); G.Audio.sfxClick(); openPanel(btn.getAttribute("data-panel"));
    }));
    els.modalOverlay.addEventListener("click", (e) => { if (e.target === els.modalOverlay) closePanel(); });
    els.drawerToggle.addEventListener("click", () => { els.drawer.classList.toggle("hidden"); renderDrawer(); });
    els.zoneLocation.addEventListener("click", () => { G.Audio.unlock(); G.Audio.sfxClick(); openPanel("zones"); });
    els.zoneLocation.title = G.i18n.t("zone.openInfo");

    refreshAll();
  }

  function setState(newState) { state = newState; selectedSlotRef = null; selectedZonePreviewId = null; refreshAll(); }

  function toast(message, kind, durationMs) {
    const el = document.createElement("div");
    el.className = "toast" + (kind === "warn" ? " warn" : "") + (kind === "mechanic" ? " mechanic" : "") + (kind === "danger" ? " danger" : "");
    el.textContent = message;
    els.toastStack.appendChild(el);
    const duration = Math.max(500, Math.min(5000, Number(durationMs) || 2800));
    setTimeout(() => el.remove(), duration);
    while (els.toastStack.children.length > 4) els.toastStack.removeChild(els.toastStack.firstChild);
  }

  const mechanicEventSeenAt = new Map();
  function mechanicUiValue(ev) {
    if (ev == null || ev === "") return "";
    if (typeof ev === "number" && Number.isFinite(ev)) return String(ev);
    return String(ev);
  }

  function showMechanicEvent(ev) {
    if (!ev || ev.type !== "zoneMechanicUi" || ev.kind !== "banner") return;
    const key = [ev.zoneId, ev.mechanicId, ev.id].join(":");
    const now = performance.now();
    const last = mechanicEventSeenAt.get(key) || -Infinity;
    if (now - last < (Number(ev.cooldownMs) || 0)) return;
    mechanicEventSeenAt.set(key, now);

    let message = ev.labelKey ? G.i18n.t(ev.labelKey) : "";
    if (ev.detailKey) message += (message ? " — " : "") + G.i18n.t(ev.detailKey);
    const value = mechanicUiValue(ev.value);
    if (value) message += (message ? " " : "") + value + (ev.valueUnit || "");
    toast(message, ev.tone === "danger" ? "danger" : ev.tone === "warn" ? "warn" : "mechanic", ev.durationMs);
  }

  function formatMechanicIndicator(item) {
    const value = mechanicUiValue(item.value);
    const unit = item.valueUnit || "";
    return value ? value + unit : "";
  }


  const oceanFishDecorationNodes = new Map();
  let cachedOceanFishMechanicDef = null;
  let cachedOceanFishValidIds = null;

  function fishDecorationMarkup() {
    return `<span class="fish-shadow"></span><span class="fish-art"><span class="fish-tail"></span><span class="fish-fin fish-fin--top"></span><span class="fish-fin fish-fin--bottom"></span><span class="fish-body"><span class="fish-gill"></span><span class="fish-eye"><i></i></span><span class="fish-mouth"></span><span class="fish-mark fish-mark--1"></span><span class="fish-mark fish-mark--2"></span><span class="fish-mark fish-mark--3"></span><span class="fish-highlight"></span></span><span class="fish-splash fish-splash--1"></span><span class="fish-splash fish-splash--2"></span><span class="fish-splash fish-splash--3"></span><span class="fish-splash fish-splash--4"></span><span class="fish-splash fish-splash--5"></span><span class="fish-wet-shine"></span></span>`;
  }

  function refreshMechanicDecorations(mechanicUi) {
    const layer = els.mechanicDecorationLayer;
    if (!layer || !state || !G.Zone || !G.Render) return;
    const decorations = (mechanicUi && mechanicUi.machineDecorations) || [];
    if (!decorations.length && oceanFishDecorationNodes.size === 0) return;
    if (!cachedOceanFishMechanicDef) cachedOceanFishMechanicDef = oceanFishMechanicDef();
    if (!cachedOceanFishValidIds) {
      cachedOceanFishValidIds = new Set(cachedOceanFishMechanicDef && cachedOceanFishMechanicDef.config && Array.isArray(cachedOceanFishMechanicDef.config.species)
        ? cachedOceanFishMechanicDef.config.species.map((fish) => fish && fish.id).filter(Boolean) : []);
    }
    const validFishIds = cachedOceanFishValidIds;
    const activeKeys = new Set();
    const currentZone = F.getZone(state, state.currentZoneId);
    const currentFloor = currentZone && currentZone.floors ? currentZone.floors.find((f) => f.id === state.currentFloorId) : null;
    const zoom = Math.max(0.58, Math.min(1.08, Number(state.camera && state.camera.zoom) || 1));
    decorations.forEach((item) => {
      if (!item || item.visual !== "fish" || !validFishIds.has(item.variant)) return;
      const key = [item.floorId, item.r, item.c, item.decorationId].join(":");
      activeKeys.add(key);
      let node = oceanFishDecorationNodes.get(key);
      if (!node) {
        node = document.createElement("div");
        node.className = "mechanic-machine-decoration stranded-fish-decoration";
        node.setAttribute("aria-hidden", "true");
        node.innerHTML = fishDecorationMarkup();
        layer.appendChild(node);
        oceanFishDecorationNodes.set(key, node);
      }
      const nextClass = "mechanic-machine-decoration stranded-fish-decoration fish--" + item.variant + (item.state === "auto-catching" ? " is-auto-catching" : " is-flopping");
      if (node.className !== nextClass) node.className = nextClass;
      const seed = String(Number.isFinite(Number(item.seed)) ? Number(item.seed) : 0.5);
      if (node.dataset.fishSeed !== seed) {
        node.dataset.fishSeed = seed;
        node.style.setProperty("--fish-seed", seed);
      }
      if (!currentFloor || item.floorId !== currentFloor.id) {
        if (node.style.display !== "none") node.style.display = "none";
        return;
      }
      const world = G.Render.slotWorldPos(item.r, item.c);
      const screen = G.Render.worldToScreen(world.x, world.y - 28);
      const left = screen.x + "px";
      const top = screen.y + "px";
      if (node.style.left !== left) node.style.left = left;
      if (node.style.top !== top) node.style.top = top;
      if (node.style.display !== "block") node.style.display = "block";
      const zoomValue = String(zoom);
      if (node.dataset.fishZoom !== zoomValue) {
        node.dataset.fishZoom = zoomValue;
        node.style.setProperty("--fish-zoom", zoomValue);
      }
      const remaining = Number.isFinite(Number(item.remaining)) ? Number(item.remaining) : 0;
      const duration = Math.max(0.1, Number(item.duration) || 1);
      const life = String(Math.max(0, Math.min(1, remaining / duration)));
      if (node.dataset.fishLife !== life) {
        node.dataset.fishLife = life;
        node.style.setProperty("--fish-life", life);
      }
    });
    oceanFishDecorationNodes.forEach((node, key) => {
      if (!activeKeys.has(key)) { node.remove(); oceanFishDecorationNodes.delete(key); }
    });
  }

  function oceanFishMechanicDef() {
    for (const zone of D.ZONES || []) {
      for (const mechanic of zone.mechanics || []) {
        if (mechanic && mechanic.ui && mechanic.ui.catalog === "species") return mechanic;
      }
    }
    return null;
  }

  function oceanFishZoneDef() {
    const mechanic = oceanFishMechanicDef();
    return mechanic ? D.ZONES.find((zone) => (zone.mechanics || []).some((item) => item && item.id === mechanic.id)) || null : null;
  }

  function oceanFishSecretRequirementMet() {
    if (!state || !G.Zone) return false;
    const zoneDef = oceanFishZoneDef();
    const mechanic = oceanFishMechanicDef();
    if (!zoneDef || !mechanic || state.currentZoneId !== zoneDef.id) return false;
    const requirements = mechanic.visibility && Array.isArray(mechanic.visibility.requirements) ? mechanic.visibility.requirements : [];
    return requirements.length > 0 && G.Zone.requirementsMet(state, requirements, zoneDef.id);
  }

  function fishImageMarkup(speciesId) {
    return `<div class="fish-thumb fish--${escapeHtml(speciesId)}" aria-hidden="true">${fishDecorationMarkup()}</div>`;
  }

  function formatFishReward(amount) { return money(Number(amount) || 0); }

  function renderOceanFishEncyclopedia() {
    const mechanic = oceanFishMechanicDef();
    const species = mechanic && mechanic.config && Array.isArray(mechanic.config.species) ? mechanic.config.species : [];
    els.modalContent.innerHTML = `<button class="panel-close" id="modal-close">✕</button><h2>${escapeHtml(G.i18n.t("fish.catalog.title"))}</h2><p class="m-sub">${escapeHtml(G.i18n.t("fish.catalog.subtitle"))}</p><div class="fish-encyclopedia-grid">${species.map((fish) => `<div class="fish-entry"><div class="fish-entry-art">${fishImageMarkup(fish.id)}</div><div class="fish-entry-info"><div class="fish-entry-head"><b>${escapeHtml(G.i18n.t(fish.nameKey))}</b><span class="fish-rarity fish-rarity--${escapeHtml(fish.id)}">${escapeHtml(G.i18n.t(fish.rarityKey))}</span></div><div class="fish-entry-row"><span>${escapeHtml(G.i18n.t("fish.catalog.reward"))}</span><strong>${escapeHtml(formatFishReward(fish.reward))}</strong></div><div class="fish-entry-row"><span>${escapeHtml(G.i18n.t("fish.catalog.duration"))}</span><strong>${escapeHtml(String(fish.durationSeconds))}s</strong></div></div></div>`).join("")}</div><div class="fish-catalog-note">${escapeHtml(G.i18n.t("fish.catalog.manual"))} ${escapeHtml(G.i18n.t("fish.catalog.auto"))}</div>`;
    wireModalClose();
  }

  function refreshMechanicIndicators(uiOverride) {
    if (!els.mechanicIndicators || !state || !G.Zone) return;
    const ui = uiOverride || G.Zone.getMechanicUIState(state, state.currentZoneId, state.currentFloorId);
    const indicators = ui.zoneIndicators || [];
    els.mechanicIndicators.innerHTML = indicators.map((item) => {
      const tone = item.tone || "info";
      const value = formatMechanicIndicator(item);
      const label = escapeHtml(G.i18n.t(item.labelKey));
      const detail = item.detailKey ? escapeHtml(G.i18n.t(item.detailKey)) : "";
      const icon = item.icon ? `<span class="mechanic-indicator-icon">${escapeHtml(item.icon)}</span>` : "";
      const progress = Number.isFinite(Number(item.progress)) ? `<span class="mechanic-indicator-progress" style="--progress:${Math.max(0, Math.min(1, Number(item.progress))) * 100}%"></span>` : "";
      return `<div class="mechanic-indicator ${escapeHtml(tone)}">${icon}<span class="mechanic-indicator-copy"><b>${label}</b>${detail ? `<small>${detail}</small>` : ""}</span>${value ? `<strong>${escapeHtml(value)}</strong>` : ""}${progress}</div>`;
    }).join("");
  }


  function refreshOceanFishButton() {
    const btn = els.oceanFishEncyclopedia;
    if (!btn) return;
    const visible = oceanFishSecretRequirementMet();
    btn.hidden = !visible;
    if (visible) {
      btn.innerHTML = `📖 <span>${escapeHtml(G.i18n.t("fish.catalog.open"))}</span>`;
      if (!btn.dataset.wired) {
        btn.dataset.wired = "1";
        btn.addEventListener("click", () => { G.Audio.unlock(); G.Audio.sfxClick(); openPanel("oceanFishEncyclopedia"); });
      }
    }
  }

  function refreshHUD(mechanicUi) {
    els.moneyVal.textContent = money(state.money);
    const mps = G.Zone.computeMps(state);
    els.mpsVal.textContent = mps > 0 ? "+" + E.formatMoney(mps) + G.i18n.t("hud.perSec") : "";
    els.researchVal.textContent = E.formatMoney(state.research);
    const cap = E.powerCapacity(state), demand = E.powerDemand(state);
    els.powerVal.textContent = Math.round(demand) + "/" + Math.round(cap);
    els.powerWrap.style.color = demand > cap ? "var(--accent-warn)" : "";

    const interval = D.SKILL_POINT_INTERVAL_SECONDS;
    const online = Math.max(0, Number(state.skills.onlineSeconds) || 0);
    const remainder = online % interval;
    const pct = interval > 0 ? Math.min(100, remainder / interval * 100) : 0;
    els.skillVal.textContent = String(Math.max(0, Math.floor(state.skills.points || 0)));
    els.skillProgress.textContent = E.formatTime(Math.max(0, interval - remainder)) + " " + G.i18n.t("hud.skillNext");
    els.skillProgress.style.setProperty("--skill-progress", pct.toFixed(2) + "%");

    const zoneDef = D.zoneById(state.currentZoneId);
    const floorDef = D.floorById(state.currentZoneId, state.currentFloorId);
    if (zoneDef) els.zoneName.textContent = G.i18n.t(zoneDef.nameKey);
    if (floorDef) els.floorName.textContent = G.i18n.t(floorDef.nameKey);
    els.dotTech.classList.toggle("show", (state.skills.points || 0) > 0);
    refreshMechanicIndicators(mechanicUi);
    refreshOceanFishButton();
  }

  function refreshLocationBar() {
    els.zoneButtons.innerHTML = "";
    D.ZONES.forEach((zoneDef) => {
      const zone = F.getZone(state, zoneDef.id);
      const btn = document.createElement("button");
      btn.className = "lb-btn" + (zone.id === state.currentZoneId ? " active" : "") + (!zone.unlocked ? " locked" : "");
      if (zone.unlocked) {
        btn.textContent = G.i18n.t(zoneDef.nameKey);
        btn.addEventListener("click", () => enterZone(zoneDef.id));
      } else {
        const status = G.Zone.zoneUnlockStatus(state, zoneDef.id);
        const costLabel = status.cost > 0 ? G.i18n.t("zone.unlockFor", { amount: money(status.cost) }) : G.i18n.t("zone.noRequirements");
        btn.innerHTML = `🔒 ${escapeHtml(G.i18n.t(zoneDef.nameKey))}<span class="lock-cost">${escapeHtml(costLabel)}</span>`;
        btn.title = G.i18n.t("zone.preview");
        btn.addEventListener("click", () => { selectedZonePreviewId = zoneDef.id; openPanel("zones"); });
      }
      els.zoneButtons.appendChild(btn);
    });

    els.floorButtons.innerHTML = "";
    const curZoneDef = D.zoneById(state.currentZoneId), curZone = F.getZone(state, state.currentZoneId);
    if (!curZoneDef || !curZone) return;
    curZoneDef.floors.forEach((floorDef) => {
      const floor = curZone.floors.find((f) => f.id === floorDef.id);
      if (!floor) return;
      const btn = document.createElement("button");
      btn.className = "lb-btn" + (floor.id === state.currentFloorId ? " active" : "") + (!floor.unlocked ? " locked" : "");
      if (floor.unlocked) {
        btn.textContent = G.i18n.t(floorDef.nameKey);
        btn.addEventListener("click", () => { state.currentFloorId = floor.id; hideMachinePanel(); refreshAll(); onAfterAction(); });
      } else {
        const status = G.Zone.floorUnlockStatus(state, curZone.id, floor.id);
        const cost = Number.isFinite(status.cost) ? status.cost : 0;
        btn.innerHTML = `🔒 ${escapeHtml(G.i18n.t(floorDef.nameKey))}<span class="lock-cost">${escapeHtml(G.i18n.t("floor.unlockFor", { amount: money(cost) }))}</span>`;
        btn.title = status.missing && status.missing.length ? formatRequirementsTooltip(status.missing, curZone.id) : "";
        btn.addEventListener("click", () => {
          const events = [];
          const res = F.unlockFloor(state, curZone.id, floor.id, events);
          if (res.ok) { G.Main && typeof G.Main.processEvents === "function" && G.Main.processEvents(events); toast(G.i18n.t("notify.floorUnlocked", { floor: G.i18n.t(floorDef.nameKey) })); refreshAll(); onAfterAction(); }
          else {
            G.Audio.sfxError();
            if (res.reason === "requirements" && res.missing && res.missing.length) toast(formatRequirement(res.missing[0], curZone.id), "warn");
            else if (res.reason === "money") toast(G.i18n.t("notify.notEnoughMoney"), "warn");
            else toast(G.i18n.t("zone.contentLocked"), "warn");
          }
        });
      }
      els.floorButtons.appendChild(btn);
    });
  }

  function enterZone(zoneId) {
    const zone = F.getZone(state, zoneId);
    const def = D.zoneById(zoneId);
    if (!zone || !def || !zone.unlocked) return;
    state.currentZoneId = zoneId;
    const firstUnlocked = zone.floors.find((f) => f.unlocked);
    state.currentFloorId = firstUnlocked ? firstUnlocked.id : def.floors[0].id;
    selectedSlotRef = null;
    hideMachinePanel();
    selectedZonePreviewId = zoneId;
    if (G.Audio && typeof G.Audio.syncZone === "function") G.Audio.syncZone(state);
    G.Background.sync(state);
    refreshAll();
    onAfterAction();
  }

  // ---- Global machine catalogue -----------------------------------------
  function machineUnlockRequirements(def) {
    const unlock = def && def.unlock ? def.unlock : {};
    const reqs = Array.isArray(unlock.requirements) ? unlock.requirements.slice() : [];
    if (unlock.secretId) reqs.push({ type: "secretDiscovered", secretId: unlock.secretId, value: 1 });
    return reqs;
  }

  function catalogStatus(def) { return G.Zone.machineUnlockStatus(state, def.id, state.currentZoneId); }

  function machineCard(def) {
    const status = catalogStatus(def);
    const selected = state.selectedMachineId === def.id;
    const isZone = def.kind === "zone";
    const homeZone = isZone ? D.zoneById(def.zoneId) : null;
    const cost = E.machineCostById(state, def.id);
    let meta = "";
    let actionState = "";

    if (!status.ok) {
      if (status.reason === "zoneLocked") {
        meta = G.i18n.t("zone.machineZoneLocked", { zone: homeZone ? G.i18n.t(homeZone.nameKey) : def.zoneId });
        actionState = "locked";
      } else if (isZone && status.manual && !status.already && status.missing.length === 0) {
        meta = G.i18n.t("zone.unlockFor", { amount: money(status.cost) });
        actionState = state.money >= status.cost ? "ready" : "locked";
      } else {
        meta = status.missing && status.missing.length ? G.i18n.t("zone.machineLocked") : G.i18n.t("zone.machineLocked");
        actionState = "locked";
      }
    } else {
      meta = money(cost);
      if (isZone) meta += " · " + G.i18n.t("zone.availableFrom", { zone: homeZone ? G.i18n.t(homeZone.nameKey) : def.zoneId });
    }

    const reqs = machineUnlockRequirements(def);
    const title = reqs.length ? formatRequirementsTooltip(reqs, def.zoneId) : meta;
    const cardClass = `machine-catalog-card ${selected ? "selected" : ""} ${status.ok ? "unlocked" : "locked"} ${actionState}`;
    return `<button type="button" class="${cardClass}" data-machine-id="${escapeHtml(def.id)}" title="${escapeHtml(title)}">
      <span class="catalog-swatch" style="background:${escapeHtml(def.color || "#8edcff")}"></span>
      <span class="catalog-main"><b>${escapeHtml(G.i18n.t(def.nameKey))}</b><small>${isZone && homeZone ? escapeHtml(G.i18n.t(homeZone.nameKey)) : escapeHtml(G.i18n.t("zone.coreMachines"))}</small></span>
      <span class="catalog-meta">${status.ok ? "✓ " : "🔒 "}${escapeHtml(meta)}</span>
    </button>`;
  }

  function refreshMachineSelector() {
    const host = els.zoneMachineSelector;
    if (!host) return;
    const core = D.MACHINE_DEFS.filter((m) => m.kind === "tier");
    const groups = [{ label: G.i18n.t("zone.coreMachines"), defs: core }];
    D.ZONES.filter((z) => (z.machines || []).length).forEach((zone) => groups.push({ label: G.i18n.t(zone.nameKey), defs: (zone.machines || []).map((m) => D.machineById(m.id)).filter(Boolean) }));
    const totalMachines = groups.reduce((sum, group) => sum + group.defs.length, 0);
    const selectedDef = state.selectedMachineId ? D.machineById(state.selectedMachineId) : null;
    const selectedName = selectedDef ? G.i18n.t(selectedDef.nameKey) : G.i18n.t("zone.coreMachines");
    const selectedCost = selectedDef ? E.machineCostById(state, selectedDef.id) : null;
    const selectedCostText = selectedCost != null && Number.isFinite(selectedCost) ? money(selectedCost) : "";
    host.innerHTML = `<div class="machine-selector-head">
      <div class="machine-selector-title"><span class="machine-selector-icon">▦</span><span><b>${escapeHtml(G.i18n.t("zone.machines"))}</b><small>${totalMachines} · ${escapeHtml(selectedName)}${selectedCostText ? " · " + escapeHtml(selectedCostText) : ""}</small></span></div>
      <button type="button" class="machine-selector-toggle" aria-expanded="${machineSelectorCollapsed ? "false" : "true"}" aria-controls="machine-selector-body"><span>${machineSelectorCollapsed ? "＋" : "−"}</span><small>${machineSelectorCollapsed ? G.i18n.t("menu.open") : G.i18n.t("menu.close")}</small></button>
    </div><div id="machine-selector-body" class="machine-selector-body">${groups.map((group) => `<section class="machine-catalog-group"><h4>${escapeHtml(group.label)}</h4><div class="machine-catalog-track">${group.defs.map(machineCard).join("")}</div></section>`).join("")}</div>`;
    host.classList.remove("hidden");
    host.classList.toggle("is-collapsed", machineSelectorCollapsed);
    const toggle = host.querySelector(".machine-selector-toggle");
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      machineSelectorCollapsed = !machineSelectorCollapsed;
      host.classList.toggle("is-collapsed", machineSelectorCollapsed);
      toggle.setAttribute("aria-expanded", String(!machineSelectorCollapsed));
      toggle.querySelector("span").textContent = machineSelectorCollapsed ? "＋" : "−";
      toggle.querySelector("small").textContent = machineSelectorCollapsed ? G.i18n.t("menu.open") : G.i18n.t("menu.close");
      try { localStorage.setItem("factory.machineSelectorCollapsed", machineSelectorCollapsed ? "1" : "0"); } catch (_) {}
      G.Audio.unlock(); G.Audio.sfxClick();
    });
    host.querySelectorAll("[data-machine-id]").forEach((btn) => btn.addEventListener("click", () => selectMachineFromCatalog(btn.dataset.machineId)));
  }

  function selectMachineFromCatalog(machineId) {
    const def = D.machineById(machineId);
    if (!def) return;
    const status = catalogStatus(def);
    if (status.reason === "zoneLocked") {
      selectedZonePreviewId = def.zoneId;
      openPanel("zones");
      G.Audio.sfxError();
      toast(G.i18n.t("zone.machineZoneLocked", { zone: G.i18n.t(D.zoneById(def.zoneId).nameKey) }), "warn");
      return;
    }
    if (def.kind === "zone" && status.manual && !status.already) {
      if (status.missing.length) { G.Audio.sfxError(); toast(formatRequirement(status.missing[0], def.zoneId), "warn"); return; }
      const machineEvents = [];
      const res = G.Zone.unlockMachine(state, def.id, machineEvents);
      if (!res.ok) {
        G.Audio.sfxError();
        if (res.reason === "money") toast(G.i18n.t("notify.notEnoughMoney"), "warn");
        else if (res.reason === "secret") toast(G.i18n.t("zone.machineLocked"), "warn");
        else toast(G.i18n.t("zone.machineLocked"), "warn");
        return;
      }
      if (G.Main && typeof G.Main.processEvents === "function") G.Main.processEvents(machineEvents);
    } else if (!status.ok) {
      G.Audio.sfxError();
      toast(status.missing && status.missing.length ? formatRequirement(status.missing[0], def.zoneId) : G.i18n.t("zone.machineLocked"), "warn");
      return;
    }
    state.selectedMachineId = def.id;
    if (def.tierId) state.selectedTierId = def.tierId;
    G.Audio.sfxClick();
    refreshMachineSelector();
    onAfterAction(true);
  }

  function refreshTierSelector() { refreshMachineSelector(); }
  function refreshZoneMachineSelector() { refreshMachineSelector(); }

  function formatRequirement(req, zoneId) {
    if (!req) return G.i18n.t("zone.noRequirements");
    const value = req.value;
    const amount = req.type === "mps" ? E.formatMoney(value) : (req.type === "money" || req.type === "maxMoney" ? money(value) : value);
    const key = req.labelKey || ("zone.requirement." + req.type);
    if (req.type === "zoneStat" || req.type === "mechanicState" || req.type === "zoneVariable") return G.i18n.t(key, { amount, stat: req.stat || req.path || "" });
    if (req.type === "zoneUnlocked") {
      const z = D.zoneById(req.zoneId || zoneId); return G.i18n.t(key, { zone: z ? G.i18n.t(z.nameKey) : (req.zoneId || zoneId) });
    }
    if (req.type === "floorUnlocked") {
      const f = D.floorById(zoneId, req.floorId); return G.i18n.t(key, { floor: f ? G.i18n.t(f.nameKey) : (req.floorId || "") });
    }
    if (req.type === "secretDiscovered") {
      const s = (D.zoneById(zoneId)?.secrets || []).find((x) => x.id === req.secretId); return G.i18n.t(key, { secret: s ? G.i18n.t(s.nameKey || s.hintKey) : req.secretId });
    }
    if (req.type === "machineOwned" || req.type === "machineUnlocked") {
      const m = D.machineById(req.machineId); return G.i18n.t(key, { machine: m ? G.i18n.t(m.nameKey) : req.machineId, amount });
    }
    return G.i18n.t(key, { amount });
  }

  function formatRequirementsTooltip(requirements, zoneId) {
    if (!Array.isArray(requirements) || !requirements.length) return G.i18n.t("zone.noRequirements");
    return requirements.map((req) => (G.Zone.requirementMet(state, req, zoneId) ? "✅ " : "❌ ") + formatRequirement(req, zoneId)).join("\n");
  }

  // ---- Machine panel ------------------------------------------------------
  function hideMachinePanel() {
    els.machinePanel.classList.add("hidden");
    delete els.machinePanel.dataset.machineId;
    selectedSlotRef = null;
    if (G.Render) G.Render.setSelected(null);
  }
  function selectSlot(slot) {
    selectedSlotRef = { r: slot.r, c: slot.c };
    if (G.Render) G.Render.setSelected(selectedSlotRef);
    renderMachinePanel();
  }
  function machineArt(machine, tier) {
    const o = Number(machine && machine.order) || Number(tier.order) || 0;
    const accent = (machine && machine.color) || tier.color || "#9aa5ad";
    const glow = (machine && machine.glow) || tier.glow || "#c7cfd4";
    const shape = machine && machine.visual && machine.visual.shape;
    const extra = shape === "abyssal" ? `<path d="M44 30h32M48 24h24M51 18h18v28H51z" fill="none" stroke="${glow}" stroke-width="2"/><circle cx="60" cy="32" r="10" fill="none" stroke="${glow}" stroke-width="1.5"/>` : shape === "leviathan" ? `<path d="M42 34c6-12 12-12 18 0s12 12 18 0M42 26c6-10 12-10 18 0s12 10 18 0" fill="none" stroke="${glow}" stroke-width="2"/><circle cx="60" cy="30" r="7" fill="none" stroke="${glow}"/>` : o >= 9 ? `<circle cx="60" cy="22" r="9" fill="none" stroke="${glow}" stroke-width="2"/><path d="M60 13v18M51 22h18" stroke="${glow}" stroke-width="1.5"/>` : o >= 7 ? `<circle cx="60" cy="22" r="7" fill="${glow}" opacity=".9"/><circle cx="60" cy="22" r="13" fill="none" stroke="${glow}" stroke-width="1.5" opacity=".8"/>` : o >= 5 ? `<path d="M51 18h18l-3 8H54z" fill="${glow}" opacity=".9"/>` : o >= 4 ? `<path d="M52 25l8-12 8 12" fill="none" stroke="${glow}" stroke-width="2"/>` : o >= 3 ? `<rect x="54" y="15" width="12" height="12" rx="2" fill="${glow}" opacity=".85"/>` : `<circle cx="60" cy="22" r="5" fill="${glow}" opacity=".85"/>`;
    return `<svg viewBox="0 0 120 64" aria-hidden="true"><defs><filter id="machineGlow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect x="14" y="20" width="92" height="30" rx="7" fill="#151922" stroke="${accent}" stroke-width="2"/><rect x="23" y="27" width="24" height="14" rx="3" fill="${accent}" opacity=".24" stroke="${glow}"/><rect x="73" y="27" width="24" height="14" rx="3" fill="${accent}" opacity=".18" stroke="${glow}"/><path d="M33 20v-7h54v7" fill="none" stroke="${accent}" stroke-width="2"/><path d="M28 50v6M92 50v6" stroke="${accent}" stroke-width="3"/><g filter="url(#machineGlow)">${extra}</g></svg>`;
  }

  function renderMachinePanel() {
    if (!selectedSlotRef) { els.machinePanel.classList.add("hidden"); return; }
    const floor = F.currentFloor(state), slot = floor && floor.grid.find((s) => s.r === selectedSlotRef.r && s.c === selectedSlotRef.c);
    if (!slot || !slot.machine) { hideMachinePanel(); return; }
    const m = slot.machine;
    const machine = D.machineById(m.typeId) || D.tierById(m.tierId);
    if (!machine) { hideMachinePanel(); return; }
    const tier = D.tierById(m.tierId) || { id: "zone", order: Number(machine.order) || 7, color: machine.color || "#8edcff", glow: machine.glow || "#ffffff" };
    els.machinePanel.classList.remove("hidden");
    els.machinePanel.dataset.machineId = machine.id;
    const rows = ["speed", "output", "ink"].map((uid) => {
      const u = D.UPGRADES[uid], lvl = m.levels[uid], maxed = lvl >= u.maxLevel, cost = maxed ? 0 : E.upgradeCost(uid, lvl, state), afford = !maxed && state.money >= cost;
      return `<div class="upg-row"><div><div class="upg-name">${escapeHtml(G.i18n.t(u.nameKey))}</div><div class="upg-level">${maxed ? G.i18n.t("action.max") : G.i18n.t("common.levelShort") + " " + lvl + " → " + (lvl + 1)}</div></div><button class="btn" data-upgrade="${uid}" ${maxed || !afford ? "disabled" : ""}>${maxed ? G.i18n.t("action.max") : money(cost)}</button></div>`;
    }).join("");
    const zoneOrigin = machine.kind === "zone" && D.zoneById(machine.zoneId) ? G.i18n.t(D.zoneById(machine.zoneId).nameKey) : G.i18n.t("zone.coreMachines");
    const baseCooldown = E.machineCooldown(m, state);
    const liveCooldown = G.Zone.modifyCooldown(state, state.currentZoneId, state.currentFloorId, m, baseCooldown);
    els.machinePanel.innerHTML = `<button class="panel-close" id="mp-close">✕</button><div class="machine-art" style="--machine-color:${escapeHtml(machine.color || tier.color)}; --machine-glow:${escapeHtml(machine.glow || tier.glow)};">${machineArt(machine, tier)}</div><h3 style="color:${escapeHtml(machine.color || tier.color)}">${escapeHtml(G.i18n.t(machine.nameKey))}</h3><div class="m-desc">${escapeHtml(G.i18n.t(machine.descKey))}</div><div class="machine-origin">${escapeHtml(zoneOrigin)} · <span data-machine-rate>${E.formatMoney(1 / liveCooldown)} ${G.i18n.t("common.cyclesPerSec")}</span></div>${rows}`;
    $("mp-close").addEventListener("click", hideMachinePanel);
    els.machinePanel.querySelectorAll("[data-upgrade]").forEach((btn) => btn.addEventListener("click", () => {
      const uid = btn.getAttribute("data-upgrade"), res = F.upgradeMachine(state, state.currentZoneId, state.currentFloorId, slot.r, slot.c, uid);
      if (res.ok) { G.Audio.sfxUpgrade(); toast(G.i18n.t("notify.upgradeBought", { upgrade: G.i18n.t(D.UPGRADES[uid].nameKey), level: res.newLevel })); renderMachinePanel(); refreshHUD(); refreshMachineSelector(); onAfterAction(); }
      else if (res.reason === "money") { G.Audio.sfxError(); toast(G.i18n.t("notify.notEnoughMoney"), "warn"); }
    }));
  }

  function refreshMachinePanelControls() {
    if (!selectedSlotRef || els.machinePanel.classList.contains("hidden")) return;
    const floor = F.currentFloor(state), slot = floor && floor.grid.find((s) => s.r === selectedSlotRef.r && s.c === selectedSlotRef.c);
    if (!slot || !slot.machine) return;
    els.machinePanel.querySelectorAll("[data-upgrade]").forEach((btn) => {
      const uid = btn.getAttribute("data-upgrade"), u = D.UPGRADES[uid], lvl = slot.machine.levels[uid], maxed = lvl >= u.maxLevel, cost = maxed ? 0 : E.upgradeCost(uid, lvl, state);
      btn.disabled = maxed || state.money < cost;
    });
    const rateEl = els.machinePanel.querySelector("[data-machine-rate]");
    if (rateEl) {
      const baseCooldown = E.machineCooldown(slot.machine, state);
      const liveCooldown = G.Zone.modifyCooldown(state, state.currentZoneId, state.currentFloorId, slot.machine, baseCooldown);
      rateEl.textContent = E.formatMoney(1 / liveCooldown) + " " + G.i18n.t("common.cyclesPerSec");
    }
  }

  // ---- Panels -------------------------------------------------------------
  function openPanel(name) {
    if (name === "zones" && !selectedZonePreviewId) selectedZonePreviewId = state.currentZoneId;
    activePanel = name;
    els.modalOverlay.classList.toggle("modal-overlay--light", name === "hardResetConfirm");
    els.modalOverlay.classList.remove("hidden");
    renderPanel();
  }
  function closePanel() {
    activePanel = null;
    hardResetReturnPanel = null;
    els.modalOverlay.classList.remove("modal-overlay--light");
    els.modalOverlay.classList.add("hidden");
  }
  function wireModalClose() { const btn = $("modal-close"); if (btn) btn.addEventListener("click", closePanel); }

  function openHardResetConfirm() {
    hardResetReturnPanel = activePanel || "settings";
    activePanel = "hardResetConfirm";
    els.modalOverlay.classList.add("modal-overlay--light");
    els.modalOverlay.classList.remove("hidden");
    renderPanel();
  }

  function renderHardResetConfirmPanel() {
    els.modalContent.innerHTML = `<button class="panel-close" id="modal-close">✕</button><div class="hard-reset-confirm"><div class="hard-reset-icon">⚠</div><h2>${escapeHtml(G.i18n.t("settings.hardResetConfirmTitle"))}</h2><p class="m-sub">${escapeHtml(G.i18n.t("settings.hardResetConfirmBody"))}</p><div class="hard-reset-actions"><button type="button" class="btn ghost" id="hard-reset-cancel">${escapeHtml(G.i18n.t("settings.hardResetConfirmCancel"))}</button><button type="button" class="btn warn" id="hard-reset-confirm-action">${escapeHtml(G.i18n.t("settings.hardResetConfirmAction"))}</button></div></div>`;
    const cancel = $("hard-reset-cancel");
    if (cancel) cancel.addEventListener("click", () => {
      const previous = hardResetReturnPanel || "settings";
      hardResetReturnPanel = null;
      activePanel = null;
      els.modalOverlay.classList.remove("modal-overlay--light");
      els.modalOverlay.classList.add("hidden");
      if (previous && previous !== "hardResetConfirm") openPanel(previous);
    });
    const confirmButton = $("hard-reset-confirm-action");
    if (confirmButton) confirmButton.addEventListener("click", () => {
      hardResetReturnPanel = null;
      if (G.Main && typeof G.Main.hardReset === "function") G.Main.hardReset();
      else { closePanel(); }
    });
    wireModalClose();
  }

  function renderPanel() {
    if (!activePanel) return;
    const scrollTop = els.modalContent.scrollTop;
    if (activePanel === "rooms") renderRoomsPanel();
    else if (activePanel === "zones") renderZonesPanel();
    else if (activePanel === "tech") renderTechPanel();
    else if (activePanel === "settings") renderSettingsPanel();
    else if (activePanel === "oceanFishEncyclopedia") renderOceanFishEncyclopedia();
    else if (activePanel === "hardResetConfirm") renderHardResetConfirmPanel();
    els.modalContent.scrollTop = scrollTop;
  }

  function refreshOpenPanel() {
    if (!activePanel) return;
    if (activePanel === "rooms") {
      const floor = F.currentFloor(state); if (!floor) return;
      els.modalContent.querySelectorAll("[data-room]").forEach((btn) => { const id=btn.dataset.room, def=D.ROOMS[id], lvl=state.rooms[id].level, cost=lvl>=def.maxLevel?0:E.roomCost(id,lvl); btn.disabled=lvl>=def.maxLevel||state.money<cost; });
      els.modalContent.querySelectorAll("[data-floorsys]").forEach((btn) => { const id=btn.dataset.floorsys, def=D.FLOOR_SYSTEMS[id], lvl=floor.systems[id], cost=lvl>=def.maxLevel?0:E.floorSystemCost(id,lvl,state); btn.disabled=lvl>=def.maxLevel||state.money<cost; });
      els.modalContent.querySelectorAll("[data-zone-content]").forEach((btn) => {
        const status = G.Zone.zoneContentStatus(state, state.currentZoneId, btn.dataset.zoneContent, btn.dataset.zoneContentKind);
        btn.disabled = !status.ok;
      });
    } else if (activePanel === "tech") {
      const line=$("tech-resource-line"); if(line) line.textContent=G.i18n.t("tech.points",{points:state.skills.points,research:E.formatMoney(state.research)});
    } else if (activePanel === "zones") {
      const previewId = (selectedZonePreviewId && D.zoneById(selectedZonePreviewId)) ? selectedZonePreviewId : state.currentZoneId;
      const zone = F.getZone(state, previewId);
      const unlockBtn = $("btn-atlas-unlock");
      const enterBtn = $("btn-atlas-enter");
      const actuallyUnlocked = !!zone?.unlocked;
      const lockedView = !!unlockBtn && !enterBtn;
      if ((actuallyUnlocked && lockedView) || (!actuallyUnlocked && !lockedView)) {
        renderZonesPanel();
      } else if (!actuallyUnlocked && unlockBtn) {
        const status = G.Zone.zoneUnlockStatus(state, previewId);
        unlockBtn.disabled = !status.ok;
        unlockBtn.textContent = G.i18n.t("zone.unlockFor", { amount: money(status.cost) });
      }
    }
    // Settings is intentionally not rebuilt every frame: this avoids destroying
    // the language selectors and import/export interactions.
  }

  function renderZonesPanel() {
    const previewId = (selectedZonePreviewId && D.zoneById(selectedZonePreviewId)) ? selectedZonePreviewId : state.currentZoneId;
    selectedZonePreviewId = previewId;
    const def = D.zoneById(previewId), zone = F.getZone(state, previewId), status = G.Zone.zoneUnlockStatus(state, previewId);
    const isUnlocked = !!zone?.unlocked;
    const requirementRows = (def.unlock?.requirements || []).map((r) => `<div class="atlas-req ${G.Zone.requirementMet(state,r,previewId)?"ok":"missing"}">${G.Zone.requirementMet(state,r,previewId)?"✓":"✕"} ${escapeHtml(formatRequirement(r,previewId))}</div>`).join("");
    const machines = (def.machines || []).map((m) => {
      const ms=G.Zone.machineUnlockStatus(state,m.id,def.id);
      return `<div class="atlas-machine"><span class="catalog-swatch" style="background:${escapeHtml(m.color||"#8edcff")}"></span><span><b>${escapeHtml(G.i18n.t(m.nameKey))}</b><small>${ms.ok?G.i18n.t("zone.machineUnlocked"):G.i18n.t("zone.machineLocked")}</small></span></div>`;
    }).join("");
    const mechanics = G.Zone.getZoneMechanics(state, def.id);
    const hiddenMechanicCount = mechanics.filter((m) => m.hidden && !m.discovered).length;
    const mechanicCards = mechanics.map((m) => {
      if (m.hidden && !m.discovered) {
        const hint = m.hintKey ? G.i18n.t(m.hintKey) : G.i18n.t("zone.mechanicUndiscovered");
        return `<div class="atlas-mechanic is-hidden"><div class="atlas-mechanic-title"><span class="atlas-secret-mask">${escapeHtml(G.i18n.t("zone.mechanicUnknown"))}</span><small>${escapeHtml(G.i18n.t("zone.mechanicUndiscovered"))}</small></div><div class="atlas-mechanic-hint">${escapeHtml(G.i18n.t("zone.mechanicHint", { hint }))}</div></div>`;
      }
      return `<div class="atlas-mechanic"><div class="atlas-mechanic-title"><b>${escapeHtml(G.i18n.t(m.nameKey))}</b></div><div class="atlas-mechanic-desc">${escapeHtml(G.i18n.t(m.descriptionKey))}</div></div>`;
    }).join("");
    const secretsData = G.Zone.getZoneSecrets(state, def.id);
    const discoveredSecretCount = secretsData.filter((s) => s.discovered).length;
    const secrets = secretsData.map((s) => {
      if (s.discovered) return `<div class="atlas-secret discovered">🔓 <span><b>${escapeHtml(G.i18n.t(s.nameKey))}</b>${s.descriptionKey ? `<small>${escapeHtml(G.i18n.t(s.descriptionKey))}</small>` : ""}</span></div>`;
      return `<div class="atlas-secret is-hidden">❔ <span><b class="atlas-secret-mask">${escapeHtml(G.i18n.t("zone.secretUnknown"))}</b><small>${escapeHtml(s.hintKey ? G.i18n.t(s.hintKey) : G.i18n.t("zone.secretUnknown"))}</small></span></div>`;
    }).join("");
    const floors = (def.floors || []).map((f) => `<span class="atlas-chip">${escapeHtml(G.i18n.t(f.nameKey))}</span>`).join("");
    const previewName = G.i18n.t(def.nameKey);

    els.modalContent.innerHTML = `<button class="panel-close" id="modal-close">✕</button><h2>${escapeHtml(G.i18n.t("zone.atlas"))}</h2><div class="zone-atlas-layout"><aside class="zone-atlas-list">${D.ZONES.map((z) => { const zs=F.getZone(state,z.id); return `<button type="button" class="zone-atlas-item ${z.id===previewId?"active":""}" data-preview-zone="${escapeHtml(z.id)}"><span>${zs?.unlocked?"":"🔒 "}${escapeHtml(G.i18n.t(z.nameKey))}</span><small>#${z.order+1}</small></button>`; }).join("")}</aside><section class="zone-atlas-detail"><div class="zone-preview-surface" id="zone-preview-surface"><div class="zone-preview-overlay"><strong>${escapeHtml(previewName)}</strong><span>${escapeHtml(isUnlocked?G.i18n.t("zone.unlocked"):G.i18n.t("zone.locked"))}</span></div></div><p class="m-sub">${escapeHtml(G.i18n.t(def.descriptionKey))}</p><div class="atlas-meta">${floors}</div>${!isUnlocked?`<h4>${escapeHtml(G.i18n.t("zone.unlockRequirements"))}</h4><div>${requirementRows||`<div class="atlas-req ok">✓ ${escapeHtml(G.i18n.t("zone.noRequirements"))}</div>`}</div><div class="zone-cost">${escapeHtml(G.i18n.t("zone.unlockCost"))}: ${escapeHtml(money(status.cost))}</div><button class="btn brass" id="btn-atlas-unlock" ${status.ok?"":"disabled"}>${escapeHtml(G.i18n.t("zone.unlockFor",{amount:money(status.cost)}))}</button>`:`<div class="atlas-actions"><button class="btn brass" id="btn-atlas-enter">${escapeHtml(G.i18n.t("zone.enter"))}</button></div>`}<div class="atlas-section"><h4>${escapeHtml(G.i18n.t("zone.mechanics"))} <span class="atlas-count">${mechanics.length}</span></h4>${hiddenMechanicCount ? `<div class="atlas-meta-line">${escapeHtml(G.i18n.t("zone.hiddenMechanicCount", { count: hiddenMechanicCount }))}</div>` : ""}${mechanicCards||`<div class="m-sub">${escapeHtml(G.i18n.t("zone.noMechanics"))}</div>`}</div><div class="atlas-section"><h4>${escapeHtml(G.i18n.t("zone.machines"))}</h4>${machines||`<div class="m-sub">${escapeHtml(G.i18n.t("zone.none"))}</div>`}</div><div class="atlas-section"><h4>${escapeHtml(G.i18n.t("zone.secrets"))} <span class="atlas-count">${discoveredSecretCount}/${secretsData.length}</span></h4>${secrets||`<div class="m-sub">${escapeHtml(G.i18n.t("zone.noSecrets"))}</div>`}</div></section></div>`;
    wireModalClose();
    const surface=$("zone-preview-surface");
    if(surface) G.Background.previewStyle(previewId,surface);
    els.modalContent.querySelectorAll("[data-preview-zone]").forEach((btn)=>btn.addEventListener("click",()=>{selectedZonePreviewId=btn.dataset.previewZone;renderZonesPanel();}));
    const unlockBtn=$("btn-atlas-unlock");
    if(unlockBtn) unlockBtn.addEventListener("click",()=>{const events=[]; const res=F.unlockZone(state,previewId,events);if(res.ok){G.Main && typeof G.Main.processEvents === "function" && G.Main.processEvents(events); toast(G.i18n.t("notify.zoneUnlocked",{zone:previewName}));renderZonesPanel();refreshAll();onAfterAction();}else{G.Audio.sfxError();if(res.reason==="money")toast(G.i18n.t("notify.notEnoughMoney"),"warn");else if(res.reason==="requirements")toast(formatRequirement(res.missing[0],previewId),"warn");}});
    const enterBtn=$("btn-atlas-enter"); if(enterBtn) enterBtn.addEventListener("click",()=>{enterZone(previewId);closePanel();});
  }

  function zoneContentCard(def, status) {
    if (!status.visible) {
      return `<div class="room-card zone-content-card is-hidden"><div class="r-icon">❔</div><div class="r-body"><div class="r-title">${escapeHtml(G.i18n.t("zone.contentHidden"))}</div><div class="r-desc">${escapeHtml(G.i18n.t("zone.contentLocked"))}</div></div><button class="btn" disabled>${escapeHtml(G.i18n.t("action.locked"))}</button></div>`;
    }
    const isPurchase = status.kind === "purchase";
    const maxed = status.level >= status.maxLevel;
    const levelText = isPurchase
      ? (maxed ? G.i18n.t("zone.contentOwned") : G.i18n.t("zone.contentLocked"))
      : G.i18n.t("zone.contentLevel", { level: status.level, max: status.maxLevel });
    const description = def.descriptionKey ? G.i18n.t(def.descriptionKey) : "";
    const missingText = status.missing && status.missing.length ? G.i18n.t("zone.contentLocked") + ": " + formatRequirement(status.missing[0], status.zoneId) : "";
    const meta = [levelText, missingText].filter(Boolean).join(" · ");
    const buttonLabel = maxed ? G.i18n.t(isPurchase ? "zone.contentOwned" : "action.max") : money(status.cost);
    const title = status.missing && status.missing.length ? formatRequirementsTooltip(status.missing, status.zoneId) : (description || G.i18n.t("zone.localSystems"));
    return `<div class="room-card zone-content-card ${maxed ? "is-maxed" : ""}" title="${escapeHtml(title)}"><div class="r-icon">${escapeHtml(def.icon || (isPurchase ? "🧰" : "⚙️"))}</div><div class="r-body"><div class="r-title">${escapeHtml(G.i18n.t(def.nameKey))} <span>${escapeHtml(meta)}</span></div>${description ? `<div class="r-desc">${escapeHtml(description)}</div>` : ""}</div><button class="btn" data-zone-content="${escapeHtml(def.id)}" data-zone-content-kind="${escapeHtml(status.kind)}" ${maxed || !status.ok ? "disabled" : ""}>${escapeHtml(buttonLabel)}</button></div>`;
  }

  function zoneLocalSystemsBlock() {
    const zoneDef = D.zoneById(state.currentZoneId);
    const zone = F.getZone(state, state.currentZoneId);
    if (!zoneDef || !zone) return "";
    const defs = [
      ...(zoneDef.upgrades || []).map((def) => ({ def, kind: "upgrade" })),
      ...(zoneDef.purchases || []).map((def) => ({ def, kind: "purchase" })),
    ];
    if (!defs.length) return "";
    const cards = defs.map(({ def, kind }) => zoneContentCard(def, G.Zone.zoneContentStatus(state, state.currentZoneId, def.id, kind))).join("");
    return `<div class="m-sub">${escapeHtml(G.i18n.t("zone.localSystems"))} · ${escapeHtml(G.i18n.t(zoneDef.nameKey))}</div>${cards}`;
  }

  function wireZoneContentButtons() {
    els.modalContent.querySelectorAll("[data-zone-content]").forEach((btn) => btn.addEventListener("click", () => {
      const id = btn.dataset.zoneContent;
      const kind = btn.dataset.zoneContentKind;
      const def = G.Zone.getZoneContentDef(state.currentZoneId, id, kind);
      const res = G.Zone.buyZoneContent(state, state.currentZoneId, id, kind);
      if (res.ok) {
        G.Audio.sfxUpgrade();
        const level = res.newLevel;
        const label = def ? G.i18n.t(def.nameKey) : id;
        toast(G.i18n.t(res.kind === "purchase" ? "notify.zonePurchaseBought" : "notify.zoneUpgradeBought", { item: label, level }));
        renderRoomsPanel();
        refreshHUD();
        onAfterAction();
      } else {
        G.Audio.sfxError();
        if (res.reason === "money") toast(G.i18n.t("notify.notEnoughMoney"), "warn");
        else if (res.reason === "requirements") toast(res.missing && res.missing.length ? formatRequirement(res.missing[0], state.currentZoneId) : G.i18n.t("zone.contentLocked"), "warn");
        else if (res.reason === "hidden") toast(G.i18n.t("zone.contentLocked"), "warn");
        else toast(G.i18n.t("zone.contentLocked"), "warn");
      }
    }));
  }

  const ROOM_ICONS = { rnd:"🔬", vault:"🏦", power:"⚡" };
  function renderRoomsPanel() {
    const cards=["rnd","vault","power"].map((rid)=>{const def=D.ROOMS[rid],lvl=state.rooms[rid].level,maxed=lvl>=def.maxLevel,cost=maxed?0:E.roomCost(rid,lvl),afford=!maxed&&state.money>=cost;let stat="";if(rid==="rnd")stat=`${E.formatMoney(E.rndRatePerSec(state))} 🔬${G.i18n.t("common.perSecShort")}`;if(rid==="vault")stat=`${G.i18n.t("room.level",{level:lvl})} · +${(E.vaultInterestPerHour(state)*100).toFixed(2)}%${G.i18n.t("common.perHour")}`;if(rid==="power")stat=`${Math.round(E.powerDemand(state))}/${Math.round(E.powerCapacity(state))} ${G.i18n.t("common.used")}`;return `<div class="room-card"><div class="r-icon">${ROOM_ICONS[rid]}</div><div class="r-body"><div class="r-title">${escapeHtml(G.i18n.t("room."+rid+".name"))} <span>${escapeHtml(G.i18n.t("room.level",{level:lvl}))}</span></div><div class="r-desc">${escapeHtml(G.i18n.t("room."+rid+".desc"))}</div><div class="r-desc">${escapeHtml(stat)}</div><div class="bar-track"><div class="bar-fill" style="width:${lvl/def.maxLevel*100}%"></div></div></div><button class="btn brass" data-room="${rid}" ${maxed||!afford?"disabled":""}>${maxed?G.i18n.t("action.max"):money(cost)}</button></div>`;}).join("");
    els.modalContent.innerHTML=`<button class="panel-close" id="modal-close">✕</button><h2>${escapeHtml(G.i18n.t("menu.rooms"))}</h2>${zoneLocalSystemsBlock()}<div class="m-sub" style="margin-top:14px;">${escapeHtml(G.i18n.t("zone.globalSystems"))}</div>${floorSystemsBlock()}<div class="m-sub" style="margin-top:14px;">${escapeHtml(G.i18n.t("menu.rooms"))}</div>${cards}`;
    wireModalClose();
    els.modalContent.querySelectorAll("[data-room]").forEach((btn)=>btn.addEventListener("click",()=>{const res=F.upgradeRoom(state,btn.dataset.room);if(res.ok){G.Audio.sfxUpgrade();renderRoomsPanel();refreshHUD();onAfterAction();}else{G.Audio.sfxError();toast(G.i18n.t("notify.notEnoughMoney"),"warn");}}));
    wireFloorSystemButtons();
    wireZoneContentButtons();
  }
  function floorSystemsBlock(){const floor=F.currentFloor(state);if(!floor)return"";const rows=["conveyor","collector"].map((sid)=>{const def=D.FLOOR_SYSTEMS[sid],lvl=floor.systems[sid],maxed=lvl>=def.maxLevel,cost=maxed?0:E.floorSystemCost(sid,lvl,state),afford=!maxed&&state.money>=cost,icon=sid==="conveyor"?"🛞":"🧲";return `<div class="room-card"><div class="r-icon">${icon}</div><div class="r-body"><div class="r-title">${escapeHtml(G.i18n.t("floorsys."+sid))} <span>${escapeHtml(G.i18n.t("room.level",{level:lvl}))}</span></div><div class="r-desc">${escapeHtml(G.i18n.t("floorsys."+sid+".desc"))}</div></div><button class="btn" data-floorsys="${sid}" ${maxed||!afford?"disabled":""}>${maxed?G.i18n.t("action.max"):money(cost)}</button></div>`;}).join("");return `${rows}`;}
  function wireFloorSystemButtons(){els.modalContent.querySelectorAll("[data-floorsys]").forEach((btn)=>btn.addEventListener("click",()=>{const events=[]; const res=F.buyFloorSystem(state,state.currentZoneId,state.currentFloorId,btn.dataset.floorsys,events);if(res.ok){G.Audio.sfxUpgrade();renderRoomsPanel();refreshHUD();onAfterAction();}else{G.Audio.sfxError();toast(res.reason==="power"?G.i18n.t("notify.notEnoughPower"):G.i18n.t("notify.notEnoughMoney"),"warn");}}));}

  function renderTechPanel() {
    const branches=["production","automation","economy"], cols=branches.map((branch)=>{const nodes=D.TECH_TREE.filter((t)=>t.branch===branch).map((t)=>{const owned=!!state.skills.tech[t.id],req=E.techRequirementsMet(state,t),locked=!owned&&!req,costLabel=owned?G.i18n.t("action.selected"):t.cost+" ⭐ · "+E.formatMoney(t.researchCost)+" 🔬";return `<div class="tech-node ${owned?"owned":locked?"locked":""}" data-tech="${t.id}"><div class="t-name">${owned?"✅ ":locked?"🔒 ":""}${escapeHtml(G.i18n.t(t.nameKey))}</div><div class="t-cost">${escapeHtml(costLabel)}</div></div>`;}).join("");return `<div class="tech-branch"><h4>${escapeHtml(G.i18n.t("tech.branch."+branch))}</h4>${nodes}</div>`;}).join("");
    const rem=Math.max(0,D.SKILL_POINT_INTERVAL_SECONDS-(Math.max(0,state.skills.onlineSeconds||0)%D.SKILL_POINT_INTERVAL_SECONDS));
    els.modalContent.innerHTML=`<button class="panel-close" id="modal-close">✕</button><h2>${escapeHtml(G.i18n.t("tech.title"))}</h2><div class="skill-progress-panel"><b id="tech-resource-line">${escapeHtml(G.i18n.t("tech.points",{points:state.skills.points,research:E.formatMoney(state.research)}))}</b><span>${escapeHtml(G.i18n.t("tech.onlineProgress",{time:E.formatTime(rem)}))}</span></div><div class="tech-grid">${cols}</div>`;
    wireModalClose();
    els.modalContent.querySelectorAll("[data-tech]").forEach((el)=>el.addEventListener("click",()=>{const id=el.dataset.tech,tech=D.techById(id),res=F.buyTech(state,id);if(res.ok){G.Audio.sfxTechUnlock();toast(G.i18n.t("notify.techUnlocked",{tech:G.i18n.t(tech.nameKey)}));renderTechPanel();refreshHUD();refreshMachineSelector();onAfterAction();}else{G.Audio.sfxError();toast(res.reason==="points"?G.i18n.t("notify.notEnoughPoints"):res.reason==="research"?G.i18n.t("notify.notEnoughResearch"):G.i18n.t("tooltip.locked"),"warn");}}));
  }

  function renderSettingsPanel() {
    els.modalContent.innerHTML=`<button class="panel-close" id="modal-close">✕</button><h2>${escapeHtml(G.i18n.t("settings.title"))}</h2><div class="setting-row setting-language"><span>${escapeHtml(G.i18n.t("settings.language"))}</span><div class="lang-toggle"><button data-lang="en" class="${state.settings.lang==="en"?"active":""}">English</button><button data-lang="vi" class="${state.settings.lang==="vi"?"active":""}">Tiếng Việt</button><button data-lang="id" class="${state.settings.lang==="id"?"active":""}">Bahasa Indonesia</button><button data-lang="es" class="${state.settings.lang==="es"?"active":""}">Español</button></div></div><div class="setting-row"><span>${escapeHtml(G.i18n.t("settings.music"))}</span><label class="switch"><input type="checkbox" id="chk-music" ${state.settings.music?"checked":""}><span class="track"></span><span class="knob"></span></label></div><div class="setting-row"><span>${escapeHtml(G.i18n.t("settings.sfx"))}</span><label class="switch"><input type="checkbox" id="chk-sfx" ${state.settings.sfx?"checked":""}><span class="track"></span><span class="knob"></span></label></div><div class="setting-row setting-slider-row"><label for="range-music">${escapeHtml(G.i18n.t("settings.musicVolume"))}</label><div class="volume-control"><input type="range" id="range-music" min="0" max="1" step="0.01" value="${state.settings.musicVolume}"><output id="range-music-value">${Math.round(state.settings.musicVolume*100)}%</output></div></div><div class="setting-row setting-slider-row"><label for="range-sfx">${escapeHtml(G.i18n.t("settings.sfxVolume"))}</label><div class="volume-control"><input type="range" id="range-sfx" min="0" max="1" step="0.01" value="${state.settings.sfxVolume}"><output id="range-sfx-value">${Math.round(state.settings.sfxVolume*100)}%</output></div></div><div class="setting-row"><span style="font-size:12px;color:var(--text-muted);">${escapeHtml(G.i18n.t("controls.title"))}: ${escapeHtml(G.Input.isTouchDevice()?G.i18n.t("controls.mobile"):G.i18n.t("controls.pc"))}</span></div><div class="setting-row" style="display:block;"><div class="setting-inline"><span>${escapeHtml(G.i18n.t("settings.export"))}</span><button class="btn" id="btn-export-save">${escapeHtml(G.i18n.t("settings.export"))}</button></div><textarea id="save-export-code" readonly></textarea></div><div class="setting-row" style="display:block;"><div class="setting-inline"><span>${escapeHtml(G.i18n.t("settings.import"))}</span><button class="btn" id="btn-import-save">${escapeHtml(G.i18n.t("settings.import"))}</button></div><textarea id="save-import-code" placeholder="${escapeHtml(G.i18n.t("settings.importPlaceholder"))}"></textarea></div><div class="setting-row"><button class="btn warn" id="btn-hard-reset">${escapeHtml(G.i18n.t("settings.hardReset"))}</button></div>`;
    wireModalClose();
    els.modalContent.querySelectorAll("[data-lang]").forEach((btn)=>btn.addEventListener("click",()=>{state.settings.lang=btn.dataset.lang;G.i18n.setLang(btn.dataset.lang);refreshAll();onAfterAction();}));
    $("chk-music").addEventListener("change",(e)=>{state.settings.music=e.target.checked;G.Audio.setMusicEnabled(e.target.checked);onAfterAction();});
    $("chk-sfx").addEventListener("change",(e)=>{state.settings.sfx=e.target.checked;G.Audio.setSfxEnabled(e.target.checked);onAfterAction();});
    $("range-music").addEventListener("input",(e)=>{state.settings.musicVolume=Number(e.target.value);$("range-music-value").textContent=Math.round(state.settings.musicVolume*100)+"%";G.Audio.setMusicVolume(state.settings.musicVolume);});
    $("range-music").addEventListener("change",()=>onAfterAction());
    $("range-sfx").addEventListener("input",(e)=>{state.settings.sfxVolume=Number(e.target.value);$("range-sfx-value").textContent=Math.round(state.settings.sfxVolume*100)+"%";G.Audio.setSfxVolume(state.settings.sfxVolume);});
    $("range-sfx").addEventListener("change",()=>onAfterAction());
    $("btn-export-save").addEventListener("click",async()=>{const code=G.Save.exportSave(state),area=$("save-export-code");area.value=code||"";if(!code)return;area.focus();area.select();try{if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(code);}finally{toast(G.i18n.t("notify.saveExported"));}});
    $("btn-import-save").addEventListener("click",()=>{const code=$("save-import-code").value.trim();if(!code)return;const imported=G.Save.importSave(code);if(!imported){G.Audio.sfxError();toast(G.i18n.t("notify.importFailed"),"warn");return;}onStateImported(imported);});
    $("btn-hard-reset").addEventListener("click",()=>{ G.Audio.unlock(); G.Audio.sfxClick(); openHardResetConfirm(); });
  }

  function renderDrawer(){if(!els.drawer||els.drawer.classList.contains("hidden"))return;els.drawer.innerHTML=`<div style="font-family:var(--font-display);font-size:14px;margin-bottom:6px;">${escapeHtml(G.i18n.t("controls.title"))}</div><div style="font-size:11px;color:var(--text-muted);line-height:1.5;">${escapeHtml(G.i18n.t("controls.mobile"))}</div>`;}


  function refreshAll(){refreshHUD();refreshLocationBar();refreshMachineSelector();renderMachinePanel();if(activePanel)renderPanel();G.i18n.applyToDom();}

  G.UI={
    init,setState,refreshAll,refreshHUD,refreshLocationBar,refreshTierSelector,refreshZoneMachineSelector,
    selectSlot,hideMachinePanel,renderMachinePanel,refreshMachinePanelControls,openPanel,closePanel,toast,showMechanicEvent,refreshMechanicIndicators,refreshMechanicDecorations,refreshOceanFishButton,renderDrawer,refreshOpenPanel,
    isInputBlocked(){return !!activePanel;},
    get selectedSlot(){return selectedSlotRef;},get isPanelOpen(){return !!activePanel;}
  };
})(window.Game = window.Game || {});
