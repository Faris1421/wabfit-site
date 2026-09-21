/**
 * Wab Fit — the background tool's picture work: a canvas, and nothing else.
 *
 *   personAt  the segmenter's small mask read up through the picture's own light
 *             (`mask-math.js`), as an RGBA image whose alpha is the person — which
 *             is what `destination-in` cuts a picture with.
 *
 *   compose   that person, drawn from the picture itself so they are never
 *             softened with the room, over the ground the choice asks for: a
 *             blurred copy of the picture, a flat colour, nothing at all, or a
 *             second photo covering the frame — scaled by the larger ratio and
 *             centred, never stretched.
 *
 * `blurred` is the same two-pass blur the retouch is built on. Nothing here knows
 * what a control is: a caller asks for a size and gets a canvas at it.
 */

import { blurMask } from './gl/skin.js';
import { guided, luminance } from './mask-math.js';

/** A canvas off the document, of the size asked for. */
const sheet = (width, height) => Object.assign(document.createElement('canvas'), { width, height });

/** The person's own alpha at `size`, as an image the cutter reads. */
export function personAt(picture, size, found) {
  const flat = sheet(size.width, size.height);
  const pen = flat.getContext('2d', { willReadFrequently: true });
  if (!pen) return null;
  pen.drawImage(picture, 0, 0, size.width, size.height);
  const data = pen.getImageData(0, 0, size.width, size.height).data;
  const lum = luminance(data, size.width, size.height);
  const alpha = guided(found, lum, size.width, size.height);
  const canvas = sheet(size.width, size.height);
  const out = canvas.getContext('2d');
  if (!out) return null;
  out.putImageData(new ImageData(alpha, size.width, size.height), 0, 0);
  return canvas;
}

/** The picture blurred by the two-pass blur the retouch is built on, at `size`. */
export function blurred(picture, radius, size) {
  const canvas = sheet(size.width, size.height);
  const pen = canvas.getContext('2d', { willReadFrequently: true });
  if (!pen) return null;
  pen.drawImage(picture, 0, 0, size.width, size.height);
  const image = pen.getImageData(0, 0, size.width, size.height);
  const soft = blurMask(new Uint8Array(image.data), size.width, size.height, Math.max(1, radius));
  pen.putImageData(new ImageData(new Uint8ClampedArray(soft), size.width, size.height), 0, 0);
  return canvas;
}

/** One composite at `size`: the picture's person over the ground it asks for. */
export function compose(picture, person, ground, size) {
  const out = sheet(size.width, size.height);
  const pen = out.getContext('2d');
  if (!pen) return null;
  if (ground.kind === 'blur') pen.drawImage(blurred(picture, ground.radius, size), 0, 0);
  if (ground.kind === 'color') {
    pen.fillStyle = ground.color;
    pen.fillRect(0, 0, size.width, size.height);
  }
  if (ground.kind === 'photo' && ground.photo) {
    const scale = Math.max(size.width / ground.photo.width, size.height / ground.photo.height);
    const wide = ground.photo.width * scale;
    const tall = ground.photo.height * scale;
    pen.drawImage(ground.photo, (size.width - wide) / 2, (size.height - tall) / 2, wide, tall);
  }
  const layer = sheet(size.width, size.height);
  const over = layer.getContext('2d');
  if (!over) return null;
  over.drawImage(picture, 0, 0, size.width, size.height);
  over.globalCompositeOperation = 'destination-in';
  over.drawImage(person, 0, 0, size.width, size.height);
  pen.drawImage(layer, 0, 0);
  return out;
}
