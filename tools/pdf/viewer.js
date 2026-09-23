/**
 * Wab Fit — the pages on the screen: lazy rendering, and zoom.
 *
 * This module owns the middle band and nothing else. It reads the edit model
 * through `ctx.doc`, draws page by page with the vendored pdf.js, and puts the
 * result on one <canvas> per page. The source file is never trusted for order:
 * page i is drawn from `ctx.doc.pages[i]`, so a reorder, a rotation, a deletion
 * and a blank page are all the same event here — the wrapper at that index
 * shows whatever the model says is there.
 *
 * Three rules keep a three-hundred-page file usable on a phone:
 *
 *   · only the pages near the screen are drawn. An IntersectionObserver says
 *     which wrappers intersect the stage; that range plus KEEP pages either
 *     side is what is wanted, and at most PARALLEL pages are drawn at once;
 *   · a page that falls out of that range gives its canvas back and keeps only
 *     its reserved box — the same size, so the column never jumps;
 *   · during a gesture no bitmap is drawn at all: the column is CSS-scaled,
 *     which costs nothing, and the one crisp redraw happens REFINE_DELAY after
 *     the last 'zoom'.
 *
 * Every wrapper carries `data-page` (1-based, what the bar calls the page) and
 * `data-index` (its position in the model), and `pageBox(i)` answers a wrapper,
 * its size in CSS pixels and its scale from PDF points — which is how the tools
 * size themselves over a page.
 */

import { pdfjsDoc } from './docstore.js';
import { displaySize, normalizeRotation } from './core.js';
import { MAX_SIDE } from './sign-engine.js';

/* ── limits ──────────────────────────────────────────────────────────────── */

/** Breathing room either side of a page, matching `.stage`'s own padding. */
const STAGE_PAD = 24;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 24;
/** How long a gesture must be still before the crisp redraw starts. */
const REFINE_DELAY = 160;
/** A page wider than this is memory spent on nothing. */
const MAX_BITMAP_WIDTH = 4096;
/** Pages kept drawn either side of the visible ones, and drawn at once. */
const KEEP = 3;
const PARALLEL = 3;
/** The box a page shows at until its own size has been read from the file. */
const A4 = { width: 595.28, height: 841.89 };
/** How much finer than the screen a crop is drawn, and how far it may go. */
const CROP_DETAIL = 3;
/** The longest side a crop is drawn at: the engine works a crop at up to this,
 *  so drawing it any finer would be averaged away before it was ever read. */
const CROP_MAX_SIDE = MAX_SIDE;

/* ── state ───────────────────────────────────────────────────────────────── */

let ctx = null;
const el = { stage: null, pages: null, empty: null };
/** One `.page` wrapper per index of `ctx.doc.pages`. */
const wrappers = [];
/** `src:index` → the size that source page itself shows at, in points. */
const sizes = new Map();
/** The indices the observer says are on screen right now. */
const near = new Set();
/** Index → the paint number whose bitmap its canvas carries. */
const drawn = new Map();
/** Indices being drawn or waiting on a wasm worker, and their render tasks. */
const busy = new Set();
const tasks = new Map();
/** Index → the paint a page could not be drawn at, so it is not retried in a loop. */
const failed = new Map();
let observer = null;
let fit = 0;
/** Bumped when everything on screen is stale and has to be drawn again. */
let paint = 0;
let running = 0;
let refineTimer = 0;
/** What the pages ARE, so a commit that only adds a mark repaints nothing. */
let signature = null;

/* ── geometry ────────────────────────────────────────────────────────────── */

/** A source page's own size is the same page wherever the model puts it. */
function keyOf(ref) {
  return `${ref.src}:${ref.index}`;
}

/** The size page i shows at, in points, or null while it has not been read. */
function sizeOf(i) {
  const ref = ctx.doc.pages[i];
  if (!ref) return null;
  if (ref.src < 0) {
    const box = ref.blank || A4;
    return { width: box.w, height: box.h };
  }
  const known = sizes.get(keyOf(ref));
  return known ? displaySize(known, ref.rotate) : null;
}

/** Gives page i its box: its own size once it is known, A4 until then. */
function place(i) {
  const wrapper = wrappers[i];
  if (!wrapper) return;
  const size = sizeOf(i) || A4;
  wrapper.style.aspectRatio = `${size.width} / ${size.height}`;
}

