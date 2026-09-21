/**
 * Wab Fit — the signature pad's canvas, and the ink on it.
 *
 * This module is the drawing surface and nothing else: a canvas sized to the
 * box it is put in, a pen that follows a finger with that finger's own
 * pressure, and the arithmetic that cuts the result down to the marks that were
 * really made. Where the sheet is, what its buttons say and where a finished
 * signature lands is the business of tool-sign.js.
 *
 * A stroke is kept as the points the finger reported, pressure and all, and
 * drawn as a chain of curves through the MIDPOINTS of those points — the raw
 * points are the control points. That is what turns a stream of dots into a pen
 * line, and it makes the drawing independent of the device's reporting rate.
 *
 * The canvas is cleared, never white: a signature is the ink alone, so it can
 * be put over anything, and its bounds are what tell the sheet where the ink
 * is. `trimmed` is the whole of that: the marks, cut to the box they fill,
 * written out as a transparent PNG.
 */

/** The pen's width for one unit of the strip's size, and its lightest press. */
const PEN = 1.7;
const THIN = 0.45;
/** A pixel fainter than this is not ink: the bounds are trimmed to real marks. */
const INK = 8;

export function createPad() {
  const canvas = document.createElement('canvas');
  canvas.className = 'sign-pad';
  // Absolute inside the framed surface the sheet puts it in, so it fills that
  // box exactly and a finger on it draws rather than scrolls.
  canvas.style.cssText = 'position:absolute;inset:0;display:block;touch-action:none;'
    + '-webkit-tap-highlight-color:transparent;cursor:crosshair;';
  const g = canvas.getContext('2d');

  /** The pen the next stroke is drawn with, read from the strip on opening. */
  let pen = { color: '#000000', size: 2 };
  /** Device pixels per CSS pixel, so the ink is crisp on a dense screen. */
  let ratio = 1;
  /** Finished strokes, and the one under the finger. */
  let strokes = [];
  let drawing = null;

  /** The pen's width at one point of a stroke: the strip's size, the press. */
  function widthAt(pressure) {
    const press = THIN + (1 - THIN) * Math.min(1, Math.max(0, pressure));
    return Math.max(0.6, pen.size * PEN * ratio * press);
  }

  /** The midpoint between two points of a stroke. */
  function mid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /** One stroke as curves through its midpoints, the raw points steering them. */
  function drawStroke(stroke) {
    g.strokeStyle = stroke.color;
    g.fillStyle = stroke.color;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const points = stroke.points;
    if (points.length === 0) return;
    if (points.length === 1) {
      // A tap is a dot, and a dot is not a segment.
      g.beginPath();
      g.arc(points[0].x, points[0].y, widthAt(points[0].p) / 2, 0, Math.PI * 2);
      g.fill();
      return;
    }
    for (let at = 1; at < points.length; at += 1) {
      const from = points[at - 1];
      const to = points[at];
      const start = at > 1 ? mid(points[at - 2], from) : from;
      const end = mid(from, to);
      g.lineWidth = widthAt(from.p);
      g.beginPath();
      g.moveTo(start.x, start.y);
      g.quadraticCurveTo(from.x, from.y, end.x, end.y);
      g.stroke();
    }
    // The tail, from the last midpoint to where the finger is right now.
    const last = points[points.length - 1];
    const tail = mid(points[points.length - 2], last);
    g.lineWidth = widthAt(last.p);
    g.beginPath();
    g.moveTo(tail.x, tail.y);
    g.lineTo(last.x, last.y);
    g.stroke();
  }

  /** The whole pad again. Cheap enough: a signature is a few hundred points. */
  function paint() {
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) drawStroke(stroke);
    if (drawing) drawStroke(drawing);
  }

  /** The points a pointer event carries, in the canvas's own pixels. */
  function readings(event) {
    const rect = canvas.getBoundingClientRect();
    const raw = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
    const list = raw.length > 0 ? raw : [event];
    return list.map((one) => ({
      x: (one.clientX - rect.left) * ratio,
      y: (one.clientY - rect.top) * ratio,
      p: one.pressure > 0 ? one.pressure : 0.5,
    }));
  }

  /* ── the finger ────────────────────────────────────────────────────────── */

  function down(event) {
    if (drawing) return;
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone needs no capture.
    }
    drawing = { color: pen.color, points: readings(event) };
    paint();
  }

  function move(event) {
    if (!drawing) return;
    event.preventDefault();
    drawing.points.push(...readings(event));
    paint();
  }

  /** The finger lifts: the stroke is finished and stays on the pad. */
  function up(event) {
    if (!drawing) return;
    drawing.points.push(...readings(event));
    strokes.push(drawing);
    drawing = null;
    paint();
  }

  /** The gesture was taken away: half a stroke is not a signature. */
  function cancel() {
    if (!drawing) return;
    drawing = null;
    paint();
  }

  /* ── what the sheet asks of it ─────────────────────────────────────────── */

  /** Everything cleared: the next signature starts on a blank pad. */
  function clear() {
    strokes = [];
    drawing = null;
    paint();
  }

  /** The canvas takes the box it was given, in the screen's own pixels. */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    paint();
  }

  /** The pen the next stroke is drawn with — the strip's colour and size. */
  function setPen(color, size) {
    pen = { color, size };
  }

  /** The marks that were made, cut to their own bounds, as a transparent PNG. */
  function trimmed() {
    const width = canvas.width;
    const height = canvas.height;
    if (width === 0 || height === 0) return null;
    const pixels = g.getImageData(0, 0, width, height).data;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3] <= INK) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (right < left || bottom < top) return null;
    const out = document.createElement('canvas');
    out.width = right - left + 1;
    out.height = bottom - top + 1;
    out.getContext('2d')
      .drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
    return { png: out.toDataURL('image/png'), w: out.width, h: out.height };
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);

  return { canvas, clear, trimmed, resize, setPen };
}
