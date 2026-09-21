/**
 * Wab Fit — the retouch: skin, teeth and eyes, through one mask.
 *
 * One pass, three effects, each weighted by a channel of the mask texture. R is
 * skin: a 13-tap edge-preserving blur whose weights fall as the luminance
 * difference grows, so a blemish's edge goes soft and an eyelash stays sharp. G
 * is teeth: bright, nearly grey pixels give up a little saturation and gain a
 * little light. B is eyes: exposure lifts a touch and the contrast between a
 * pixel and its edge opens the iris. Every tap is measured in PICTURE uv, so the
 * same dials give the same retouch at preview size and in the export.
 *
 * The mask is drawn on a 2D canvas from the landmark polygons — the face oval
 * MINUS eyes, brows and lips for skin, the inner lips for teeth, the eye
 * contours for eyes — blurred a little and uploaded as ONE RGBA texture: R skin,
 * G teeth, B eyes.
 */

import { MESH } from '../face-geometry.js';
import { edge, program, uniforms } from './gpu.js';
import { VERTEX_SHADER } from './shaders.js';

/** The mask's long side in pixels: enough for a big face, and a small texture. */
export const MASK_SIDE = 1024;

/** The tap step in picture pixels: the same share of the picture at any size. */
export const stepPixels = (width, height) => Math.max(1.5, 0.0025 * Math.max(width, height));

/** `value` held between `low` and `high`: how a blur treats the edge of a line. */
const hold = (value, low, high) => Math.min(high, Math.max(low, value));

/** `data` blurred by a box twice, which together are one triangle of blur: the
 *  four channels never mix, so the three masks stay apart.
 */
export function blurMask(data, width, height, radius) {
  const r = Math.max(0, Math.round(radius));
  if (r < 1) return data;
  const span = r * 2 + 1;
  let from = data;
  for (const vertical of [false, true]) {
    const to = new Uint8Array(from.length);
    const lines = vertical ? width : height;
    const length = vertical ? height : width;
    const step = (vertical ? width : 1) * 4;
    for (let line = 0; line < lines; line += 1) {
      const base = vertical ? line * 4 : line * width * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        let sum = 0;
        for (let at = -r; at <= r; at += 1) sum += from[base + hold(at, 0, length - 1) * step + channel];
        for (let at = 0; at < length; at += 1) {
          to[base + at * step + channel] = sum / span;
          sum += from[base + hold(at + r + 1, 0, length - 1) * step + channel];
          sum -= from[base + hold(at - r, 0, length - 1) * step + channel];
        }
      }
    }
    from = to;
  }
  return from;
}

/** One closed polygon of the mesh, outlined in the mask's own pixels. */
function polygon(pen, points, group, k) {
  const first = points[group[0]];
  if (!first) return false;
  pen.beginPath();
  pen.moveTo(first.x * k, first.y * k);
  for (const index of group.slice(1)) {
    const point = points[index];
    if (point) pen.lineTo(point.x * k, point.y * k);
  }
  pen.closePath();
  return true;
}

/**
 * The three masks of a face as one RGBA image — red skin, green teeth, blue
 * eyes — from the 478 landmarks in picture pixels, scaled to MASK_SIDE on the
 * picture's long side and blurred a little before they are used.
 */
export function maskOf(points, width, height) {
  const scale = MASK_SIDE / Math.max(width, height);
  const wide = Math.max(8, Math.round(width * scale));
  const tall = Math.max(8, Math.round(height * scale));
  const canvas = Object.assign(document.createElement('canvas'), { width: wide, height: tall });
  const pen = canvas.getContext('2d', { willReadFrequently: true });
  if (!pen) return null;
  // Skin: the face oval, less the eyes, the brows and the lips.
  pen.fillStyle = 'rgb(255, 0, 0)';
  if (polygon(pen, points, MESH.faceOval, scale)) pen.fill();
  pen.globalCompositeOperation = 'destination-out';
  const holes = [MESH.leftEye, MESH.rightEye, MESH.leftBrow, MESH.rightBrow, MESH.lipsOuter];
  for (const group of holes) if (polygon(pen, points, group, scale)) pen.fill();
  // Teeth: the inner lips. Eyes: the two eye contours.
  pen.fillStyle = 'rgb(0, 255, 0)';
  pen.globalCompositeOperation = 'lighter';
  if (polygon(pen, points, MESH.lipsInner, scale)) pen.fill();
  pen.fillStyle = 'rgb(0, 0, 255)';
  for (const group of [MESH.leftEye, MESH.rightEye]) {
    if (polygon(pen, points, group, scale)) pen.fill();
  }
  const drawn = new Uint8Array(pen.getImageData(0, 0, wide, tall).data);
  const pixels = blurMask(drawn, wide, tall, 3);
  for (let at = 3; at < pixels.length; at += 4) pixels[at] = 255;
  return new ImageData(new Uint8ClampedArray(pixels), wide, tall);
}

