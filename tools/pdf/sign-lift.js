/**
 * Wab Fit — the signature lifted out of a printed page: the model's answer, and
 * the engine's cut.
 *
 * A signature already on a page is not drawn here, it is found, and two hands do
 * the work:
 *
 *   · the MODEL says WHERE the handwriting is. It is asked — through the app,
 *     which asks the vision function the rest of the app already uses — for the
 *     rectangle of the handwriting inside the crop, because that is what a model
 *     reads well and what a threshold cannot do: tell a pen from the ruled line
 *     beside it, or from the name typed beneath it;
 *   · the ENGINE cuts it out, on the device. The whole lift — the paper under
 *     the ink, the local cut, the rules, the marks, the soft alpha, the ink's
 *     own colour — is `site/tools/pdf/sign-engine.js`, one pure module the page
 *     and the native app both read, and it is documented there. Nothing of that
 *     is repeated here; what this file holds is the crop, the question and the
 *     picture.
 *
 * Neither hand is required. A model that cannot be reached, or that answers that
 * there is no handwriting, leaves the engine's own cut standing and the sheet
 * says the trim was made here. Every function below is quiet: no throw, no
 * console, no dialog, and `cut` returning nothing is a real answer.
 */

import { ask } from './bridge.js';
import { INK_BLACK, INK_BLUE, liftSignature } from './sign-engine.js';

/** What a repainted pen is painted in: the one colour each ink names. */
const FLAT = { black: INK_BLACK, blue: INK_BLUE };

/* ── the crop ────────────────────────────────────────────────────────────── */

/** The crop inside the rectangle the model named, given in 0..1 of it. */
function within(crop, box) {
  if (box === null) return crop;
  const x = Math.min(crop.width - 1, Math.max(0, Math.round(box.x * crop.width)));
  const y = Math.min(crop.height - 1, Math.max(0, Math.round(box.y * crop.height)));
  const width = Math.max(1, Math.min(crop.width - x, Math.round(box.w * crop.width)));
  const height = Math.max(1, Math.min(crop.height - y, Math.round(box.h * crop.height)));
  if (x === 0 && y === 0 && width === crop.width && height === crop.height) return crop;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * crop.width + x) * 4;
    data.set(crop.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { data, width, height };
}

/**
 * Pixels as a PNG data URL, through the page's own canvas, or null when the page
 * gives no context — the same nothing the caller reads as "no signature".
 */
