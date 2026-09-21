/**
 * The photo editor's filters, as TypeScript sees them.
 *
 * A hand-written declaration for `filters-data.js`, which runs in the page and
 * under vitest as plain JavaScript. Its whole job is to say that a filter is an
 * id, two names and a PARTIAL set of the thirteen adjustments — so a consumer
 * reads a preset's keys as the look it changes, and never writes `?? 0` next to
 * one of them.
 */

import type { PhotoParams } from './params.js';

/** One filter: what it is chosen by, what it is called, what it does. */
export interface FilterPreset {
  /** The id `params.filter` carries while this filter is chosen. */
  readonly id: string;
  /** Its Arabic name — the source language. */
  readonly ar: string;
  /** Its English name. */
  readonly en: string;
  /** The adjustments it moves. A key it leaves out is neutral. */
  readonly preset: Partial<PhotoParams>;
}

/** The id of the filter that changes nothing. */
export const NEUTRAL_ID: string;

/** How much of a filter is applied when no strength is given. */
export const DEFAULT_STRENGTH: number;

/** The twelve presets, in the order the strip draws them. */
export const FILTERS: readonly FilterPreset[];

/** One preset by id, or null when the id names no filter. */
export function filterById(id: string): FilterPreset | null;

/** A filter's name in `'ar'` or `'en'`; anything else is Arabic. */
export function filterName(filter: FilterPreset | null, lang: string): string;

/**
 * `base` with `preset` mixed over it, key by key, as a complete set of values;
 * strength 0 is the base, 1 the whole look.
 */
export function applyFilter(
  base?: Partial<PhotoParams> | null,
  preset?: Partial<PhotoParams> | null,
  strength?: number,
): PhotoParams;
