/**
 * Wab Fit — the types of the PDF page's export (export.js).
 *
 * A hand-written declaration beside the module, for the same reason core.d.ts
 * is one: the page's JavaScript runs as it is, and the tests' TypeScript still
 * sees the shapes the page and the tests agree on.
 */

import type { Doc, RasterText, TextObj } from './core.js';

/** The bit of the page's shared context that writing a document reads. */
export interface EditContext {
  /** The original bytes of every source PDF, in the order `PageRef.src` counts. */
  sources: Uint8Array[];
  /** The pages, in their order, and every object drawn on them. */
  doc: Doc;
}

/**
 * The lines a run is drawn as: the object's own newlines kept, and every line
 * broken at a space when it is wider than the box. `measure` answers the width
 * of a sample in the pixels of the picture.
 */
export declare function wrappedLines(
  text: string,
  width: number,
  measure: (sample: string) => number,
): string[];

/** One text object as a picture, or null when there is no canvas to paint on. */
export declare function textPicture(obj: TextObj): RasterText | null;

/** The edited document, written out: the bytes Export hands back. */
export declare function exportEdited(ctx: EditContext): Promise<Uint8Array>;
