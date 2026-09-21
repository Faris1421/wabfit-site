/**
 * Wab Fit — the geometry of a face, without a pixel.
 *
 * Pure, DOM-free and clock-free, so the same file runs in the page and under
 * vitest in Node. It says which point of the 478-point mesh is what, where the
 * face's own frame is, which local warps the sliders ask for, and what they do
 * to a grid of picture vertices. The index groups are MediaPipe's canonical
 * mesh written down, checked by the test beside this file.
 *
 * EVERYTHING IS IN PICTURE PIXELS. The landmarks arrive as MediaPipe's own 478
 * points scaled to the picture; `scale` is the inter-ocular distance in those
 * pixels, and every radius and throw below is a share of it. LEFT AND RIGHT ARE
 * THE PICTURE'S, not the sitter's: `leftEye` sits at the smaller x when the
 * face is upright — the opposite of MediaPipe's own naming.
 *
 * A WARP IS ONE LOCAL MOVE: a disc of `radius` about `cx`, `cy` whose strength
 * falls to nothing at the rim, `amount` being the slider's fraction (-1 to 1).
 * A `push` moves the disc by `(dx, dy) * amount`; a `bulge` scales the offset
 * from the centre about each axis by `dx * amount` and `dy * amount`.
 */

/** The canonical 478-point mesh, grouped the way the tools ask for it. */
export const MESH = {
  faceOval: [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
    152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  ],
  leftEye: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  rightEye: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
  leftIris: [469, 470, 471, 472],
  rightIris: [474, 475, 476, 477],
  lipsOuter: [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
  ],
  lipsInner: [
    78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191,
  ],
  noseBridge: [168, 6, 197, 195, 5, 4],
  noseAlar: [98, 327, 129, 358, 49, 279, 48, 64, 278, 294, 45, 220, 275, 440, 115, 344],
  jaw: [
    454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234,
  ],
  chin: [152],
  leftBrow: [46, 53, 52, 65, 55, 70, 63, 105, 66, 107],
  rightBrow: [276, 283, 282, 295, 285, 300, 293, 334, 296, 336],
};

/** The jaw line's cheeks and sides, and its lower jaw: the chin (152) is neither. */
const JAW_SIDES = MESH.jaw.filter((_, at) => at < 9 || at > 11);
const JAW_LOWER = MESH.jaw.filter((_, at) => (at >= 6 && at <= 8) || (at >= 12 && at <= 14));

/** The average of a group's points, or the origin when the group is empty. */
function centroid(landmarks, group) {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const index of group) {
    const point = landmarks[index];
    if (!point) continue;
    x += point.x; y += point.y; n += 1;
  }
  return n > 0 ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

/** A slider as a fraction of its own range, held to -1..1; anything else is 0. */
function fraction(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n / 100));
}

/** How far a point sits to the right of the face's axis, along the frame. */
function offsetOf(point, frame) {
  return (point.x - frame.center.x) * frame.right.x + (point.y - frame.center.y) * frame.right.y;
}

/** The face's own frame: the eye line is its axis, the inter-ocular gap its size. */
export function faceFrame(landmarks) {
  const leftEye = centroid(landmarks, MESH.leftEye);
  const rightEye = centroid(landmarks, MESH.rightEye);
  const span = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
  const right = span > 0
    ? { x: (rightEye.x - leftEye.x) / span, y: (rightEye.y - leftEye.y) / span }
    : { x: 1, y: 0 };
  return {
    center: { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 },
    right,
    up: { x: right.y, y: -right.x },
    scale: span > 0 ? span : 1,
    leftEye,
    rightEye,
  };
}

/** One push per point of `group`, each drawn toward the face's axis. */
function pushSides(warps, landmarks, frame, group, amount, radius, pull) {
  for (const index of group) {
    const point = landmarks[index];
    if (!point) continue;
    const offset = offsetOf(point, frame);
    if (offset === 0) continue;
    warps.push({
      cx: point.x, cy: point.y, radius, kind: 'push', amount,
      dx: frame.right.x * -offset * pull, dy: frame.right.y * -offset * pull,
    });
  }
}

