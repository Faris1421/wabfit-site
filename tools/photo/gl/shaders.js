/**
 * Wab Fit — the three drawings the pipeline runs.
 *
 * GLSL ES 3.00 source, as strings, because a WebGL program is built by handing
 * the driver text and there is nothing to import. The strings are the only
 * place in the editor where a pixel is described, so the order of the maths in
 * `ADJUST_FRAGMENT_SHADER` is the order the controls are laid out in, and the
 * comments name the control each step belongs to.
 *
 * VERTEX — one triangle, no buffers. Three vertices at (0,0), (2,0), (0,2) in
 * UV space cover the whole clip square with one draw call, which is what makes
 * `drawArrays(TRIANGLES, 0, 3)` the only drawing the editor ever does. The
 * uniform `uRect` moves those three vertices: at its neutral position the
 * triangle fills the target, and a half-extent below 1 shrinks it to the
 * rectangle the photo occupies on screen.
 *
 * ADJUST — the thirteen adjustments, applied IN LINEAR LIGHT: the sRGB sample
 * is decoded on the first line and encoded on the last, so every operation in
 * between adds, scales and blends light rather than bytes. The second uniform
 * pair, `uUvOrigin`/`uUvScale`, says which part of the picture this draw is
 * covering, so the vignette and the grain stay pinned to the picture when the
 * exporter splits it into tiles.
 *
 * SHARPEN — the unsharp mask, a second pass because it reads neighbours. It
 * decodes the five samples, adds back a scaled difference between the pixel and
 * the average of the four around it, and encodes the answer.
 *
 * Nothing here reads a clock or a random number: the grain is a hash of the
 * pixel's position, so the same parameters draw the same picture every time and
 * an export matches the preview it was tuned on.
 */

/**
 * The fullscreen triangle. `uRect` holds the centre and the half-extents of the
 * picture on screen, in clip space: (0, 0, 1, 1) fills the target exactly.
 */
export const VERTEX_SHADER = `#version 300 es
precision highp float;

uniform vec4 uRect;

out vec2 vUv;

void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4((corner * 2.0 - 1.0) * uRect.zw + uRect.xy, 0.0, 1.0);
}
`;

/**
 * Pass one — the thirteen adjustments, in the order the controls appear, in
 * linear light. `uExposure` and the rest carry the slider's own number, -100 to
 * 100, and this is the only place that decides what a hundred means.
 */
export const ADJUST_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uSource;
uniform vec2 uUvOrigin;
uniform vec2 uUvScale;
uniform vec2 uImageSize;
uniform float uExposure;
uniform float uBrightness;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uSaturation;
uniform float uVibrance;
uniform float uTemperature;
uniform float uTint;
uniform float uFade;
uniform float uVignette;
uniform float uGrain;

in vec2 vUv;
out vec4 outColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 toLinear(vec3 c) {
  vec3 s = step(vec3(0.04045), c);
  return mix(c / 12.92, pow(max((c + 0.055) / 1.055, 0.0), vec3(2.4)), s);
}

vec3 toSrgb(vec3 c) {
  vec3 x = max(c, 0.0);
  return mix(x * 12.92, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), x));
}

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  // The triangle runs to 2; only its first unit is the picture, and a fitted
  // picture is smaller than the target, so the rest must leave no pixel behind.
  if (vUv.x > 1.0 || vUv.y > 1.0) discard;
  vec2 uv = uUvOrigin + vUv * uUvScale;
  vec3 c = toLinear(texture(uSource, uv).rgb);

  // Exposure: a stop every fifty, so 100 is two stops either way.
  c *= exp2(uExposure / 50.0);

  // Temperature pushes red and blue apart; tint moves green on its own.
  c.r *= 1.0 + uTemperature / 100.0 * 0.25;
  c.b *= 1.0 - uTemperature / 100.0 * 0.25;
  c.g *= 1.0 + uTint / 100.0 * 0.25;

  // Brightness adds light; contrast opens around the 0.18 middle grey.
  c += uBrightness / 100.0 * 0.25;
  c = 0.18 + (c - 0.18) * (1.0 + uContrast / 100.0);

  // Highlights and shadows, each on its own half of the luminance range.
  float luma = dot(max(c, 0.0), LUMA);
  c += smoothstep(0.5, 1.0, luma) * (uHighlights / 100.0) * 0.2;
  c += (1.0 - smoothstep(0.0, 0.5, luma)) * (uShadows / 100.0) * 0.2;

  // Saturation blends against grey; vibrance does it in proportion to how
  // saturated the pixel already is, so a quiet colour moves further.
  float grey = dot(max(c, 0.0), LUMA);
  c = mix(vec3(grey), c, 1.0 + uSaturation / 100.0);

  float high = max(max(c.r, c.g), c.b);
  float low = min(min(c.r, c.g), c.b);
  float sat = high > 0.0 ? (high - low) / high : 0.0;
  grey = dot(max(c, 0.0), LUMA);
  c = mix(vec3(grey), c, 1.0 + (uVibrance / 100.0) * (1.0 - sat));

  // Fade lifts the blacks toward 0.08 and gives up a little of the slope.
  float fade = uFade / 100.0;
  c = c * (1.0 - 0.12 * fade) + 0.08 * fade;

  // Vignette darkens from 0.55 of the half-diagonal outward.
  vec2 away = uv - 0.5;
  float aspect = uImageSize.x / max(uImageSize.y, 1.0);
  away.x *= aspect;
  float radius = length(away) / length(vec2(0.5 * aspect, 0.5));
  c *= 1.0 - (uVignette / 100.0) * smoothstep(0.55, 1.0, radius);

  // Grain: the same noise for the same pixel, added to all three channels.
  c += (hash(uv * uImageSize) - 0.5) * (uGrain / 100.0) * 0.06;

  outColor = vec4(toSrgb(c), 1.0);
}
`;

/**
 * Pass two — the unsharp mask. Five samples: the pixel and the four around it,
 * one picture pixel apart whatever the tile or the zoom. Back at 1 the answer
 * is the pixel itself, so a photo with no sharpening drawn through this pass
 * comes out exactly as it went in.
 */
export const SHARPEN_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uSource;
uniform vec2 uUvOrigin;
uniform vec2 uUvScale;
uniform vec2 uTexel;
uniform float uSharpen;

in vec2 vUv;
out vec4 outColor;

vec3 toLinear(vec3 c) {
  vec3 s = step(vec3(0.04045), c);
  return mix(c / 12.92, pow(max((c + 0.055) / 1.055, 0.0), vec3(2.4)), s);
}

vec3 toSrgb(vec3 c) {
  vec3 x = max(c, 0.0);
  return mix(x * 12.92, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), x));
}

void main() {
  // Same rule as pass one: the triangle's first unit is the picture.
  if (vUv.x > 1.0 || vUv.y > 1.0) discard;
  vec2 uv = uUvOrigin + vUv * uUvScale;
  vec3 centre = toLinear(texture(uSource, uv).rgb);
  vec3 around = toLinear(texture(uSource, uv + vec2(uTexel.x, 0.0)).rgb)
    + toLinear(texture(uSource, uv - vec2(uTexel.x, 0.0)).rgb)
    + toLinear(texture(uSource, uv + vec2(0.0, uTexel.y)).rgb)
    + toLinear(texture(uSource, uv - vec2(0.0, uTexel.y)).rgb);
  vec3 sharp = centre + (centre - around * 0.25) * (uSharpen / 100.0) * 1.5;
  outColor = vec4(toSrgb(sharp), 1.0);
}
`;
