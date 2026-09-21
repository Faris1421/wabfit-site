/**
 * Wab Fit — how a photo gets in.
 *
 * Two doors, and they meet in the same place:
 *
 *   · in a browser, the person picks a file with the system picker;
 *   · inside the app, the WebView posts {type:'open', name, base64} and the
 *     bytes arrive already read.
 *
 * Either way the photo is decoded ONCE, with its EXIF orientation honoured, and
 * is downscaled only when its longer side is past 4096 px. That number is not
 * decoration: it is the size the pipeline and the tiled export are built around,
 * and a phone that holds a 12000 px camera file and its working copy at the same
 * time runs out of memory before it draws anything.
 *
 * A new photo is a RESET, not an edit: the parameters go back to neutral, the
 * trail starts again, and whatever was open before it is gone. This is the one
 * place a trail is REPLACED rather than pushed to — nothing in the editor may
 * hold on to `ctx.history` across it.
 */

import { bytesFromBase64, onMessage, sendError } from './bridge.js';
import { createHistory } from './history.js';
import { neutralParams, stateOf } from './ctx.js';

/** The longer side a photo is kept at, in pixels. */
export const MAX_SIDE = 4096;

/** Wire the picker and the app's 'open' message to the same decode. */
export function init(ctx) {
  const input = document.getElementById('fileInput');
  const openBtn = document.getElementById('openBtn');

  if (openBtn && input) openBtn.addEventListener('click', () => input.click());

  if (input) {
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      const name = typeof file.name === 'string' ? file.name : '';
      openBlob(ctx, name, file).catch(() => fail(ctx));
    });
  }

  onMessage((message) => {
    if (message.type !== 'open' || typeof message.base64 !== 'string') return;
    const name = typeof message.name === 'string' ? message.name : '';
    let bytes;
    try {
      bytes = bytesFromBase64(message.base64);
    } catch {
      fail(ctx);
      return;
    }
    openBlob(ctx, name, new Blob([bytes])).catch(() => fail(ctx));
  });
}

/** A photo that will not open: one line on the page, one code to the app. */
function fail(ctx) {
  sendError('open-failed');
  note(ctx.t('errOpen'));
}

/** The one line, in the stage the photo would have filled, and its way back out. */
function note(text) {
  const stage = document.getElementById('stage');
  if (!stage) return;
  const old = stage.querySelector('p.view-error');
  if (!text) {
    if (old) old.remove();
    return;
  }
  const line = old || document.createElement('p');
  line.className = 'view-error';
  line.setAttribute('role', 'alert');
  line.textContent = text;
  stage.append(line);
}

/** Decode `blob`, keep it within MAX_SIDE, and make it the open photo. */
export async function openBlob(ctx, name, blob) {
  const decoded = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  adopt(ctx, name, await fit(decoded));
}

/**
 * The photo as the editor holds it: itself when it already fits, and a high
 * quality reduction of it when it does not. The decoded original is released as
 * soon as the smaller copy exists — on a phone that is the difference between
 * one 4096 px bitmap in memory and two.
 */
export async function fit(bitmap) {
  const longer = Math.max(bitmap.width, bitmap.height);
  if (longer <= MAX_SIDE) return bitmap;

  const scale = MAX_SIDE / longer;
  const resized = await createImageBitmap(bitmap, {
    resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
    resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
    resizeQuality: 'high',
  });
  bitmap.close();
  return resized;
}

/**
 * A photo is open. `image` and `baked` are the same bitmap — nothing has been
 * cropped, erased or retouched yet — the adjustments are neutral, and the trail
 * holds exactly one state, so there is nothing to undo.
 */
function adopt(ctx, name, bitmap) {
  note('');
  const params = neutralParams();
  ctx.image = bitmap;
  ctx.baked = bitmap;
  ctx.params = params;
  ctx.history = createHistory(stateOf(params, bitmap, ''));
  ctx.dirty = false;
  ctx.emit('image', { name, bitmap });
  ctx.emit('baked', bitmap);
  ctx.emit('params', params);
  ctx.emit('history');
}
