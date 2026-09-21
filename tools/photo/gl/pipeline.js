/**
 * Wab Fit — the pixels.
 *
 * One WebGL2 context, one source texture, one adjusted picture, two draws. The
 * source is the BAKED bitmap and is never written to; everything the controls
 * do lives in the parameters, so an adjustment is undoable without a pixel
 * moving.
 *
 *   const paint = createPipeline(canvas);
 *   paint.setSource(ctx.baked);
 *   paint.render(ctx.params, { width, height, zoom: 2 });
 *   const blob = await paint.renderToBlob(ctx.params, 'image/jpeg', 0.92);
 *
 * Pass one is the thirteen adjustments, run only when a number MOVED, because
 * panning and zooming reuse the picture already in the offscreen texture. Pass
 * two is the unsharp mask, drawn to the canvas for the preview or to a
 * framebuffer for the export. A lost context is the browser asking for its
 * memory back rather than an error, and everything here is made again on the
 * way back. Without WebGL2 the page says so in the person's language, the app
 * is told {type:'error', code:'webgl'}, and createPipeline answers null.
 */

import { KEYS, clampParams } from '../params.js';
import {
  bindTarget, clipRect, edge, imageOf, program, report, sizeCanvas, uniforms, viewportOf,
} from './gpu.js';
import { ADJUST_FRAGMENT_SHADER, SHARPEN_FRAGMENT_SHADER, VERTEX_SHADER } from './shaders.js';

/** The longest side the exporter hands one GPU texture before it tiles. */
export const MAX_TILE = 4096;

/** `exposure` is carried by `uExposure`, and so on for the other eleven. */
const uniformName = (key) => `u${key[0].toUpperCase()}${key.slice(1)}`;

/** Every adjustment but the sharpening, whose home is the second pass. */
const ADJUST_KEYS = KEYS.filter((name) => name !== 'sharpen');

/** What each pass declares: the samplers and uv windows, then its own numbers. */
const ADJUST_UNIFORMS = [
  'uSource', 'uUvOrigin', 'uUvScale', 'uImageSize', 'uRect', ...ADJUST_KEYS.map(uniformName),
];
const SHARPEN_UNIFORMS = ['uSource', 'uUvOrigin', 'uUvScale', 'uTexel', 'uSharpen', 'uRect'];

