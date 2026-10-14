/* ============================================================
   08-audio.js — Audio Core.

   The Web Audio API remains the backwards-compatible synthesized fallback.
   External assets can be registered in content/audio.json or referenced
   directly from Zone/content JSON via an optional `audio` field.

   External audio is intentionally decoupled from Zone gameplay rules:
   content declares what should play, this core owns loading/playback/volume,
   and Main routes transient game events here.
   ============================================================ */
(function (G) {
  "use strict";

  const D = G.DATA || {};
  const AudioContent = G.AudioContent || { assets: [], events: {} };
  const audioAssets = new Map((Array.isArray(AudioContent.assets) ? AudioContent.assets : [])
    .filter((item) => item && typeof item.id === "string")
    .map((item) => [item.id, item]));

  let ctx = null;
  let masterGain, sfxGain, musicGain;
  let unlocked = false;
  let musicEnabled = true, sfxEnabled = true;
  let musicVolume = 0.35, sfxVolume = 0.7;
  let musicTimer = null;
  let humNodes = new Map(); // key -> {osc, gain}

  let externalMusic = null;
  let externalMusicRef = null;
  let externalMusicSpec = null;
  const musicFadeTimers = new Map();
  const activeSfx = new Set();
  const sfxLastPlayedAt = new Map();

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = sfxVolume;
    sfxGain.connect(masterGain);

    musicGain = ctx.createGain();
    musicGain.gain.value = musicVolume;
    musicGain.connect(masterGain);
    return ctx;
  }

  function unlock() {
    const c = ensureCtx();
    if (c && c.state === "suspended") c.resume().catch(() => {});
    unlocked = true;
    resumeExternalMusic();
    if (musicEnabled && !externalMusicSpec) startSynthMusic();
  }

  function setSfxEnabled(v) { sfxEnabled = !!v; }
  function setMusicEnabled(v) {
    musicEnabled = !!v;
    if (!musicEnabled) stopMusic();
    else resumeMusic();
  }
  function setSfxVolume(v) {
    sfxVolume = Math.max(0, Math.min(1, Number(v) || 0));
    if (sfxGain) sfxGain.gain.value = sfxVolume;
    activeSfx.forEach((entry) => {
      try { entry.node.volume = Math.max(0, Math.min(1, sfxVolume * entry.baseVolume)); } catch (_) {}
    });
  }
  function setMusicVolume(v) {
    musicVolume = Math.max(0, Math.min(1, Number(v) || 0));
    if (musicGain) musicGain.gain.value = musicVolume;
    if (externalMusic && externalMusicSpec) externalMusic.volume = trackVolume(externalMusicSpec);
  }

  // ---- Generic tone helper -------------------------------------------------
  function tone({ freq = 440, type = "sine", dur = 0.15, gain = 0.3, slideTo = null, delay = 0, attack = 0.005, decay = null }) {
    if (!sfxEnabled) return;
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (decay || dur));
    osc.connect(g);
    g.connect(sfxGain);
    osc.start(t0);
    osc.stop(t0 + (decay || dur) + 0.05);
  }

  function noiseBurst({ dur = 0.12, gain = 0.2, delay = 0, filterFreq = 2000 }) {
    if (!sfxEnabled) return;
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const bufferSize = c.sampleRate * dur;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filt = c.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(sfxGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // ---- Existing synthesized SFX (compatibility layer) --------------------
  function sfxClick() { tone({ freq: 700, type: "square", dur: 0.06, gain: 0.15 }); }
  function sfxCollect(amountFactor) {
    const base = 520 + Math.min(1, amountFactor) * 300;
    tone({ freq: base, type: "triangle", dur: 0.12, gain: 0.22, slideTo: base * 1.6 });
    tone({ freq: base * 1.5, type: "sine", dur: 0.18, gain: 0.12, delay: 0.03, slideTo: base * 2 });
  }
  function sfxCrit() {
    tone({ freq: 660, type: "sawtooth", dur: 0.08, gain: 0.2 });
    tone({ freq: 990, type: "sawtooth", dur: 0.12, gain: 0.18, delay: 0.06 });
    tone({ freq: 1320, type: "sine", dur: 0.2, gain: 0.15, delay: 0.12 });
  }
  function sfxPlaceMachine() {
    noiseBurst({ dur: 0.1, gain: 0.25, filterFreq: 1200 });
    tone({ freq: 220, type: "square", dur: 0.1, gain: 0.15, delay: 0.03, slideTo: 440 });
  }
  function sfxUpgrade() {
    [0, 0.07, 0.14].forEach((d, i) => tone({ freq: 440 + i * 160, type: "square", dur: 0.09, gain: 0.16, delay: d }));
  }
  function sfxUnlock() {
    [0, 4, 7, 12].forEach((semitones, i) => tone({ freq: 392 * Math.pow(2, semitones / 12) * 2, type: "triangle", dur: 0.15, gain: 0.18, delay: i * 0.09 }));
  }
  function sfxError() { tone({ freq: 180, type: "sawtooth", dur: 0.18, gain: 0.18, slideTo: 90 }); }
  function sfxTechUnlock() { tone({ freq: 300, type: "sine", dur: 0.25, gain: 0.16, slideTo: 900 }); }
  function sfxBonus() {
    [0, 0.05, 0.1].forEach((d, i) => tone({ freq: 880 + i * 220, type: "sine", dur: 0.12, gain: 0.16, delay: d }));
  }

  // ---- Machine hum loop (per-machine ambient drone, subtle) --------------
  function startHum(key, tierOrder) {
    const c = ensureCtx();
    if (!c || humNodes.has(key)) return;
    if (humNodes.size > 24) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "sine";
    osc.frequency.value = 70 + tierOrder * 12;
    g.gain.value = 0;
    osc.connect(g);
    g.connect(sfxGain);
    osc.start();
    g.gain.linearRampToValueAtTime(0.015 + tierOrder * 0.004, c.currentTime + 0.4);
    humNodes.set(key, { osc, gain: g });
  }
  function stopHum(key) {
    const n = humNodes.get(key);
    if (!n) return;
    const c = ctx;
    try {
      n.gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.3);
      n.osc.stop(c.currentTime + 0.35);
    } catch (_) { /* ignore */ }
    humNodes.delete(key);
  }
  function stopAllHums() { Array.from(humNodes.keys()).forEach(stopHum); }

  // ---- External asset helpers ---------------------------------------------
  function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }
  function catalogAsset(id) { return typeof id === "string" ? audioAssets.get(id) || null : null; }

  function resolveRef(ref, expectedKind) {
    if (typeof ref === "string") {
      const asset = catalogAsset(ref);
      if (asset) return { src: asset.src, kind: asset.kind, base: asset, override: {} };
      return { src: ref, kind: expectedKind || null, base: null, override: {} };
    }
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
    const sourceRef = ref.asset !== undefined ? ref.asset : ref.src;
    if (typeof sourceRef !== "string" || !sourceRef.trim()) return null;
    const asset = ref.asset !== undefined ? catalogAsset(ref.asset) : null;
    if (ref.asset !== undefined && !asset) {
      console.warn("Audio asset not found:", ref.asset);
      return null;
    }
    if (asset && expectedKind && asset.kind !== expectedKind) return null;
    return {
      src: asset ? asset.src : ref.src,
      kind: asset ? asset.kind : (expectedKind || null),
      base: asset,
      override: ref,
    };
  }

  function resolvedSpec(ref, expectedKind) {
    const resolved = resolveRef(ref, expectedKind);
    if (!resolved) return null;
    const base = resolved.base || {};
    const override = resolved.override || {};
    const spec = {
      src: resolved.src,
      kind: resolved.kind,
      volume: clamp01(override.volume !== undefined ? override.volume : (base.volume !== undefined ? base.volume : 1)),
      loop: override.loop !== undefined ? !!override.loop : !!base.loop,
      playbackRate: Math.max(0.05, Math.min(4, Number(override.playbackRate !== undefined ? override.playbackRate : (base.playbackRate !== undefined ? base.playbackRate : 1)) || 1)),
      cooldownMs: Math.max(0, Number(override.cooldownMs) || 0),
      replaceDefault: override.replaceDefault === true,
      activeOnly: override.activeOnly === true,
      fadeInMs: Math.max(0, Number(override.fadeInMs) || 0),
      fadeOutMs: Math.max(0, Number(override.fadeOutMs) || 0),
    };
    return spec;
  }

  function playSfx(ref, context = {}) {
    if (!sfxEnabled || !unlocked || !ref) return { ok: false, replaceDefault: false };
    const spec = resolvedSpec(ref, "sfx");
    if (!spec || !spec.src) return { ok: false, replaceDefault: false };
    if (spec.activeOnly && !isEventActive(context)) return { ok: false, replaceDefault: false };

    const throttleKey = context.throttleKey || null;
    const now = performance.now();
    if (throttleKey && spec.cooldownMs > 0) {
      const last = sfxLastPlayedAt.get(throttleKey) || -Infinity;
      if (now - last < spec.cooldownMs) return { ok: false, replaceDefault: spec.replaceDefault };
      sfxLastPlayedAt.set(throttleKey, now);
    }

    const node = new window.Audio(spec.src);
    node.preload = "auto";
    node.volume = clamp01(sfxVolume * spec.volume);
    node.playbackRate = spec.playbackRate;
    node.loop = !!spec.loop;
    const entry = { node, baseVolume: spec.volume };
    activeSfx.add(entry);
    const cleanup = () => activeSfx.delete(entry);
    node.addEventListener("ended", cleanup, { once: true });
    node.addEventListener("error", cleanup, { once: true });
    const promise = node.play();
    if (promise && typeof promise.catch === "function") promise.catch(() => cleanup());
    return { ok: true, replaceDefault: spec.replaceDefault };
  }

  function isEventActive(context) {
    const ev = context && context.event;
    const state = context && context.activeState;
    if (!ev || !state) return true;
    if (ev.zoneId && ev.zoneId !== state.currentZoneId) return false;
    if (ev.floorId && ev.floorId !== state.currentFloorId) return false;
    return true;
  }

  // ---- Zone music ----------------------------------------------------------
  function trackVolume(spec) { return clamp01(musicVolume * (spec && spec.volume !== undefined ? spec.volume : 1)); }

  function stopSynthMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  function startSynthMusic() {
    if (musicTimer || !musicEnabled || externalMusicSpec || !unlocked) return;
    const c = ensureCtx();
    if (!c) return;
    musicTimer = setInterval(scheduleMusicStep, 260);
  }

  function startExternalMusic() {
    if (!musicEnabled || !externalMusic || !externalMusicSpec || !unlocked) return;
    const node = externalMusic;
    node.volume = 0;
    const promise = node.play();
    if (promise && typeof promise.catch === "function") {
      promise.catch((err) => {
        console.warn("External music could not start:", externalMusicSpec.src, err);
      });
    }
    fadeElement(node, trackVolume(externalMusicSpec), externalMusicSpec.fadeInMs || 0);
  }

  function fadeElement(node, target, duration, done) {
    if (!node) return;
    const previousTimer = musicFadeTimers.get(node);
    if (previousTimer) clearInterval(previousTimer);
    musicFadeTimers.delete(node);
    const from = Number(node.volume) || 0;
    const to = clamp01(target);
    if (!duration) {
      node.volume = to;
      if (typeof done === "function") done();
      return;
    }
    const started = performance.now();
    const timer = setInterval(() => {
      const p = Math.max(0, Math.min(1, (performance.now() - started) / duration));
      node.volume = from + (to - from) * p;
      if (p >= 1) {
        clearInterval(timer);
        musicFadeTimers.delete(node);
        if (typeof done === "function") done();
      }
    }, 16);
    musicFadeTimers.set(node, timer);
  }

  function disposeExternalMusic({ fade = 0 } = {}) {
    const node = externalMusic;
    if (!node) return;

    // Detach the current-track refs immediately. The old element may continue
    // fading out independently while a new external track or synth fallback starts.
    externalMusic = null;
    externalMusicRef = null;
    externalMusicSpec = null;

    const release = () => {
      try { node.pause(); node.currentTime = 0; node.src = ""; node.load?.(); } catch (_) {}
    };
    if (fade > 0 && !node.paused) fadeElement(node, 0, fade, release);
    else release();
  }

  function setMusicTrack(ref) {
    const spec = resolvedSpec(ref, "music");
    if (!spec) {
      disposeExternalMusic({ fade: 250 });
      startSynthMusic();
      return;
    }
    if (externalMusicRef === spec.src && externalMusic) {
      externalMusicSpec = spec;
      externalMusic.volume = trackVolume(spec);
      return;
    }

    const old = externalMusic;
    const oldFade = externalMusicSpec ? externalMusicSpec.fadeOutMs : 0;
    if (old) {
      const finishOld = () => { try { old.pause(); old.currentTime = 0; } catch (_) {} };
      if (oldFade > 0 && !old.paused) fadeElement(old, 0, oldFade, finishOld);
      else finishOld();
    }
    stopSynthMusic();

    const node = new window.Audio(spec.src);
    node.preload = "auto";
    node.loop = spec.loop !== false;
    node.playbackRate = spec.playbackRate;
    node.volume = 0;
    node.addEventListener("error", () => {
      console.warn("External music failed to load; using synthesized fallback:", spec.src);
      if (externalMusic === node) {
        node.pause();
        externalMusic = null;
        externalMusicRef = null;
        externalMusicSpec = null;
        startSynthMusic();
      }
    }, { once: true });

    externalMusic = node;
    externalMusicRef = spec.src;
    externalMusicSpec = spec;
    startExternalMusic();
  }

  function resumeExternalMusic() {
    if (!externalMusic || !externalMusicSpec || !musicEnabled || !unlocked) return;
    const promise = externalMusic.play();
    if (promise && typeof promise.catch === "function") promise.catch(() => {});
    externalMusic.volume = trackVolume(externalMusicSpec);
  }

  function resumeMusic() {
    if (!musicEnabled) return;
    if (externalMusicSpec) startExternalMusic();
    else startSynthMusic();
  }

  function syncZone(state) {
    const zone = state && G.DATA && typeof G.DATA.zoneById === "function" ? G.DATA.zoneById(state.currentZoneId) : null;
    if (!zone || !zone.audio || zone.audio.music === undefined) setMusicTrack(null);
    else setMusicTrack(zone.audio.music);
  }

  function stopMusic() {
    stopSynthMusic();
    if (externalMusic) {
      try { externalMusic.pause(); } catch (_) {}
    }
  }

  // ---- Event -> content audio bindings -----------------------------------
  function collectEventAudio(ev, state) {
    const specs = [];
    const zone = D && typeof D.zoneById === "function" ? D.zoneById(ev && ev.zoneId) : null;
    const audio = (obj) => obj && obj.audio && obj.audio.events && typeof obj.audio.events === "object" ? obj.audio.events : null;
    const add = (events, keys) => {
      if (!events) return;
      for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(events, key)) continue;
        const value = events[key];
        if (Array.isArray(value)) specs.push(...value);
        else specs.push(value);
      }
    };

    const addZoneEvent = (keys) => add(audio(zone), keys);

    if (ev) {
      if (ev.type === "secretDiscovered") {
        const secret = zone && (zone.secrets || []).find((item) => item && item.id === ev.secretId);
        add(audio(secret), ["discover", "secretDiscovered"]);
        addZoneEvent(["secretDiscovered"]);
      } else if (ev.type === "mechanicDiscovered") {
        const mechanic = zone && (zone.mechanics || []).find((item) => item && item.id === ev.mechanicId);
        add(audio(mechanic), ["discover", "mechanicDiscovered"]);
        addZoneEvent(["mechanicDiscovered"]);
      } else if (ev.type === "machinePlaced" || ev.type === "machineCollected" || ev.type === "cycle" || ev.type === "machineUnlocked") {
        const machine = D && typeof D.machineById === "function" ? D.machineById(ev.machineId) : null;
        const keys = ev.type === "cycle" ? (ev.crit ? ["crit", "cycle"] : ["cycle"]) :
          (ev.type === "machinePlaced" ? ["place", "machinePlaced"] :
            (ev.type === "machineCollected" ? ["collect", "machineCollected"] : ["unlock", "machineUnlocked"]));
        add(audio(machine), keys);
        addZoneEvent([ev.type]);
      } else if (ev.type === "floorUnlocked") {
        const floor = D && typeof D.floorById === "function" ? D.floorById(ev.zoneId, ev.floorId) : null;
        add(audio(floor), ["unlock", "floorUnlocked"]);
        addZoneEvent(["floorUnlocked"]);
      } else if (ev.type === "zoneUnlocked") {
        add(audio(zone), ["unlock", "zoneUnlocked"]);
      } else if (ev.type === "oceanFishCaught") {
        const mechanic = zone && (zone.mechanics || []).find((item) => item && item.id === ev.mechanicId);
        add(audio(mechanic), [ev.automatic ? "fishCaughtAuto" : "fishCaught", "oceanFishCaught"]);
        addZoneEvent(["oceanFishCaught"]);
      } else {
        addZoneEvent([ev.type]);
      }
    }

    const globalEvents = AudioContent && AudioContent.events;
    if (globalEvents && ev && Object.prototype.hasOwnProperty.call(globalEvents, ev.type)) {
      const value = globalEvents[ev.type];
      if (Array.isArray(value)) specs.push(...value);
      else specs.push(value);
    }

    return specs;
  }

  function playEvent(ev, state) {
    if (!ev || ev.__audioHandled) return { handled: false, replaceDefault: !!ev?.__audioReplaceDefault };
    const specs = collectEventAudio(ev, state);
    let handled = false;
    let replaceDefault = false;
    specs.forEach((ref, index) => {
      const result = playSfx(ref, {
        event: ev,
        activeState: state,
        throttleKey: ev.type + ":" + (ev.zoneId || "global") + ":" + (ev.floorId || "") + ":" + (ev.machineId || ev.secretId || ev.mechanicId || index),
      });
      if (result.ok) handled = true;
      if (result.replaceDefault) replaceDefault = true;
    });
    ev.__audioHandled = true;
    ev.__audioReplaceDefault = replaceDefault;
    return { handled, replaceDefault };
  }

  // ---- Generative fallback music -----------------------------------------
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
  let musicStep = 0;
  function scheduleMusicStep() {
    if (!musicEnabled || externalMusicSpec) return;
    const c = ensureCtx();
    if (!c) return;
    const root = 220;
    const degree = SCALE[musicStep % SCALE.length];
    const freq = root * Math.pow(2, degree / 12);
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = musicStep % 4 === 0 ? "square" : "triangle";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    osc.connect(g);
    g.connect(musicGain);
    osc.start(t0);
    osc.stop(t0 + 0.25);

    if (musicStep % 8 === 0) {
      const bass = c.createOscillator();
      const bg = c.createGain();
      bass.type = "sine";
      bass.frequency.value = root / 2;
      bg.gain.setValueAtTime(0.0001, t0);
      bg.gain.exponentialRampToValueAtTime(0.18, t0 + 0.03);
      bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      bass.connect(bg);
      bg.connect(musicGain);
      bass.start(t0);
      bass.stop(t0 + 0.55);
    }
    musicStep++;
  }
  function startMusic() { resumeMusic(); }

  G.Audio = {
    unlock,
    setSfxEnabled,
    setMusicEnabled,
    setSfxVolume,
    setMusicVolume,
    syncZone,
    playSfx,
    playEvent,
    setMusicTrack,
    sfxClick,
    sfxCollect,
    sfxCrit,
    sfxPlaceMachine,
    sfxUpgrade,
    sfxUnlock,
    sfxError,
    sfxTechUnlock,
    sfxBonus,
    startHum,
    stopHum,
    stopAllHums,
    startMusic,
    stopMusic,
    get isUnlocked() { return unlocked; },
  };
})(window.Game = window.Game || {});
