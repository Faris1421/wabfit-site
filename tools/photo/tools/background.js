/**
 * Wab Fit — the Background tool: the person stays, the room changes.
 *
 * The segmenter runs once per picture, and `bg-pixels.js` reads its small mask
 * up through the picture's own light, so a hair's edge follows the hair rather
 * than the model's grid. The four choices then put the person somewhere else: a
 * blurred copy of the picture, a flat colour, nothing at all, or a second photo
 * covering the frame. Apply works at the picture's own size and hands the
 * composite to `ctx.bake`, which is what makes it undoable.
 *
 * A picture with no background is transparent, and a JPEG would come back black:
 * while the pixels carry no background, the export sheet is put on PNG. Nothing
 * leaves the device — the segmenter is vendored beside this page.
 */

import { compose, personAt } from '../bg-pixels.js';
import { workSize } from '../mask-math.js';
import { loadSegmenter } from '../ml/vision.js';
import { fit } from '../open.js';

/** The long side the mask is read up at: past the model's grid, under a photo. */
const WORK = 1024;
/** The blur slider's ends and its start, in thousandths of the long side. */
const RADIUS_MIN = 0;
const RADIUS_MAX = 40;
const RADIUS_START = 12;

/** The four grounds the person can be put on, in the order they are drawn. */
const CHOICES = [
  { id: 'blur', key: 'bgBlur' },
  { id: 'color', key: 'bgColor' },
  { id: 'remove', key: 'bgRemove' },
  { id: 'photo', key: 'bgPhoto' },
];

/** The eight grounds of the colour choice, and the key that names each one. */
const KEYS = ['bgWhite', 'bgBlack', 'bgGrey', 'bgBlue', 'bgSky', 'bgGreen', 'bgRose', 'bgSand'];
const GROUNDS = ['#ffffff', '#000000', '#8e8e93', '#0a84ff', '#5ac8fa', '#34c759', '#ff2d55', '#f5e6c8'];

/** One element with a class. */
const el = (tag, className) => Object.assign(document.createElement(tag), { className });

