/**
 * The background's mask mathematics, as TypeScript sees it.
 *
 * A hand-written declaration for `mask-math.js`, which runs in the page and under
 * vitest as plain JavaScript. It says that the segmenter's answer is a small grid
 * of confidences, that the picture's luminance is one number between 0 and 1 a
 * pixel, and that the guided read answers four channels a pixel — nothing in the
 * colours, the person in the alpha — which is what `destination-in` wants.
 */

/** The segmenter's answer: one confidence a cell, 1 where the person is. */
export interface PersonMask {
  mask: ArrayLike<number>;
  width: number;
  height: number;
}

/** How close two luminances must be for the guide to trust a model cell. */
export const SIGMA: number;

/** Anything that carries its own pixel dimensions, as a bitmap does. */
export interface Sized {
  width: number;
  height: number;
}

/** The size the mask is worked at: the picture's shape, its long side capped. */
export function workSize(bitmap: Sized, cap: number): Sized;

/** The picture's luminance at `width` by `height`, 0 to 1 a pixel, RGBA in. */
export function luminance(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
): Float32Array;

/** The model's mask read up through the picture's own light, RGBA out. */
export function guided(
  model: PersonMask,
  lum: Float32Array,
  width: number,
  height: number,
): Uint8ClampedArray;
