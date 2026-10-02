/* ============================================================
   03-save.js — LocalStorage persistence layer.
   Defensive: any corrupt/missing/invalid data falls back to safe
   defaults (via Game.State.sanitizeState) rather than crashing.
   ============================================================ */
(function (G) {
  "use strict";

  const SAVE_KEY = "moneyFactoryTycoon.save";
  const LEGACY_SAVE_KEYS = ["moneyFactoryTycoon.save.v1"];
  const AUTOSAVE_INTERVAL_SEC = 20;

  function isStorageAvailable() {
    try {
      const k = "__mft_test__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  const storageAvailable = isStorageAvailable();

  function save(state) {
    if (!storageAvailable || !state || typeof state !== "object") return false;
    const criticalNumbers = ["money", "totalEarned", "lifetimeEarned", "maxMoney", "research"];
    if (criticalNumbers.some((key) => typeof state[key] !== "number" || !Number.isFinite(state[key]))) {
      console.warn("Save skipped because a critical numeric field is invalid; preserving the previous save.");
      return false;
    }
    try {
      state.lastSaveTime = Date.now();
      const json = JSON.stringify(state);
      if (!json) return false;
      window.localStorage.setItem(SAVE_KEY, json);
      return true;
    } catch (e) {
      console.error("Save failed:", e);
      return false;
    }
  }

  function migrateRawSave(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const versionValue = Number(raw.saveVersion);
    const version = Number.isFinite(versionValue) && versionValue > 0 ? Math.floor(versionValue) : 1;
    if (version > G.State.SAVE_VERSION) return null;
    const migrated = JSON.parse(JSON.stringify(raw));
    // Historical saves are intentionally normalized through the current sanitizer.
    // Version gates live here so future schema changes have an explicit migration home.
    migrated.saveVersion = G.State.SAVE_VERSION;
    return migrated;
  }

  function loadRaw() {
    if (!storageAvailable) return null;
    const keys = [SAVE_KEY, ...LEGACY_SAVE_KEYS];
    for (const key of keys) {
      try {
        const json = window.localStorage.getItem(key);
        if (!json) continue;
        const raw = JSON.parse(json);
        const migrated = migrateRawSave(raw);
        if (migrated) return migrated;
      } catch (e) {
        console.error("Save data corrupt, ignoring candidate:", key, e);
      }
    }
    return null;
  }

  // Returns { state, isNewGame }
  function load() {
    const raw = loadRaw();
    const state = G.State.sanitizeState(raw);
    const isNewGame = !raw;
    return { state, isNewGame };
  }

  function hardReset() {
    if (storageAvailable) {
      try {
        [SAVE_KEY, ...LEGACY_SAVE_KEYS].forEach((key) => window.localStorage.removeItem(key));
      } catch (e) { /* ignore */ }
    }
    return G.State.defaultState();
  }

  function exportSave(state) {
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    } catch (e) {
      return null;
    }
  }

  function isLikelySave(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const hasSkills = raw.skills && typeof raw.skills === "object" && !Array.isArray(raw.skills);
    const hasLegacyProgress = raw.prestige && typeof raw.prestige === "object" && !Array.isArray(raw.prestige);
    const hasRooms = raw.rooms && typeof raw.rooms === "object" && !Array.isArray(raw.rooms);
    return typeof raw.money === "number" && Number.isFinite(raw.money)
      && Array.isArray(raw.zones)
      && raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings)
      && (hasSkills || hasLegacyProgress)
      && hasRooms;
  }

  function importSave(base64) {
    try {
      if (typeof base64 !== "string" || !base64.trim()) return null;
      const json = decodeURIComponent(escape(atob(base64.trim())));
      const raw = JSON.parse(json);
      if (!isLikelySave(raw)) return null;
      const migrated = migrateRawSave(raw);
      if (!migrated) return null;
      return G.State.sanitizeState(migrated);
    } catch (e) {
      console.error("Import failed:", e);
      return null;
    }
  }

  G.Save = {
    SAVE_KEY, LEGACY_SAVE_KEYS, AUTOSAVE_INTERVAL_SEC, storageAvailable,
    save, load, loadRaw, hardReset, exportSave, importSave, isLikelySave,
  };
})(window.Game = window.Game || {});
