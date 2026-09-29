
/* ============================================================
   04-zone-framework.js — Zone Core.

   Boundary rules:
   - Zone content is declared in content/zones.json.
   - Every Zone owns one or more JavaScript mechanics.
   - Zone machines are unlocked in their home Zone and may only be placed
     in that Zone or a later Zone.
   - Secrets and requirements are data-driven.
   - Gameplay core talks to this file through small adapters only.
   - A broken mechanic is quarantined instead of crashing the factory.
   ============================================================ */
(function (G) {
  "use strict";

  const D = G.DATA;
  const INTERNAL = Object.freeze({
    MAX_MECHANIC_EVENTS_PER_FRAME: 128,
    MAX_MECHANIC_UI_EVENTS_PER_FRAME: 8,
    MAX_MECHANIC_UI_ITEMS: 96,
    MAX_MECHANIC_UI_TEXT_LENGTH: 120,
    MAX_SECRET_REWARD_AMOUNT: Number.MAX_VALUE,
    MAX_PATH_DEPTH: 8,
  });

  const MECHANIC_UI_VARIANTS = new Set(["disabled", "buff", "warning", "info"]);
  const MECHANIC_UI_TONES = new Set(["info", "good", "warn", "danger", "muted"]);
  const MECHANIC_DECORATION_TYPES = new Set(["fish"]);

  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function cloneJson(value) { try { return JSON.parse(JSON.stringify(value)); } catch (_e) { return {}; } }
  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key]));
    return Object.freeze(value);
  }

  function isSafePathPart(part) {
    return /^[A-Za-z0-9_$-]+$/.test(part) && part !== "__proto__" && part !== "prototype" && part !== "constructor";
  }

  function normalizePath(path) {
    if (typeof path !== "string" || !path.trim()) return null;
    const parts = path.split(".");
    if (!parts.length || parts.length > INTERNAL.MAX_PATH_DEPTH || parts.some((part) => !isSafePathPart(part))) return null;
    return parts;
  }

  function readPath(root, path, fallback) {
    if (!root) return fallback;
    const parts = normalizePath(path);
    if (!parts) return fallback;
    let cur = root;
    for (const part of parts) {
      if (!cur || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, part)) return fallback;
      cur = cur[part];
    }
    return cur;
  }

  function writePath(root, path, value) {
    if (!root) return false;
    const parts = normalizePath(path);
    if (!parts) return false;
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!isPlainObject(cur[key])) cur[key] = {};
      cur = cur[key];
    }
    cur[parts[parts.length - 1]] = cloneJson(value);
    return true;
  }

  function clampMultiplier(value, fallback) {
    return Number.isFinite(value) ? Math.max(0, value) : fallback;
  }

  function countMechanicEvents(events) {
    if (!Array.isArray(events)) return 0;
    let count = 0;
    for (const event of events) if (event && event.__zoneMechanicEvent === true) count++;
    return count;
  }

  function emitSafeEvent(events, type, payload) {
    if (!Array.isArray(events) || countMechanicEvents(events) >= INTERNAL.MAX_MECHANIC_EVENTS_PER_FRAME) return false;
    const event = Object.assign({}, payload || {});
    event.type = type;
    event.__zoneMechanicEvent = true;
    events.push(event);
    return true;
  }

  function boundedUiString(value, fallback = "") {
    if (typeof value !== "string") return fallback;
    const text = value.trim();
    return text.length > INTERNAL.MAX_MECHANIC_UI_TEXT_LENGTH ? text.slice(0, INTERNAL.MAX_MECHANIC_UI_TEXT_LENGTH) : text;
  }

  function normalizeMechanicUiEvent(zoneId, mechanicId, spec) {
    if (!isPlainObject(spec) || spec.kind !== "banner") return null;
    const id = boundedUiString(spec.id);
    const labelKey = boundedUiString(spec.labelKey);
    if (!id || !labelKey) return null;
    const tone = MECHANIC_UI_TONES.has(spec.tone) ? spec.tone : "info";
    const durationMs = Math.max(500, Math.min(5000, Number(spec.durationMs) || 2200));
    const cooldownMs = Math.max(0, Math.min(15000, Number(spec.cooldownMs) || 0));
    const priority = Math.max(0, Math.min(100, Math.floor(Number(spec.priority) || 0)));
    const out = {
      type: "zoneMechanicUi",
      kind: "banner",
      zoneId,
      mechanicId,
      id,
      labelKey,
      tone,
      durationMs,
      cooldownMs,
      priority,
    };
    const detailKey = boundedUiString(spec.detailKey);
    if (detailKey) out.detailKey = detailKey;
    const icon = boundedUiString(spec.icon);
    if (icon) out.icon = icon;
    if (typeof spec.value === "number" && Number.isFinite(spec.value)) out.value = spec.value;
    else if (typeof spec.value === "string") out.value = boundedUiString(spec.value);
    const valueUnit = boundedUiString(spec.valueUnit);
    if (valueUnit) out.valueUnit = valueUnit;
    return out;
  }

  function emitMechanicUiSafe(events, zoneId, mechanicId, spec) {
    if (!Array.isArray(events)) return false;
    const count = events.reduce((n, event) => n + (event && event.type === "zoneMechanicUi" ? 1 : 0), 0);
    if (count >= INTERNAL.MAX_MECHANIC_UI_EVENTS_PER_FRAME) return false;
    const normalized = normalizeMechanicUiEvent(zoneId, mechanicId, spec);
    if (!normalized) return false;
    events.push(normalized);
    return true;
  }

  function normalizeMechanicUiState(raw, zoneId) {
    const out = { machineStatuses: [], machineDecorations: [], zoneIndicators: [] };
    if (!isPlainObject(raw)) return out;

    const machineStatuses = Array.isArray(raw.machineStatuses) ? raw.machineStatuses : [];
    machineStatuses.slice(0, INTERNAL.MAX_MECHANIC_UI_ITEMS).forEach((item) => {
      if (!isPlainObject(item)) return;
      const floorId = boundedUiString(item.floorId);
      const labelKey = boundedUiString(item.labelKey);
      const statusId = boundedUiString(item.statusId);
      const r = Number(item.r), c = Number(item.c);
      if (!floorId || !labelKey || !statusId || !Number.isInteger(r) || !Number.isInteger(c)) return;
      const variant = MECHANIC_UI_VARIANTS.has(item.variant) ? item.variant : "info";
      const tone = MECHANIC_UI_TONES.has(item.tone) ? item.tone : "info";
      const entry = { floorId, r, c, statusId, variant, tone, labelKey };
      const detailKey = boundedUiString(item.detailKey); if (detailKey) entry.detailKey = detailKey;
      const icon = boundedUiString(item.icon); if (icon) entry.icon = icon;
      if (Number.isFinite(Number(item.progress))) entry.progress = Math.max(0, Math.min(1, Number(item.progress)));
      if (Number.isFinite(Number(item.value))) entry.value = Number(item.value);
      else if (typeof item.value === "string") entry.value = boundedUiString(item.value);
      const valueUnit = boundedUiString(item.valueUnit); if (valueUnit) entry.valueUnit = valueUnit;
      if (item.priority !== undefined) entry.priority = Math.max(0, Math.min(100, Math.floor(Number(item.priority) || 0)));
      out.machineStatuses.push(entry);
    });

    const machineDecorations = Array.isArray(raw.machineDecorations) ? raw.machineDecorations : [];
    machineDecorations.slice(0, INTERNAL.MAX_MECHANIC_UI_ITEMS).forEach((item) => {
      if (!isPlainObject(item)) return;
      const floorId = boundedUiString(item.floorId);
      const decorationId = boundedUiString(item.decorationId);
      const visual = boundedUiString(item.visual);
      const variant = boundedUiString(item.variant);
      const state = boundedUiString(item.state);
      const r = Number(item.r), c = Number(item.c);
      if (!floorId || !decorationId || !MECHANIC_DECORATION_TYPES.has(visual) || !variant || !Number.isInteger(r) || !Number.isInteger(c)) return;
      const entry = { floorId, r, c, decorationId, visual, variant };
      if (state) entry.state = state;
      if (Number.isFinite(Number(item.seed))) entry.seed = Math.max(0, Math.min(1, Number(item.seed)));
      if (Number.isFinite(Number(item.remaining))) entry.remaining = Math.max(0, Number(item.remaining));
      if (Number.isFinite(Number(item.duration))) entry.duration = Math.max(0.1, Number(item.duration));
      out.machineDecorations.push(entry);
    });

    const zoneIndicators = Array.isArray(raw.zoneIndicators) ? raw.zoneIndicators : [];
    zoneIndicators.slice(0, INTERNAL.MAX_MECHANIC_UI_ITEMS).forEach((item) => {
      if (!isPlainObject(item)) return;
      const id = boundedUiString(item.id);
      const labelKey = boundedUiString(item.labelKey);
      if (!id || !labelKey) return;
      const entry = { id, labelKey, tone: MECHANIC_UI_TONES.has(item.tone) ? item.tone : "info", priority: Math.max(0, Math.min(100, Math.floor(Number(item.priority) || 0))) };
      const detailKey = boundedUiString(item.detailKey); if (detailKey) entry.detailKey = detailKey;
      const icon = boundedUiString(item.icon); if (icon) entry.icon = icon;
      if (Number.isFinite(Number(item.progress))) entry.progress = Math.max(0, Math.min(1, Number(item.progress)));
      if (Number.isFinite(Number(item.value))) entry.value = Number(item.value);
      else if (typeof item.value === "string") entry.value = boundedUiString(item.value);
      const valueUnit = boundedUiString(item.valueUnit); if (valueUnit) entry.valueUnit = valueUnit;
      out.zoneIndicators.push(entry);
    });

    return out;
  }

  // JavaScript has no native interface keyword. This abstract contract is the
  // stable public shape implemented by all Zone mechanics.
  class ZoneMechanicContract {
    constructor(def) {
      if (new.target === ZoneMechanicContract) throw new Error("ZoneMechanicContract is abstract");
      if (!def || typeof def.id !== "string" || !def.id) throw new Error("Zone mechanic id is required");
      this.id = def.id;
      this.script = def.script || null;
      this.config = deepFreeze(cloneJson(isPlainObject(def.config) ? def.config : {}));
    }
    onAttach(_ctx) {}
    onZoneUnlocked(_ctx) {}
    onBeforeZoneTick(_ctx) {}
    onBeforeTick(_ctx) {}
    onBeforeMachineCycle(_ctx) {}
    modifyProduction(_ctx, multiplier) { return multiplier; }
    modifyCooldown(_ctx, cooldown) { return cooldown; }
    onMachineCycle(_ctx, _result) {}
    onMachinePlaced(_ctx) {}
    onMachineCollected(_ctx, _amount) {}
    onAfterTick(_ctx) {}
    onAfterZoneTick(_ctx) {}
    onGameEvent(_ctx, _event) {}
    onCheckSecrets(_ctx) {}
    getUIState(_ctx) { return null; }
  }

  class ZoneMechanic extends ZoneMechanicContract {
    state(ctx, path, fallback) { return readPath(ctx && ctx.mechanicStateFor(this.id), path, fallback); }
    setState(ctx, path, value) { if (ctx && (ctx.mode === "ui" || ctx.mode === "query")) return false; return writePath(ctx && ctx.mechanicStateFor(this.id), path, value); }
    variable(ctx, path, fallback) { return readPath(ctx && ctx.zoneVariables, path, fallback); }
    setVariable(ctx, path, value) { if (ctx && (ctx.mode === "ui" || ctx.mode === "query")) return false; return writePath(ctx && ctx.zoneVariables, path, value); }
    addVariable(ctx, path, delta, fallback) {
      const current = Number(this.variable(ctx, path, fallback == null ? 0 : fallback));
      if (ctx && (ctx.mode === "ui" || ctx.mode === "query")) return Number.isFinite(current) ? current : 0;
      const next = (Number.isFinite(current) ? current : 0) + (Number.isFinite(delta) ? delta : 0);
      this.setVariable(ctx, path, next);
      return next;
    }
    addState(ctx, path, delta, fallback) {
      const current = Number(this.state(ctx, path, fallback == null ? 0 : fallback));
      if (ctx && (ctx.mode === "ui" || ctx.mode === "query")) return Number.isFinite(current) ? current : 0;
      const next = (Number.isFinite(current) ? current : 0) + (Number.isFinite(delta) ? delta : 0);
      this.setState(ctx, path, next);
      return next;
    }
    emit(ctx, type, payload) { return ctx && typeof ctx.emit === "function" ? ctx.emit(type, payload) : false; }
    emitUI(ctx, spec) { return ctx && typeof ctx.emitUI === "function" ? ctx.emitUI(spec) : false; }
    discover(ctx, secretId) { return ctx && typeof ctx.discoverSecret === "function" ? ctx.discoverSecret(secretId) : false; }
    hasTag(machine, tag) { return !!(machine && Array.isArray(machine.tags) && machine.tags.includes(tag)); }
  }

  const mechanicRegistry = new Map();
  const runtimeByZoneState = new WeakMap();

  const CONTRACT_METHODS = [
    "onAttach", "onZoneUnlocked", "onBeforeZoneTick", "onBeforeTick", "onBeforeMachineCycle",
    "modifyProduction", "modifyCooldown", "onMachineCycle", "onMachinePlaced", "onMachineCollected",
    "onAfterTick", "onAfterZoneTick", "onGameEvent", "onCheckSecrets", "getUIState",
  ];

  function validateMechanicClass(MechanicClass) {
    if (typeof MechanicClass !== "function") throw new Error("Zone mechanic must be a class/constructor");
    if (!(MechanicClass.prototype instanceof ZoneMechanicContract)) throw new Error("Zone mechanic must extend ZoneMechanicContract");
    CONTRACT_METHODS.forEach((name) => {
      if (typeof MechanicClass.prototype[name] !== "function") throw new Error("Zone mechanic missing contract method: " + name);
    });
  }

  function registerMechanic(scriptId, MechanicClass) {
    if (typeof scriptId !== "string" || !scriptId.trim()) throw new Error("Zone mechanic script id is required");
    validateMechanicClass(MechanicClass);
    const existing = mechanicRegistry.get(scriptId);
    if (existing && existing !== MechanicClass) throw new Error("Zone mechanic script id already registered: " + scriptId);
    mechanicRegistry.set(scriptId, MechanicClass);
  }

  function getZoneDef(zoneId) { return D.zoneById(zoneId); }
  function getZoneState(state, zoneId) { return state && Array.isArray(state.zones) ? state.zones.find((z) => z.id === zoneId) : null; }

  function ensureZoneContainers(zoneState, zoneDef) {
    if (!zoneState || !zoneDef) return;
    if (!isPlainObject(zoneState.mechanicState)) zoneState.mechanicState = {};
    if (!isPlainObject(zoneState.variables)) zoneState.variables = cloneJson(zoneDef.variables || {});
    if (!isPlainObject(zoneState.upgrades)) zoneState.upgrades = {};
    if (!isPlainObject(zoneState.purchases)) zoneState.purchases = {};
    if (!Array.isArray(zoneState.secrets)) zoneState.secrets = [];
    if (!Array.isArray(zoneState.mechanicDiscoveries)) zoneState.mechanicDiscoveries = [];
    if (!Array.isArray(zoneState.unlockedMachineIds)) zoneState.unlockedMachineIds = [];
    if (!isPlainObject(zoneState.stats)) zoneState.stats = {};

    // Content variables are the data-driven contract between Zone JSON and
    // Zone mechanic JS. Missing declared variables are restored from content.
    const declaredVariables = isPlainObject(zoneDef.variables) ? zoneDef.variables : {};
    Object.keys(declaredVariables).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(zoneState.variables, key)) zoneState.variables[key] = cloneJson(declaredVariables[key]);
    });

    (zoneDef.mechanics || []).forEach((def) => {
      if (!def || typeof def.id !== "string") return;
      if (!Object.prototype.hasOwnProperty.call(zoneState.mechanicState, def.id)) {
        zoneState.mechanicState[def.id] = isPlainObject(def.initialState) || Array.isArray(def.initialState) ? cloneJson(def.initialState) : {};
      }
    });

    const validSecrets = new Set((zoneDef.secrets || []).map((s) => s && s.id).filter(Boolean));
    zoneState.secrets = [...new Set(zoneState.secrets.filter((id) => validSecrets.has(id)))];
    const validHiddenMechanics = new Set((zoneDef.mechanics || []).filter((m) => m && m.visibility && m.visibility.hidden === true).map((m) => m.id));
    zoneState.mechanicDiscoveries = [...new Set(zoneState.mechanicDiscoveries.filter((id) => validHiddenMechanics.has(id)))];

    const validMachines = new Set((zoneDef.machines || []).map((m) => m && m.id).filter(Boolean));
    zoneState.unlockedMachineIds = [...new Set(zoneState.unlockedMachineIds.filter((id) => validMachines.has(id)))];

    const upgradeDefs = new Map((zoneDef.upgrades || []).map((item) => [item.id, item]));
    Object.keys(zoneState.upgrades).forEach((id) => {
      const def = upgradeDefs.get(id);
      const value = zoneState.upgrades[id];
      if (!def || !Number.isFinite(Number(value))) { delete zoneState.upgrades[id]; return; }
      const maxLevel = Math.max(1, Math.floor(Number(def.maxLevel) || 1));
      zoneState.upgrades[id] = Math.max(0, Math.min(maxLevel, Math.floor(Number(value))));
    });

    const purchaseIds = new Set((zoneDef.purchases || []).map((item) => item && item.id).filter(Boolean));
    Object.keys(zoneState.purchases).forEach((id) => {
      if (!purchaseIds.has(id) || zoneState.purchases[id] !== true) delete zoneState.purchases[id];
    });
  }

  function buildUiStateSnapshot(state) {
    return deepFreeze(cloneJson(state || {}));
  }

  function buildUiZoneDef(zoneDef) {
    return deepFreeze(cloneJson(zoneDef || {}));
  }

  function buildUiZoneStateSnapshot(state, zoneId) {
    const snapshot = cloneJson(getZoneState(state, zoneId) || {});
    return deepFreeze(snapshot);
  }

  function buildUiGameView() {
    const data = D || {};
    const cloneDef = (fn, arg) => {
      try { return deepFreeze(cloneJson(typeof fn === "function" ? fn(arg) : null)); } catch (_e) { return null; }
    };
    return Object.freeze({
      DATA: Object.freeze({
        machineById: (id) => cloneDef(data.machineById, id),
        tierById: (id) => cloneDef(data.tierById, id),
        zoneById: (id) => cloneDef(data.zoneById, id),
        floorById: (zoneId, floorId) => {
          try { return deepFreeze(cloneJson(typeof data.floorById === "function" ? data.floorById(zoneId, floorId) : null)); } catch (_e) { return null; }
        },
      }),
    });
  }

  function buildMechanicGameView(state) {
    const data = D || {};
    const cloneDef = (fn, args) => {
      try { return deepFreeze(cloneJson(typeof fn === "function" ? fn(...args) : null)); } catch (_e) { return null; }
    };
    return Object.freeze({
      DATA: Object.freeze({
        machineById: (id) => cloneDef(data.machineById, [id]),
        tierById: (id) => cloneDef(data.tierById, [id]),
        zoneById: (id) => cloneDef(data.zoneById, [id]),
        floorById: (zoneId, floorId) => cloneDef(data.floorById, [zoneId, floorId]),
      }),
      Econ: Object.freeze({
        machineCooldown: (machine) => G.Econ && typeof G.Econ.machineCooldown === "function" ? G.Econ.machineCooldown(machine, state) : null,
        machineBaseYield: (machine, floorMult) => G.Econ && typeof G.Econ.machineBaseYield === "function" ? G.Econ.machineBaseYield(machine, floorMult, state) : null,
        machineCritChance: (machine) => G.Econ && typeof G.Econ.machineCritChance === "function" ? G.Econ.machineCritChance(machine, state) : null,
        tierUnlocked: (tierId) => G.Econ && typeof G.Econ.tierUnlocked === "function" ? G.Econ.tierUnlocked(state, tierId) : false,
      }),
    });
  }

  function isMechanicUiVisible(zoneDef, zoneState, mechanicId) {
    const def = (zoneDef && zoneDef.mechanics || []).find((m) => m && m.id === mechanicId);
    if (!def || !def.visibility || def.visibility.hidden !== true) return true;
    return !!(zoneState && Array.isArray(zoneState.mechanicDiscoveries) && zoneState.mechanicDiscoveries.includes(mechanicId));
  }

  class ZoneRuntime {
    constructor(state, zoneDef, zoneState) {
      this.state = state;
      this.zoneDef = zoneDef;
      this.zoneState = zoneState;
      this.instances = new Map();
      this.disabled = new Set();
      ensureZoneContainers(zoneState, zoneDef);
    }

    defs() { return Array.isArray(this.zoneDef.mechanics) ? this.zoneDef.mechanics : []; }

    instanceFor(def) {
      if (!def || def.enabled === false || !def.script || this.disabled.has(def.id)) return null;
      if (this.instances.has(def.id)) return this.instances.get(def.id);
      const MechanicClass = mechanicRegistry.get(def.script);
      if (!MechanicClass) return null;
      try {
        validateMechanicClass(MechanicClass);
        const instance = new MechanicClass(def);
        this.instances.set(def.id, instance);
        const attached = this.call(instance, "onAttach", this.context(instance, { mode: "attach" }));
        if (attached === false) {
          this.disable(def.id, new Error("Mechanic rejected attachment"));
          return null;
        }
        return instance;
      } catch (error) {
        this.disable(def.id, error);
        return null;
      }
    }

    disable(mechanicId, error) {
      this.disabled.add(mechanicId);
      if (error) console.error("Zone mechanic quarantined:", this.zoneDef.id, mechanicId, error);
    }

    uiContext(mechanic, uiSnapshot, floorId, calculationState) {
      const snapshot = uiSnapshot || buildUiStateSnapshot(this.state);
      const calcState = calculationState || cloneJson(this.state);
      const zoneState = (snapshot.zones || []).find((z) => z && z.id === this.zoneDef.id) || {};
      const floor = (zoneState.floors || []).find((item) => item && item.id === floorId) || null;
      const mechanics = zoneState.mechanicState || {};
      const variables = zoneState.variables || {};
      const zoneDefSnapshot = buildUiZoneDef(this.zoneDef);
      return Object.freeze({
        game: buildUiGameView(),
        state: snapshot,
        zoneId: this.zoneDef.id,
        zoneDef: zoneDefSnapshot,
        zoneState: zoneState,
        zone: zoneState,
        floor,
        floorId,
        zoneVariables: variables,
        mechanic,
        mechanics,
        mechanicStateFor: (id) => mechanics[id] || deepFreeze({}),
        discoverSecret: () => false,
        rewardCash: () => false,
        emit: () => false,
        emitUI: () => false,
        requirementValue: (req) => requirementValue(calcState, req, this.zoneDef.id),
        requirementMet: (req) => requirementMet(calcState, req, this.zoneDef.id),
        requirementsMet: (reqs) => requirementsMet(calcState, reqs, this.zoneDef.id),
        machineUnlocked: (machineId) => isMachineUnlocked(calcState, machineId),
        canPlaceMachine: (machineId, targetZoneId) => canPlaceMachineInZone(calcState, machineId, targetZoneId || this.zoneDef.id),
        mode: "ui",
      });
    }

    context(mechanic, extra) {
      return Object.assign({
        game: buildMechanicGameView(this.state),
        state: this.state,
        zoneId: this.zoneDef.id,
        zoneDef: this.zoneDef,
        zoneState: this.zoneState,
        zoneVariables: this.zoneState.variables,
        mechanic,
        mechanics: this.zoneState.mechanicState,
        mechanicStateFor: (id) => {
          if (!isPlainObject(this.zoneState.mechanicState[id]) && !Array.isArray(this.zoneState.mechanicState[id])) this.zoneState.mechanicState[id] = {};
          return this.zoneState.mechanicState[id];
        },
        discoverSecret: (secretId) => discoverSecret(this.state, this.zoneDef.id, secretId, extra && extra.events),
        rewardCash: (amount, _reason) => {
          const value = Number(amount);
          if (!Number.isFinite(value) || value <= 0 || !G.Factory || typeof G.Factory.grantMoney !== "function") return false;
          G.Factory.grantMoney(this.state, value);
          return true;
        },
        emit: (type, payload) => emitSafeEvent(extra && extra.events, type, Object.assign({ zoneId: this.zoneDef.id }, payload || {})),
        emitUI: (spec) => isMechanicUiVisible(this.zoneDef, this.zoneState, mechanic.id)
          ? emitMechanicUiSafe(extra && extra.events, this.zoneDef.id, mechanic.id, spec)
          : false,
        requirementValue: (req) => requirementValue(this.state, req, this.zoneDef.id),
        requirementMet: (req) => requirementMet(this.state, req, this.zoneDef.id),
        requirementsMet: (reqs) => requirementsMet(this.state, reqs, this.zoneDef.id),
        machineUnlocked: (machineId) => isMachineUnlocked(this.state, machineId),
        canPlaceMachine: (machineId, targetZoneId) => canPlaceMachineInZone(this.state, machineId, targetZoneId || this.zoneDef.id),
      }, extra || {});
    }

    call(instance, method, ctx, args) {
      if (!instance || this.disabled.has(instance.id)) return undefined;
      try { return instance[method](ctx, ...(args || [])); }
      catch (error) { this.disable(instance.id, error); return undefined; }
    }

    callUi(instance, ctx) {
      if (!instance || this.disabled.has(instance.id)) return undefined;
      try {
        const uiInstance = Object.create(Object.getPrototypeOf(instance));
        Object.getOwnPropertyNames(instance).forEach((key) => { uiInstance[key] = instance[key]; });
        Object.freeze(uiInstance);
        return instance.getUIState.call(uiInstance, ctx);
      } catch (error) {
        console.error("Zone mechanic UI failed:", this.zoneDef.id, instance.id, error);
        return undefined;
      }
    }

    forEach(fn, extra) {
      for (const def of this.defs()) {
        if (!def || def.enabled === false || this.disabled.has(def.id)) continue;
        const instance = this.instanceFor(def);
        if (!instance) continue;
        const ctx = this.context(instance, extra);
        try { fn(instance, ctx); } catch (error) { this.disable(instance.id, error); }
      }
    }

    diagnostics() {
      const missingScripts = [];
      const configurationErrors = [];
      if (this.defs().length < 1) configurationErrors.push("Zone must declare at least one JavaScript mechanic");
      this.defs().forEach((def) => {
        if (!def || def.enabled === false || !def.script || mechanicRegistry.has(def.script)) return;
        missingScripts.push({ mechanicId: def.id, script: def.script });
      });
      return { zoneId: this.zoneDef.id, missingScripts, disabledMechanics: [...this.disabled], configurationErrors };
    }
  }

  function getRuntime(state, zoneId) {
    const zoneDef = getZoneDef(zoneId);
    const zoneState = getZoneState(state, zoneId);
    if (!zoneDef || !zoneState) return null;
    ensureZoneContainers(zoneState, zoneDef);
    let runtime = runtimeByZoneState.get(zoneState);
    if (!runtime || runtime.state !== state || runtime.zoneDef !== zoneDef) {
      runtime = new ZoneRuntime(state, zoneDef, zoneState);
      runtimeByZoneState.set(zoneState, runtime);
    }
    return runtime;
  }

  function forEachMechanic(state, zoneId, fn, extra) { const runtime = getRuntime(state, zoneId); if (runtime) runtime.forEach(fn, extra); }

  // ---- Generic requirements ---------------------------------------------
  function countMachines(state, zoneId, machineId, machineTag) {
    let count = 0;
    (state.zones || []).forEach((zone) => {
      if (zoneId && zone.id !== zoneId) return;
      (zone.floors || []).forEach((floor) => (floor.grid || []).forEach((slot) => {
        if (!slot.machine) return;
        const machineMatches = !machineId || slot.machine.typeId === machineId;
        if (!machineMatches) return;
        if (machineTag) {
          const def = machineDef(slot.machine.typeId);
          if (!def || !Array.isArray(def.tags) || !def.tags.includes(machineTag)) return;
        }
        count++;
      }));
    });
    return count;
  }
  function hasMachine(state, machineId, zoneId) { return countMachines(state, zoneId, machineId) > 0; }

  function requirementValue(state, req, zoneId) {
    if (!req || typeof req !== "object") return 0;
    const scopeZoneId = req.scope === "zone" ? zoneId : null;
    switch (req.type) {
      case "money": return state.money;
      case "maxMoney": return state.maxMoney;
      case "research": return state.research;
      case "machineCount": return countMachines(state, scopeZoneId, req.machineId || null, req.tag || null);
      case "machineOwned": return hasMachine(state, req.machineId, scopeZoneId) ? 1 : 0;
      case "machineUnlocked": return isMachineUnlocked(state, req.machineId) ? 1 : 0;
      case "zoneUnlocked": return getZoneState(state, req.zoneId || zoneId)?.unlocked ? 1 : 0;
      case "secretDiscovered": {
        const secretZoneId = req.zoneId || zoneId;
        return getZoneState(state, secretZoneId)?.secrets.includes(req.secretId) ? 1 : 0;
      }
      case "mps": return computeMps(state, scopeZoneId);
      case "floorUnlocked": {
        const floor = getZoneState(state, zoneId)?.floors?.find((x) => x.id === req.floorId);
        return floor && floor.unlocked ? 1 : 0;
      }
      case "zoneStat": {
        const zone = getZoneState(state, zoneId);
        const value = zone ? readPath(zone.stats, req.stat, 0) : 0;
        return Number.isFinite(Number(value)) ? Number(value) : 0;
      }
      case "zoneVariable": {
        const zone = getZoneState(state, zoneId);
        const value = zone ? readPath(zone.variables, req.path, 0) : 0;
        return Number.isFinite(Number(value)) ? Number(value) : 0;
      }
      case "mechanicState": {
        const zone = getZoneState(state, zoneId);
        if (!zone) return 0;
        const value = readPath(zone.mechanicState && zone.mechanicState[req.mechanicId], req.path, 0);
        return Number.isFinite(Number(value)) ? Number(value) : 0;
      }
      default: return 0;
    }
  }

  function requirementMet(state, req, zoneId) {
    if (!req || typeof req !== "object") return false;
    const actual = requirementValue(state, req, zoneId);
    const expected = Number(req.value);
    if (!Number.isFinite(expected)) return false;
    switch (req.op) {
      case "gt": return actual > expected;
      case "eq": return actual === expected;
      case "lte": return actual <= expected;
      case "lt": return actual < expected;
      case "gte":
      default: return actual >= expected;
    }
  }
  function requirementsMet(state, requirements, zoneId) { return !Array.isArray(requirements) || requirements.every((req) => requirementMet(state, req, zoneId)); }
  function missingRequirements(state, requirements, zoneId) { return !Array.isArray(requirements) ? [] : requirements.filter((req) => !requirementMet(state, req, zoneId)); }

  // ---- Zone-specific upgrades / purchasables ----------------------------
  // These are owned only by their home Zone. JSON declares cost, requirements
  // and state effects; Zone mechanic JavaScript simply consumes zoneVariables.
  const ZONE_CONTENT_KINDS = Object.freeze(["upgrade", "purchase"]);
  const ZONE_EFFECT_OPERATIONS = Object.freeze(new Set(["set", "add", "subtract", "multiply", "divide", "min", "max"]));

  function getZoneContentDef(zoneId, contentId, kind) {
    const zoneDef = getZoneDef(zoneId);
    if (!zoneDef || !contentId) return null;
    const lists = kind === "purchase" ? [zoneDef.purchases || []] : kind === "upgrade" ? [zoneDef.upgrades || []] : [zoneDef.upgrades || [], zoneDef.purchases || []];
    for (const list of lists) {
      const found = list.find((item) => item && item.id === contentId);
      if (found) return found;
    }
    return null;
  }

  function getZoneContentKind(zoneId, contentId) {
    const zoneDef = getZoneDef(zoneId);
    if (!zoneDef) return null;
    if ((zoneDef.upgrades || []).some((item) => item && item.id === contentId)) return "upgrade";
    if ((zoneDef.purchases || []).some((item) => item && item.id === contentId)) return "purchase";
    return null;
  }

  function zoneContentLevel(zoneState, contentDef, kind) {
    if (!zoneState || !contentDef) return 0;
    if (kind === "purchase") return zoneState.purchases && zoneState.purchases[contentDef.id] === true ? 1 : 0;
    const raw = zoneState.upgrades && zoneState.upgrades[contentDef.id];
    return Number.isFinite(Number(raw)) ? Math.max(0, Math.floor(Number(raw))) : 0;
  }

  function zoneContentCost(contentDef, currentLevel) {
    if (!contentDef) return 0;
    const raw = contentDef.cost;
    if (Number.isFinite(Number(raw))) return Math.max(0, Math.ceil(Number(raw)));
    if (!isPlainObject(raw) || !Number.isFinite(Number(raw.base))) return Infinity;
    const growth = Number.isFinite(Number(raw.growth)) ? Math.max(1, Number(raw.growth)) : 1;
    return Math.max(0, Math.ceil(Number(raw.base) * Math.pow(growth, Math.max(0, Number(currentLevel) || 0))));
  }

  function zoneContentVisibilityRequirements(contentDef) {
    const visibility = isPlainObject(contentDef && contentDef.visibility) ? contentDef.visibility : null;
    return visibility && Array.isArray(visibility.requirements) ? visibility.requirements : [];
  }

  function zoneContentUnlockRequirements(contentDef) {
    const unlock = isPlainObject(contentDef && contentDef.unlock) ? contentDef.unlock : null;
    return unlock && Array.isArray(unlock.requirements) ? unlock.requirements : [];
  }

  function zoneContentIsHidden(contentDef) {
    return !!(contentDef && contentDef.visibility && contentDef.visibility.hidden === true);
  }

  function applyZoneEffect(target, effect) {
    if (!effect || !ZONE_EFFECT_OPERATIONS.has(effect.operation) || typeof effect.target !== "string" || !normalizePath(effect.target)) return false;
    const operation = effect.operation;
    const hasValue = Object.prototype.hasOwnProperty.call(effect, "value");
    const current = readPath(target, effect.target, undefined);
    // Effects are bound to declared Zone variables. This mirrors build-time
    // validation and prevents malformed runtime content from creating new
    // state paths accidentally.
    if (current === undefined) return false;
    let next;
    if (operation === "set") {
      if (!hasValue) return false;
      next = cloneJson(effect.value);
    } else {
      const rhs = Number(effect.value);
      const lhs = current === undefined ? 0 : Number(current);
      if (!Number.isFinite(rhs) || !Number.isFinite(lhs)) return false;
      if (operation === "add") next = lhs + rhs;
      else if (operation === "subtract") next = lhs - rhs;
      else if (operation === "multiply") next = lhs * rhs;
      else if (operation === "divide") { if (rhs === 0) return false; next = lhs / rhs; }
      else if (operation === "min") next = Math.min(lhs, rhs);
      else if (operation === "max") next = Math.max(lhs, rhs);
    }
    if (typeof next === "number" && !Number.isFinite(next)) return false;
    return writePath(target, effect.target, next);
  }

  function applyZoneContentEffects(zoneState, effects) {
    if (!zoneState || !Array.isArray(effects) || !effects.length) return { ok: true, variables: zoneState ? cloneJson(zoneState.variables || {}) : {} };
    const candidate = cloneJson(zoneState.variables || {});
    for (const effect of effects) {
      if (!applyZoneEffect(candidate, effect)) return { ok: false, reason: "invalidEffect" };
    }
    return { ok: true, variables: candidate };
  }

  function zoneContentStatus(state, zoneId, contentId, kind) {
    const zoneDef = getZoneDef(zoneId);
    const zoneState = getZoneState(state, zoneId);
    const resolvedKind = kind && ZONE_CONTENT_KINDS.includes(kind) ? kind : getZoneContentKind(zoneId, contentId);
    const def = getZoneContentDef(zoneId, contentId, resolvedKind);
    if (!zoneDef || !zoneState || !def || !resolvedKind) return { ok: false, reason: "invalid", visible: false, kind: resolvedKind, level: 0, maxLevel: 0, cost: 0, missingVisibility: [], missing: [] };
    ensureZoneContainers(zoneState, zoneDef);
    const maxLevel = Math.max(1, Math.floor(Number(def.maxLevel) || 1));
    const level = zoneContentLevel(zoneState, def, resolvedKind);
    const visibilityReqs = zoneContentVisibilityRequirements(def);
    const visible = !zoneContentIsHidden(def) || requirementsMet(state, visibilityReqs, zoneId);
    const missingVisibility = visible ? [] : missingRequirements(state, visibilityReqs, zoneId);
    const unlockReqs = zoneContentUnlockRequirements(def);
    const missing = visible ? missingRequirements(state, unlockReqs, zoneId) : missingVisibility.slice();
    const cost = level >= maxLevel ? 0 : zoneContentCost(def, level);
    const canPay = level >= maxLevel || state.money >= cost;
    const ok = !!zoneState.unlocked && visible && level < maxLevel && missing.length === 0 && canPay;
    let reason = null;
    if (!zoneState.unlocked) reason = "zoneLocked";
    else if (!visible) reason = "hidden";
    else if (level >= maxLevel) reason = "max";
    else if (missing.length) reason = "requirements";
    else if (!canPay) reason = "money";
    return { ok, reason, visible, hidden: !visible && zoneContentIsHidden(def), kind: resolvedKind, level, maxLevel, cost, canPay, missingVisibility, missing, zoneId, contentId, def };
  }

  function buyZoneContent(state, zoneId, contentId, kind) {
    const status = zoneContentStatus(state, zoneId, contentId, kind);
    if (!status.ok) return status;
    const zoneState = getZoneState(state, zoneId);
    const def = status.def;
    const nextLevel = status.level + 1;
    const effectsResult = applyZoneContentEffects(zoneState, def.effects);
    if (!effectsResult.ok) return { ok: false, reason: effectsResult.reason };
    if (state.money < status.cost) return { ok: false, reason: "money", cost: status.cost };
    state.money -= status.cost;
    // Commit the candidate in place so the Zone variables root remains stable
    // for any runtime adapter that is holding the current Zone state object.
    const committedVariables = zoneState.variables;
    Object.keys(committedVariables).forEach((key) => { delete committedVariables[key]; });
    Object.keys(effectsResult.variables).forEach((key) => { committedVariables[key] = effectsResult.variables[key]; });
    if (status.kind === "purchase") zoneState.purchases[contentId] = true;
    else zoneState.upgrades[contentId] = nextLevel;
    state.stats.totalUpgradesBought = Math.max(0, Number(state.stats.totalUpgradesBought) || 0) + 1;
    return { ok: true, kind: status.kind, contentId, cost: status.cost, newLevel: nextLevel, maxLevel: status.maxLevel };
  }

  function getZoneContentCatalog(state, zoneId) {
    const zoneDef = getZoneDef(zoneId), zoneState = getZoneState(state, zoneId);
    if (!zoneDef || !zoneState) return [];
    ensureZoneContainers(zoneState, zoneDef);
    const entries = [];
    (zoneDef.upgrades || []).forEach((def) => entries.push(Object.assign({ id: def.id, kind: "upgrade" }, zoneContentStatus(state, zoneId, def.id, "upgrade"))));
    (zoneDef.purchases || []).forEach((def) => entries.push(Object.assign({ id: def.id, kind: "purchase" }, zoneContentStatus(state, zoneId, def.id, "purchase"))));
    return entries;
  }

  // ---- Machine unlock / placement ---------------------------------------
  function machineDef(machineId) { return D.machineById(machineId); }
  function normalizedMachineUnlock(def) {
    const unlock = isPlainObject(def && def.unlock) ? def.unlock : {};
    const manual = unlock.manual === undefined ? unlock.auto !== true : !!unlock.manual;
    return Object.assign({}, unlock, { manual });
  }
  function zoneOrder(zoneId) {
    const def = getZoneDef(zoneId);
    return def && Number.isFinite(Number(def.order)) ? Number(def.order) : Infinity;
  }

  function isMachineUnlocked(state, machineId) {
    const def = machineDef(machineId);
    if (!def) return false;
    if (def.kind === "tier") return G.Econ.tierUnlocked(state, def.tierId);
    const homeZone = getZoneState(state, def.zoneId);
    const homeDef = getZoneDef(def.zoneId);
    if (!homeZone || !homeDef || !homeZone.unlocked) return false;
    ensureZoneContainers(homeZone, homeDef);
    if (homeZone.unlockedMachineIds.includes(def.id)) return true;
    const unlock = normalizedMachineUnlock(def);
    if (unlock.secretId && !homeZone.secrets.includes(unlock.secretId)) return false;
    if (unlock.manual) return false;
    return requirementsMet(state, unlock.requirements || [], def.zoneId);
  }

  function canPlaceMachineInZone(state, machineId, targetZoneId) {
    const def = machineDef(machineId);
    const targetZone = getZoneState(state, targetZoneId);
    const targetDef = getZoneDef(targetZoneId);
    if (!def || !targetZone || !targetDef || !targetZone.unlocked) return false;
    if (!isMachineUnlocked(state, machineId)) return false;
    if (def.kind !== "zone") return true;
    return zoneOrder(targetZoneId) >= zoneOrder(def.zoneId);
  }

  // Compatibility alias for old input code; semantics are now global unlock + placement.
  function machineUnlocked(state, machineId, targetZoneId) { return canPlaceMachineInZone(state, machineId, targetZoneId); }

  function machineUnlockStatus(state, machineId, _targetZoneId) {
    const def = machineDef(machineId);
    if (!def) return { ok: false, reason: "invalid", missing: [] };
    if (def.kind === "tier") {
      const ok = G.Econ.tierUnlocked(state, def.tierId);
      return { ok, already: ok, missing: ok || !def.unlockRequirement ? [] : [def.unlockRequirement], manual: false, cost: 0, canPay: true, zoneId: null };
    }
    const homeZone = getZoneState(state, def.zoneId);
    const homeDef = getZoneDef(def.zoneId);
    if (!homeZone || !homeDef || !homeZone.unlocked) return { ok: false, reason: "zoneLocked", missing: [], manual: true, cost: Math.max(0, Number((def.unlock || {}).cost) || 0), canPay: false, zoneId: def.zoneId };
    ensureZoneContainers(homeZone, homeDef);
    const unlock = normalizedMachineUnlock(def);
    if (homeZone.unlockedMachineIds.includes(def.id)) return { ok: true, already: true, missing: [], cost: 0, manual: unlock.manual, canPay: true, zoneId: def.zoneId };
    const missing = missingRequirements(state, unlock.requirements || [], def.zoneId);
    if (unlock.secretId && !homeZone.secrets.includes(unlock.secretId)) missing.push({ type: "secretDiscovered", secretId: unlock.secretId, value: 1, _secretGate: true });
    const cost = Math.max(0, Number(unlock.cost) || 0);
    const canPay = state.money >= cost;
    const ready = !unlock.manual && missing.length === 0 && canPay;
    return { ok: ready, manual: unlock.manual, missing, cost, canPay, zoneId: def.zoneId, reason: missing.length ? "requirements" : (canPay ? null : "money") };
  }

  function unlockMachine(state, machineId, events) {
    const def = machineDef(machineId);
    if (!def || def.kind !== "zone") return { ok: false, reason: "invalid" };
    const zone = getZoneState(state, def.zoneId);
    const zoneDef = getZoneDef(def.zoneId);
    if (!zone || !zoneDef || !zone.unlocked) return { ok: false, reason: "zoneLocked" };
    ensureZoneContainers(zone, zoneDef);
    if (zone.unlockedMachineIds.includes(def.id)) return { ok: true, already: true, machineId: def.id, cost: 0 };
    const unlock = normalizedMachineUnlock(def);
    if (!unlock.manual) return { ok: false, reason: "notManual" };
    if (unlock.secretId && !zone.secrets.includes(unlock.secretId)) return { ok: false, reason: "secret", secretId: unlock.secretId };
    const missing = missingRequirements(state, unlock.requirements || [], def.zoneId);
    if (missing.length) return { ok: false, reason: "requirements", missing, cost: Number(unlock.cost) || 0 };
    const cost = Math.max(0, Number(unlock.cost) || 0);
    if (state.money < cost) return { ok: false, reason: "money", cost };
    state.money -= cost;
    zone.unlockedMachineIds.push(def.id);
    if (Array.isArray(events)) events.push({ type: "machineUnlocked", zoneId: def.zoneId, machineId: def.id, cost });
    return { ok: true, machineId: def.id, cost };
  }

  // ---- Floor unlock ------------------------------------------------------
  // Floors use the same requirement engine as Zones, machines and local content.
  // Legacy {type:"money", amount:N} remains supported as a compatibility form
  // and means both "requires N cash" and "costs N cash". New content should use
  // { requirements:[...], cost:N }.
  function normalizedFloorUnlock(def) {
    const unlock = isPlainObject(def && def.unlock) ? def.unlock : null;
    if (!unlock) return { requirements: [], cost: 0 };
    if (Array.isArray(unlock.requirements)) {
      const cost = Number.isFinite(Number(unlock.cost)) ? Math.max(0, Number(unlock.cost)) : 0;
      return { requirements: unlock.requirements, cost };
    }
    if (unlock.type === "money" && Number.isFinite(Number(unlock.amount))) {
      const amount = Math.max(0, Number(unlock.amount));
      return { requirements: [{ type: "money", value: amount }], cost: amount };
    }
    return { requirements: [], cost: Infinity, invalid: true };
  }

  function floorUnlockStatus(state, zoneId, floorId) {
    const def = D.floorById(zoneId, floorId);
    const zone = getZoneState(state, zoneId);
    const floor = zone?.floors?.find((item) => item.id === floorId);
    if (!def || !zone || !floor) return { ok: false, reason: "invalid", missing: [], cost: 0, canPay: false };
    if (!zone.unlocked) return { ok: false, reason: "zoneLocked", missing: [], cost: 0, canPay: false };
    if (floor.unlocked) return { ok: true, already: true, missing: [], cost: 0, canPay: true };
    const unlock = normalizedFloorUnlock(def);
    if (unlock.invalid) return { ok: false, reason: "invalid", missing: [], cost: Infinity, canPay: false };
    const missing = missingRequirements(state, unlock.requirements, zoneId);
    const canPay = state.money >= unlock.cost;
    return {
      ok: missing.length === 0 && canPay,
      missing,
      cost: unlock.cost,
      canPay,
      reason: missing.length ? "requirements" : (canPay ? null : "money"),
    };
  }

  function unlockFloor(state, zoneId, floorId, events) {
    const status = floorUnlockStatus(state, zoneId, floorId);
    if (status.already) return { ok: true, already: true, cost: 0 };
    if (!status.ok) return status;
    const floor = getZoneState(state, zoneId).floors.find((item) => item.id === floorId);
    if (!floor) return { ok: false, reason: "invalid" };
    if (status.cost > 0) {
      if (state.money < status.cost) return { ok: false, reason: "money", cost: status.cost };
      state.money -= status.cost;
    }
    floor.unlocked = true;
    if (Array.isArray(events)) events.push({ type: "floorUnlocked", zoneId, floorId, cost: status.cost });
    return { ok: true, cost: status.cost };
  }

  // ---- Zone unlock -------------------------------------------------------
  function zoneUnlockStatus(state, zoneId) {
    const def = getZoneDef(zoneId), zone = getZoneState(state, zoneId);
    if (!def || !zone) return { ok: false, reason: "invalid", missing: [] };
    if (zone.unlocked) return { ok: true, already: true, missing: [], cost: 0, canPay: true };
    const unlock = isPlainObject(def.unlock) ? def.unlock : {};
    const missing = missingRequirements(state, unlock.requirements || [], zoneId);
    const cost = Math.max(0, Number(unlock.cost) || 0);
    return { ok: missing.length === 0 && state.money >= cost, missing, cost, canPay: state.money >= cost };
  }

  function unlockZone(state, zoneId, events) {
    const def = getZoneDef(zoneId), zone = getZoneState(state, zoneId);
    if (!def || !zone) return { ok: false, reason: "invalid" };
    if (zone.unlocked) return { ok: true, already: true, cost: 0 };
    const status = zoneUnlockStatus(state, zoneId);
    if (status.missing.length) return { ok: false, reason: "requirements", missing: status.missing, cost: status.cost };
    if (!status.canPay) return { ok: false, reason: "money", cost: status.cost };
    state.money -= status.cost;
    zone.unlocked = true;
    ensureZoneContainers(zone, def);
    if (Array.isArray(events)) events.push({ type: "zoneUnlocked", zoneId, cost: status.cost });
    onZoneUnlocked(state, zoneId, events);
    checkSecrets(state, zoneId, events);
    return { ok: true, cost: status.cost };
  }

  function onZoneUnlocked(state, zoneId, events) {
    forEachMechanic(state, zoneId, (_mechanic, ctx) => {
      const runtime = getRuntime(state, zoneId);
      if (runtime) runtime.call(ctx.mechanic, "onZoneUnlocked", Object.assign(ctx, { mode: "live", events }), []);
    }, { events });
  }

  // ---- Production hooks --------------------------------------------------
  function beforeZoneTick(state, zone, dt, events) { if (zone) forEachMechanic(state, zone.id, (m, c) => getRuntime(state, zone.id)?.call(m, "onBeforeZoneTick", Object.assign(c, { zone, dt, events, mode: "live" })), { events }); }
  function afterZoneTick(state, zone, dt, events) { if (zone) forEachMechanic(state, zone.id, (m, c) => getRuntime(state, zone.id)?.call(m, "onAfterZoneTick", Object.assign(c, { zone, dt, events, mode: "live" })), { events }); }
  function beforeTick(state, zone, floor, dt, events) { if (zone && floor) forEachMechanic(state, zone.id, (m, c) => getRuntime(state, zone.id)?.call(m, "onBeforeTick", Object.assign(c, { zone, floor, dt, events, mode: "live" })), { events }); }

  function beforeMachineCycle(state, zone, floor, machine, slot, events) {
    let working = true;
    if (!zone) return working;
    forEachMechanic(state, zone.id, (m, c) => {
      const result = getRuntime(state, zone.id)?.call(m, "onBeforeMachineCycle", Object.assign(c, { zone, floor, machine, slot, events, mode: "live" }));
      if (result === false) working = false;
    }, { events });
    return working;
  }

  function getProductionMultiplier(state, zoneId, floor, machine, slot, mode = "live") {
    let multiplier = 1;
    forEachMechanic(state, zoneId, (m, c) => {
      const result = getRuntime(state, zoneId)?.call(m, "modifyProduction", Object.assign(c, { floor, machine, slot: slot || null, mode }), [multiplier, machine]);
      if (Number.isFinite(result)) multiplier = clampMultiplier(result, multiplier);
    });
    return multiplier;
  }

  function modifyCooldown(state, zoneId, floor, machine, cooldown, mode = "live") {
    let value = Number.isFinite(cooldown) ? cooldown : 1;
    forEachMechanic(state, zoneId, (m, c) => {
      const result = getRuntime(state, zoneId)?.call(m, "modifyCooldown", Object.assign(c, { floor, machine, mode }), [value, machine]);
      if (Number.isFinite(result)) value = Math.max(0.05, result);
    });
    return value;
  }

  function afterMachineCycle(state, zone, floor, machine, slot, result, events) {
    if (!zone) return;
    forEachMechanic(state, zone.id, (m, c) => getRuntime(state, zone.id)?.call(m, "onMachineCycle", Object.assign(c, { zone, floor, machine, slot, result, events, mode: "live" }), [result]), { events });
  }
  function onMachinePlaced(state, zoneId, floor, machine, slot, events) {
    forEachMechanic(state, zoneId, (m, c) => getRuntime(state, zoneId)?.call(m, "onMachinePlaced", Object.assign(c, { floor, machine, slot, events, mode: "live" })), { events });
  }
  function onMachineCollected(state, zoneId, floor, machine, slot, amount, events, automatic = false) {
    forEachMechanic(state, zoneId, (m, c) => getRuntime(state, zoneId)?.call(m, "onMachineCollected", Object.assign(c, { floor, machine, slot: slot || null, amount, automatic: !!automatic, events, mode: "live" }), [amount]), { events });
  }
  function afterTick(state, zone, floor, dt, events) {
    if (zone && floor) forEachMechanic(state, zone.id, (m, c) => getRuntime(state, zone.id)?.call(m, "onAfterTick", Object.assign(c, { zone, floor, dt, events, mode: "live" })), { events });
  }

  function dispatchEvents(state, events) {
    if (!Array.isArray(events) || !events.length) return;
    let index = 0;
    let processed = 0;
    while (index < events.length && processed < INTERNAL.MAX_MECHANIC_EVENTS_PER_FRAME) {
      const event = events[index++];
      if (!event || event.__zoneMechanicEvent !== true || !event.zoneId) continue;
      processed++;
      const zone = getZoneState(state, event.zoneId);
      if (!zone || !zone.unlocked) continue;
      forEachMechanic(state, event.zoneId, (m, c) => getRuntime(state, event.zoneId)?.call(m, "onGameEvent", Object.assign(c, { event, events, mode: "live" }), [event]), { events });
    }
  }

  // ---- MPS bridge --------------------------------------------------------
  function computeMps(state, zoneOnlyId) {
    let mps = 0;
    (state.zones || []).forEach((zone) => {
      if (!zone.unlocked || (zoneOnlyId && zone.id !== zoneOnlyId)) return;
      (zone.floors || []).forEach((floor) => {
        if (!floor.unlocked) return;
        const outMult = G.Econ.floorOutputMult(floor);
        (floor.grid || []).forEach((slot) => {
          const machine = slot.machine;
          if (!machine) return;
          const baseCooldown = G.Econ.machineCooldown(machine, state);
          const cooldown = modifyCooldown(state, zone.id, floor, machine, baseCooldown, "query");
          const avgYield = G.Econ.machineBaseYield(machine, outMult, state) * (1 + G.Econ.machineCritChance(machine, state) * (G.Econ.machineCritMult(machine) - 1));
          const modifier = getProductionMultiplier(state, zone.id, floor, machine, slot, "query");
          mps += (avgYield * modifier) / cooldown;
        });
      });
    });
    return Number.isFinite(mps) ? Math.max(0, mps) : 0;
  }

  // ---- Secrets -----------------------------------------------------------
  function applySecretReward(state, zoneDef, secret) {
    if (!secret || !secret.reward || !G.Factory) return;
    const reward = secret.reward;
    if (reward.type === "cash" && Number.isFinite(reward.amount) && reward.amount > 0) {
      G.Factory.grantMoney(state, Math.min(INTERNAL.MAX_SECRET_REWARD_AMOUNT, reward.amount));
    } else if (reward.type === "research" && Number.isFinite(reward.amount) && reward.amount > 0) {
      state.research += reward.amount;
    } else if (reward.type === "unlockMachine" && typeof reward.machineId === "string") {
      const zoneState = getZoneState(state, zoneDef.id);
      if (zoneState && (zoneDef.machines || []).some((m) => m.id === reward.machineId) && !zoneState.unlockedMachineIds.includes(reward.machineId)) zoneState.unlockedMachineIds.push(reward.machineId);
    } else if (reward.type === "mechanicState" && typeof reward.mechanicId === "string" && typeof reward.path === "string") {
      const zoneState = getZoneState(state, zoneDef.id);
      if (zoneState) {
        if (!zoneState.mechanicState[reward.mechanicId]) zoneState.mechanicState[reward.mechanicId] = {};
        writePath(zoneState.mechanicState[reward.mechanicId], reward.path, reward.value);
      }
    }
  }

  function mechanicIsHidden(def) { return !!(def && def.visibility && def.visibility.hidden === true); }

  function discoverMechanic(state, zoneId, mechanicId, events) {
    const zoneDef = getZoneDef(zoneId), zoneState = getZoneState(state, zoneId);
    if (!zoneDef || !zoneState || !zoneState.unlocked) return false;
    ensureZoneContainers(zoneState, zoneDef);
    if (zoneState.mechanicDiscoveries.includes(mechanicId)) return false;
    const mechanic = (zoneDef.mechanics || []).find((m) => m && m.id === mechanicId);
    if (!mechanic || !mechanicIsHidden(mechanic)) return false;
    const requirements = mechanic.visibility && mechanic.visibility.requirements;
    if (!Array.isArray(requirements) || !requirementsMet(state, requirements, zoneId)) return false;
    zoneState.mechanicDiscoveries.push(mechanicId);
    emitSafeEvent(events, "mechanicDiscovered", { zoneId, mechanicId });
    return true;
  }

  function checkMechanicDiscoveries(state, zoneId, events) {
    const zoneDef = getZoneDef(zoneId), zoneState = getZoneState(state, zoneId);
    if (!zoneDef || !zoneState || !zoneState.unlocked) return;
    ensureZoneContainers(zoneState, zoneDef);
    (zoneDef.mechanics || []).forEach((mechanic) => {
      if (!mechanic || !mechanicIsHidden(mechanic) || zoneState.mechanicDiscoveries.includes(mechanic.id)) return;
      discoverMechanic(state, zoneId, mechanic.id, events);
    });
  }

  function getZoneMechanics(state, zoneId) {
    const def = getZoneDef(zoneId), zone = getZoneState(state, zoneId);
    if (!def || !zone) return [];
    ensureZoneContainers(zone, def);
    return (def.mechanics || []).map((mechanic) => {
      const hidden = mechanicIsHidden(mechanic);
      const discovered = !hidden || zone.mechanicDiscoveries.includes(mechanic.id);
      return {
        id: mechanic.id,
        discovered,
        hidden,
        nameKey: mechanic.nameKey,
        descriptionKey: mechanic.descriptionKey,
        hintKey: mechanic.visibility && mechanic.visibility.hintKey,
        discovery: mechanic.visibility && mechanic.visibility.requirements ? { requirements: mechanic.visibility.requirements } : null,
      };
    });
  }

  function discoverSecret(state, zoneId, secretId, events) {
    const zoneDef = getZoneDef(zoneId), zoneState = getZoneState(state, zoneId);
    if (!zoneDef || !zoneState || !zoneState.unlocked) return false;
    ensureZoneContainers(zoneState, zoneDef);
    if (zoneState.secrets.includes(secretId)) return false;
    const secret = (zoneDef.secrets || []).find((s) => s && s.id === secretId);
    if (!secret) return false;
    const requirements = secret.discovery && secret.discovery.requirements;
    if (!Array.isArray(requirements) || !requirementsMet(state, requirements, zoneId)) return false;
    zoneState.secrets.push(secretId);
    applySecretReward(state, zoneDef, secret);
    emitSafeEvent(events, "secretDiscovered", { zoneId, secretId });
    return true;
  }

  function checkSecrets(state, zoneId, events) {
    const zoneDef = getZoneDef(zoneId), zoneState = getZoneState(state, zoneId);
    if (!zoneDef || !zoneState || !zoneState.unlocked) return;
    ensureZoneContainers(zoneState, zoneDef);
    // Let mechanics update their own persistent conditions first. Generic
    // secret/mechanic discovery then observes the resulting state in the same tick.
    forEachMechanic(state, zoneId, (m, c) => getRuntime(state, zoneId)?.call(m, "onCheckSecrets", Object.assign(c, { events, mode: "live" })), { events });
    (zoneDef.secrets || []).forEach((secret) => {
      if (!secret || zoneState.secrets.includes(secret.id)) return;
      const reqs = secret.discovery && secret.discovery.requirements;
      if (Array.isArray(reqs) && requirementsMet(state, reqs, zoneId)) discoverSecret(state, zoneId, secret.id, events);
    });
    checkMechanicDiscoveries(state, zoneId, events);
  }
  function checkAllSecrets(state, events) { (state.zones || []).forEach((zone) => { if (zone.unlocked) checkSecrets(state, zone.id, events); }); }
  function getZoneSecrets(state, zoneId) {
    const def = getZoneDef(zoneId), zone = getZoneState(state, zoneId);
    if (!def || !zone) return [];
    ensureZoneContainers(zone, def);
    return (def.secrets || []).map((secret) => ({ id: secret.id, discovered: zone.secrets.includes(secret.id), hintKey: secret.hintKey, nameKey: secret.nameKey, descriptionKey: secret.descriptionKey, discovery: secret.discovery || null }));
  }
  function getMechanicUIState(state, zoneId, floorId) {
    const zoneDef = getZoneDef(zoneId), zoneState = getZoneState(state, zoneId);
    const out = { machineStatuses: [], machineDecorations: [], zoneIndicators: [] };
    if (!zoneDef || !zoneState || !zoneState.unlocked) return out;
    const floor = (zoneState.floors || []).find((item) => item && item.id === floorId) || null;
    const runtime = getRuntime(state, zoneId);
    if (!runtime) return out;
    const uiSnapshot = buildUiStateSnapshot(state);
    const calculationState = cloneJson(state);
    for (const def of runtime.defs()) {
      if (!def || def.enabled === false || !isMechanicUiVisible(zoneDef, zoneState, def.id)) continue;
      const mechanic = runtime.instances.get(def.id);
      if (!mechanic) continue;
      const uiCtx = runtime.uiContext(mechanic, uiSnapshot, floorId, calculationState);
      const raw = runtime.callUi(mechanic, uiCtx);
      const normalized = normalizeMechanicUiState(raw, zoneId);
      out.machineStatuses.push(...normalized.machineStatuses);
      out.machineDecorations.push(...normalized.machineDecorations);
      out.zoneIndicators.push(...normalized.zoneIndicators);
    }
    out.machineStatuses = out.machineStatuses.slice(0, INTERNAL.MAX_MECHANIC_UI_ITEMS);
    out.machineDecorations = out.machineDecorations.slice(0, INTERNAL.MAX_MECHANIC_UI_ITEMS);
    out.zoneIndicators = out.zoneIndicators
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .slice(0, 4);
    return out;
  }

  function getDiagnostics(state) { return (state.zones || []).map((zone) => getRuntime(state, zone.id)?.diagnostics() || { zoneId: zone.id, missingScripts: [], disabledMechanics: [] }); }

  G.Zone = {
    ZoneMechanicContract,
    ZoneMechanic,
    ZoneRuntime,
    registerMechanic,
    getZoneDef,
    getZoneState,
    requirementsMet,
    missingRequirements,
    requirementValue,
    requirementMet,
    zoneUnlockStatus,
    unlockZone,
    machineDef,
    isMachineUnlocked,
    canPlaceMachineInZone,
    machineUnlocked,
    unlockMachine,
    machineUnlockStatus,
    beforeZoneTick,
    afterZoneTick,
    beforeTick,
    beforeMachineCycle,
    afterMachineCycle,
    onMachinePlaced,
    onMachineCollected,
    afterTick,
    dispatchEvents,
    checkAllSecrets,
    computeMps,
    discoverSecret,
    checkSecrets,
    getZoneSecrets,
    discoverMechanic,
    checkMechanicDiscoveries,
    getZoneMechanics,
    getMechanicUIState,
    getProductionMultiplier,
    modifyCooldown,
    getZoneContentDef,
    getZoneContentKind,
    floorUnlockStatus,
    unlockFloor,
    zoneContentCost,
    zoneContentStatus,
    buyZoneContent,
    getZoneContentCatalog,
    applyZoneContentEffects,
    ensureZoneContainers,
    getDiagnostics,
    get registeredMechanics() { return Array.from(mechanicRegistry.keys()); },
  };
})(window.Game = window.Game || {});
