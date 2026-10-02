/* ============================================================
   04-economy.js — All numeric formulas in one place.
   Pure functions operating on (state, DATA) -> numbers.
   Keeping formulas centralized avoids drift/duplication bugs.
   ============================================================ */
(function (G) {
  "use strict";
  const D = G.DATA;

  // ---- Tech tree effect aggregation -----------------------------------
  function techEffects(state) {
    const eff = {
      globalOutputMult: 0,
      globalSpeedMult: 0,
      critChanceAdd: 0,
      powerDiscount: 0,
      collectorSpeedMult: 0,
      rndRateMult: 0,
      upgradeDiscount: 0,
      vaultInterestAdd: 0,
      machineCostDiscount: 0,
    };
    Object.keys(state.skills.tech).forEach((id) => {
      if (!state.skills.tech[id]) return;
      const t = D.techById(id);
      if (!t) return;
      const e = t.effect;
      if (eff[e.type] !== undefined) eff[e.type] += e.value;
    });
    return eff;
  }

  // ---- Machine placement cost: scales with how many of that tier are
  // already placed anywhere in the factory (global count per tier). ----
  function tierPlacedCount(state, tierId) {
    let n = 0;
    state.zones.forEach((z) => z.floors.forEach((f) => f.grid.forEach((s) => {
      if (s.machine && s.machine.tierId === tierId) n++;
    })));
    return n;
  }

  function machineCountById(state, machineId) {
    let n = 0;
    state.zones.forEach((z) => z.floors.forEach((f) => f.grid.forEach((s) => {
      if (s.machine && s.machine.typeId === machineId) n++;
    })));
    return n;
  }

  function machineCostById(state, machineId) {
    const def = D.machineById(machineId);
    if (!def) return Infinity;
    const n = machineCountById(state, machineId);
    const eff = techEffects(state);
    const raw = def.baseCost * Math.pow(def.costGrowth || 1, n);
    return Math.ceil(raw * (1 - Math.min(0.6, eff.machineCostDiscount)));
  }

  function machineCost(state, tierIdOrMachineId) {
    const def = D.machineById(tierIdOrMachineId);
    if (def) return machineCostById(state, def.id);
    const type = D.machineTypeById(tierIdOrMachineId);
    if (type) return machineCostById(state, type.id);
    const tier = D.tierById(tierIdOrMachineId);
    return tier ? machineCostById(state, "printer_" + tier.id) : Infinity;
  }

  function tierUnlocked(state, tierId) {
    const tier = D.tierById(tierId);
    if (!tier || !tier.unlockRequirement) return !!tier;
    const req = tier.unlockRequirement;
    if (req.type === "money") return state.maxMoney >= Number(req.amount || 0);
    return false;
  }

  // ---- Per-machine-instance upgrade costs/effects ----------------------
  function upgradeCost(upgradeId, currentLevel, state) {
    const u = D.UPGRADES[upgradeId];
    const eff = techEffects(state);
    const raw = u.baseCost * Math.pow(u.costGrowth, currentLevel);
    return Math.ceil(raw * (1 - Math.min(0.5, eff.upgradeDiscount)));
  }

  function machineDefinition(machine) {
    const direct = D.machineById(machine && machine.typeId);
    if (direct) return direct;
    const legacyTierId = machine && machine.tierId;
    if (legacyTierId) {
      const tierMachine = D.machineById("printer_" + legacyTierId);
      if (tierMachine) return tierMachine;
    }
    return null;
  }

  function machineCooldown(machine, state) {
    const def = machineDefinition(machine);
    if (!def) return 1;
    const eff = techEffects(state);
    const speedLvl = machine.levels.speed;
    const reduction = 1 - Math.min(0.75, D.UPGRADES.speed.effectPerLevel * speedLvl + eff.globalSpeedMult);
    const base = Number.isFinite(def.baseCooldown) ? def.baseCooldown : 1;
    return Math.max(0.15, base * reduction);
  }

  function machineBaseYield(machine, floorMult, state) {
    const def = machineDefinition(machine);
    if (!def) return 0;
    const eff = techEffects(state);
    const outputLvl = machine.levels.output;
    const outputMult = 1 + D.UPGRADES.output.effectPerLevel * outputLvl + eff.globalOutputMult;
    return def.baseYield * outputMult * floorMult;
  }

  function machineCritChance(machine, state) {
    const def = machineDefinition(machine);
    if (!def) return 0;
    const eff = techEffects(state);
    const inkLvl = machine.levels.ink;
    return Math.min(0.6, def.critChance + D.UPGRADES.ink.effectPerLevel * inkLvl + eff.critChanceAdd);
  }

  function machineCritMult(machine) {
    const def = machineDefinition(machine);
    if (!def) return 1;
    const inkLvl = machine.levels.ink;
    return def.critMult + 0.15 * inkLvl;
  }

  // ---- Floor-level systems ----------------------------------------------
  function floorOutputMult(floor) {
    const lvl = floor.systems.conveyor;
    return 1 + D.FLOOR_SYSTEMS.conveyor.effectPerLevel * lvl;
  }

  function floorSystemCost(systemId, currentLevel, state) {
    const def = D.FLOOR_SYSTEMS[systemId];
    const raw = def.baseCost * Math.pow(def.costGrowth, currentLevel);
    return Math.ceil(raw);
  }

  function collectorTickSeconds(floor, state) {
    // higher collector level -> faster sweep interval
    const lvl = floor.systems.collector;
    const eff = techEffects(state);
    if (lvl <= 0) return null; // no auto collection
    const base = Math.max(0.4, 3.0 - 0.4 * lvl);
    return base * (1 - Math.min(0.5, eff.collectorSpeedMult));
  }

  // ---- Rooms --------------------------------------------------------------
  function roomCost(roomId, currentLevel) {
    const def = D.ROOMS[roomId];
    return Math.ceil(def.baseCost * Math.pow(def.costGrowth, currentLevel));
  }

  function rndRatePerSec(state) {
    const lvl = state.rooms.rnd.level;
    if (lvl <= 0) return 0;
    const def = D.ROOMS.rnd;
    const eff = techEffects(state);
    return (def.baseRatePerSec + def.ratePerLevel * (lvl - 1)) * (1 + eff.rndRateMult);
  }

  function vaultInterestPerHour(state) {
    const lvl = state.rooms.vault.level;
    if (lvl <= 0) return 0;
    const def = D.ROOMS.vault;
    return def.baseInterestPerHour + def.interestPerLevel * lvl + techEffects(state).vaultInterestAdd;
  }

  function powerCapacity(state) {
    const lvl = state.rooms.power.level;
    const def = D.ROOMS.power;
    if (lvl <= 0) return 0;
    return def.basePower + def.powerPerLevel * (lvl - 1);
  }

  function powerDemand(state) {
    const eff = techEffects(state);
    const discount = 1 - Math.min(0.4, eff.powerDiscount);
    let demand = 0;
    state.zones.forEach((z) => z.floors.forEach((f) => {
      if (f.systems.collector > 0) demand += D.POWER_COST_COLLECTOR * discount;
    }));
    return demand;
  }


  // ---- Tech tree affordability ------------------------------------------
  function techCostAffordable(state, tech) {
    return !!tech && (state.skills.points || 0) >= Number(tech.cost || 0) && state.research >= Number(tech.researchCost || 0);
  }

  function techPurchaseReason(state, tech) {
    if (!tech) return "invalid";
    if ((state.skills.points || 0) < Number(tech.cost || 0)) return "points";
    if (state.research < Number(tech.researchCost || 0)) return "research";
    return null;
  }

  function techRequirementsMet(state, tech) {
    return !!tech && Array.isArray(tech.requires) && tech.requires.every((id) => !!state.skills.tech[id]);
  }

  // ---- Formatting -----------------------------------------------------------
  const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
  function formatMoney(value) {
    if (value === null || value === undefined) return "0";
    const original = Number(value);
    if (!Number.isFinite(original)) return "0";
    const sign = original < 0 ? "-" : "";
    let n = Math.abs(original);
    if (n < 1000) {
      const fixed = Number(n.toFixed(2));
      return sign + String(fixed);
    }

    let tier = Math.floor(Math.log10(n) / 3);
    tier = Math.max(1, Math.min(tier, SUFFIXES.length - 1));

    // Beyond the largest named suffix, keep the original magnitude in scientific notation.
    if (Math.floor(Math.log10(n) / 3) >= SUFFIXES.length) {
      return sign + n.toExponential(2).replace("e+", "e");
    }

    let scaled = n / Math.pow(1000, tier);
    let decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
    let rounded = Number(scaled.toFixed(decimals));

    // Prevent boundary values such as 999,999 from becoming "1000K".
    if (rounded >= 1000 && tier < SUFFIXES.length - 1) {
      tier += 1;
      scaled = n / Math.pow(1000, tier);
      decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
      rounded = Number(scaled.toFixed(decimals));
    }
    return sign + String(rounded) + SUFFIXES[tier];
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  G.Econ = {
    techEffects, tierPlacedCount, machineCountById, machineCostById, machineCost, tierUnlocked,
    upgradeCost, machineDefinition, machineCooldown, machineBaseYield, machineCritChance, machineCritMult,
    floorOutputMult, floorSystemCost, collectorTickSeconds,
    roomCost, rndRatePerSec, vaultInterestPerHour,
    powerCapacity, powerDemand, techCostAffordable, techPurchaseReason, techRequirementsMet,
    formatMoney, formatTime,
  };
})(window.Game = window.Game || {});
