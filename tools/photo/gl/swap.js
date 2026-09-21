/**
 * Wab Fit — the swap's pixels: a face from one photo, drawn onto another's shape.
 *
 * The source's face is drawn through the TARGET's Delaunay triangles — the
 * target's places as vertex positions, the source's pixels at the same landmark
 * indices as texture coordinates — then matched to the target's colours inside
 * the face oval, carried across the seam by a membrane solved on a 128-pixel copy
 * of the face, and feathered out at the oval's edge. `createSwapper(canvas)`
 * answers `swap`: the picture with the face on it and the bare picture, which a
 * caller cross-fades between.
 */
import { MESH, faceFrame } from '../face-geometry.js';
import { colorStats, matchColor, membrane } from '../swap-math.js';
import { edge, imageOf, program, uniforms } from './gpu.js';
import { blurMask } from './skin.js';

/** How far the oval is pulled in, how far its edge feathers, and the grid. */
const ERODE = 0.02;
const FEATHER = 0.025;
const MEMBRANE_WIDE = 128;
const MEMBRANE_ROUNDS = 240;

/** A canvas off the document, of the size asked for. */
const sheet = (width, height) => Object.assign(document.createElement('canvas'), { width, height });

/** The warp: the target's places and the source's pixels at the same indices. */
const WARP_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPlace;
layout(location = 1) in vec2 aSource;
uniform vec2 uTarget, uSourceSize;
out vec2 vUv;
void main() {
  vUv = vec2(aSource.x / uSourceSize.x, 1.0 - aSource.y / uSourceSize.y);
  gl_Position = vec4(aPlace.x / uTarget.x * 2.0 - 1.0, 1.0 - aPlace.y / uTarget.y * 2.0, 0.0, 1.0);
}
`;

/** One sample per pixel, and nothing at all outside the triangles. */
const WARP_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uSource;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uSource, vUv); }
`;

/** The warp over `canvas` — the tool's own, never on screen — or null without WebGL2. */
export function createSwapper(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: false });
  if (!gl) return null;
  const linked = program(gl, WARP_VERTEX, WARP_FRAGMENT);
  if (!linked) return null;
  const u = uniforms(gl, linked, ['uSource', 'uTarget', 'uSourceSize']);
  const place = gl.createBuffer();
  const uv = gl.createBuffer(); const index = gl.createBuffer(); const texture = gl.createTexture();
  gl.bindVertexArray(null);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  edge(gl, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  /** One attribute of the default vertex array: a pair of floats per point. */
  function attribute(at, buffer, points) {
    const flat = Float32Array.from(points.flatMap((point) => [point.x, point.y]));
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, flat, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  }

  /** The source's face on the target's shape, transparent outside the triangles. */
  function render(bitmap, places, sources, triangles, width, height) {
    if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    attribute(0, place, places);
    attribute(1, uv, sources);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, Uint16Array.from(triangles.flat()), gl.DYNAMIC_DRAW);
    gl.useProgram(linked);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(u.uSource, 0);
    gl.uniform2f(u.uTarget, width, height);
    gl.uniform2f(u.uSourceSize, bitmap.width, bitmap.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, triangles.length * 3, gl.UNSIGNED_SHORT, 0);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return imageOf(pixels, width, height);
  }

  return { swap: (target, source, faces) => swap(render, target, source, faces) };
}

/** The oval — or the inner lips — as an RGBA mask over the picture: the polygon
 *  pulled `shrink` pixels toward `centre`, filled, and blurred by `feather`. */
function softMask(points, group, centre, width, height, shrink, feather) {
  const canvas = sheet(width, height);
  const pen = canvas.getContext('2d', { willReadFrequently: true });
  if (!pen) return null;
  pen.fillStyle = '#000000'; pen.beginPath();
  for (let at = 0; at < group.length; at += 1) {
    const point = points[group[at]];
    if (!point) continue;
    const away = Math.hypot(point.x - centre.x, point.y - centre.y) || 1;
    const k = Math.max(0, 1 - shrink / away);
    const x = centre.x + (point.x - centre.x) * k;
    const y = centre.y + (point.y - centre.y) * k;
    if (at) pen.lineTo(x, y);
    else pen.moveTo(x, y);
  }
  pen.closePath();
  pen.fill();
  const drawn = new Uint8Array(pen.getImageData(0, 0, width, height).data);
  return new Uint8ClampedArray(blurMask(drawn, width, height, Math.max(1, Math.round(feather))));
}

