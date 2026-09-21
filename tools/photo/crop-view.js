/**
 * Wab Fit — the crop preview: one canvas laid over the stage that draws exactly
 * what Apply will.
 *
 * Kept apart from the tool so each file stays readable: this one knows about
 * canvases and colours, the tool knows about fingers and words. Both call the
 * same crop-math.js, which is what makes "what you see is what you get" true
 * rather than hoped for.
 *
 * THE PICTURE IS DRAWN TURNED, MIRRORED AND TILTED, at `straightenScale` — the
 * zoom that keeps an empty corner out of the frame — and the frame, its eight
 * grips and the rule-of-thirds lines go over it. The two colours are the page's
 * own, read from the theme tokens on the document, so the overlay follows the
 * light and dark palettes without a second copy of them.
 */

import { HANDLES, handlePoints, outputSize, rotatedSize, straightenScale } from './crop-math.js';

/** The preview over `stage`, and the two drawings it can make. */
export function createCropView(stage) {
  const canvas = document.createElement('canvas');
  canvas.className = 'view crop-view';
  canvas.hidden = true;
  if (stage) stage.append(canvas);

  let space = { w: 1, h: 1 };
  let fit = 1;

  /** The turned picture's size, and the canvas the stage holds for it. */
  function size(source, crop) {
    space = rotatedSize(source.width, source.height, crop.rotate90);
    const room = canvas.parentElement;
    const roomW = Math.max(80, (room ? room.clientWidth : 320) - 24);
    const roomH = Math.max(80, (room ? room.clientHeight : 420) - 24);
    const scale = Math.min(roomW / space.w, roomH / space.h);
    const cssW = Math.max(1, Math.round(space.w * scale));
    const cssH = Math.max(1, Math.round(space.h * scale));
    const density = window.devicePixelRatio || 1;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * density);
    canvas.height = Math.round(cssH * density);
    fit = Math.min(cssW / space.w, cssH / space.h);
    return { cssW, cssH, density };
  }

  /** The turned, mirrored and tilted picture into `g`, `zoom` screen pixels each. */
  function paint(g, source, crop, wide, tall, zoom, ratio) {
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, wide, tall);
    g.save();
    g.translate(wide / 2, tall / 2);
    g.rotate((crop.straighten * Math.PI) / 180);
    const scale = straightenScale(space.w, space.h, crop.straighten) * zoom;
    g.scale(scale * (crop.flipH ? -1 : 1), scale * (crop.flipV ? -1 : 1));
    g.rotate((crop.rotate90 * Math.PI) / 2);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(source, -source.width / 2, -source.height / 2);
    g.restore();
  }

  /** The shade outside the frame, the thirds while dragging, the frame and grips. */
  function frame(g, crop, wide, tall, dragging) {
    const colours = getComputedStyle(document.documentElement);
    const accent = colours.getPropertyValue('--accent').trim() || 'currentColor';
    const shade = colours.getPropertyValue('--bg').trim() || accent;
    const r = { x: crop.x * fit, y: crop.y * fit, w: crop.w * fit, h: crop.h * fit };
    g.save();
    g.globalAlpha = 0.55;
    g.fillStyle = shade;
    g.beginPath();
    g.rect(0, 0, wide, tall);
    g.rect(r.x, r.y, r.w, r.h);
    g.fill('evenodd');
    g.globalAlpha = dragging ? 0.5 : 1;
    g.strokeStyle = accent;
    g.lineWidth = 1;
    if (dragging) {
      g.beginPath();
      for (const part of [1 / 3, 2 / 3]) {
        g.moveTo(r.x + r.w * part, r.y);
        g.lineTo(r.x + r.w * part, r.y + r.h);
        g.moveTo(r.x, r.y + r.h * part);
        g.lineTo(r.x + r.w, r.y + r.h * part);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    g.lineWidth = 1.6;
    g.strokeRect(r.x, r.y, r.w, r.h);
    g.fillStyle = accent;
    const grips = handlePoints(crop);
    for (const name of HANDLES) {
      const at = grips[name];
      g.beginPath();
      g.arc(at.x * fit, at.y * fit, 5, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  return {
    canvas,

    /** The canvas is on screen only while the crop tool is. */
    show(on) {
      canvas.hidden = !on;
    },

    /** Screen pixels per picture pixel: what a finger's reach is measured in. */
    fit() {
      return fit;
    },

    /** The picture after its turns: the space the frame's numbers live in. */
    space() {
      return space;
    },

    /** A pointer's place in the picture's own pixels. */
    pointOf(event) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * space.w,
        y: ((event.clientY - rect.top) / rect.height) * space.h,
      };
    },

    /** The whole preview: the picture, then the frame over it. */
    render(source, crop, dragging) {
      const box = size(source, crop);
      const g = canvas.getContext('2d');
      if (!g) return;
      paint(g, source, crop, box.cssW, box.cssH, fit, box.density);
      frame(g, crop, box.cssW, box.cssH, dragging);
    },

    /** The frame at the picture's own resolution, ready for `ctx.bake`. */
    async bitmap(source, crop) {
      space = rotatedSize(source.width, source.height, crop.rotate90);
      const turned = document.createElement('canvas');
      turned.width = space.w;
      turned.height = space.h;
      const g = turned.getContext('2d');
      if (!g) return null;
      paint(g, source, crop, space.w, space.h, 1, 1);
      const result = outputSize(crop);
      const out = document.createElement('canvas');
      out.width = result.width;
      out.height = result.height;
      const into = out.getContext('2d');
      if (!into) return null;
      into.imageSmoothingEnabled = true;
      into.imageSmoothingQuality = 'high';
      into.drawImage(turned, Math.round(crop.x), Math.round(crop.y), result.width, result.height,
        0, 0, result.width, result.height);
      return createImageBitmap(out);
    },
  };
}
