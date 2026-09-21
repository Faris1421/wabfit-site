/**
 * Wab Fit — the Adjust tool: the thirteen parameters, one slider, one step.
 *
 * A row of thirteen chips, each an icon and a word, that scrolls sideways; a
 * single slider under it for the chip that is showing; and a value beside the
 * slider, in figures of one width, read left to right in both languages.
 *
 * THE SLIDER IS LIVE AND THE TRAIL IS NOT. While a finger drags, the picture
 * follows at most once a frame — the values are written straight onto `ctx` and
 * announced — but NOTHING is pushed on the undo trail, because a drag is one
 * edit and not eighty. When the finger comes up, one state goes on the trail,
 * labelled with the parameter's own name, so one undo takes the whole drag
 * back; a drag that ends where it began pushes nothing. A double-tap on the
 * value puts the parameter back to zero, the same way, as one edit.
 *
 * The tool owns no pixels: it moves numbers through `ctx.setParams` and lets
 * the pipeline draw. It draws itself into the tools band, above the tool bar,
 * and shows itself only while it is the chosen tool and a photo is open.
 */

import { DEFAULTS, KEYS, RANGES } from '../params.js';

/** One drawing per parameter, on `currentColor`, 24×24, stroke 1.7. */
const ICONS = {
  exposure:
    '<circle cx="12" cy="12" r="3.8"/><path d="M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2'
    + 'M5.9 5.9l1.6 1.6M16.5 16.5l1.6 1.6M18.1 5.9l-1.6 1.6M7.5 16.5l-1.6 1.6"/>',
  brightness: '<circle cx="12" cy="12" r="4.2"/><path d="M12 4.6V7M12 17v2.4M4.6 12H7M17 12h2.4"/>',
  contrast: '<circle cx="12" cy="12" r="8.2"/><path d="M12 3.8v16.4"/>',
  highlights: '<path d="M6 5.5h12"/><circle cx="12" cy="14.2" r="4.6"/>',
  shadows: '<path d="M6 18.5h12"/><path d="M7.4 14.4a4.6 4.6 0 0 1 9.2 0"/>',
  saturation: '<path d="M12 4.4c3.2 3.8 5.6 6.5 5.6 9a5.6 5.6 0 0 1-11.2 0c0-2.5 2.4-5.2 5.6-9z"/>',
  vibrance:
    '<path d="M12 5.4c2.9 3.5 5.1 5.9 5.1 8.2a5.1 5.1 0 0 1-10.2 0c0-2.3 2.2-4.7 5.1-8.2z"/>'
    + '<path d="M9.4 20.6h5.2"/>',
  temperature: '<path d="M12 4.2v9.2"/><circle cx="12" cy="16.6" r="2.8"/><path d="M9.4 4.2h5.2"/>',
  tint: '<circle cx="12" cy="12" r="8.2"/><path d="M12 3.8a8.2 8.2 0 0 1 0 16.4"/>',
  fade: '<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="3" stroke-dasharray="4 3"/>',
  vignette: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="12" cy="12" r="4"/>',
  grain:
    '<circle cx="8.6" cy="8.6" r="0.9"/><circle cx="15.4" cy="9.6" r="0.9"/>'
    + '<circle cx="9.6" cy="13.2" r="0.9"/><circle cx="15.6" cy="17" r="0.9"/>',
  sharpen: '<path d="M12 4.5 19 18H5z"/><path d="M8.4 18h7.2"/>',
};

