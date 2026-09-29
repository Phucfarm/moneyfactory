/* ============================================================
   Ocean Zone mechanics.

   This source intentionally keeps two focused mechanics in one file:
   - OceanWaterExposure: the harmful water-infection system.
   - OceanMachineSystems: machine-specific Ocean abilities.

   All tunable values live in content/zones.json.
   ============================================================ */
(function (G) {
  "use strict";

  const WATER_MECHANIC_ID = "ocean_water_exposure";
  const MACHINE_MECHANIC_ID = "ocean_machine_systems";

  function finiteNumber(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function cloneJson(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_e) { return {}; }
  }

  function parseSlotKey(key) {
    const match = /^f(.+)_r(-?\d+)c(-?\d+)$/.exec(String(key || ""));
    if (!match) return null;
    const r = Number(match[2]), c = Number(match[3]);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    return { floorId: match[1], r, c };
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, finiteNumber(value, 0)));
  }

  function machineDef(ctx, machine) {
    return ctx && ctx.game && ctx.game.DATA && typeof ctx.game.DATA.machineById === "function"
      ? ctx.game.DATA.machineById(machine && machine.typeId)
      : null;
  }

  function slotKey(floor, slot) {
    if (!floor || !slot) return null;
    return `f${String(floor.id).replace(/[^A-Za-z0-9_$-]/g, "_")}_r${Number(slot.r) || 0}c${Number(slot.c) || 0}`;
  }

  function stateRecord(ctx, floor, slot) {
    const key = slotKey(floor, slot);
    if (!key) return null;
    const existingRoot = ctx && ctx.mechanics && ctx.mechanics[ctx.mechanic.id];
    const existing = existingRoot && existingRoot.machines && existingRoot.machines[key];
    if (existing && typeof existing === "object" && !Array.isArray(existing)) return existing;
    if (ctx && (ctx.mode === "query" || ctx.mode === "ui")) return null;
    const root = ctx.mechanicStateFor(ctx.mechanic.id);
    if (!root.machines || typeof root.machines !== "object" || Array.isArray(root.machines)) root.machines = {};
    if (!root.machines[key] || typeof root.machines[key] !== "object" || Array.isArray(root.machines[key])) {
      root.machines[key] = { infectedUntil: 0 };
    }
    return root.machines[key];
  }

  function existingStateRecord(ctx, floor, slot) {
    const key = slotKey(floor, slot);
    if (!key) return null;
    const root = ctx && ctx.mechanics && ctx.mechanics[ctx.mechanic.id];
    const record = root && root.machines && root.machines[key];
    return record && typeof record === "object" && !Array.isArray(record) ? record : null;
  }

  class OceanWaterExposure extends G.Zone.ZoneMechanic {
    getUIState(ctx) {
      const state = ctx.mechanicStateFor(this.id);
      const clock = finiteNumber(state.clock, 0);
      const machineStatuses = [];
      const floors = ctx.zone && Array.isArray(ctx.zone.floors) ? ctx.zone.floors : [];
      floors.forEach((floor) => {
        if (!floor || !floor.unlocked) return;
        (floor.grid || []).forEach((slot) => {
          if (!slot || !slot.machine) return;
          const record = existingStateRecord(ctx, floor, slot);
          if (!record) return;
          const until = finiteNumber(record.infectedUntil, 0);
          if (clock >= until) return;
          const duration = Math.max(0.1, finiteNumber(record.lastDuration, this.config.normalDurationSeconds || 8.5));
          const remaining = Math.max(0, until - clock);
          machineStatuses.push({
            floorId: floor.id,
            r: slot.r,
            c: slot.c,
            statusId: "water_infected",
            variant: "disabled",
            tone: "danger",
            icon: "💧",
            labelKey: "zoneui.ocean.waterInfected",
            detailKey: "zoneui.ocean.waterInfectedDetail",
            progress: Math.min(1, remaining / duration),
            value: Math.ceil(remaining * 10) / 10,
            valueUnit: "s",
            priority: 100,
          });
        });
      });
      return { machineStatuses };
    }


    onBeforeZoneTick(ctx) {
      const state = ctx.mechanicStateFor(this.id);
      state.clock = Math.max(0, finiteNumber(state.clock, 0)) + Math.max(0, finiteNumber(ctx.dt, 0));
      const resistance = clamp01(this.variable(ctx, "waterResistance", 0));
      const baseChance = Math.max(0, finiteNumber(this.config.infectionChancePerSecond, 0));
      const dt = Math.max(0, finiteNumber(ctx.dt, 0));
      const perFrameChance = 1 - Math.pow(Math.max(0, 1 - Math.min(0.95, baseChance)), dt);

      const floors = ctx.zone && Array.isArray(ctx.zone.floors) ? ctx.zone.floors.filter((floor) => floor && floor.unlocked) : [];
      floors.forEach((floor) => {
        floor.grid.forEach((slot) => {
          const machine = slot.machine;
          if (!machine) return;
          const record = stateRecord(ctx, floor, slot);
          if (!record) return;

          if (finiteNumber(record.infectedUntil, 0) > 0 && state.clock >= record.infectedUntil) {
            record.infectedUntil = 0;
            this.emit(ctx, "oceanWaterRecovered", {
              floorId: floor.id,
              r: slot.r,
              c: slot.c,
              machineId: machine.typeId,
            });
            this.emitUI(ctx, {
              kind: "banner",
              id: "water_recovered",
              labelKey: "zoneui.ocean.waterRecovered",
              detailKey: "zoneui.ocean.waterRecoveredDetail",
              icon: "✓",
              tone: "good",
              durationMs: 1800,
              cooldownMs: 900,
            });
          }

          if (state.clock < finiteNumber(record.infectedUntil, 0)) return;
          if (resistance >= 1) return;
          if (Math.random() >= perFrameChance * (1 - resistance)) return;

          const def = machineDef(ctx, machine);
          const duration = def && Array.isArray(def.tags) && def.tags.includes("ocean_machine")
            ? Math.max(0.1, finiteNumber(this.config.zoneMachineDurationSeconds, 3.5))
            : Math.max(0.1, finiteNumber(this.config.normalDurationSeconds, 8.5));

          record.infectedUntil = state.clock + duration;
          record.lastDuration = duration;
          record.infections = Math.max(0, finiteNumber(record.infections, 0)) + 1;
          this.addState(ctx, "infectionCount", 1, 0);
          this.emit(ctx, "oceanWaterInfected", {
            floorId: floor.id,
            r: slot.r,
            c: slot.c,
            machineId: machine.typeId,
            duration,
          });
          this.emitUI(ctx, {
            kind: "banner",
            id: "water_infected",
            labelKey: "zoneui.ocean.waterInfected",
            detailKey: "zoneui.ocean.waterInfectedDetail",
            icon: "💧",
            tone: "danger",
            value: Math.ceil(duration * 10) / 10,
            valueUnit: "s",
            durationMs: 2400,
            cooldownMs: 1000,
            priority: 80,
          });
        });
      });
    }

    onBeforeMachineCycle(ctx) {
      const record = stateRecord(ctx, ctx.floor, ctx.slot);
      if (!record) return true;
      return finiteNumber(record.infectedUntil, 0) <= finiteNumber(ctx.mechanicStateFor(this.id).clock, 0);
    }

    modifyProduction(ctx, multiplier) {
      const record = stateRecord(ctx, ctx.floor, ctx.machine && ctx.slot);
      if (!record) return multiplier;
      const clock = finiteNumber(ctx.mechanicStateFor(this.id).clock, 0);
      return clock < finiteNumber(record.infectedUntil, 0) ? 0 : multiplier;
    }

  }

  class OceanColdCurrents extends G.Zone.ZoneMechanic {
    getUIState(ctx) {
      const state = ctx.mechanicStateFor(this.id);
      const clock = finiteNumber(state.clock, 0);
      const until = finiteNumber(state.currentUntil, 0);
      if (clock >= until) return null;
      const duration = Math.max(0.1, finiteNumber(this.config.currentDurationSeconds, 10));
      const remaining = Math.max(0, until - clock);
      return {
        zoneIndicators: [{
          id: "cold_current",
          icon: "❄",
          tone: "info",
          labelKey: "zoneui.ocean.coldCurrentActive",
          detailKey: "zoneui.ocean.coldCurrentDetail",
          value: "×" + Math.max(1, finiteNumber(this.config.currentSpeedMultiplier, 1.5)).toFixed(1),
          valueUnit: Math.ceil(remaining * 10) / 10 + "s",
          progress: Math.min(1, remaining / duration),
          priority: 90,
        }],
      };
    }

    onBeforeZoneTick(ctx) {
      const state = ctx.mechanicStateFor(this.id);
      const dt = Math.max(0, finiteNumber(ctx.dt, 0));
      state.clock = Math.max(0, finiteNumber(state.clock, 0)) + dt;
      const until = Math.max(0, finiteNumber(state.currentUntil, 0));
      if (state.clock < until) return;
      const chancePerSecond = Math.max(0, Math.min(0.25, finiteNumber(this.config.currentChancePerSecond, 0)));
      const chance = 1 - Math.pow(1 - chancePerSecond, dt);
      if (Math.random() < chance) {
        const duration = Math.max(0.1, finiteNumber(this.config.currentDurationSeconds, 10));
        state.currentUntil = state.clock + duration;
        state.currentCount = Math.max(0, Math.floor(finiteNumber(state.currentCount, 0))) + 1;
        this.emit(ctx, "oceanColdCurrentStarted", { duration });
        this.emitUI(ctx, {
          kind: "banner",
          id: "cold_current_started",
          labelKey: "zoneui.ocean.coldCurrentStarted",
          detailKey: "zoneui.ocean.coldCurrentDetail",
          icon: "❄",
          tone: "info",
          value: "×" + Math.max(1, finiteNumber(this.config.currentSpeedMultiplier, 1.5)).toFixed(1),
          durationMs: 2600,
          cooldownMs: 5000,
          priority: 90,
        });
      }
    }


    modifyCooldown(ctx, cooldown) {
      let value = Math.max(0.05, finiteNumber(cooldown, 1));
      const baseSpeed = Math.max(1, finiteNumber(this.config.baseSpeedMultiplier, 1.2));
      value /= baseSpeed;
      const def = machineDef(ctx, ctx.machine);
      const isOceanMachine = !!(def && Array.isArray(def.tags) && def.tags.includes("ocean_machine"));
      const clock = finiteNumber(ctx.mechanicStateFor(this.id).clock, 0);
      const until = finiteNumber(ctx.mechanicStateFor(this.id).currentUntil, 0);
      if (isOceanMachine && clock < until) value /= Math.max(1, finiteNumber(this.config.currentSpeedMultiplier, 1.5));
      return value;
    }

  }

  class OceanMachineSystems extends G.Zone.ZoneMechanic {
    onMachinePlaced(ctx) {
      const record = stateRecord(ctx, ctx.floor, ctx.slot);
      if (!record) return;
      const def = machineDef(ctx, ctx.machine);
      if (!def) return;
      record.cycles = 0;
      record.resonanceStacks = 0;
      record.burstActive = false;
    }

    onBeforeMachineCycle(ctx) {
      const def = machineDef(ctx, ctx.machine);
      const record = stateRecord(ctx, ctx.floor, ctx.slot);
      if (!def || !record) return true;

      if (def.tags && def.tags.includes("pressure_burst")) {
        const every = Math.max(1, Math.floor(finiteNumber(this.config.abyssalBurstEveryCycles, 8)));
        const nextCycle = Math.max(0, Math.floor(finiteNumber(record.cycles, 0))) + 1;
        record.burstActive = nextCycle % every === 0;
      }
      return true;
    }

    modifyProduction(ctx, multiplier) {
      const def = machineDef(ctx, ctx.machine);
      const record = stateRecord(ctx, ctx.floor, ctx.slot);
      if (!def || !record) return multiplier;

      if (def.tags && def.tags.includes("pressure_burst") && record.burstActive) {
        return multiplier * Math.max(1, finiteNumber(this.config.abyssalBurstMultiplier, 2.75));
      }

      if (def.tags && def.tags.includes("tidal_resonance")) {
        const stacks = Math.max(0, Math.floor(finiteNumber(record.resonanceStacks, 0)));
        const perStack = Math.max(0, finiteNumber(this.config.leviathanResonancePerStack, 0.07));
        return multiplier * (1 + stacks * perStack);
      }

      return multiplier;
    }

    onMachineCycle(ctx) {
      const def = machineDef(ctx, ctx.machine);
      const record = stateRecord(ctx, ctx.floor, ctx.slot);
      if (!def || !record) return;

      record.cycles = Math.max(0, Math.floor(finiteNumber(record.cycles, 0))) + 1;
      record.burstActive = false;

      if (def.tags && def.tags.includes("tidal_resonance")) {
        const startAt = Math.max(1, Math.floor(finiteNumber(this.config.leviathanResonanceStartCycle, 5)));
        const maxStacks = Math.max(0, Math.floor(finiteNumber(this.config.leviathanResonanceMaxStacks, 5)));
        if (record.cycles >= startAt) record.resonanceStacks = Math.min(maxStacks, Math.max(0, Math.floor(finiteNumber(record.resonanceStacks, 0))) + 1);
      }
    }

    onGameEvent(ctx, event) {
      if (!event || event.type !== "oceanWaterInfected") return;
      const def = machineDef(ctx, { typeId: event.machineId });
      if (!def || !def.tags || !def.tags.includes("tidal_resonance")) return;
      const key = slotKey({ id: event.floorId }, { r: event.r, c: event.c });
      if (!key) return;
      const root = ctx.mechanicStateFor(this.id);
      const record = root.machines && root.machines[key];
      if (!record) return;
      record.cycles = 0;
      record.resonanceStacks = 0;
      record.burstActive = false;
    }


  }

  class OceanStrandedFish extends G.Zone.ZoneMechanic {
    isDiscovered(ctx) {
      const discoveries = ctx && ctx.zoneState && Array.isArray(ctx.zoneState.mechanicDiscoveries)
        ? ctx.zoneState.mechanicDiscoveries : [];
      return discoveries.includes(this.id);
    }

    speciesList() {
      return Array.isArray(this.config.species) ? this.config.species : [];
    }

    speciesById(id) {
      return this.speciesList().find((species) => species && species.id === id) || null;
    }

    stateRoot(ctx) {
      const source = ctx && ctx.mechanics ? ctx.mechanics[this.id] : null;
      const root = ctx && (ctx.mode === "query" || ctx.mode === "ui")
        ? cloneJson(source || {})
        : ctx.mechanicStateFor(this.id);
      if (!root.machines || typeof root.machines !== "object" || Array.isArray(root.machines)) root.machines = {};
      root.clock = Math.max(0, finiteNumber(root.clock, 0));
      root.fishCaught = Math.max(0, Math.floor(finiteNumber(root.fishCaught, 0)));
      root.fishSpawned = Math.max(0, Math.floor(finiteNumber(root.fishSpawned, 0)));
      return root;
    }

    occupiedMachines(ctx) {
      const out = [];
      const floors = ctx.zone && Array.isArray(ctx.zone.floors) ? ctx.zone.floors : [];
      floors.forEach((floor) => {
        if (!floor || !floor.unlocked || !Array.isArray(floor.grid)) return;
        floor.grid.forEach((slot) => {
          if (slot && slot.machine) out.push({ floor, slot, key: slotKey(floor, slot) });
        });
      });
      return out;
    }

    pickSpecies() {
      const species = this.speciesList().filter((item) => item && Number(item.weight) > 0);
      const total = species.reduce((sum, item) => sum + Number(item.weight || 0), 0);
      if (!species.length || total <= 0) return null;
      let roll = Math.random() * total;
      for (const item of species) {
        roll -= Number(item.weight || 0);
        if (roll <= 0) return item;
      }
      return species[species.length - 1];
    }

    machineFish(root, key) {
      return root.machines[key] || null;
    }

    activeFishEntries(root) {
      return Object.entries(root.machines).filter(([, record]) => record && record.fish);
    }

    chooseSpawnTarget(root, requested) {
      if (!requested || !requested.key || !requested.floor || !requested.slot) return null;
      if (!this.machineFish(root, requested.key)) return requested;
      // A second hit on an already occupied machine gets rerouted to a random
      // eligible machine, preserving the user's "random machine" rule.
      return requested.alternatives.length
        ? requested.alternatives[Math.floor(Math.random() * requested.alternatives.length)]
        : null;
    }

    spawnFish(ctx, requested) {
      const root = this.stateRoot(ctx);
      const maxConcurrent = Math.max(1, Math.floor(finiteNumber(this.config.maxConcurrentFish, 5)));
      if (this.activeFishEntries(root).length >= maxConcurrent) return false;
      const species = this.pickSpecies();
      if (!species) return false;

      const target = this.chooseSpawnTarget(root, requested);
      if (!target) return false;
      const duration = Math.max(0.1, finiteNumber(species.durationSeconds, 7.5));
      const seed = Math.random();
      root.machines[target.key] = {
        fish: {
          speciesId: species.id,
          floorId: target.floor.id,
          r: target.slot.r,
          c: target.slot.c,
          spawnedAt: root.clock,
          expiresAt: root.clock + duration,
          autoCatchAt: 0,
          seed,
        }
      };
      root.fishSpawned += 1;
      this.emit(ctx, "oceanFishSpawned", {
        floorId: target.floor.id,
        r: target.slot.r,
        c: target.slot.c,
        speciesId: species.id,
      });
      return true;
    }

    catchFish(ctx, key, reason) {
      const root = this.stateRoot(ctx);
      const record = root.machines[key];
      const fish = record && record.fish;
      if (!fish) return false;
      const species = this.speciesById(fish.speciesId);
      if (!species) {
        delete root.machines[key];
        return false;
      }
      const entries = this.occupiedMachines(ctx).filter((entry) => entry.key === key);
      const entry = entries[0] || (ctx.floor && ctx.slot ? { floor: ctx.floor, slot: ctx.slot, key } : null);
      delete root.machines[key];
      root.fishCaught += 1;
      const reward = Math.max(0, finiteNumber(species.reward, 0));
      if (reward > 0 && ctx.rewardCash) ctx.rewardCash(reward, "oceanFish");
      if (entry) {
        this.emit(ctx, "oceanFishCaught", {
          floorId: entry.floor.id,
          r: entry.slot.r,
          c: entry.slot.c,
          speciesId: species.id,
          amount: reward,
          automatic: reason === "auto",
        });
      }
      return true;
    }

    onBeforeZoneTick(ctx) {
      if (!this.isDiscovered(ctx)) return;
      const root = this.stateRoot(ctx);
      const dt = Math.max(0, finiteNumber(ctx.dt, 0));
      root.clock += dt;
      const now = root.clock;
      const autoEnabled = !!(ctx.zoneState && ctx.zoneState.variables && ctx.zoneState.variables.fishCatcherEnabled);
      const autoDelay = Math.max(0.1, finiteNumber(this.config.autoCatchDelaySeconds, 1.1));

      // Resolve active fish in one deterministic pass. Expiry wins over auto
      // catch when both deadlines have been crossed in the same frame.
      Object.entries(root.machines).forEach(([key, record]) => {
        const fish = record && record.fish;
        if (!fish) return;
        if (autoEnabled && !(finiteNumber(fish.autoCatchAt, 0) > 0)) fish.autoCatchAt = now + autoDelay;
        if (now >= finiteNumber(fish.expiresAt, 0)) {
          delete root.machines[key];
          return;
        }
        if (autoEnabled && now >= finiteNumber(fish.autoCatchAt, Infinity)) this.catchFish(ctx, key, "auto");
      });

      const machines = this.occupiedMachines(ctx);
      if (!machines.length) return;
      const activeKeys = new Set(this.activeFishEntries(root).map(([key]) => key));
      const candidates = machines.filter((entry) => !activeKeys.has(entry.key));
      const perSecond = Math.max(0, Math.min(0.25, finiteNumber(this.config.spawnChancePerSecond, 0.004)));
      const chance = 1 - Math.pow(1 - perSecond, dt);
      if (chance <= 0) return;

      for (const machine of machines) {
        // Every machine rolls independently. If its own slot is occupied, the
        // spawn attempt is redirected to a random unoccupied machine.
        if (Math.random() >= chance) continue;
        const alternatives = candidates.filter((entry) => entry.key !== machine.key && !activeKeys.has(entry.key));
        this.spawnFish(ctx, { floor: machine.floor, slot: machine.slot, key: machine.key, alternatives });
        const liveKeys = new Set(this.activeFishEntries(root).map(([key]) => key));
        candidates.splice(0, candidates.length, ...machines.filter((entry) => !liveKeys.has(entry.key)));
      }
    }

    onMachineCollected(ctx) {
      if (!this.isDiscovered(ctx) || ctx.automatic || !ctx.slot || !ctx.floor) return;
      const root = this.stateRoot(ctx);
      const key = slotKey(ctx.floor, ctx.slot);
      if (key) this.catchFish(ctx, key, "manual");
    }

    getUIState(ctx) {
      if (!this.isDiscovered(ctx)) return null;
      const root = this.stateRoot(ctx);
      const floor = ctx.floor;
      if (!floor) return null;
      const currentNow = root.clock;
      const machineDecorations = [];
      Object.entries(root.machines).forEach(([key, record]) => {
        const fish = record && record.fish;
        if (!fish) return;
        const parsed = parseSlotKey(key);
        const floorId = typeof fish.floorId === "string" ? fish.floorId : parsed && parsed.floorId;
        const r = Number.isInteger(Number(fish.r)) ? Number(fish.r) : parsed && parsed.r;
        const c = Number.isInteger(Number(fish.c)) ? Number(fish.c) : parsed && parsed.c;
        if (floorId !== floor.id || !Number.isInteger(r) || !Number.isInteger(c)) return;
        const species = this.speciesById(fish.speciesId);
        if (!species) return;
        const duration = Math.max(0.1, finiteNumber(species.durationSeconds, 7.5));
        const remaining = Math.max(0, finiteNumber(fish.expiresAt, currentNow) - currentNow);
        const catching = !!(ctx.zoneState && ctx.zoneState.variables && ctx.zoneState.variables.fishCatcherEnabled && currentNow < finiteNumber(fish.autoCatchAt, Infinity) && finiteNumber(fish.autoCatchAt, Infinity) - currentNow < Math.max(0.2, finiteNumber(this.config.autoCatchDelaySeconds, 1.1)));
        machineDecorations.push({
          floorId, r, c,
          decorationId: "stranded_fish",
          visual: "fish",
          variant: species.id,
          state: catching ? "auto-catching" : "flopping",
          seed: finiteNumber(fish.seed, 0.5),
          remaining,
          duration,
        });
      });
      return { machineDecorations };
    }

  }


  G.Zone.registerMechanic("ocean.waterExposure", OceanWaterExposure);
  G.Zone.registerMechanic("ocean.coldCurrents", OceanColdCurrents);
  G.Zone.registerMechanic("ocean.machineSystems", OceanMachineSystems);
  G.Zone.registerMechanic("ocean.strandedFish", OceanStrandedFish);
})(window.Game = window.Game || {});
