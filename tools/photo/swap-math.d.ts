/**
 * The face swap's mathematics, as TypeScript sees it.
 *
 * A hand-written declaration for `swap-math.js`, which runs in the page and
 * under vitest as plain JavaScript. It says that a triangulation is triples of
 * the indices it was handed, that a colour region is one mean and one standard
 * deviation per channel, and that the membrane answers exactly as many
 * three-channel differences as the grid it was given.
 */

/** A point on the (small) grid a swap works on. */
export interface Pt {
  x: number;
  y: number;
}

/** One colour channel's mean and standard deviation. */
export type RGB = [number, number, number];

/** A region's statistics: one mean and one spread per channel. */
export interface ColorStats {
  mean: RGB;
  std: RGB;
}

/** The Delaunay triangulation of `points`, as triples of their own indices. */
export function delaunay(points: readonly Pt[]): Array<[number, number, number]>;

/** The points on the outline, in anticlockwise order. */
export function hullIndices(points: readonly Pt[]): number[];

/** The mean and standard deviation of each channel inside `mask`. */
export function colorStats(rgba: ArrayLike<number>, mask: ArrayLike<number>): ColorStats;

/** `rgba` with the masked pixels shifted from `from`'s statistics onto `to`'s. */
export function matchColor(
  rgba: Uint8ClampedArray,
  mask: ArrayLike<number>,
  from: ColorStats,
  to: ColorStats,
): Uint8ClampedArray;

/** The harmonic fill of a colour difference inside a mask, by Jacobi iteration. */
export function membrane(
  diff: Float32Array,
  mask: ArrayLike<number>,
  w: number,
  h: number,
  iterations?: number,
): Float32Array;