/** The width of a page in CSS pixels at the zoom it is shown at. */
function cssWidthOf() {
  return Math.max(1, Math.round(fit * ctx.zoom));
}

/** The column's width: the stage, less the breathing room either side. */
function measure() {
  fit = Math.max(120, Math.floor(el.stage.clientWidth - STAGE_PAD));
  el.pages.style.setProperty('--fit', `${fit}px`);
}

/* ── what is wanted, and what is drawn ───────────────────────────────────── */

/** The pages worth having drawn: what is seen, plus KEEP pages either side. */
function keeping() {
  const keep = new Set();
  for (const at of near) {
    const first = Math.max(0, at - KEEP);
    const last = Math.min(wrappers.length - 1, at + KEEP);
    for (let i = first; i <= last; i += 1) keep.add(i);
  }
  return keep;
}

/** The nearest page first, so what the eye is on is what is drawn first. */
function distanceTo(i) {
  let best = Infinity;
  for (const at of near) best = Math.min(best, Math.abs(at - i));
  return best;
}

function onCross(entries) {
  for (const entry of entries) {
    const index = Number(entry.target.dataset.index);
    if (!Number.isInteger(index)) continue;
    if (!entry.isIntersecting) {
      near.delete(index);
      continue;
    }
    near.add(index);
    // A wrapper with no canvas carries no bitmap, whatever the maps believe —
    // it was released, or its draw was cancelled when it left the screen.
    if (!entry.target.querySelector('canvas')) {
      drawn.delete(index);
      failed.delete(index);
    }
  }
  pump();
  trim();
}

