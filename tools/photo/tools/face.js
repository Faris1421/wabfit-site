/**
 * Wab Fit — the Face tool: reshape and retouch, from the landmarks.
 *
 * Entering runs the landmark mesh over the baked photo once. With no face the
 * tool says so in one line and offers nothing else; with a face, ten dials open:
 * seven move the picture through the mesh warp — face slimness, jaw, chin, eyes,
 * nose, lips, smile — and three retouch it through the mask — skin smoothing,
 * whiter teeth, brighter eyes. Every dial previews live, and nothing touches the
 * photo until Apply, which renders the whole picture at its own resolution and
 * hands it to `ctx.bake`, so one undo takes the whole edit back.
 *
 * A face belongs to ONE bitmap: a photo, an undo or another tool's bake makes
 * the landmarks worth finding again, so they are detected afresh and the dials
 * return to rest with them.
 */

import { controls, displacementField } from '../face-geometry.js';
import { MESH_SIDE } from '../gl/mesh.js';
import { createWarper } from '../gl/warp.js';
import { maskOf } from '../gl/skin.js';
import { loadFaceLandmarker } from '../ml/vision.js';

/** The ten dials, in the order drawn: the face's shape first, then its retouch. */
const NAMES = ['slim', 'jaw', 'chin', 'eyes', 'nose', 'lips', 'smile', 'smooth', 'teeth', 'bright'];
const SHAPES = 7;
const keyOf = (name) => `fc${name.charAt(0).toUpperCase()}${name.slice(1)}`;

/** One element with a class: what every control on this page wants. */
const el = (tag, className) => Object.assign(document.createElement(tag), { className });

