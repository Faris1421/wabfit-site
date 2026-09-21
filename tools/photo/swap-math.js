/**
 * Wab Fit — the face swap's mathematics, without a pixel.
 *
 * Pure, DOM-free and clock-free, so the same file runs in the page and under
 * vitest in Node. Three ideas, one per step of a swap:
 *
 *   TRIANGULATION `delaunay` turns the landmarks of a face into triangles, so
 *   the warp that carries one face's shape onto another's can move whole
 *   triangles instead of points. `hullIndices` is the outline the mesh hangs
 *   from. Both are Bowyer-Watson: every triangle's circumcircle holds no other
 *   point, which is what keeps the warped mesh from folding over itself.
 *
 *   COLOUR `colorStats` measures a region's mean and spread; `matchColor`
 *   shifts one region's pixels onto another's statistics, which is what stops a
 *   pasted face glowing against the skin around it.
 *
 *   MEMBRANE `membrane` solves Laplace's equation inside a mask with the colour
 *   DIFFERENCE (target - source) fixed on the mask's edge, by Jacobi iteration
 *   on the small grid it is handed. The answer is a smooth correction that is
 *   right at the seam and drifts gently in the middle: the last thing that
 *   makes a pasted face sit in its new skin.
 */

/** How far inside a circumcircle a point must be to count. */
const EPS = 1e-9;

/** The circle through three points, or null when they lie on one line. */
function circumcircle(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r2: (x - a.x) ** 2 + (y - a.y) ** 2 };
}

/** True when a point lies strictly inside a circle, its own rim aside. */
function insideCircle(circle, point) {
  return (point.x - circle.x) ** 2 + (point.y - circle.y) ** 2 < circle.r2 - EPS;
}

