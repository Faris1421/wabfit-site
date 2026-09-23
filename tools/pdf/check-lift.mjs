#!/usr/bin/env node
/**
 * Wab Fit — the lift's own check: a pen out of a page, the ink it was written
 * in, the three inks it may be painted in, and the eraser.
 *
 *   node site/tools/pdf/check-lift.mjs
 *
 * It imports the module the page itself imports, so what is checked is what
 * runs, and each bitmap below is built to have its right answer counted by eye.
 * Silence is a pass; a failure prints one line per problem and exits 1.
 */

import { cut, erase, repaint } from './sign-lift.js';
import { INK_BLUE, MAX_SIDE, fitToMaxSide, liftSignature } from './sign-engine.js';

const problems = [];
const check = (what, ok) => {
  if (!ok) problems.push(what);
};

/*
 * Node has no canvas, and the lift reaches for one only to encode its picture.
 * The cut answers its own pixels, so nothing here is read back out of this
 * stand-in: what it has to prove is that the page's own path to a PNG runs.
 */
let painted = null;
globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (width, height) => ({
        width, height, data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: (image) => { painted = image; },
    }),
    toDataURL: () => 'data:image/png;base64,stated',
  }),
};

/* ── the bitmaps ─────────────────────────────────────────────────────────── */

/** What each thing on the page is drawn in. */
const PAPER = { r: 255, g: 255, b: 255 };
/** The pen of this check: a blue ballpoint, which no black cut may claim. */
const PEN = { r: 26, g: 60, b: 150 };
/** A printed block — a name, a logo, a table cell — and a printed rule. */
const PRINT = { r: 58, g: 58, b: 64 };
const RULE = { r: 88, g: 126, b: 178 };

const clamp01 = (value) => Math.max(0, Math.min(1, value));

/** How far a pixel sits from a segment, in pixels. */
function away(x, y, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? clamp01(((x - a.x) * dx + (y - a.y) * dy) / lengthSq) : 0;
  return Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
}

/** A sheet of white paper, writable, as the RGBA the lift is handed. */
function plate(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < width * height; at += 1) {
    data[at * 4] = PAPER.r;
    data[at * 4 + 1] = PAPER.g;
    data[at * 4 + 2] = PAPER.b;
    data[at * 4 + 3] = 255;
  }
  return { data, width, height };
}

/** One pixel of ink, in proportion to how much of it the stroke covers. That is
 *  what an anti-aliased edge is, and what the lift's soft alpha comes from. */
function paint(target, x, y, colour, cover) {
  if (cover <= 0) return;
  const at = (y * target.width + x) * 4;
  const a = clamp01(cover);
  const mix = (under, over) => Math.round(under * (1 - a) + over * a);
  target.data[at] = mix(target.data[at], colour.r);
  target.data[at + 1] = mix(target.data[at + 1], colour.g);
  target.data[at + 2] = mix(target.data[at + 2], colour.b);
  target.data[at + 3] = 255;
}

/** A stroke of the pen, laid along the points it went through. */
function stroke(target, points, width, colour) {
  const half = width / 2;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const left = Math.max(0, Math.floor(Math.min(a.x, b.x) - half - 1));
    const right = Math.min(target.width - 1, Math.ceil(Math.max(a.x, b.x) + half + 1));
    const top = Math.max(0, Math.floor(Math.min(a.y, b.y) - half - 1));
    const bottom = Math.min(target.height - 1, Math.ceil(Math.max(a.y, b.y) + half + 1));
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        paint(target, x, y, colour, half + 0.5 - away(x, y, a, b));
      }
    }
  }
}

/** A rectangle of print, its edge as hard as print is. */
function bar(target, x, y, w, h, colour) {
  const left = Math.max(0, Math.round(x));
  const right = Math.min(target.width, Math.round(x + w));
  const top = Math.max(0, Math.round(y));
  const bottom = Math.min(target.height, Math.round(y + h));
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) paint(target, px, py, colour, 1);
  }
}

/** One wave of a pen, sampled far finer than the pen is wide. */
function wave(from, to, middle, amplitude, period) {
  const points = [];
  for (let x = from; x <= to; x += 0.5) {
    points.push({ x, y: middle + amplitude * Math.sin((x / period) * 2 * Math.PI) });
  }
  return points;
}

/* ── reading a cut back ──────────────────────────────────────────────────── */

/** Pixels of the cut that are partly transparent: the source's own soft edge,
 *  which a binary mask re-deriving its alpha can never produce. */
function partial(cutOut) {
  let count = 0;
  for (let at = 3; at < cutOut.rgba.length; at += 4) {
    const alpha = cutOut.rgba[at];
    if (alpha > 0 && alpha < 250) count += 1;
  }
  return count;
}

/** How much of the cut is ink at all, at any alpha. */
function inked(cutOut) {
  let count = 0;
  for (let at = 3; at < cutOut.rgba.length; at += 4) if (cutOut.rgba[at] > 0) count += 1;
  return count;
}

