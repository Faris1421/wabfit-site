/**
 * The erase tool's arithmetic, as TypeScript sees it.
 *
 * A hand-written declaration for `erase-math.js`, which runs in the page and
 * under vitest as plain JavaScript. Its whole job is to say what a painted area
 * and a region are, that a region is always a SQUARE of whole pixels inside the
 * picture, what the paint looks like as a mask, that the feather is a number per
 * region pixel from 0 to 1, and that the blend answers exactly as many pixels as
 * it was given.
 */

/** A rectangle in picture pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One touch of the brush: a disc at a point, or an eraser stroke that cuts paint away. */
export interface Stroke {
  x: number;
  y: number;
  r: number;
  erase?: boolean;
}

/** The smallest and largest side of the region an inpaint reads, in pixels. */
export const ROI_MIN: number;
export const ROI_MAX: number;

/** The separate painted areas of `strokes`, one bounding box each. */
export function strokeAreas(strokes: readonly Stroke[]): Box[];

/** The square region an inpaint reads around `bbox`, inside the picture. */
export function roiForMask(bbox: Box, imageW: number, imageH: number): Box;

/** A `side` by `side` mask of `roi`: 1 where the strokes cover the pixel. */
export function strokeMask(strokes: readonly Stroke[], roi: Box, side: number): Uint8Array;

/** The same mask as RGBA pixels: alpha 0 where the pixel is to be filled. */
export function maskRGBA(
  strokes: readonly Stroke[],
  roi: Box,
  side: number,
): Uint8ClampedArray;

/** A number per region pixel: 1 on the paint, falling to 0 past `radiusPx`. */
export function featherAlpha(
  maskRoi: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  radiusPx: number,
): Float32Array;

/** `inpainted` mixed over `original` per pixel, by an alpha from 0 to 1. */
export function composite(
  original: Uint8ClampedArray,
  inpainted: Uint8ClampedArray,
  alpha: Float32Array,
): Uint8ClampedArray;
