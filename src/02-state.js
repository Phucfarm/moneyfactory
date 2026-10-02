/* ============================================================
   02-state.js — Single source of truth for all game state.
   Every system (economy, factory, save, ui) reads and
   mutates THIS object. No system keeps its own duplicated copy.
   ============================================================ */
(function (G) {
  "use strict";
  const D = G.DATA;

  const SAVE_VERSION = 7;

  function makeEmptyGrid() {
    const slots = [];
    for (let r = 0; r < D.GRID_ROWS; r++) {
      for (let c = 0; c < D.GRID_COLS; c++) {
        slots.push({
          r, c,
          machine: null, // { typeId, tierId, levels: {speed,output,ink}, progress: 0..1, banked }
        });
      }
    }
    return slots;
  }

  function makeFloor(floorDef) {
    return {
      id: floorDef.id,
      unlocked: !floorDef.unlock,
      grid: makeEmptyGrid(),
      systems: {
        conveyor: 0,
        collector: 0,
      },
    };
  }

  function cloneJson(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_e) { return {}; }
  }

  function isPlainObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }

  function mergeDeclaredObject(target, source, definition) {
    if (!isPlainObject(target) || !isPlainObject(definition)) return;
    if (!isPlainObject(source)) return;
    Object.keys(definition).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(source, key)) return;
      const declared = definition[key];
      const loaded = source[key];
      if (isPlainObject(declared)) {
        if (isPlainObject(loaded)) mergeDeclaredObject(target[key], loaded, declared);
      } else if (Array.isArray(declared)) {
        if (Array.isArray(loaded)) target[key] = cloneJson(loaded);
      } else if (declared === null) {
        if (loaded === null) target[key] = null;
      } else if (typeof declared === "number") {
        if (typeof loaded === "number" && isFinite(loaded)) target[key] = loaded;
      } else if (typeof loaded === typeof declared) {
        target[key] = loaded;
      }
    });
  }

  function makeZone(zoneDef) {
    const mechanicState = {};
    (zoneDef.mechanics || []).forEach((mechanic) => {
      if (mechanic && typeof mechanic.id === "string") {
        mechanicState[mechanic.id] = mechanic.initialState && typeof mechanic.initialState === "object"
          ? cloneJson(mechanic.initialState)
          : {};
      }
    });
    return {
      id: zoneDef.id,
      unlocked: !zoneDef.unlock,
      floors: zoneDef.floors.map(makeFloor),
      mechanicState,
      mechanicDiscoveries: [],
      variables: cloneJson(zoneDef.variables || {}),
      upgrades: {},
      purchases: {},
      secrets: [],
      unlockedMachineIds: [],
      stats: {
        playTimeSeconds: 0,
        totalCycles: 0,
        cashGenerated: 0,
        machinesPlaced: 0,
        cashCollected: 0,
      },
    };
  }

  function defaultState() {
    return {
      saveVersion: SAVE_VERSION,
      createdAt: Date.now(),
      lastSaveTime: Date.now(),

      money: 50,
      totalEarned: 0,       // cumulative cash granted in this save
      lifetimeEarned: 0,    // total cash ever granted; used for lifetime unlocks/stats only
      maxMoney: 50,         // highest cash balance ever reached in the current run

      research: 0,          // research points from R&D room; spent on Tech Tree purchases

      currentZoneId: D.ZONES[0].id,
      currentFloorId: D.ZONES[0].floors[0].id,
      zones: D.ZONES.map(makeZone),

      rooms: {
        rnd: { level: 0 },
        vault: { level: 0 },
        power: { level: 0 },
      },

      skills: {
        points: 0,
        onlineSeconds: 0,
        tech: {}, // techId -> true
      },

      settings: {
        lang: "en",
        music: true,
        sfx: true,
        musicVolume: 0.35,
        sfxVolume: 0.7,
      },

      camera: { x: 0, y: 0, zoom: 1 },

      selectedTierId: "common",
      selectedMachineId: "printer_common",

      stats: {
        totalClicks: 0,
        totalMachinesPlaced: 0,
        totalUpgradesBought: 0,
        playTimeSeconds: 0,
      },
    };
  }

  // ---- Defensive merge: fills in any missing/invalid fields from a
  // loaded save with sensible defaults so corrupt/partial saves never
  // crash the game (spec section 23).
  function sanitizeState(loaded) {
    const base = defaultState();
    if (!loaded || typeof loaded !== "object") return base;

    const out = base;
    try {
      if (typeof loaded.money === "number" && isFinite(loaded.money) && loaded.money >= 0) out.money = loaded.money;
      if (typeof loaded.totalEarned === "number" && isFinite(loaded.totalEarned)) out.totalEarned = Math.max(0, loaded.totalEarned);
      if (typeof loaded.lifetimeEarned === "number" && isFinite(loaded.lifetimeEarned)) out.lifetimeEarned = Math.max(0, loaded.lifetimeEarned);
      if (typeof loaded.maxMoney === "number" && isFinite(loaded.maxMoney)) out.maxMoney = Math.max(0, loaded.maxMoney);
      out.maxMoney = Math.max(out.maxMoney, out.money);
      if (typeof loaded.research === "number" && isFinite(loaded.research)) out.research = Math.max(0, loaded.research);
      if (typeof loaded.lastSaveTime === "number" && isFinite(loaded.lastSaveTime) && loaded.lastSaveTime >= 0) out.lastSaveTime = loaded.lastSaveTime;
      if (typeof loaded.createdAt === "number" && isFinite(loaded.createdAt) && loaded.createdAt >= 0) out.createdAt = loaded.createdAt;

      if (loaded.settings && typeof loaded.settings === "object") {
        if (loaded.settings.lang === "en" || loaded.settings.lang === "vi" || loaded.settings.lang === "id" || loaded.settings.lang === "es") out.settings.lang = loaded.settings.lang;
        if (typeof loaded.settings.music === "boolean") out.settings.music = loaded.settings.music;
        if (typeof loaded.settings.sfx === "boolean") out.settings.sfx = loaded.settings.sfx;
        if (typeof loaded.settings.musicVolume === "number" && isFinite(loaded.settings.musicVolume)) out.settings.musicVolume = clamp01(loaded.settings.musicVolume);
        if (typeof loaded.settings.sfxVolume === "number" && isFinite(loaded.settings.sfxVolume)) out.settings.sfxVolume = clamp01(loaded.settings.sfxVolume);
      }

      const oldPrestige = loaded.prestige && typeof loaded.prestige === "object" ? loaded.prestige : null;
      if (loaded.skills && typeof loaded.skills === "object") {
        if (typeof loaded.skills.points === "number" && isFinite(loaded.skills.points)) out.skills.points = Math.max(0, Math.floor(loaded.skills.points));
        if (typeof loaded.skills.onlineSeconds === "number" && isFinite(loaded.skills.onlineSeconds)) out.skills.onlineSeconds = Math.max(0, loaded.skills.onlineSeconds);
        if (loaded.skills.tech && typeof loaded.skills.tech === "object") {
          const legacyTech = loaded.skills.tech;
          const hadPreV7Auto4 = legacyTech.t_auto_4 === true;
          const hadPreV7Auto5 = legacyTech.t_auto_5 === true;
          D.TECH_TREE.forEach((t) => {
            let owned = legacyTech[t.id] === true;
            // v6 had no t_auto_3. A v6 save that already owned auto-4/5 is
            // migrated to the new sequential chain without losing the unlock.
            if (t.id === "t_auto_3" && (hadPreV7Auto4 || hadPreV7Auto5)) owned = true;
            if (t.id === "t_auto_4" && hadPreV7Auto5) owned = true;
            if (owned && t.requires.every((req) => !!out.skills.tech[req])) out.skills.tech[t.id] = true;
          });
        }
      } else if (oldPrestige) {
        // One-time migration: keep old earned points/upgrades, discard only the
        // old Rebirth counter and reset behavior. New points come from online time.
        if (typeof oldPrestige.perkPoints === "number" && isFinite(oldPrestige.perkPoints)) out.skills.points = Math.max(0, Math.floor(oldPrestige.perkPoints));
        if (oldPrestige.tech && typeof oldPrestige.tech === "object") {
          const legacyTech = oldPrestige.tech;
          const hadPreV7Auto4 = legacyTech.t_auto_4 === true;
          const hadPreV7Auto5 = legacyTech.t_auto_5 === true;
          D.TECH_TREE.forEach((t) => {
            let owned = legacyTech[t.id] === true;
            if (t.id === "t_auto_3" && (hadPreV7Auto4 || hadPreV7Auto5)) owned = true;
            if (t.id === "t_auto_4" && hadPreV7Auto5) owned = true;
            if (owned && t.requires.every((req) => !!out.skills.tech[req])) out.skills.tech[t.id] = true;
          });
        }
      }

      if (loaded.rooms && typeof loaded.rooms === "object") {
        ["rnd", "vault", "power"].forEach((k) => {
          const def = D.ROOMS[k];
          const lvl = loaded.rooms[k] && loaded.rooms[k].level;
          if (typeof lvl === "number" && isFinite(lvl)) {
            out.rooms[k].level = Math.max(0, Math.min(def.maxLevel, Math.floor(lvl)));
          }
        });
      }

      if (typeof loaded.selectedTierId === "string" && D.tierById(loaded.selectedTierId)) {
        out.selectedTierId = loaded.selectedTierId;
      }
      if (typeof loaded.selectedMachineId === "string" && D.machineById(loaded.selectedMachineId)) {
        out.selectedMachineId = loaded.selectedMachineId;
      }

      if (loaded.camera && typeof loaded.camera === "object") {
        if (typeof loaded.camera.x === "number" && isFinite(loaded.camera.x)) out.camera.x = loaded.camera.x;
        if (typeof loaded.camera.y === "number" && isFinite(loaded.camera.y)) out.camera.y = loaded.camera.y;
        if (typeof loaded.camera.zoom === "number" && isFinite(loaded.camera.zoom) && loaded.camera.zoom > 0) out.camera.zoom = clamp(loaded.camera.zoom, 0.5, 2.8);
      }

      if (typeof loaded.currentZoneId === "string" && D.zoneById(loaded.currentZoneId)) out.currentZoneId = loaded.currentZoneId;

      // Zones/floors/grid — merge by id, ignore anything unrecognized/corrupt.
      if (Array.isArray(loaded.zones)) {
        out.zones.forEach((zone) => {
          const lz = loaded.zones.find((z) => z && z.id === zone.id);
          if (!lz) return;
          if (typeof lz.unlocked === "boolean") zone.unlocked = lz.unlocked || zone.unlocked;
          const zoneDef = D.zoneById(zone.id);
          if (Array.isArray(lz.mechanicDiscoveries)) {
            const validMechanics = new Set((zoneDef.mechanics || []).filter((x) => x && x.visibility && x.visibility.hidden === true).map((x) => x.id));
            zone.mechanicDiscoveries = lz.mechanicDiscoveries.filter((id) => typeof id === "string" && validMechanics.has(id));
          }
          if (Array.isArray(lz.secrets)) {
            const validSecrets = new Set((zoneDef.secrets || []).map((x) => x.id));
            zone.secrets = lz.secrets.filter((id) => typeof id === "string" && validSecrets.has(id));
          }
          if (lz.variables && typeof lz.variables === "object" && !Array.isArray(lz.variables)) {
            mergeDeclaredObject(zone.variables, lz.variables, zoneDef.variables || {});
          }
          if (lz.upgrades && typeof lz.upgrades === "object" && !Array.isArray(lz.upgrades)) {
            const validUpgradeDefs = new Map((zoneDef.upgrades || []).map((x) => [x.id, x]));
            Object.keys(lz.upgrades).forEach((id) => {
              const def = validUpgradeDefs.get(id);
              const value = lz.upgrades[id];
              if (!def || !Number.isFinite(value)) return;
              const maxLevel = Math.max(1, Math.floor(Number(def.maxLevel) || 1));
              zone.upgrades[id] = Math.max(0, Math.min(maxLevel, Math.floor(value)));
            });
          }
          if (lz.purchases && typeof lz.purchases === "object" && !Array.isArray(lz.purchases)) {
            const validPurchaseIds = new Set((zoneDef.purchases || []).map((x) => x.id));
            Object.keys(lz.purchases).forEach((id) => {
              if (validPurchaseIds.has(id) && lz.purchases[id] === true) zone.purchases[id] = true;
            });
          }
          if (Array.isArray(lz.unlockedMachineIds)) {
            const validMachineIds = new Set((zoneDef.machines || []).map((x) => x.id));
            zone.unlockedMachineIds = lz.unlockedMachineIds.filter((id) => typeof id === "string" && validMachineIds.has(id));
          }
          if (lz.mechanicState && typeof lz.mechanicState === "object") {
            (zoneDef.mechanics || []).forEach((mechanicDef) => {
              const value = lz.mechanicState[mechanicDef.id];
              if (value && typeof value === "object") zone.mechanicState[mechanicDef.id] = cloneJson(value);
            });
          }
          if (lz.stats && typeof lz.stats === "object") {
            Object.keys(lz.stats).forEach((key) => {
              const value = lz.stats[key];
              if (typeof value === "number" && isFinite(value) && value >= 0) zone.stats[key] = value;
            });
          }
          if (Array.isArray(lz.floors)) {
            zone.floors.forEach((floor) => {
              const lf = lz.floors.find((f) => f && f.id === floor.id);
              if (!lf) return;
              if (typeof lf.unlocked === "boolean") floor.unlocked = lf.unlocked || floor.unlocked;
              if (lf.systems && typeof lf.systems === "object") {
                ["conveyor", "collector"].forEach((k) => {
                  const v = lf.systems[k];
                  if (typeof v === "number" && isFinite(v)) {
                    const maxLevel = Number(D.FLOOR_SYSTEMS[k]?.maxLevel) || 0;
                    floor.systems[k] = Math.max(0, Math.min(maxLevel, Math.floor(v)));
                  }
                });
              }
              if (Array.isArray(lf.grid)) {
                floor.grid.forEach((slot) => {
                  const ls = lf.grid.find((s) => s && s.r === slot.r && s.c === slot.c);
                  if (!ls || !ls.machine) return;
                  const m = ls.machine;
                  // Legacy saves used tier ids directly (for example `common`)
                  // or only stored `tierId`. Resolve those ids back to the current
                  // global machine definition so upgrades/progress/banked cash are
                  // not silently deleted during the new schema sanitization.
                  const directDef = typeof m.typeId === "string" ? D.machineById(m.typeId) : null;
                  const legacyTier = !directDef && typeof m.typeId === "string" ? D.tierById(m.typeId) : null;
                  const legacyType = !directDef && typeof m.tierId === "string"
                    ? D.MACHINE_TYPES.find((type) => type.tierId === m.tierId)
                    : null;
                  const def = directDef
                    || (legacyTier ? D.machineById("printer_" + legacyTier.id) : null)
                    || (legacyType ? D.machineById(legacyType.id) : null);
                  if (def) {
                    slot.machine = {
                      typeId: def.id,
                      // tierId remains as a compatibility/visual fallback for older core code.
                      tierId: def.tierId || "common",
                      levels: {
                        speed: safeLevel(m.levels && m.levels.speed, D.UPGRADES.speed.maxLevel),
                        output: safeLevel(m.levels && m.levels.output, D.UPGRADES.output.maxLevel),
                        ink: safeLevel(m.levels && m.levels.ink, D.UPGRADES.ink.maxLevel),
                      },
                      progress: typeof m.progress === "number" && isFinite(m.progress) ? clamp01(m.progress) : 0,
                      banked: typeof m.banked === "number" && isFinite(m.banked) ? Math.max(0, m.banked) : 0,
                    };
                  }
                });
              }
              if (typeof lf.id === "string" && loaded.currentFloorId === lf.id) {
                // handled below
              }
            });
          }
        });
      }
      // Keep the active location valid and accessible.
      const activeZone = D.zoneById(out.currentZoneId);
      if (!activeZone) out.currentZoneId = D.ZONES[0].id;
      else if (!out.zones.find((z) => z.id === out.currentZoneId && z.unlocked)) {
        const fallback = out.zones.find((z) => z.unlocked);
        out.currentZoneId = fallback ? fallback.id : D.ZONES[0].id;
      }
      // Selection is global: a machine can be inspected/selected without
      // entering its home Zone. Placement itself is validated by Zone Core.
      if (!D.tierById(out.selectedTierId)) out.selectedTierId = "common";
      if (!D.machineById(out.selectedMachineId)) out.selectedMachineId = "printer_" + out.selectedTierId;

      const activeZoneState = out.zones.find((z) => z.id === out.currentZoneId);
      const requestedFloor = typeof loaded.currentFloorId === "string" ? loaded.currentFloorId : null;
      if (activeZoneState) {
        const wanted = activeZoneState.floors.find((f) => f.id === requestedFloor && f.unlocked);
        const fallbackFloor = activeZoneState.floors.find((f) => f.unlocked);
        out.currentFloorId = wanted ? wanted.id : (fallbackFloor ? fallbackFloor.id : D.ZONES.find((z) => z.id === out.currentZoneId).floors[0].id);
      }

      out.lifetimeEarned = Math.max(out.lifetimeEarned, out.totalEarned);
      out.maxMoney = Math.max(out.maxMoney, out.money);

      if (loaded.stats && typeof loaded.stats === "object") {
        Object.keys(out.stats).forEach((k) => {
          if (typeof loaded.stats[k] === "number" && isFinite(loaded.stats[k])) out.stats[k] = Math.max(0, loaded.stats[k]);
        });
      }
    } catch (e) {
      console.error("Save sanitize error, falling back to safe defaults for affected fields:", e);
    }
    out.saveVersion = SAVE_VERSION;
    return out;
  }

  function safeLevel(v, max) {
    if (typeof v !== "number" || !isFinite(v) || v < 0) return 0;
    return Math.min(max, Math.floor(v));
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function clamp01(v) { return clamp(v, 0, 1); }

  G.State = {
    SAVE_VERSION,
    defaultState,
    sanitizeState,
    clamp,
    clamp01,
  };
})(window.Game = window.Game || {});