/** The pipeline over `canvas`, or null when WebGL2 is not there to be had. */
export function createPipeline(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) {
    report(canvas, 'webgl');
    return null;
  }

  const adjustPass = { program: null, u: null };
  const sharpenPass = { program: null, u: null };
  /** The source, the adjusted picture, and the exporter's own target. */
  const source = { texture: null, bitmap: null, width: 0, height: 0 };
  const work = { texture: null, frame: null, width: 0, height: 0 };
  const tile = { texture: null, frame: null, width: 0, height: 0 };
  let vao = null;
  let key = '';
  let lost = false;

  if (!tune() || !own()) {
    report(canvas, 'webgl');
    return null;
  }

  /** Memory is asked for, not lost for good: nothing is made again by hand. */
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
    key = '';
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    key = '';
    if (!tune() || !own()) report(canvas, 'webgl');
    else if (source.bitmap) setSource(source.bitmap);
  });

  return { setSource, render, renderToBlob };

  /** Build or rebuild both passes and the empty vertex array the draws use. */
  function tune() {
    adjustPass.program = program(gl, VERTEX_SHADER, ADJUST_FRAGMENT_SHADER);
    sharpenPass.program = program(gl, VERTEX_SHADER, SHARPEN_FRAGMENT_SHADER);
    if (!adjustPass.program || !sharpenPass.program) return false;
    adjustPass.u = uniforms(gl, adjustPass.program, ADJUST_UNIFORMS);
    sharpenPass.u = uniforms(gl, sharpenPass.program, SHARPEN_UNIFORMS);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    return true;
  }

  /** The textures and framebuffers this pipeline owns, made once per context. */
  function own() {
    for (const target of [source, work, tile]) {
      target.texture = gl.createTexture();
      target.frame = gl.createFramebuffer();
      target.width = 0;
      target.height = 0;
    }
    return gl.getError() === gl.NO_ERROR;
  }

  /**
   * A bitmap — the original, or the baked one after a destructive step —
   * uploaded once per bake with its rows the right way up for the draws.
   */
  function setSource(bitmap) {
    if (!bitmap || !bitmap.width || !bitmap.height) return;
    source.bitmap = bitmap;
    source.width = bitmap.width;
    source.height = bitmap.height;
    gl.bindTexture(gl.TEXTURE_2D, source.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    edge(gl, source.texture);
    key = '';
  }

  /** The preview, drawn now, with the zoom and the pan the gesture left behind. */
  function render(params, viewport) {
    if (lost || !source.bitmap) return;
    const p = clampParams(params);
    const view = viewportOf(viewport);
    sizeCanvas(canvas, view);
    adjusted(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawSharpen(p.sharpen, work.texture, [1 / source.width, 1 / source.height],
      [0, 0], [1, 1], clipRect(view, source.width, source.height));
  }

  /** Pass one, run only when its numbers moved: the picture is kept otherwise. */
  function adjusted(p) {
    const stamp = `${source.width}x${source.height}|${ADJUST_KEYS.map((k) => p[k]).join(',')}`;
    if (stamp === key && work.width === source.width && work.height === source.height) return;
    key = stamp;
    bindTarget(gl, work, source.width, source.height);
    drawAdjust(p, [0, 0], [1, 1]);
  }

  /** The export at the picture's own size, in tiles, as a Promise of a Blob. */
  async function renderToBlob(params, type = 'image/jpeg', quality = 0.92) {
    if (lost || !source.bitmap) return null;
    const p = clampParams(params);
    const width = source.width;
    const height = source.height;
    const limit = Math.max(256, Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), MAX_TILE));
    const sheet = document.createElement('canvas');
    sheet.width = width;
    sheet.height = height;
    const into = sheet.getContext('2d');
    for (let y = 0; y < height; y += limit) {
      for (let x = 0; x < width; x += limit) {
        const wide = Math.min(limit, width - x);
        const tall = Math.min(limit, height - y);
        into.putImageData(imageOf(band(p, x, y, wide, tall), wide, tall), x, y);
      }
    }
    return new Promise((resolve) => sheet.toBlob((blob) => resolve(blob), type, quality));
  }

  /** One tile through both passes, two pixels wider so the mask has neighbours. */
  function band(p, x, y, wide, tall) {
    const left = Math.max(0, x - 2);
    const top = Math.max(0, y - 2);
    const right = Math.min(source.width, x + wide + 2);
    const bottom = Math.min(source.height, y + tall + 2);
    const marginW = right - left;
    const marginH = bottom - top;
    bindTarget(gl, work, marginW, marginH);
    drawAdjust(p, [left / source.width, top / source.height],
      [marginW / source.width, marginH / source.height]);
    bindTarget(gl, tile, wide, tall);
    drawSharpen(p.sharpen, work.texture, [1 / marginW, 1 / marginH],
      [(x - left) / marginW, (y - top) / marginH], [wide / marginW, tall / marginH], [0, 0, 1, 1]);
    const pixels = new Uint8Array(wide * tall * 4);
    gl.readPixels(0, 0, wide, tall, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  /** Pass one into whatever is bound: the thirteen numbers and the uv window. */
  function drawAdjust(p, uvOrigin, uvScale) {
    gl.useProgram(adjustPass.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.texture);
    gl.uniform1i(adjustPass.u.uSource, 0);
    gl.uniform2f(adjustPass.u.uUvOrigin, uvOrigin[0], uvOrigin[1]);
    gl.uniform2f(adjustPass.u.uUvScale, uvScale[0], uvScale[1]);
    gl.uniform2f(adjustPass.u.uImageSize, source.width, source.height);
    gl.uniform4f(adjustPass.u.uRect, 0, 0, 1, 1);
    for (const name of ADJUST_KEYS) gl.uniform1f(adjustPass.u[uniformName(name)], p[name]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Pass two into whatever is bound, reading `texture` one picture pixel apart. */
  function drawSharpen(sharpen, texture, texel, uvOrigin, uvScale, clip) {
    gl.useProgram(sharpenPass.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(sharpenPass.u.uSource, 0);
    gl.uniform2f(sharpenPass.u.uUvOrigin, uvOrigin[0], uvOrigin[1]);
    gl.uniform2f(sharpenPass.u.uUvScale, uvScale[0], uvScale[1]);
    gl.uniform2f(sharpenPass.u.uTexel, texel[0], texel[1]);
    gl.uniform1f(sharpenPass.u.uSharpen, sharpen);
    gl.uniform4f(sharpenPass.u.uRect, clip[0], clip[1], clip[2], clip[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

