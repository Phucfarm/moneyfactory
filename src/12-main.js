
/* ============================================================
   12-main.js — Game bootstrap + main loop.
   ============================================================ */
(function (G) {
  "use strict";
  const D = G.DATA, E = G.Econ, F = G.Factory;
  let state = null;
  let canvas;
  let bonusSlot = null;
  let lastFrameTime = 0;
  let audioUnlocked = false;
  let critFlashThrottle = 0;
  let hudAccum = 0;

  async function boot() {
    const startScreen = document.getElementById("start-screen");
    const playButton = document.getElementById("start-play");
    const app = document.getElementById("app");
    // The first boot only wires the landing screen. After PLAY hides that screen,
    // the same boot path must continue into the real game initialization instead
    // of wiring another dormant click handler and returning forever.
    if (startScreen && playButton && !startScreen.classList.contains("hidden")) {
      playButton.addEventListener("click", async () => {
        playButton.disabled = true;
        await G.Platform.screen.enterGameMode();
        startScreen.classList.add("hidden");
        app.classList.remove("game-hidden");
        boot();
      }, { once: true });
      return;
    }

    const loaded = G.Save.load();
    state = loaded.state;
    F.resetRuntime();
    G.i18n.setLang(state.settings.lang);

    canvas = document.getElementById("gameCanvas");
    G.Render.init(canvas);
    G.Render.setCamera(state.camera);
    G.Background.sync(state);

    G.Audio.setMusicEnabled(state.settings.music);
    G.Audio.setSfxEnabled(state.settings.sfx);
    G.Audio.setMusicVolume(state.settings.musicVolume);
    G.Audio.setSfxVolume(state.settings.sfxVolume);
    G.Audio.syncZone(state);

    G.Input.init({
      canvas, camera: state.camera,
      callbacks: {
        onCameraChanged: () => {},
        onTapScreen: handleTapScreen,
        onHoverScreen: handleHoverScreen,
        onSelectTierIndex: handleSelectTierIndex,
        onSelectMachineId: handleSelectMachineId,
        onCollectNearest: handleCollectNearest,
        isInputBlocked: () => G.UI.isInputBlocked(),
      },
    });

    G.UI.init(state, { onStateImported: handleImportedState, onAfterAction: () => G.Save.save(state) });
    wireGlobalUi();
    window.addEventListener("resize", () => G.Render.resize());

    const unlock = () => {
      if (audioUnlocked) return;
      audioUnlocked = true;
      G.Audio.unlock();
      G.Audio.syncZone(state);
      if (state.settings.music) G.Audio.startMusic();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: false });
    window.addEventListener("keydown", unlock, { once: false });
    window.addEventListener("touchstart", unlock, { once: false });

    canvas.addEventListener("pointermove", (e) => G.Background.pointerMove(state, e.clientX, e.clientY, e.pointerType));
    canvas.addEventListener("pointerdown", (e) => G.Background.pointerDown(state, e.clientX, e.clientY, e.pointerType));
    window.addEventListener("pointerup", (e) => G.Background.pointerUp(state, e.clientX, e.clientY, e.pointerType));

    setInterval(() => {
      G.Save.save(state);
    }, G.Save.AUTOSAVE_INTERVAL_SEC * 1000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", () => G.Save.save(state));

    requestAnimationFrame(loop);
  }


  function handleVisibilityChange() {
    if (document.visibilityState !== "visible") {
      G.Save.save(state);
      return;
    }
    // No background production is applied. Reset the frame clock on resume so
    // a long background gap cannot distort the first active-frame delta.
    lastFrameTime = performance.now();
  }

  function handleHoverScreen(sx, sy) {
    G.Render.setHover(G.Render.slotAtScreen(sx, sy));
  }

  function handleSelectTierIndex(idx) {
    const tier = D.TIERS[idx];
    if (!tier || !E.tierUnlocked(state, tier.id)) { G.Audio.sfxError(); G.UI.toast(G.i18n.t("tooltip.locked"), "warn"); return; }
    state.selectedTierId = tier.id;
    state.selectedMachineId = "printer_" + tier.id;
    G.UI.refreshTierSelector();
    G.Audio.sfxClick();
  }

  function handleSelectMachineId(machineId) {
    const machine = D.machineById(machineId);
    if (!machine || !G.Zone.isMachineUnlocked(state, machine.id)) {
      G.Audio.sfxError();
      G.UI.toast(G.i18n.t("zone.machineLocked"), "warn");
      return;
    }
    state.selectedMachineId = machine.id;
    if (machine.tierId) state.selectedTierId = machine.tierId;
    G.UI.refreshTierSelector();
    G.UI.refreshZoneMachineSelector();
  }

  function handleTapScreen(sx, sy) {
    const slot = G.Render.slotAtScreen(sx, sy);
    if (!slot) return;
    const floor = F.currentFloor(state);
    const gridSlot = floor && floor.grid.find((s) => s.r === slot.r && s.c === slot.c);
    if (!gridSlot) return;

    if (gridSlot.machine) {
      collectSlot(gridSlot, true);
      return;
    }

    const buildId = state.selectedMachineId || "printer_" + state.selectedTierId;
    const events = [];
    const res = F.placeMachine(state, state.currentZoneId, state.currentFloorId, slot.r, slot.c, buildId, events);
    if (res.ok) {
      const machine = D.machineById(res.machineId);
      const displayName = machine && machine.nameKey ? G.i18n.t(machine.nameKey) : G.i18n.t("tier." + (res.tierId || "common"));
      processEvents(events);
      G.UI.toast(G.i18n.t("notify.machinePlaced", { tier: displayName }));
      G.UI.refreshHUD(); G.UI.refreshTierSelector(); G.UI.refreshZoneMachineSelector();
      return;
    }
    G.Audio.sfxError();
    if (res.reason === "money") G.UI.toast(G.i18n.t("notify.notEnoughMoney"), "warn");
    else if (res.reason === "wrongZone") {
      const required = D.zoneById(res.requiredZoneId);
      G.UI.toast(G.i18n.t("zone.machineWrongZone", { zone: required ? G.i18n.t(required.nameKey) : res.requiredZoneId }), "warn");
    } else if (res.reason === "tierLocked" || res.reason === "machineLocked") G.UI.toast(G.i18n.t("zone.machineLocked"), "warn");
  }

  function collectSlot(gridSlot, selectAfter) {
    const isBonus = bonusSlot && bonusSlot.zoneId === state.currentZoneId && bonusSlot.floorId === state.currentFloorId && bonusSlot.r === gridSlot.r && bonusSlot.c === gridSlot.c;
    const had = gridSlot.machine.banked;
    const events = [];
    const res = F.collectMachine(state, state.currentZoneId, state.currentFloorId, gridSlot.r, gridSlot.c, events);
    if (res.amount > 0) {
      const p = G.Render.slotWorldPos(gridSlot.r, gridSlot.c);
      G.Render.spawnCollectFloater(p.x, p.y - 30, res.amount, false);
      G.Audio.sfxCollect(Math.min(1, res.amount / 1000));
    }
    if (isBonus) {
      const bonusAmount = (had > 0 ? had : E.machineBaseYield(gridSlot.machine, 1, state)) * (1.5 + Math.random() * 2);
      F.grantMoney(state, bonusAmount);
      const p = G.Render.slotWorldPos(gridSlot.r, gridSlot.c);
      G.Render.spawnBonusIcon(p.x, p.y - 30);
      G.Audio.sfxBonus();
      bonusSlot = null;
    }
    processEvents(events);
    if (selectAfter) G.UI.selectSlot(gridSlot);
    G.UI.refreshHUD();
  }

  function handleCollectNearest() {
    const floor = F.currentFloor(state);
    if (!floor) return;
    let best = null, bestDistSq = Infinity;
    floor.grid.forEach((s) => {
      if (!s.machine || s.machine.banked <= 0) return;
      const p = G.Render.slotWorldPos(s.r, s.c);
      const dx = p.x - state.camera.x, dy = p.y - state.camera.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) { best = s; bestDistSq = distSq; }
    });
    if (best) collectSlot(best, false);
  }

  function handleImportedState(newState) {
    state = newState;
    bonusSlot = null;
    F.resetRuntime();
    G.i18n.setLang(state.settings.lang);
    G.Audio.setMusicEnabled(state.settings.music);
    G.Audio.setSfxEnabled(state.settings.sfx);
    G.Audio.setMusicVolume(state.settings.musicVolume);
    G.Audio.setSfxVolume(state.settings.sfxVolume);
    G.Audio.syncZone(state);
    G.Render.setCamera(state.camera);
    G.Input.setCameraRef(state.camera);
    G.Background.sync(state);
    G.UI.setState(state);
    G.UI.closePanel();
    G.Save.save(state);
    G.UI.toast(G.i18n.t("notify.saved"));
  }

  function handleHardReset() {
    state = G.Save.hardReset();
    bonusSlot = null;
    F.resetRuntime();
    G.i18n.setLang(state.settings.lang);
    G.Audio.setMusicEnabled(state.settings.music);
    G.Audio.setSfxEnabled(state.settings.sfx);
    G.Audio.setMusicVolume(state.settings.musicVolume);
    G.Audio.setSfxVolume(state.settings.sfxVolume);
    G.Audio.syncZone(state);
    G.Render.setCamera(state.camera);
    G.Input.setCameraRef(state.camera);
    G.Background.sync(state);
    G.UI.setState(state);
    G.UI.closePanel();
  }

  // DEV CHEAT CODE — REMOVE THIS BUTTON + HANDLER BEFORE RELEASE.
  // Adds $1,000,000 for quick PC/mobile testing only.
  function wireDevCheat() {
    const btn = document.getElementById("dev-cheat-money");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const amount = 1000000;
      // DEV CHEAT CODE: use the normal money grant path so maxMoney-based
      // machine/tier unlock requirements update exactly like earned money.
      if (G.Factory && typeof G.Factory.grantMoney === "function") {
        G.Factory.grantMoney(state, amount);
      } else {
        state.money = Math.max(0, Number(state.money) || 0) + amount;
        state.maxMoney = Math.max(Number(state.maxMoney) || 0, state.money);
      }
      G.Save.save(state);
      G.UI.refreshAll();
      G.Audio.sfxCollect(1);
      G.UI.toast("DEV CHEAT: +$1,000,000", "mechanic", 1600);
    });
  }

  function wireGlobalUi() {
    window.addEventListener("mft:hardreset", handleHardReset);
    wireDevCheat();
  }


  function processEvents(events) {
    const now = performance.now();
    events.forEach((ev) => {
      const audioResult = G.Audio && typeof G.Audio.playEvent === "function" ? G.Audio.playEvent(ev, state) : { replaceDefault: false };
      const suppressDefaultAudio = !!audioResult.replaceDefault;
      if (ev.type === "machinePlaced") {
        if (!suppressDefaultAudio) G.Audio.sfxPlaceMachine();
      } else if (ev.type === "machineCollected" && !ev.automatic) {
        if (!suppressDefaultAudio && ev.amount > 0) G.Audio.sfxCollect(Math.min(1, ev.amount / 1000));
      } else if (ev.type === "zoneUnlocked") {
        if (!suppressDefaultAudio) G.Audio.sfxUnlock();
      } else if (ev.type === "floorUnlocked") {
        if (!suppressDefaultAudio) G.Audio.sfxUnlock();
      } else if (ev.type === "machineUnlocked") {
        if (!suppressDefaultAudio) G.Audio.sfxUnlock();
      } else if (ev.type === "cycle" && ev.crit) {
        if (now - critFlashThrottle > 220) {
          critFlashThrottle = now;
          if (ev.zoneId === state.currentZoneId && ev.floorId === state.currentFloorId) {
            const p = G.Render.slotWorldPos(ev.r, ev.c);
            G.Render.spawnParticle({ kind: "spark", x: p.x, y: p.y, vx: 0, vy: -30, life: 0.5, size: 10, color: "rgba(255,210,90,0.9)" });
            if (!suppressDefaultAudio) G.Audio.sfxCrit();
          }
        }
      } else if (ev.type === "autocollect") {
        if (!suppressDefaultAudio && ev.zoneId === state.currentZoneId && ev.floorId === state.currentFloorId && ev.amount > 0) G.Audio.sfxCollect(Math.min(1, ev.amount / 2000));
      } else if (ev.type === "bonusReady") {
        if (ev.zoneId === state.currentZoneId && ev.floorId === state.currentFloorId) bonusSlot = { zoneId: ev.zoneId, floorId: ev.floorId, r: ev.r, c: ev.c, expiresAt: Date.now() + 30000 };
      } else if (ev.type === "skillPoint") {
        if (!suppressDefaultAudio) G.Audio.sfxUnlock();
        G.UI.toast(G.i18n.t("notify.skillPoint", { amount: ev.amount }));
      } else if (ev.type === "secretDiscovered") {
        if (!suppressDefaultAudio) G.Audio.sfxUnlock();
        const zone = D.zoneById(ev.zoneId);
        const secret = zone && (zone.secrets || []).find((s) => s.id === ev.secretId);
        G.UI.toast(secret ? G.i18n.t("notify.secretDiscovered", { secret: G.i18n.t(secret.nameKey || secret.hintKey) }) : G.i18n.t("notify.secretDiscovered", { secret: ev.secretId }));
        G.UI.refreshOceanFishButton();
      } else if (ev.type === "zoneMechanicUi") {
        if (ev.zoneId === state.currentZoneId) G.UI.showMechanicEvent(ev);
      } else if (ev.type === "mechanicDiscovered") {
        if (!suppressDefaultAudio) G.Audio.sfxUnlock();
        const zone = D.zoneById(ev.zoneId);
        const mechanic = zone && (zone.mechanics || []).find((m) => m.id === ev.mechanicId);
        G.UI.toast(mechanic ? G.i18n.t("notify.mechanicDiscovered", { mechanic: G.i18n.t(mechanic.nameKey) }) : G.i18n.t("notify.mechanicDiscovered", { mechanic: ev.mechanicId }));
      } else if (ev.type === "oceanFishCaught") {
        if (ev.zoneId !== state.currentZoneId || ev.floorId !== state.currentFloorId || !(ev.amount > 0)) return;
        const p = G.Render.slotWorldPos(ev.r, ev.c);
        G.Render.spawnParticle({ kind: "spark", x: p.x, y: p.y - 24, vx: 0, vy: -35, life: 0.7, size: 9, color: "rgba(120,225,255,0.95)" });
        const mechanic = D.zoneById("zone_ocean")?.mechanics?.find((m) => m.id === "ocean_stranded_fish");
        const species = mechanic?.config?.species?.find((fish) => fish.id === ev.speciesId);
        const fishName = species ? G.i18n.t(species.nameKey) : ev.speciesId;
        const caughtLabel = ev.automatic ? G.i18n.t("zoneui.ocean.fishCaughtAuto") : G.i18n.t("zoneui.ocean.fishCaught");
        G.UI.toast(caughtLabel + ": " + fishName + " +" + E.formatMoney(ev.amount), "mechanic", 2200);
        if (!suppressDefaultAudio) G.Audio.sfxBonus();
        G.UI.refreshHUD();
      }
    });
    if (bonusSlot && Date.now() > bonusSlot.expiresAt) bonusSlot = null;
  }

  G.Main = G.Main || {};
  G.Main.processEvents = processEvents;

  function loop(ts) {
    if (!lastFrameTime) lastFrameTime = ts;
    let dt = (ts - lastFrameTime) / 1000;
    lastFrameTime = ts;
    dt = Math.max(0, Math.min(0.25, dt));

    G.Input.update(dt);
    const events = F.tick(state, dt);
    processEvents(events);

    G.Background.sync(state);
    G.Background.update(state, dt);

    const floor = F.currentFloor(state);
    let bonusKey = null;
    if (bonusSlot && bonusSlot.zoneId === state.currentZoneId && bonusSlot.floorId === state.currentFloorId) bonusKey = bonusSlot.r + "_" + bonusSlot.c;
    const mechanicUi = G.Zone.getMechanicUIState(state, state.currentZoneId, state.currentFloorId);
    G.Render.render(state, floor, dt, bonusKey, mechanicUi);
    G.UI.refreshMechanicDecorations(mechanicUi);

    hudAccum += dt;
    if (hudAccum >= 0.15) {
      hudAccum = 0;
      G.UI.refreshHUD();
      if (G.UI.selectedSlot) G.UI.refreshMachinePanelControls();
      if (G.UI.isPanelOpen) G.UI.refreshOpenPanel();
    }
    requestAnimationFrame(loop);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})(window.Game = window.Game || {});