/** The mean colour of the cut's body — the pixels the pen is solid in. */
function meanInk(cutOut) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let at = 0; at + 3 < cutOut.rgba.length; at += 4) {
    if (cutOut.rgba[at + 3] < 250) continue;
    r += cutOut.rgba[at];
    g += cutOut.rgba[at + 1];
    b += cutOut.rgba[at + 2];
    count += 1;
  }
  return count === 0 ? null : { r: r / count, g: g / count, b: b / count };
}

/** How far the mean colour of a cut's body is from a colour, one number. */
function colourGap(cutOut, colour) {
  const mean = meanInk(cutOut);
  if (mean === null) return Infinity;
  return Math.max(
    Math.abs(mean.r - colour.r),
    Math.abs(mean.g - colour.g),
    Math.abs(mean.b - colour.b),
  );
}

/** Where a colour sits on the wheel, in degrees. */
function hue(colour) {
  const max = Math.max(colour.r, colour.g, colour.b);
  const min = Math.min(colour.r, colour.g, colour.b);
  const span = max - min;
  if (span === 0) return 0;
  let where;
  if (max === colour.r) where = ((colour.g - colour.b) / span) % 6;
  else if (max === colour.g) where = (colour.b - colour.r) / span + 2;
  else where = (colour.r - colour.g) / span + 4;
  return ((where * 60) % 360 + 360) % 360;
}

/** The hue between two degrees, the short way round the wheel. */
function hueGap(a, b) {
  const raw = Math.abs(a - b) % 360;
  return Math.min(raw, 360 - raw);
}

/** Is every pixel with any alpha painted exactly this colour? */
function flatIn(cutOut, r, g, b) {
  for (let at = 0; at + 3 < cutOut.rgba.length; at += 4) {
    if (cutOut.rgba[at + 3] === 0) continue;
    if (cutOut.rgba[at] !== r || cutOut.rgba[at + 1] !== g || cutOut.rgba[at + 2] !== b) {
      return false;
    }
  }
  return true;
}

/** Do two cuts carry one alpha a pixel, in the same frame? */
function sameAlpha(one, other) {
  if (one.w !== other.w || one.h !== other.h) return false;
  for (let at = 3; at < one.rgba.length; at += 4) {
    if (one.rgba[at] !== other.rgba[at]) return false;
  }
  return true;
}

/* ── the pen, and the colour it was written in ───────────────────────────── */

const WIDE = 400;
const TALL = 200;

const clean = plate(WIDE, TALL);
stroke(clean, wave(40, 360, 120, 26, 130), 7, PEN);

const own = cut(clean, null, 'source');
check('cut: a pen on paper answered nothing', own !== null);
if (own) {
  check('cut: the cut is not a PNG data URL', own.png.startsWith('data:image/png;base64,'));
  check('cut: nothing was written out of the cut', painted !== null && painted.width === own.w);
  check(
    `cut: a crop of ${WIDE}×${TALL} answered a cut ${own.w}×${own.h}, the pen is 320 wide`,
    own.w > 280 && own.w < WIDE && own.h > 40 && own.h < TALL,
  );
  check(
    `cut: the cut is at ${own.bounds.x},${own.bounds.y}, outside the crop`,
    own.bounds.x >= 0 && own.bounds.y >= 0
      && own.bounds.x + own.bounds.w <= WIDE && own.bounds.y + own.bounds.h <= TALL,
  );
  const partials = partial(own);
  check(`cut: only ${partials} pixels of the cut are partly transparent`, partials > 200);
  const written = meanInk(own);
  check(
    'cut: the pen was not answered in the colour it was written in',
    written !== null && hueGap(hue(written), hue(PEN)) < 25 && written.b > written.r + 40,
  );
}

/* ── the three inks ──────────────────────────────────────────────────────── */

const black = cut(clean, null, 'black');
check('ink: the same pen in black answered nothing', black !== null);
if (black && own) {
  check('ink: black is not black', flatIn(black, 0, 0, 0));
  check('ink: repainting in black changed the alpha', sameAlpha(black, own));
}
const blue = cut(clean, null, 'blue');
check('ink: the same pen in blue answered nothing', blue !== null);
if (blue && own) {
  const value = Number.parseInt(INK_BLUE.slice(1), 16);
  check(
    'ink: the engine\'s blue is not the colour it was painted in',
    flatIn(blue, (value >> 16) & 255, (value >> 8) & 255, value & 255),
  );
  check('ink: repainting in blue changed the alpha', sameAlpha(blue, own));
}

/* ── what only shares the frame ──────────────────────────────────────────── */

/*
 * A printed rule across the top, a printed block in the bottom corner, and the
 * pen between them — which is what a signature on a form looks like, and what
 * the largest-mark-wins lift of the old page came back with as all three.
 */
const framed = plate(WIDE, TALL);
bar(framed, 10, 12, 420, 3, RULE);
bar(framed, 300, 150, 40, 40, PRINT);
stroke(framed, wave(40, 240, 90, 22, 120), 7, PEN);

