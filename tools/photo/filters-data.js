/**
 * Wab Fit — the twelve filters, as plain data.
 *
 * Pure, DOM-free and clock-free, so the same module runs in the page and under
 * vitest in Node. A preset is a PARTIAL set of the thirteen adjustments: the
 * keys it names are the look, the keys it leaves out are neutral, and strength
 * is the only other dial there is.
 *
 *   applyFilter(DEFAULTS, warm.preset, 1);     // the whole warm look
 *   applyFilter(DEFAULTS, warm.preset, 0.5);   // half of it
 *   applyFilter(DEFAULTS, warm.preset, 0);     // the base, untouched
 *
 * The names live here rather than in i18n.js because a filter IS its data: the
 * id it is chosen by, the two words it goes by, and the numbers that make it.
 * The strip in filters.js draws the words for the language the page is in.
 *
 * Three rules, and they are the whole file:
 *
 *   · a preset is a POSITION, not a correction: at full strength the picture is
 *     exactly the numbers below, and at zero it is exactly the base it was
 *     mixed from — so "no filter" is the empty preset and needs no special case;
 *   · every number is inside its slider's range, so a filter can never push a
 *     control past an end the person cannot reach by hand;
 *   · the list is COMPLETE and ordered: the neutral one, the warm/cool pair,
 *     the six looks, then the three times of day. The strip draws this order.
 */

import { mix } from './params.js';

/** The filter that changes nothing. What "no filter is chosen" is drawn as. */
export const NEUTRAL_ID = 'original';

/** How much of a filter is applied when nobody says otherwise. */
export const DEFAULT_STRENGTH = 1;

/**
 * The twelve presets, in the order the strip draws them: the neutral one first,
 * then the warm and cool pair, then the six looks, then the three times of day.
 */
export const FILTERS = [
  { id: 'original', ar: 'الأصل', en: 'Original', preset: {} },
  {
    id: 'warm',
    ar: 'دافئ',
    en: 'Warm',
    preset: { temperature: 26, tint: 6, vibrance: 8, brightness: 4 },
  },
  {
    id: 'cool',
    ar: 'بارد',
    en: 'Cool',
    preset: { temperature: -26, tint: -6, saturation: -4, shadows: 6 },
  },
  {
    id: 'vivid',
    ar: 'حيوي',
    en: 'Vivid',
    preset: { vibrance: 32, saturation: 20, contrast: 18, clarity: 14 },
  },
  {
    id: 'soft',
    ar: 'ناعم',
    en: 'Soft',
    preset: { contrast: -14, highlights: -12, shadows: 10, clarity: -18, fade: 6 },
  },
  {
    id: 'faded',
    ar: 'باهت',
    en: 'Faded',
    preset: { fade: 30, contrast: -18, saturation: -14, blacks: 12, clarity: -6 },
  },
  {
    id: 'drama',
    ar: 'دراما',
    en: 'Drama',
    preset: { contrast: 32, clarity: 28, shadows: -16, highlights: -14, vignette: 18, grain: 6 },
  },
  { id: 'mono', ar: 'أبيض وأسود', en: 'Mono', preset: { saturation: -100, contrast: 18 } },
  {
    id: 'cinematic',
    ar: 'سينمائي',
    en: 'Cinematic',
    preset: { temperature: 22, tint: -8, contrast: 20, highlights: -10, shadows: 12, fade: 14 },
  },
  {
    id: 'golden',
    ar: 'ذهبي',
    en: 'Golden',
    preset: { temperature: 34, tint: 10, vibrance: 14, highlights: 8, saturation: 6 },
  },
  {
    id: 'morning',
    ar: 'صباحي',
    en: 'Morning',
    preset: { temperature: 14, exposure: 10, shadows: 16, highlights: -8, fade: 8, saturation: 4 },
  },
  {
    id: 'night',
    ar: 'ليلي',
    en: 'Night',
    preset: {
      exposure: -14, temperature: -22, tint: -6, contrast: 14, shadows: -12, vignette: 24, grain: 8,
    },
  },
];

/** One preset by id, or null when the id names no filter. */
export function filterById(id) {
  return FILTERS.find((filter) => filter.id === id) || null;
}

/** A filter's name in one language, or its id when the language is neither. */
export function filterName(filter, lang) {
  const entry = filter || FILTERS[0];
  return lang === 'en' ? entry.en : entry.ar;
}

/**
 * `base` with `preset` mixed over it, key by key: 0 is the base alone, 1 is the
 * whole look, and everything between is the two blended. A strength that is not
 * a number, or is past an end, is pulled to that end by `mix`; a strength nobody
 * gave means the whole filter, which is what choosing one from the strip means.
 * The two ends are never edited: the answer is a new, complete set of values.
 */
export function applyFilter(base, preset, strength = DEFAULT_STRENGTH) {
  return mix(base, preset, strength);
}
