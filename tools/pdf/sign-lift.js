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
/** A frame that is more than this share ink was drawn around a block, not a
 *  hand: a photograph, a dark table cell, a shaded field. */
const MAX_INK_SHARE = 0.35;
/** A mark under this many pixels thick on one axis that runs this share of the
 *  crop along the other is a rule — a border, an underline, a table's line. */
const RULE_THICK_PX = 3;
const RULE_SPAN = 0.7;
/** How near the seed of the writing a mark must be to be part of it: this share
 *  of the crop's longer side, and never under NEAR_FLOOR_PX pixels. */
const NEAR_PX = 0.06;
const NEAR_FLOOR_PX = 4;
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

/* ── the writing, and what only shares its frame ─────────────────────────── */

/**
 * The share of the crop that is ink, 0..1.
 *
 * A reader draws a box around a signature, and a signature is a few percent of
 * such a box. A frame that is mostly ink was drawn around a block — a
 * photograph, a dark table cell, a shaded field — and its two clumps are the
 * block and the block: there is no handwriting in it to find.
 */
function inkShare(mask) {
  let ink = 0;
  for (let at = 0; at < mask.length; at += 1) if (mask[at] === 1) ink += 1;
  return mask.length === 0 ? 0 : ink / mask.length;
}

/**
 * The mask's islands, each with the box it fills and the pixels it holds — the
 * same eight-connected walk the despeckle makes, kept instead of counted.
 *
 * The despeckle has already taken the dust; what is here is every mark the
 * page's own threshold found, and the cut has to tell them apart: the pen from
 * the rule beside it, and the pen from the printed word in the corner.
 */
function components(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const marks = [];
  const stack = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || seen[start] === 1) continue;
    const pixels = [];
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop();
      pixels.push(at);
      const x = at % width;
      const y = (at - x) / width;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
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
    marks.push({ pixels, box: { x: left, y: top, w: right - left + 1, h: bottom - top + 1 } });
  }
  return marks;
}

/**
 * Whether one mark is a straight run rather than a stroke: under RULE_THICK_PX
 * thick on one axis and at least RULE_SPAN of the crop long on the other.
 *
 * That is a table rule, a page border or an underline — never a pen, which is
 * never both that thin and that long. It is the one mark the threshold cannot
 * be blamed for: it is ink, and it is not handwriting.
 */
function ruled(box, width, height) {
  const across = box.h < RULE_THICK_PX && box.w >= RULE_SPAN * width;
  const down = box.w < RULE_THICK_PX && box.h >= RULE_SPAN * height;
  return across || down;
}

/**
 * Whether two boxes come within `gap` pixels of each other. What is measured is
 * the empty space between them, so a box touching another is nothing away and
 * two boxes overlapping are nothing away either.
 */
function reaches(one, other, gap) {
  const apartX = Math.max(0, Math.max(one.x - (other.x + other.w), other.x - (one.x + one.w)));
  const apartY = Math.max(0, Math.max(one.y - (other.y + other.h), other.y - (one.y + one.h)));
  return apartX <= gap && apartY <= gap;
}

/**
 * The marks that are the writing, or none.
 *
 * The rules go first — they are ink and they are not a hand. Of what is left the
 * LARGEST mark is the seed, because the signature is the biggest handwritten
 * thing inside a frame a reader drew around it, and every mark whose box reaches
 * the seed joins it, again and again until nothing more does: a signature is
 * several strokes, and the dot on an i must not be lost. A printed word or a
 * logo edge sitting in the corner of the frame is never reached, and is left
 * where it is.
 */
function writing(marks, width, height) {
  const survivors = marks.filter((one) => !ruled(one.box, width, height));
  let seed = null;
  for (const one of survivors) {
    if (seed === null || one.pixels.length > seed.pixels.length) seed = one;
  }
  if (seed === null) return [];
  const gap = Math.max(NEAR_FLOOR_PX, Math.round(NEAR_PX * Math.max(width, height)));
  const kept = new Set([seed]);
  let joined = true;
  while (joined) {
    joined = false;
    for (const one of survivors) {
      if (kept.has(one)) continue;
      for (const held of kept) {
        if (!reaches(held.box, one.box, gap)) continue;
        kept.add(one);
        joined = true;
        break;
      }
    }
  }
  return survivors.filter((one) => kept.has(one));
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

/** The floor of a kept pixel's alpha. A pixel only just under the threshold is
 *  the pen's anti-aliased edge and not its body, and an edge that shows more
 *  paper than this is a fringe the eye reads as a stain, not as ink. */
const EDGE_ALPHA_MIN = 90;

/**
 * The alpha one kept pixel is written at, 0..255: solid at the darkest grey the
 * mask holds — the pen's own core — and falling to EDGE_ALPHA_MIN at the
 * threshold, where the ink stops and the paper starts.
 *
 * A mark whose every pixel is one grey is all core, and answers solid: the
 * darkest grey IS the threshold then, and there is no edge to lighten. A pen
 * with a soft edge keeps its soft edge, instead of arriving grainy and bolder
 * than it was.
 */
function alphaOf(value, darkest, threshold) {
  if (threshold <= darkest) return 255;
  const under = (threshold - value) / (threshold - darkest);
  const alpha = EDGE_ALPHA_MIN + (255 - EDGE_ALPHA_MIN) * under;
  return Math.max(EDGE_ALPHA_MIN, Math.min(255, Math.round(alpha)));
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
 * PNG of the strokes alone, cut to the writing's own bounds — the rules and the
 * printed strangers that share the frame are dropped before anything is
 * measured — which is what the pad's own `trimmed()` hands the same list for a
 * drawn signature.
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
  if (inkShare(mask) > MAX_INK_SHARE) return null;

  const marks = components(mask, area.width, area.height);
  const kept = new Set(writing(marks, area.width, area.height));
  for (const one of marks) {
    if (kept.has(one)) continue;
    for (const at of one.pixels) mask[at] = 0;
  }

  const bounds = inkBounds(mask, area.width, area.height);
  if (!bounds) return null;

  let darkest = threshold;
  for (let y = bounds.y; y < bounds.y + bounds.h; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x += 1) {
      const at = y * area.width + x;
      if (mask[at] === 0) continue;
      const value = grey(area.data, at * 4);
      if (value < darkest) darkest = value;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = bounds.w;
  canvas.height = bounds.h;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const strokes = context.createImageData(bounds.w, bounds.h);
  const [r, g, b] = channels(colour);
  for (let y = 0; y < bounds.h; y += 1) {
    for (let x = 0; x < bounds.w; x += 1) {
      const from = (y + bounds.y) * area.width + (x + bounds.x);
      if (mask[from] === 0) continue;
      const at = (y * bounds.w + x) * 4;
      strokes.data[at] = r;
      strokes.data[at + 1] = g;
      strokes.data[at + 2] = b;
      strokes.data[at + 3] = alphaOf(grey(area.data, from * 4), darkest, threshold);
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
