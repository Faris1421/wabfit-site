/**
 * Wab Fit — signatures.
 *
 * The signature tool lands a hand-written signature on a page. A tap with the
 * tool on opens the sheet: the pad (sign-pad.js owns the ink), the signatures
 * this device remembers as thumbnails, Clear and Done (sign-sheet.js owns the
 * screen). Picking a remembered one places it; deleting one forgets it.
 *
 * The last few signatures live in localStorage under 'wabfit.pdf.signatures',
 * newest first, three deep. Nothing joins the model until one is placed: the
 * pad is trimmed to the ink's own bounds, written out as a transparent PNG, and
 * put on the page like a picture, sixty per cent of the page's width across.
 * A signature is an image object of the model and nothing else, so an export
 * embeds it, the select tool moves and resizes it with its aspect locked, and
 * undo takes it back in one step.
 *
 * A signature that is ALREADY on a page is lifted out of it instead: the sheet's
 * own action closes it and arms the tool, the next rectangle dragged over a page
 * is the crop (drawn with the page's own rectangle, the one every box in this
 * editor is drawn with), and what comes back — the model's handwriting box, cut
 * by the lift engine — is shown over a checkerboard before it is saved. On that
 * face the pen can be put back in its own colour or in black or blue, and the
 * eraser rubs out a mark the cut kept by mistake. Saved, it is an entry of the
 * same list, placed the same way as any other, and the point it was found at is
 * the point it lands on.
 */

import { newId } from './core.js';
import { cropRegion, pageBox } from './viewer.js';
import { registerTool } from './overlay.js';
import { elementOf } from './overlay-paint.js';
import { layerAt } from './overlay-layers.js';
import { settings } from './props.js';
import { t } from './i18n.js';
import { buildSheet, paintSaved } from './sign-sheet.js';
import { askForHandwriting, cut, erase, repaint } from './sign-lift.js';

/** Where this device keeps the signatures it has seen. */
const KEY = 'wabfit.pdf.signatures';
/** How many of them are kept, newest first. */
const KEEP = 3;
/** How much of a page's width a signature takes when it lands. */
const WIDTH_OF_PAGE = 0.6;
/** Nothing smaller than this, in points, is a frame around a signature. */
const MIN_FRAME = 6;
/** The frame's line, in CSS pixels, at whatever the page is shown at. */
const FRAME_LINE = 1.5;
/** The three inks a lifted pen may be painted in, in the order the sheet shows
 *  them, each with the word that names it. */
const INKS = [
  { mode: 'black', key: 'inkBlack' },
  { mode: 'blue', key: 'inkBlue' },
  { mode: 'source', key: 'inkSource' },
];
/** The ink a lift opens in: the pen's own colour, which is what was on the page. */
const START_INK = 'source';
/** How wide the eraser is, as a share of the lift's longer side, and its floor. */
const BRUSH = 0.03;
const BRUSH_FLOOR = 3;

let ctx = null;
/** The sheet and its parts, built once, or null before boot. */
let el = null;
/** The page and point the next signature lands on, or null while the sheet is shut. */
let waiting = null;
/** The frame being dragged over a page, or null. */
let frame = null;
/** True between the sheet's lift action and the signature that comes of it. */
let lifting = false;
/**
 * The finished lift the sheet is showing, or null when the pad is showing: the
 * engine's own pixels, the ink it is painted in, and the picture of them. The
 * pixels are the pen's own colour whatever the ink is, so the eraser and the
 * three chips all work on the one array and switching back loses nothing.
 */
let lifted = null;
/** The lift's own parts of the sheet: its ink chips and its eraser. */
let inks = null;
/** True while the eraser is armed: the next drag over the cut rubs it out. */
let erasing = false;
/** True between a finger landing on the cut with the eraser and lifting again. */
let rubbing = false;
/** True while a picture is already queued for the next frame. */
let repainting = false;
/** Bumped when what is on the sheet stops being wanted: late answers are dropped. */
let stamp = 0;

/* ── what this device remembers ──────────────────────────────────────────── */

/** A stored entry is a PNG and the size its ink was drawn at, and nothing else. */
function stored(entry) {
  return Boolean(entry) && typeof entry.png === 'string'
    && Number.isFinite(entry.w) && Number.isFinite(entry.h) && entry.w > 0 && entry.h > 0;
}

/** The signatures on this device, newest first. Nothing, if the store refuses. */
function remembered() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(stored).slice(0, KEEP) : [];
  } catch {
    return [];
  }
}

/** Writes the list back. A store that refuses is silent: the pad still works. */
function remember(list) {
  const kept = list.slice(0, KEEP);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Private mode, or no room left: nothing to say, and nothing to do about it.
  }
  return kept;
}

