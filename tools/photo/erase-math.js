/**
 * Wab Fit — the erase tool's arithmetic, without a pixel.
 *
 * Pure, DOM-free and clock-free, so the same file runs in the page and under
 * vitest in Node. Nothing here draws: it says which square of the picture an
 * inpainting pass reads, how far the filled edge feathers out past the paint, and
 * how the fill is mixed back over the photograph.
 *
 * THE SQUARE IS NEARLY TWICE THE PAINT. The inpainter invents its best answers
 * with a margin of real picture around the hole, so the region handed to it is
 * `max(width, height) * 2.2` a side, never below 256 or above 1024 pixels,
 * centred on the paint and SHIFTED — not shrunk — to stay inside the picture. A
 * picture smaller than the square is the one case the square gives way.
 */

/** The smallest and largest side of the region an inpaint reads, in pixels. */
export const ROI_MIN = 256;
export const ROI_MAX = 1024;

/** How much of the paint's own size the region adds around it. */
const ROI_ROOM = 2.2;

/** A rectangle in picture pixels. */
const box = (x, y, w, h) => ({ x, y, w, h });

/** True when two rectangles share at least one pixel. */
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The smallest rectangle holding both. */
function union(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return box(x, y, Math.max(a.x + a.w, b.x + b.w) - x, Math.max(a.y + a.h, b.y + b.h) - y);
}

/**
 * The separate painted areas of `strokes`, one bounding box each: strokes whose
 * discs touch are one area, and a stroke far from every other starts its own, so
 * two objects painted apart are two inpaints. An eraser stroke takes paint away
 * rather than adding it, so it names no area of its own.
 */
export function strokeAreas(strokes) {
  const areas = [];
  for (const stroke of strokes) {
    if (stroke.erase) continue;
    const r = Math.max(1, Math.abs(stroke.r));
    areas.push(box(stroke.x - r, stroke.y - r, r * 2, r * 2));
  }
  let joined = true;
  while (joined) {
    joined = false;
    for (let a = 0; a < areas.length && !joined; a += 1) {
      for (let b = a + 1; b < areas.length; b += 1) {
        if (!overlaps(areas[a], areas[b])) continue;
        areas[a] = union(areas[a], areas[b]);
        areas.splice(b, 1);
        joined = true;
        break;
      }
    }
  }
  return areas;
}

/**
 * The square region an inpaint reads around `bbox`: `side` pixels on both sides,
 * centred on the paint, shifted back under the picture's edges, and shrunk only
 * when the picture itself is smaller than the square.
 */
export function roiForMask(bbox, imageW, imageH) {
  const wide = Math.max(1, Math.round(Number(imageW) || 0));
  const tall = Math.max(1, Math.round(Number(imageH) || 0));
  const spread = Math.max(Number(bbox.w) || 0, Number(bbox.h) || 0);
  let side = Math.round(Math.min(ROI_MAX, Math.max(ROI_MIN, spread * ROI_ROOM)));
  side = Math.max(1, Math.min(side, wide, tall));
  const x = Math.min(Math.max(0, Math.round(bbox.x + bbox.w / 2 - side / 2)), wide - side);
  const y = Math.min(Math.max(0, Math.round(bbox.y + bbox.h / 2 - side / 2)), tall - side);
  return box(x, y, side, side);
}

/** An index held inside a line: the blur's window never reads past an edge. */
function inside(at, span) {
  return at < 0 ? 0 : at >= span ? span - 1 : at;
}

/** The place in `src` a `horizontal` run at `line`, `at` reads and writes. */
function where(line, at, wide, horizontal) {
  return horizontal ? line * wide + at : at * wide + line;
}

/**
 * One axis of a maximum filter of radius `r`: every sample becomes the largest
 * within `r` of it, which grows the paint's edge outwards by exactly `r`.
 */
function dilate(src, dst, wide, tall, r, horizontal) {
  const span = horizontal ? wide : tall;
  const lines = horizontal ? tall : wide;
  for (let line = 0; line < lines; line += 1) {
    for (let at = 0; at < span; at += 1) {
      let best = 0;
      const from = Math.max(0, at - r);
      const to = Math.min(span - 1, at + r);
      for (let step = from; step <= to; step += 1) {
        const value = src[where(line, step, wide, horizontal)];
        if (value > best) best = value;
      }
      dst[where(line, at, wide, horizontal)] = best;
    }
  }
}