export function init(ctx) {
  const band = document.getElementById('tools');
  const stage = document.getElementById('stage');
  const group = el('div', 'controls');
  const strip = el('div', 'strip');
  const meter = Object.assign(el('progress', 'face-bar'), { max: 1, hidden: true });
  const note = el('p', 'sheet-error');
  const apply = Object.assign(el('button', 'btn primary'), { type: 'button' });
  const canvas = el('canvas', 'view face-view');
  group.hidden = true;
  if (band) band.insertBefore(group, document.getElementById('toolbar'));
  note.hidden = true;
  note.setAttribute('role', 'alert');
  group.append(strip, meter, note, apply);
  canvas.hidden = true;
  if (stage) stage.append(canvas);
  const warper = createWarper(canvas);

  /** The ten dials: one slider and one word each, on a strip that scrolls. */
  const values = {};
  const dials = NAMES.map((name, at) => {
    const shape = at < SHAPES;
    const input = Object.assign(el('input', 'slider'), {
      type: 'range', min: shape ? '-100' : '0', max: '100', step: '1', value: '0',
    });
    const label = document.createElement('label');
    input.id = `face-${name}`;
    label.htmlFor = input.id;
    const cell = el('div', 'face-cell');
    cell.append(label, input);
    strip.append(cell);
    values[name] = 0;
    return { name, shape, input, label };
  });

  /** The face on the current bitmap, its field, and the work in flight. */
  let points = null;
  let field = null;
  let moved = true;
  let forSource = null;
  let token = 0, flight = 0, frame = 0;
  let busy = false, warm = false;

  /** The picture's box on the stage, keeping its shape, at the device's ratio. */
  function boxOf(source) {
    const room = canvas.parentElement;
    const wide = Math.max(80, (room ? room.clientWidth : 320) - 24);
    const tall = Math.max(80, (room ? room.clientHeight : 420) - 24);
    const fit = Math.min(wide / source.width, tall / source.height);
    return {
      width: Math.max(1, Math.round(source.width * fit)),
      height: Math.max(1, Math.round(source.height * fit)),
    };
  }

  /** The three retouch amounts, 0 to 1: what the mask pass reads. */
  function retouch() {
    const at = (name) => values[name] / 100;
    return { smooth: at('smooth'), teeth: at('teeth'), bright: at('bright') };
  }

  /** The displacement field the dials ask for, computed once per change. */
  function fieldFor(source) {
    if (!moved && field) return field;
    const warps = controls(points, values);
    field = displacementField(warps, MESH_SIDE, MESH_SIDE, source.width, source.height);
    moved = false;
    return field;
  }

  /** One preview frame, at most one per animation frame. */
  function paint() {
    frame = 0;
    const source = ctx.baked;
    if (ctx.tool !== 'face' || !points || !warper || !source || flight !== 0) return;
    warper.draw(fieldFor(source), boxOf(source), retouch());
  }

  /** Ask for a frame; a second ask before it lands changes nothing. */
  function draw() {
    if (!frame) frame = requestAnimationFrame(paint);
  }

  /** Find the face of the current bitmap, its mask, and start showing it. */
  async function prepare() {
    const source = ctx.baked;
    if (!source || ctx.tool !== 'face' || !warper) {
      show();
      return;
    }
    const mine = (token += 1);
    flight = mine;
    points = null;
    field = null;
    apply.disabled = true;
    apply.hidden = true;
    note.hidden = true;
    strip.hidden = true;
    canvas.hidden = true;
    group.hidden = false;
    meter.hidden = false;
    if (warm) meter.removeAttribute('value');
    else meter.value = 0;
    let found = null;
    let failed = false;
    try {
      // The model is asked for here, so the bar counts its own bytes in; from
      // the second face on it is already in memory and the bar is the wait.
      const face = await loadFaceLandmarker((fraction) => { meter.value = fraction; });
      warm = true;
      found = face.landmarks(source);
    } catch {
      failed = true;
    }
    if (mine !== token) return;
    flight = 0;
    meter.hidden = true;
    // The tool was left while the model was loading: nothing is shown, and the
    // next time Face is chosen the face is found again.
    if (ctx.tool !== 'face') {
      forSource = null;
      return;
    }
    if (failed || !found) {
      note.textContent = ctx.t(failed ? 'fcErrModel' : 'fcNoFace');
      note.hidden = false;
      return;
    }
    points = found;
    warper.setSource(source);
    warper.setMask(maskOf(found, source.width, source.height));
    for (const dial of dials) {
      dial.input.value = '0';
      values[dial.name] = 0;
    }
    moved = true;
    strip.hidden = false;
    apply.hidden = false;
    apply.disabled = false;
    canvas.hidden = false;
    draw();
  }

  /** The strip and the preview are on screen while Face is the chosen tool. */
  function show() {
    const mine = ctx.tool === 'face' && ctx.baked !== null && warper !== null;
    group.hidden = !mine;
    canvas.hidden = !mine || !points;
    if (!mine) return;
    apply.textContent = ctx.t('apply');
    meter.setAttribute('aria-label', ctx.t('tFace'));
    for (const dial of dials) dial.label.textContent = ctx.t(keyOf(dial.name));
    if (forSource !== ctx.baked && flight === 0) {
      forSource = ctx.baked;
      prepare();
      return;
    }
    draw();
  }

  /** Apply: the whole picture at its own resolution, warped and retouched. */
  async function save() {
    const source = ctx.baked;
    if (!source || !points || !warper || flight !== 0 || busy) return;
    busy = true;
    apply.disabled = true;
    try {
      const bitmap = await warper.renderWarp(fieldFor(source), retouch());
      if (bitmap) ctx.bake(bitmap, ctx.t('tFace'));
    } catch {
      note.textContent = ctx.t('fcErrMemory');
      note.hidden = false;
    }
    busy = false;
    apply.disabled = false;
  }

  for (const dial of dials) dial.input.addEventListener('input', () => {
    values[dial.name] = Number(dial.input.value) || 0;
    if (dial.shape) moved = true;
    draw();
  });
  apply.addEventListener('click', () => { save().catch(() => {}); });

  ctx.on('tool', show);
  ctx.on('image', () => { forSource = null; show(); });
  ctx.on('baked', () => { forSource = null; show(); });
  show();
}
