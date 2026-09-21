/**
 * Wab Fit — the colours of the page underneath.
 *
 * Two tools ask the thing being edited what colour it is. The whiteout tool
 * wants the PAPER around a box, so a cover blends into aged or grey or
 * photographed paper; the edit-text tool wants the INK inside a run, so a
 * retyped word is written in the colour it already had. Both answers come from
 * one place — the canvas pdf.js drew the page on — and this file is that
 * reading, kept apart from the two tools that want it.
 *
 * A page with no bitmap yet (it is not near the screen) and a blank page both
 * answer white paper and black ink: nothing here invents a colour for a page it
 * cannot see, and nothing here waits for one either.
 *
 * A sample is composited over white before it is read, because a cover and a
 * written word are both opaque; and a bitmap this page will not let us read is
 * left alone rather than guessed at.
 */

import { pageBox } from './viewer.js';

/** What covers paper nothing could be read from: a blank page is white. */
const PAPER = '#ffffff';
/** The grid of samples a run of text is read from, per side. */
const GRID = 5;

/** One page's bitmap and its size in points, or null while it is not drawn. */
function bitmap(page) {
  const box = pageBox(page);
  const canvas = box ? box.el.querySelector('canvas') : null;
  if (!box || !canvas || canvas.width === 0 || canvas.height === 0) return null;
  const context = canvas.getContext('2d');
  const width = box.width / box.scale;
  const height = box.height / box.scale;
  if (!context || !(width > 0) || !(height > 0)) return null;
  return { context, canvas, width, height };
}

/** One pixel of a bitmap, laid over white paper, as three channels or null. */
function pixelAt(spot, pt) {
  const column = Math.round((pt.x / spot.width) * spot.canvas.width);
  const row = Math.round((pt.y / spot.height) * spot.canvas.height);
  const x = Math.min(spot.canvas.width - 1, Math.max(0, column));
  const y = Math.min(spot.canvas.height - 1, Math.max(0, row));
  let data;
  try {
    data = spot.context.getImageData(x, y, 1, 1).data;
  } catch {
    // A bitmap this page will not let us read is one to leave alone.
    return null;
  }
  const alpha = data[3] / 255;
  return [0, 1, 2].map((channel) => Math.round(data[channel] * alpha + 255 * (1 - alpha)));
}

/** Three channels as the `#rrggbb` the model keeps. */
function hexOf(rgb) {
  const hex = (value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
  return `#${rgb.map(hex).join('')}`;
}

/** The middle of a list as it stands: samples are picked from, never averaged. */
function middle(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

/**
 * The paper around a box: the median of its four corners, read from the page as
 * it is drawn. White when the page has no bitmap — a blank page is white, and a
 * page not drawn yet is read again the next time it is asked.
 */
export function paperColour(page, box) {
  const spot = bitmap(page);
  if (!spot) return PAPER;
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x, y: box.y + box.h },
    { x: box.x + box.w, y: box.y + box.h },
  ];
  const samples = corners.map((pt) => pixelAt(spot, pt)).filter((rgb) => rgb !== null);
  if (samples.length === 0) return PAPER;
  return hexOf([0, 1, 2].map((channel) => middle(samples.map((rgb) => rgb[channel]))));
}

/**
 * The ink inside a box: the darkest sample of a grid over it, which is a glyph
 * of a letter rather than the paper between them. Black when the box holds
 * nothing darker than pale paper.
 */
export function glyphColour(page, box) {
  const spot = bitmap(page);
  if (!spot) return '#000000';
  let best = null;
  let tone = Infinity;
  for (let row = 0; row < GRID; row += 1) {
    for (let column = 0; column < GRID; column += 1) {
      const rgb = pixelAt(spot, {
        x: box.x + (box.w * (column + 0.5)) / GRID,
        y: box.y + (box.h * (row + 0.5)) / GRID,
      });
      if (!rgb) continue;
      const level = (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) / 255;
      if (level < tone) {
        tone = level;
        best = rgb;
      }
    }
  }
  return best ? hexOf(best) : '#000000';
}
