/**
 * Wab Fit — the thirteen numbers the pipeline reads, as plain data.
 *
 * Pure, DOM-free and clock-free, so the same module runs in the page and under
 * vitest in Node. Nothing here knows about pixels: it says what a parameter is
 * called, what it may be, what "no adjustment" means, and how two sets of
 * values are blended — which is the whole of a filter's strength.
 *
 *   const params = clampParams({ exposure: 250, fade: -40 });
 *   // { exposure: 100, ... , fade: 0, ... } — every key, inside its range
 *   isNeutral(params);                 // false: exposure moved
 *   mix(DEFAULTS, PRESET, 0.5);        // half of a filter's look
 *
 * Three rules, and they are the whole file:
 *
 *   · every value is INSIDE ITS RANGE (RANGES). One range per key: the ten
 *     signed sliders run -100..100, and fade, vignette, grain and sharpen are
 *     lifts, so they run 0..100.
 *   · a value that is missing, unreadable or outside the range is CLAMPED, not
 *     rejected: `clampParams` always answers a complete object of finite
 *     numbers, so no consumer ever has to guard a value with `|| 0`.
 *   · the neutral value of every key is 0. That is what `DEFAULTS` holds and
 *     what `isNeutral` tests, so "the photo is untouched" is one call.
 */

/** The order the controls are listed in, and the order keys are read in. */
export const KEYS = [
  'exposure',
  'brightness',
  'contrast',
  'highlights',
  'shadows',
  'saturation',
  'vibrance',
  'temperature',
  'tint',
  'fade',
  'vignette',
  'grain',
  'sharpen',
];

/** The smallest and largest value each key may take. */
export const RANGES = {
  exposure: [-100, 100],
  brightness: [-100, 100],
  contrast: [-100, 100],
  highlights: [-100, 100],
  shadows: [-100, 100],
  saturation: [-100, 100],
  vibrance: [-100, 100],
  temperature: [-100, 100],
  tint: [-100, 100],
  fade: [0, 100],
  vignette: [0, 100],
  grain: [0, 100],
  sharpen: [0, 100],
};

/**
 * The neutral position: every key at zero, so the pipeline leaves the photo
 * exactly as it found it. A photo arrives with these values and every control
 * returns to them.
 */
export const DEFAULTS = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  fade: 0,
  vignette: 0,
  grain: 0,
  sharpen: 0,
};

/**
 * A complete set of parameters: every key in KEYS, every value finite and
 * inside RANGES. A missing or unreadable value falls back to DEFAULTS, and a
 * value past an end is pulled to that end. The answer is a NEW object, so the
 * caller's values are never edited under it.
 */
export function clampParams(params) {
  const given = params !== null && typeof params === 'object' ? params : {};
  const out = {};
  for (const name of KEYS) {
    const range = RANGES[name];
    const value = Number(given[name]);
    out[name] = Number.isFinite(value)
      ? Math.min(range[1], Math.max(range[0], value))
      : DEFAULTS[name];
  }
  return out;
}

/** True when nothing has moved: every key sits at its neutral value. */
export function isNeutral(params) {
  const values = clampParams(params);
  for (const name of KEYS) {
    if (values[name] !== DEFAULTS[name]) return false;
  }
  return true;
}

/**
 * `t` of the way from one set of parameters to another, key by key. This is
 * what a filter's strength is: at 0 the answer is `from`, at 1 it is `to`, and
 * at 0.5 it is the two blended. `t` outside 0..1 is pulled to that end, and a
 * `t` that is not a number is 0 — "no filter" rather than a third look.
 */
export function mix(from, to, t) {
  const start = clampParams(from);
  const end = clampParams(to);
  const amount = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const out = {};
  for (const name of KEYS) {
    out[name] = start[name] + (end[name] - start[name]) * amount;
  }
  return out;
}
