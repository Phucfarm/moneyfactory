/* ============================================================
   05-factory.js — Factory simulation: machines, conveyors,
   auto-collectors, zones/floors, and rooms tick. This is the
   beating heart of the active production loop.
   ============================================================ */
(function (G) {
  "use strict";
  const D = G.DATA;
  const E = G.Econ;

  // Runtime-only (non-persisted-critical) per-floor timers, keyed by Zone + floor.
  // Floor ids are only required to be unique inside a Zone, so floor id alone
  // is not a safe runtime key once multiple Zones exist.
  const floorRuntime = {}; // { [zoneId + "::" + floorId]: { collectorTimer, bonusTimer } }
  // Reused because tick() is strictly synchronous: Core dispatch and Main event
  // processing finish before the next tick starts. This removes one array allocation
  // per animation frame without changing the event contract.
  const tickEvents = [];
  function rt(zoneId, floorId) {
    const key = String(zoneId) + "::" + String(floorId);
    if (!floorRuntime[key]) floorRuntime[key] = { collectorTimer: 0, bonusTimer: 3 + Math.random() * 6 };
    return floorRuntime[key];
  }

  function getZone(state, zoneId) { return state.zones.find((z) => z.id === zoneId); }
  function getFloor(state, zoneId, floorId) {
    const z = getZone(state, zoneId);
    return z ? z.floors.find((f) => f.id === floorId) : null;
  }
  function currentZone(state) { return getZone(state, state.currentZoneId); }
  function currentFloor(state) { return getFloor(state, state.currentZoneId, state.currentFloorId); }

  // ---- Placement / upgrades ---------------------------------------------
  function canPlaceMachine(state, slot) {
    return !slot.machine;
  }

  function normalizeMachineId(machineIdOrTierId) {
    if (D.machineById(machineIdOrTierId)) return machineIdOrTierId;
    if (D.tierById(machineIdOrTierId) && Array.isArray(D.MACHINE_TYPES)) {
      const type = D.MACHINE_TYPES.find((item) => item && item.tierId === machineIdOrTierId);
      return type ? type.id : null;
    }
    return null;
  }

  function placeMachine(state, zoneId, floorId, r, c, machineIdOrTierId, events) {
    const floor = getFloor(state, zoneId, floorId);
    if (!floor || !floor.unlocked) return { ok: false, reason: "floorLocked" };
    const machineId = normalizeMachineId(machineIdOrTierId);
    const def = machineId ? D.machineById(machineId) : null;
    if (!def) return { ok: false, reason: "machineInvalid" };
    if (def.kind === "zone" && !G.Zone.canPlaceMachineInZone(state, machineId, zoneId)) {
      return { ok: false, reason: "wrongZone", machineId, requiredZoneId: def.zoneId };
    }
    if (!G.Zone.isMachineUnlocked(state, machineId)) return { ok: false, reason: "machineLocked", machineId };
    const slot = floor.grid.find((s) => s.r === r && s.c === c);
    if (!slot || slot.machine) return { ok: false, reason: "occupied" };
    const cost = E.machineCostById(state, machineId);
    if (state.money < cost) return { ok: false, reason: "money", cost, machineId };
    state.money -= cost;
    slot.machine = {
      typeId: machineId,
      tierId: def.tierId || "common",
      levels: { speed: 0, output: 0, ink: 0 },
      progress: 0,
      banked: 0,
    };
    state.stats.totalMachinesPlaced++;
    const zoneStats = G.Zone.getZoneState(state, zoneId).stats;
    zoneStats.machinesPlaced = (zoneStats.machinesPlaced || 0) + 1;
    G.Zone.onMachinePlaced(state, zoneId, floor, slot.machine, slot, events || null);
    if (Array.isArray(events)) events.push({ type: "machinePlaced", zoneId, floorId, r, c, machineId, cost });
    return { ok: true, cost, machineId, tierId: def.tierId || null };
  }

  function upgradeMachine(state, zoneId, floorId, r, c, upgradeId) {
    const floor = getFloor(state, zoneId, floorId);
    if (!floor || !floor.unlocked) return { ok: false, reason: "floorLocked" };
    const slot = floor.grid.find((s) => s.r === r && s.c === c);
    if (!slot || !slot.machine) return { ok: false };
    const u = D.UPGRADES[upgradeId];
    if (!u) return { ok: false, reason: "invalid" };
    const cur = slot.machine.levels[upgradeId];
    if (cur >= u.maxLevel) return { ok: false, reason: "max" };
    const cost = E.upgradeCost(upgradeId, cur, state);
    if (state.money < cost) return { ok: false, reason: "money", cost };
    state.money -= cost;
    slot.machine.levels[upgradeId] = cur + 1;
    state.stats.totalUpgradesBought++;
    return { ok: true, cost, newLevel: cur + 1 };
  }

  // ---- Floor systems (conveyor / collector) ---------------------
  function buyFloorSystem(state, zoneId, floorId, systemId) {
    const floor = getFloor(state, zoneId, floorId);
    if (!floor || !floor.unlocked) return { ok: false, reason: "floorLocked" };
    const def = D.FLOOR_SYSTEMS[systemId];
    if (!def) return { ok: false, reason: "invalid" };
    const cur = floor.systems[systemId];
    if (cur >= def.maxLevel) return { ok: false, reason: "max" };
    const cost = E.floorSystemCost(systemId, cur, state);
    if (state.money < cost) return { ok: false, reason: "money", cost };
    // Power check for turning ON the collector (level 0 -> 1)
    if (systemId === "collector" && cur === 0) {
      const eff = E.techEffects(state);
      const discount = 1 - Math.min(0.4, eff.powerDiscount);
      const addedDemand = D.POWER_COST_COLLECTOR * discount;
      const demandAfter = E.powerDemand(state) + addedDemand;
      if (demandAfter > E.powerCapacity(state) + 1e-9) {
        return { ok: false, reason: "power" };
      }
    }
    state.money -= cost;
    floor.systems[systemId] = cur + 1;
    state.stats.totalUpgradesBought = Math.max(0, Number(state.stats.totalUpgradesBought) || 0) + 1;
    return { ok: true, cost, newLevel: cur + 1 };
  }

  // ---- Zones / floors unlocking -------------------------------------------
  function unlockZone(state, zoneId, events) {
    return G.Zone.unlockZone(state, zoneId, events);
  }

  function unlockFloor(state, zoneId, floorId, events) {
    const floor = getFloor(state, zoneId, floorId);
    const def = D.floorById(zoneId, floorId);
    if (!floor || floor.unlocked) return { ok: false };
    return G.Zone.unlockFloor(state, zoneId, floorId, events);
  }

  // ---- Rooms -----------------------------------------------------------------
  function upgradeRoom(state, roomId) {
    const def = D.ROOMS[roomId];
    if (!def) return { ok: false, reason: "invalid" };
    const cur = state.rooms[roomId].level;
    if (cur >= def.maxLevel) return { ok: false, reason: "max" };
    const cost = E.roomCost(roomId, cur);
    if (state.money < cost) return { ok: false, reason: "money", cost };
    state.money -= cost;
    state.rooms[roomId].level = cur + 1;
    return { ok: true, cost, newLevel: cur + 1 };
  }

  // ---- Collection ---------------------------------------------------------
  function grantMoney(state, amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    state.money += amount;
    state.maxMoney = Math.max(state.maxMoney, state.money);
    state.totalEarned += amount;
    state.lifetimeEarned += amount;
  }

  // Collection action contract: always returns { ok, amount, reason? }.
  // `amount` remains present for backwards compatibility with the UI.
  function collectMachine(state, zoneId, floorId, r, c, events) {
    const floor = getFloor(state, zoneId, floorId);
    if (!floor || !floor.unlocked) return { ok: false, amount: 0, reason: "floorLocked" };
    const slot = floor.grid.find((s) => s.r === r && s.c === c);
    if (!slot || !slot.machine || slot.machine.banked <= 0) return { ok: false, amount: 0, reason: "empty" };
    const amount = slot.machine.banked;
    slot.machine.banked = 0;
    grantMoney(state, amount);
    state.stats.totalClicks++;
    const zoneStats = G.Zone.getZoneState(state, zoneId).stats;
    zoneStats.cashCollected = (zoneStats.cashCollected || 0) + amount;
    if (G.Zone) G.Zone.onMachineCollected(state, zoneId, floor, slot.machine, slot, amount, events || null, false);
    if (Array.isArray(events)) events.push({ type: "machineCollected", zoneId, floorId, r, c, machineId: slot.machine.typeId, amount, automatic: false });
    return { ok: true, amount };
  }

  function collectFloor(state, zoneId, floorId, events) {
    const floor = getFloor(state, zoneId, floorId);
    if (!floor || !floor.unlocked) return 0;
    let total = 0;
    floor.grid.forEach((s) => {
      if (s.machine && s.machine.banked > 0) {
        const amount = s.machine.banked;
        total += amount;
        s.machine.banked = 0;
        if (G.Zone) G.Zone.onMachineCollected(state, zoneId, floor, s.machine, s, amount, events || null, true);
        if (Array.isArray(events)) events.push({ type: "machineCollected", zoneId, floorId, r: s.r, c: s.c, machineId: s.machine.typeId, amount, automatic: true });
      }
    });
    const zoneStats = G.Zone.getZoneState(state, zoneId).stats;
    zoneStats.cashCollected = (zoneStats.cashCollected || 0) + total;
    grantMoney(state, total);
    return total;
  }


  // ---- Core production tick (used by live loop, called every frame) --------
  // events: array the caller can push {type,...} onto for render/audio hooks.
  function tickFloor(state, zone, floor, dt, events) {
    const outMult = E.floorOutputMult(floor);
    const hasCollector = floor.systems.collector > 0;
    const r = rt(zone.id, floor.id);
    const eff = E.techEffects(state);
    const speedPerLevel = D.UPGRADES.speed.effectPerLevel;
    const outputPerLevel = D.UPGRADES.output.effectPerLevel;
    const inkPerLevel = D.UPGRADES.ink.effectPerLevel;

    G.Zone.beforeTick(state, zone, floor, dt, events);
    const grid = floor.grid;
    for (let i = 0; i < grid.length; i++) {
      const slot = grid[i];
      const m = slot.machine;
      if (!m) continue;
      const def = E.machineDefinition(m);
      const speedLvl = Number(m.levels && m.levels.speed) || 0;
      const base = def && Number.isFinite(def.baseCooldown) ? def.baseCooldown : 1;
      const reduction = 1 - Math.min(0.75, speedPerLevel * speedLvl + eff.globalSpeedMult);
      const baseCooldown = Math.max(0.15, base * reduction);
      const cooldown = G.Zone.modifyCooldown(state, zone.id, floor, m, baseCooldown);
      m.progress += dt / cooldown;
      while (m.progress >= 1) {
        m.progress -= 1;
        if (!G.Zone.beforeMachineCycle(state, zone, floor, m, slot, events)) continue;
        const outputLvl = Number(m.levels && m.levels.output) || 0;
        const outputMult = 1 + outputPerLevel * outputLvl + eff.globalOutputMult;
        let yieldAmt = def ? def.baseYield * outputMult * outMult : 0;
        const inkLvl = Number(m.levels && m.levels.ink) || 0;
        const critChance = def ? Math.min(0.6, def.critChance + inkPerLevel * inkLvl + eff.critChanceAdd) : 0;
        const isCrit = Math.random() < critChance;
        if (isCrit) yieldAmt *= def ? (def.critMult + 0.15 * inkLvl) : 1;
        const zoneMultiplier = G.Zone.getProductionMultiplier(state, zone.id, floor, m, slot);
        yieldAmt *= zoneMultiplier;
        const result = { amount: yieldAmt, crit: isCrit };
        zone.stats.totalCycles = (zone.stats.totalCycles || 0) + 1;
        zone.stats.cashGenerated = (zone.stats.cashGenerated || 0) + yieldAmt;
        m.banked += yieldAmt;
        if (events) events.push({ type: "cycle", zoneId: zone.id, floorId: floor.id, r: slot.r, c: slot.c, amount: yieldAmt, crit: isCrit });
        G.Zone.afterMachineCycle(state, zone, floor, m, slot, result, events);
      }
    }

    if (hasCollector) {
      const tickSec = E.collectorTickSeconds(floor, state);
      r.collectorTimer += dt;
      if (tickSec && r.collectorTimer >= tickSec) {
        r.collectorTimer = 0;
        const total = collectFloor(state, zone.id, floor.id, events);
        if (total > 0 && events) events.push({ type: "autocollect", zoneId: zone.id, floorId: floor.id, amount: total });
      }
    }

    // Random bonus drop timer (only meaningful on the currently viewed floor,
    // but we run it for all unlocked floors so it's consistent with idle sim).
    r.bonusTimer -= dt;
    if (r.bonusTimer <= 0) {
      r.bonusTimer = 12 + Math.random() * 18;
      const occupied = floor.grid.filter((s) => s.machine);
      if (occupied.length > 0 && events) {
        const pick = occupied[Math.floor(Math.random() * occupied.length)];
        events.push({ type: "bonusReady", zoneId: zone.id, floorId: floor.id, r: pick.r, c: pick.c });
      }
    }
  }


  function tick(state, dt) {
    const events = tickEvents;
    events.length = 0;
    const zones = state.zones;
    for (let zi = 0; zi < zones.length; zi++) {
      const zone = zones[zi];
      if (!zone.unlocked) continue;
      G.Zone.beforeZoneTick(state, zone, dt, events);
      let zoneHadUnlockedFloor = false;
      const floors = zone.floors;
      for (let fi = 0; fi < floors.length; fi++) {
        const floor = floors[fi];
        if (!floor.unlocked) continue;
        zoneHadUnlockedFloor = true;
        tickFloor(state, zone, floor, dt, events);
        G.Zone.afterTick(state, zone, floor, dt, events);
      }
      if (zoneHadUnlockedFloor) zone.stats.playTimeSeconds = (zone.stats.playTimeSeconds || 0) + dt;
      G.Zone.afterZoneTick(state, zone, dt, events);
    }
    // Resolve discoveries after gameplay state changes but before dispatch so
    // mechanic-emitted discovery/events can participate in the same bounded
    // event chain during this tick.
    G.Zone.checkAllSecrets(state, events);
    G.Zone.dispatchEvents(state, events);
    // R&D research accrual
    const rndRate = E.rndRatePerSec(state);
    if (rndRate > 0) state.research += rndRate * dt;
    // Vault passive interest, applied continuously (per-hour rate -> per-second)
    const interestPerHour = E.vaultInterestPerHour(state);
    if (interestPerHour > 0 && state.money > 0) {
      grantMoney(state, state.money * (interestPerHour / 3600) * dt);
    }
    state.stats.playTimeSeconds += dt;

    // Cumulative online-time rewards. The remainder is stored in onlineSeconds,
    // so 15 min today + 15 min tomorrow still crosses the same 30 min milestone.
    const interval = D.SKILL_POINT_INTERVAL_SECONDS;
    const before = Math.floor((state.skills.onlineSeconds || 0) / interval);
    state.skills.onlineSeconds = Math.max(0, (state.skills.onlineSeconds || 0) + Math.max(0, dt));
    const after = Math.floor(state.skills.onlineSeconds / interval);
    const gainedSkillPoints = after - before;
    if (gainedSkillPoints > 0) {
      state.skills.points += gainedSkillPoints;
      events.push({ type: "skillPoint", amount: gainedSkillPoints });
    }

    return events;
  }

  // ---- Tech tree purchase ---------------------------------------------------
  function buyTech(state, techId) {
    const tech = D.techById(techId);
    if (!tech) return { ok: false };
    if (state.skills.tech[techId]) return { ok: false, reason: "owned" };
    if (!E.techRequirementsMet(state, tech)) return { ok: false, reason: "requires" };
    const purchaseReason = E.techPurchaseReason(state, tech);
    if (purchaseReason) return { ok: false, reason: purchaseReason };
    state.skills.points -= tech.cost;
    state.research -= tech.researchCost;
    state.skills.tech[techId] = true;
    if (E.invalidateTechEffects) E.invalidateTechEffects(state);
    return { ok: true };
  }

  G.Factory = {
    getZone, getFloor, currentZone, currentFloor,
    canPlaceMachine, placeMachine, upgradeMachine,
    buyFloorSystem, unlockZone, unlockFloor, upgradeRoom,
    collectMachine, collectFloor, grantMoney,
    tick, tickFloor,
    buyTech,
    resetRuntime() { Object.keys(floorRuntime).forEach((k) => delete floorRuntime[k]); },
  };
})(window.Game = window.Game || {});