/** True when two edges join the same pair of vertices, either way round. */
function sameEdge(a, b) {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

/**
 * The Delaunay triangulation of `points`, as triples of their own indices. A
 * super-triangle holds every point, each point splits the triangles whose
 * circumcircle swallows it, and the super-triangle's own triangles are dropped
 * at the end, so the answer covers exactly the points it was given.
 */
export function delaunay(points) {
  const n = points.length;
  if (n < 3) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const verts = points.concat([
    { x: mx - 20 * span, y: my - span },
    { x: mx, y: my + 20 * span },
    { x: mx + 20 * span, y: my - span },
  ]);
  let tris = [[n, n + 1, n + 2]];
  for (let i = 0; i < n; i += 1) {
    const edges = [];
    const kept = [];
    for (const tri of tris) {
      const circle = circumcircle(verts[tri[0]], verts[tri[1]], verts[tri[2]]);
      if (circle && insideCircle(circle, verts[i])) {
        edges.push([tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]);
      } else {
        kept.push(tri);
      }
    }
    for (let e = 0; e < edges.length; e += 1) {
      let shared = false;
      for (let f = 0; f < edges.length; f += 1) {
        if (e !== f && sameEdge(edges[e], edges[f])) { shared = true; break; }
      }
      if (!shared) kept.push([edges[e][0], edges[e][1], i]);
    }
    tris = kept;
  }
  return tris.filter((tri) => tri[0] < n && tri[1] < n && tri[2] < n);
}

/**
 * The points on the outline, in anticlockwise order, by the monotone chain: an
 * upper and a lower walk, each keeping only the turns that stay left.
 */
export function hullIndices(points) {
  const n = points.length;
  if (n < 3) return points.map((_, index) => index);
  const turn = (o, a, b) =>
    (points[a].x - points[o].x) * (points[b].y - points[o].y)
    - (points[a].y - points[o].y) * (points[b].x - points[o].x);
  const order = points
    .map((_, index) => index)
    .sort((a, b) => points[a].x - points[b].x || points[a].y - points[b].y);
  const walk = (list) => {
    const chain = [];
    for (const index of list) {
      while (chain.length >= 2 && turn(chain[chain.length - 2], chain[chain.length - 1], index) <= 0) {
        chain.pop();
      }
      chain.push(index);
    }
    chain.pop();
    return chain;
  };
  return walk(order).concat(walk(order.slice().reverse()));
}

/**
 * The mean and the standard deviation of each colour channel inside `mask`,
 * over an RGBA buffer. An empty mask answers zeroes rather than dividing by it.
 */
export function colorStats(rgba, mask) {
  const sums = [0, 0, 0];
  const squares = [0, 0, 0];
  let n = 0;
  for (let at = 0; at < mask.length; at += 1) {
    if (!mask[at]) continue;
    n += 1;
    for (let c = 0; c < 3; c += 1) {
      const value = rgba[at * 4 + c];
      sums[c] += value;
      squares[c] += value * value;
    }
  }
  if (n === 0) return { mean: [0, 0, 0], std: [0, 0, 0] };
  const mean = sums.map((sum) => sum / n);
  const std = squares.map((square, c) => Math.sqrt(Math.max(0, square / n - mean[c] ** 2)));
  return { mean, std };
}

/**
 * `rgba` with the pixels under `mask` shifted from one region's statistics onto
 * another's: `(v - from.mean) * (to.std / from.std) + to.mean` per channel,
 * clamped as the pixels are written. Alpha and the pixels outside the mask are
 * carried through untouched, and a channel with no spread in `from` keeps its
 * own units rather than dividing by nothing.
 */
export function matchColor(rgba, mask, from, to) {
  const out = new Uint8ClampedArray(rgba.length);
  out.set(rgba);
  const gain = [1, 1, 1];
  for (let c = 0; c < 3; c += 1) {
    if (from.std[c] > 1e-6) gain[c] = to.std[c] / from.std[c];
  }
  for (let at = 0; at < mask.length; at += 1) {
    if (!mask[at]) continue;
    for (let c = 0; c < 3; c += 1) {
      out[at * 4 + c] = (rgba[at * 4 + c] - from.mean[c]) * gain[c] + to.mean[c];
    }
  }
  return out;
}

/**
 * The smooth correction that carries the seam inward. `diff` is the colour
 * difference (target - source) per pixel, trusted on the mask's edge and
 * forgotten inside it; `mask` is 1 where the pasted face is. The answer is a
 * three-channel difference per pixel: the fixed value on the rim, the average
 * of its four neighbours everywhere inside, and zero outside the mask.
 */
export function membrane(diff, mask, w, h, iterations = 300) {
  const wide = Math.max(1, Math.round(w));
  const tall = Math.max(1, Math.round(h));
  const count = wide * tall;
  const out = new Float32Array(count * 3);
  const fixed = new Uint8Array(count);
  for (let at = 0; at < count; at += 1) {
    if (!mask[at]) continue;
    const x = at % wide;
    const y = (at - x) / wide;
    if (x === 0 || y === 0 || x === wide - 1 || y === tall - 1
      || !mask[at - 1] || !mask[at + 1] || !mask[at - wide] || !mask[at + wide]) {
      fixed[at] = 1;
    }
    out[at * 3] = diff[at * 3];
    out[at * 3 + 1] = diff[at * 3 + 1];
    out[at * 3 + 2] = diff[at * 3 + 2];
  }
  const rounds = Math.max(0, Math.round(iterations));
  for (let it = 0; it < rounds; it += 1) {
    for (let y = 1; y < tall - 1; y += 1) {
      for (let x = 1; x < wide - 1; x += 1) {
        const at = y * wide + x;
        if (!mask[at] || fixed[at]) continue;
        for (let c = 0; c < 3; c += 1) {
          out[at * 3 + c] = 0.25 * (
            out[(at - 1) * 3 + c] + out[(at + 1) * 3 + c]
            + out[(at - wide) * 3 + c] + out[(at + wide) * 3 + c]
          );
        }
      }
    }
  }
  return out;
}