/** One more signature on top of the remembered ones. */
function keep(signature) {
  return remember([signature, ...remembered().filter((entry) => entry.png !== signature.png)]);
}

/** One the person threw away, gone from the device as well. */
function drop(png) {
  return remember(remembered().filter((entry) => entry.png !== png));
}

/* ── the page ────────────────────────────────────────────────────────────── */

/** A hundredth of a point is as fine as a picture's box needs to be. */
function round(value) {
  return Math.round(value * 100) / 100;
}

/** Kept on the page: a signature landing at an edge is pushed back inside it. */
function inside(value, size, span) {
  return round(Math.min(Math.max(0, value), Math.max(0, size - span)));
}

/** The model's own object: a signature WIDTH_OF_PAGE of the page wide, on `pt`. */
function mark(page, pt, signature) {
  const box = pageBox(page);
  if (!box) return null;
  const pageWidth = box.width / box.scale;
  const pageHeight = box.height / box.scale;
  const w = pageWidth * WIDTH_OF_PAGE;
  const h = w * (signature.h / signature.w);
  return {
    kind: 'image',
    id: newId(),
    page,
    x: inside(pt.x - w / 2, pageWidth, w),
    y: inside(pt.y - h / 2, pageHeight, h),
    w: round(w),
    h: round(h),
    pngBase64: signature.png,
  };
}

/* ── the sheet ───────────────────────────────────────────────────────────── */

/** The remembered signatures, drawn again with the words the language is in. */
function paintRow() {
  paintSaved(el.saved, remembered(), (entry) => land(waiting, entry), (entry) => {
    drop(entry.png);
    paintRow();
  });
}

/** Every word the sheet itself carries. Put on when a face opens: the language
 *  may have changed since the last time it was. */
function speak() {
  el.title.textContent = t('tSign');
  el.done.textContent = t('done');
  el.clear.textContent = t('clear');
  el.lift.textContent = t('liftSign');
  el.save.textContent = t('saveSign');
  el.retry.textContent = t('tryAgain');
  el.note.textContent = t('liftLocal');
  for (const ink of INKS) inks.buttons.get(ink.mode).textContent = t(ink.key);
  inks.eraser.textContent = t('erase');
}

/* ── the ink of a lifted signature, and its eraser ────────────────────────── */

/** A button of the lift's own face, styled like every other chip of the sheet. */
function button() {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'chip';
  node.setAttribute('aria-pressed', 'false');
  return node;
}

/** The row under the lifted cut: the three inks, and the eraser. Built once and
 *  put inside the preview, where the cut it acts on is shown. */
function buildInks() {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.flexWrap = 'wrap';
  row.style.alignItems = 'center';
  row.style.justifyContent = 'center';
  row.style.gap = 'var(--s-sm)';
  row.hidden = true;

  const buttons = new Map();
  for (const ink of INKS) {
    const node = button();
    node.addEventListener('click', () => paint(ink.mode));
    buttons.set(ink.mode, node);
    row.append(node);
  }
  const eraser = button();
  eraser.addEventListener('click', () => armEraser(!erasing));
  row.append(eraser);
  el.preview.append(row);
  return { row, buttons, eraser };
}

/** The chips' own state: the ink the cut is in, and whether the eraser is armed. */
function sync() {
  for (const [mode, node] of inks.buttons) {
    node.setAttribute('aria-pressed', String(Boolean(lifted) && lifted.mode === mode));
  }
  inks.eraser.setAttribute('aria-pressed', String(erasing));
}

/** Arm the eraser, or put it away. Armed, the cut takes the gesture itself. */
function armEraser(on) {
  erasing = Boolean(on) && Boolean(lifted);
  rubbing = false;
  el.art.style.touchAction = erasing ? 'none' : '';
  sync();
}

/**
 * The cut again, in the ink asked for, at most once a frame: a drag with the
 * eraser is many dabs a second and every one of them re-encodes the picture.
 */
function repaintSoon() {
  if (repainting) return;
  repainting = true;
  window.requestAnimationFrame(() => {
    repainting = false;
    if (lifted) paint(lifted.mode);
  });
}

/** The cut painted in one of the three inks, and put back on the sheet. */
function paint(mode) {
  if (!lifted) return;
  const shown = repaint(lifted, mode);
  if (!shown) return;
  lifted.mode = mode;
  lifted.png = shown.png;
  el.art.src = shown.png;
  sync();
}