/** Stops the render this page has in flight, and waits for it to let go. */
function cancelFor(i) {
  const task = tasks.get(i);
  if (!task) return Promise.resolve();
  tasks.delete(i);
  task.cancel();
  return task.promise.then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Draws one page and answers true once its canvas is on the wrapper. The
 * bitmap is devicePixelRatio-aware and capped, because a 400% page on a phone
 * is otherwise a 12000-pixel canvas nobody can see.
 */
async function draw(i, stamp) {
  const ref = ctx.doc.pages[i];
  const wrapper = wrappers[i];
  if (!ref || !wrapper || ref.src < 0) return false;
  const handle = pdfjsDoc(ref.src);
  if (!handle) return false;

  const page = await handle.getPage(ref.index + 1);
  if (stamp !== paint) return false;
  const base = page.getViewport({ scale: 1 });
  sizes.set(keyOf(ref), { width: base.width, height: base.height });
  const shown = displaySize({ width: base.width, height: base.height }, ref.rotate);
  wrapper.style.aspectRatio = `${shown.width} / ${shown.height}`;

  const cssWidth = wrapper.clientWidth || cssWidthOf();
  const dpr = window.devicePixelRatio || 1;
  const bitmapWidth = Math.min(cssWidth * dpr, MAX_BITMAP_WIDTH);
  const viewport = page.getViewport({
    scale: bitmapWidth / shown.width,
    rotation: (base.rotation + normalizeRotation(ref.rotate)) % 360,
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) return false;
  const task = page.render({ canvasContext: context, viewport });
  tasks.set(i, task);
  await task.promise;
  if (tasks.get(i) === task) tasks.delete(i);

  if (stamp !== paint || !keeping().has(i)) return false;
  wrapper.textContent = '';
  wrapper.append(canvas);
  drawn.set(i, stamp);
  return true;
}

/** Draws what is wanted, nearest first, never more than PARALLEL at a time. */
function pump() {
  if (!ctx) return;
  const stamp = paint;
  const keep = Array.from(keeping()).sort((a, b) => distanceTo(a) - distanceTo(b));
  for (const i of keep) {
    if (running >= PARALLEL) return;
    if (drawn.get(i) === stamp || failed.get(i) === stamp || busy.has(i)) continue;
    const ref = ctx.doc.pages[i];
    if (!ref || ref.src < 0) continue; // a blank page is its own placeholder
    busy.add(i);
    running += 1;
    const done = () => {
      busy.delete(i);
      running -= 1;
      pump();
    };
    // A page that could not be drawn keeps its box and is not tried again
    // until the next paint, so a broken page cannot spin the queue.
    cancelFor(i)
      .then(() => draw(i, stamp))
      .then(
        (wasDrawn) => {
          if (!wasDrawn) failed.set(i, stamp);
        },
        () => failed.set(i, stamp),
      )
      .then(done, done);
  }
}

/** Gives back the canvases of the pages far from the screen; their boxes stay. */
function trim() {
  const keep = keeping();
  for (const i of Array.from(drawn.keys())) {
    const wrapper = wrappers[i];
    if (keep.has(i) || !wrapper) continue;
    cancelFor(i).catch(() => undefined);
    wrapper.textContent = '';
    drawn.delete(i);
    failed.delete(i);
    busy.delete(i);
  }
}

/* ── the column ──────────────────────────────────────────────────────────── */

/** Builds one wrapper per page. Only when the number of pages has moved. */
function rebuild(count) {
  for (const i of Array.from(tasks.keys())) cancelFor(i).catch(() => undefined);
  if (observer) observer.disconnect();
  near.clear();
  drawn.clear();
  failed.clear();
  busy.clear();
  wrappers.length = 0;
  el.pages.textContent = '';
  for (let i = 0; i < count; i += 1) {
    const wrapper = document.createElement('div');
    wrapper.className = 'page';
    wrapper.dataset.page = String(i + 1);
    wrapper.dataset.index = String(i);
    el.pages.append(wrapper);
    wrappers.push(wrapper);
    place(i);
    if (observer) observer.observe(wrapper);
  }
}

/**
 * The model changed — it was opened, or a tool committed an edit. The wrappers
 * are rebuilt only when the number of pages moved, because a rebuild throws the
 * scroll position away. A commit that only added a mark changes no page, and
 * those are not repainted: `signature` is what the pages ARE.
 */
function sync() {
  const pages = ctx.doc.pages;
  const count = pages.length;
  el.empty.hidden = count > 0;
  el.pages.hidden = count === 0;
  const now = pages.map((ref) => `${ref.src}:${ref.index}:${ref.rotate}`).join('|');
  if (wrappers.length !== count) rebuild(count);
  else if (now === signature) {
    measure();
    return;
  } else {
    for (let i = 0; i < count; i += 1) place(i);
  }
  signature = now;
  measure();
  paint += 1;
  pump();
  trim();
}

/** A gesture redraws nothing: the one crisp redraw waits for it to stop. */
function scheduleRefine() {
  window.clearTimeout(refineTimer);
  refineTimer = window.setTimeout(() => {
    paint += 1;
    pump();
    trim();
  }, REFINE_DELAY);
}

/* ── zoom ────────────────────────────────────────────────────────────────── */

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** Zooms around the point under the fingers, so the page does not run away. */
function zoomAbout(next, clientY) {
  const before = ctx.zoom;
  const after = clampZoom(next);
  if (Math.abs(after - before) < 0.001) return;
  const rect = el.stage.getBoundingClientRect();
  const offset = clientY === undefined ? rect.height / 2 : clientY - rect.top;
  const focus = el.stage.scrollTop + offset;
  ctx.zoom = after;
  ctx.emit('zoom', after);
  el.stage.scrollTop = focus * (after / before) - offset;
}

function wireGestures() {
  const pointers = new Map();
  let pinch = null;
  let lastTap = { at: 0, x: 0, y: 0 };

  el.stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: ctx.zoom };
    }
  });

  el.stage.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!pinch || pointers.size !== 2 || pinch.distance === 0) return;
    const [a, b] = Array.from(pointers.values());
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAbout(pinch.zoom * (distance / pinch.distance), (a.y + b.y) / 2);
  });

  const lift = (event) => {
    if (!pointers.has(event.pointerId)) return;
    const wasAlone = pointers.size === 1;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (event.pointerType === 'mouse' || !wasAlone) return;
    const now = Date.now();
    const nearTap = Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y)
      < DOUBLE_TAP_SLOP;
    if (now - lastTap.at < DOUBLE_TAP_MS && nearTap) {
      lastTap = { at: 0, x: 0, y: 0 };
      zoomAbout(ctx.zoom > 1.2 ? 1 : 2, event.clientY);
    } else {
      lastTap = { at: now, x: event.clientX, y: event.clientY };
    }
  };

  el.stage.addEventListener('pointerup', lift);
  el.stage.addEventListener('pointercancel', lift);
  el.stage.addEventListener('pointerleave', lift);

  el.stage.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomAbout(ctx.zoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), event.clientY);
    },
    { passive: false },
  );
}

