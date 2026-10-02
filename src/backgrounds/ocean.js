/* ============================================================
   bg.ocean behavior — visual-only submerged environment.
   Receives the Background Core read-only stateView snapshot.
   It never touches gameplay state or gameplay services.
   ============================================================ */
(function (G) {
  "use strict";

  function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function setVar(element, name, value) {
    if (element && element.style) element.style.setProperty(name, String(value));
  }

  class OceanBackground extends G.Background.ZoneBackground {
    onEnter(ctx) {
      this.element = ctx && ctx.element ? ctx.element : null;
      this.rootLayers = [];
      this.pointer = { x: 0.5, y: 0.24 };
      this.lastVisualUpdate = -Infinity;
      this.build();
      this.updateActivity(ctx);
    }

    onExit(_ctx) {
      if (this.element) this.element.replaceChildren();
      this.element = null;
      this.rootLayers = [];
    }

    build() {
      const host = this.element;
      if (!host) return;
      host.replaceChildren();
      const config = this.config || {};
      const layer = (className) => {
        const node = document.createElement("div");
        node.className = "ocean-bg-layer " + className;
        node.setAttribute("aria-hidden", "true");
        host.appendChild(node);
        this.rootLayers.push(node);
        return node;
      };

      const lightLayer = layer("ocean-light-shafts");
      const shaftCount = clamp(Math.floor(finite(config.lightShaftCount, 5)), 2, 8);
      for (let i = 0; i < shaftCount; i++) {
        const shaft = document.createElement("div");
        shaft.className = "ocean-shaft";
        shaft.style.left = (7 + i * (86 / Math.max(1, shaftCount - 1))) + "%";
        shaft.style.animationDelay = (-i * 1.7) + "s";
        shaft.style.transform = "rotate(" + (-9 + i * 4.5) + "deg)";
        lightLayer.appendChild(shaft);
      }

      const haze = layer("ocean-depth-haze");
      const hazeNode = document.createElement("div");
      hazeNode.className = "ocean-haze";
      haze.appendChild(hazeNode);

      const siltLayer = layer("ocean-silt");
      const siltCount = clamp(Math.floor(finite(config.siltCount, 30)), 12, 72);
      for (let i = 0; i < siltCount; i++) {
        const dot = document.createElement("div");
        dot.className = "ocean-silt-dot";
        const size = 1 + (i % 4) * 0.6;
        dot.style.setProperty("--silt-size", size + "px");
        dot.style.setProperty("--silt-left", ((i * 37) % 101) + "%");
        dot.style.setProperty("--silt-top", (20 + ((i * 53) % 89)) + "%");
        dot.style.setProperty("--silt-opacity", (0.16 + ((i * 17) % 26) / 100).toFixed(2));
        dot.style.setProperty("--silt-duration", (7 + ((i * 11) % 12)) + "s");
        dot.style.setProperty("--silt-delay", (-((i * 1.9) % 15)).toFixed(2) + "s");
        dot.style.setProperty("--silt-drift-x", (((i * 29) % 54) - 27) + "px");
        siltLayer.appendChild(dot);
      }

      const bubbleLayer = layer("ocean-bubbles");
      const bubbleCount = clamp(Math.floor(finite(config.bubbleCount, 18)), 8, 42);
      for (let i = 0; i < bubbleCount; i++) {
        const bubble = document.createElement("div");
        bubble.className = "ocean-bubble";
        bubble.style.setProperty("--bubble-left", ((i * 47) % 101) + "%");
        bubble.style.setProperty("--bubble-size", (2.5 + ((i * 13) % 8)) + "px");
        bubble.style.setProperty("--bubble-opacity", (0.18 + ((i * 7) % 23) / 100).toFixed(2));
        bubble.style.setProperty("--bubble-duration", (8 + ((i * 17) % 15)) + "s");
        bubble.style.setProperty("--bubble-delay", (-((i * 2.1) % 17)).toFixed(2) + "s");
        bubble.style.setProperty("--bubble-drift-x", (((i * 31) % 68) - 34) + "px");
        bubbleLayer.appendChild(bubble);
      }

      const kelpLayer = layer("ocean-kelp");
      const clumpCount = clamp(Math.floor(finite(config.kelpClumpCount, 8)), 3, 14);
      for (let i = 0; i < clumpCount; i++) {
        const clump = document.createElement("div");
        clump.className = "ocean-kelp-clump";
        clump.style.setProperty("--kelp-left", (2 + (i * 79) % 98) + "%");
        clump.style.setProperty("--kelp-height", (18 + ((i * 23) % 28)) + "vh");
        clump.style.setProperty("--kelp-duration", (4.8 + ((i * 7) % 27) / 10) + "s");
        clump.style.setProperty("--kelp-delay", (-((i * 1.4) % 6.5)).toFixed(2) + "s");
        const frondCount = 3 + (i % 3);
        for (let j = 0; j < frondCount; j++) {
          const frond = document.createElement("div");
          frond.className = "ocean-kelp-frond";
          frond.style.setProperty("--frond-left", (28 + j * (44 / Math.max(1, frondCount - 1))) + "%");
          frond.style.setProperty("--frond-width", (8 + ((i + j) % 5) * 2) + "px");
          frond.style.setProperty("--frond-height", (54 + ((i * 17 + j * 11) % 39)) + "%");
          frond.style.setProperty("--frond-rotate", (-9 + j * 6 - (i % 2 ? 2 : 0)) + "deg");
          frond.style.setProperty("--frond-duration", (2.8 + ((i + j) % 5) * .35) + "s");
          frond.style.setProperty("--frond-delay", (-((i + j) * .32) % 2.7).toFixed(2) + "s");
          clump.appendChild(frond);
        }
        const base = document.createElement("div");
        base.className = "ocean-kelp-base";
        clump.appendChild(base);
        kelpLayer.appendChild(clump);
      }

      const floor = layer("ocean-seafloor");
      floor.setAttribute("aria-hidden", "true");
    }

    updateActivity(ctx) {
      const stateView = ctx && ctx.stateView ? ctx.stateView : null;
      const zone = stateView && stateView.zone ? stateView.zone : null;
      const capacity = Math.max(1, finite(zone && zone.gridCapacity, 24));
      const machines = clamp(finite(zone && zone.occupiedMachineCount, 0) / capacity, 0, 1);
      setVar(this.element, "--ocean-activity", machines.toFixed(3));
    }

    update(ctx) {
      if (!this.element) return;
      this.updateActivity(ctx);
      const now = performance.now();
      if (now - this.lastVisualUpdate < 33) return;
      this.lastVisualUpdate = now;
      const px = this.pointer.x * 100;
      const py = this.pointer.y * 100;
      setVar(this.element, "--ocean-pointer-x", px.toFixed(2) + "%");
      setVar(this.element, "--ocean-pointer-y", py.toFixed(2) + "%");
      const tilt = ((px - 50) * 0.018).toFixed(3);
      this.rootLayers.forEach((layer, index) => {
        if (!layer || index === 5) return;
        const depth = 0.2 + index * 0.12;
        layer.style.transform = "translate3d(" + ((50 - px) * depth).toFixed(2) + "px," + ((24 - py) * depth).toFixed(2) + "px,0) rotate(" + tilt + "deg)";
      });
    }

    onPointerMove(ctx) {
      if (!ctx) return;
      const width = Math.max(1, window.innerWidth || 1);
      const height = Math.max(1, window.innerHeight || 1);
      this.pointer.x = clamp(finite(ctx.x, width * 0.5) / width, 0, 1);
      this.pointer.y = clamp(finite(ctx.y, height * 0.24) / height, 0, 1);
    }
  }

  G.Background.registerBackground("ocean.abyss", OceanBackground);
})(window.Game = window.Game || {});
