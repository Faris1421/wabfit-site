/**
 * Wab Fit — the crop frame's arithmetic, without a pixel.
 *
 * Pure, DOM-free and clock-free, so the same file runs in the page and under
 * vitest in Node. Nothing here draws: it says where the frame may sit, what a
 * handle does to it, what a straighten costs, and how big the finished picture
 * is.
 *
 * THE FRAME LIVES IN THE TURNED PICTURE'S OWN SPACE. A crop is `{x, y, w, h}`
 * in the picture's pixels AFTER the quarter turns, plus the four other values a
 * crop carries: `rotate90` (clockwise quarter turns, 0..3), `flipH`, `flipV`
 * and `straighten` (degrees, -45..45). The tool shows the turned, mirrored and
 * tilted picture, and the frame is a rectangle on it — so the numbers here are
 * the numbers the person sees, and the bake draws what the preview drew.
 *
 * A STRAIGHTEN NEVER SHOWS AN EMPTY CORNER. The picture is turned by
 * `straighten` degrees about its centre and zoomed by `straightenScale`, the
 * smallest zoom that still covers the frame's whole space; `largestInscribed` is
 * the rectangle that zoom is built from, and it is the standard straighten
 * constraint.
 */

/** The smallest a frame may be, on either side, in picture pixels. */
export const MIN_SIDE = 24;

/** The eight handles of a frame, named by the corner or the edge they sit on. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The frame a picture opens with: all of it, upright, unmirrored, level. */
export function defaultCrop(width, height) {
  return {
    x: 0,
    y: 0,
    w: Math.max(1, Math.round(width)),
    h: Math.max(1, Math.round(height)),
    rotate90: 0,
    flipH: false,
    flipV: false,
    straighten: 0,
  };
}

/**
 * A frame inside `bounds` ({w, h}, in picture pixels): whole pixels, never
 * smaller than MIN_SIDE, and pushed back under the edges rather than cut off.
 */
export function clampRect(rect, bounds) {
  const wide = Math.max(1, Math.round(bounds.w));
  const tall = Math.max(1, Math.round(bounds.h));
  const w = Math.min(wide, Math.max(MIN_SIDE, Math.round(rect.w)));
  const h = Math.min(tall, Math.max(MIN_SIDE, Math.round(rect.h)));
  return {
    x: Math.min(Math.max(0, Math.round(rect.x)), wide - w),
    y: Math.min(Math.max(0, Math.round(rect.y)), tall - h),
    w,
    h,
  };
}

/**
 * The largest frame of `aspect` (width ÷ height) the picture holds, on the
 * frame's old centre and pushed inside the edges — the crop a person gets when
 * they pick a ratio, which is the whole picture's worth of it. Anything that is
 * not a positive number is "free": the frame is only kept inside the picture.
 */
export function fitAspect(rect, aspect, imageW, imageH) {
  const bounds = { w: imageW, h: imageH };
  if (!(Number(aspect) > 0)) return clampRect(rect, bounds);
  let w = bounds.w;
  let h = w / aspect;
  if (h > bounds.h) {
    h = bounds.h;
    w = h * aspect;
  }
  return clampRect({
    x: rect.x + rect.w / 2 - w / 2,
    y: rect.y + rect.h / 2 - h / 2,
    w,
    h,
  }, bounds);
}

/**
 * The eight handle positions of a frame, in picture pixels, keyed by name. The
 * tool hit-tests against these and draws its grips at them.
 */
export function handlePoints(rect) {
  const midX = rect.x + rect.w / 2;
  const midY = rect.y + rect.h / 2;
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  return {
    nw: { x: rect.x, y: rect.y },
    n: { x: midX, y: rect.y },
    ne: { x: right, y: rect.y },
    e: { x: right, y: midY },
    se: { x: right, y: bottom },
    s: { x: midX, y: bottom },
    sw: { x: rect.x, y: bottom },
    w: { x: rect.x, y: midY },
  };
}

