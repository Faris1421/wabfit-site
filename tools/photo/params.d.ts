/**
 * The photo editor's parameters, as TypeScript sees them.
 *
 * A hand-written declaration for `params.js`, which runs in the page and under
 * vitest as plain JavaScript. Its whole job is to say that the thirteen
 * adjustments are numbers with one range each, and that the module always
 * answers a COMPLETE set of them — so no consumer writes `?? 0` next to a
 * parameter it reads.
 */

/** The thirteen non-destructive adjustments, named exactly as they are stored. */
export interface PhotoParams {
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  saturation: number;
  vibrance: number;
  temperature: number;
  tint: number;
  fade: number;
  vignette: number;
  grain: number;
  sharpen: number;
}

/** One of the thirteen names. */
export type ParamName = keyof PhotoParams;

/** The order the controls are listed in. */
export const KEYS: readonly ParamName[];

/** The smallest and largest value each key may take. */
export const RANGES: Record<ParamName, readonly [number, number]>;

/** The neutral position: every key at zero. */
export const DEFAULTS: PhotoParams;

/** A complete, clamped set of values, with defaults for what was not given. */
export function clampParams(params?: Partial<PhotoParams> | null): PhotoParams;

/** True when every value sits at its neutral position. */
export function isNeutral(params?: Partial<PhotoParams> | null): boolean;

/** `t` of the way from one set of parameters to another, key by key. */
export function mix(
  from?: Partial<PhotoParams> | null,
  to?: Partial<PhotoParams> | null,
  t?: number,
): PhotoParams;
