/**
 * Wab Fit — the picture on screen, and the hand on it.
 *
 * One canvas, one WebGL2 pipeline, and three gestures. The pipeline draws the
 * BAKED bitmap under the current parameters; while Compare is held down it
 * draws the ORIGINAL bitmap with neutral parameters instead — the "before" a
 * person is looking for. Zoom 1 fits the whole picture in the stage; 100% is
 * one picture pixel to one CSS pixel.
 *
 *   · two pointers pinch — the span scales the zoom about the fingers and their
 *     midpoint moves the picture, so a pinch lands on one eye and stays there;
 *   · a drag pans: one finger once past fit, and the mouse on a desktop;
 *   · a double-tap (or a double-click) toggles fit and 100%; the wheel zooms.
 *
 * A bitmap is uploaded only when the one under it changed, so a drag uploads
 * nothing and pass one runs only when a number moved.
 */

import { neutralParams } from './ctx.js';
import { createPipeline } from './gl/pipeline.js';

/** Pinch's far end, the double-tap window, tap slop and the stage's padding. */
const MAX_ZOOM = 16;
const TAP_MS = 320;
const TAP_SLOP = 18;
const PAD = 24;

export function init(ctx) {
  const canvas = document.getElementById('view');
  if (!canvas) return;
  const painter = createPipeline(canvas);
  if (!painter) return;
  canvas.style.touchAction = 'none';

  const view = { width: 1, height: 1, zoom: 1, panX: 0, panY: 0 };
  const pointers = new Map();
  let uploaded = null;
  let pinch = null;
  let pan = null;
  let pinched = false;
  let comparing = false;
  let frame = 0;
  let lastTap = 0;
  let lastAt = { x: 0, y: 0 };

  /** The stage's content box in whole CSS pixels: the ground the picture sits in. */
  function measure() {
    const stage = canvas.parentElement;
    const width = stage ? stage.clientWidth : 320;
    const height = stage ? stage.clientHeight : 420;
    view.width = Math.max(1, Math.round(width - PAD));
    view.height = Math.max(1, Math.round(height - PAD));
  }

  /** Screen pixels per picture pixel when the whole picture fits. */
  function fitScale() {
    const source = ctx.baked;
    if (!source || !source.width || !source.height) return 1;
    return Math.min(view.width / source.width, view.height / source.height);
  }

  /** A zoom inside the ends, with the pan dropped when nothing is zoomed. */
  function setZoom(zoom) {
    view.zoom = Math.min(MAX_ZOOM, Math.max(1, zoom));
    if (view.zoom <= 1.001) { view.panX = 0; view.panY = 0; }
  }

  /** Once a frame, whatever moved: the baked photo, or the original while held. */
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(draw);
  }

  /** The baked photo under the parameters, or the original while Compare is held. */
  function draw() {
    frame = 0;
    const bitmap = comparing ? ctx.image : ctx.baked;
    if (!bitmap) return;
    measure();
    if (uploaded !== bitmap) {
      painter.setSource(bitmap);
      uploaded = bitmap;
    }
    painter.render(comparing ? neutralParams() : ctx.params, view);
  }

  /** The two pointers' midpoint and the distance between them. */
  function pinchOf() {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return null;
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  }

  /** A point on the canvas as an offset from its centre, in CSS pixels. */
  function fromCentre(x, y) {
    const box = canvas.getBoundingClientRect();
    return { x: x - (box.left + box.width / 2), y: y - (box.top + box.height / 2) };
  }

  /** A second pointer becomes a pinch; a lone pointer becomes a pan, past fit. */
  canvas.addEventListener('pointerdown', (event) => {
    if (!ctx.image) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const at = pinchOf();
      if (at) pinch = { ...at, zoom: view.zoom, panX: view.panX, panY: view.panY };
      pinched = true;
      pan = null;
    } else {
      pan = view.zoom > 1.001
        ? { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY }
        : null;
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size >= 2) {
      movePinch();
      return;
    }
    if (pan && pointers.size === 1) {
      view.panX = pan.panX + (event.clientX - pan.x);
      view.panY = pan.panY + (event.clientY - pan.y);
      schedule();
    }
  });

  /** The pinch again: the fingers' span scales the zoom about their midpoint. */
  function movePinch() {
    const at = pinchOf();
    if (!pinch || !at) return;
    const zoom = Math.min(MAX_ZOOM, Math.max(1, pinch.zoom * (at.d / pinch.d)));
    const k = zoom / pinch.zoom;
    const grip = fromCentre(pinch.x, pinch.y);
    const now = fromCentre(at.x, at.y);
    view.zoom = zoom;
    view.panX = now.x - (grip.x - pinch.panX) * k;
    view.panY = now.y - (grip.y - pinch.panY) * k;
    if (view.zoom <= 1.001) { view.panX = 0; view.panY = 0; }
    schedule();
  }

  for (const done of ['pointerup', 'pointercancel']) {
    canvas.addEventListener(done, (event) => {
      const moved = pan ? Math.hypot(event.clientX - pan.x, event.clientY - pan.y) : 0;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      pan = null;
      if (done === 'pointercancel') return;
      // A pinch is not a tap, and neither is a drag: both forget the last tap.
      if (pinched && pointers.size === 0) pinched = false;
      if (pinched || moved > TAP_SLOP) { lastTap = 0; return; }
      tap(event);
    });
  }

  /** A tap, or the second of two: the second one toggles fit and 100%. */
  function tap(event) {
    const now = Date.now();
    const near = Math.hypot(event.clientX - lastAt.x, event.clientY - lastAt.y) <= TAP_SLOP;
    if (now - lastTap <= TAP_MS && near) {
      lastTap = 0;
      toggle(event.clientX, event.clientY);
      return;
    }
    lastTap = now;
    lastAt = { x: event.clientX, y: event.clientY };
  }

  /** Fit the whole picture, or draw it at 100%: one picture pixel per CSS pixel. */
  function toggle(x, y) {
    if (view.zoom > 1.001) { setZoom(1); schedule(); return; }
    const base = fitScale();
    if (base > 0) zoomAt(x, y, 1 / base);
  }

  /** Zoom about a point: the wheel's version of what two fingers do. */
  function zoomAt(x, y, factor) {
    const before = view.zoom;
    setZoom(before * factor);
    const k = view.zoom / before;
    const at = fromCentre(x, y);
    view.panX = at.x - (at.x - view.panX) * k;
    view.panY = at.y - (at.y - view.panY) * k;
    if (view.zoom <= 1.001) { view.panX = 0; view.panY = 0; }
    schedule();
  }

  canvas.addEventListener('wheel', (event) => {
    if (!ctx.image) return;
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });

  /** A new photo arrives fitted; every other move is a redraw at most. */
  ctx.on('image', () => {
    uploaded = null;
    setZoom(1);
    schedule();
  });
  ctx.on('baked', schedule);
  ctx.on('params', schedule);
  ctx.on('compare', (on) => {
    comparing = on === true;
    schedule();
  });

  window.addEventListener('resize', schedule);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', schedule);
  schedule();
}