/** One push per mouth corner, up and out along the picture's own smile. */
function pushSmile(warps, landmarks, frame, amount) {
  for (const corner of [MESH.lipsOuter[0], MESH.lipsOuter[10]]) {
    const point = landmarks[corner];
    if (!point) continue;
    const out = offsetOf(point, frame) < 0 ? -1 : 1;
    const dx = frame.up.x + out * frame.right.x;
    const dy = frame.up.y + out * frame.right.y;
    const length = Math.hypot(dx, dy) || 1;
    warps.push({
      cx: point.x, cy: point.y, radius: frame.scale * 0.5, kind: 'push', amount,
      dx: (dx / length) * 0.18 * frame.scale, dy: (dy / length) * 0.18 * frame.scale,
    });
  }
}

/** The warps the face sliders ask for, most of them one per landmark they move. */
export function controls(landmarks, sliders) {
  const rest = sliders || {};
  const frame = faceFrame(landmarks);
  const S = frame.scale;
  const warps = [];

  const slim = fraction(rest.slim);
  if (slim !== 0) pushSides(warps, landmarks, frame, JAW_SIDES, slim, S * 0.55, 0.4);

  const jaw = fraction(rest.jaw);
  if (jaw !== 0) pushSides(warps, landmarks, frame, JAW_LOWER, jaw, S * 0.5, 0.3);

  const chin = fraction(rest.chin);
  const tip = landmarks[MESH.chin[0]];
  if (chin !== 0 && tip) {
    warps.push({
      cx: tip.x, cy: tip.y, radius: S * 0.5, kind: 'push', amount: chin,
      dx: -frame.up.x * 0.35 * S, dy: -frame.up.y * 0.35 * S,
    });
  }

  const eyes = fraction(rest.eyes);
  if (eyes !== 0) {
    for (const at of [frame.leftEye, frame.rightEye]) {
      warps.push({
        cx: at.x, cy: at.y, radius: S * 0.75, kind: 'bulge', amount: eyes, dx: 0.22, dy: 0.22,
      });
    }
  }

  const nose = fraction(rest.nose);
  if (nose !== 0) pushSides(warps, landmarks, frame, MESH.noseAlar, nose, S * 0.5, 0.4);

  const lips = fraction(rest.lips);
  if (lips !== 0) {
    const mouth = centroid(landmarks, MESH.lipsOuter);
    warps.push({
      cx: mouth.x, cy: mouth.y, radius: S * 0.6, kind: 'bulge', amount: lips, dx: 0, dy: 0.3,
    });
  }

  const smile = fraction(rest.smile);
  if (smile !== 0) pushSmile(warps, landmarks, frame, smile);

  return warps;
}

/** What every warp does to one point, added together. */
export function displace(warps, x, y) {
  let dx = 0;
  let dy = 0;
  for (const warp of warps) {
    const radius = warp.radius;
    if (!(radius > 0)) continue;
    const ox = x - warp.cx;
    const oy = y - warp.cy;
    const far = Math.hypot(ox, oy);
    if (far >= radius) continue;
    const fall = 1 - (far / radius) ** 2;
    const w = fall * fall;
    if (warp.kind === 'bulge') {
      dx += ox * warp.dx * warp.amount * w;
      dy += oy * warp.dy * warp.amount * w;
    } else {
      dx += warp.dx * warp.amount * w;
      dy += warp.dy * warp.amount * w;
    }
  }
  return { dx, dy };
}

/**
 * The warps sampled on a `gridW` by `gridH` grid of vertices covering the whole
 * picture: `(dx, dy)` per vertex, row by row. The WebGL mesh that moves the
 * pixels is built from exactly this.
 */
export function displacementField(warps, gridW, gridH, imageW, imageH) {
  const w = Math.max(1, Math.round(gridW));
  const h = Math.max(1, Math.round(gridH));
  const stepX = w > 1 ? imageW / (w - 1) : 0;
  const stepY = h > 1 ? imageH / (h - 1) : 0;
  const field = new Float32Array(w * h * 2);
  for (let j = 0; j < h; j += 1) {
    const y = j * stepY;
    for (let i = 0; i < w; i += 1) {
      const moved = displace(warps, i * stepX, y);
      const at = (j * w + i) * 2;
      field[at] = moved.dx;
      field[at + 1] = moved.dy;
    }
  }
  return field;
}
