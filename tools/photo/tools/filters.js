/**
 * Wab Fit — the Filters tool: twelve looks, one strength, and a way back.
 *
 * A strip of twelve thumbnails that scrolls sideways, each one drawn BY THE
 * PIPELINE ITSELF from the baked photo at 96 px, so a filter is chosen by what
 * it does to THIS picture; the chosen one is ringed in the accent colour, and
 * the slider under the strip says how much of it is applied, 0 to 100.
 *
 * CHOOSING IS A POSITION, NOT A LAYER: a filter sets the thirteen adjustments
 * outright — `applyFilter(DEFAULTS, preset, strength)` — and the id and the
 * strength ride along on `params`, so one undo takes the whole choice back and
 * nothing re-applies a filter under the person's hands afterwards.
 *
 * The pipeline is given a SMALL copy of the baked photo (longer side 192 px),
 * so twelve thumbnails cost a fraction of one preview; an answer that arrives
 * after the photo was replaced is dropped rather than drawn.
 */

import { DEFAULTS } from '../params.js';
import { FILTERS, NEUTRAL_ID, applyFilter, filterById } from '../filters-data.js';
import { createPipeline } from '../gl/pipeline.js';
import { getLang } from '../i18n.js';

/** The pipeline's own thumbnail size, and the longest side it reads to make one. */
const THUMB = 96;
const SOURCE_SIDE = 192;

/** The band the controls sit in, made once, above the tool bar. */
function mount() {
  const band = document.getElementById('tools');
  const box = document.createElement('div');
  box.className = 'controls';
  box.id = 'filtersControls';
  if (band) band.insertBefore(box, document.getElementById('toolbar'));
  return box;
}

/** A filter by id, with the neutral one standing in for an id nobody knows. */
function entryOf(id) {
  return filterById(id) || FILTERS[0];
}

/** A filter's name in the language the page is in. */
function nameOf(entry) {
  return getLang() === 'en' ? entry.en : entry.ar;
}

export function init(ctx) {
  const box = mount();
  const strip = Object.assign(document.createElement('div'), { className: 'strip' });
  const row = Object.assign(document.createElement('div'), { className: 'slider-row' });
  const slider = document.createElement('input');
  Object.assign(slider, {
    type: 'range', className: 'slider', min: '0', max: '100', step: '1', value: '100',
  });
  const readout = Object.assign(document.createElement('span'), { className: 'value' });
  row.append(slider, readout);

  const buttons = new Map();
  const thumbs = new Map();
  for (const filter of FILTERS) {
    const button = document.createElement('button');
    Object.assign(button, { type: 'button', className: 'filter' });
    button.dataset.filter = filter.id;
    const canvas = document.createElement('canvas');
    canvas.width = THUMB * 2;
    canvas.height = THUMB * 2;
    button.append(canvas, document.createElement('span'));
    button.addEventListener('click', () => apply(filter.id, strength(), true));
    buttons.set(filter.id, button);
    thumbs.set(filter.id, canvas);
    strip.append(button);
  }
  box.append(strip, row);
  slider.setAttribute('aria-label', ctx.t('strength'));

  /** What is dragging, what the frame owes the picture, and what has been drawn. */
  let live = null;
  let before = 1;
  let frame = 0;
  let scratch = null;
  let paint = null;
  let held = null;
  let token = 0;
  let builtFor = null;

  /** How much of the filter is applied, 0..1, as the ctx holds it right now. */
  function strength() {
    const amount = Number(ctx.params.strength);
    return Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 1;
  }

  /** The filter the ring is on: an id nobody knows is the neutral filter. */
  function chosenId() {
    const id = ctx.params.filter;
    return typeof id === 'string' && filterById(id) ? id : NEUTRAL_ID;
  }

  /** The ring, the words and the slider, from the values the ctx holds now. */
  function sync() {
    const id = chosenId();
    for (const [name, button] of buttons) {
      const word = nameOf(entryOf(name));
      const span = button.lastElementChild;
      if (span) span.textContent = word;
      button.setAttribute('aria-label', word);
      button.setAttribute('aria-pressed', String(name === id));
    }
    const shown = Math.round(strength() * 100);
    slider.value = String(shown);
    readout.textContent = String(shown);
    readout.setAttribute('aria-label', `${ctx.t('strength')} ${shown}`);
  }

  /** Set the thirteen values from a filter, and remember which one it was. */
  function apply(id, amount, push) {
    const entry = entryOf(id);
    const patch = { ...applyFilter(DEFAULTS, entry.preset, amount), filter: entry.id };
    patch.strength = amount;
    if (push) ctx.setParams(patch, nameOf(entry));
    else {
      ctx.params = { ...ctx.params, ...patch };
      ctx.emit('params', ctx.params);
    }
  }

  /** The picture follows the strength, at most once a frame, off the trail. */
  function preview(amount) {
    if (live === null) before = strength();
    live = amount;
    readout.textContent = String(Math.round(amount * 100));
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (live !== null) apply(chosenId(), live, false);
    });
  }

  /** The finger is up: the strength is one step on the trail, if it moved. */
  function commit() {
    if (live === null) return;
    const amount = live;
    live = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    apply(chosenId(), amount, false);
    if (amount === before) return;
    before = amount;
    ctx.setParams({ filter: chosenId(), strength: amount }, nameOf(entryOf(chosenId())));
  }

  /**
   * The twelve thumbnails: the pipeline's own drawing, from a SMALL copy of the
   * baked photo, so twelve looks cost a fraction of one preview.
   */
  async function buildThumbs() {
    const baked = ctx.baked;
    if (!baked || builtFor === baked) return;
    if (!scratch) {
      scratch = document.createElement('canvas');
      paint = createPipeline(scratch);
    }
    if (!paint) return;
    builtFor = baked;
    const mine = ++token;
    const longer = Math.max(baked.width, baked.height);
    const scale = longer > SOURCE_SIDE ? SOURCE_SIDE / longer : 1;
    const copy = scale === 1 ? null : await createImageBitmap(baked, {
      resizeWidth: Math.round(baked.width * scale),
      resizeHeight: Math.round(baked.height * scale),
      resizeQuality: 'high',
    });
    if (mine !== token) {
      if (copy) copy.close();
      return;
    }
    const previous = held;
    held = copy;
    paint.setSource(copy || baked);
    if (previous) previous.close();
    for (const filter of FILTERS) {
      const canvas = thumbs.get(filter.id);
      if (!canvas) continue;
      paint.render(applyFilter(DEFAULTS, filter.preset, 1), { width: THUMB, height: THUMB });
      const into = canvas.getContext('2d');
      if (into) into.drawImage(scratch, 0, 0, canvas.width, canvas.height);
    }
  }

  /** The controls are on screen while Filters is the tool and a photo is open. */
  function show() {
    const mine = ctx.tool === 'filters' && ctx.baked !== null;
    box.hidden = !mine;
    if (!mine) return;
    sync();
    buildThumbs().catch(() => {
      // A photo that will not scale is one whose thumbnails are not drawn.
    });
  }

  slider.addEventListener('pointerdown', () => { live = null; });
  slider.addEventListener('input', () => preview(Number(slider.value) / 100));
  for (const done of ['change', 'pointerup', 'pointercancel']) {
    slider.addEventListener(done, commit);
  }

  ctx.on('tool', show);

  /** A photo, or a destructive step under it: the thumbnails are drawn again. */
  ctx.on('image', show);
  ctx.on('baked', show);

  /** An undo, a redo or a filter: the ring and the slider follow the values. */
  ctx.on('params', () => {
    if (live === null) sync();
  });

  show();
}
