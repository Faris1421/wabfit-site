/**
 * Wab Fit — the Crop tool: turn, mirror, straighten, then frame.
 *
 * The whole baked picture is shown with a frame over it: eight handles and a
 * drag inside to move it, thirds while a finger is down, an aspect row from Free
 * to the picture's own, a quarter turn either way, a mirror, and a straighten
 * dial from -45 to 45 degrees. Nothing is destructive until Apply, which draws
 * the frame out of the turned picture and hands it to `ctx.bake` — one whole
 * crop on the undo trail. Cancel puts the frame back. crop-view.js does the
 * drawing, so what Apply bakes is what was on screen.
 */

import { clampRect, defaultCrop, fitAspect, moveHandle, pickHandle, turnRect } from '../crop-math.js';
import { createCropView } from '../crop-view.js';

/** The aspect row in the order drawn: `ratio` 0 is free, -1 the picture's own. */
const ASPECTS = [
  { key: 'aspectFree', ratio: 0 },
  { key: 'aspect11', ratio: 1 },
  { key: 'aspect45', ratio: 4 / 5 },
  { key: 'aspect34', ratio: 3 / 4 },
  { key: 'aspect916', ratio: 9 / 16 },
  { key: 'aspect169', ratio: 16 / 9 },
  { key: 'aspectOriginal', ratio: -1 },
];

/** The three actions, on `currentColor`, 24×24, stroke 1.7. */
const ICONS = {
  rotateLeft: '<path d="M4.4 11.6a7.6 7.6 0 1 1 2.2 5.4"/><path d="M4 4.6v7h7"/>',
  rotateRight: '<path d="M19.6 11.6a7.6 7.6 0 1 0-2.2 5.4"/><path d="M20 4.6v7h-7"/>',
  flip: '<path d="M12 3.6v16.8"/><path d="M9.6 7.2 5 12l4.6 4.8z"/><path d="M14.4 7.2 19 12l-4.6 4.8z"/>',
};

