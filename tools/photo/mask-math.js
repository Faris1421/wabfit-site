/**
 * Wab Fit — the background's mask, without a pixel of canvas.
 *
 * Pure, DOM-free and clock-free, so the same file runs in the page and under
 * vitest in Node. The selfie segmenter answers a small confidence mask — the
 * person at 1, the room at 0 — and this is what grows it to the picture:
 *
 *   LUMINANCE  the picture's own light, one number a pixel, which is the only
 *              thing the guide below compares.
 *
 *   GUIDED     a joint-bilateral upsample. Every output pixel reads the four
 *              cells of the model around it and weights each one by both its
 *              spatial distance and how close that cell's luminance is to the
 *              pixel's own. A plain bilinear read would put the edge halfway
 *              between two cells and cut a hair off; weighting by the light
 *              keeps the edge where the hair is.
 */

/** The three weights of Rec. 709, which is what "luminance" means here. */
const RED = 0.2126;
const GREEN = 0.7152;
const BLUE = 0.0722;

/** How close two luminances must be for the guide to trust a model cell. */
export const SIGMA = 0.09;

/** The size the mask is worked at: `bitmap`'s own shape, its long side capped. */
export function workSize(bitmap, cap) {
  const scale = Math.min(1, cap / Math.max(1, bitmap.width, bitmap.height));
  return {
    width: Math.max(1, Math.round(bitmap.width * scale)),
    height: Math.max(1, Math.round(bitmap.height * scale)),
  };
}

/** The picture's luminance at `width` by `height`, 0 to 1 a pixel, RGBA in. */
export function luminance(pixels, width, height) {
  const lum = new Float32Array(Math.max(0, width * height));
  for (let at = 0; at < lum.length; at += 1) {
    lum[at] = (RED * pixels[at * 4] + GREEN * pixels[at * 4 + 1] + BLUE * pixels[at * 4 + 2]) / 255;
  }
  return lum;
}

/**
 * The model's mask at `width` by `height`, as RGBA with the person in the alpha
 * channel and nothing in the colours — which is what `destination-in` wants.
 */
export function guided(model, lum, width, height) {
  const mask = model.mask;
  const mw = Math.max(1, Math.round(model.width));
  const mh = Math.max(1, Math.round(model.height));
  const wide = Math.max(1, Math.round(width));
  const tall = Math.max(1, Math.round(height));
  // The luminance of the picture under each cell of the model: the guide is read
  // at the model's own coarseness, because that is what it is choosing between.
  const low = new Float32Array(mw * mh);
  for (let my = 0; my < mh; my += 1) {
    const row = Math.min(tall - 1, Math.floor(((my + 0.5) * tall) / mh)) * wide;
    for (let mx = 0; mx < mw; mx += 1) {
      low[my * mw + mx] = lum[row + Math.min(wide - 1, Math.floor(((mx + 0.5) * wide) / mw))];
    }
  }
  const out = new Uint8ClampedArray(wide * tall * 4);
  const band = 2 * SIGMA * SIGMA;
  for (let y = 0; y < tall; y += 1) {
    const gy = ((y + 0.5) * mh) / tall - 0.5;
    const cy = Math.min(mh - 2, Math.max(0, Math.floor(gy)));
    const fy = Math.min(1, Math.max(0, gy - cy));
    for (let x = 0; x < wide; x += 1) {
      const gx = ((x + 0.5) * mw) / wide - 0.5;
      const cx = Math.min(mw - 2, Math.max(0, Math.floor(gx)));
      const fx = Math.min(1, Math.max(0, gx - cx));
      const here = lum[y * wide + x];
      let sum = 0;
      let weight = 0;
      for (let dy = 0; dy <= 1; dy += 1) {
        for (let dx = 0; dx <= 1; dx += 1) {
          const at = (cy + dy) * mw + cx + dx;
          const away = here - low[at];
          const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * Math.exp(-(away * away) / band);
          sum += mask[at] * w;
          weight += w;
        }
      }
      out[(y * wide + x) * 4 + 3] = weight > 0 ? Math.round((sum / weight) * 255) : 0;
    }
  }
  return out;
}
