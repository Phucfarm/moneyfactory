/* ============================================================
   10-input.js — Adaptive input: keyboard, mouse and touch controls.
   ============================================================ */
(function (G) {
  "use strict";

  const PAN_SPEED = 620; // world units/sec at zoom 1
  const ZOOM_MIN = 0.55;
  // Small touch screens need a little more zoom-out range to keep the full
  // 6x4 factory floor visible after the compact mobile HUD is applied.
  const ZOOM_MIN_MOBILE = 0.34;
  const ZOOM_MAX = 2.8;

  let canvas;
  let camera = { x: 0, y: 0, zoom: 1 };
  let keys = {};
  let dragging = false, dragMoved = false, lastPointer = null;
  let callbacks = {};

  function screenPointFromClient(clientX, clientY) {
    if (callbacks.screenPointFromClient) return callbacks.screenPointFromClient(clientX, clientY);
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    return { x, y, inside: x >= 0 && x <= rect.width && y >= 0 && y <= rect.height };
  }

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
    if (e.code === "Escape") {
      callbacks.onEscape && callbacks.onEscape();
      clearKeys();
      e.preventDefault();
      return;
    }
    if (isTypingTarget(e.target)) return;
    if (callbacks.isInputBlocked && callbacks.isInputBlocked()) return;
    if (e.code === "Space") {
      if (e.repeat || isInteractiveTarget(e.target)) return;
      e.preventDefault();
      callbacks.onCollectNearest && callbacks.onCollectNearest();
      return;
    }
    keys[e.code] = true;
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
  function isInteractiveTarget(el) {
    return !!(el && (el.closest?.("button, a, [role=button], select, summary") || el.tagName === "BUTTON"));
  }

  function getZoomMin() {
    return isTouchDevice() ? ZOOM_MIN_MOBILE : ZOOM_MIN;
  }

  function clampZoom(value) {
    const min = getZoomMin();
    return Math.max(min, Math.min(ZOOM_MAX, Number(value) || 1));
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    dragging = true; dragMoved = false;
    lastPointer = { x: e.clientX, y: e.clientY };
  }
  function onMouseMove(e) {
    if (!dragging) {
      if (e.target !== canvas) {
        callbacks.onHoverScreen && callbacks.onHoverScreen(-1, -1);
        return;
      }
      const point = screenPointFromClient(e.clientX, e.clientY);
      callbacks.onHoverScreen && callbacks.onHoverScreen(point.x, point.y);
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
    if (e.button !== 0) return;
    if (dragging && !dragMoved && e.target === canvas) {
      const point = screenPointFromClient(e.clientX, e.clientY);
      if (point.inside) callbacks.onTapScreen && callbacks.onTapScreen(point.x, point.y);
    }
    dragging = false;
    dragMoved = false;
  }
  function onWheel(e) {
    e.preventDefault();
    const rect = callbacks.getViewportRect ? callbacks.getViewportRect() : canvas.getBoundingClientRect();
    const point = screenPointFromClient(e.clientX, e.clientY);
    const unitScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
    const factor = Math.exp(-e.deltaY * unitScale * 0.0012);
    zoomAt(camera.zoom * factor, point.x, point.y, rect);
  }
  function zoomAt(newZoom, screenX, screenY, rect) {
    newZoom = clampZoom(newZoom);
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
      camera.zoom = clampZoom(touchState.startZoom * factor);
      callbacks.onCameraChanged && callbacks.onCameraChanged();
    }
  }
  function onTouchEnd(e) {
    e.preventDefault();
    if (touchState.mode === "pan" && !touchState.moved && e.changedTouches.length === 1) {
      const t = e.changedTouches[0];
      const point = screenPointFromClient(t.clientX, t.clientY);
      if (point.inside) callbacks.onTapScreen && callbacks.onTapScreen(point.x, point.y);
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
  function setCameraRef(newCamera) {
    camera = newCamera || camera;
    if (camera && typeof camera.zoom === "number") camera.zoom = clampZoom(camera.zoom);
  }

  G.Input = { init, update, isLandscape, isTouchDevice, setCameraRef, getZoomMin, ZOOM_MIN, ZOOM_MIN_MOBILE, ZOOM_MAX };
})(window.Game = window.Game || {});
