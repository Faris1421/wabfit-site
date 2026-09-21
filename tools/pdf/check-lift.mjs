#!/usr/bin/env node
/**
 * Wab Fit — the lift's own check: Otsu's threshold and the despeckle against a
 * bitmap whose right answers can be counted by eye.
 *
 *   node site/tools/pdf/check-lift.mjs
 *
 * It imports the module the page itself imports, so what is checked is what
 * runs. Silence is a pass; a failure prints one line per problem and exits 1.
 */

import { cut, despeckle, otsuThreshold } from './sign-lift.js';

/** A grey bitmap as RGBA bytes, where `greyAt(x, y)` is one pixel's own grey. */
function bitmap(width, height, greyAt) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < width * height; at += 1) {
    const value = greyAt(at % width, Math.floor(at / width));
    data[at * 4] = value;
    data[at * 4 + 1] = value;
    data[at * 4 + 2] = value;
    data[at * 4 + 3] = 255;
  }
  return data;
}

/** The ink as the cut reads it: every pixel at or under the threshold, and the
 *  despeckle that follows it. Answers the mask, so the test can look at it. */
function inkOf(data, width, height) {
  const threshold = otsuThreshold(data);
  const mask = new Uint8Array(width * height);
  for (let at = 0; at < mask.length; at += 1) {
    if (data[at * 4] <= threshold) mask[at] = 1;
  }
  despeckle(mask, width, height);
  return mask;
}

const problems = [];
const check = (what, ok) => {
  if (!ok) problems.push(what);
};

/*
 * A sixteen-pixel page: white paper, one eight-pixel pen stroke across the
 * middle, and two single dots of the scan's own noise. Otsu's split falls
 * between the two greys — one clump is the pen, the other is the paper — and
 * the despeckle takes the dots and nothing else.
 */
const WIDTH = 16;
const HEIGHT = 16;
const PAPER = 238;
const PEN = 26;
const stroke = (x, y) => y === 8 && x >= 4 && x <= 11;
const dot = (x, y) => (x === 1 && y === 1) || (x === 14 && y === 3);
const page = bitmap(WIDTH, HEIGHT, (x, y) => (stroke(x, y) ? PEN : dot(x, y) ? 120 : PAPER));

const threshold = otsuThreshold(page);
check(
  `otsu: ${threshold} is not between the pen (${PEN}) and the paper (${PAPER})`,
  threshold >= PEN && threshold < PAPER,
);

const ink = inkOf(page, WIDTH, HEIGHT);
const inkCount = ink.reduce((sum, one) => sum + one, 0);
check(`despeckle: ${inkCount} pixels of ink are left, the stroke is 8`, inkCount === 8);
check('despeckle: the noise dot at (1, 1) survived', ink[1 * WIDTH + 1] === 0);
check('despeckle: the noise dot at (14, 3) survived', ink[3 * WIDTH + 14] === 0);
check('despeckle: a stroke pixel was cleared', ink[8 * WIDTH + 4] === 1);

/* The floor is four: a two-by-two mark is kept, a three-pixel one is not. */
const block = bitmap(8, 8, (x, y) => (x < 2 && y < 2 ? 30 : 240));
const blockInk = inkOf(block, 8, 8);
check(`despeckle: a 2×2 mark was cut, ${blockInk.reduce((a, b) => a + b, 0)} pixels are left`,
  blockInk.reduce((sum, one) => sum + one, 0) === 4);

const line = bitmap(8, 8, (x, y) => (x < 3 && y === 5 ? 30 : 240));
const lineInk = inkOf(line, 8, 8);
check('despeckle: a three-pixel mark survived', lineInk.reduce((sum, one) => sum + one, 0) === 0);

/* One grey and no second clump: nothing in it is ink, whatever the grey is. */
const flat = otsuThreshold(bitmap(8, 8, () => 255));
check(`otsu: a crop of plain paper answered ${flat}`, flat === 0);

/*
 * The cut itself, with the canvas faked: Node has none, and what is being
 * checked is not the canvas but the mask, the colour and the bounds the strokes
 * are cut to — the three things that decide whether a signature arrives whole.
 * `toDataURL` answers a head this test can recognise instead of a PNG. The
 * module only reaches for a canvas when it is called, so the stand-in is
 * installed before the first call and never at import time.
 */
let painted = null;
function statedCanvas() {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (width, height) => ({
        width, height, data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: (image) => { painted = image; },
    }),
    toDataURL: () => 'data:image/png;base64,stated',
  };
}

globalThis.document = { createElement: () => statedCanvas() };

/* A six-by-two pen mark on paper, and one dot of noise that is not a mark. */
const CROP = 20;
const mark = (x, y) => x >= 5 && x <= 10 && y >= 9 && y <= 10;
const dirty = bitmap(CROP, CROP, (x, y) => (mark(x, y) ? 20 : x === 17 && y === 2 ? 90 : 240));
const lifted = cut({ data: dirty, width: CROP, height: CROP }, null, '#112233');

check('cut: a page with a mark on it answered nothing', lifted !== null);
check('cut: nothing was written out of the cut', painted !== null);
const written = painted;
check(
  `cut: the strokes are ${written ? `${written.width}×${written.height}` : '—'}, the mark is 6×2`,
  Boolean(written) && written.width === 6 && written.height === 2,
);
check('cut: the cut is not a PNG data URL',
  Boolean(lifted) && lifted.png.startsWith('data:image/png;base64,'));
check(`cut: the cut is ${lifted ? lifted.w : '—'}×${lifted ? lifted.h : '—'}, the mark is 6×2`,
  Boolean(lifted) && lifted.w === 6 && lifted.h === 2);
if (written) {
  check('cut: a stroke pixel did not take the colour the model read',
    written.data[0] === 17 && written.data[1] === 34 && written.data[2] === 51
      && written.data[3] === 255);
  let opaque = 0;
  for (let at = 3; at < written.data.length; at += 4) if (written.data[at] === 255) opaque += 1;
  check(`cut: ${opaque} pixels of ink were written, the mark is 12`, opaque === 12);
}

/* Blank paper is not a signature, and the answer is nothing to save. */
const blank = cut({ data: bitmap(CROP, CROP, () => 240), width: CROP, height: CROP }, null, null);
check('cut: a blank crop answered a signature', blank === null);

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-lift: ${problem}`);
  console.error(`check-lift: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('check-lift: otsu, despeckle and the cut — ok');
