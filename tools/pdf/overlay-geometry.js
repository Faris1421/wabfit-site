/**
 * Wab Fit — where a selected object is, and what a drag makes of it.
 *
 * This module is arithmetic over the edit model and nothing else: no DOM, no
 * events, no state. Three callers want the same answers — the overlay that draws
 * the objects, the chrome that frames one of them, and the drag that moves or
 * reshapes it — so the answers are exported once, here, rather than written out
 * three times.
 *
 * `boxOf` answers a POSITIVE box whatever the object's own numbers look like: a
 * line runs from (x, y) to (x + w, y + h) and either of those may be negative, so
 * the box it is shown and hit-tested in is the smallest upright rectangle around
 * it. `resizeObject` gives those signs back, because a line dragged by a corner
 * must not turn round.
 */

/** Nothing is dragged smaller than this, in points. */
const MIN = 6;

/** The box a selection shows: x and y at the top-left, w and h positive. */
export function boxOf(obj) {
  if (obj.kind === 'ink') {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const [x, y] of obj.points) {
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    if (!Number.isFinite(left)) return { x: 0, y: 0, w: 0, h: 0 };
    // Half a stroke width either side, so the whole mark is inside the box.
    const pad = obj.width / 2;
    return { x: left - pad, y: top - pad, w: right - left + pad * 2, h: bottom - top + pad * 2 };
  }
  return {
    x: obj.w < 0 ? obj.x + obj.w : obj.x,
    y: obj.h < 0 ? obj.y + obj.h : obj.y,
    w: Math.abs(obj.w),
    h: Math.abs(obj.h),
  };
}

/** True when a point of the page is on the object, `tol` points of slack given. */
export function hitObject(obj, pt, tol) {
  const box = boxOf(obj);
  if (pt.x < box.x - tol || pt.x > box.x + box.w + tol) return false;
  if (pt.y < box.y - tol || pt.y > box.y + box.h + tol) return false;
  if (obj.kind !== 'ink') return true;
  const reach = obj.width / 2 + tol;
  for (let at = 1; at < obj.points.length; at += 1) {
    if (near(obj.points[at - 1], obj.points[at], pt, reach)) return true;
  }
  // A stroke of one point is a dot, and a dot is not a segment.
  return obj.points.length === 1 && near(obj.points[0], obj.points[0], pt, reach);
}

/** True when a point comes within `reach` of the segment a–b. */
function near(a, b, pt, reach) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const along = length === 0
    ? 0
    : Math.max(0, Math.min(1, ((pt.x - a[0]) * dx + (pt.y - a[1]) * dy) / length));
  return Math.hypot(pt.x - (a[0] + dx * along), pt.y - (a[1] + dy * along)) <= reach;
}

/**
 * A picture keeps its shape. The finger decides one of the two sizes and the
 * other follows the box the gesture started from, and the edge OPPOSITE the
 * handle — the corner in a corner's hand — stays where it was. An image is
 * never stretched: a photograph, a logo and a signature are all worse for it.
 */
function keepShape(from, id, next) {
  const ratio = from.w === 0 ? 1 : from.h / from.w;
  const sideways = !(id === 'n' || id === 's');
  const w = sideways ? next.w : next.h / ratio;
  const h = sideways ? next.w * ratio : next.h;
  return {
    x: id.includes('w') ? from.x + from.w - w : from.x,
    y: id.includes('n') ? from.y + from.h - h : from.y,
    w,
    h,
  };
}

/**
 * The object as it would be if handle `id` were dragged to `pt`. `from` is the
 * box the gesture started from, so every move is measured against the original
 * rather than against the last one.
 */
export function resizeObject(obj, id, from, pt) {
  let { x, y, w, h } = from;
  if (id.includes('w')) {
    const edge = x + w;
    x = Math.min(pt.x, edge - MIN);
    w = edge - x;
  }
  if (id.includes('e')) w = Math.max(MIN, pt.x - x);
  if (id.includes('n')) {
    const edge = y + h;
    y = Math.min(pt.y, edge - MIN);
    h = edge - y;
  }
  if (id.includes('s')) h = Math.max(MIN, pt.y - y);
  const next = { x, y, w, h };
  return fit(obj, from, obj.kind === 'image' ? keepShape(from, id, next) : next);
}

/**
 * Puts the object's own numbers into the new box. Ink is scaled point by point,
 * so a drawn circle stays a circle; a line keeps the direction it was drawn in,
 * which is what the sign of its w and h carries.
 */
function fit(obj, from, next) {
  const sx = from.w === 0 ? 1 : next.w / from.w;
  const sy = from.h === 0 ? 1 : next.h / from.h;
  if (obj.kind === 'ink') {
    const points = obj.points.map(([x, y]) => [
      next.x + (x - from.x) * sx,
      next.y + (y - from.y) * sy,
    ]);
    return { ...obj, points };
  }
  const back = obj.w < 0;
  const up = obj.h < 0;
  return {
    ...obj,
    x: back ? next.x + next.w : next.x,
    y: up ? next.y + next.h : next.y,
    w: back ? -next.w : next.w,
    h: up ? -next.h : next.h,
  };
}

/** The object moved by a step, in points. Ink moves point by point. */
export function translate(obj, dx, dy) {
  if (obj.kind === 'ink') {
    return { ...obj, points: obj.points.map(([x, y]) => [x + dx, y + dy]) };
  }
  return { ...obj, x: obj.x + dx, y: obj.y + dy };
}
