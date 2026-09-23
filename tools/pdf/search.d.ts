/**
 * The search tool's two halves, as TypeScript sees them.
 *
 * A hand-written declaration for `search.js`, which runs in the page and under
 * vitest as plain JavaScript. It says what a match is — the page it was found on,
 * where its characters begin and how many they are — that a page's text and a
 * query are folded onto the same letters before they are compared, and where on
 * a page a match stands.
 */

/** Where one match stands: the page, and the run of characters in its text. */
export interface Match {
  page: number;
  index: number;
  length: number;
}

/** One text item of a page: its words, and its own box in the page's points. */
export interface TextItem {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A rectangle on a page, in the page's own points from its top-left. */
export interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A string as the two sides of a search compare it. */
export function normalise(text: string): string;

/** Every place `query` stands in the pages, in reading order. */
export function findMatches(pagesText: readonly string[], query: string): Match[];

/** The rectangles a match covers on its page, from that page's text items. */
export function matchBoxes(items: readonly TextItem[], match: Match): Hit[];

/** Wired once by main.js with the page's shared context. */
export function init(context: unknown): unknown;

/** The language changed: the strip is written again in the new one. */
export function refresh(): void;
