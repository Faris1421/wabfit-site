/**
 * Wab Fit — a finished photo leaves the page.
 *
 * The bar's Export button opens one sheet: the two formats, how good a JPEG may
 * be, and the size the file will come out at. Nothing leaves the phone. Inside
 * the app the finished bytes go back over the bridge as base64, in 32 KB slices,
 * and the app writes them to the photo library; in a plain browser the same
 * bytes go out through a Blob URL as a download, because there is no app to hand
 * them to.
 *
 * THE PIXELS ARE THE PIPELINE'S. The sheet owns no drawing of its own: it asks
 * `renderToBlob` for the whole picture at its own resolution, tiled internally,
 * so an export is the preview with nothing dropped. The photo is never sent
 * anywhere — no fetch, no XHR, no beacon.
 *
 * WHAT THE APP IS TOLD: {type:'export', name, base64, save:'library'} once, and
 * {type:'dirty', dirty:false} after it lands, because a saved photo is no longer
 * an edit. Every earlier edit has already said dirty:true, from the trail.
 */

import { base64FromBytes, inApp, send, sendDirty } from './bridge.js';
import { createPipeline } from './gl/pipeline.js';

/** The two formats, in the order the sheet lists them. JPEG is the first. */
const FORMATS = [
  { id: 'jpeg', type: 'image/jpeg', ext: 'jpg', key: 'exJpeg' },
  { id: 'png', type: 'image/png', ext: 'png', key: 'exPng' },
];

/** The quality slider's ends, and where it starts. */
const QUALITY_MIN = 60;
const QUALITY_MAX = 100;
const QUALITY_START = 92;

/** Two digits, so a stamp reads the same on every phone. */
const pad = (value) => String(value).padStart(2, '0');

/** `wabfit-photo-20260921-073000.jpg`: one name, sorted by when it was made. */
export function fileName(ext, now) {
  const date = now instanceof Date ? now : new Date();
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `wabfit-photo-${day}-${time}.${ext}`;
}

/** The one sheet, and the pipeline that is only built once a photo is exported. */
export function init(ctx) {
  const formats = Object.assign(document.createElement('div'), { className: 'chips' });
  const size = Object.assign(document.createElement('span'), { className: 'sheet-size' });
  const row = Object.assign(document.createElement('div'), { className: 'slider-row' });
  const slider = document.createElement('input');
  Object.assign(slider, {
    type: 'range', className: 'slider', min: String(QUALITY_MIN),
    max: String(QUALITY_MAX), step: '1', value: String(QUALITY_START),
  });
  const readout = Object.assign(document.createElement('span'), { className: 'value' });
  row.append(slider, readout);
  const note = Object.assign(document.createElement('p'), { className: 'sheet-error' });
  note.setAttribute('role', 'alert');
  note.hidden = true;
  const actions = Object.assign(document.createElement('div'), { className: 'sheet-actions' });
  const go = Object.assign(document.createElement('button'), { type: 'button', className: 'btn primary' });
  const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'btn' });
  actions.append(go, cancel);

  const panel = Object.assign(document.createElement('div'), { className: 'sheet-panel' });
  panel.append(formats, size, row, note, actions);
  const sheet = Object.assign(document.createElement('div'), { className: 'sheet' });
  sheet.hidden = true;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.append(panel);
  document.body.append(sheet);

  const buttons = new Map();
  let chosen = FORMATS[0];
  let painter = null;
  let busy = false;

  for (const format of FORMATS) {
    const button = Object.assign(document.createElement('button'), {
      type: 'button', className: 'chip',
    });
    button.append(document.createElement('span'));
    button.addEventListener('click', () => choose(format));
    buttons.set(format.id, button);
    formats.append(button);
  }

  /** The format under the finger: JPEG unless PNG was pressed. */
  function choose(format) {
    chosen = format;
    for (const [id, button] of buttons) {
      button.setAttribute('aria-pressed', String(id === chosen.id));
    }
  }

  /** The words, in the language the page is in, and the size that will come out. */
  function labels() {
    for (const format of FORMATS) {
      const button = buttons.get(format.id);
      if (!button) continue;
      const word = ctx.t(format.key);
      const span = button.firstElementChild;
      if (span) span.textContent = word;
      button.setAttribute('aria-label', word);
    }
    size.textContent = ctx.baked ? `${ctx.baked.width} × ${ctx.baked.height}` : '';
    slider.setAttribute('aria-label', ctx.t('quality'));
    readout.textContent = slider.value;
    readout.setAttribute('aria-label', `${ctx.t('quality')} ${slider.value}`);
    go.textContent = ctx.t('export');
    cancel.textContent = ctx.t('cancel');
    choose(chosen);
  }

  /** The sheet opens over the page, sized from the photo the pipeline will read. */
  function open() {
    if (!ctx.baked || busy) return;
    note.hidden = true;
    labels();
    sheet.hidden = false;
  }

  /** One line, in the vocabulary's wording, and nothing else is said. */
  function failed() {
    note.textContent = ctx.t('errExport');
    note.hidden = false;
    go.disabled = false;
    cancel.disabled = false;
    busy = false;
  }

  /** The export itself: the whole picture, then the bytes to wherever they go. */
  async function save() {
    const source = ctx.baked;
    if (!source || busy) return;
    busy = true;
    go.disabled = true;
    cancel.disabled = true;
    note.hidden = true;
    try {
      if (!painter) painter = createPipeline(document.createElement('canvas'));
      if (!painter) throw new Error('no webgl2');
      painter.setSource(source);
      const blob = await painter.renderToBlob(ctx.params, chosen.type, Number(slider.value) / 100);
      if (!blob) throw new Error('no blob');
      await deliver(blob, fileName(chosen.ext, new Date()));
      ctx.dirty = false;
      sendDirty(false);
      busy = false;
      go.disabled = false;
      cancel.disabled = false;
      sheet.hidden = true;
    } catch {
      failed();
    }
  }

  /** In the app: base64 to the photo library. In a browser: a download. */
  async function deliver(blob, name) {
    if (inApp()) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      send('export', { name, base64: base64FromBytes(bytes), save: 'library' });
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  go.addEventListener('click', () => {
    save().catch(() => failed());
  });
  cancel.addEventListener('click', () => { sheet.hidden = true; });
  slider.addEventListener('input', () => {
    readout.textContent = slider.value;
    readout.setAttribute('aria-label', `${ctx.t('quality')} ${slider.value}`);
  });

  /** The bar's Export button, wherever it is pressed: the sheet is the answer. */
  ctx.on('export', open);
}