/**
 * The retouch itself. `uTexel` is one tap in the picture's own uv, so the blur is
 * the same width at preview size and in the export, and `uUvOrigin`/`uUvScale`
 * say which window of the picture a draw covers, as the pipeline's passes do.
 */
export const SKIN_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uSource, uMask;
uniform vec2 uUvOrigin, uUvScale, uTexel;
uniform float uSmooth, uTeeth, uBright;

in vec2 vUv;
out vec4 outColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float CLOSE = 0.075;
const vec2 OFFSETS[12] = vec2[12](
  vec2(-1.0, 0.0), vec2(1.0, 0.0), vec2(0.0, -1.0), vec2(0.0, 1.0),
  vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0),
  vec2(-2.0, 0.0), vec2(2.0, 0.0), vec2(0.0, -2.0), vec2(0.0, 2.0));
const float PLACES[12] = float[12](1.0, 1.0, 1.0, 1.0, 0.7, 0.7, 0.7, 0.7, 0.5, 0.5, 0.5, 0.5);

/** One tap: the colour it carries, and the weight its luma and place give it. */
vec4 tap(vec2 uv, vec2 place, float luma) {
  vec3 c = texture(uSource, uv + place * uTexel).rgb;
  float away = (dot(c, LUMA) - luma) / CLOSE;
  return vec4(c, place * exp(-away * away));
}

void main() {
  // Same rule as the pipeline's passes: only the triangle's first unit is drawn.
  if (vUv.x > 1.0 || vUv.y > 1.0) discard;
  vec2 uv = uUvOrigin + vUv * uUvScale;
  vec3 centre = texture(uSource, uv).rgb;
  float luma = dot(centre, LUMA);
  vec4 mask = texture(uMask, uv);

  // The thirteen: like keeps the edges, plain measures the neighbourhood.
  vec3 like = centre * 1.2;
  vec3 plain = centre * 1.2;
  float kept = 1.2;
  float placed = 1.2;
  for (int k = 0; k < 12; k++) {
    vec4 down = tap(uv, OFFSETS[k], luma);
    like += down.rgb * down.a;
    plain += down.rgb * PLACES[k];
    kept += down.a;
    placed += PLACES[k];
  }
  vec3 colour = mix(centre, like / kept, uSmooth * mask.r);

  // Teeth: bright and nearly grey pixels give up colour and gain light.
  float hi = max(max(colour.r, colour.g), colour.b);
  float lo = min(min(colour.r, colour.g), colour.b);
  float grey = hi > 0.0 ? (hi - lo) / hi : 0.0;
  float value = dot(colour, LUMA);
  float tooth = mask.g * uTeeth * smoothstep(0.5, 0.82, value)
    * (1.0 - smoothstep(0.10, 0.35, grey));
  colour = mix(colour, mix(vec3(value), vec3(1.0), 0.35), tooth);

  // Eyes: a little exposure, and the contrast between a pixel and its edges.
  float eye = mask.b * uBright;
  colour = colour * (1.0 + 0.16 * eye) + (colour - plain / placed) * 0.6 * eye;

  outColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;

/** The retouch over one context: its program, the mask texture, and one draw. */
export function createSkinPass(gl) {
  const linked = program(gl, VERTEX_SHADER, SKIN_FRAGMENT_SHADER);
  if (!linked) return null;
  const u = uniforms(gl, linked, ['uSource', 'uMask', 'uUvOrigin', 'uUvScale',
    'uTexel', 'uRect', 'uSmooth', 'uTeeth', 'uBright']);
  const texture = gl.createTexture();
  const pass = {
    /** False until a mask has been drawn from a face's landmarks. */
    ready: false,

    /** The one mask texture: red skin, green teeth, blue eyes. */
    set(image) {
      if (!image) return false;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
      edge(gl, texture);
      pass.ready = true;
      return true;
    },

    /**
     * One draw into whatever is bound: `source` retouched by `dials`, each 0 to
     * 1, over the window `origin`/`scale` of the picture `size` describes.
     */
    paint(source, origin, scale, size, dials) {
      const step = stepPixels(size[0], size[1]);
      gl.useProgram(linked);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source);
      gl.uniform1i(u.uSource, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(u.uMask, 1);
      gl.uniform2f(u.uUvOrigin, origin[0], origin[1]);
      gl.uniform2f(u.uUvScale, scale[0], scale[1]);
      gl.uniform2f(u.uTexel, step / size[0], step / size[1]);
      gl.uniform4f(u.uRect, 0, 0, 1, 1);
      gl.uniform1f(u.uSmooth, dials.smooth);
      gl.uniform1f(u.uTeeth, dials.teeth);
      gl.uniform1f(u.uBright, dials.bright);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
  return pass;
}