/** One dab of the eraser, where the finger is, in the cut's own pixels. */
function rub(event) {
  if (!lifted) return;
  const box = el.art.getBoundingClientRect();
  const scale = Math.min(box.width / lifted.w, box.height / lifted.h);
  if (!(scale > 0)) return;
  // The picture is put inside the element the way `object-fit: contain` does.
  const left = box.left + (box.width - lifted.w * scale) / 2;
  const top = box.top + (box.height - lifted.h * scale) / 2;
  const reach = Math.max(BRUSH_FLOOR, Math.round(Math.max(lifted.w, lifted.h) * BRUSH));
  const took = erase(
    lifted,
    (event.clientX - left) / scale,
    (event.clientY - top) / scale,
    reach,
  );
  if (took) repaintSoon();
}

/** The eraser's gesture, wired once: the cut takes the drag while it is armed. */
function wireEraser() {
  el.art.addEventListener('pointerdown', (event) => {
    if (!erasing || !lifted) return;
    rubbing = true;
    el.art.setPointerCapture(event.pointerId);
    rub(event);
  });
  el.art.addEventListener('pointermove', (event) => {
    if (rubbing) rub(event);
  });
  const stop = () => {
    rubbing = false;
  };
  el.art.addEventListener('pointerup', stop);
  el.art.addEventListener('pointercancel', stop);
}

/** The pad's own face: the canvas, Clear, and the way to the page. */
function showPad() {
  el.preview.hidden = true;
  el.art.removeAttribute('src');
  el.ink.canvas.hidden = false;
  el.lift.hidden = false;
  el.clear.hidden = false;
  el.retry.hidden = true;
  el.save.hidden = true;
  el.note.hidden = true;
  el.panel.hidden = false;
  armEraser(false);
  inks.row.hidden = true;
  speak();
  // The pad only knows its own size once it is on the screen.
  el.ink.resize();
}

/**
 * The lift's own face: the cut over the squares that mean transparent, and the
 * answers it can be given — Save, the three inks, the eraser. `helped` is
 * whether the model found it: a cut the page made by itself says so in a line,
 * and a cut that found no ink at all leaves Save inert rather than putting a
 * blank signature in the list.
 */
function showLifted(result, helped) {
  el.ink.canvas.hidden = true;
  el.preview.hidden = false;
  el.lift.hidden = true;
  el.clear.hidden = true;
  el.retry.hidden = false;
  el.save.hidden = false;
  el.note.hidden = helped;
  if (result) el.art.src = result.png;
  else el.art.removeAttribute('src');
  el.save.disabled = !result;
  el.panel.hidden = false;
  inks.row.hidden = !result;
  sync();
  speak();
}

/** A tap with the sign tool on: the sheet opens over the page it was asked for. */
function show(page, pt) {
  if (!ctx.doc.pages[page]) return;
  waiting = { page, pt: { x: pt.x, y: pt.y } };
  const set = settings('sign');
  el.ink.setPen(set.color, set.width);
  el.ink.clear();
  lifted = null;
  paintRow();
  showPad();
}

/** The sheet is out of the way, and nothing it held is pending. */
function hide() {
  waiting = null;
  lifting = false;
  lifted = null;
  stamp += 1;
  cancelFrame();
  armEraser(false);
  el.panel.hidden = true;
}

/** Done: what the pad holds, trimmed to its ink, remembered, and put on the page. */
function finish() {
  const signature = el.ink.trimmed();
  if (!signature) {
    hide();
    return;
  }
  keep(signature);
  land(waiting, signature);
}

/** One signature onto the page it was asked for, picked so it can be moved. */
function land(at, signature) {
  const fresh = at && ctx.doc.pages[at.page] ? mark(at.page, at.pt, signature) : null;
  hide();
  if (!fresh) return;
  ctx.commit({ pages: ctx.doc.pages, objects: ctx.doc.objects.concat([fresh]) });
  ctx.select(fresh.id);
  ctx.setTool('select');
}

/* ── framing a signature that is already on the page ─────────────────────── */

/** The upright box between two points, kept inside the page it is drawn on. */
function boxBetween(start, end, size) {
  const left = Math.max(0, Math.min(start.x, end.x));
  const top = Math.max(0, Math.min(start.y, end.y));
  const right = Math.min(size.w, Math.max(start.x, end.x));
  const bottom = Math.min(size.h, Math.max(start.y, end.y));
  return {
    x: round(left),
    y: round(top),
    w: round(Math.max(0, right - left)),
    h: round(Math.max(0, bottom - top)),
  };
}

/** The accent this page frames everything in, as a colour a rectangle takes. */
function accent() {
  const value = window.getComputedStyle(document.documentElement).getPropertyValue('--accent');
  return value.trim() === '' ? 'currentColor' : value.trim();
}

/**
 * The frame under the finger, drawn by the page's own rectangle — the element
 * every box in this editor is drawn with — so what is dragged is exactly the
 * crop that will be taken, and nothing is invented that only exists here.
 */