/** One channel of a small three-channel grid, read bilinearly, held at its edge. */
function read(grid, wide, tall, x, y, c) {
  const px = Math.min(wide - 1, Math.max(0, x));
  const py = Math.min(tall - 1, Math.max(0, y));
  const x0 = Math.floor(px); const y0 = Math.floor(py);
  const fx = px - x0; const fy = py - y0;
  const tap = (dx, dy) =>
    grid[(Math.min(tall - 1, y0 + dy) * wide + Math.min(wide - 1, x0 + dx)) * 3 + c];
  return (tap(0, 0) * (1 - fx) + tap(1, 0) * fx) * (1 - fy) + (tap(0, 1) * (1 - fx) + tap(1, 1) * fx) * fy;
}

/**
 * The membrane: the difference between the picture and the layer, measured inside
 * the mask on a copy of the face MEMBRANE_WIDE wide and solved there, is added
 * back through a bilinear read of that small grid — exact at the seam, drifting
 * gently across the middle, which is what makes a pasted face sit in its new skin.
 */
function membraneOver(layer, picture, mask, points, width, height) {
  let west = width; let north = height;
  let east = 0; let south = 0;
  for (const index of MESH.faceOval) {
    const point = points[index];
    if (!point) continue;
    west = Math.min(west, point.x);
    east = Math.max(east, point.x);
    north = Math.min(north, point.y);
    south = Math.max(south, point.y);
  }
  const left = Math.max(0, Math.floor(west)); const top = Math.max(0, Math.floor(north));
  const boxW = Math.max(1, Math.min(width, Math.ceil(east)) - left);
  const boxH = Math.max(1, Math.min(height, Math.ceil(south)) - top);
  const wide = Math.min(MEMBRANE_WIDE, boxW);
  const tall = Math.max(2, Math.round((boxH * wide) / boxW));
  const core = new Uint8Array(wide * tall);
  const diff = new Float32Array(wide * tall * 3);
  for (let y = 0; y < tall; y += 1) {
    const row = Math.min(height - 1, top + Math.floor(((y + 0.5) * boxH) / tall));
    for (let x = 0; x < wide; x += 1) {
      const col = Math.min(width - 1, left + Math.floor(((x + 0.5) * boxW) / wide));
      if (!mask[row * width + col]) continue;
      core[y * wide + x] = 1;
      for (let c = 0; c < 3; c += 1) {
        const from = (row * width + col) * 4 + c;
        diff[(y * wide + x) * 3 + c] = picture[from] - layer[from];
      }
    }
  }
  const corr = membrane(diff, core, wide, tall, MEMBRANE_ROUNDS);
  const kx = wide / boxW; const ky = tall / boxH;
  for (let y = 0; y < boxH; y += 1) {
    for (let x = 0; x < boxW; x += 1) {
      const at = (top + y) * width + left + x;
      if (!mask[at]) continue;
      for (let c = 0; c < 3; c += 1) {
        layer[at * 4 + c] += read(corr, wide, tall, (x + 0.5) * kx - 0.5, (y + 0.5) * ky - 0.5, c);
      }
    }
  }
}

/** The source's face on the target's picture at its own size: `base` is the target
 *  bitmap and `swapped` the picture with the face on it, to fade between. */
function swap(render, target, source, faces) {
  const width = target.width; const height = target.height;
  const frame = faceFrame(faces.target);
  const layer = render(source, faces.target, faces.source, faces.triangles, width, height);
  const under = sheet(width, height);
  const pen = under.getContext('2d', { willReadFrequently: true });
  if (!layer || !pen) return null;
  pen.drawImage(target, 0, 0);
  const picture = pen.getImageData(0, 0, width, height).data;
  const mask = softMask(faces.target, MESH.faceOval, frame.center, width, height,
    ERODE * frame.scale, FEATHER * frame.scale);
  if (!mask) return null;
  const core = new Uint8Array(width * height);
  for (let at = 0; at < core.length; at += 1) core[at] = mask[at * 4 + 3] > 127 ? 1 : 0;
  const matched = matchColor(layer.data, core,
    colorStats(layer.data, core), colorStats(picture, core));
  // The target's own mouth interior stays when it is open wider than the source's.
  if (faces.keepMouth) {
    const own = softMask(faces.target, MESH.lipsInner, frame.center, width, height, 0,
      FEATHER * frame.scale);
    if (own) for (let at = 0; at < core.length; at += 1) if (own[at * 4 + 3] > 127) mask[at * 4 + 3] = 0;
  }
  membraneOver(matched, picture, core, faces.target, width, height);
  for (let at = 0; at < core.length; at += 1) matched[at * 4 + 3] = mask[at * 4 + 3];
  pen.putImageData(new ImageData(matched, width, height), 0, 0);
  const swapped = sheet(width, height);
  const sg = swapped.getContext('2d');
  if (!sg) return null;
  sg.drawImage(target, 0, 0);
  sg.drawImage(under, 0, 0);
  return { base: target, swapped };
}
