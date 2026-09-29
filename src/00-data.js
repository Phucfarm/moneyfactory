/* ============================================================
   00-data.js — Static game content/data definitions.
   Single source for all balancing numbers & content lists.
   ============================================================ */
(function (G) {
  "use strict";

  // ---- Machine tiers -------------------------------------------------
  // Each tier defines base economics + visuals. Machine "types" within a
  // tier are thin flavor wrappers (name/color offset) sharing tier math,
  // but tiers themselves are the meaningful gameplay differentiator.
  const TIERS = [
    {
      id: "common",
      name: "common",
      order: 0,
      color: "#9aa5ad",
      glow: "#c7cfd4",
      baseCost: 50,
      costGrowth: 1.14,
      baseCooldown: 2.2,          // seconds per cycle at level 0
      baseYield: 1,                // $ per cycle at level 0
      unlockRequirement: null,     // always available
      particleDensity: 0.5,
      critChance: 0.02,
      critMult: 2,
    },
    {
      id: "uncommon",
      name: "uncommon",
      order: 1,
      color: "#57b871",
      glow: "#9be3ae",
      baseCost: 500,
      costGrowth: 1.15,
      baseCooldown: 1.9,
      baseYield: 8,
      unlockRequirement: { type: "money", amount: 250 },
      particleDensity: 0.7,
      critChance: 0.035,
      critMult: 2.2,
    },
    {
      id: "rare",
      name: "rare",
      order: 2,
      color: "#28b8ff",
      glow: "#8edcff",
      baseCost: 2500,
      costGrowth: 1.155,
      baseCooldown: 1.75,
      baseYield: 28,
      unlockRequirement: { type: "money", amount: 2000 },
      particleDensity: 0.9,
      critChance: 0.042,
      critMult: 2.35,
    },
    {
      id: "epic",
      name: "epic",
      order: 3,
      color: "#7a5cff",
      glow: "#b6a4ff",
      baseCost: 10000,
      costGrowth: 1.16,
      baseCooldown: 1.6,
      baseYield: 65,
      unlockRequirement: { type: "money", amount: 7500 },
      particleDensity: 1.0,
      critChance: 0.05,
      critMult: 2.5,
    },
    {
      id: "ascendant",
      name: "ascendant",
      order: 4,
      color: "#c34cff",
      glow: "#edb5ff",
      baseCost: 50000,
      costGrowth: 1.165,
      baseCooldown: 1.42,
      baseYield: 240,
      unlockRequirement: { type: "money", amount: 35000 },
      particleDensity: 1.45,
      critChance: 0.06,
      critMult: 2.8,
    },
    {
      id: "legendary",
      name: "legendary",
      order: 5,
      color: "#ffb238",
      glow: "#ffd98a",
      baseCost: 200000,
      costGrowth: 1.17,
      baseCooldown: 1.3,
      baseYield: 560,
      unlockRequirement: { type: "money", amount: 150000 },
      particleDensity: 1.3,
      critChance: 0.07,
      critMult: 3,
    },
    {
      id: "mythic",
      name: "mythic",
      order: 6,
      color: "#ff5da2",
      glow: "#ffb2d6",
      baseCost: 3000000,
      costGrowth: 1.18,
      baseCooldown: 1.0,
      baseYield: 4800,
      unlockRequirement: { type: "money", amount: 1500000 },
      particleDensity: 1.7,
      critChance: 0.1,
      critMult: 3.5,
    },
    {
      id: "transcendent",
      name: "transcendent",
      order: 7,
      color: "#f7f3ff",
      glow: "#ffffff",
      baseCost: 15000000,
      costGrowth: 1.2,
      baseCooldown: 0.72,
      baseYield: 12500,
      unlockRequirement: { type: "money", amount: 7000000 },
      particleDensity: 2.4,
      critChance: 0.15,
      critMult: 4.5,
    },
  ];

  // ---- Machine "types" — flavor variants, 1 per tier is enough to keep
  // scope sane while still giving each tier a distinct printer to place.
  const MACHINE_TYPES = TIERS.map((t, i) => ({
    id: "printer_" + t.id,
    tierId: t.id,
    nameKey: "machine." + t.id + ".name",
    descKey: "machine." + t.id + ".desc",
  }));

  // Upgrade definitions applied per-machine-instance. Each upgrade has
  // discrete levels; cost scales per level; effect scales per level.
  const UPGRADES = {
    speed: { id: "speed", nameKey: "upgrade.speed", maxLevel: 20, baseCost: 25, costGrowth: 1.22, effectPerLevel: 0.035 }, // -3.5% cooldown/lvl
    output: { id: "output", nameKey: "upgrade.output", maxLevel: 20, baseCost: 30, costGrowth: 1.22, effectPerLevel: 0.08 }, // +8% yield/lvl
    ink: { id: "ink", nameKey: "upgrade.ink", maxLevel: 10, baseCost: 60, costGrowth: 1.3, effectPerLevel: 0.01 }, // +1% crit chance/lvl, +0.15 crit mult/lvl
  };

  // ---- Factory layout: zones -> floors -> grid slots -----------------
  const GRID_COLS = 6;
  const GRID_ROWS = 4;

  // Zone content comes from content/zones.json -> generated JS. This keeps
  // balancing/content outside the simulation core while remaining data-driven.
  const ZONE_SOURCE = G.ZoneContent && Array.isArray(G.ZoneContent.zones) ? G.ZoneContent.zones : [];
  const ZONES = ZONE_SOURCE.map((z) => ({
    ...z,
    floors: Array.isArray(z.floors) ? z.floors : [],
    machines: Array.isArray(z.machines) ? z.machines : [],
    mechanics: Array.isArray(z.mechanics) ? z.mechanics : [],
    secrets: Array.isArray(z.secrets) ? z.secrets : [],
    variables: z.variables && typeof z.variables === "object" && !Array.isArray(z.variables) ? z.variables : {},
    upgrades: Array.isArray(z.upgrades) ? z.upgrades : [],
    purchases: Array.isArray(z.purchases) ? z.purchases : [],
  }));

  // Global machines are the existing rarity/tier machines. Zone machines are
  // independent machine definitions and can be arbitrarily stronger than any tier.
  const GLOBAL_MACHINE_DEFS = MACHINE_TYPES.map((m) => {
    const tier = TIERS.find((t) => t.id === m.tierId);
    return {
      ...m,
      kind: "tier",
      zoneId: null,
      unlockRequirement: tier ? tier.unlockRequirement : null,
      baseCost: tier ? tier.baseCost : 0,
      costGrowth: tier ? tier.costGrowth : 1,
      baseCooldown: tier ? tier.baseCooldown : 1,
      baseYield: tier ? tier.baseYield : 0,
      critChance: tier ? tier.critChance : 0,
      critMult: tier ? tier.critMult : 1,
      particleDensity: tier ? tier.particleDensity : 0.5,
      order: tier ? tier.order : 0,
      color: tier ? tier.color : "#9aa5ad",
      glow: tier ? tier.glow : "#c7cfd4",
    };
  });

  const ZONE_MACHINE_DEFS = [];
  ZONES.forEach((z) => {
    z.machines.forEach((m) => {
      const unlock = m && m.unlock && typeof m.unlock === "object" && !Array.isArray(m.unlock) ? { ...m.unlock } : {};
      // Zone machines are manually unlocked by default. A future machine can
      // explicitly opt into automatic unlocking with "manual": false or "auto": true.
      if (unlock.manual === undefined) unlock.manual = unlock.auto === true ? false : true;
      ZONE_MACHINE_DEFS.push({
        kind: "zone",
        zoneId: z.id,
        ...m,
        unlock,
        tags: Array.isArray(m.tags) ? [...new Set(m.tags.filter((x) => typeof x === "string"))] : [],
        order: Number.isFinite(m.order) ? m.order : (Number.isFinite(m.visualOrder) ? m.visualOrder : 7),
        color: m.color || (m.visual && m.visual.color) || "#8edcff",
        glow: m.glow || (m.visual && m.visual.glow) || "#ffffff",
        particleDensity: Number.isFinite(m.particleDensity) ? m.particleDensity : 1.5,
      });
    });
  });

  const MACHINE_DEFS = GLOBAL_MACHINE_DEFS.concat(ZONE_MACHINE_DEFS);

  // Per-floor economy upgrades (conveyors / auto-collectors)
  const FLOOR_SYSTEMS = {
    conveyor: { baseCost: 400, costGrowth: 1.9, maxLevel: 5, effectPerLevel: 0.12 }, // +12% floor output/lvl
    collector: { baseCost: 1200, costGrowth: 2.1, maxLevel: 5, effectPerLevel: 1 }, // unlocks/improves auto-collect tick rate
  };

  // ---- Functional rooms (global, one of each per save) ---------------
  const ROOMS = {
    rnd: {
      id: "rnd",
      nameKey: "room.rnd.name",
      maxLevel: 25,
      baseCost: 2000,
      costGrowth: 1.35,
      baseRatePerSec: 0.15, // research points / sec at level 1
      ratePerLevel: 0.12,
    },
    vault: {
      id: "vault",
      nameKey: "room.vault.name",
      maxLevel: 25,
      baseCost: 3000,
      costGrowth: 1.35,
      baseInterestPerHour: 0.0, // interest starts at lvl>=1
      interestPerLevel: 0.004, // +0.4%/hr per level while the game is running
    },
    power: {
      id: "power",
      nameKey: "room.power.name",
      maxLevel: 25,
      baseCost: 2500,
      costGrowth: 1.35,
      basePower: 10,
      powerPerLevel: 6,
    },
  };
  // Power cost: each active auto-collector consumes power.
  const POWER_COST_COLLECTOR = 3;
  const SKILL_POINT_INTERVAL_SECONDS = 1800; // 30 minutes of cumulative online time per Skill Point

  // ---- Tech tree (spent with Skill Points earned from online time) -----
  const TECH_TREE = [
    // Production branch
    { id: "t_prod_1", branch: "production", nameKey: "tech.prod1.name", cost: 1, researchCost: 100, effect: { type: "globalOutputMult", value: 0.05 }, requires: [] },
    { id: "t_prod_2", branch: "production", nameKey: "tech.prod2.name", cost: 2, researchCost: 200, effect: { type: "globalOutputMult", value: 0.08 }, requires: ["t_prod_1"] },
    { id: "t_prod_3", branch: "production", nameKey: "tech.prod3.name", cost: 3, researchCost: 300, effect: { type: "critChanceAdd", value: 0.02 }, requires: ["t_prod_2"] },
    { id: "t_prod_4", branch: "production", nameKey: "tech.prod4.name", cost: 5, researchCost: 500, effect: { type: "globalOutputMult", value: 0.15 }, requires: ["t_prod_3"] },
    { id: "t_prod_5", branch: "production", nameKey: "tech.prod5.name", cost: 8, researchCost: 800, effect: { type: "globalSpeedMult", value: 0.1 }, requires: ["t_prod_4"] },
    // Automation branch
    { id: "t_auto_1", branch: "automation", nameKey: "tech.auto1.name", cost: 1, researchCost: 100, effect: { type: "powerDiscount", value: 0.1 }, requires: [] },
    { id: "t_auto_2", branch: "automation", nameKey: "tech.auto2.name", cost: 2, researchCost: 200, effect: { type: "collectorSpeedMult", value: 0.15 }, requires: ["t_auto_1"] },
    { id: "t_auto_4", branch: "automation", nameKey: "tech.auto4.name", cost: 5, researchCost: 500, effect: { type: "rndRateMult", value: 0.25 }, requires: ["t_auto_2"] },
    { id: "t_auto_5", branch: "automation", nameKey: "tech.auto5.name", cost: 8, researchCost: 800, effect: { type: "powerDiscount", value: 0.15 }, requires: ["t_auto_4"] },
    // Economy branch
    { id: "t_econ_1", branch: "economy", nameKey: "tech.econ1.name", cost: 1, researchCost: 100, effect: { type: "upgradeDiscount", value: 0.08 }, requires: [] },
    { id: "t_econ_2", branch: "economy", nameKey: "tech.econ2.name", cost: 2, researchCost: 200, effect: { type: "vaultInterestAdd", value: 0.002 }, requires: ["t_econ_1"] },
    { id: "t_econ_3", branch: "economy", nameKey: "tech.econ3.name", cost: 3, researchCost: 300, effect: { type: "machineCostDiscount", value: 0.06 }, requires: ["t_econ_2"] },
    { id: "t_econ_4", branch: "economy", nameKey: "tech.econ4.name", cost: 5, researchCost: 500, effect: { type: "machineCostDiscount", value: 0.10 }, requires: ["t_econ_3"] },
    { id: "t_econ_5", branch: "economy", nameKey: "tech.econ5.name", cost: 8, researchCost: 800, effect: { type: "globalOutputMult", value: 0.18 }, requires: ["t_econ_4"] },
  ];


  G.DATA = {
    TIERS, MACHINE_TYPES, ZONES, ZONE_MACHINE_DEFS, MACHINE_DEFS, UPGRADES, GRID_COLS, GRID_ROWS,
    FLOOR_SYSTEMS, ROOMS, POWER_COST_COLLECTOR, SKILL_POINT_INTERVAL_SECONDS,
    TECH_TREE,
    tierById(id) { return TIERS.find(t => t.id === id); },
    machineTypeById(id) { return MACHINE_TYPES.find(m => m.id === id); },
    zoneMachineById(id) { return ZONE_MACHINE_DEFS.find(m => m.id === id); },
    machineById(id) { return MACHINE_DEFS.find(m => m.id === id); },
    zoneById(id) { return ZONES.find(z => z.id === id); },
    floorById(zoneId, floorId) {
      const z = ZONES.find(z => z.id === zoneId);
      return z ? z.floors.find(f => f.id === floorId) : null;
    },
    techById(id) { return TECH_TREE.find(t => t.id === id); },
  };
})(window.Game = window.Game || {});
