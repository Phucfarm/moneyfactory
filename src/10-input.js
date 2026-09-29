/* ============================================================
   10-input.js — Adaptive input: keyboard, mouse and touch controls.
   ============================================================ */
(function (G) {
  "use strict";

  const PAN_SPEED = 620; // world units/sec at zoom 1
  const ZOOM_MIN = 0.55, ZOOM_MAX = 2.3;

  let canvas;
  let camera = { x: 0, y: 0, zoom: 1 };
  let keys = {};
  let dragging = false, dragMoved = false, lastPointer = null;
  let callbacks = {};

  function init(opts) {
    canvas = opts.canvas;
    camera = opts.camera;
    callbacks = opts.callbacks || {};

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearKeys);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "visible") clearKeys(); });

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", onTouchCancel, { passive: false });
  }

  function onKeyDown(e) {
    if (isTypingTarget(e.target)) return;
    if (callbacks.isInputBlocked && callbacks.isInputBlocked()) return;
    keys[e.code] = true;
    if (e.code === "Space") {
      e.preventDefault();
      callbacks.onCollectNearest && callbacks.onCollectNearest();
    }
    const numMatch = e.code.match(/^Digit([1-8])$/);
    if (numMatch) {
      callbacks.onSelectTierIndex && callbacks.onSelectTierIndex(parseInt(numMatch[1], 10) - 1);
    }
  }
  function onKeyUp(e) { keys[e.code] = false; }
  function clearKeys() { keys = {}; }
  function isTypingTarget(el) {
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  }

  function onMouseDown(e) {
    dragging = true; dragMoved = false;
    lastPointer = { x: e.clientX, y: e.clientY };
  }
  function onMouseMove(e) {
    if (!dragging) {
      if (e.target !== canvas) {
        callbacks.onHoverScreen && callbacks.onHoverScreen(-1, -1);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      callbacks.onHoverScreen && callbacks.onHoverScreen(e.clientX - rect.left, e.clientY - rect.top);
      return;
    }
    const dx = e.clientX - lastPointer.x, dy = e.clientY - lastPointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
    if (dragMoved) {
      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;
      callbacks.onCameraChanged && callbacks.onCameraChanged();
    }
    lastPointer = { x: e.clientX, y: e.clientY };
  }
  function onMouseUp(e) {
    if (dragging && !dragMoved && e.target === canvas) {
      const rect = canvas.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (inside) callbacks.onTapScreen && callbacks.onTapScreen(e.clientX - rect.left, e.clientY - rect.top);
    }
    dragging = false;
    dragMoved = false;
  }
  function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0012);
    zoomAt(camera.zoom * factor, e.clientX - rect.left, e.clientY - rect.top, rect);
  }
  function zoomAt(newZoom, screenX, screenY, rect) {
    newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
    const cx = rect.width / 2, cy = rect.height / 2;
    const worldX = camera.x + (screenX - cx) / camera.zoom;
    const worldY = camera.y + (screenY - cy) / camera.zoom;
    camera.zoom = newZoom;
    camera.x = worldX - (screenX - cx) / camera.zoom;
    camera.y = worldY - (screenY - cy) / camera.zoom;
    callbacks.onCameraChanged && callbacks.onCameraChanged();
  }

  // ---- Touch on the main canvas: 1 finger = pan/tap, 2 fingers = pinch zoom
  let touchState = { mode: null, startDist: 0, startZoom: 1, startPointer: null, moved: false };
  function touchDist(t0, t1) { return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY); }

  function onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      touchState.mode = "pan";
      touchState.moved = false;
      touchState.startPointer = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      touchState.mode = "pinch";
      touchState.startDist = touchDist(e.touches[0], e.touches[1]);
      touchState.startZoom = camera.zoom;
    }
  }
  function onTouchMove(e) {
    e.preventDefault();
    if (touchState.mode === "pan" && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - touchState.startPointer.x, dy = t.clientY - touchState.startPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) touchState.moved = true;
      if (touchState.moved) {
        camera.x -= dx / camera.zoom;
        camera.y -= dy / camera.zoom;
        callbacks.onCameraChanged && callbacks.onCameraChanged();
      }
      touchState.startPointer = { x: t.clientX, y: t.clientY };
    } else if (touchState.mode === "pinch" && e.touches.length === 2) {
      const d = touchDist(e.touches[0], e.touches[1]);
      const factor = d / (touchState.startDist || d);
      camera.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, touchState.startZoom * factor));
      callbacks.onCameraChanged && callbacks.onCameraChanged();
    }
  }
  function onTouchEnd(e) {
    e.preventDefault();
    if (touchState.mode === "pan" && !touchState.moved && e.changedTouches.length === 1) {
      const rect = canvas.getBoundingClientRect();
      const t = e.changedTouches[0];
      const inside = t.clientX >= rect.left && t.clientX <= rect.right && t.clientY >= rect.top && t.clientY <= rect.bottom;
      if (inside) callbacks.onTapScreen && callbacks.onTapScreen(t.clientX - rect.left, t.clientY - rect.top);
    }
    if (e.touches.length === 1) {
      touchState.mode = "pan";
      touchState.moved = true; // returning from pinch must never become a tap
      touchState.startPointer = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 0) {
      touchState.mode = null;
      touchState.moved = false;
      touchState.startPointer = null;
    }
  }
  function onTouchCancel(e) {
    e.preventDefault();
    touchState.mode = null;
    touchState.moved = false;
    touchState.startPointer = null;
  }

  // ---- Per-frame update: applies held-key pan ---------------------------------
  function update(dt) {
    if (callbacks.isInputBlocked && callbacks.isInputBlocked()) {
      clearKeys();
      return;
    }
    let dx = 0, dy = 0;
    if (keys["KeyW"] || keys["ArrowUp"]) dy -= 1;
    if (keys["KeyS"] || keys["ArrowDown"]) dy += 1;
    if (keys["KeyA"] || keys["ArrowLeft"]) dx -= 1;
    if (keys["KeyD"] || keys["ArrowRight"]) dx += 1;
    const len = Math.hypot(dx, dy);
    if (len > 0.001) {
      dx /= Math.max(1, len); dy /= Math.max(1, len);
      camera.x += dx * PAN_SPEED * dt / camera.zoom;
      camera.y += dy * PAN_SPEED * dt / camera.zoom;
      callbacks.onCameraChanged && callbacks.onCameraChanged();
    }
  }

  function isLandscape() { return window.innerWidth >= window.innerHeight; }
  function isTouchDevice() { return ("ontouchstart" in window) || navigator.maxTouchPoints > 0; }

  // Re-point the module at a new camera object after a hard reset/import.
  // swaps in a brand-new state tree with its own camera sub-object).
  function setCameraRef(newCamera) { camera = newCamera; }

  G.Input = { init, update, isLandscape, isTouchDevice, setCameraRef, ZOOM_MIN, ZOOM_MAX };
})(window.Game = window.Game || {});
