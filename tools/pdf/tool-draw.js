/**
 * Wab Fit — one finger, one line: the pen, and the highlighter.
 *
 * Both tools are the same gesture with two differences, so they are one file.
 * A stroke is drawn live on a throwaway SVG over the page — its own path, sized
 * in the page's own points — and only when the finger lifts is it SIMPLIFIED
 * and put into the model, in one `ctx.commit` that undo can take back.
 *
 * A raw touch stream is mostly noise: a finger reports a point every few
 * milliseconds and the hand shakes between them. Ramer–Douglas–Peucker keeps
 * the corners and drops the rest, so a highlighted paragraph is a few hundred
 * points rather than a few thousand — which is the difference between a file
 * that opens and one that does not.
 *
 * Highlight differs in exactly two numbers: a wide stroke, and an opacity the
 * PDF carries. On screen the layer's own alpha stands in for the multiply
 * blend a PDF reader would use.
 */

import { newId } from './core.js';
import { pageBox } from './viewer.js';
import { registerTool } from './overlay.js';
import { layerAt } from './overlay-layers.js';
import { settings } from './props.js';

const NS = 'http://www.w3.org/2000/svg';
/** How far, in points, the finger moves before another point is kept. */
const STEP = 0.8;
/** How far, in points, a point may sit off the line through its neighbours. */
export const EPSILON = 0.75;

let ctx = null;
/** The stroke in flight, or null. */
let stroke = null;

/** How far a point sits from the segment a–b, in points. */
function distanceTo(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const along = length === 0
    ? 0
    : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length));
  return Math.hypot(point[0] - (a[0] + dx * along), point[1] - (a[1] + dy * along));
}

/**
 * Ramer–Douglas–Peucker: the points that carry the shape of the line and no
 * more. The stack keeps a long stroke from recursing a thousand frames deep.
 */
export function simplify(points, epsilon = EPSILON) {
  if (points.length < 3) return points.map(([x, y]) => [x, y]);
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    let far = -1;
    let worst = 0;
    for (let at = a + 1; at < b; at += 1) {
      const off = distanceTo(points[at], points[a], points[b]);
      if (off > worst) {
        worst = off;
        far = at;
      }
    }
    if (far > -1 && worst > epsilon) {
      keep[far] = true;
      stack.push([a, far], [far, b]);
    }
  }
  const kept = [];
  for (let at = 0; at < points.length; at += 1) {
    if (keep[at]) kept.push(points[at]);
  }
  return kept;
}

/** A point of the model, to a hundredth of a point. */
function round(value) {
  return Math.round(value * 100) / 100;
}

/** The points as the `d` of a path. */
function pathOf(points) {
  return points.map(([x, y], at) => `${at === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
}

/* ── the stroke in flight ────────────────────────────────────────────────── */

/** The throwaway SVG a stroke is drawn on: the page's own points, in pixels. */
function preview(page) {
  const box = pageBox(page);
  const layer = layerAt(page);
  if (!box || !layer) return null;
  const width = box.width / box.scale;
  const height = box.height / box.scale;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'position:absolute;inset-block-start:0;inset-inline-start:0;'
    + `pointer-events:none;overflow:visible;width:${box.width}px;height:${box.height}px;`;
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return { svg, path, layer };
}

/** A finger lands: what the stroke will be made with is settled here, once. */
function begin(pt, page, highlight) {
  if (stroke) return;
  const made = preview(page);
  if (!made) return;
  const set = settings(highlight ? 'highlight' : 'draw');
  const style = {
    color: set.color,
    width: set.width,
    // A highlight is see-through; the pen is not. The PDF carries this number.
    opacity: highlight ? set.opacity : 1,
  };
  made.path.setAttribute('stroke', style.color);
  made.path.setAttribute('stroke-width', String(style.width));
  if (style.opacity < 1) made.path.setAttribute('opacity', String(style.opacity));
  made.path.setAttribute('d', pathOf([[pt.x, pt.y]]));
  made.layer.append(made.svg);
  stroke = {
    page, style, points: [[pt.x, pt.y]], svg: made.svg, path: made.path,
  };
}

/** Another raw point, when the finger has moved far enough to mean one. */
function extend(pt) {
  if (!stroke) return;
  const last = stroke.points[stroke.points.length - 1];
  if (Math.hypot(pt.x - last[0], pt.y - last[1]) < STEP) return;
  stroke.points.push([pt.x, pt.y]);
  stroke.path.setAttribute('d', pathOf(stroke.points));
}

/** The finger lifts: the stroke becomes a mark of the document, once. */
function finish() {
  if (!stroke) return;
  const done = stroke;
  stroke = null;
  done.svg.remove();
  const points = simplify(done.points).map(([x, y]) => [round(x), round(y)]);
  const mark = {
    kind: 'ink',
    id: newId(),
    page: done.page,
    points,
    color: done.style.color,
    width: done.style.width,
    opacity: done.style.opacity,
  };
  ctx.commit({ pages: ctx.doc.pages, objects: ctx.doc.objects.concat([mark]) });
}

/** The gesture was taken away: the half-drawn line goes with it. */
function cancel() {
  if (!stroke) return;
  stroke.svg.remove();
  stroke = null;
}

/* ── boot ────────────────────────────────────────────────────────────────── */

/** The pointer, wired to one of the two tools. */
function handlers(highlight) {
  return {
    onDown: (pt, page) => begin(pt, page, highlight),
    onMove: (pt) => extend(pt),
    onUp: (pt) => {
      extend(pt);
      finish();
    },
    onCancel: () => cancel(),
  };
}

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(context) {
  ctx = context;
  registerTool('draw', handlers(false));
  registerTool('highlight', handlers(true));
  return ctx;
}