/** One axis of a box blur of radius `r`, with the window held inside the edges. */
function soften(src, dst, wide, tall, r, horizontal) {
  const span = horizontal ? wide : tall;
  const lines = horizontal ? tall : wide;
  const size = r * 2 + 1;
  for (let line = 0; line < lines; line += 1) {
    for (let at = 0; at < span; at += 1) {
      let sum = 0;
      for (let step = at - r; step <= at + r; step += 1) {
        sum += src[where(line, inside(step, span), wide, horizontal)];
      }
      dst[where(line, at, wide, horizontal)] = sum / size;
    }
  }
}

/**
 * The mask's own alpha at the region's size: 1 wherever the paint is, falling to
 * 0 over `radiusPx` beyond it. The fall-off is a box blur of the paint grown by
 * the same radius, so the edge of the hole is a soft ramp rather than a cut line.
 */
export function featherAlpha(maskRoi, width, height, radiusPx) {
  const wide = Math.max(1, Math.round(Number(width) || 0));
  const tall = Math.max(1, Math.round(Number(height) || 0));
  const count = wide * tall;
  const paint = new Float32Array(count);
  for (let at = 0; at < count; at += 1) paint[at] = maskRoi[at] > 0 ? 1 : 0;
  const radius = Math.max(0, Math.round(Number(radiusPx) || 0));
  if (radius < 1) return paint;
  const a = new Float32Array(count);
  const b = new Float32Array(count);
  dilate(paint, a, wide, tall, radius, true);
  dilate(a, b, wide, tall, radius, false);
  soften(b, a, wide, tall, radius, true);
  soften(a, b, wide, tall, radius, false);
  return b;
}

/**
 * `inpainted` mixed over `original` by `alpha`, whole picture pixels: alpha 1
 * takes the fill, alpha 0 keeps the photograph, and the feather walks between.
 * The picture's own alpha is carried through untouched.
 */
export function composite(original, inpainted, alpha) {
  const pixels = new Uint8ClampedArray(original.length);
  for (let at = 0; at < alpha.length; at += 1) {
    const mix = alpha[at];
    const p = at * 4;
    pixels[p] = original[p] + (inpainted[p] - original[p]) * mix;
    pixels[p + 1] = original[p + 1] + (inpainted[p + 1] - original[p + 1]) * mix;
    pixels[p + 2] = original[p + 2] + (inpainted[p + 2] - original[p + 2]) * mix;
    pixels[p + 3] = original[p + 3];
  }
  return pixels;
}

/**
 * The paint as a mask of `side` by `side` pixels over `roi`: 1 where the strokes
 * cover the pixel, 0 where they do not. The strokes are walked in the order they
 * were painted, so an eraser stroke takes the paint of the ones before it away,
 * and each stroke only visits the box it can reach, so a long trail stays cheap.
 */
export function strokeMask(strokes, roi, side) {
  const size = Math.max(1, Math.round(Number(side) || 0));
  const mask = new Uint8Array(size * size);
  const kx = size / Math.max(1, Number(roi.w) || 0);
  const ky = size / Math.max(1, Number(roi.h) || 0);
  for (const stroke of strokes) {
    const x = (stroke.x - roi.x) * kx;
    const y = (stroke.y - roi.y) * ky;
    const rx = Math.max(1, Math.abs(stroke.r)) * kx;
    const ry = Math.max(1, Math.abs(stroke.r)) * ky;
    const from = Math.max(0, Math.floor(x - rx));
    const to = Math.min(size - 1, Math.ceil(x + rx));
    const top = Math.max(0, Math.floor(y - ry));
    const bottom = Math.min(size - 1, Math.ceil(y + ry));
    for (let py = top; py <= bottom; py += 1) {
      for (let px = from; px <= to; px += 1) {
        const dx = (px + 0.5 - x) / rx;
        const dy = (py + 0.5 - y) / ry;
        if (dx * dx + dy * dy <= 1) mask[py * size + px] = stroke.erase ? 0 : 1;
      }
    }
  }
  return mask;
}

/**
 * The same mask in the inpainter's own form: RGBA pixels with alpha 0 where the
 * pixel is to be filled and 255 where the picture is kept — the hole, cut out of
 * an otherwise solid layer, which is the polarity `ml/inpaint.js` expects.
 */
export function maskRGBA(strokes, roi, side) {
  const mask = strokeMask(strokes, roi, side);
  const pixels = new Uint8ClampedArray(mask.length * 4);
  for (let at = 0; at < mask.length; at += 1) pixels[at * 4 + 3] = mask[at] ? 0 : 255;
  return pixels;
}
