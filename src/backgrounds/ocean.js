/* ============================================================
   bg.ocean behavior — visual-only submerged environment.
   Canvas life layer is intentionally lightweight: one visible canvas,
   one cached static scene, and a small fixed number of animated actors.
   It never touches gameplay state.
   ============================================================ */
(function (G) {
  "use strict";

  const TAU = Math.PI * 2;
  const SPECIES = {
    tide_minnow: {
      accent: "#5fd7f4", secondary: "#2f93c7", highlight: "#b8f5ff",
      mark: "rgba(19,98,142,.50)", glow: 0,
    },
    glassfin_darter: {
      accent: "#56d8c4", secondary: "#258c9d", highlight: "#b6fff5",
      mark: "rgba(220,255,250,.58)", glow: 0,
    },
    moonspot_koi: {
      accent: "#f1dccb", secondary: "#de95ac", highlight: "#fff8ef",
      mark: "#ba6a84", glow: 0,
    },
    abyssal_glowfish: {
      accent: "#a06cff", secondary: "#5d25c7", highlight: "#eedbff",
      mark: "#d7b5ff", glow: 1,
    },
    crown_sea_dragon: {
      accent: "#ff5b79", secondary: "#c62d4f", highlight: "#ffd36b",
      mark: "#ffd36b", glow: 1,
    },
  };

  function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function setVar(element, name, value) {
    if (element && element.style) element.style.setProperty(name, String(value));
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w * .5, h * .5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  class OceanBackground extends G.Background.ZoneBackground {
    onEnter(ctx) {
      this.element = ctx && ctx.element ? ctx.element : null;
      this.rootLayers = [];
      this.pointer = { x: .5, y: .24 };
      this.lastActivity = null;
      this.lastPointerKey = "";
      this.lastVisualAt = -Infinity;
      this.visualClock = 0;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.canvas = null;
      this.ctx = null;
      this.staticCanvas = null;
      this.staticCtx = null;
      this.resizeObserver = null;
      this.staticSeed = 9137;
      this.kelp = [];
      this.coral = [];
      this.fish = [];
      this.bubbles = [];
      this.silt = [];
      this.shafts = [];
      this.reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      this.build();
      this.rebuildActors();
      this.updateActivity(ctx);
    }

    onExit(_ctx) {
      if (this.resizeObserver) this.resizeObserver.disconnect();
      this.resizeObserver = null;
      if (this.element) this.element.replaceChildren();
      this.element = null;
      this.rootLayers = [];
      this.canvas = null;
      this.ctx = null;
      this.staticCanvas = null;
      this.staticCtx = null;
    }

    layer(className) {
      const node = document.createElement("div");
      node.className = "ocean-bg-layer " + className;
      node.setAttribute("aria-hidden", "true");
      this.element.appendChild(node);
      this.rootLayers.push(node);
      return node;
    }

    build() {
      const host = this.element;
      if (!host) return;
      host.replaceChildren();

      const config = this.config || {};
      const haze = this.layer("ocean-depth-haze");
      const hazeNode = document.createElement("div");
      hazeNode.className = "ocean-haze";
      haze.appendChild(hazeNode);

      const lifeLayer = this.layer("ocean-life");
      this.canvas = document.createElement("canvas");
      this.canvas.className = "ocean-life-canvas";
      this.canvas.setAttribute("aria-hidden", "true");
      lifeLayer.appendChild(this.canvas);
      this.ctx = this.canvas.getContext("2d", { alpha: true });

      this.staticCanvas = document.createElement("canvas");
      this.staticCtx = this.staticCanvas.getContext("2d", { alpha: true });

      const floor = this.layer("ocean-seafloor");
      floor.setAttribute("aria-hidden", "true");
      lifeLayer.style.zIndex = "5";

      this.resize();
      if (typeof ResizeObserver === "function") {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(host);
      }
    }

    resize() {
      if (!this.element || !this.canvas || !this.ctx || !this.staticCanvas || !this.staticCtx) return;
      const width = Math.max(1, this.element.clientWidth || window.innerWidth || 1);
      const height = Math.max(1, this.element.clientHeight || window.innerHeight || 1);
      if (width === this.width && height === this.height) return;

      this.width = width;
      this.height = height;
      const maxDpr = width < 900 ? 1.5 : 2;
      this.dpr = clamp(finite(window.devicePixelRatio, 1), 1, maxDpr);
      this.canvas.width = Math.max(1, Math.round(width * this.dpr));
      this.canvas.height = Math.max(1, Math.round(height * this.dpr));
      this.canvas.style.width = width + "px";
      this.canvas.style.height = height + "px";
      this.staticCanvas.width = this.canvas.width;
      this.staticCanvas.height = this.canvas.height;
      this.staticCanvas.style.width = width + "px";
      this.staticCanvas.style.height = height + "px";
      this.drawStaticScene();
      this.buildLightField();
      this.rebuildActors();
    }

    buildLightField() {
      const count = clamp(Math.floor(finite(this.config?.lightShaftCount, 5)), 2, 8);
      const w = this.width;
      const h = this.height;
      this.shafts = [];
      for (let i = 0; i < count; i++) {
        const x = w * (0.06 + (i / Math.max(1, count - 1)) * 0.88);
        this.shafts.push({
          x,
          width: w * (0.035 + (i % 3) * 0.012),
          lean: w * (0.028 + (i % 2) * 0.018),
          phase: i * 1.73 + 0.4,
          speed: 0.10 + (i % 3) * 0.018,
          alpha: 0.050 + (i % 4) * 0.012,
        });
      }
    }

    drawStaticScene() {
      const ctx = this.staticCtx;
      if (!ctx) return;
      const d = this.dpr;
      const w = this.width;
      const h = this.height;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Quiet depth silhouettes at the very bottom. Irregular, hand-drawn-like
      // polygons are used instead of repeated gradients to keep the scene natural.
      const rng = mulberry32(this.staticSeed);
      const floorY = h * .84;
      for (let i = 0; i < 18; i++) {
        const x = (i / 17) * w + (rng() - .5) * w * .035;
        const rw = w * (.025 + rng() * .06);
        const rh = h * (.025 + rng() * .06);
        ctx.fillStyle = `rgba(${18 + (rng() * 18) | 0},${43 + (rng() * 27) | 0},${46 + (rng() * 18) | 0},${.34 + rng() * .16})`;
        ctx.beginPath();
        ctx.ellipse(x, floorY + rng() * h * .13, rw, rh, (rng() - .5) * .8, 0, TAU);
        ctx.fill();
      }

      const rockCount = 9;
      for (let i = 0; i < rockCount; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const x = side === 1 ? w * (.02 + rng() * .13) : w * (.87 + rng() * .11);
        const y = h * (.79 + rng() * .12);
        const rw = w * (.035 + rng() * .055);
        const rh = h * (.018 + rng() * .035);
        const grd = ctx.createLinearGradient(x - rw, y - rh, x + rw, y + rh);
        grd.addColorStop(0, "rgba(38,66,69,.78)");
        grd.addColorStop(1, "rgba(4,19,24,.92)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        const points = 7;
        for (let p = 0; p < points; p++) {
          const a = (p / points) * TAU;
          const rr = 0.72 + rng() * .34;
          const px = x + Math.cos(a) * rw * rr;
          const py = y + Math.sin(a) * rh * rr;
          if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      }

      // A few shallow sand ripples, mostly at the corners so the factory floor remains clear.
      ctx.strokeStyle = "rgba(132,155,133,.055)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const left = i < 4;
        const x0 = left ? w * (.02 + i * .025) : w * (.72 + i * .045);
        const y0 = h * (.88 + (i % 3) * .028);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(x0 + w * .045, y0 - h * .012, x0 + w * .09, y0);
        ctx.stroke();
      }
    }

    rebuildActors() {
      const config = this.config || {};
      const rng = mulberry32(271828);
      const width = Math.max(1, this.width);
      const height = Math.max(1, this.height);
      this.kelp = [];
      this.coral = [];
      this.fish = [];
      this.bubbles = [];
      this.silt = [];

      const kelpCount = clamp(Math.floor(finite(config.kelpCount, 9)), 4, 14);
      for (let i = 0; i < kelpCount; i++) {
        const edgeBias = i % 2 === 0 ? rng() * .25 : .75 + rng() * .25;
        this.kelp.push({
          x: width * clamp(edgeBias + (rng() - .5) * .08, 0, 1),
          h: height * (.18 + rng() * .23),
          scale: .75 + rng() * .5,
          phase: rng() * TAU,
          speed: .55 + rng() * .45,
          width: .55 + rng() * .65,
          tint: i % 3,
        });
      }

      const coralCount = clamp(Math.floor(finite(config.coralCount, 7)), 3, 12);
      for (let i = 0; i < coralCount; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        this.coral.push({
          x: side === 1 ? width * (.05 + rng() * .2) : width * (.75 + rng() * .2),
          y: height * (.78 + rng() * .12),
          scale: .55 + rng() * .75,
          phase: rng() * TAU,
          speed: .35 + rng() * .5,
          hue: i % 4,
        });
      }

      const fishCount = clamp(Math.floor(finite(config.backgroundFishCount, 6)), 3, 8);
      const species = Array.isArray(config.backgroundFishSpecies) && config.backgroundFishSpecies.length
        ? config.backgroundFishSpecies : Object.keys(SPECIES);
      for (let i = 0; i < fishCount; i++) {
        this.fish.push({
          x: rng() * width,
          y: height * (.17 + rng() * .56),
          speed: width * (.018 + rng() * .028) * (rng() < .2 ? .72 : 1),
          scale: .46 + rng() * .72,
          phase: rng() * TAU,
          bob: height * (.008 + rng() * .018),
          dir: rng() < .5 ? 1 : -1,
          species: species[i % species.length],
          opacity: .19 + rng() * .28,
          depth: .6 + rng() * .6,
        });
      }
      this.fish.sort((a, b) => a.depth - b.depth);

      const bubbleCount = clamp(Math.floor(finite(config.backgroundBubbleCount, 16)), 8, 30);
      for (let i = 0; i < bubbleCount; i++) {
        this.bubbles.push({
          x: width * (0.04 + rng() * .92),
          y: height * (0.48 + rng() * .58),
          speed: height * (.018 + rng() * .038),
          drift: width * (.008 + rng() * .02),
          phase: rng() * TAU,
          size: 1.4 + rng() * 4.4,
          opacity: .12 + rng() * .28,
        });
      }

      const siltCount = clamp(Math.floor(finite(config.backgroundSiltCount, 18)), 8, 36);
      for (let i = 0; i < siltCount; i++) {
        this.silt.push({
          x: rng() * width,
          y: height * (.08 + rng() * .82),
          speed: height * (.008 + rng() * .014),
          drift: width * (.002 + rng() * .006),
          phase: rng() * TAU,
          size: .45 + rng() * 1.5,
          opacity: .08 + rng() * .18,
        });
      }
    }

    updateActivity(ctx) {
      const stateView = ctx && ctx.stateView ? ctx.stateView : null;
      const zone = stateView && stateView.zone ? stateView.zone : null;
      const capacity = Math.max(1, finite(zone && zone.gridCapacity, 24));
      const machines = clamp(finite(zone && zone.occupiedMachineCount, 0) / capacity, 0, 1);
      const value = machines.toFixed(3);
      if (value === this.lastActivity) return;
      this.lastActivity = value;
      setVar(this.element, "--ocean-activity", value);
    }

    update(ctx) {
      if (!this.element || !this.canvas || !this.ctx) return;
      this.updateActivity(ctx);
      const dt = Math.max(0, finite(ctx && ctx.dt, 0));
      this.visualClock += dt;

      const targetFps = clamp(finite(this.config.visualFps, 30), 20, 60);
      const minStep = 1 / targetFps;
      if (!this.reducedMotion && this.visualClock - this.lastVisualAt < minStep) return;
      this.lastVisualAt = this.visualClock;

      if (this.width !== (this.element.clientWidth || this.width) || this.height !== (this.element.clientHeight || this.height)) this.resize();

      const px = this.pointer.x * 100;
      const py = this.pointer.y * 100;
      const pxText = px.toFixed(2);
      const pyText = py.toFixed(2);
      const pointerKey = pxText + ":" + pyText;
      if (pointerKey !== this.lastPointerKey) {
        this.lastPointerKey = pointerKey;
        setVar(this.element, "--ocean-pointer-x", pxText + "%");
        setVar(this.element, "--ocean-pointer-y", pyText + "%");
      }

      this.stepActors(dt);
      this.renderScene();
    }

    stepActors(dt) {
      if (this.reducedMotion) return;
      const w = this.width;
      const h = this.height;
      this.fish.forEach((fish) => {
        fish.x += fish.speed * dt * fish.dir * fish.depth;
        fish.y += Math.sin(this.visualClock * .45 + fish.phase) * fish.bob * dt * .9;
        const margin = 90 * fish.scale;
        if (fish.dir > 0 && fish.x > w + margin) fish.x = -margin;
        if (fish.dir < 0 && fish.x < -margin) fish.x = w + margin;
        fish.y = clamp(fish.y, h * .08, h * .73);
      });

      this.bubbles.forEach((bubble) => {
        bubble.y -= bubble.speed * dt;
        bubble.x += Math.sin(this.visualClock * .7 + bubble.phase) * bubble.drift * dt;
        if (bubble.y < -16) {
          bubble.y = h * (.88 + Math.random() * .18);
          bubble.x = w * (.03 + Math.random() * .94);
        }
      });

      this.silt.forEach((dot) => {
        dot.y -= dot.speed * dt;
        dot.x += Math.sin(this.visualClock * .35 + dot.phase) * dot.drift * dt;
        if (dot.y < h * .06) {
          dot.y = h * (.92 + Math.random() * .1);
          dot.x = w * Math.random();
        }
      });
    }

    renderScene() {
      const ctx = this.ctx;
      if (!ctx || !this.width || !this.height) return;
      const d = this.dpr;
      const w = this.width;
      const h = this.height;
      const t = this.visualClock;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, w, h);
      this.drawLightField(ctx, t);
      if (this.staticCanvas) ctx.drawImage(this.staticCanvas, 0, 0, w, h);

      // Vegetation: only edges/bottom. It frames the factory instead of fighting it.
      this.kelp.forEach((item) => this.drawKelp(ctx, item, t));
      this.coral.forEach((item) => this.drawCoral(ctx, item, t));

      // Background fish use the same five Secret-1 species identities/palettes as the UI fish.
      this.fish.forEach((fish) => this.drawFish(ctx, fish, t));
      this.bubbles.forEach((bubble) => this.drawBubble(ctx, bubble));
      this.silt.forEach((dot) => this.drawSilt(ctx, dot));
    }

    drawLightField(ctx, t) {
      if (!ctx || !this.shafts.length) return;
      const w = this.width;
      const h = this.height;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";

      this.shafts.forEach((shaft, i) => {
        const wave = Math.sin(t * shaft.speed + shaft.phase);
        const wave2 = Math.sin(t * (shaft.speed * .63) + shaft.phase * 1.7);
        const centerTop = shaft.x + wave * shaft.lean * .6;
        const centerBottom = shaft.x + wave * shaft.lean + wave2 * shaft.lean * .35;
        const topHalf = shaft.width * (0.8 + (i % 2) * .16);
        const bottomHalf = shaft.width * (1.35 + (i % 3) * .18);
        ctx.globalAlpha = shaft.alpha;
        ctx.fillStyle = i % 3 === 1 ? "rgba(159,239,255,.9)" : "rgba(198,248,255,.9)";
        ctx.beginPath();
        ctx.moveTo(centerTop - topHalf, -8);
        ctx.lineTo(centerTop + topHalf, -8);
        ctx.lineTo(centerBottom + bottomHalf, h * .78);
        ctx.lineTo(centerBottom - bottomHalf, h * .78);
        ctx.closePath();
        ctx.fill();
      });

      // A very subtle moving caustic band; low frequency, no CSS compositor path.
      ctx.globalAlpha = .055;
      ctx.strokeStyle = "rgba(151,239,255,.9)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const y = h * (.10 + i * .105) + Math.sin(t * .15 + i * 1.4) * 8;
        const skew = Math.sin(t * .11 + i) * 18;
        ctx.beginPath();
        ctx.moveTo(-20, y + skew);
        ctx.quadraticCurveTo(w * .32, y - 18 - skew * .35, w * .63, y + 7);
        ctx.quadraticCurveTo(w * .82, y + 20, w + 20, y - 2 + skew * .25);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawKelp(ctx, item, t) {
      const phase = t * item.speed + item.phase;
      const baseY = this.height + 7;
      const stalkH = item.h * item.scale;
      const fronds = 4;
      for (let i = 0; i < fronds; i++) {
        const x = item.x + (i - 1.5) * (7 + item.width * 2);
        const lean = Math.sin(phase + i * .58) * (12 + i * 2) + Math.cos(phase * .63 + i) * 3;
        const topY = baseY - stalkH * (0.72 + i * .065);
        const c1x = x + lean * .12;
        const c2x = x + lean * .62;
        const endX = x + lean;
        const width = 5 + item.width * (i % 2 ? 1.8 : 1.2);
        const grad = ctx.createLinearGradient(x, baseY, endX, topY);
        grad.addColorStop(0, item.tint === 2 ? "rgba(8,58,48,.90)" : "rgba(5,66,48,.94)");
        grad.addColorStop(.55, item.tint === 1 ? "rgba(22,119,79,.78)" : "rgba(18,101,69,.86)");
        grad.addColorStop(1, "rgba(68,160,112,.28)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x - width, baseY);
        ctx.quadraticCurveTo(c1x - width * .4, baseY - stalkH * .28, c2x - width * .65, topY + stalkH * .08);
        ctx.quadraticCurveTo(endX - width * .32, topY - 4, endX, topY);
        ctx.quadraticCurveTo(endX + width * .4, topY - 2, c2x + width * .65, topY + stalkH * .08);
        ctx.quadraticCurveTo(c1x + width * .55, baseY - stalkH * .2, x + width, baseY);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = "rgba(4,31,28,.72)";
      ctx.beginPath();
      ctx.ellipse(item.x, baseY - 2, 19 + item.width * 7, 7, 0, 0, TAU);
      ctx.fill();
    }

    drawCoral(ctx, item, t) {
      const p = t * item.speed + item.phase;
      const palette = [
        ["rgba(198,96,103,.72)", "rgba(112,56,83,.86)"],
        ["rgba(223,145,87,.70)", "rgba(116,64,53,.86)"],
        ["rgba(123,159,205,.66)", "rgba(48,71,116,.88)"],
        ["rgba(197,125,183,.66)", "rgba(70,50,89,.88)"],
      ][item.hue % 4];
      const sway = Math.sin(p) * (5 + item.scale * 7);
      const branches = 5;
      const baseY = item.y;
      const trunkH = 30 * item.scale;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 0; i < branches; i++) {
        const x = item.x + (i - 2) * 7 * item.scale;
        const h = trunkH * (.7 + (i % 3) * .14);
        const lean = sway * (.45 + i * .12) + (i - 2) * 2;
        ctx.strokeStyle = palette[1];
        ctx.lineWidth = 3.6 * item.scale;
        ctx.beginPath();
        ctx.moveTo(x, baseY);
        ctx.quadraticCurveTo(x + lean * .35, baseY - h * .48, x + lean, baseY - h);
        ctx.stroke();
        ctx.strokeStyle = palette[0];
        ctx.lineWidth = 1.8 * item.scale;
        ctx.beginPath();
        ctx.moveTo(x, baseY - 2);
        ctx.quadraticCurveTo(x + lean * .35, baseY - h * .48, x + lean, baseY - h);
        ctx.stroke();
        if (i % 2 === 0) {
          ctx.lineWidth = 2.2 * item.scale;
          ctx.beginPath();
          ctx.moveTo(x + lean * .55, baseY - h * .57);
          ctx.quadraticCurveTo(x + lean * .9 - 8, baseY - h * .7, x + lean * .9 - 11, baseY - h * .82);
          ctx.stroke();
        }
      }
      ctx.fillStyle = "rgba(28,43,44,.72)";
      ctx.beginPath();
      ctx.ellipse(item.x, baseY + 2, 15 * item.scale, 5 * item.scale, 0, 0, TAU);
      ctx.fill();
    }

    drawFish(ctx, fish, t) {
      const species = SPECIES[fish.species] || SPECIES.tide_minnow;
      const x = fish.x;
      const y = fish.y + Math.sin(t * .7 + fish.phase) * fish.bob;
      const s = fish.scale * (0.82 + fish.depth * .18);
      const dir = fish.dir;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(dir * s, s);
      ctx.globalAlpha = fish.opacity;

      if (species.glow) {
        const glow = ctx.createRadialGradient(15, -1, 1, 15, -1, 27);
        glow.addColorStop(0, fish.species === "crown_sea_dragon" ? "rgba(255,117,109,.26)" : "rgba(179,130,255,.25)");
        glow.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(14, -1, 27, 0, TAU); ctx.fill();
      }

      // Tail.
      ctx.fillStyle = species.secondary;
      ctx.beginPath();
      ctx.moveTo(-13, 0);
      ctx.lineTo(-28, -11);
      ctx.lineTo(-24, 0);
      ctx.lineTo(-28, 11);
      ctx.closePath();
      ctx.fill();

      // Body.
      const body = ctx.createLinearGradient(-10, -10, 19, 9);
      body.addColorStop(0, species.highlight);
      body.addColorStop(.4, species.accent);
      body.addColorStop(1, species.secondary);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(5, 0, 19, 9.5, 0, 0, TAU);
      ctx.fill();

      // Fins.
      ctx.fillStyle = species.accent;
      ctx.beginPath();
      if (fish.species === "crown_sea_dragon") {
        ctx.moveTo(5, -7); ctx.lineTo(2, -19); ctx.lineTo(8, -13); ctx.lineTo(13, -22); ctx.lineTo(14, -9); ctx.closePath();
      } else {
        ctx.moveTo(4, -7); ctx.quadraticCurveTo(1, -17, 10, -10); ctx.closePath();
      }
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(4, 7); ctx.quadraticCurveTo(0, 15, 11, 9); ctx.closePath();
      ctx.fill();

      // Species markings, matching Secret 1 identities.
      ctx.fillStyle = species.mark;
      if (fish.species === "tide_minnow") {
        for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(2 + i * 5, 0); ctx.rotate(.36); ctx.fillRect(-1.5, -6, 3, 12); ctx.restore(); }
      } else if (fish.species === "glassfin_darter") {
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(1 + i * 7, -1 + (i % 2) * 2, 3.6, 1.1, .15, 0, TAU); ctx.fill(); }
      } else if (fish.species === "moonspot_koi") {
        ctx.beginPath(); ctx.arc(2, -1, 3.2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(10, 3, 4.1, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(15, -3, 2.2, 0, TAU); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(2, -2, 2.8, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(10, 3, 2.2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(15, -2, 1.7, 0, TAU); ctx.fill();
      }

      // Eye + shine.
      ctx.fillStyle = "rgba(250,255,255,.92)";
      ctx.beginPath(); ctx.arc(18, -3, 2.4, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(18,27,34,.90)";
      ctx.beginPath(); ctx.arc(19, -3, .95, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.22)";
      ctx.beginPath(); ctx.ellipse(5, -4, 9, 1.6, -.16, 0, TAU); ctx.fill();

      ctx.restore();
    }

    drawBubble(ctx, bubble) {
      ctx.globalAlpha = bubble.opacity;
      ctx.strokeStyle = "rgba(206,248,255,.72)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(bubble.x, bubble.y, bubble.size, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.34)";
      ctx.beginPath();
      ctx.arc(bubble.x - bubble.size * .26, bubble.y - bubble.size * .32, Math.max(.45, bubble.size * .2), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    drawSilt(ctx, dot) {
      ctx.globalAlpha = dot.opacity;
      ctx.fillStyle = "rgba(186,228,235,.8)";
      ctx.beginPath(); ctx.arc(dot.x, dot.y, dot.size, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }

    onPointerMove(ctx) {
      if (!ctx) return;
      const width = Math.max(1, window.innerWidth || 1);
      const height = Math.max(1, window.innerHeight || 1);
      const nextX = clamp(finite(ctx.x, width * .5) / width, 0, 1);
      const nextY = clamp(finite(ctx.y, height * .24) / height, 0, 1);
      if (nextX === this.pointer.x && nextY === this.pointer.y) return;
      this.pointer.x = nextX;
      this.pointer.y = nextY;
    }
  }

  G.Background.registerBackground("ocean.abyss", OceanBackground);
})(window.Game = window.Game || {});
