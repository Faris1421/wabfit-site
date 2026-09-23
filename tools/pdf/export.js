/**
 * Wab Fit — the one place where the edited document becomes bytes.
 *
 * core.js already knows how to write a PDF out of the edit model: it copies
 * every page of every source in the order the model has them, turns each page
 * by its own quarter turn, and draws every object on the page it was drawn on.
 * What it cannot know is the one thing only this page has: the font the writing
 * on the screen is set in.
 *
 * So this module is the seam and nothing else. `exportEdited(ctx)` reads the
 * context the whole page shares — `ctx.sources` (the original bytes, in the
 * order `PageRef.src` counts) and `ctx.doc` (the pages and every object) — and
 * hands both to `exportPdf` together with the pictures the writer needs.
 *
 * pdf-lib embeds a font by its character codes and cannot shape Arabic: a run
 * of Arabic written as text comes out disconnected and backwards. Such a run is
 * marked `asImage` when it is written, and this module paints it here, at the
 * font size and in the font it stands in on the screen, so the words are on the
 * page the person saves rather than left out. A run the writer CAN set in type
 * is written as real, selectable text by core.js.
 *
 * This module is loaded by main.js and by the tests; nothing here touches the
 * DOM until a text object actually needs a picture, so it is quiet in Node.
 */

import { exportPdf, textBaseline, textLines } from './core.js';

/** One point of the page is this many pixels of the picture. */
const RASTER_SCALE = 2;

/** The writing on the screen, in the same stack the page's own stylesheet uses. */
const FONT = '"Thmanyah Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, Arial, sans-serif';

/** A run that reads right to left: every letter Arabic and its neighbours use. */
const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;

/** True when a run is drawn from its right edge, as HTML's `dir="auto"` decides. */
function isRtl(text) {
  return RTL.test(text);
}

/**
 * The lines a run is drawn as: the object's own newlines kept, and every line
 * broken at a space when it is wider than the box. `measure` answers the width
 * of a sample in the pixels of the picture, so the same wrapping runs against a
 * real canvas and against a test's ruler.
 */
export function wrappedLines(text, width, measure) {
  const lines = [];
  for (const line of textLines(text)) {
    if (line === '') {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of line.split(' ')) {
      const candidate = current === '' ? word : `${current} ${word}`;
      // A single word wider than the box stays whole rather than being broken:
      // the page clips it, exactly as the box on the screen does.
      if (current !== '' && measure(candidate) > width) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

/**
 * One text object as a picture: a transparent PNG of its box, with every line
 * painted at the baseline core.js would have written it at, in the colour and
 * the weight it carries. Answers null when there is no canvas to paint on.
 */
export function textPicture(obj) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(obj.w * RASTER_SCALE));
  canvas.height = Math.max(1, Math.ceil(obj.h * RASTER_SCALE));
  const brush = canvas.getContext('2d');
  if (!brush) return null;
  brush.font = `${obj.bold === true ? 700 : 400} ${obj.size * RASTER_SCALE}px ${FONT}`;
  brush.textBaseline = 'alphabetic';
  brush.fillStyle = obj.color;
  // `direction` is what turns the anchor into the run's own start: a right-to-
  // left run begins at the right edge of its box, a left-to-right one at the left.
  const rtl = isRtl(obj.text);
  brush.direction = rtl ? 'rtl' : 'ltr';
  brush.textAlign = 'start';
  const lines = wrappedLines(obj.text, obj.w, (sample) => brush.measureText(sample).width);
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at];
    if (line === undefined) continue;
    const base = textBaseline(obj, at);
    const x = (rtl ? obj.x + obj.w : base.x) - obj.x;
    brush.fillText(line, x * RASTER_SCALE, (base.y - obj.y) * RASTER_SCALE);
  }
  return { pngBase64: canvas.toDataURL('image/png'), w: obj.w, h: obj.h };
}

/** Every picture the writer needs, keyed by object id, in the model's own order. */
function textPictures(doc) {
  const rasters = {};
  for (const obj of doc.objects) {
    if (obj.kind !== 'text' || obj.asImage !== true) continue;
    const picture = textPicture(obj);
    if (picture) rasters[obj.id] = picture;
  }
  return rasters;
}

/**
 * The edited document, written out. This — never a source file — is what Export
 * hands to the app, or downloads when there is no app behind the page.
 */
export async function exportEdited(ctx) {
  return exportPdf(ctx.sources, ctx.doc, textPictures(ctx.doc));
}
