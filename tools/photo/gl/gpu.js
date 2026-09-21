/**
 * Wab Fit — the plumbing the pipeline stands on.
 *
 * WebGL2 holds no objects: a program, a texture and a framebuffer are numbers,
 * and everything about them lives in the calls that made them. This file is
 * where those calls are written once, so `pipeline.js` reads as the picture
 * being drawn rather than as bookkeeping.
 *
 * Three groups, and nothing else:
 *
 *   · the context's own objects — a linked program from two shader strings, the
 *     uniform locations of a program by name, and the texture edges;
 *   · the drawing frame — binding a target and giving its storage the size it
 *     must have, and turning a read-back into something a 2D canvas can take;
 *   · where the picture sits — the viewport in whole pixels, the canvas at the
 *     device's ratio, and the rectangle the photo occupies on it.
 *
 * A uniform that the driver dropped answers a null location rather than an
 * error, and `uniform1f(null, x)` moves nothing: a shader and a table that
 * disagree therefore fail as a picture that did not change, not as a crash.
 */

import { sendError } from '../bridge.js';
import { t } from '../i18n.js';

/** A finite number, or the fallback when the caller did not give one. */
export function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/** The device's pixel ratio, always a usable number of device pixels. */
export function pixelRatio() {
  const ratio = typeof window === 'object' && window ? window.devicePixelRatio : 1;
  return finite(ratio, 1) > 0 ? ratio : 1;
}

/** One linked program from two sources, or null when the driver says no. */
export function program(gl, vertexSource, fragmentSource) {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const linked = gl.createProgram();
  gl.attachShader(linked, vertex);
  gl.attachShader(linked, fragment);
  gl.linkProgram(linked);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  return gl.getProgramParameter(linked, gl.LINK_STATUS) ? linked : null;
}

/** One shader, or null when it will not compile on this driver. */
function compile(gl, kind, source) {
  const shader = gl.createShader(kind);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/** A program's uniforms by name, for the shader that declares them. */
export function uniforms(gl, linked, names) {
  const table = {};
  for (const name of names) table[name] = gl.getUniformLocation(linked, name);
  return table;
}

/** A picture texture: filtered smoothly and clamped at every edge. */
export function edge(gl, texture) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

/**
 * Aim the next draw at `target`, giving its storage the size it must have, and
 * clear it. The size is only re-made when it changed, so panning and zooming
 * never pay for a new texture.
 */
export function bindTarget(gl, target, width, height) {
  if (target.width !== width || target.height !== height) {
    target.width = width;
    target.height = height;
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    edge(gl, target.texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.frame);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.frame);
  }
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

/** Read-back rows arrive bottom row first; a 2D canvas wants them top down. */
export function imageOf(pixels, width, height) {
  const image = new ImageData(width, height);
  const stride = width * 4;
  for (let y = 0; y < height; y += 1) {
    const from = (height - 1 - y) * stride;
    image.data.set(pixels.subarray(from, from + stride), y * stride);
  }
  return image;
}

/** No WebGL2: say so on the page and tell the app, without a second notice. */
export function report(canvas, code) {
  sendError(code);
  const stage = canvas.parentElement;
  if (!stage) return;
  const note = stage.querySelector('p.view-error') || document.createElement('p');
  note.className = 'view-error';
  note.setAttribute('role', 'alert');
  note.textContent = t('errWebgl');
  stage.append(note);
}

/** The canvas area in whole CSS pixels, with a usable zoom and pan whatever came. */
export function viewportOf(viewport) {
  const view = viewport || {};
  return {
    width: Math.max(1, Math.round(finite(view.width, 1))),
    height: Math.max(1, Math.round(finite(view.height, 1))),
    zoom: Math.max(0.05, finite(view.zoom, 1)),
    panX: finite(view.panX, 0),
    panY: finite(view.panY, 0),
  };
}

/** The canvas covers the whole viewport, at the device's own pixel ratio. */
export function sizeCanvas(canvas, view) {
  const ratio = pixelRatio();
  canvas.style.width = `${view.width}px`;
  canvas.style.height = `${view.height}px`;
  const wide = Math.max(1, Math.round(view.width * ratio));
  const tall = Math.max(1, Math.round(view.height * ratio));
  if (canvas.width !== wide) canvas.width = wide;
  if (canvas.height !== tall) canvas.height = tall;
}

/**
 * Where a `width`×`height` picture sits on `view`, in clip space: the centre,
 * and the half-extents of the photo itself. Zoom 1 fits the whole picture
 * inside the viewport; the pan moves it, and nothing is ever cut off by
 * arithmetic here.
 */
export function clipRect(view, width, height) {
  const scale = Math.min(view.width / width, view.height / height) * view.zoom;
  return [
    ((view.width / 2 + view.panX) / view.width) * 2 - 1,
    1 - ((view.height / 2 + view.panY) / view.height) * 2,
    (width * scale) / view.width,
    (height * scale) / view.height,
  ];
}