export function init(ctx) {
  const band = document.getElementById('tools');
  const group = el('div', 'controls');
  const strip = el('div', 'strip');
  const grounds = el('div', 'strip');
  const row = el('div', 'slider-row');
  const slider = Object.assign(el('input', 'slider'), {
    type: 'range', min: String(RADIUS_MIN), max: String(RADIUS_MAX),
    step: '1', value: String(RADIUS_START),
  });
  const custom = Object.assign(el('input', 'bg-custom'), { type: 'color', value: GROUNDS[0] });
  const meter = Object.assign(el('progress', 'bg-bar'), { max: 1, hidden: true });
  const note = el('p', 'sheet-error');
  const apply = Object.assign(el('button', 'btn primary'), { type: 'button' });
  const file = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  const buttons = new Map();
  const swatches = GROUNDS.map((color, at) => {
    const button = Object.assign(el('button', 'bg-swatch'), { type: 'button' });
    button.style.background = color;
    button.dataset.key = KEYS[at];
    button.addEventListener('click', () => { pick(color); });
    return button;
  });

  file.hidden = true;
  group.hidden = true; row.hidden = true; grounds.hidden = true;
  note.hidden = true; note.setAttribute('role', 'alert');
  if (band) band.insertBefore(group, document.getElementById('toolbar'));
  strip.append(...CHOICES.map((choice) => {
    const button = Object.assign(el('button', 'chip'), { type: 'button' });
    button.addEventListener('click', () => { choose(choice.id); });
    buttons.set(choice.id, button);
    return button;
  }));
  grounds.append(...swatches, custom);
  row.append(slider);
  group.append(strip, row, grounds, meter, note, apply, file);

  /** The person's own alpha, the picture it belongs to, and the choice. */
  let person = null;
  let forSource = null;
  let kind = 'blur';
  let color = GROUNDS[0];
  let photo = null;
  let clear = false;
  let token = 0; let busy = false; let warm = false;

  /** One line under the controls, in the person's language. */
  const say = (key) => { note.textContent = ctx.t(key); note.hidden = false; };

  /** The blur's radius in `size`'s own pixels, from the slider's thousandths. */
  const radiusFor = (size) =>
    Math.max(1, Math.round(((Number(slider.value) || 0) / 1000) * Math.max(size.width, size.height)));

  /** One of the four grounds is chosen: the photo one opens the picker. */
  function choose(id) {
    kind = id;
    if (id === 'photo' && !photo) file.click();
    show();
  }

  /** A ground colour, from one of the eight swatches or from the picker. */
  function pick(value) {
    kind = 'color';
    color = value;
    show();
  }

  /** The replacement photo, held at the size the page keeps photos at. */
  async function openPhoto(chosen) {
    photo = await fit(await createImageBitmap(chosen, { imageOrientation: 'from-image' }));
    kind = 'photo';
    show();
  }

  /** Nothing is carried across a bake or a new photo: the mask is stale. */
  function forget() {
    token += 1;
    person = null;
    forSource = null;
    note.hidden = true;
    meter.hidden = true;
  }

  /** Segment the picture, and read the model's mask up through its own light. */
  async function prepare() {
    const source = ctx.baked;
    if (!source || ctx.tool !== 'background') return;
    const mine = (token += 1);
    person = null;
    apply.disabled = true;
    note.hidden = true;
    meter.hidden = false;
    if (warm) meter.removeAttribute('value'); else meter.value = 0;
    let failed = '';
    try {
      const model = await loadSegmenter((fraction) => { meter.value = fraction; });
      warm = true;
      const found = model.segmentPerson(source);
      if (!found) throw new Error('no mask');
      // The mask is read up at the working size, where the guide is affordable;
      // the bake scales that same alpha to the picture's size in one draw.
      person = personAt(source, workSize(source, WORK), found);
      if (!person) throw new Error('no mask');
      forSource = source;
    } catch (error) {
      failed = error && error.code === 'memory' ? 'bgErrMemory' : 'bgErrModel';
    }
    if (mine !== token) return;
    meter.hidden = true;
    if (ctx.tool !== 'background') return;
    if (failed) { say(failed); return; }
    apply.disabled = false;
  }

  /** Apply: the composite at the picture's own size, into the trail. */
  async function save() {
    if (!person || !forSource || forSource !== ctx.baked || busy) return;
    busy = true; apply.disabled = true;
    try {
      const size = { width: forSource.width, height: forSource.height };
      const made = compose(forSource, person, { kind, color, photo, radius: radiusFor(size) }, size);
      if (!made) throw new Error('no canvas');
      ctx.bake(await createImageBitmap(made), ctx.t('tBackground'));
      clear = kind === 'remove';
    } catch (error) {
      say(error && error.code === 'memory' ? 'bgErrMemory' : 'bgErrModel');
    }
    busy = false; apply.disabled = false;
    forget();
    show();
  }

  /** A picture with no background is transparent: a JPEG would come back black. */
  function preferPng() {
    if (!clear) return;
    for (const chip of document.querySelectorAll('.sheet .chips .chip')) {
      if (chip.textContent === ctx.t('exPng')) chip.click();
    }
  }

  /** The controls are on screen while Background is the chosen tool. */
  function show() {
    const mine = ctx.tool === 'background' && ctx.baked !== null;
    group.hidden = !mine;
    if (!mine) return;
    apply.textContent = ctx.t('apply');
    slider.setAttribute('aria-label', ctx.t('bgRadius'));
    custom.setAttribute('aria-label', ctx.t('bgColor'));
    meter.setAttribute('aria-label', ctx.t('tBackground'));
    for (const choice of CHOICES) {
      const button = buttons.get(choice.id);
      if (!button) continue;
      button.textContent = ctx.t(choice.key);
      button.setAttribute('aria-pressed', String(choice.id === kind));
    }
    swatches.forEach((button, at) => {
      button.setAttribute('aria-label', ctx.t(KEYS[at] || 'bgColor'));
      button.setAttribute('aria-pressed', String(kind === 'color' && GROUNDS[at] === color));
    });
    row.hidden = kind !== 'blur';
    grounds.hidden = kind !== 'color';
    if (forSource !== ctx.baked) prepare();
  }

  file.addEventListener('change', () => {
    const chosen = file.files && file.files[0];
    file.value = '';
    if (chosen) openPhoto(chosen).catch(() => {});
  });
  custom.addEventListener('input', () => { pick(custom.value); });
  apply.addEventListener('click', () => { save().catch(() => {}); });
  ctx.on('tool', show);
  ctx.on('image', () => { clear = false; forget(); show(); });
  ctx.on('baked', () => { clear = false; show(); });
  ctx.on('export', preferPng);
  show();
}
