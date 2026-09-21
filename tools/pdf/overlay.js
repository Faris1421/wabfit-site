/**
 * Wab Fit — the pointer on a page: the tools, and the selection's own drags.
 *
 * One overlay sits on every page — overlay-layers.js keeps them there — and this
 * file is what happens when a finger lands on one. It listens on #pages, not on
 * each layer, because the viewer throws layers away as it draws: a gesture then
 * owns the layer it started on for all of its life.
 *
 * A point inside this file is a PDF point: top-left origin, the page as it is
 * displayed. The layer's rect and the page width recorded on it are the whole of
 * the conversion, so nothing here knows about zoom or scroll offsets.
 *
 * Two jobs, kept apart:
 *
 *   · the ACTIVE TOOL. `registerTool` is how another file — tools.js — takes the
 *     pointer: onDown(pt, pageIndex, ev) when a finger lands, onMove(pt, ev) and
 *     onUp(pt, ev) while it is down, onCancel() when the gesture is taken away.
 *     A tool nobody registered simply changes nothing.
 *   · the SELECTION, which is this file's own tool: tap an object to pick it,
 *     drag it to move it, drag one of its eight handles to resize it, and use the
 *     bar that overlay-handles.js floats beside it, whose buttons overlay-select
 *     .js answers for. A gesture ends in ONE `ctx.commit`, so undo and redo work.
 *
 * A drag is measured from where it started, never from the last frame, and only
 * the object in hand is redrawn while it moves.
 */

import { pageBox } from './viewer.js';
import { elementOf } from './overlay-paint.js';
import { createChrome } from './overlay-handles.js';
import { boxOf, resizeObject, translate } from './overlay-geometry.js';
import { act, findSelected, placeChrome, selectAt, withObject } from './overlay-select.js';
import { initLayers, layerAt, paint } from './overlay-layers.js';

/** How far, in CSS pixels, a finger may stray before it is a drag, not a tap. */
const SLOP = 6;

let ctx = null;
let chrome = null;
/** The gesture in flight, or null. */
let drag = null;
/** Tool name → what it does with the pointer. */
const tools = new Map();

/* ── from a pointer to a page ────────────────────────────────────────────── */

/** A pointer event as a point of the page, in PDF points, with its scale. */
function place(event, layer) {
  const rect = layer.getBoundingClientRect();
  const scale = rect.width / (Number(layer.dataset.w) || 1);
  return {
    pt: { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale },
    scale,
    area: { width: rect.width, height: rect.height },
  };
}

/** The element one object is drawn by, so a drag can move it without a repaint. */
function nodeOf(layer, id) {
  for (const node of layer.children) {
    if (node.dataset.id === id) return node;
  }
  return null;
}

/** The selection's chrome where it belongs, whenever the page moves under it. */
function showChrome() {
  const found = findSelected(ctx);
  const page = found ? found.obj.page : -1;
  placeChrome(ctx, chrome, layerAt(page), page < 0 ? null : pageBox(page));
}

/* ── one gesture ─────────────────────────────────────────────────────────── */

/** A finger lands: the active tool wants it, else the object under it does. */
function onDown(event) {
  if (drag || event.button > 0) return;
  // A button of the bar clicks on its own; the rest of the bar is not a page.
  if (event.target.closest('[data-action], .overlay-bar')) return;
  const layer = event.target.closest('.overlay');
  if (!layer) return;
  const at = place(event, layer);
  const page = Number(layer.dataset.index);
  const handle = event.target.closest('[data-handle]');

  if (handle) {
    const found = findSelected(ctx);
    if (!found) return;
    drag = {
      kind: 'resize', layer, handle: handle.dataset.handle, index: found.index,
      base: found.obj, from: boxOf(found.obj), node: nodeOf(layer, found.obj.id),
    };
  } else if (tools.has(ctx.tool)) {
    const handlers = tools.get(ctx.tool);
    drag = { kind: 'tool', layer };
    if (handlers.onDown) handlers.onDown(at.pt, page, event);
  } else if (ctx.tool === 'select') {
    const picked = selectAt(ctx, page, at.pt, SLOP / at.scale);
    if (!picked) {
      // Nothing under the finger: a tap clears the selection, a pan still pans.
      drag = { kind: 'tap', layer, from: at.pt, strayed: false };
    } else {
      ctx.select(picked.id);
      const node = nodeOf(layer, picked.id);
      drag = {
        kind: 'move', layer, index: ctx.doc.objects.indexOf(picked), base: picked, from: at.pt,
        dx: 0, dy: 0, next: null, node, origin: node ? node.style.transform : '',
      };
    }
  }
  if (!drag) return;
  try {
    document.getElementById('pages').setPointerCapture(event.pointerId);
  } catch {
    // A pointer that is already gone needs no capture.
  }
}

