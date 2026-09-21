/**
 * Wab Fit — a picture on a page.
 *
 * The image tool puts a photograph, a screenshot or a logo onto a page. A tap
 * asks for a file — the picker is a real input in the page, because a WebView
 * only opens one that is there — and the picture lands with its middle on the
 * point that was tapped, sixty per cent of the page's width across.
 *
 * What is stored is never the original: the file is drawn onto a canvas, scaled
 * so its longer side is at most MAX_SIDE, and written back out as a PNG. A
 * twelve-megapixel photograph kept whole would sit in every undo state and
 * inside every export.
 *
 * A picture keeps its shape for all of its life: overlay-geometry.js locks the
 * aspect of an image by its handles, so moving and resizing it afterwards can
 * never stretch it.
 */

import { newId } from './core.js';
import { pageBox } from './viewer.js';
import { registerTool } from './overlay.js';

/** The longer side of what is stored, in pixels: more is memory spent on nothing. */
const MAX_SIDE = 2000;
/** How much of a page's width a picture takes when it lands. */
const WIDTH_OF_PAGE = 0.6;

let ctx = null;
let input = null;
/** Where the next picture goes, or null while no file is being picked. */
let waiting = null;

/* ── the file ────────────────────────────────────────────────────────────── */

/** A tap asks for a file; where it landed is kept for when the file arrives. */
function ask(pt, page) {
  if (!ctx.doc.pages[page]) return;
  waiting = { page, pt: { x: pt.x, y: pt.y } };
  input.click();
}

/** The picked file as an image the canvas can draw, whatever its own format. */
function load(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = document.createElement('img');
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable image'));
    };
    image.src = url;
  });
}

/** The picture at no more than MAX_SIDE on its longer side, as a PNG. */
function shrink(image) {
  const longest = Math.max(image.naturalWidth, image.naturalHeight) || 1;
  const step = Math.min(1, MAX_SIDE / longest);
  const w = Math.max(1, Math.round(image.naturalWidth * step));
  const h = Math.max(1, Math.round(image.naturalHeight * step));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(image, 0, 0, w, h);
  return { png: canvas.toDataURL('image/png'), w, h };
}

/* ── the page ────────────────────────────────────────────────────────────── */

/** A hundredth of a point is as fine as a picture's box needs to be. */
function round(value) {
  return Math.round(value * 100) / 100;
}

/** Kept on the page: a picture landing at an edge is pushed back inside it. */
function inside(value, size, span) {
  return round(Math.min(Math.max(0, value), Math.max(0, size - span)));
}

/** The model's own object: a picture WIDTH_OF_PAGE of the page wide, on `pt`. */
function picture(page, pt, image) {
  const box = pageBox(page);
  if (!box) return null;
  const pageWidth = box.width / box.scale;
  const pageHeight = box.height / box.scale;
  const w = pageWidth * WIDTH_OF_PAGE;
  const h = w * (image.h / image.w);
  return {
    kind: 'image',
    id: newId(),
    page,
    x: inside(pt.x - w / 2, pageWidth, w),
    y: inside(pt.y - h / 2, pageHeight, h),
    w: round(w),
    h: round(h),
    pngBase64: image.png,
  };
}

/** The file is here: shrunk, put onto the page, and picked so it can be moved. */
async function place(file) {
  const at = waiting;
  waiting = null;
  if (!at) return;
  const mark = picture(at.page, at.pt, shrink(await load(file)));
  if (!mark) return;
  ctx.commit({ pages: ctx.doc.pages, objects: ctx.doc.objects.concat([mark]) });
  ctx.select(mark.id);
  ctx.setTool('select');
}

/* ── boot ────────────────────────────────────────────────────────────────── */

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(context) {
  ctx = context;
  input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  // In the page and out of sight: a WebView only opens a picker that is really
  // there, so this is moved off screen rather than hidden with `display: none`.
  input.setAttribute('aria-hidden', 'true');
  input.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (file) place(file).catch(() => { waiting = null; });
  });
  document.body.append(input);
  registerTool('image', { onDown: ask });
  // Another document has other pages, so a point remembered from the old one is
  // not a place this picture can land.
  ctx.on('open', () => { waiting = null; });
  return ctx;
}