function picture(rgba, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(width, height);
  image.data.set(rgba);
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Three channels out of a `#rrggbb` colour. */
function channels(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/* ── the cut ─────────────────────────────────────────────────────────────── */

/**
 * The crop as the signature it holds, or null when it holds none.
 *
 * `box` is the model's rectangle in 0..1 of the crop — null to take it whole,
 * which is what the page does when the model did not help — and `mode` is what
 * the pen is painted in: 'source' keeps the ink's own colour, 'black' and 'blue'
 * repaint it flat.
 *
 * What comes back is `{ png, w, h, rgba, inkColor, bounds }`: a transparent PNG
 * of the strokes alone cut to the writing's own bounds, and the pixels it was
 * made of — the same frame as the picture — so the sheet can paint the pen in
 * another ink, or rub a mark out of it, without reading the page again.
 */
export function cut(crop, box, mode = 'source') {
  const area = within(crop, box);
  const lift = liftSignature(area.data, area.width, area.height, { ink: mode });
  if (!lift) return null;
  const png = picture(lift.rgba, lift.width, lift.height);
  if (png === null) return null;
  return {
    png,
    w: lift.width,
    h: lift.height,
    rgba: lift.rgba,
    inkColor: lift.inkColor,
    bounds: lift.bounds,
  };
}

/** The lift's alpha under one flat colour, so a repaint keeps the eraser's work. */
function flatly(lift, hex) {
  const [r, g, b] = channels(hex);
  const out = new Uint8ClampedArray(lift.rgba.length);
  for (let at = 0; at < out.length; at += 4) {
    out[at] = r;
    out[at + 1] = g;
    out[at + 2] = b;
    out[at + 3] = lift.rgba[at + 3];
  }
  return out;
}

/**
 * The same lift painted in another ink, as the picture the sheet shows.
 *
 * The alpha is the lift's own, so a mark the eraser took out stays out and the
 * pen's soft edge is never re-derived; 'source' is the lift's own colour, which
 * is what `cut` answers with.
 */
export function repaint(lift, mode) {
  const flat = FLAT[mode];
  const rgba = flat === undefined ? lift.rgba : flatly(lift, flat);
  const png = picture(rgba, lift.w, lift.h);
  return png === null ? null : { png, w: lift.w, h: lift.h, rgba };
}

/**
 * The eraser: a round brush in the lift's own pixels that takes the alpha out
 * where the finger went, so a printed rule or a letter the cut kept by mistake
 * goes with it. `x` and `y` are in the lift's own pixels; answers whether it
 * took anything at all.
 */
export function erase(lift, x, y, radius) {
  const reach = Math.ceil(radius);
  const left = Math.max(0, Math.floor(x - reach));
  const right = Math.min(lift.w - 1, Math.ceil(x + reach));
  const top = Math.max(0, Math.floor(y - reach));
  const bottom = Math.min(lift.h - 1, Math.ceil(y + reach));
  let taken = false;
  for (let py = top; py <= bottom; py += 1) {
    for (let px = left; px <= right; px += 1) {
      if (Math.hypot(px - x, py - y) > radius) continue;
      const at = (py * lift.w + px) * 4 + 3;
      if (lift.rgba[at] === 0) continue;
      lift.rgba[at] = 0;
      taken = true;
    }
  }
  return taken;
}

/* ── what the model says is handwriting ─────────────────────────────────── */

/** The crop as a PNG in base64, with no data-URL head: what the wire carries.
 *  The model is shown a page, so the crop is put on paper first — a transparent
 *  background is nothing at all to a provider that never saw this screen. */
function encoded(crop) {
  const raw = document.createElement('canvas');
  raw.width = crop.width;
  raw.height = crop.height;
  const context = raw.getContext('2d');
  if (!context) return null;
  context.putImageData(new ImageData(crop.data, crop.width, crop.height), 0, 0);

  const sheet = document.createElement('canvas');
  sheet.width = crop.width;
  sheet.height = crop.height;
  const paper = sheet.getContext('2d');
  if (!paper) return null;
  paper.fillStyle = 'rgb(255, 255, 255)';
  paper.fillRect(0, 0, crop.width, crop.height);
  paper.drawImage(raw, 0, 0);
  const url = sheet.toDataURL('image/png');
  return url.slice(url.indexOf(',') + 1);
}

/** One number of the model's box, or null when it is not one in 0..1. */
function fraction(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value >= 0 && value <= 1 ? value : null;
}

/**
 * The model's answer read as the one thing the page asked it for: the rectangle
 * of the handwriting inside the crop, in 0..1 of it.
 *
 * Null for everything else — an answer that says there is no handwriting, one
 * that points outside the crop, one whose numbers are not numbers, or one that
 * never came at all — and the caller then keeps the cut it made itself. The
 * colour the protocol also carries is not read here: the engine takes the ink's
 * own colour off the pixels, which beats any model's word for it.
 */
function boxOf(answer) {
  if (!answer || answer.found !== true) return null;
  const box = answer.box;
  if (typeof box !== 'object' || box === null) return null;
  const x = fraction(box.x);
  const y = fraction(box.y);
  const w = fraction(box.w);
  const h = fraction(box.h);
  if (x === null || y === null || w === null || h === null) return null;
  if (w === 0 || h === 0 || x + w > 1.0001 || y + h > 1.0001) return null;
  return { x, y, w, h };
}

/**
 * Ask the app — which asks the vision function — where the handwriting is in
 * this crop.
 *
 * Everything about the ask is a name the page does not hold: the prompt, the
 * model and the key live on the server, and the page sends a crop and a task and
 * gets back the schema the whole path was written for:
 *
 *   { found, box: {x, y, w, h} in 0..1 of the crop, strokeColorHex, notes }
 *
 * Answers null whenever the model did not speak: no app around the page, no
 * answer inside the bridge's own time, or `found:false`.
 */
export async function askForHandwriting(crop) {
  const image = encoded(crop);
  if (image === null) return null;
  const answer = await ask('vision', {
    task: 'liftSignature',
    image,
    width: crop.width,
    height: crop.height,
  });
  return boxOf(answer);
}
