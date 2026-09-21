/**
 * The photo editor's crop arithmetic, as TypeScript sees it.
 *
 * A hand-written declaration for `crop-math.js`, which runs in the page and
 * under vitest as plain JavaScript. Its whole job is to say what a crop and a
 * frame are, and that every function here answers WHOLE pixels inside the
 * picture — so the tool never has to round or clamp a value it is handed.
 */

/** A frame: the part of the picture that survives, in picture pixels. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A frame and the four other values a crop carries. */
export interface Crop extends CropRect {
  /** Clockwise quarter turns, 0 to 3. */
  rotate90: number;
  flipH: boolean;
  flipV: boolean;
  /** Degrees, -45 to 45. */
  straighten: number;
}

/** A size in pixels. */
export interface Size {
  w: number;
  h: number;
}

/** A point in picture pixels. */
export interface Point {
  x: number;
  y: number;
}

/** One of the eight grips of a frame, by the corner or edge it sits on. */
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** The smallest a frame may be, on either side, in picture pixels. */
export const MIN_SIDE: number;

/** The eight handles of a frame, in the order a keyboard walks them. */
export const HANDLES: readonly CropHandle[];

/** The frame a picture opens with: all of it, upright, unmirrored, level. */
export function defaultCrop(width: number, height: number): Crop;

/** A frame inside `bounds`: whole pixels, at least MIN_SIDE, under the edges. */
export function clampRect(rect: CropRect, bounds: Size): CropRect;

/** The largest frame of `aspect` the picture holds, on the frame's old centre. */
export function fitAspect(
  rect: CropRect,
  aspect: number | null,
  imageW: number,
  imageH: number,
): CropRect;

/** The eight handle positions of a frame, in picture pixels, keyed by name. */
export function handlePoints(rect: CropRect): Record<CropHandle, Point>;

/** The handle within `reach` pixels of `point`, or '' when none is. */
export function pickHandle(rect: CropRect, point: Point, reach: number): CropHandle | '';

/** The frame after one handle is dragged by `dx`, `dy` picture pixels. */
export function moveHandle(
  rect: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  aspect: number | null,
  bounds: Size,
): CropRect;

/** The frame after the picture under it is turned one quarter turn. */
export function turnRect(
  rect: CropRect,
  imageW: number,
  imageH: number,
  clockwise: boolean,
): CropRect;

/** The picture's size after `rotate90` quarter turns: the sides swap on 1 and 3. */
export function rotatedSize(width: number, height: number, rotate90: number): Size;

/** The largest rectangle of the picture's aspect that fits inside it, tilted. */
export function largestInscribed(width: number, height: number, degrees: number): Size;

/** How much the picture is zoomed to cover the frame at `degrees`: 1 at level. */
export function straightenScale(width: number, height: number, degrees: number): number;

/** The finished picture's size in pixels: the frame, rounded. */
export function outputSize(crop: CropRect): { width: number; height: number };
