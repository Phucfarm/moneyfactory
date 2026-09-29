/* ============================================================
   03-save.js — LocalStorage persistence layer.
   Defensive: any corrupt/missing/invalid data falls back to safe
   defaults (via Game.State.sanitizeState) rather than crashing.
   ============================================================ */
(function (G) {
  "use strict";

  const SAVE_KEY = "moneyFactoryTycoon.save.v1";
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
    if (!storageAvailable) return false;
    try {
      state.lastSaveTime = Date.now();
      const json = JSON.stringify(state);
      window.localStorage.setItem(SAVE_KEY, json);
      return true;
    } catch (e) {
      console.error("Save failed:", e);
      return false;
    }
  }

  function loadRaw() {
    if (!storageAvailable) return null;
    try {
      const json = window.localStorage.getItem(SAVE_KEY);
      if (!json) return null;
      return JSON.parse(json);
    } catch (e) {
      console.error("Save data corrupt, ignoring and using defaults:", e);
      return null;
    }
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
      try { window.localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
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

  function importSave(base64) {
    try {
      const json = decodeURIComponent(escape(atob(base64.trim())));
      const raw = JSON.parse(json);
      return G.State.sanitizeState(raw);
    } catch (e) {
      console.error("Import failed:", e);
      return null;
    }
  }

  G.Save = {
    SAVE_KEY, AUTOSAVE_INTERVAL_SEC, storageAvailable,
    save, load, loadRaw, hardReset, exportSave, importSave,
  };
})(window.Game = window.Game || {});