const framedCut = cut(framed, null, 'source');
check('frame: a page with a rule and a printed block answered nothing', framedCut !== null);
if (framedCut) {
  const kept = framedCut.bounds;
  check(
    `frame: the cut reaches y ${kept.y} of the crop, the printed rule is at 12`,
    kept.y > 30,
  );
  check(
    `frame: the cut reaches y ${kept.y + kept.h}, the printed block starts at 150`,
    kept.y + kept.h < 150,
  );
  check(
    `frame: the cut is ${kept.w} wide, the pen is 200 wide and the block is 40 further on`,
    kept.w > 150 && kept.w < 260,
  );
}

/* ── the box the model named ─────────────────────────────────────────────── */

/*
 * Two hands, one in each half, and the model's rectangle over one of them: what
 * comes back must be that hand and nothing of the other.
 */
const split = plate(WIDE, TALL);
stroke(split, wave(40, 170, 100, 20, 110), 7, PEN);
stroke(split, wave(230, 360, 100, 20, 110), 7, PEN);

const half = cut(split, { x: 0.5, y: 0, w: 0.5, h: 1 }, 'source');
check('box: the box the model named covered a hand and answered nothing', half !== null);
if (half) {
  check(
    `box: the cut is ${half.w} wide, the box is ${WIDE / 2} wide`,
    half.w < WIDE / 2 && half.w > 60,
  );
  check(
    `box: the cut is ${half.h} tall, the other hand is in the same crop`,
    half.h < 120,
  );
}
const empty = cut(split, { x: 0.45, y: 0.7, w: 0.1, h: 0.3 }, 'source');
check('box: a box over bare paper answered a signature', empty === null);

/* Blank paper is not a signature, and the answer is nothing to save. */
const blank = cut(plate(WIDE, TALL), null, 'source');
check('cut: blank paper answered a signature', blank === null);

/* ── the eraser, and the ink it leaves behind ────────────────────────────── */

/*
 * The one mark on the page, rubbed out where it is opaque: the pixels under the
 * brush lose their alpha, the picture is made again from what is left, and the
 * ink chips still paint the same pixels — the alpha is never re-derived.
 */
const rubbed = own && { rgba: own.rgba, w: own.w, h: own.h };
if (rubbed) {
  const before = inked(rubbed);
  // A pixel of the pen's own body, found by its alpha rather than guessed.
  let at = -1;
  for (let i = 3; i < rubbed.rgba.length; i += 4) {
    if (rubbed.rgba[i] === 255) {
      at = (i - 3) / 4;
      break;
    }
  }
  check('erase: the pen has no solid pixel to rub out', at >= 0);
  if (at >= 0) {
    const x = at % rubbed.w;
    const y = (at - x) / rubbed.w;
    const took = erase(rubbed, x, y, 9);
    check('erase: rubbing 9 px out of the pen took nothing', took);
    check(
      `erase: the pixel under the brush kept its alpha (${rubbed.rgba[at * 4 + 3]})`,
      rubbed.rgba[at * 4 + 3] === 0,
    );
    const after = inked(rubbed);
    check(`erase: ${before} pixels were inked before and ${after} after`, after < before);
    check(
      'erase: the brush reached further than it was told',
      inked(rubbed) > 0,
    );
    const again = repaint(rubbed, 'black');
    check('erase: a rubbed cut could not be painted again', again !== null);
    if (again) {
      check('erase: painting again did not keep the alpha', sameAlpha(again, rubbed));
      check('erase: painting again is not black', flatIn(again, 0, 0, 0));
      const mine = repaint(rubbed, 'source');
      check('erase: the pen\'s own colour did not survive a repaint',
        mine !== null && colourGap(mine, PEN) < 60);
    }
  }
}

/* ── the size a crop is read at ──────────────────────────────────────────── */

check(`side: the engine works a crop at ${MAX_SIDE} px, not 3000`, MAX_SIDE === 3000);
const small = plate(400, 200);
const left = fitToMaxSide(small.data, 400, 200);
check('side: a crop under the cap was resized', left.rgba === small.data && left.width === 400);
const big = fitToMaxSide(new Uint8ClampedArray(3600 * 900 * 4), 3600, 900);
check(
  `side: 3600×900 was brought down to ${big.width}×${big.height}, not 3000×750`,
  big.width === 3000 && big.height === 750,
);

/*
 * A photographed page bigger than the cap, with the pen on it: the lift reads it
 * at 3000 px on the longer side, which is where its bounds must be.
 */
const huge = plate(3200, 900);
stroke(huge, wave(300, 1400, 400, 60, 300), 11, PEN);
const capped = liftSignature(huge.data, huge.width, huge.height);
check('side: a crop over the cap answered nothing', capped !== null);
if (capped) {
  check(
    `side: the cut is at ${capped.bounds.x} + ${capped.bounds.w}, outside the working frame`,
    capped.bounds.x + capped.bounds.w <= MAX_SIDE && capped.bounds.y + capped.bounds.h <= 900,
  );
  check('side: the cut is not the pen it was taken from',
    capped.width > 600 && capped.width < MAX_SIDE);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-lift: ${problem}`);
  console.error(`check-lift: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('check-lift: the pen, the inks and the eraser — ok');
