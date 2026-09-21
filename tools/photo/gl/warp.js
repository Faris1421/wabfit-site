/**
 * Wab Fit — the mesh warp: a picture's pixels moved by a field, on the GPU.
 *
 * A face dial moves pixels rather than painting them. `face-geometry.js` answers
 * the displacement on a 96-a-side grid, in picture pixels, and this module is
 * the one place that turns that field into a picture: the baked photo goes
 * through the grid in `mesh.js` into a texture, and the retouch in `skin.js`
 * reads that texture and lands in whatever the caller asked for.
 *
 *   const warper = createWarper(canvas);           // the face tool's own canvas
 *   warper.setSource(ctx.baked);
 *   warper.setMask(maskOf(points, w, h));          // skin, teeth and eyes
 *   warper.draw(field, { width, height }, dials);         // one preview frame
 *   const done = await warper.renderWarp(field, dials);   // the whole picture
 *
 * `renderWarp` renders at the picture's own size, in tiles of at most MAX_TILE a
 * side, exactly as the pipeline exports, and answers an ImageBitmap ready for
 * `ctx.bake`. Nothing here knows what a slider is.
 */

import {
  bindTarget, edge, finite, imageOf, report, sizeCanvas,
} from './gpu.js';
import { createMesh } from './mesh.js';
import { createSkinPass, stepPixels } from './skin.js';

/** The longest side one warp target may have before a picture is tiled. */
const MAX_TILE = 4096;

/** The window of a preview: the whole picture, straight into the target. */
const WHOLE = [1, 1, 0, 0];

/** The same window in picture coordinates, which keeps every fragment. */
const ALL = [0, 0, 1, 1];

/**
 * One renderer over `canvas` — the face tool's own canvas — or null when WebGL2
 * is not there to be had, in which case the page says so.
 */
export function createWarper(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false,
  });
  if (!gl) {
    report(canvas, 'webgl');
    return null;
  }
  const source = { texture: null, bitmap: null, width: 0, height: 0 };
  const work = { texture: null, frame: null, width: 0, height: 0 };
  const tile = { texture: null, frame: null, width: 0, height: 0 };
  let mesh = null;
  let skin = null;
  let mask = null;
  let lost = false;

  // A lost context is the browser asking for its memory back rather than an
  // error: everything here is made again on the way forward — the photo and its
  // mask with it, because a texture does not survive the loss.
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    if (!build()) report(canvas, 'webgl');
    else if (source.bitmap) setSource(source.bitmap);
    if (mask && skin) skin.set(mask);
  });

  if (!build()) {
    report(canvas, 'webgl');
    return null;
  }

  return { setSource, setMask, draw, renderWarp };

  /**
   * Both programs, the source texture and the two targets, made once per
   * context. The grid's own buffers belong to `mesh.js`.
   */
  function build() {
    mesh = createMesh(gl);
    skin = createSkinPass(gl);
    if (!mesh || !skin) return false;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    for (const target of [work, tile]) {
      target.texture = gl.createTexture();
      target.frame = gl.createFramebuffer();
      target.width = 0;
      target.height = 0;
    }
    source.texture = gl.createTexture();
    return gl.getError() === gl.NO_ERROR;
  }

  /** A bitmap — the baked photo — uploaded once per destructive step. */
  function setSource(bitmap) {
    if (!bitmap || !bitmap.width || !bitmap.height) return;
    source.bitmap = bitmap;
    source.width = bitmap.width;
    source.height = bitmap.height;
    gl.bindTexture(gl.TEXTURE_2D, source.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    edge(gl, source.texture);
  }

  /** The three masks of one face, drawn from the landmarks the tool detected. */
  function setMask(image) {
    if (!image || !skin) return false;
    mask = image;
    return skin.set(image);
  }

  /** Aim the next draw at the canvas itself, at `wide`×`tall` device pixels. */
  function toCanvas(wide, tall) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, wide, tall);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** One preview frame into the canvas: the picture fitted inside `view`. */
  function draw(field, view, dials) {
    if (lost || !source.bitmap) return;
    const box = view || {};
    sizeCanvas(canvas, {
      width: Math.max(1, Math.round(finite(box.width, source.width))),
      height: Math.max(1, Math.round(finite(box.height, source.height))),
    });
    mesh.setField(field, source.width, source.height);
    bindTarget(gl, work, canvas.width, canvas.height);
    mesh.draw(source.texture, WHOLE, ALL);
    toCanvas(canvas.width, canvas.height);
    skin.paint(work.texture, [0, 0], [1, 1], [source.width, source.height], dials);
  }

  /**
   * The whole picture at its own size, in tiles of at most MAX_TILE a side, as an
   * ImageBitmap ready for `ctx.bake`. A tile warps a margin of the picture around
   * it, because the retouch reads its neighbours, and keeps only the tile itself.
   */
  async function renderWarp(field, dials) {
    if (lost || !source.bitmap) return null;
    const imageW = source.width;
    const imageH = source.height;
    // The band a tile draws is its own size plus a margin of picture around it,
    // so the tile is held back from the context's own ceiling by that margin.
    const room = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) || MAX_TILE, MAX_TILE);
    const pad = Math.ceil(2 * stepPixels(imageW, imageH)) + 2;
    const limit = Math.max(256, room - 2 * pad);
    const sheet = Object.assign(document.createElement('canvas'), { width: imageW, height: imageH });
    const into = sheet.getContext('2d');
    if (!into) return null;
    mesh.setField(field, imageW, imageH);
    for (let y = 0; y < imageH; y += limit) {
      for (let x = 0; x < imageW; x += limit) {
        const wide = Math.min(limit, imageW - x);
        const tall = Math.min(limit, imageH - y);
        const left = Math.max(0, x - pad);
        const top = Math.max(0, y - pad);
        const bandW = Math.min(imageW, x + wide + pad) - left;
        const bandH = Math.min(imageH, y + tall + pad) - top;
        const uv = [left / imageW, top / imageH];
        const span = [bandW / imageW, bandH / imageH];
        bindTarget(gl, work, bandW, bandH);
        mesh.draw(source.texture, windowOf(left, top, bandW, bandH, imageW, imageH), [...uv, ...span]);
        bindTarget(gl, tile, wide, tall);
        skin.paint(work.texture, uv, span, [imageW, imageH], dials);
        const pixels = new Uint8Array(wide * tall * 4);
        gl.readPixels(0, 0, wide, tall, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        into.putImageData(imageOf(pixels, wide, tall), x, y);
      }
    }
    return createImageBitmap(sheet);
  }
}

/** How the whole picture is squeezed into one tile: its scale and its offset. */
function windowOf(x, y, wide, tall, imageW, imageH) {
  return [imageW / wide, imageH / tall, (imageW - 2 * x - wide) / wide,
    1 - imageH / tall + (2 * y) / tall];
}
