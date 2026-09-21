/**
 * Wab Fit — the Swap tool: a face from a second photo, onto this one.
 *
 * The person picks the other photo; the model reads a face in both, and with one
 * missing from either the tool says so in one line. With both, `gl/swap.js` draws
 * the source's face onto the target's shape and answers the picture and the
 * swapped picture at the picture's own resolution; this module shows the two on
 * the stage, cross-fades them with a strength dial, and hands the answer to
 * `ctx.bake` on Apply. The target's own mouth interior is kept when it is open
 * wider than the source's, and nothing leaves the device.
 */

import { MESH, faceFrame } from '../face-geometry.js';
import { delaunay } from '../swap-math.js';
import { createSwapper } from '../gl/swap.js';
import { sizeCanvas } from '../gl/gpu.js';
import { loadFaceLandmarker } from '../ml/vision.js';
import { fit } from '../open.js';

/** The strength slider's ends, and where it starts: all of the swap. */
const STRENGTH_MIN = 0;
const STRENGTH_MAX = 100;
const STRENGTH_START = 100;

/** One element with a class, one canvas off the document. */
const el = (tag, className) => Object.assign(document.createElement(tag), { className });
const sheet = (width, height) => Object.assign(document.createElement('canvas'), { width, height });

export function init(ctx) {
  const band = document.getElementById('tools');
  const stage = document.getElementById('stage');
  const group = el('div', 'controls');
  const strip = el('div', 'strip');
  const row = el('div', 'slider-row');
  const pick = Object.assign(el('button', 'chip'), { type: 'button' });
  const slider = Object.assign(el('input', 'slider'), {
    type: 'range', min: String(STRENGTH_MIN), max: String(STRENGTH_MAX),
    step: '1', value: String(STRENGTH_START),
  });
  const readout = el('span', 'value');
  const meter = Object.assign(el('progress', 'swap-bar'), { max: 1, hidden: true });
  const note = el('p', 'sheet-error');
  const apply = Object.assign(el('button', 'btn primary'), { type: 'button' });
  const canvas = el('canvas', 'view swap-view');
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  // The warp's own canvas: never on screen, never in the document.
  const swapper = createSwapper(Object.assign(document.createElement('canvas'), { width: 8, height: 8 }));

  input.hidden = true;
  group.hidden = true; canvas.hidden = true;
  note.hidden = true; note.setAttribute('role', 'alert');
  if (band) band.insertBefore(group, document.getElementById('toolbar'));
  if (stage) stage.append(canvas);
  row.append(slider, readout); strip.append(pick);
  group.append(strip, row, meter, note, apply, input);

  /** The second photo, the two faces, and the pair the slider fades between. */
  let source = null;
  let faces = null;
  let pictures = null;
  let forSource = null;
  let token = 0; let busy = false; let warm = false;

  /** One line under the controls, in the person's language. */
  const say = (key) => { note.textContent = ctx.t(key); note.hidden = false; };

  /** The slider's own fraction, 0 to 1. */
  const strength = () => (Number(slider.value) || 0) / 100;

  /** How far the inner lips are apart along the face's own up axis, over its scale. */
  const openness = (points) => {
    const frame = faceFrame(points);
    let low = Infinity; let high = -Infinity;
    for (const index of MESH.lipsInner) {
      const point = points[index];
      if (!point) continue;
      const at = (point.x - frame.center.x) * frame.up.x + (point.y - frame.center.y) * frame.up.y;
      low = Math.min(low, at); high = Math.max(high, at);
    }
    return high > low ? (high - low) / frame.scale : 0;
  };

  /** The preview: the swap faded over the picture it came from, in the stage. */
  function draw() {
    if (!pictures || ctx.tool !== 'swap') return;
    const room = canvas.parentElement;
    const wide = Math.max(80, (room ? room.clientWidth : 320) - 24);
    const tall = Math.max(80, (room ? room.clientHeight : 420) - 24);
    const scale = Math.min(wide / pictures.base.width, tall / pictures.base.height);
    const px = (long) => Math.max(1, Math.round(long * scale));
    const box = { width: px(pictures.base.width), height: px(pictures.base.height) };
    sizeCanvas(canvas, box);
    const pen = canvas.getContext('2d');
    if (!pen) return;
    const ratio = canvas.width / Math.max(1, box.width);
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    pen.clearRect(0, 0, box.width, box.height);
    pen.drawImage(pictures.swapped, 0, 0, box.width, box.height);
    pen.globalAlpha = 1 - strength();
    pen.drawImage(pictures.base, 0, 0, box.width, box.height);
    pen.globalAlpha = 1;
  }

  /** Nothing is carried across a bake or a new photo: the swap was delivered. */
  function forget() {
    token += 1;
    faces = null;
    pictures = null;
    meter.hidden = true;
    canvas.hidden = true;
    apply.hidden = true;
  }

  /** Find a face in both pictures and build the swap, once per target. */
  async function prepare() {
    const target = ctx.baked;
    if (!target || !source || ctx.tool !== 'swap' || !swapper) return;
    const mine = (token += 1);
    faces = null; pictures = null;
    canvas.hidden = true; apply.hidden = true;
    note.hidden = true;
    meter.hidden = false;
    if (warm) meter.removeAttribute('value'); else meter.value = 0;
    let failed = false;
    try {
      // The model is asked for here, so the bar counts its own bytes in.
      const model = await loadFaceLandmarker((fraction) => { meter.value = fraction; });
      warm = true;
      const here = model.landmarks(target);
      const there = model.landmarks(source);
      if (here && there) {
        const triangles = delaunay(here);
        const keepMouth = openness(here) > openness(there);
        faces = { target: here, source: there, triangles, keepMouth };
      }
    } catch {
      failed = true;
    }
    if (mine !== token) return;
    if (ctx.baked !== target) { meter.hidden = true; return; }
    meter.hidden = true;
    if (ctx.tool !== 'swap') return;
    if (failed) { say('fcErrModel'); return; }
    if (!faces) { say('fcNoFace'); return; }
    try {
      pictures = swapper.swap(target, source, faces);
    } catch {
      pictures = null;
    }
    if (!pictures) { say('fcErrMemory'); return; }
    canvas.hidden = false;
    apply.hidden = false;
    apply.disabled = false;
    draw();
  }

  /** The second photo, held at the size the page keeps photos at. */
  async function choose(file) {
    source = await fit(await createImageBitmap(file, { imageOrientation: 'from-image' }));
    forSource = null;
    forget();
    show();
  }

  /** Apply: the composite at the picture's own size, into the trail. */
  async function save() {
    if (!pictures || busy) return;
    busy = true; apply.disabled = true;
    try {
      const out = sheet(pictures.base.width, pictures.base.height);
      const pen = out.getContext('2d');
      if (!pen) throw new Error('no canvas');
      pen.drawImage(pictures.swapped, 0, 0);
      pen.globalAlpha = 1 - strength();
      pen.drawImage(pictures.base, 0, 0);
      pen.globalAlpha = 1;
      ctx.bake(await createImageBitmap(out), ctx.t('tSwap'));
      source = null;
      forSource = null;
      forget();
    } catch {
      say('fcErrMemory');
    }
    busy = false; apply.disabled = false;
    show();
  }

  /** The controls and the preview are on screen while Swap is the chosen tool. */
  function show() {
    const mine = ctx.tool === 'swap' && ctx.baked !== null && swapper !== null;
    group.hidden = !mine;
    if (!mine) { canvas.hidden = true; return; }
    canvas.hidden = !pictures;
    pick.textContent = ctx.t('swPick');
    apply.textContent = ctx.t('apply');
    slider.setAttribute('aria-label', ctx.t('strength'));
    readout.textContent = slider.value;
    meter.setAttribute('aria-label', ctx.t('tSwap'));
    if (forSource !== ctx.baked) {
      forSource = ctx.baked;
      prepare();
      return;
    }
    draw();
  }

  pick.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (file) choose(file).catch(() => {});
  });
  slider.addEventListener('input', draw);
  apply.addEventListener('click', () => { save().catch(() => {}); });
  ctx.on('tool', show);
  ctx.on('image', () => { forSource = null; forget(); show(); });
  ctx.on('baked', show);
  show();
}
