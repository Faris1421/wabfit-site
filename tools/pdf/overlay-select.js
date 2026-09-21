/**
 * Wab Fit — the selection: what is picked, where its chrome goes, what the bar does.
 *
 * The selection itself is one object id on `ctx`; everything else is decided
 * from the model at the moment it is asked, so this module keeps no state and
 * hides no DOM of its own. `findSelected` is what every drag starts from, and
 * `selectAt` is what a tap on a page asks.
 *
 * `placeChrome` is the join with overlay-handles.js: it decides whether the
 * chrome should be shown at all — nothing is picked, or the object was deleted
 * by an undo, or another tool is active — and shows it on the layer of the page
 * the object sits on.
 *
 * Every change the bar makes is ONE `ctx.commit` on a whole next document, which
 * is what puts a delete, a copy and a step forward or back on the undo trail
 * beside the drags.
 */

import { newId } from './core.js';
import { boxOf, hitObject, translate } from './overlay-geometry.js';

/** How far a copy is set off from what it copies, in points. */
const STEP = 12;

/** The selected object and where it sits in `ctx.doc.objects`, or null. */
export function findSelected(ctx) {
  if (!ctx.selection) return null;
  const index = ctx.doc.objects.findIndex((obj) => obj.id === ctx.selection);
  return index < 0 ? null : { obj: ctx.doc.objects[index], index };
}

/** The topmost object of a page within `tol` points of a point, or null. */
export function selectAt(ctx, page, pt, tol) {
  const objects = ctx.doc.objects;
  for (let at = objects.length - 1; at >= 0; at -= 1) {
    const obj = objects[at];
    if (obj.page === page && hitObject(obj, pt, tol)) return obj;
  }
  return null;
}

/** The model with one object changed: the pages are shared, the list is not. */
export function withObject(ctx, index, obj) {
  const objects = ctx.doc.objects.slice();
  objects[index] = obj;
  return { pages: ctx.doc.pages, objects };
}

/** The chrome of the selection on its own layer, or out of the way. */
export function placeChrome(ctx, chrome, layer, box) {
  const found = findSelected(ctx);
  if (ctx.selection && !found) {
    // An undo can take the picked object away underneath the selection.
    ctx.select(null);
    return;
  }
  if (!found || !layer || !box || ctx.tool !== 'select') {
    chrome.hide();
    return;
  }
  if (layer.lastElementChild !== chrome.root) layer.append(chrome.root);
  const rect = layer.getBoundingClientRect();
  const scale = rect.width / (Number(layer.dataset.w) || 1);
  chrome.show(found.obj, boxOf(found.obj), scale, { width: rect.width, height: rect.height });
}

/** What a button of the bar does. Everything is one commit, on one document. */
export function act(ctx, action) {
  const found = findSelected(ctx);
  if (!found) return;
  const { obj, index } = found;
  if (action === 'edit') {
    // The tool that edits written text works on the selection, so the selection
    // stays: what changes is which tool has the page.
    ctx.emit('edit', obj.id);
    ctx.setTool('editText');
    return;
  }
  if (action === 'delete') {
    ctx.select(null);
    const objects = ctx.doc.objects.filter((_, at) => at !== index);
    ctx.commit({ pages: ctx.doc.pages, objects });
    return;
  }
  const objects = ctx.doc.objects.slice();
  if (action === 'duplicate') {
    const copy = translate({ ...obj, id: newId() }, STEP, STEP);
    objects.splice(index + 1, 0, copy);
    ctx.commit({ pages: ctx.doc.pages, objects });
    ctx.select(copy.id);
    return;
  }
  // Bring forward and send back: one step in the order the objects are drawn.
  objects.splice(index, 1);
  const at = action === 'forward'
    ? Math.min(index + 1, objects.length)
    : Math.max(index - 1, 0);
  objects.splice(at, 0, obj);
  ctx.commit({ pages: ctx.doc.pages, objects });
}
