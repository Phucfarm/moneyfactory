#!/usr/bin/env node
/*
 * Production build for Money Factory Tycoon.
 *
 * Source-of-truth content:
 *   content/zones.json
 *   content/backgrounds.json
 *   content/audio.json
 *
 * Generated runtime data:
 *   src/00-zone-content.js
 *   src/00-background-content.js
 *   src/00-audio-content.js
 *
 * The production artifact is dist/index.html plus local assets under
 * dist/assets/audio/. Zone and Background JavaScript declared by content JSON
 * is validated and inlined in deterministic order; external audio never needs
 * a network URL.
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const CONTENT = path.join(ROOT, "content");
const SRC = path.join(ROOT, "src");
const OUT_DIR = path.join(ROOT, "dist");
const INDEX = path.join(ROOT, "index.html");
const ZONE_JSON = path.join(CONTENT, "zones.json");
const BG_JSON = path.join(CONTENT, "backgrounds.json");
const AUDIO_JSON = path.join(CONTENT, "audio.json");
const ZONE_GENERATED = path.join(SRC, "00-zone-content.js");
const BG_GENERATED = path.join(SRC, "00-background-content.js");
const AUDIO_GENERATED = path.join(SRC, "00-audio-content.js");

const fail = (msg) => { throw new Error(msg); };
const readText = (file) => fs.readFileSync(file, "utf8");
const readJson = (file) => {
  try { return JSON.parse(readText(file)); }
  catch (err) { fail(`${path.relative(ROOT, file)}: invalid JSON — ${err.message}`); }
};
const rel = (file) => path.relative(ROOT, file).replace(/\\/g, "/");
const assertSafeRelativeSource = (source, label) => {
  if (typeof source !== "string" || !source.trim()) fail(`${label}: source must be a non-empty relative file path`);
  const normalized = source.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("../") || normalized.includes("..\\")) fail(`${label}: source escapes project root: ${source}`);
  const full = path.resolve(ROOT, normalized);
  if (!full.startsWith(ROOT + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) fail(`${label}: source file not found: ${source}`);
  return normalized;
};
const unique = (items, getId, label) => {
  const seen = new Set();
  for (const item of items) {
    const id = getId(item);
    if (typeof id !== "string" || !id.trim()) fail(`${label}: every entry needs a non-empty id`);
    if (seen.has(id)) fail(`${label}: duplicate id: ${id}`);
    seen.add(id);
  }
};
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const validNumber = (v) => Number.isFinite(Number(v));
const compareOps = new Set(["gt", "eq", "lt", "lte", "gte"]);
const requirementTypes = new Set([
  "money", "maxMoney", "research", "mps", "machineCount", "machineOwned", "machineUnlocked",
  "zoneUnlocked", "secretDiscovered", "floorUnlocked", "zoneStat", "mechanicState", "zoneVariable"
]);

const AUDIO_KINDS = new Set(["sfx", "music"]);
const AUDIO_PATH_RE = /^assets\/audio\/.+\.(mp3|wav|ogg|m4a|aac|webm)$/i;
const AUDIO_EVENT_KEY_RE = /^[A-Za-z0-9_.-]+$/;

function audioPath(source, label) {
  if (typeof source !== "string" || !source.trim()) fail(`${label}: audio source must be a non-empty path`);
  const normalized = source.replace(/\\/g, "/");
  if (!AUDIO_PATH_RE.test(normalized)) fail(`${label}: audio source must stay under assets/audio and use a supported browser audio extension`);
  const full = path.resolve(ROOT, normalized);
  if (!full.startsWith(path.resolve(ROOT, "assets/audio") + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) fail(`${label}: audio file not found: ${source}`);
  return normalized;
}

function audioRef(value, label, expectedKind, audioAssets) {
  if (typeof value === "string") {
    const asset = audioAssets.get(value);
    if (asset) {
      if (expectedKind && asset.kind !== expectedKind) fail(`${label}: asset ${value} is ${asset.kind}, expected ${expectedKind}`);
      return;
    }
    audioPath(value, label);
    return;
  }
  if (!isPlainObject(value)) fail(`${label}: audio spec must be a string or object`);
  const ref = value.asset !== undefined ? value.asset : value.src;
  if (typeof ref !== "string" || !ref.trim()) fail(`${label}: audio object needs asset or src`);
  if (value.asset !== undefined) {
    const asset = audioAssets.get(value.asset);
    if (!asset) fail(`${label}: unknown audio asset id: ${value.asset}`);
    if (expectedKind && asset.kind !== expectedKind) fail(`${label}: asset ${value.asset} is ${asset.kind}, expected ${expectedKind}`);
  } else {
    audioPath(value.src, `${label}.src`);
  }
  if (value.volume !== undefined && (!validNumber(value.volume) || Number(value.volume) < 0 || Number(value.volume) > 1)) fail(`${label}.volume must be between 0 and 1`);
  if (value.playbackRate !== undefined && (!validNumber(value.playbackRate) || Number(value.playbackRate) <= 0 || Number(value.playbackRate) > 4)) fail(`${label}.playbackRate must be > 0 and <= 4`);
  if (value.loop !== undefined && typeof value.loop !== "boolean") fail(`${label}.loop must be boolean`);
  if (value.cooldownMs !== undefined && (!validNumber(value.cooldownMs) || Number(value.cooldownMs) < 0)) fail(`${label}.cooldownMs must be non-negative`);
  if (value.replaceDefault !== undefined && typeof value.replaceDefault !== "boolean") fail(`${label}.replaceDefault must be boolean`);
  if (value.activeOnly !== undefined && typeof value.activeOnly !== "boolean") fail(`${label}.activeOnly must be boolean`);
  if (value.fadeInMs !== undefined && (!validNumber(value.fadeInMs) || Number(value.fadeInMs) < 0)) fail(`${label}.fadeInMs must be non-negative`);
  if (value.fadeOutMs !== undefined && (!validNumber(value.fadeOutMs) || Number(value.fadeOutMs) < 0)) fail(`${label}.fadeOutMs must be non-negative`);
}

function validateAudioConfig(audio, label, audioAssets) {
  if (audio === undefined) return;
  if (!isPlainObject(audio)) fail(`${label}: audio must be an object`);
  if (audio.music !== undefined) audioRef(audio.music, `${label}.music`, "music", audioAssets);
  if (audio.events !== undefined) {
    if (!isPlainObject(audio.events)) fail(`${label}.events must be an object`);
    Object.entries(audio.events).forEach(([eventId, spec]) => {
      if (!AUDIO_EVENT_KEY_RE.test(eventId)) fail(`${label}.events.${eventId}: invalid event key`);
      const list = Array.isArray(spec) ? spec : [spec];
      if (!list.length) fail(`${label}.events.${eventId}: event spec array must not be empty`);
      list.forEach((item, i) => audioRef(item, `${label}.events.${eventId}[${i}]`, "sfx", audioAssets));
    });
  }
}

const mechanicUiTones = new Set(["info", "good", "warn", "danger", "muted"]);
const mechanicUiVariants = new Set(["disabled", "buff", "warning", "info"]);
function validateMechanicUi(ui, label) {
  if (ui === undefined) return;
  if (!isPlainObject(ui)) fail(`${label}: ui must be an object`);
  if (ui.events !== undefined) {
    if (!isPlainObject(ui.events)) fail(`${label}.events must be an object`);
    Object.entries(ui.events).forEach(([id, spec]) => {
      if (!isPlainObject(spec)) fail(`${label}.events.${id}: event spec must be an object`);
      if (spec.kind !== undefined && spec.kind !== "banner") fail(`${label}.events.${id}: only banner UI events are supported`);
      if (spec.labelKey !== undefined && typeof spec.labelKey !== "string") fail(`${label}.events.${id}.labelKey must be a string`);
      if (spec.detailKey !== undefined && typeof spec.detailKey !== "string") fail(`${label}.events.${id}.detailKey must be a string`);
      if (spec.tone !== undefined && !mechanicUiTones.has(spec.tone)) fail(`${label}.events.${id}.tone is invalid`);
    });
  }
  if (ui.machineStatuses !== undefined && !Array.isArray(ui.machineStatuses)) fail(`${label}.machineStatuses must be an array`);
  if (ui.zoneIndicators !== undefined && !Array.isArray(ui.zoneIndicators)) fail(`${label}.zoneIndicators must be an array`);
}

function validateRequirements(reqs, label) {
  if (reqs === undefined || reqs === null) return;
  if (!Array.isArray(reqs)) fail(`${label}: requirements must be an array`);
  reqs.forEach((r, i) => {
    if (!isPlainObject(r)) fail(`${label}[${i}]: requirement must be an object`);
    if (!requirementTypes.has(r.type)) fail(`${label}[${i}]: unsupported requirement type: ${r.type}`);
    if (r.op !== undefined && !compareOps.has(r.op)) fail(`${label}[${i}]: unsupported operator: ${r.op}`);
    if (r.value !== undefined && !validNumber(r.value)) fail(`${label}[${i}]: value must be numeric`);
    if (r.type === "machineCount" && r.machineId !== undefined && typeof r.machineId !== "string") fail(`${label}[${i}]: machineId must be a string`);
    if (r.type === "machineCount" && r.tag !== undefined && (typeof r.tag !== "string" || !/^[A-Za-z0-9_-]+$/.test(r.tag))) fail(`${label}[${i}]: tag must be a CSS-safe string when provided`);
    if (r.type === "machineCount" && r.machineId !== undefined && r.tag !== undefined) fail(`${label}[${i}]: machineCount may use machineId or tag, not both`);
    if (r.type === "machineOwned" && typeof r.machineId !== "string") fail(`${label}[${i}]: machineOwned requires machineId`);
    if (r.type === "machineUnlocked" && typeof r.machineId !== "string") fail(`${label}[${i}]: machineUnlocked requires machineId`);
    if (r.type === "zoneUnlocked" && r.zoneId !== undefined && typeof r.zoneId !== "string") fail(`${label}[${i}]: zoneId must be a string`);
    if (r.type === "secretDiscovered" && typeof r.secretId !== "string") fail(`${label}[${i}]: secretDiscovered requires secretId`);
    if (r.type === "floorUnlocked" && typeof r.floorId !== "string") fail(`${label}[${i}]: floorUnlocked requires floorId`);
    if (r.type === "zoneStat" && typeof r.stat !== "string") fail(`${label}[${i}]: zoneStat requires stat`);
    if (r.type === "mechanicState" && (typeof r.mechanicId !== "string" || typeof r.path !== "string")) fail(`${label}[${i}]: mechanicState requires mechanicId + path`);
    if (r.type === "zoneVariable" && typeof r.path !== "string") fail(`${label}[${i}]: zoneVariable requires path`);
  });
}

const zones = readJson(ZONE_JSON);
const backgrounds = readJson(BG_JSON);
const audio = readJson(AUDIO_JSON);
if (!isPlainObject(zones) || zones.schemaVersion !== 4 || !Array.isArray(zones.zones)) fail("content/zones.json: expected schemaVersion 4 and zones[]");
if (!isPlainObject(backgrounds) || backgrounds.schemaVersion !== 2 || !Array.isArray(backgrounds.backgrounds)) fail("content/backgrounds.json: expected schemaVersion 2 and backgrounds[]");
if (!isPlainObject(audio) || audio.schemaVersion !== 1 || !Array.isArray(audio.assets)) fail("content/audio.json: expected schemaVersion 1 and assets[]");
if (!zones.zones.length) fail("content/zones.json: at least one Zone is required");
if (!backgrounds.backgrounds.length) fail("content/backgrounds.json: at least one Background is required");

unique(backgrounds.backgrounds, (x) => x.id, "content/backgrounds.json backgrounds");
unique(audio.assets, (x) => x.id, "content/audio.json assets");
const audioAssets = new Map();
audio.assets.forEach((asset) => {
  if (!isPlainObject(asset)) fail("content/audio.json assets: each entry must be an object");
  if (!AUDIO_KINDS.has(asset.kind)) fail(`content/audio.json asset ${asset.id}: kind must be sfx or music`);
  if (typeof asset.src !== "string" || !asset.src.trim()) fail(`content/audio.json asset ${asset.id}: src is required`);
  audioPath(asset.src, `content/audio.json asset ${asset.id}.src`);
  if (asset.volume !== undefined && (!validNumber(asset.volume) || Number(asset.volume) < 0 || Number(asset.volume) > 1)) fail(`content/audio.json asset ${asset.id}: volume must be between 0 and 1`);
  if (asset.loop !== undefined && typeof asset.loop !== "boolean") fail(`content/audio.json asset ${asset.id}: loop must be boolean`);
  if (asset.playbackRate !== undefined && (!validNumber(asset.playbackRate) || Number(asset.playbackRate) <= 0 || Number(asset.playbackRate) > 4)) fail(`content/audio.json asset ${asset.id}: playbackRate must be > 0 and <= 4`);
  audioAssets.set(asset.id, asset);
});
if (audio.events !== undefined) {
  validateAudioConfig({ events: audio.events }, "content/audio.json", audioAssets);
}

const backgroundIds = new Set(backgrounds.backgrounds.map((x) => x.id));
const backgroundScripts = [];
const seenBgScripts = new Set();
const backgroundScriptSources = new Map();
backgrounds.backgrounds.forEach((bg) => {
  if (typeof bg.className !== "string" || !/^[A-Za-z0-9_-]+$/.test(bg.className)) fail(`content/backgrounds.json background ${bg.id}: className must be CSS-safe`);
  if (bg.cssSource !== undefined) {
    const source = assertSafeRelativeSource(bg.cssSource, `content/backgrounds.json background ${bg.id}.cssSource`);
    bg.cssText = readText(path.resolve(ROOT, source));
  } else {
    bg.cssText = "";
  }
  const hasScript = bg.script !== undefined;
  const hasSource = bg.source !== undefined;
  if (hasScript !== hasSource) fail(`content/backgrounds.json background ${bg.id}: script and source must be declared together`);
  if (hasScript) {
    if (typeof bg.script !== "string" || !bg.script.trim()) fail(`content/backgrounds.json background ${bg.id}: script must be non-empty`);
    const source = assertSafeRelativeSource(bg.source, `content/backgrounds.json background ${bg.id}.source`);
    const bgSourceText = readText(path.resolve(ROOT, source));
    const escapedScript = bg.script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const registerPattern = new RegExp(`\\bG\\.Background\\.registerBackground\\s*\\(\\s*["']${escapedScript}["']\\s*,`);
    if (!registerPattern.test(bgSourceText)) fail(`content/backgrounds.json background ${bg.id}: source ${source} does not register background script ${bg.script}`);
    const forbidden = [/G\.Factory\b/, /G\.Econ\b/, /G\.Save\b/, /localStorage/,
      /state\.(?:money|research|skills|zones|rooms)\b/];
    if (forbidden.some((rx) => rx.test(bgSourceText))) fail(`content/backgrounds.json background ${bg.id}: Background JS must remain visual-only and must not access core gameplay state/APIs directly`);
    const existingSource = backgroundScriptSources.get(bg.script);
    if (existingSource && existingSource !== source) fail(`content/backgrounds.json: background script ${bg.script} maps to multiple source files: ${existingSource} and ${source}`);
    backgroundScriptSources.set(bg.script, source);
    if (!seenBgScripts.has(source)) { seenBgScripts.add(source); backgroundScripts.push({ script: bg.script, source }); }
  }
  if (bg.css !== undefined && !isPlainObject(bg.css)) fail(`content/backgrounds.json background ${bg.id}: css must be an object`);
  if (!bg.cssSource && (!isPlainObject(bg.css) || !Object.keys(bg.css).length)) fail(`content/backgrounds.json background ${bg.id}: a CSS source file or non-empty css object is required`);
  if (bg.config !== undefined && !isPlainObject(bg.config)) fail(`content/backgrounds.json background ${bg.id}: config must be an object`);
  if (bg.audio !== undefined) fail(`content/backgrounds.json background ${bg.id}: audio is not allowed on Backgrounds; attach audio to the Zone/content instead`);
});

unique(zones.zones, (x) => x.id, "content/zones.json zones");
const zoneOrders = new Set();
const zoneIds = new Set(zones.zones.map((z) => z.id));
const machineIds = new Set();
const mechanicSourceFiles = [];
const seenMechanicSources = new Set();
const mechanicScriptSources = new Map();

const VALID_ZONE_EFFECT_OPS = new Set(["set", "add", "subtract", "multiply", "divide", "min", "max"]);
const SAFE_ZONE_PATH = /^(?!^(?:__proto__|prototype|constructor)(?:\.|$))[A-Za-z0-9_$-]+(?:\.(?!^(?:__proto__|prototype|constructor)$)[A-Za-z0-9_$-]+)*$/;
const jsonSafe = (value) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonSafe);
  if (isPlainObject(value)) return Object.keys(value).every((key) => SAFE_ZONE_PATH.test(key) && jsonSafe(value[key]));
  return false;
};

function readDeclaredVariable(root, target) {
  if (!isPlainObject(root) || typeof target !== "string") return { exists: false, value: undefined };
  const parts = target.split(".");
  let cur = root;
  for (const part of parts) {
    if (!cur || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, part)) return { exists: false, value: undefined };
    cur = cur[part];
  }
  return { exists: true, value: cur };
}

function validateZoneEffects(effects, label, zone) {
  if (effects === undefined || effects === null) return;
  if (!Array.isArray(effects) || !effects.length) fail(`${label}: effects must be a non-empty array when provided`);
  effects.forEach((effect, i) => {
    if (!isPlainObject(effect)) fail(`${label}[${i}]: effect must be an object`);
    if (typeof effect.target !== "string" || !SAFE_ZONE_PATH.test(effect.target)) fail(`${label}[${i}]: target must be a safe variables-relative path`);
    if (!VALID_ZONE_EFFECT_OPS.has(effect.operation)) fail(`${label}[${i}]: unsupported operation: ${effect.operation}`);
    if (!Object.prototype.hasOwnProperty.call(effect, "value") || !jsonSafe(effect.value)) fail(`${label}[${i}]: value must be JSON-safe`);
    if (["add", "subtract", "multiply", "divide", "min", "max"].includes(effect.operation) && !validNumber(effect.value)) fail(`${label}[${i}]: ${effect.operation} requires numeric value`);
    if (effect.operation === "divide" && Number(effect.value) === 0) fail(`${label}[${i}]: divide value must not be zero`);
    const rootKey = effect.target.split(".")[0];
    if (rootKey === "__proto__" || rootKey === "prototype" || rootKey === "constructor") fail(`${label}[${i}]: unsafe target`);
    const declared = readDeclaredVariable(zone.variables, effect.target);
    if (!declared.exists) fail(`${label}[${i}]: target ${effect.target} is not declared in zone.variables`);
    if (effect.operation !== "set" && !validNumber(declared.value)) fail(`${label}[${i}]: ${effect.operation} requires a numeric declared variable at ${effect.target}`);
    if (effect.operation === "set" && declared.value !== null && typeof effect.value !== typeof declared.value && !(typeof declared.value === "number" && validNumber(effect.value))) {
      fail(`${label}[${i}]: set value type does not match declared variable at ${effect.target}`);
    }
  });
}

function validateZoneContentList(list, kind, zone) {
  if (list === undefined) return;
  if (!Array.isArray(list)) fail(`zone ${zone.id}: ${kind} must be an array`);
  unique(list, (x) => x.id, `zone ${zone.id} ${kind}`);
  list.forEach((item) => {
    if (!isPlainObject(item)) fail(`zone ${zone.id} ${kind}: each entry must be an object`);
    if (typeof item.id !== "string" || !item.id.trim()) fail(`zone ${zone.id} ${kind}: id is required`);
    if (typeof item.nameKey !== "string" || !item.nameKey.trim()) fail(`zone ${zone.id} ${kind} ${item.id}: nameKey is required`);
    if (item.descriptionKey !== undefined && typeof item.descriptionKey !== "string") fail(`zone ${zone.id} ${kind} ${item.id}: descriptionKey must be a string`);
    validateAudioConfig(item.audio, `zone ${zone.id} ${kind} ${item.id}`, audioAssets);
    if (item.icon !== undefined && typeof item.icon !== "string") fail(`zone ${zone.id} ${kind} ${item.id}: icon must be a string`);
    if (!Number.isInteger(Number(item.maxLevel)) || Number(item.maxLevel) < 1) fail(`zone ${zone.id} ${kind} ${item.id}: maxLevel must be a positive integer`);
    if (kind === "purchases" && Number(item.maxLevel) !== 1) fail(`zone ${zone.id} purchase ${item.id}: maxLevel must be 1`);
    if (item.cost !== undefined && !isPlainObject(item.cost) && !validNumber(item.cost)) fail(`zone ${zone.id} ${kind} ${item.id}: cost must be a number or object`);
    if (isPlainObject(item.cost)) {
      if (!validNumber(item.cost.base) || Number(item.cost.base) < 0) fail(`zone ${zone.id} ${kind} ${item.id}: cost.base must be non-negative`);
      if (item.cost.growth !== undefined && (!validNumber(item.cost.growth) || Number(item.cost.growth) < 1)) fail(`zone ${zone.id} ${kind} ${item.id}: cost.growth must be >= 1`);
    } else if (item.cost === undefined) fail(`zone ${zone.id} ${kind} ${item.id}: cost is required`);
    if (isPlainObject(item.unlock)) {
      validateRequirements(item.unlock.requirements, `zone ${zone.id} ${kind} ${item.id}.unlock`);
    } else if (item.unlock !== undefined) {
      fail(`zone ${zone.id} ${kind} ${item.id}: unlock must be an object`);
    }
    if (isPlainObject(item.visibility)) {
      if (item.visibility.hidden !== undefined && typeof item.visibility.hidden !== "boolean") fail(`zone ${zone.id} ${kind} ${item.id}: visibility.hidden must be boolean`);
      validateRequirements(item.visibility.requirements, `zone ${zone.id} ${kind} ${item.id}.visibility`);
      if (item.visibility.hidden === true && (!Array.isArray(item.visibility.requirements) || item.visibility.requirements.length < 1)) fail(`zone ${zone.id} ${kind} ${item.id}: hidden content must declare at least one visibility requirement`);
    } else if (item.visibility !== undefined) {
      fail(`zone ${zone.id} ${kind} ${item.id}: visibility must be an object`);
    }
    if (!Array.isArray(item.effects) || !item.effects.length) fail(`zone ${zone.id} ${kind} ${item.id}: effects must be a non-empty array`);
    validateZoneEffects(item.effects, `zone ${zone.id} ${kind} ${item.id}`, zone);
  });
}

zones.zones.forEach((zone, zoneIndex) => {
  if (!Number.isInteger(Number(zone.order)) || Number(zone.order) < 0) fail(`content/zones.json zone ${zone.id}: order must be a non-negative integer`);
  const order = Number(zone.order);
  if (zoneOrders.has(order)) fail(`content/zones.json: duplicate zone order: ${order}`);
  zoneOrders.add(order);
  if (!backgroundIds.has(zone.backgroundId)) fail(`content/zones.json zone ${zone.id}: backgroundId not found: ${zone.backgroundId}`);
  if (!Array.isArray(zone.floors) || zone.floors.length < 1) fail(`content/zones.json zone ${zone.id}: floors[] must contain at least one floor`);
  if (!Array.isArray(zone.machines)) fail(`content/zones.json zone ${zone.id}: machines[] is required`);
  if (!Array.isArray(zone.mechanics) || zone.mechanics.length < 1) fail(`content/zones.json zone ${zone.id}: every Zone must declare at least one JavaScript mechanic`);
  if (!Array.isArray(zone.secrets)) fail(`content/zones.json zone ${zone.id}: secrets[] is required`);
  if (!isPlainObject(zone.theme)) fail(`content/zones.json zone ${zone.id}: theme object is required`);
  validateAudioConfig(zone.audio, `zone ${zone.id}`, audioAssets);
  if (zone.variables !== undefined && !isPlainObject(zone.variables)) fail(`content/zones.json zone ${zone.id}: variables must be an object`);
  if (zone.variables !== undefined && !jsonSafe(zone.variables)) fail(`content/zones.json zone ${zone.id}: variables must contain only JSON-safe values and safe object keys`);
  ["background", "floor", "tileA", "tileB", "grid"].forEach((key) => {
    if (typeof zone.theme[key] !== "string" || !zone.theme[key].trim()) fail(`content/zones.json zone ${zone.id}: theme.${key} must be a non-empty string`);
  });
  if (order > 0 && zone.machines.length !== 2) fail(`content/zones.json zone ${zone.id}: every non-starter Zone must declare exactly 2 Zone machines`);
  if (zone.unlock !== null && !isPlainObject(zone.unlock)) fail(`content/zones.json zone ${zone.id}: unlock must be null or an object`);
  if (order > 0) {
    if (!zone.unlock || !validNumber(zone.unlock.cost) || Number(zone.unlock.cost) < 0) fail(`content/zones.json zone ${zone.id}: non-starter Zone requires a non-negative unlock.cost`);
    if (!Array.isArray(zone.unlock.requirements) || zone.unlock.requirements.length < 1) fail(`content/zones.json zone ${zone.id}: non-starter Zone requires at least one unlock requirement`);
  }
  validateRequirements(zone.unlock && zone.unlock.requirements, `zone ${zone.id}.unlock`);

  unique(zone.floors, (x) => x.id, `zone ${zone.id} floors`);
  unique(zone.machines, (x) => x.id, `zone ${zone.id} machines`);
  unique(zone.mechanics, (x) => x.id, `zone ${zone.id} mechanics`);
  unique(zone.secrets, (x) => x.id, `zone ${zone.id} secrets`);
  validateZoneContentList(zone.upgrades, "upgrades", zone);
  validateZoneContentList(zone.purchases, "purchases", zone);
  const allZoneContentIds = new Set();
  [...(zone.upgrades || []), ...(zone.purchases || [])].forEach((item) => {
    if (allZoneContentIds.has(item.id)) fail(`zone ${zone.id}: duplicate zone content id across upgrades/purchases: ${item.id}`);
    allZoneContentIds.add(item.id);
  });

  zone.floors.forEach((floor) => {
    validateAudioConfig(floor.audio, `zone ${zone.id} floor ${floor.id}`, audioAssets);
    if (floor.unlock !== null && floor.unlock !== undefined) {
      if (!isPlainObject(floor.unlock)) fail(`zone ${zone.id} floor ${floor.id}: unlock must be null/object`);
      validateRequirements(floor.unlock.requirements, `zone ${zone.id} floor ${floor.id}.unlock`);
      if (floor.unlock.cost !== undefined && (!validNumber(floor.unlock.cost) || Number(floor.unlock.cost) < 0)) fail(`zone ${zone.id} floor ${floor.id}.unlock: cost must be a non-negative number`);
      if (floor.unlock.type !== undefined && floor.unlock.type !== "money") fail(`zone ${zone.id} floor ${floor.id}.unlock: legacy type must be money when provided`);
      if (floor.unlock.type === "money" && (!validNumber(floor.unlock.amount) || Number(floor.unlock.amount) < 0)) fail(`zone ${zone.id} floor ${floor.id}.unlock: legacy amount must be a non-negative number`);
    }
  });

  zone.machines.forEach((machine) => {
    if (machineIds.has(machine.id)) fail(`content/zones.json: duplicate machine id across Zones: ${machine.id}`);
    machineIds.add(machine.id);
    if (!validNumber(machine.baseCost) || Number(machine.baseCost) < 0) fail(`zone ${zone.id} machine ${machine.id}: invalid baseCost`);
    if (!validNumber(machine.costGrowth) || Number(machine.costGrowth) < 1) fail(`zone ${zone.id} machine ${machine.id}: costGrowth must be >= 1`);
    if (!validNumber(machine.baseCooldown) || Number(machine.baseCooldown) <= 0) fail(`zone ${zone.id} machine ${machine.id}: invalid baseCooldown`);
    if (!validNumber(machine.baseYield) || Number(machine.baseYield) < 0) fail(`zone ${zone.id} machine ${machine.id}: invalid baseYield`);
    if (machine.zoneId !== undefined && machine.zoneId !== zone.id) fail(`zone ${zone.id} machine ${machine.id}: zoneId must equal its parent Zone`);
    machine.zoneId = zone.id;
    machine.kind = "zone";
    validateAudioConfig(machine.audio, `zone ${zone.id} machine ${machine.id}`, audioAssets);
    if (machine.unlock !== undefined && !isPlainObject(machine.unlock)) fail(`zone ${zone.id} machine ${machine.id}: unlock must be an object`);
    if (!machine.unlock) machine.unlock = {};
    if (machine.unlock.manual === false || machine.unlock.auto === true) fail(`zone ${zone.id} machine ${machine.id}: Zone machines must remain manually unlockable`);
    machine.unlock.manual = true;
    if (!validNumber(machine.unlock.cost) || Number(machine.unlock.cost) < 0) fail(`zone ${zone.id} machine ${machine.id}: unlock.cost must be a non-negative number`);
    validateRequirements(machine.unlock.requirements, `zone ${zone.id} machine ${machine.id}.unlock`);
  });

  zone.mechanics.forEach((mechanic) => {
    if (typeof mechanic.script !== "string" || !mechanic.script.trim()) fail(`zone ${zone.id} mechanic ${mechanic.id}: script id is required`);
    if (typeof mechanic.source !== "string" || !mechanic.source.trim()) fail(`zone ${zone.id} mechanic ${mechanic.id}: JavaScript source file is required`);
    if (typeof mechanic.nameKey !== "string" || !mechanic.nameKey.trim()) fail(`zone ${zone.id} mechanic ${mechanic.id}: nameKey is required`);
    if (typeof mechanic.descriptionKey !== "string" || !mechanic.descriptionKey.trim()) fail(`zone ${zone.id} mechanic ${mechanic.id}: descriptionKey is required`);
    validateMechanicUi(mechanic.ui, `zone ${zone.id} mechanic ${mechanic.id}`);
    validateAudioConfig(mechanic.audio, `zone ${zone.id} mechanic ${mechanic.id}`, audioAssets);
    if (mechanic.visibility !== undefined) {
      if (!isPlainObject(mechanic.visibility)) fail(`zone ${zone.id} mechanic ${mechanic.id}: visibility must be an object`);
      if (mechanic.visibility.hidden !== undefined && typeof mechanic.visibility.hidden !== "boolean") fail(`zone ${zone.id} mechanic ${mechanic.id}: visibility.hidden must be boolean`);
      if (mechanic.visibility.hintKey !== undefined && typeof mechanic.visibility.hintKey !== "string") fail(`zone ${zone.id} mechanic ${mechanic.id}: visibility.hintKey must be a string`);
      validateRequirements(mechanic.visibility.requirements, `zone ${zone.id} mechanic ${mechanic.id}.visibility`);
      if (mechanic.visibility.hidden === true && (!mechanic.visibility.hintKey || !Array.isArray(mechanic.visibility.requirements) || mechanic.visibility.requirements.length < 1)) fail(`zone ${zone.id} mechanic ${mechanic.id}: hidden mechanic must declare hintKey and at least one visibility requirement`);
    }
    const source = assertSafeRelativeSource(mechanic.source, `zone ${zone.id} mechanic ${mechanic.id}.source`);
    const mechanicSourceText = readText(path.resolve(ROOT, source));
    const escapedScript = mechanic.script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const registerPattern = new RegExp(`\\bG\\.Zone\\.registerMechanic\\s*\\(\\s*["']${escapedScript}["']\\s*,`);
    if (!registerPattern.test(mechanicSourceText)) fail(`zone ${zone.id} mechanic ${mechanic.id}: source ${source} does not register mechanic script ${mechanic.script}`);
    const forbiddenMechanicUi = [/\bdocument\b/, /\bquerySelector(?:All)?\b/, /\bcreateElement\b/, /\bgetElementById\b/, /G\.UI\b/, /G\.Render\b/, /\brequestAnimationFrame\b/];
    if (forbiddenMechanicUi.some((rx) => rx.test(mechanicSourceText))) fail(`zone ${zone.id} mechanic ${mechanic.id}: mechanic source must use the Zone mechanic UI contract instead of direct DOM/Render/UI APIs`);
    const existingSource = mechanicScriptSources.get(mechanic.script);
    if (existingSource && existingSource !== source) fail(`content/zones.json: mechanic script ${mechanic.script} maps to multiple source files: ${existingSource} and ${source}`);
    mechanicScriptSources.set(mechanic.script, source);
    if (!seenMechanicSources.has(source)) { seenMechanicSources.add(source); mechanicSourceFiles.push({ script: mechanic.script, source }); }
    if (mechanic.config !== undefined && !isPlainObject(mechanic.config)) fail(`zone ${zone.id} mechanic ${mechanic.id}: config must be an object`);
    if (mechanic.initialState !== undefined && !isPlainObject(mechanic.initialState)) fail(`zone ${zone.id} mechanic ${mechanic.id}: initialState must be an object`);
  });

  zone.secrets.forEach((secret) => {
    validateAudioConfig(secret.audio, `zone ${zone.id} secret ${secret.id}`, audioAssets);
    if (secret.discovery !== undefined) {
      if (!isPlainObject(secret.discovery)) fail(`zone ${zone.id} secret ${secret.id}: discovery must be an object`);
      validateRequirements(secret.discovery.requirements, `zone ${zone.id} secret ${secret.id}.discovery`);
      if (secret.discovery.mechanicId !== undefined && typeof secret.discovery.mechanicId !== "string") fail(`zone ${zone.id} secret ${secret.id}: mechanicId must be a string`);
    }
    if (secret.reward !== undefined && !isPlainObject(secret.reward)) fail(`zone ${zone.id} secret ${secret.id}: reward must be an object`);
  });
});

const sortedZones = [...zones.zones].sort((a, b) => Number(a.order) - Number(b.order));
for (let i = 0; i < sortedZones.length; i++) {
  if (Number(sortedZones[i].order) !== i) fail(`content/zones.json: Zone orders must be contiguous starting at 0; found ${sortedZones[i].order} at index ${i}`);
}

function generatedFile(varName, data, sourceName) {
  return `/* GENERATED FROM ${sourceName} — DO NOT EDIT. */\nwindow.Game = window.Game || {};\nwindow.Game.${varName} = ${JSON.stringify(data, null, 2)};\n`;
}
fs.writeFileSync(ZONE_GENERATED, generatedFile("ZoneContent", zones, "content/zones.json"), "utf8");
fs.writeFileSync(BG_GENERATED, generatedFile("BackgroundContent", backgrounds, "content/backgrounds.json"), "utf8");
fs.writeFileSync(AUDIO_GENERATED, generatedFile("AudioContent", audio, "content/audio.json"), "utf8");

const html = readText(INDEX);
const css = readText(path.join(ROOT, "style.css"));
const scriptTagRe = /<script\s+src=["']([^"']+)["']\s*><\/script>/gi;
const scriptFiles = [];
let match;
while ((match = scriptTagRe.exec(html))) scriptFiles.push(match[1]);
if (!scriptFiles.length) fail("index.html: no local script tags found for build");

const inlineBlock = (label, body) => `\n/* ---- ${label} ---- */\n${body}\n`;
const bundle = [];
const addFile = (file) => bundle.push(inlineBlock(file, readText(path.join(ROOT, file))));
const seenInline = new Set();
const addOnce = (file) => { if (!seenInline.has(file)) { seenInline.add(file); addFile(file); } };

for (const file of scriptFiles) {
  const normalized = file.replace(/\\/g, "/");
  if (normalized === "src/04-zone-mechanic-loader.js" || normalized === "src/04-background-loader.js") continue;
  addOnce(normalized);
  if (normalized === "src/04-zone-framework.js") {
    for (const item of mechanicSourceFiles) addOnce(item.source);
  }
  if (normalized === "src/04-background-core.js") {
    for (const item of backgroundScripts) addOnce(item.source);
  }
}

let out = html;
out = out.replace(/<link\s+rel=["']stylesheet["']\s+href=["']style\.css["']\s*\/?>(?:\s*)/i, `<style>\n${css}\n</style>\n`);
out = out.replace(scriptTagRe, "");
out = out.replace(/<\/body>/i, `<script>\n${bundle.join("\n")}\n</script>\n</body>`);
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "index.html"), out, "utf8");

const AUDIO_OUT_DIR = path.join(OUT_DIR, "assets", "audio");
function copyDirContents(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(targetDir, { recursive: true });
  fs.readdirSync(sourceDir, { withFileTypes: true }).forEach((entry) => {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) copyDirContents(source, target);
    else if (entry.isFile()) fs.copyFileSync(source, target);
  });
}
copyDirContents(path.join(ROOT, "assets", "audio"), AUDIO_OUT_DIR);

const sizeKb = (Buffer.byteLength(out, "utf8") / 1024).toFixed(1);
console.log(`Validated ${sortedZones.length} zone(s), ${machineIds.size} zone machine(s), ${mechanicSourceFiles.length} mechanic source(s), ${backgrounds.backgrounds.length} background(s), ${audio.assets.length} audio asset(s).`);
console.log(`Bundled ${scriptFiles.length} runtime script tag(s), CSS, mechanics and backgrounds into dist/index.html (${sizeKb} KB).`);
