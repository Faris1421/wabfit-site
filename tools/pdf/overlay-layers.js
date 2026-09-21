/**
 * Wab Fit — one overlay per page, kept in step with the viewer.
 *
 * The viewer is free to empty a page's wrapper whenever it draws a bitmap or
 * gives one back, and it rebuilds the whole column when the number of pages
 * moves. A layer has to survive both, so this module does two things: it puts
 * every layer back on the page it belongs to whenever #pages changes, and it
 * draws that page's objects again whenever the page's scale moves — which is
 * what catches the moment a page's real size arrives from the file, after the
 * first box had to be guessed.
 *
 * `initLayers` answers the three things overlay.js needs: `paint`, which draws
 * everything again, `attach`, which is the same without the drawing, and
 * `layerAt(i)`, the layer of one page. The pointer is overlay.js's business and
 * listens on #pages, so a layer here is only a box with objects in it.
 */

import { pageBox } from './viewer.js';
import { elementOf } from './overlay-paint.js';

/** One layer per page, in the model's order. */
const layers = [];
let ctx = null;
let onPainted = () => {};

/** One page's overlay: what the objects are laid on, and the pointer's own. */
function makeLayer(index) {
  // A page is a coordinate system, not a paragraph: it never mirrors, so the
  // layer is LTR and the inline-start inside it is the page's left edge.
  const layer = document.createElement('div');
  layer.className = 'overlay';
  layer.dataset.index = String(index);
  layer.style.cssText = 'position:absolute;inset:0;z-index:1;direction:ltr;'
    + 'touch-action:pan-y;-webkit-tap-highlight-color:transparent;';
  return layer;
}

/** One page's objects, at the scale that page is shown at right now. */
function draw(i, box) {
  const layer = layers[i];
  const scale = box.scale;
  layer.dataset.w = String(box.width / scale);
  layer.dataset.scale = String(scale);
  layer.style.setProperty('touch-action', ctx.tool === 'select' ? 'pan-y' : 'none');
  if (layer.firstElementChild === null && ctx.doc.objects.length === 0) return;
  const mine = ctx.doc.objects.filter((obj) => obj.page === i);
  layer.replaceChildren(...mine.map((obj) => elementOf(obj, scale)));
}

/** Every layer on its page again, and any page whose size has just been read. */
export function attach() {
  const count = ctx.doc.pages.length;
  while (layers.length > count) layers.pop().remove();
  for (let i = layers.length; i < count; i += 1) layers.push(makeLayer(i));
  let redrawn = false;
  for (let i = 0; i < count; i += 1) {
    const box = pageBox(i);
    const layer = layers[i];
    if (!box) continue;
    if (box.el.lastElementChild !== layer) {
      // A layer is laid on the page's own box, so the box is what holds it.
      box.el.style.setProperty('position', 'relative');
      box.el.append(layer);
    }
    if (!(Math.abs(box.scale - Number(layer.dataset.scale)) <= 0.001)) {
      draw(i, box);
      redrawn = true;
    }
  }
  // Drawing a page takes its chrome with it, so whoever owns the selection is
  // told: the frame and the bar are put back where the object now is.
  if (redrawn) onPainted();
}

/** The whole screen again: the document changed, or the zoom did. */
export function paint() {
  attach();
  for (let i = 0; i < layers.length; i += 1) {
    const box = pageBox(i);
    if (box) draw(i, box);
  }
  onPainted();
}

/** The layer of one page, or undefined when there is no such page. */
export function layerAt(i) {
  return layers[i];
}

/** Wired once by overlay.js. `painted` is told after every repaint. */
export function initLayers(context, painted) {
  ctx = context;
  onPainted = painted;
  // A wrapped layer is a layer the viewer threw away: the observer puts it back.
  new MutationObserver(attach).observe(document.getElementById('pages'), {
    childList: true,
    subtree: true,
  });
  window.addEventListener('resize', paint);
}