function framed(box, scale) {
  return elementOf({
    kind: 'rect',
    id: 'lift-frame',
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    stroke: accent(),
    fill: 'none',
    width: FRAME_LINE / scale,
  }, scale);
}

/** A finger lands while the sheet is waiting for a frame around a signature. */
function beginFrame(pt, page) {
  if (frame) return;
  const box = pageBox(page);
  const layer = layerAt(page);
  if (!box || !layer) return;
  frame = {
    page,
    layer,
    scale: box.scale,
    size: { w: box.width / box.scale, h: box.height / box.scale },
    start: { x: pt.x, y: pt.y },
    node: null,
  };
}

function extendFrame(pt) {
  if (!frame) return;
  const node = framed(boxBetween(frame.start, pt, frame.size), frame.scale);
  if (frame.node) frame.node.replaceWith(node);
  else frame.layer.append(node);
  frame.node = node;
}

/** The finger lifts: that frame is the crop, and the page lifts it out. */
function endFrame(pt) {
  if (!frame) return;
  const done = frame;
  frame = null;
  if (done.node) done.node.remove();
  const box = boxBetween(done.start, pt, done.size);
  if (box.w < MIN_FRAME || box.h < MIN_FRAME) {
    // A tap is not a frame. The sheet opens where it was asked for, which is
    // what a tap with this tool does when nothing is armed — so the way back
    // into it is a tap and not a hunt for another tool.
    lifting = false;
    if (waiting) show(waiting.page, waiting.pt);
    return;
  }
  lifting = false;
  // Where it was found is where it lands, if the list is used afterwards.
  waiting = { page: done.page, pt: { x: box.x + box.w / 2, y: box.y + box.h / 2 } };
  liftInto(done.page, box).catch(() => undefined);
}

/** The gesture was taken away, or the sheet closed: half a frame is not one. */
function cancelFrame() {
  if (!frame) return;
  if (frame.node) frame.node.remove();
  frame = null;
}

/**
 * The frame drawn again at a finer size, cut by the engine, and put on the
 * sheet: first with the page's own cut, then again inside the box the model
 * named once its answer arrives.
 *
 * The local cut is shown at once and is never replaced by nothing: an answer
 * that never comes, or one that says there is no handwriting, leaves it
 * standing and the sheet says the trim was made here. A `stamp` that no longer
 * matches means the sheet was closed, or another frame was drawn, and the
 * answer that just arrived belongs to nobody.
 */
async function liftInto(page, box) {
  stamp += 1;
  const mine = stamp;
  armEraser(false);
  // A page that cannot be drawn again answers the same nothing a crop that
  // cannot be taken does: there is no signature to show.
  const crop = await cropRegion(page, box).catch(() => null);
  if (mine !== stamp) return;
  if (!crop) {
    // The pad is where the person was, and nothing is left of the attempt.
    lifted = null;
    showPad();
    return;
  }
  const own = cut(crop, null, START_INK);
  lifted = own && { ...own, mode: START_INK };
  showLifted(lifted, true);

  const read = await askForHandwriting(crop).catch(() => null);
  if (mine !== stamp) return;
  const helped = read === null ? null : cut(crop, read, START_INK);
  if (helped) lifted = { ...helped, mode: START_INK };
  showLifted(lifted, Boolean(helped));
}

/** «التقاط توقيع من الصفحة»: the sheet goes, and the next frame is the crop. */
function arm() {
  hide();
  lifting = true;
}

/** «احفظ»: the cut joins the list this device keeps, and the pad comes back. */
function saveLifted() {
  if (!lifted) return;
  keep({ png: lifted.png, w: lifted.w, h: lifted.h });
  lifted = null;
  stamp += 1; // an answer still in flight is not wanted any more
  paintRow();
  showPad();
}

/* ── boot ────────────────────────────────────────────────────────────────── */

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(context) {
  ctx = context;
  el = buildSheet({
    onDone: () => finish(),
    onClear: () => el.ink.clear(),
    onLift: () => arm(),
    onRetry: () => arm(),
    onSave: () => saveLifted(),
  });
  inks = buildInks();
  wireEraser();
  registerTool('sign', {
    onDown: (pt, page) => {
      if (lifting) beginFrame(pt, page);
      else show(page, pt);
    },
    onMove: extendFrame,
    onUp: endFrame,
    onCancel: cancelFrame,
  });
  // Nothing else may be on the screen at once: another tool, or another
  // document, and the page this signature was asked for is not that page any
  // more.
  ctx.on('tool', (id) => {
    if (id !== 'sign') hide();
  });
  ctx.on('open', hide);
  ctx.on('doc', hide);
  window.addEventListener('resize', () => {
    if (!el.panel.hidden && !el.ink.canvas.hidden) el.ink.resize();
  });
  return ctx;
}