/** The handle within `reach` picture pixels of `point`, or '' when none is. */
export function pickHandle(rect, point, reach) {
  const far = Math.max(1, Number(reach) || 0);
  const points = handlePoints(rect);
  for (const name of HANDLES) {
    const at = points[name];
    if (Math.abs(point.x - at.x) <= far && Math.abs(point.y - at.y) <= far) return name;
  }
  return '';
}

/**
 * The frame after one handle is dragged by `dx`, `dy` picture pixels. The edges
 * opposite the handle stay put, and `aspect` — width ÷ height, or null for free
 * — keeps the shape: a corner or a side handle drives the width, a top or bottom
 * one the height, and the other side follows. The answer is inside `bounds` and
 * never smaller than MIN_SIDE.
 */
export function moveHandle(rect, handle, dx, dy, aspect, bounds) {
  const ratio = Number(aspect) > 0 ? Number(aspect) : 0;
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.charAt(0) === 'n';
  const south = handle.charAt(0) === 's';
  const left = rect.x;
  const right = rect.x + rect.w;
  const top = rect.y;
  const bottom = rect.y + rect.h;

  let w = (east ? right + dx : right) - (west ? left + dx : left);
  let h = (south ? bottom + dy : bottom) - (north ? top + dy : top);

  if (ratio > 0) {
    if (west || east) {
      w = Math.max(MIN_SIDE, w);
      h = Math.max(1, w / ratio);
    } else {
      h = Math.max(MIN_SIDE, h);
      w = Math.max(1, h * ratio);
    }
    const cap = Math.min(bounds.w, bounds.h * ratio);
    if (w > cap) {
      w = cap;
      h = w / ratio;
    }
  } else {
    w = Math.min(bounds.w, Math.max(MIN_SIDE, w));
    h = Math.min(bounds.h, Math.max(MIN_SIDE, h));
  }

  return clampRect({
    x: west ? left + rect.w - w : east ? left : rect.x + rect.w / 2 - w / 2,
    y: north ? top + rect.h - h : south ? top : rect.y + rect.h / 2 - h / 2,
    w,
    h,
  }, bounds);
}

/**
 * `rect` after the picture under it is turned one quarter turn: the frame turns
 * with the picture, so a person's framing survives a rotate-left or
 * rotate-right. `imageW` and `imageH` are the picture's size BEFORE the turn.
 */
export function turnRect(rect, imageW, imageH, clockwise) {
  return clockwise
    ? { x: imageH - (rect.y + rect.h), y: rect.x, w: rect.h, h: rect.w }
    : { x: rect.y, y: imageW - (rect.x + rect.w), w: rect.h, h: rect.w };
}

/** The picture's size after `rotate90` quarter turns: the sides swap on 1 and 3. */
export function rotatedSize(width, height, rotate90) {
  const turns = ((Math.round(Number(rotate90) || 0) % 4) + 4) % 4;
  return turns % 2 === 1 ? { w: height, h: width } : { w: width, h: height };
}

/**
 * The largest rectangle of the picture's own aspect — `width` to `height` — that
 * fits inside the picture turned by `degrees`. At 0 degrees it is the picture
 * itself, and the further the tilt the smaller it gets.
 */
export function largestInscribed(width, height, degrees) {
  const w = Math.max(1, Number(width) || 0);
  const h = Math.max(1, Number(height) || 0);
  const radians = (Math.abs(Number(degrees) || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const k = Math.min(1, w / (w * cos + h * sin), h / (w * sin + h * cos));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** How much the picture is zoomed up to cover the frame at `degrees`: 1 at level. */
export function straightenScale(width, height, degrees) {
  const inside = largestInscribed(width, height, degrees);
  return inside.w > 0 ? Math.max(1, width / inside.w) : 1;
}

/** The finished picture's size in pixels: the frame, rounded. */
export function outputSize(crop) {
  return {
    width: Math.max(1, Math.round(crop.w)),
    height: Math.max(1, Math.round(crop.h)),
  };
}