/** The finger moves: the gesture in flight is told, and the screen follows it. */
function onMove(event) {
  if (!drag) return;
  const at = place(event, drag.layer);
  if (drag.kind === 'tap') {
    const strayed = Math.hypot(at.pt.x - drag.from.x, at.pt.y - drag.from.y) * at.scale > SLOP;
    if (strayed) drag.strayed = true;
    return;
  }
  if (drag.kind === 'tool') {
    const handlers = tools.get(ctx.tool);
    if (handlers && handlers.onMove) handlers.onMove(at.pt, event);
    return;
  }
  if (drag.kind === 'move') {
    drag.dx = at.pt.x - drag.from.x;
    drag.dy = at.pt.y - drag.from.y;
    if (drag.node && drag.origin) {
      drag.node.style.transform = `${drag.origin}`
        + ` translate(${drag.dx * at.scale}px,${drag.dy * at.scale}px)`;
    }
    drag.next = translate(drag.base, drag.dx, drag.dy);
  } else {
    drag.next = resizeObject(drag.base, drag.handle, drag.from, at.pt);
    if (drag.node) {
      // Only the object in hand is rebuilt: nothing else on the page moves.
      const fresh = elementOf(drag.next, at.scale);
      drag.node.replaceWith(fresh);
      drag.node = fresh;
    }
  }
  chrome.show(drag.next, boxOf(drag.next), at.scale, at.area);
}

/** The finger lifts: the gesture is over, and what changed is committed. */
function onUp(event) {
  if (!drag) return;
  const at = place(event, drag.layer);
  const done = drag;
  drag = null;
  if (done.kind === 'tap') {
    if (!done.strayed) ctx.select(null);
    return;
  }
  if (done.kind === 'tool') {
    const handlers = tools.get(ctx.tool);
    if (handlers && handlers.onUp) handlers.onUp(at.pt, event);
    return;
  }
  if (done.kind === 'move') {
    if (done.dx !== 0 || done.dy !== 0) {
      ctx.commit(withObject(ctx, done.index, translate(done.base, done.dx, done.dy)));
    }
    return;
  }
  if (done.next) ctx.commit(withObject(ctx, done.index, done.next));
}

/** The gesture was taken away — a pan, a second finger: put the screen back. */
function cancel() {
  const handlers = drag && drag.kind === 'tool' ? tools.get(ctx.tool) : null;
  drag = null;
  if (handlers && handlers.onCancel) handlers.onCancel();
  paint();
}

/* ── what another file can plug in ───────────────────────────────────────── */

/**
 * Hands a tool the pointer of every page: `onDown(pt, pageIndex, ev)`,
 * `onMove(pt, ev)`, `onUp(pt, ev)` and `onCancel()`, all optional, with the
 * point in PDF points from the page's top-left as it is displayed. That is how
 * tools.js reaches the page without knowing about zoom or scrolling.
 */
export function registerTool(name, handlers) {
  tools.set(name, handlers);
  return handlers;
}

/* ── boot ────────────────────────────────────────────────────────────────── */

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(context) {
  ctx = context;
  chrome = createChrome((action) => act(ctx, action));
  initLayers(ctx, showChrome);
  const pages = document.getElementById('pages');
  pages.addEventListener('pointerdown', onDown);
  pages.addEventListener('pointermove', onMove);
  pages.addEventListener('pointerup', onUp);
  pages.addEventListener('pointercancel', cancel);
  ctx.on('doc', paint);
  ctx.on('zoom', paint);
  /** A file just opened: the viewer has put the zoom back to 100% by now. */
  ctx.on('open', paint);
  ctx.on('select', showChrome);
  ctx.on('tool', paint);
  /** main.js's keyboard asks for the selection to go; the model change is here. */
  ctx.on('remove', () => act(ctx, 'delete'));
  paint();
  return ctx;
}