/** A phone that turns, or a desktop window that is dragged: the fit changes. */
function wireResize() {
  if (typeof ResizeObserver !== 'function') return;
  new ResizeObserver(() => {
    if (ctx.doc.pages.length === 0) return;
    measure();
    for (let i = 0; i < wrappers.length; i += 1) place(i);
    paint += 1;
    pump();
    trim();
  }).observe(el.stage);
}

/* ── how the rest of the app looks at a page ─────────────────────────────── */

/**
 * The wrapper of page `i`, its size in CSS pixels and its scale from PDF
 * points to those pixels — everything an overlay needs to sit on the page.
 * Answers null when there is no such page.
 */
export function pageBox(i) {
  const wrapper = wrappers[i];
  if (!ctx || !wrapper) return null;
  const size = sizeOf(i) || A4;
  const width = wrapper.clientWidth || cssWidthOf();
  return {
    el: wrapper,
    width,
    height: (width * size.height) / size.width,
    scale: width / size.width,
  };
}

/**
 * A rectangle of one page, drawn again off the screen and answered as its own
 * pixels: `{ data, width, height }`, where `data` is RGBA bytes.
 *
 * `box` is in the page's display points — the same space the overlay hands a
 * tool — so a rectangle that was just dragged over a page is given as it is.
 * The page is drawn at CROP_DETAIL times the size it is shown at, and never
 * more than CROP_MAX_SIDE pixels across, because what is being read is a thin
 * pen stroke: at the size the screen shows it, the stroke is the size of the
 * pixels that decide whether it survives at all.
 *
 * Answers null when there is no such page, no bitmap of it, or no context —
 * the same nothing `pageBox` answers, and never a throw.
 */
export async function cropRegion(index, box) {
  if (!ctx) return null;
  const ref = ctx.doc.pages[index];
  const wrapper = wrappers[index];
  if (!ref || !wrapper || ref.src < 0) return null;
  const handle = pdfjsDoc(ref.src);
  if (!handle) return null;

  const page = await handle.getPage(ref.index + 1);
  const base = page.getViewport({ scale: 1 });
  const shown = displaySize({ width: base.width, height: base.height }, ref.rotate);
  const cssWidth = wrapper.clientWidth || cssWidthOf();
  // CSS pixels per point, and bitmap pixels per CSS pixel.
  const perPoint = cssWidth / shown.width;
  const detail = Math.max(1, Math.min(
    CROP_DETAIL,
    MAX_BITMAP_WIDTH / Math.max(1, cssWidth),
    CROP_MAX_SIDE / Math.max(1, Math.max(box.w, box.h) * perPoint),
  ));
  const viewport = page.getViewport({
    scale: detail * perPoint,
    rotation: (base.rotation + normalizeRotation(ref.rotate)) % 360,
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) return null;
  await page.render({ canvasContext: context, viewport }).promise;

  const bit = (points) => Math.round(points * perPoint * detail);
  const x = Math.min(canvas.width - 1, Math.max(0, bit(box.x)));
  const y = Math.min(canvas.height - 1, Math.max(0, bit(box.y)));
  const width = Math.max(1, Math.min(canvas.width - x, bit(box.w)));
  const height = Math.max(1, Math.min(canvas.height - y, bit(box.h)));
  const pixels = context.getImageData(x, y, width, height);
  return { data: pixels.data, width, height };
}

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(context) {
  ctx = context;
  el.stage = document.getElementById('stage');
  el.pages = document.getElementById('pages');
  el.empty = document.getElementById('empty');
  observer = new IntersectionObserver(onCross, { root: el.stage, rootMargin: '240px 0px' });

  ctx.on('doc', sync);
  /** A document was opened: it starts at the top of page one, at 100%. */
  ctx.on('open', () => {
    signature = null;
    ctx.zoom = 1;
    el.pages.style.setProperty('--zoom', '1');
    el.stage.scrollTop = 0;
    sync();
  });
  ctx.on('zoom', () => {
    el.pages.style.setProperty('--zoom', String(ctx.zoom));
    scheduleRefine();
  });

  wireGestures();
  wireResize();
  sync();
  return ctx;
}