/** One drawing, wrapped the way every button on this page wants it. */
const svg = (markup) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
  + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${markup}</svg>`;

/** The band the controls sit in, made once, above the tool bar. */
function mount() {
  const band = document.getElementById('tools');
  const box = document.createElement('div');
  box.className = 'controls';
  box.id = 'cropControls';
  if (band) band.insertBefore(box, document.getElementById('toolbar'));
  return box;
}

export function init(ctx) {
  const box = mount();
  const view = createCropView(document.getElementById('stage'));
  const canvas = view.canvas;
  const aspects = Object.assign(document.createElement('div'), { className: 'chips' });
  const actions = Object.assign(document.createElement('div'), { className: 'slider-row' });
  const commit = Object.assign(document.createElement('div'), { className: 'slider-row' });
  const slider = document.createElement('input');
  Object.assign(slider, {
    type: 'range', className: 'slider', min: '-45', max: '45', step: '1', value: '0',
  });
  const readout = Object.assign(document.createElement('span'), { className: 'value' });

  const chips = new Map();
  for (const item of ASPECTS) {
    const chip = document.createElement('button');
    Object.assign(chip, { type: 'button', className: 'chip' });
    chip.append(document.createElement('span'));
    chip.addEventListener('click', () => choose(item.ratio));
    chips.set(item.key, chip);
    aspects.append(chip);
  }

  /** One 44px action button: its drawing, and what it does when pressed. */
  function act(name, fn) {
    const button = document.createElement('button');
    Object.assign(button, { type: 'button', className: 'icon-btn' });
    button.innerHTML = svg(ICONS[name]);
    button.addEventListener('click', fn);
    actions.append(button);
    return button;
  }
  const turns = [act('rotateLeft', () => turn(-1)), act('rotateRight', () => turn(1))];
  const flip = act('flip', () => { crop = { ...crop, flipH: !crop.flipH }; draw(); });
  const apply = document.createElement('button');
  Object.assign(apply, { type: 'button', className: 'btn primary' });
  apply.addEventListener('click', () => { save().catch(() => {}); });
  const cancel = document.createElement('button');
  Object.assign(cancel, { type: 'button', className: 'btn' });
  cancel.addEventListener('click', reset);
  actions.append(slider, readout);
  commit.append(apply, cancel);
  box.append(aspects, actions, commit);

  /** The frame, the drag in progress, and the picture the frame was reset for. */
  let crop = defaultCrop(1, 1);
  let aspect = 0;
  let drag = null;
  let forSource = null;

  /** The locked aspect: null while the frame is free, the picture's own at -1. */
  function locked() {
    const room = view.space();
    return aspect === 0 ? null : aspect === -1 ? room.w / room.h : aspect;
  }

  /** The preview again: the picture, and the frame with the thirds while dragging. */
  function draw() {
    if (ctx.baked && !canvas.hidden) view.render(ctx.baked, crop, drag !== null);
  }

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (!ctx.baked) return;
    const point = view.pointOf(event);
    const inside = point.x >= crop.x && point.x <= crop.x + crop.w
      && point.y >= crop.y && point.y <= crop.y + crop.h;
    const handle = pickHandle(crop, point, 24 / view.fit());
    if (!handle && !inside) return;
    canvas.setPointerCapture(event.pointerId);
    drag = { handle, x: point.x, y: point.y, rect: { ...crop } };
    draw();
  });
  /** The frame follows the finger: one handle resized, or the whole frame moved. */
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    event.preventDefault();
    const room = view.space();
    const point = view.pointOf(event);
    const dx = point.x - drag.x;
    const dy = point.y - drag.y;
    const moved = drag.handle
      ? moveHandle(drag.rect, drag.handle, dx, dy, locked(), room)
      : clampRect({ ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy }, room);
    crop = { ...crop, ...moved };
    draw();
  });
  for (const done of ['pointerup', 'pointercancel']) {
    canvas.addEventListener(done, () => { if (drag) { drag = null; draw(); } });
  }

  /** An aspect: the frame becomes the largest of that shape the picture holds. */
  function choose(ratio) {
    aspect = ratio;
    const room = view.space();
    if (aspect !== 0) crop = { ...crop, ...fitAspect(crop, locked(), room.w, room.h) };
    labels();
    draw();
  }
  /** A quarter turn either way: the frame turns with the picture. */
  function turn(step) {
    const room = view.space();
    const turned = turnRect(crop, room.w, room.h, step > 0);
    crop = { ...crop, ...turned, rotate90: (((crop.rotate90 + step) % 4) + 4) % 4 };
    // A shape that was chosen by hand is still that shape, turned with it.
    if (aspect > 0) crop = { ...crop, ...fitAspect(crop, aspect, room.h, room.w) };
    draw();
  }

  /** The frame back to the whole picture, level, as when the tool opened. */
  function reset() {
    const source = ctx.baked;
    aspect = 0;
    crop = defaultCrop(source ? source.width : 1, source ? source.height : 1);
    slider.value = '0';
    labels();
    draw();
  }

  /** The words, in the language the page is in. */
  function labels() {
    apply.textContent = ctx.t('apply');
    cancel.textContent = ctx.t('cancel');
    turns[0].setAttribute('aria-label', ctx.t('rotateLeft'));
    turns[1].setAttribute('aria-label', ctx.t('rotateRight'));
    flip.setAttribute('aria-label', ctx.t('flip'));
    slider.setAttribute('aria-label', ctx.t('straighten'));
    readout.textContent = slider.value;
    readout.setAttribute('aria-label', `${ctx.t('straighten')} ${slider.value}`);
    const on = (ASPECTS.find((item) => item.ratio === aspect) || ASPECTS[0]).key;
    for (const [key, chip] of chips) {
      const word = ctx.t(key);
      const span = chip.firstElementChild;
      if (span) span.textContent = word;
      chip.setAttribute('aria-label', word);
      chip.setAttribute('aria-pressed', String(key === on));
    }
  }

  /** The straighten dial: the picture follows it, and nothing is baked yet. */
  slider.addEventListener('input', () => {
    crop = { ...crop, straighten: Number(slider.value) };
    readout.textContent = slider.value;
    readout.setAttribute('aria-label', `${ctx.t('straighten')} ${slider.value}`);
    draw();
  });

  /** The controls and the preview are on screen while Crop is the tool. */
  function show() {
    const mine = ctx.tool === 'crop' && ctx.baked !== null;
    box.hidden = !mine;
    view.show(mine);
    if (!mine) return;
    labels();
    if (forSource !== ctx.baked) { forSource = ctx.baked; reset(); return; }
    draw();
  }

  /** Apply: the frame cut at full resolution, exactly as the preview showed it. */
  async function save() {
    const source = ctx.baked;
    if (!source) return;
    const bitmap = await view.bitmap(source, crop);
    if (bitmap) ctx.bake(bitmap, ctx.t('tCrop'));
  }

  ctx.on('tool', show);
  ctx.on('image', () => { forSource = null; show(); });
  ctx.on('baked', () => { forSource = null; show(); });
  show();
}

