/* ============================================================
   09-render.js — Procedural vector-style Canvas rendering.
   Everything (machines, gears, conveyors, smoke, floating cash)
   is drawn with Canvas primitives — no external art assets.
   Uses object pooling for particles/floating text (perf, spec 15).
   ============================================================ */
(function (G) {
  "use strict";
  const D = G.DATA;
  const E = G.Econ;

  const CELL = 148;         // world-space cell size in px at zoom 1
  const MACHINE_PAD = 14;

  let canvas, ctx, dpr = 1;
  let camera = { x: 0, y: 0, zoom: 1 };
  let hoverSlot = null;
  let selectedSlot = null;
  let timeAcc = 0;

  // ---- Object pools ---------------------------------------------------------
  const MAX_PARTICLES = 220;
  const particles = new Array(MAX_PARTICLES).fill(null).map(() => ({ active: false }));
  const MAX_FLOATERS = 60;
  const floaters = new Array(MAX_FLOATERS).fill(null).map(() => ({ active: false }));

  function spawnParticle(spec) {
    for (let i = 0; i < particles.length; i++) {
      if (!particles[i].active) {
        Object.assign(particles[i], spec, { active: true, age: 0 });
        return;
      }
    }
  }
  function spawnFloater(spec) {
    for (let i = 0; i < floaters.length; i++) {
      if (!floaters[i].active) {
        Object.assign(floaters[i], spec, { active: true, age: 0 });
        return;
      }
    }
  }

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    resize();
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
  }

  function setCamera(c) { camera = c; }
  function setHover(slot) { hoverSlot = slot; }
  function setSelected(slot) { selectedSlot = slot; }

  function worldToScreen(wx, wy) {
    const rect = canvas;
    const cx = rect.width / 2 / dpr;
    const cy = rect.height / 2 / dpr;
    return {
      x: cx + (wx - camera.x) * camera.zoom,
      y: cy + (wy - camera.y) * camera.zoom,
    };
  }
  function screenToWorld(sx, sy) {
    const rect = canvas;
    const cx = rect.width / 2 / dpr;
    const cy = rect.height / 2 / dpr;
    return {
      x: camera.x + (sx - cx) / camera.zoom,
      y: camera.y + (sy - cy) / camera.zoom,
    };
  }

  function gridWorldBounds() {
    const w = D.GRID_COLS * CELL, h = D.GRID_ROWS * CELL;
    return { w, h, x0: -w / 2, y0: -h / 2 };
  }

  function slotWorldPos(r, c) {
    const b = gridWorldBounds();
    return { x: b.x0 + c * CELL + CELL / 2, y: b.y0 + r * CELL + CELL / 2 };
  }

  function slotAtWorld(wx, wy) {
    const b = gridWorldBounds();
    const c = Math.floor((wx - b.x0) / CELL);
    const r = Math.floor((wy - b.y0) / CELL);
    if (r < 0 || r >= D.GRID_ROWS || c < 0 || c >= D.GRID_COLS) return null;
    return { r, c };
  }

  function slotAtScreen(sx, sy) {
    const w = screenToWorld(sx, sy);
    return slotAtWorld(w.x, w.y);
  }

  // ---- Drawing helpers --------------------------------------------------------
  function roundRect(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function drawGear(cx, cy, radius, teeth, rotation, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.fillStyle = color;
    ctx.beginPath();
    const inner = radius * 0.62;
    const toothH = radius * 0.34;
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / teeth / 2;
      const a2 = a0 + (Math.PI * 2) / teeth;
      ctx.lineTo(Math.cos(a0) * radius, Math.sin(a0) * radius);
      ctx.lineTo(Math.cos(a1) * (radius + toothH), Math.sin(a1) * (radius + toothH));
      ctx.lineTo(Math.cos(a2) * radius, Math.sin(a2) * radius);
    }
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, inner, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fill();
    ctx.restore();
  }

  function drawFloorBackground(floor, zoneDef) {
    const theme = zoneDef && zoneDef.theme ? zoneDef.theme : {};
    const b = gridWorldBounds();
    const tl = worldToScreen(b.x0 - CELL * 0.6, b.y0 - CELL * 0.6);
    const br = worldToScreen(b.x0 + b.w + CELL * 0.6, b.y0 + b.h + CELL * 0.6);

    // The DOM Background Core owns the full-zone visual layer. Canvas stays transparent
    // outside the placement floor so CSS backgrounds are visible underneath.
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    // floor slab
    ctx.fillStyle = theme.floor || "#22262f";
    roundRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y, 18 * camera.zoom);
    ctx.fill();

    // grid tiles (checker, subtle)
    for (let r = 0; r < D.GRID_ROWS; r++) {
      for (let c = 0; c < D.GRID_COLS; c++) {
        const p = slotWorldPos(r, c);
        const s = worldToScreen(p.x - CELL / 2, p.y - CELL / 2);
        const size = CELL * camera.zoom;
        ctx.fillStyle = (r + c) % 2 === 0 ? (theme.tileA || "rgba(255,255,255,0.02)") : (theme.tileB || "rgba(255,255,255,0.045)");
        ctx.fillRect(s.x, s.y, size, size);
      }
    }

    // conveyor belts along each row if floor has conveyor level
    if (floor.systems.conveyor > 0) {
      for (let r = 0; r < D.GRID_ROWS; r++) {
        const left = slotWorldPos(r, 0);
        const right = slotWorldPos(r, D.GRID_COLS - 1);
        const sL = worldToScreen(left.x - CELL / 2, left.y + CELL * 0.34);
        const sR = worldToScreen(right.x + CELL / 2, right.y + CELL * 0.44);
        drawConveyorStrip(sL.x, sL.y, sR.x - sL.x, (sR.y - sL.y) + 14 * camera.zoom, floor.systems.conveyor);
      }
    }

    // grid outline
    ctx.strokeStyle = theme.grid || "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let r = 0; r <= D.GRID_ROWS; r++) {
      const p1 = worldToScreen(b.x0, b.y0 + r * CELL);
      const p2 = worldToScreen(b.x0 + b.w, b.y0 + r * CELL);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
    for (let c = 0; c <= D.GRID_COLS; c++) {
      const p1 = worldToScreen(b.x0 + c * CELL, b.y0);
      const p2 = worldToScreen(b.x0 + c * CELL, b.y0 + b.h);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
  }

  function drawConveyorStrip(x, y, w, h, level) {
    ctx.save();
    ctx.fillStyle = "#12151b";
    roundRect(x, y, w, Math.max(6, h * 0.4), 4);
    ctx.fill();
    ctx.strokeStyle = "#3a4250";
    ctx.lineWidth = 2;
    roundRect(x, y, w, Math.max(6, h * 0.4), 4);
    ctx.stroke();
    const dashLen = 18 * camera.zoom;
    const speed = 40 * (1 + level * 0.25);
    const offset = (timeAcc * speed) % (dashLen * 2);
    ctx.strokeStyle = "#ffcf6b";
    ctx.lineWidth = 3;
    ctx.setLineDash([dashLen * 0.5, dashLen * 0.5]);
    ctx.lineDashOffset = -offset;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + Math.max(6, h * 0.4) / 2);
    ctx.lineTo(x + w - 4, y + Math.max(6, h * 0.4) / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawEmptySlot(r, c, tierIdForGhost) {
    const p = slotWorldPos(r, c);
    const s = worldToScreen(p.x, p.y);
    const size = (CELL - MACHINE_PAD * 2) * camera.zoom;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#5865f2";
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    roundRect(s.x - size / 2, s.y - size / 2, size, size, 12 * camera.zoom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#5865f2";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 10 * camera.zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "white";
    ctx.font = `${16 * camera.zoom}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("+", s.x, s.y - 1 * camera.zoom);
    ctx.restore();
  }

  function drawMechanicStatus(status, size, cx, cy) {
    if (!status) return;
    const toneColor = { danger: "#ff6578", warn: "#ffc857", info: "#67d8ff", good: "#6fe39a", muted: "#a2a8b2" }[status.tone] || "#67d8ff";
    ctx.save();
    const alpha = status.variant === "disabled" ? 0.72 : 0.58;
    ctx.globalAlpha = alpha;
    if (status.variant === "disabled") {
      ctx.fillStyle = "rgba(7,20,28,0.72)";
      roundRect(cx - size * 0.45, cy - size * 0.34, size * 0.9, size * 0.68, 8 * camera.zoom);
      ctx.fill();
      ctx.strokeStyle = hexAlpha(toneColor, 0.95);
      ctx.lineWidth = 2 * camera.zoom;
      ctx.setLineDash([6 * camera.zoom, 4 * camera.zoom]);
      roundRect(cx - size * 0.45, cy - size * 0.34, size * 0.9, size * 0.68, 8 * camera.zoom);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (status.variant === "buff") {
      ctx.strokeStyle = hexAlpha(toneColor, 0.95);
      ctx.lineWidth = 3 * camera.zoom;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.46, 0, Math.PI * 2);
      ctx.stroke();
    } else if (status.variant === "warning") {
      ctx.fillStyle = hexAlpha(toneColor, 0.12);
      roundRect(cx - size * 0.45, cy - size * 0.34, size * 0.9, size * 0.68, 8 * camera.zoom);
      ctx.fill();
    }

    const icon = typeof status.icon === "string" ? status.icon : "";
    if (icon) {
      ctx.font = `bold ${Math.max(11, 15 * camera.zoom)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = toneColor;
      ctx.fillText(icon, cx, cy - size * 0.02);
    }
    const label = typeof status.label === "string" ? status.label : "";
    if (label) {
      ctx.font = `bold ${Math.max(8, 8.5 * camera.zoom)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#f4f7fb";
      ctx.fillText(label, cx, cy + size * 0.24, size * 0.78);
    }
    if (Number.isFinite(Number(status.value))) {
      ctx.font = `bold ${Math.max(8, 8 * camera.zoom)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = toneColor;
      const unit = typeof status.valueUnit === "string" ? status.valueUnit : "";
      ctx.fillText(String(status.value) + unit, cx, cy - size * 0.26, size * 0.76);
    }
    if (typeof status.value === "string") {
      ctx.font = `bold ${Math.max(8, 8 * camera.zoom)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = toneColor;
      ctx.fillText(status.value, cx, cy - size * 0.26, size * 0.76);
    }
    if (Number.isFinite(Number(status.progress))) {
      const p = Math.max(0, Math.min(1, Number(status.progress)));
      const barW = size * 0.68, barH = Math.max(2, 3 * camera.zoom);
      const barX = cx - barW / 2, barY = cy + size * 0.34;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = toneColor;
      ctx.fillRect(barX, barY, barW * p, barH);
    }
    ctx.restore();
  }

  function drawMachine(slot, isHover, isSelected, mechanicStatus) {
    const m = slot.machine;
    const machine = D.machineById(m.typeId);
    const tier = D.tierById(m.tierId) || { order: 0, color: "#9aa5ad", glow: "#c7cfd4", particleDensity: 0.5, id: "common" };
    const visual = machine || tier;
    const p = slotWorldPos(slot.r, slot.c);
    const s = worldToScreen(p.x, p.y);
    const size = (CELL - MACHINE_PAD * 2) * camera.zoom;
    const bodyH = size * 0.62;

    ctx.save();

    // glow for higher tiers
    if ((visual.order || 0) >= 2) {
      const grad = ctx.createRadialGradient(s.x, s.y, size * 0.1, s.x, s.y, size * 0.75);
      grad.addColorStop(0, hexAlpha(visual.glow, 0.28));
      grad.addColorStop(1, hexAlpha(visual.glow, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, size * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + size * 0.34, size * 0.38, size * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    // body
    const bx = s.x - size * 0.42, by = s.y - bodyH * 0.55;
    const grad2 = ctx.createLinearGradient(bx, by, bx, by + bodyH);
    grad2.addColorStop(0, shade(visual.color, 18));
    grad2.addColorStop(1, shade(visual.color, -18));
    ctx.fillStyle = grad2;
    roundRect(bx, by, size * 0.84, bodyH, 8 * camera.zoom);
    ctx.fill();
    ctx.strokeStyle = isSelected ? "#ffffff" : isHover ? hexAlpha("#ffffff", 0.6) : "rgba(0,0,0,0.35)";
    ctx.lineWidth = isSelected ? 3 : 1.5;
    roundRect(bx, by, size * 0.84, bodyH, 8 * camera.zoom);
    ctx.stroke();

    // paper output slot
    ctx.fillStyle = "#12151b";
    roundRect(bx + size * 0.1, by + bodyH * 0.62, size * 0.64, bodyH * 0.22, 3 * camera.zoom);
    ctx.fill();
    // paper sliding out animated by progress
    const paperProgress = m.progress;
    ctx.save();
    ctx.beginPath();
    roundRect(bx + size * 0.1, by + bodyH * 0.62, size * 0.64, bodyH * 0.22, 3 * camera.zoom);
    ctx.clip();
    ctx.fillStyle = "#eef1e6";
    const paperW = size * 0.3;
    const px = bx + size * 0.1 + paperProgress * (size * 0.64 + paperW) - paperW;
    ctx.fillRect(px, by + bodyH * 0.62, paperW, bodyH * 0.22);
    ctx.strokeStyle = "#9aa08c";
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(px + (paperW * i) / 3, by + bodyH * 0.66);
      ctx.lineTo(px + (paperW * i) / 3, by + bodyH * 0.8);
      ctx.stroke();
    }
    ctx.restore();

    // gear
    const gearR = size * 0.16;
    const rot = timeAcc * (1.4 + tier.order * 0.5) * (m.banked > 0 ? 1.6 : 1);
    drawGear(s.x + size * 0.24, by + bodyH * 0.28, gearR, 8, rot, shade(visual.color, -35));
    drawGear(s.x + size * 0.24 - gearR * 1.3, by + bodyH * 0.28 + gearR * 0.2, gearR * 0.65, 6, -rot * 1.4, shade(visual.color, -50));

    // Data-driven machine silhouettes. Zone content can opt into a visual shape
    // without adding Zone-id branches to the renderer.
    const visualShape = visual && visual.visual && typeof visual.visual.shape === "string" ? visual.visual.shape : "";
    if (visualShape === "abyssal") {
      ctx.save();
      ctx.translate(s.x + size * 0.03, by + bodyH * 0.28);
      ctx.fillStyle = visual.glow;
      ctx.globalAlpha = 0.95;
      ctx.fillRect(-size * 0.08, -size * 0.04, size * 0.16, size * 0.12);
      ctx.fillRect(-size * 0.055, -size * 0.16, size * 0.11, size * 0.22);
      ctx.strokeStyle = visual.glow;
      ctx.lineWidth = 2 * camera.zoom;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (visualShape === "leviathan") {
      ctx.save();
      ctx.translate(s.x + size * 0.03, by + bodyH * 0.28);
      ctx.strokeStyle = visual.glow;
      ctx.fillStyle = visual.glow;
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 2 * camera.zoom;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, size * (0.08 + i * 0.055), -Math.PI * 0.8, Math.PI * 0.8);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-size * 0.1, 0);
      ctx.lineTo(size * 0.1, 0);
      ctx.lineTo(0, size * 0.09);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (tier.id === "rare") {
      ctx.save(); ctx.translate(s.x + size * 0.03, by + bodyH * 0.28); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = tier.glow; ctx.globalAlpha = 0.9;
      ctx.fillRect(-size * 0.055, -size * 0.055, size * 0.11, size * 0.11); ctx.restore();
    } else if (tier.id === "ascendant") {
      ctx.save(); ctx.translate(s.x + size * 0.03, by + bodyH * 0.28);
      ctx.fillStyle = tier.glow; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(0, -size * 0.09); ctx.lineTo(size * 0.09, size * 0.07); ctx.lineTo(-size * 0.09, size * 0.07); ctx.closePath(); ctx.fill(); ctx.restore();
    } else if (tier.id === "transcendent") {
      ctx.save(); ctx.translate(s.x + size * 0.03, by + bodyH * 0.28);
      ctx.fillStyle = tier.glow; ctx.globalAlpha = 0.95;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const r = i % 2 ? size * 0.045 : size * 0.11; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.closePath(); ctx.fill(); ctx.restore();
    }

    // tier label chip
    ctx.fillStyle = shade(visual.color, -45);
    roundRect(bx + 4 * camera.zoom, by + 4 * camera.zoom, size * 0.28, bodyH * 0.16, 4 * camera.zoom);
    ctx.fill();

    // progress ring (small, top-right)
    const ringR = size * 0.1;
    const ringCx = bx + size * 0.84 - ringR - 4 * camera.zoom;
    const ringCy = by + ringR + 4 * camera.zoom;
    ctx.beginPath();
    ctx.arc(ringCx, ringCy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 3 * camera.zoom;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ringCx, ringCy, ringR, -Math.PI / 2, -Math.PI / 2 + m.progress * Math.PI * 2);
    ctx.strokeStyle = "#ffe27a";
    ctx.lineWidth = 3 * camera.zoom;
    ctx.stroke();

    // banked cash stack indicator
    if (m.banked > 0) {
      const bcx = s.x, bcy = by - 10 * camera.zoom;
      const pulse = 1 + Math.sin(timeAcc * 6) * 0.06;
      ctx.save();
      ctx.translate(bcx, bcy);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = "#2fae59";
      roundRect(-16 * camera.zoom, -10 * camera.zoom, 32 * camera.zoom, 20 * camera.zoom, 3 * camera.zoom);
      ctx.fill();
      ctx.strokeStyle = "#1d7a3d";
      ctx.lineWidth = 1.5;
      roundRect(-16 * camera.zoom, -10 * camera.zoom, 32 * camera.zoom, 20 * camera.zoom, 3 * camera.zoom);
      ctx.stroke();
      ctx.fillStyle = "#eafff0";
      ctx.font = `bold ${11 * camera.zoom}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("$", 0, 1);
      ctx.restore();

      // faint upward cash label
      ctx.fillStyle = "#ffe27a";
      ctx.font = `bold ${12 * camera.zoom}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(E.formatMoney(m.banked), bcx, bcy - 18 * camera.zoom);
    }

    // idle smoke puffs from higher tier machines
    if ((visual.order || 0) >= 1 && Math.random() < 0.02 * (visual.particleDensity || 1)) {
      spawnParticle({
        kind: "smoke",
        x: s.x + (Math.random() - 0.5) * size * 0.3,
        y: by,
        vx: (Math.random() - 0.5) * 6,
        vy: -18 - Math.random() * 10,
        life: 1.4 + Math.random() * 0.6,
        size: 6 * camera.zoom + Math.random() * 4,
        color: "rgba(255,255,255,0.25)",
      });
    }

    if (mechanicStatus) {
      const labelText = mechanicStatus.labelKey && G.i18n ? G.i18n.t(mechanicStatus.labelKey) : "";
      const detailText = mechanicStatus.detailKey && G.i18n ? G.i18n.t(mechanicStatus.detailKey) : "";
      drawMechanicStatus(Object.assign({}, mechanicStatus, { label: labelText, detail: detailText }), size, s.x, s.y);
    }

    ctx.restore();
  }

  function shade(hex, percent) {
    const num = parseInt(hex.replace("#", ""), 16);
    let r = (num >> 16) + Math.round((percent / 100) * 255);
    let g = ((num >> 8) & 0x00ff) + Math.round((percent / 100) * 255);
    let b = (num & 0x0000ff) + Math.round((percent / 100) * 255);
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return `rgb(${r},${g},${b})`;
  }
  function hexAlpha(hex, a) {
    const num = parseInt(hex.replace("#", ""), 16);
    const r = num >> 16, g = (num >> 8) & 0x00ff, b = num & 0x0000ff;
    return `rgba(${r},${g},${b},${a})`;
  }

  function updateAndDrawParticles(dt) {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) { p.active = false; continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.age / p.life;
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.fillStyle = p.color || "rgba(255,255,255,0.3)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 + t * 0.8), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function updateAndDrawFloaters(dt) {
    for (let i = 0; i < floaters.length; i++) {
      const f = floaters[i];
      if (!f.active) continue;
      f.age += dt;
      if (f.age >= f.life) { f.active = false; continue; }
      const t = f.age / f.life;
      const y = f.y - t * 46 * camera.zoom;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.font = `bold ${(f.crit ? 20 : 15) * camera.zoom}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = f.color || "#ffe27a";
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 3;
      ctx.strokeText(f.text, f.x, y);
      ctx.fillText(f.text, f.x, y);
      ctx.restore();
    }
  }

  function spawnCollectFloater(worldX, worldY, amount, crit) {
    const s = worldToScreen(worldX, worldY);
    spawnFloater({ x: s.x, y: s.y, text: (crit ? "\u2605 " : "+") + G.Econ.formatMoney(amount), life: 0.9, crit, color: crit ? "#ff9d3d" : "#8dffb0" });
  }
  function spawnBonusIcon(worldX, worldY) {
    const s = worldToScreen(worldX, worldY);
    spawnFloater({ x: s.x, y: s.y - 30, text: "\u2726 Bonus!", life: 1.6, crit: true, color: "#ff5da2" });
  }

  function drawBonusMarker(slot) {
    const p = slotWorldPos(slot.r, slot.c);
    const s = worldToScreen(p.x, p.y - CELL * 0.42);
    const bob = Math.sin(timeAcc * 4) * 4 * camera.zoom;
    ctx.save();
    ctx.translate(s.x, s.y + bob);
    ctx.rotate(Math.sin(timeAcc * 3) * 0.2);
    ctx.fillStyle = "#ff5da2";
    ctx.beginPath();
    star(0, 0, 5, 14 * camera.zoom, 6 * camera.zoom);
    ctx.fill();
    ctx.strokeStyle = "#ffd3ea";
    ctx.lineWidth = 2;
    star(0, 0, 5, 14 * camera.zoom, 6 * camera.zoom);
    ctx.stroke();
    ctx.restore();
  }
  function star(cx, cy, spikes, outerR, innerR) {
    let rot = (Math.PI / 2) * 3;
    const step = Math.PI / spikes;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
      let x = cx + Math.cos(rot) * outerR, y = cy + Math.sin(rot) * outerR;
      ctx.lineTo(x, y); rot += step;
      x = cx + Math.cos(rot) * innerR; y = cy + Math.sin(rot) * innerR;
      ctx.lineTo(x, y); rot += step;
    }
    ctx.lineTo(cx, cy - outerR);
    ctx.closePath();
  }

  // ---- Main frame render -------------------------------------------------------
  function render(state, floor, dt, bonusSlotKey, mechanicUi) {
    if (!ctx) return;
    timeAcc += dt;
    ctx.save();
    ctx.scale(dpr, dpr);

    const zoneDef = D.zoneById(state.currentZoneId);
    drawFloorBackground(floor, zoneDef);

    const statusMap = new Map();
    ((mechanicUi && mechanicUi.machineStatuses) || []).forEach((status) => {
      const key = status.floorId + ":" + status.r + ":" + status.c;
      const existing = statusMap.get(key);
      if (!existing || (status.priority || 0) >= (existing.priority || 0)) statusMap.set(key, status);
    });

    floor.grid.forEach((slot) => {
      const isHover = hoverSlot && hoverSlot.r === slot.r && hoverSlot.c === slot.c;
      const isSelected = selectedSlot && selectedSlot.r === slot.r && selectedSlot.c === slot.c;
      if (slot.machine) {
        const status = statusMap.get(floor.id + ":" + slot.r + ":" + slot.c) || null;
        drawMachine(slot, isHover, isSelected, status);
        if (bonusSlotKey === slot.r + "_" + slot.c) drawBonusMarker(slot);
      } else {
        drawEmptySlot(slot.r, slot.c);
      }
    });

    updateAndDrawParticles(dt);
    updateAndDrawFloaters(dt);

    ctx.restore();
  }

  G.Render = {
    init, resize, setCamera, setHover, setSelected,
    worldToScreen, screenToWorld, slotAtScreen, slotAtWorld, slotWorldPos, gridWorldBounds,
    render, spawnCollectFloater, spawnBonusIcon, spawnParticle,
    CELL,
  };
})(window.Game = window.Game || {});