/** One icon wrapped the way every button on this page wants it. */
const svg = (markup) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
  + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${markup}</svg>`;

/** The band the controls sit in, made once, above the tool bar. */
function mount() {
  const band = document.getElementById('tools');
  const box = document.createElement('div');
  box.className = 'controls';
  box.id = 'adjustControls';
  if (band) band.insertBefore(box, document.getElementById('toolbar'));
  return box;
}

/** The string key a parameter is named by: `exposure` asks for `pExposure`. */
const keyOf = (name) => `p${name.charAt(0).toUpperCase()}${name.slice(1)}`;

export function init(ctx) {
  const box = mount();
  const chips = document.createElement('div');
  chips.className = 'chips';
  const row = document.createElement('div');
  row.className = 'slider-row';
  row.hidden = true;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'slider';
  slider.step = '1';
  const readout = document.createElement('button');
  readout.type = 'button';
  readout.className = 'value';
  row.append(slider, readout);

  /** The parameter on the slider, the value under the finger, and the frame. */
  let chosen = KEYS[0];
  let live = null;
  let before = 0;
  let frame = 0;
  let lastTap = 0;

  const buttons = new Map();
  for (const name of KEYS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.param = name;
    chip.innerHTML = `${svg(ICONS[name])}<span></span>`;
    chip.addEventListener('click', () => choose(name));
    buttons.set(name, chip);
    chips.append(chip);
  }
  box.append(chips, row);

  /** Put one parameter on the slider, with the ends the pipeline allows it. */
  function choose(name) {
    chosen = name;
    const range = RANGES[name];
    slider.min = String(range[0]);
    slider.max = String(range[1]);
    row.hidden = false;
    paintChips();
    sync();
  }

  /** Every chip's word and the chip that is showing. Words change with the language. */
  function paintChips() {
    for (const [name, chip] of buttons) {
      const word = ctx.t(keyOf(name));
      const span = chip.lastElementChild;
      if (span) span.textContent = word;
      chip.setAttribute('aria-label', word);
      chip.setAttribute('aria-pressed', String(name === chosen));
    }
  }

  /** Where a parameter stands now, whatever the ctx was handed. */
  function valueOf(name) {
    const value = Number(ctx.params[name]);
    return Number.isFinite(value) ? value : DEFAULTS[name];
  }

  /** The slider and its figures, after an undo, a redo or a filter. */
  function sync() {
    const value = valueOf(chosen);
    slider.value = String(value);
    readout.textContent = String(value);
    readout.setAttribute('aria-label', `${ctx.t(keyOf(chosen))} ${value}`);
  }

  /** The picture follows the thumb, at most once a frame. Nothing goes on the
   * trail here: the values are announced, not recorded, so a drag of eighty
   * frames is still one edit when it ends.
   */
  function preview(value) {
    if (live === null) before = valueOf(chosen);
    live = value;
    readout.textContent = String(value);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (live === null) return;
      ctx.params = { ...ctx.params, [chosen]: live };
      ctx.emit('params', ctx.params);
    });
  }

  /** A frame that has not been drawn yet is dropped: the value moved again. */
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  /** The finger is up: that drag is over, and it is one step at most. */
  function commit() {
    if (live === null) return;
    const value = live;
    live = null;
    stop();
    ctx.params = { ...ctx.params, [chosen]: value };
    ctx.emit('params', ctx.params);
    if (value === before) return;
    before = value;
    ctx.setParams({ [chosen]: value }, ctx.t(keyOf(chosen)));
  }

  /** The double-tap on the value: back to zero, as one edit on the trail. */
  function reset() {
    if (valueOf(chosen) === DEFAULTS[chosen]) return;
    live = null;
    stop();
    slider.value = String(DEFAULTS[chosen]);
    readout.textContent = String(DEFAULTS[chosen]);
    before = DEFAULTS[chosen];
    ctx.setParams({ [chosen]: DEFAULTS[chosen] }, ctx.t(keyOf(chosen)));
  }

  /** The controls are on screen while Adjust is the tool and a photo is open. */
  function show() {
    const mine = ctx.tool === 'adjust' && ctx.baked !== null;
    box.hidden = !mine;
    if (mine) sync();
  }

  slider.addEventListener('pointerdown', () => { live = null; });
  slider.addEventListener('input', () => preview(Number(slider.value)));
  for (const done of ['change', 'pointerup', 'pointercancel']) {
    slider.addEventListener(done, commit);
  }

  readout.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const now = Date.now();
    const again = now - lastTap <= 320;
    lastTap = again ? 0 : now;
    if (again) reset();
  });

  ctx.on('tool', () => { paintChips(); show(); });

  /** A photo, or a destructive step under it: the values may all have moved. */
  ctx.on('image', show);
  ctx.on('baked', show);

  /** Everything that is not this finger's own move — undo, redo, a filter. */
  ctx.on('params', () => {
    if (live === null) sync();
  });

  choose(chosen);
  show();
}
