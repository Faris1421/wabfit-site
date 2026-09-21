/**
 * Wab Fit — covering what is already on the page.
 *
 * The whiteout tool draws one thing: an opaque rectangle over whatever is under
 * it. A drag settles the box, and the colour is not chosen but SAMPLED — the
 * median of the four corners of the box on the page's own bitmap (page-colours
 * .js) — so a cover on aged, grey or photographed paper blends into it instead
 * of glaring white. The strip can still override that: the setting is null until
 * someone picks a swatch, and a pick is a decision.
 *
 * The strip also carries one toggle, `t('secureRedact')`. A cover made while it
 * is on is marked `secure: true` in the model, and that mark is the promise: a
 * page carrying such a cover is RASTERISED at 200 dpi on export — drawn to a
 * canvas, written out as a PNG and made a fresh page of the same size — so the
 * words under it are gone from the file rather than hidden behind a rectangle.
 * (Writing that export is the export step's job; this file marks the page.)
 *
 * The drag is drawn with the SAME element the page uses once it is committed —
 * overlay-paint's `elementOf` — so what is dragged is exactly what lands, and
 * the model changes once, when the finger lifts. A cover is kept inside the page
 * it is drawn on: paper does not run off the edge of the sheet.
 */

import { newId } from './core.js';
import { pageBox } from './viewer.js';
import { registerTool } from './overlay.js';
import { layerAt } from './overlay-layers.js';
import { elementOf } from './overlay-paint.js';
import { settings } from './props.js';
import { paperColour } from './page-colours.js';

/** Nothing smaller than this, in points, is a cover: that was a tap. */
const MIN = 3;

let ctx = null;
/** The drag in flight, or null. */
let drag = null;

/* ── the cover in flight ─────────────────────────────────────────────────── */

/** A hundredth of a point is as fine as a cover's box needs to be. */
function round(value) {
  return Math.round(value * 100) / 100;
}

/** The upright box between two points, kept inside the page it is drawn on. */
function cover(start, end, size) {
  const left = Math.max(0, Math.min(start.x, end.x));
  const top = Math.max(0, Math.min(start.y, end.y));
  const right = Math.min(size.w, Math.max(start.x, end.x));
  const bottom = Math.min(size.h, Math.max(start.y, end.y));
  return {
    x: round(left),
    y: round(top),
    w: round(Math.max(0, right - left)),
    h: round(Math.max(0, bottom - top)),
  };
}

/** The colour a cover lands in: the swatch somebody picked, or the paper's own. */
function colourOf(page, box, set) {
  return typeof set.color === 'string' ? set.color : paperColour(page, box);
}

/** The cover's element at the scale it is drawn on, in the colour it lands in. */
function preview(box) {
  const color = colourOf(drag.page, box, drag.set);
  return elementOf(Object.assign({ kind: 'whiteout', id: 'preview', color }, box), drag.scale);
}

/** A finger lands: what the cover is made with is settled here, once. */
function begin(pt, page) {
  if (drag) return;
  const box = pageBox(page);
  const layer = layerAt(page);
  if (!box || !layer) return;
  // The settings are copied: a strip tap cannot change the cover in flight.
  drag = {
    page,
    layer,
    scale: box.scale,
    size: { w: box.width / box.scale, h: box.height / box.scale },
    start: { x: pt.x, y: pt.y },
    set: Object.assign({}, settings('whiteout')),
    node: null,
  };
}

/** The cover under the moving finger, drawn the way the page will draw it. */
function extend(pt) {
  if (!drag) return;
  const node = preview(cover(drag.start, pt, drag.size));
  if (drag.node) drag.node.replaceWith(node);
  else drag.layer.append(node);
  drag.node = node;
}

/** The finger lifts: the cover is coloured from the paper and joins the model. */
function finish(pt) {
  if (!drag) return;
  const done = drag;
  drag = null;
  if (done.node) done.node.remove();
  const box = cover(done.start, pt, done.size);
  if (box.w < MIN || box.h < MIN) return;
  const mark = Object.assign(
    { kind: 'whiteout', id: newId(), page: done.page, color: colourOf(done.page, box, done.set) },
    box,
  );
  // The export's own rule: a secure cover means its page goes out as a picture
  // of itself, so the words under the rectangle are gone rather than hidden.
  if (done.set.secure === true) mark.secure = true;
  ctx.commit({ pages: ctx.doc.pages, objects: ctx.doc.objects.concat([mark]) });
}

/** The gesture was taken away: the half-drawn cover goes with it. */
function cancel() {
  if (!drag) return;
  if (drag.node) drag.node.remove();
  drag = null;
}

/* ── boot ────────────────────────────────────────────────────────────────── */

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(context) {
  ctx = context;
  registerTool('whiteout', {
    onDown: (pt, page) => begin(pt, page),
    onMove: (pt) => extend(pt),
    onUp: (pt) => finish(pt),
    onCancel: () => cancel(),
  });
  return ctx;
}
