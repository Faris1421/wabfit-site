/**
 * Wab Fit — the Erase tool: paint over an object, and MI-GAN takes it out.
 *
 * A finger paints a translucent accent mask over the photograph, a ring showing
 * the brush's width; the eraser takes the paint back. Run hands each separate
 * painted area to the inpainter as its own square region — 512 pixels in, the
 * feather out, mixed over the photograph — and bakes it. The model is streamed
 * from this page's own folder; the picture never leaves the device.
 */
import {
  composite, featherAlpha, maskRGBA, roiForMask, strokeAreas, strokeMask,
} from '../erase-math.js';
import { loadInpainter } from '../ml/inpaint.js';

/** MI-GAN's fixed 512-pixel side, the feather's share, and the brush's ends. */
const SIDE = 512;
const FEATHER = 0.015;
const BRUSH_MIN = 10;
const BRUSH_MAX = 200;
const BRUSH_START = 60;

/** One element with a class, one canvas off the document: what every control wants. */
const el = (tag, className) => Object.assign(document.createElement(tag), { className });
const sheet = (width, height) => Object.assign(document.createElement('canvas'), { width, height });

export function init(ctx) {
  const band = document.getElementById('tools');
  const group = el('div', 'controls');
  const toolbar = document.getElementById('toolbar');
  const stage = document.getElementById('stage');
  const canvas = el('canvas', 'view erase-view');
  const stencil = document.createElement('canvas');
  const slider = Object.assign(el('input', 'slider'), {
    type: 'range', min: String(BRUSH_MIN), max: String(BRUSH_MAX),
    step: '1', value: String(BRUSH_START),
  });
  const eraser = Object.assign(el('button', 'chip'), { type: 'button' });
  const run = Object.assign(el('button', 'btn primary'), { type: 'button' });
  const meter = Object.assign(el('progress', 'erase-bar'), { max: 1, hidden: true });
  const note = el('p', 'sheet-error');
  const row = el('div', 'slider-row');
  group.hidden = true;
  if (band) band.insertBefore(group, document.getElementById('toolbar'));
  canvas.hidden = true; if (stage) stage.append(canvas);
  note.hidden = true; note.setAttribute('role', 'alert');
  row.append(slider, eraser);
  group.append(row, meter, note, run);

  /** The brush, the paint, the work in flight, and the finger's last place. */
  let brush = BRUSH_START;
  let erasing = false;
  let strokes = [];
  let running = false;
  let warm = false;
  let from = null;
  /** How the picture fits the stage: screen pixels per picture pixel, and its box. */
  const view = { fit: 1, density: 1, cssW: 1, cssH: 1, space: { w: 1, h: 1 } };

  /** The overlay is the picture fitted in the stage, at the device's own ratio. */
  function size(source) {
    view.space = { w: source.width, h: source.height };
    const room = canvas.parentElement;
    const wide = Math.max(80, (room ? room.clientWidth : 320) - 24);
    const tall = Math.max(80, (room ? room.clientHeight : 420) - 24);
    const fit = Math.min(wide / source.width, tall / source.height);
    view.cssW = Math.max(1, Math.round(source.width * fit));
    view.cssH = Math.max(1, Math.round(source.height * fit));
    view.density = window.devicePixelRatio || 1;
    Object.assign(canvas.style, { width: `${view.cssW}px`, height: `${view.cssH}px` });
    Object.assign(canvas, { width: Math.round(view.cssW * view.density),
      height: Math.round(view.cssH * view.density) });
    Object.assign(stencil, { width: canvas.width, height: canvas.height });
    view.fit = Math.min(view.cssW / source.width, view.cssH / source.height);
  }

  /** The photograph, the paint over it, and the ring under the finger. */
  function draw() {
    const source = ctx.baked;
    const g = canvas.getContext('2d');
    const mask = stencil.getContext('2d');
    if (!source || !g || !mask || running) return;
    size(source);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || 'currentColor';
    mask.setTransform(view.density, 0, 0, view.density, 0, 0);
    mask.clearRect(0, 0, view.cssW, view.cssH);
    mask.fillStyle = accent;
    for (const stroke of strokes) {
      mask.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
      mask.beginPath();
      mask.arc(stroke.x * view.fit, stroke.y * view.fit, stroke.r * view.fit, 0, Math.PI * 2);
      mask.fill();
    }
    mask.globalCompositeOperation = 'source-over';
    g.setTransform(view.density, 0, 0, view.density, 0, 0);
    g.clearRect(0, 0, view.cssW, view.cssH);
    g.drawImage(source, 0, 0, view.cssW, view.cssH);
    g.globalAlpha = 0.45;
    g.drawImage(stencil, 0, 0, view.cssW, view.cssH);
    g.globalAlpha = 1;
    if (!from) return;
    g.strokeStyle = accent;
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(from.x * view.fit, from.y * view.fit, Math.max(1, brush / 2 * view.fit), 0, Math.PI * 2);
    g.stroke();
  }

  /** One touch of the brush, spread over the gap from the point before it. */
  function addStroke(event) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const at = { x: ((event.clientX - rect.left) / rect.width) * view.space.w,
      y: ((event.clientY - rect.top) / rect.height) * view.space.h };
    const last = from || at;
    const r = brush / 2;
    const steps = Math.max(1, Math.ceil(Math.hypot(at.x - last.x, at.y - last.y) / r));
    for (let step = 1; step <= steps; step += 1) {
      const k = step / steps;
      strokes.push({ x: last.x + (at.x - last.x) * k, y: last.y + (at.y - last.y) * k,
        r, erase: erasing });
    }
    from = at;
    draw();
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!ctx.baked || running) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    addStroke(event);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!running && from) addStroke(event);
  });
  for (const done of ['pointerup', 'pointercancel']) {
    canvas.addEventListener(done, () => { from = null; draw(); });
  }

  /** `source` (a canvas) at `side` by `side` pixels, as ImageData. */
  function square(source, side) {
    const g = sheet(side, side).getContext('2d');
    g.drawImage(source, 0, 0, side, side);
    return g.getImageData(0, 0, side, side);
  }

  /** One region: the model's answer, feathered and mixed over the photograph. */
  async function fill(base, inpainter, roi) {
    const cut = sheet(roi.w, roi.h);
    const g = cut.getContext('2d');
    g.drawImage(base, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h);
    const painted = strokeMask(strokes, roi, roi.w);
    if (!painted.includes(1)) return;
    const hole = new ImageData(maskRGBA(strokes, roi, SIDE), SIDE, SIDE);
    const answer = await inpainter.inpaint(square(cut, SIDE), hole);
    const held = sheet(SIDE, SIDE);
    held.getContext('2d').putImageData(answer, 0, 0);
    const alpha = featherAlpha(painted, roi.w, roi.h, Math.max(1, Math.round(roi.w * FEATHER)));
    const mixed = composite(g.getImageData(0, 0, roi.w, roi.h).data,
      square(held, roi.w).data, alpha);
    base.putImageData(new ImageData(mixed, roi.w, roi.h), roi.x, roi.y);
  }

  /** Run: fetch the model the first time, then take every painted object out. */
  async function runErase() {
    const source = ctx.baked;
    if (!source || running || !strokes.length) return;
    running = true;
    note.hidden = true;
    run.disabled = true;
    if (toolbar) toolbar.inert = true;
    meter.hidden = false;
    if (warm) meter.removeAttribute('value'); else meter.value = 0;
    try {
      const inpainter = await loadInpainter((fraction) => { meter.value = fraction; });
      warm = true;
      meter.removeAttribute('value');
      const base = sheet(source.width, source.height);
      base.getContext('2d').drawImage(source, 0, 0);
      for (const area of strokeAreas(strokes)) {
        await fill(base, inpainter, roiForMask(area, source.width, source.height));
      }
      ctx.bake(await createImageBitmap(base), ctx.t('tErase'));
      strokes = [];
    } catch (error) {
      note.textContent = ctx.t(error && error.code === 'memory' ? 'erErrMemory' : 'erErrModel');
      note.hidden = false;
    }
    running = false;
    run.disabled = false;
    meter.hidden = true;
    if (toolbar) toolbar.inert = false;
    draw();
  }
  /** The strip's controls, and the action that runs the removal. */
  slider.addEventListener('input', () => { brush = Number(slider.value) || BRUSH_START; });
  eraser.addEventListener('click', () => {
    erasing = !erasing; eraser.setAttribute('aria-pressed', String(erasing));
  });
  run.addEventListener('click', () => { runErase().catch(() => {}); });
  /** The controls and the overlay are on screen while Erase is the chosen tool. */
  function show() {
    const mine = ctx.tool === 'erase' && ctx.baked !== null;
    group.hidden = !mine;
    canvas.hidden = !mine;
    if (!mine) return;
    run.textContent = ctx.t('erRun');
    meter.setAttribute('aria-label', ctx.t('erRun'));
    slider.setAttribute('aria-label', ctx.t('erSize'));
    eraser.textContent = ctx.t('erEraser');
    eraser.setAttribute('aria-pressed', String(erasing));
    draw();
  }
  ctx.on('tool', show);
  ctx.on('image', () => { strokes = []; from = null; show(); });
  ctx.on('baked', show);
  show();
}
