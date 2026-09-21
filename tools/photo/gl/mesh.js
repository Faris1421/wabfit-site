/**
 * Wab Fit — the 96-a-side grid a face warp is drawn through.
 *
 * The grid covers the source picture once, in clip space, and every vertex
 * carries the place in the picture it reads from: its own place MINUS the
 * displacement field, in picture pixels. Drawn with the sampler's own bilinear
 * filtering and clamped edges, that is a picture whose pixels come out moved by
 * +field. The two shaders live here with the buffers, because the grid and the
 * two lines that read it are one thing; `warp.js` owns the passes around it.
 *
 * `window` is the clip-space scale and offset that squeezes the whole picture
 * into whatever is being drawn — the identity for a preview, a tile's own share
 * for an export — and `clip` holds the same window in picture coordinates,
 * which throws away every fragment outside it so that a tile's edge lands on a
 * pixel edge and two tiles draw no seam between them.
 */

import { program, uniforms } from './gpu.js';

/** The grid's vertices a side: the grid `face-geometry.js` answers a field on. */
export const MESH_SIDE = 96;

/** The grid: its place in clip space, and where in the source it reads. */
const MESH_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
uniform vec4 uWindow;

out vec2 vUv;
out vec2 vAt;

void main() {
  vUv = aUv;
  vAt = vec2((aPos.x + 1.0) * 0.5, (1.0 - aPos.y) * 0.5);
  gl_Position = vec4(aPos * uWindow.xy + uWindow.zw, 0.0, 1.0);
}
`;

/** One source sample per pixel, and nothing at all outside the clip window. */
const MESH_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uSource;
uniform vec4 uClip;

in vec2 vUv;
in vec2 vAt;
out vec4 outColor;

void main() {
  if (vAt.x < uClip.x || vAt.y < uClip.y
    || vAt.x > uClip.x + uClip.z || vAt.y > uClip.y + uClip.w) discard;
  outColor = texture(uSource, vUv);
}
`;

/** The grid's places and the two triangles of every cell between them. */
function places() {
  const n = MESH_SIDE;
  const position = new Float32Array(n * n * 2);
  for (let at = 0; at < n * n; at += 1) {
    position[at * 2] = ((at % n) / (n - 1)) * 2 - 1;
    position[at * 2 + 1] = 1 - (Math.floor(at / n) / (n - 1)) * 2;
  }
  const index = new Uint16Array((n - 1) * (n - 1) * 6);
  for (let cell = 0; cell < (n - 1) * (n - 1); cell += 1) {
    const a = cell + Math.floor(cell / (n - 1));
    index.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], cell * 6);
  }
  return { position, index };
}

/** One attribute of the grid: its place, its buffer and its pair of floats. */
function attribute(gl, at, buffer, data, usage) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
}

/**
 * The mesh of one context, or null when its program will not build there.
 * `setField` writes every vertex's source place from a displacement field — the
 * two laid out the same way, 96 vertices a side, row by row, in picture pixels —
 * and `draw` renders the grid through one `window` of the picture, reading
 * `texture`, into whatever the caller has bound.
 */
export function createMesh(gl) {
  const linked = program(gl, MESH_VERTEX_SHADER, MESH_FRAGMENT_SHADER);
  if (!linked) return null;
  const u = uniforms(gl, linked, ['uSource', 'uWindow', 'uClip']);
  const shape = places();
  const uv = new Float32Array(MESH_SIDE * MESH_SIDE * 2);
  const position = gl.createBuffer();
  const source = gl.createBuffer();
  const index = gl.createBuffer();

  // The grid is the only thing this context ever draws, so its attributes are
  // set once against the default vertex array and never taken down.
  gl.bindVertexArray(null);
  attribute(gl, 0, position, shape.position, gl.STATIC_DRAW);
  attribute(gl, 1, source, uv, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, shape.index, gl.STATIC_DRAW);

  return { setField, draw };

  /** Where every vertex reads, from the field the tool computed: `at - field`. */
  function setField(field, width, height) {
    const n = MESH_SIDE;
    for (let at = 0; at < n * n; at += 1) {
      const x = ((at % n) / (n - 1)) * width;
      const y = (Math.floor(at / n) / (n - 1)) * height;
      uv[at * 2] = (x - (field[at * 2] ?? 0)) / width;
      uv[at * 2 + 1] = 1 - (y - (field[at * 2 + 1] ?? 0)) / height;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, source);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, uv);
  }

  /** The whole grid through one window of the picture, into the bound target. */
  function draw(texture, window, clip) {
    gl.useProgram(linked);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(u.uSource, 0);
    gl.uniform4f(u.uWindow, window[0], window[1], window[2], window[3]);
    gl.uniform4f(u.uClip, clip[0], clip[1], clip[2], clip[3]);
    gl.drawElements(gl.TRIANGLES, shape.index.length, gl.UNSIGNED_SHORT, 0);
  }
}
