/**
 * Wab Fit — the signature lifted out of a printed page: who decides what the
 * pixels are, and the cut itself.
 *
 * A signature already on a page is not drawn here, it is found, and two hands
 * do the work:
 *
 *   · the MODEL says WHAT the handwriting is. It is asked — through the app,
 *     which asks the vision function the rest of the app already uses — for the
 *     rectangle of the handwriting inside the crop, because a threshold cannot
 *     tell a pen from the ruled line beside it, or from the name typed beneath
 *     it, and it is asked what else is in the crop that must NOT be taken;
 *   · the PAGE cuts it out, on the device: Otsu's own threshold from the crop's
 *     histogram, a despeckle for the scan's own noise, the strokes in one
 *     colour, everything else transparent.
 *
 * Neither hand is required. A model that cannot be reached, or that answers
 * that there is no handwriting, leaves the page's own cut standing and the
 * sheet says the trim was made here. Every function below is quiet: no throw,
 * no console, no dialog, and `cut` returning nothing is a real answer.
 */

import { ask } from './bridge.js';

/** An island darker than this is the scan's noise; a mark is a stroke. */
const SPECK = 4;
/** The weights that make three channels one grey, Rec. 601's own. */
const RED = 0.299;
const GREEN = 0.587;
const BLUE = 0.114;
/** A pixel's eight neighbours: a mark may step diagonally, so both are one. */
const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** How bright one pixel is, 0..255. A crop is a sheet of paper: what was drawn
 *  transparent in it is the sheet itself, so it counts as white. */
function grey(data, at) {
  const alpha = data[at + 3] / 255;
  const paper = 255 * (1 - alpha);
  return RED * (data[at] * alpha + paper)
    + GREEN * (data[at + 1] * alpha + paper)
    + BLUE * (data[at + 2] * alpha + paper);
}

/* ── the two clumps one crop is made of ──────────────────────────────────── */

/**
 * Otsu's threshold for a crop: the grey, 0..255, that splits its pixels into
 * the two clumps that fit them best. The darker clump is the ink; everything
 * above the threshold is paper.
 *
 * It is the crop's OWN histogram and never a constant, which is the whole
 * point: a photographed page is grey all over where a clean scan is white, and
 * a fixed 128 would keep half the paper of one and none of the ink of the
 * other. A crop with a single grey in it has nothing to split, and the answer
 * is the floor — nothing in it is ink.
 */
export function otsuThreshold(data) {
  const histogram = new Array(256).fill(0);
  const count = data.length / 4;
  let sum = 0;
  for (let at = 0; at < data.length; at += 4) {
    const value = Math.round(grey(data, at));
    histogram[value] += 1;
    sum += value;
  }

  let below = 0;
  let belowSum = 0;
  let threshold = 0;
  let widest = 0;
  for (let value = 0; value < 256; value += 1) {
    below += histogram[value];
    if (below === 0) continue;
    const above = count - below;
    if (above === 0) break;
    belowSum += value * histogram[value];
    // How far apart the two clumps' own middles are, weighed by how many
    // pixels each has: the split that separates them most is the one taken.
    const gap = belowSum / below - (sum - belowSum) / above;
    const spread = below * above * gap * gap;
    if (spread > widest) {
      widest = spread;
      threshold = value;
    }
  }
  return threshold;
}

/**
 * The marks that are not marks: every island of ink under `floor` pixels goes.
 *
 * A scanned page carries dots of its own — dust, the ringing a JPEG leaves
 * around a line, one stray pixel of a halftone — and without this a signature
 * made of a thin pen comes with a rash of them around it. Islands are found by
 * walking them, eight-connected so a diagonal step is still one mark, and the
 * mask is changed in place and answered back.
 */
export function despeckle(mask, width, height, floor = SPECK) {
  const seen = new Uint8Array(mask.length);
  const island = [];
  const stack = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || seen[start] === 1) continue;
    island.length = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop();
      island.push(at);
      const x = at % width;
      const y = (at - x) / width;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (mask[next] === 0 || seen[next] === 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (island.length < floor) for (const at of island) mask[at] = 0;
  }
  return mask;
}

/* ── the cut ─────────────────────────────────────────────────────────────── */

/** The channels one stroke colour names, or black when it names nothing usable. */
function channels(colour) {
  const hex = typeof colour === 'string' ? colour.trim() : '';
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return [0, 0, 0];
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

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

/** The box the ink itself fills, or null when there is none at all. */
function inkBounds(mask, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return null;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/**
 * The crop as the signature it holds, or null when it holds none.
 *
 * `box` is the model's rectangle in 0..1 of the crop — null to take it whole,
 * which is the answer when the model did not help — and `colour` is the ink it
 * read, or null for black. What comes back is `{ png, w, h }`: a transparent
 * PNG of the strokes alone, cut to their own bounds, which is what the pad's
 * own `trimmed()` hands the same list for a drawn signature.
 *
 * Null is a real answer — blank paper, or a threshold under a mark that is not
 * there — and it is why a save is never offered on an empty cut.
 */
export function cut(crop, box, colour) {
  const area = within(crop, box);
  const threshold = otsuThreshold(area.data);
  const mask = new Uint8Array(area.width * area.height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (grey(area.data, pixel * 4) <= threshold) mask[pixel] = 1;
  }
  despeckle(mask, area.width, area.height);

  const bounds = inkBounds(mask, area.width, area.height);
  if (!bounds) return null;
  const canvas = document.createElement('canvas');
  canvas.width = bounds.w;
  canvas.height = bounds.h;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const strokes = context.createImageData(bounds.w, bounds.h);
  const [r, g, b] = channels(colour);
  for (let y = 0; y < bounds.h; y += 1) {
    for (let x = 0; x < bounds.w; x += 1) {
      if (mask[(y + bounds.y) * area.width + (x + bounds.x)] === 0) continue;
      const at = (y * bounds.w + x) * 4;
      strokes.data[at] = r;
      strokes.data[at + 1] = g;
      strokes.data[at + 2] = b;
      strokes.data[at + 3] = 255;
    }
  }
  context.putImageData(strokes, 0, 0);
  return { png: canvas.toDataURL('image/png'), w: bounds.w, h: bounds.h };
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
 * The model's answer read as a question the page asked: where the handwriting
 * is inside the crop, and what colour it is.
 *
 * Null for everything else — an answer that says there is no handwriting, one
 * that points outside the crop, one whose numbers are not numbers, or one that
 * never came at all — and the caller then keeps the cut it made itself. The
 * `notes` the protocol asks for are the model's own working: they are read by
 * nobody on this screen.
 */
function readingOf(answer) {
  if (!answer || answer.found !== true) return null;
  const box = answer.box;
  if (typeof box !== 'object' || box === null) return null;
  const x = fraction(box.x);
  const y = fraction(box.y);
  const w = fraction(box.w);
  const h = fraction(box.h);
  if (x === null || y === null || w === null || h === null) return null;
  if (w === 0 || h === 0 || x + w > 1.0001 || y + h > 1.0001) return null;
  const colour = typeof answer.strokeColorHex === 'string' ? answer.strokeColorHex : null;
  return { box: { x, y, w, h }, colour };
}

/**
 * Ask the app — which asks the vision function — which pixels of this crop are
 * the handwriting.
 *
 * Everything about the ask is a name the page does not hold: the prompt, the
 * model and the key live on the server, and the page sends a crop and a task
 * and gets back the schema the whole path was written for:
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
  return readingOf(answer);
}
