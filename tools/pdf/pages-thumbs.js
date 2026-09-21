/**
 * Wab Fit — the grid of page thumbnails in the pages tool.
 *
 * One slot per page of the model, in order: the page drawn into a canvas at a
 * quarter of its size, its number under it, and the picked state of the slot on
 * its own outline. A source page is drawn ONCE — the bitmap is kept by
 * `src:index:rotate`, so a duplicate, a second look at the panel and a scroll
 * back are all free — and only the slots near the screen are drawn at all, one
 * at a time, so a three-hundred-page file never blocks the panel it is in. A
 * tap is pages.js's business: it is a pointer gesture and this file is only the
 * pixels. A press on a keyboard has no pointer in it, so `onPick` is called
 * from here for that alone.
 */

import { displaySize, normalizeRotation } from './core.js';
import { pdfjsDoc } from './docstore.js';

/** A thumbnail is drawn at a quarter of the page's size. */
const THUMB_SCALE = 0.25;
/** What a page of unknown size shows at, in points, exactly as core.js does. */
const A4 = { width: 595.28, height: 841.89 };

let grid = null;
let onPick = null;
let observer = null;
/** The pages the slots stand for, in model order, as of the last render. */
let refs = [];
/** `src:index:rotate` → the canvas that page was drawn into, once. */
const thumbs = new Map();
/** `src:index` → the page's own size in points, read from the file. */
const sizes = new Map();
const busy = new Set();
const failed = new Set();
let queue = [];
let working = false;

/* ── one slot ────────────────────────────────────────────────────────────── */

/** Styles by their CSS names, so the logical ones stay logical. */
function dress(node, styles) {
  for (const name of Object.keys(styles)) node.style.setProperty(name, styles[name]);
  return node;
}

/** A source page's own size is the same page wherever the model puts it. */
function keyOf(ref) {
  return `${ref.src}:${ref.index}:${ref.rotate}`;
}

/** The size a page shows at: its own box when blank, the file's otherwise. */
function shown(ref) {
  if (ref.src < 0) {
    const blank = ref.blank || A4;
    return { width: blank.w, height: blank.h };
  }
  const known = sizes.get(`${ref.src}:${ref.index}`);
  return known ? displaySize(known, ref.rotate) : A4;
}

/** One slot: the box its thumbnail will fill, and its number under it. */
function makeItem(ref, index, picked) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'pg-item';
  item.dataset.index = String(index);
  if (ref.src >= 0) item.dataset.key = keyOf(ref);
  item.setAttribute('aria-pressed', String(picked));
  dress(item, {
    display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: 'var(--s-xs)',
    padding: 'var(--s-xs)', border: '1px solid var(--line)', 'border-radius': 'var(--r-md)',
    background: 'var(--surface)', 'touch-action': 'pan-y', cursor: 'pointer',
    outline: picked ? '2px solid var(--accent)' : 'none',
  });

  const shot = document.createElement('span');
  shot.className = 'pg-shot';
  const size = shown(ref);
  dress(shot, {
    display: 'block', width: '100%', 'aspect-ratio': `${size.width} / ${size.height}`,
    background: 'var(--surface2)', 'border-radius': 'var(--r-xs)', overflow: 'hidden',
  });

  const number = document.createElement('span');
  dress(number, {
    'font-size': '11px', color: 'var(--muted)', 'font-variant-numeric': 'tabular-nums',
  });
  number.textContent = String(index + 1);
  item.append(shot, number);

  // A tap is a pointer gesture and pages.js decides it; a press on a keyboard
  // reaches the page as a click with no pointer behind it.
  item.addEventListener('click', (event) => {
    if (event.detail === 0) onPick(index);
  });
  return item;
}

/* ── drawing, once per source page ───────────────────────────────────────── */

/** Copies a drawn page into a canvas of this slot's own. */
function mount(item, thumb) {
  const shot = item.querySelector('.pg-shot');
  if (!shot) return;
  const canvas = dress(document.createElement('canvas'), { display: 'block', width: '100%' });
  canvas.width = thumb.canvas.width;
  canvas.height = thumb.canvas.height;
  const brush = canvas.getContext('2d');
  if (brush) brush.drawImage(thumb.canvas, 0, 0);
  // The page's real shape wins over the A4 box it was reserved at.
  shot.style.setProperty('aspect-ratio', `${canvas.width} / ${canvas.height}`);
  shot.textContent = '';
  shot.append(canvas);
}

/** Puts a drawn page into every slot that shows it: a duplicate is two slots. */
function mountAll(key, thumb) {
  for (const item of grid.querySelectorAll('.pg-item')) {
    if (item.dataset.key === key) mount(item, thumb);
  }
}

/** Draws the page a slot stands for, or gives it the bitmap already kept. */
async function paint(item) {
  const index = Number(item.dataset.index);
  const ref = refs[index];
  if (!ref || ref.src < 0) return;
  const key = keyOf(ref);
  const cached = thumbs.get(key);
  if (cached) {
    mountAll(key, cached);
    return;
  }
  if (busy.has(key) || failed.has(key)) return;
  const handle = pdfjsDoc(ref.src);
  if (!handle) return;
  busy.add(key);
  try {
    const page = await handle.getPage(ref.index + 1);
    const base = page.getViewport({ scale: 1 });
    sizes.set(`${ref.src}:${ref.index}`, { width: base.width, height: base.height });
    const viewport = page.getViewport({
      scale: THUMB_SCALE,
      rotation: (base.rotation + normalizeRotation(ref.rotate)) % 360,
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const brush = canvas.getContext('2d');
    if (!brush) return;
    await page.render({ canvasContext: brush, viewport }).promise;
    const drawn = { canvas };
    thumbs.set(key, drawn);
    mountAll(key, drawn);
  } catch {
    // A page that cannot be drawn keeps its box and is not tried again.
    failed.add(key);
  } finally {
    busy.delete(key);
  }
}

/* ── the queue, and what pages.js asks for ───────────────────────────────── */

function onCross(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    queue.push(entry.target);
  }
  pump();
}

/** One thumbnail at a time, so a long file never blocks the panel. */
function pump() {
  if (working) return;
  const item = queue.shift();
  if (!item) return;
  if (!item.isConnected) {
    pump();
    return;
  }
  working = true;
  const next = () => {
    working = false;
    pump();
  };
  paint(item).then(next, next);
}

/** Fills the grid with the pages of the model, as they stand right now. */
function render(pages, selected) {
  refs = pages;
  queue = [];
  if (observer) observer.disconnect();
  grid.textContent = '';
  for (let index = 0; index < pages.length; index += 1) {
    const ref = pages[index];
    const item = makeItem(ref, index, selected.has(index));
    grid.append(item);
    if (ref.src < 0) continue;
    const cached = thumbs.get(keyOf(ref));
    if (cached) mount(item, cached);
    else observer.observe(item);
  }
}

/** Wired once by pages.js. Answers the grid, and what a page's size is. */
export function initThumbs(options) {
  grid = options.grid;
  onPick = options.onPick;
  observer = new IntersectionObserver(onCross, { root: grid, rootMargin: '200px' });
  return {
    render,
    /** The size the page at `index` shows at, in points. */
    sizeOf(index) {
      const ref = refs[index];
      return ref ? shown(ref) : A4;
    },
  };
}
