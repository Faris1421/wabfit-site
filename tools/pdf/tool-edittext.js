/**
 * Wab Fit — changing words that are already on the page.
 *
 * A word printed in a PDF cannot be edited, so it is COVERED and written again
 * on top of the cover. Two ways in, one idea:
 *
 *   · the edit-text tool. A tap on a run of text asks the page itself what
 *     stands there — pdf.js `getTextContent` — finds the item under the point,
 *     lays a whiteout over the item's own box coloured from the paper around it,
 *     and writes the string the item holds on top: the size its height says and
 *     the colour its glyphs have. The editor (run-editor.js) then opens over the
 *     pair with the whole string selected, so the first keystroke replaces it.
 *     Cover and writing land in ONE commit, so undo takes both back together.
 *   · the selection's Edit button (overlay-select's `'edit'`). A text object
 *     that is already in the model opens in that same editor, so what was
 *     written once can be written again — a retype, not a second box on top.
 *
 * Nothing joins the model while the editor is open; it ends in one commit on
 * blur, on Escape, on a tap on the page, on a tool change, on a zoom, on a new
 * document and on undo, and a run emptied by the retype is a run that goes.
 *
 * Every box here is in the page's own points, top-left origin, as DISPLAYED.
 * overlay.js hands the tool the point; viewer.js draws a page at the source
 * page's own rotation plus the model's, and the same sum is what pdf.js is asked
 * for below, so the run a tap finds is the run under the finger.
 */

import { TEXT_LINE_HEIGHT, needsImageText, newId, normalizeRotation } from './core.js';
import { pdfjsDoc } from './docstore.js';
import { registerTool } from './overlay.js';
import { glyphColour, paperColour } from './page-colours.js';
import { finishEditor, isEditing, openEditor } from './run-editor.js';

/** How far, in points, a tap may land from a run and still mean it. */
const NEAR = 6;
/** How far above its baseline a text item's box reaches, in font sizes. */
const ASCENT = 1;
/** And how far below, which is where tails and descenders go. */
const DESCENT = 0.25;

let ctx = null;
/** `src:index:rotate` → the runs of that page, read once. */
const runs = new Map();

/* ── what stands on the page ─────────────────────────────────────────────── */

/**
 * One text item's box on the displayed page, in points from its top-left: the
 * item's own matrix (font size and rotation folded into it) walked to its four
 * corners, which are then measured in the page's own viewport. `font` comes back
 * with the box because it is the size a retyped run is written at.
 */
function boxOfItem(item, viewport) {
  const m = item.transform;
  const width = Number(item.width) || 0;
  const font = Math.hypot(m[2], m[3]) || Number(item.height) || 0;
  const corners = [];
  for (const x of [0, width]) {
    for (const y of [-DESCENT * font, ASCENT * font]) {
      const px = m[0] * x + m[2] * y + m[4];
      const py = m[1] * x + m[3] * y + m[5];
      corners.push(viewport.convertToViewportPoint(px, py));
    }
  }
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top, font };
}

/**
 * The runs of one page, read once and kept. The key carries the model's own
 * rotation, because the boxes are measured on the page as it is displayed and a
 * turn moves every one of them.
 */
async function runsOf(ref) {
  const key = `${ref.src}:${ref.index}:${normalizeRotation(ref.rotate)}`;
  const kept = runs.get(key);
  if (kept) return kept;
  const handle = pdfjsDoc(ref.src);
  if (!handle) return null;
  const page = await handle.getPage(ref.index + 1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: 1,
    rotation: (base.rotation + normalizeRotation(ref.rotate)) % 360,
  });
  const content = await page.getTextContent();
  const found = [];
  for (const item of content.items) {
    if (typeof item.str !== 'string' || item.str.trim() === '') continue;
    const box = boxOfItem(item, viewport);
    if (box.w > 0 && box.h > 0) found.push({ str: item.str, box });
  }
  runs.set(key, found);
  return found;
}

/**
 * The run the finger meant: the smallest one with the point ON it — a tap inside
 * a long line of prose is on that line, not on the whole paragraph — or, when no
 * box holds the point, the nearest one within reach. Nothing within reach is
 * nothing: that tap does nothing at all.
 */
function runAt(found, pt) {
  let on = null;
  let near = null;
  let reach = NEAR;
  for (const run of found) {
    const { box } = run;
    const dx = Math.max(box.x - pt.x, 0, pt.x - (box.x + box.w));
    const dy = Math.max(box.y - pt.y, 0, pt.y - (box.y + box.h));
    const distance = Math.hypot(dx, dy);
    if (distance === 0) {
      if (!on || box.w * box.h < on.box.w * on.box.h) on = run;
      continue;
    }
    if (distance < reach) {
      reach = distance;
      near = run;
    }
  }
  return on || near;
}

/** A hundredth of a point is as fine as a box needs to be. */
function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * A tap on a run: covered with the page's own paper, then written again on top
 * of the cover with the words, the size and the ink colour the item itself had,
 * and the editor opened over the pair — ready to retype. A cover without its
 * writing is exactly the mess undo is for, so both land in ONE commit.
 */
async function replaceRun(pt, page) {
  const ref = ctx.doc.pages[page];
  if (!ref) return;
  const found = await runsOf(ref);
  if (!found) return;
  const run = runAt(found, pt);
  if (!run) return;
  const box = run.box;
  const size = Math.max(4, round(box.font));
  const cover = {
    kind: 'whiteout',
    id: newId(),
    page,
    x: round(box.x),
    y: round(box.y),
    w: round(box.w),
    h: round(box.h),
    color: paperColour(page, box),
  };
  const text = {
    kind: 'text',
    id: newId(),
    page,
    x: round(box.x),
    y: round(box.y),
    w: round(box.w),
    h: round(Math.max(box.h, size * TEXT_LINE_HEIGHT)),
    text: run.str,
    size,
    color: glyphColour(page, box),
    bold: false,
    asImage: needsImageText(run.str),
  };
  ctx.commit({ pages: ctx.doc.pages, objects: ctx.doc.objects.concat([cover, text]) });
  ctx.select(text.id);
  openEditor(ctx, text.id);
}

/* ── boot ────────────────────────────────────────────────────────────────── */

/** A tap on a run of text — or the end of the edit that is already open. */
function onDown(pt, page) {
  if (isEditing()) {
    finishEditor(ctx);
    return;
  }
  replaceRun(pt, page).catch(() => {});
}

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(context) {
  ctx = context;
  registerTool('editText', { onDown });
  /** The selection's Edit button: the object it picked opens in the editor. */
  ctx.on('edit', (id) => openEditor(ctx, id));
  ctx.on('tool', (id) => {
    if (id !== 'editText') finishEditor(ctx);
  });
  // A repaint would take the editor with it, and a new document has no page to
  // put it back on, so both end the retype rather than let it be lost quietly.
  ctx.on('doc', () => finishEditor(ctx));
  ctx.on('zoom', () => finishEditor(ctx));
  ctx.on('open', () => {
    runs.clear();
    finishEditor(ctx);
  });
  return ctx;
}

