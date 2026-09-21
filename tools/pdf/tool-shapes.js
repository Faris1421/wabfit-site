/**
 * Wab Fit — the shapes: a rectangle, an ellipse, a line, an arrow.
 *
 * All four are one gesture — press, drag, lift — and one kind of object in the
 * model: a box with two ends. A line and an arrow run from where the finger
 * landed to where it left, signs and all, because that is how core.js reads a
 * line's `w` and `h`; a rectangle and an ellipse are the upright box between
 * the same two points. Fill is a choice made in the strip, never a guess.
 *
 * The shape follows the finger with the SAME drawing the page uses once it is
 * committed — overlay-paint's `elementOf` — so what is dragged is exactly what
 * lands. The model changes once, when the finger lifts.
 */

import { newId } from './core.js';
import { pageBox } from './viewer.js';
import { registerTool } from './overlay.js';
import { layerAt } from './overlay-layers.js';
import { elementOf } from './overlay-paint.js';
import { settings } from './props.js';

/** Nothing narrower than this, in points, is a shape: that was a tap. */
const MIN = 3;
/** How long a line's second end must be, in points, to be a line. */
const MIN_LINE = 2;

let ctx = null;
/** The drag in flight, or null. */
let drag = null;

/** The box between two points, with the direction kept when the shape is a line. */
function shapeOf(kind, start, end, set) {
  if (kind === 'line' || kind === 'arrow') {
    return {
      kind,
      id: 'preview',
      x: start.x,
      y: start.y,
      w: end.x - start.x,
      h: end.y - start.y,
      stroke: set.color,
      fill: null,
      width: set.width,
    };
  }
  return {
    kind,
    id: 'preview',
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
    stroke: set.color,
    fill: set.fill ? set.color : null,
    width: set.width,
  };
}

/** Whether the drag made a shape at all, or was a finger landing and leaving. */
function bigEnough(made) {
  if (made.kind === 'line' || made.kind === 'arrow') return Math.hypot(made.w, made.h) >= MIN_LINE;
  return Math.abs(made.w) >= MIN || Math.abs(made.h) >= MIN;
}

/* ── the drag ────────────────────────────────────────────────────────────── */

/** A finger lands: what the shape is made with is settled here, once. */
function begin(pt, page) {
  if (drag) return;
  const box = pageBox(page);
  const layer = layerAt(page);
  if (!box || !layer) return;
  // The settings are copied: a strip tap cannot change the shape in flight.
  drag = {
    page,
    layer,
    scale: box.scale,
    start: { x: pt.x, y: pt.y },
    set: Object.assign({}, settings('shapes')),
    node: null,
  };
}

/** The shape under the moving finger, drawn the way the page will draw it. */
function extend(pt) {
  if (!drag) return;
  const made = shapeOf(drag.set.shape, drag.start, pt, drag.set);
  const node = elementOf(made, drag.scale);
  if (drag.node) drag.node.replaceWith(node);
  else drag.layer.append(node);
  drag.node = node;
}

/** The finger lifts: a shape worth having joins the document, a tap does not. */
function finish(pt) {
  if (!drag) return;
  const done = drag;
  drag = null;
  if (done.node) done.node.remove();
  const made = shapeOf(done.set.shape, done.start, pt, done.set);
  if (!bigEnough(made)) return;
  const shape = Object.assign({}, made, { id: newId(), page: done.page });
  ctx.commit({ pages: ctx.doc.pages, objects: ctx.doc.objects.concat([shape]) });
}

/** The gesture was taken away: the half-drawn shape goes with it. */
function cancel() {
  if (!drag) return;
  if (drag.node) drag.node.remove();
  drag = null;
}

/* ── boot ────────────────────────────────────────────────────────────────── */

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(context) {
  ctx = context;
  registerTool('shapes', {
    onDown: (pt, page) => begin(pt, page),
    onMove: (pt) => extend(pt),
    onUp: (pt) => finish(pt),
    onCancel: () => cancel(),
  });
  return ctx;
}
