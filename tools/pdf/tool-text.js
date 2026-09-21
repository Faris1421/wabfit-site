/**
 * Wab Fit — writing on a page.
 *
 * The text tool makes one thing: a box of written text. A tap lays the box down
 * and an editor opens inside it — in place, with `dir="auto"`, so an Arabic
 * sentence types right to left in the same box an English one types left to
 * right. Nothing joins the model while the person types: the editor is DOM
 * only, and its box is MEASURED from the text it actually holds, so the mark
 * that lands is as wide and as tall as what was written and not one line more.
 *
 * The editor keeps its own pointer events (they stop at the editor rather than
 * bubbling to the page), because a finger inside the text places a caret rather
 * than starting a gesture. A tap elsewhere on the page, a tap on the strip, a
 * zoom, an undo or a new document all end the edit — each in ONE commit, so
 * undo takes the whole box back.
 */

import { newId, needsImageText, TEXT_LINE_HEIGHT } from './core.js';
import { pageBox } from './viewer.js';
import { registerTool } from './overlay.js';
import { layerAt } from './overlay-layers.js';
import { settings } from './props.js';
import { t } from './i18n.js';

/** A box is never thinner or shorter than this, in points. */
const MIN_WIDTH = 0.6;
const MIN_HEIGHT = 0.6;

let ctx = null;
/** The editor in flight, or null. */
let editing = null;

/** The text as the model keeps it: no Windows ends, no trailing empty line. */
function clean(text) {
  return String(text == null ? '' : text).replace(/\r\n|\r/g, '\n').replace(/\n+$/, '');
}

/** What the editor holds. `innerText` where the engine has it, its text where not. */
function typed(node) {
  return typeof node.innerText === 'string' ? node.innerText : node.textContent || '';
}

/** A hundredth of a point is as fine as a box needs to be. */
function round(value) {
  return Math.round(value * 100) / 100;
}

/** The editor's own box, in the page's points, measured while it is on screen. */
function measure(state) {
  const rect = state.node.getBoundingClientRect();
  state.w = Math.max(MIN_WIDTH, rect.width / state.scale);
  state.h = Math.max(MIN_HEIGHT, rect.height / state.scale);
  state.text = clean(typed(state.node));
}

/* ── the box in flight ───────────────────────────────────────────────────── */

/** The editor's own look: the strip's size, colour and weight, in page pixels. */
function styleOf(node, set, scale) {
  const weight = set.bold ? 700 : 400;
  node.style.cssText = 'position:absolute;inset-block-start:0;inset-inline-start:0;'
    + `font-size:${set.size * scale}px;line-height:${TEXT_LINE_HEIGHT};font-weight:${weight};`
    + `color:${set.color};display:inline-block;white-space:pre-wrap;max-width:100%;`
    + 'margin:0;padding:0;border:0;outline:1px dashed var(--accent);outline-offset:2px;'
    + 'min-width:1em;min-height:1em;z-index:2;touch-action:manipulation;'
    + 'background:transparent;-webkit-user-select:text;user-select:text;';
}

/** A tap lays the box down and puts the caret in it. */
function start(pt, page) {
  const box = pageBox(page);
  const layer = layerAt(page);
  if (!box || !layer) return;
  const scale = box.scale;
  const set = Object.assign({}, settings('text'));
  const node = document.createElement('div');
  node.contentEditable = 'true';
  node.dir = 'auto';
  node.className = 'text-edit';
  node.setAttribute('aria-label', t('tText'));
  styleOf(node, set, scale);
  node.style.transform = `translate(${pt.x * scale}px,${pt.y * scale}px)`;
  // The page's own width, less where the box starts: the text wraps inside the
  // page rather than running off it, and the measurement below follows the wrap.
  node.style.maxWidth = `${Math.max(40, (box.width / scale - pt.x - 4) * scale)}px`;
  const state = { page, x: pt.x, y: pt.y, scale, set, node, text: '', w: 0, h: 0 };
  editing = state;
  node.addEventListener('input', () => measure(state));
  node.addEventListener('blur', () => finish());
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') node.blur();
  });
  // A finger in the text places a caret; it must not become a page gesture.
  node.addEventListener('pointerdown', (event) => event.stopPropagation());
  layer.append(node);
  node.focus();
}

/** The edit is over: what the box holds becomes one mark of the document. */
function finish() {
  if (!editing) return;
  const done = editing;
  editing = null;
  // A repaint can take the editor off the page before this runs; if it did, the
  // measurement taken while it was still there is the one to keep.
  if (done.node.isConnected) measure(done);
  done.node.remove();
  if (done.text.trim() === '') return;
  const mark = {
    kind: 'text',
    id: newId(),
    page: done.page,
    x: round(done.x),
    y: round(done.y),
    w: Math.max(done.w, done.set.size * 0.6),
    h: Math.max(done.h, done.set.size * TEXT_LINE_HEIGHT),
    text: done.text,
    size: done.set.size,
    color: done.set.color,
    bold: done.set.bold,
    // Arabic cannot be written by pdf-lib: export draws it from a picture.
    asImage: needsImageText(done.text),
  };
  ctx.commit({ pages: ctx.doc.pages, objects: ctx.doc.objects.concat([mark]) });
}

/* ── boot ────────────────────────────────────────────────────────────────── */

/** A tap on the page: the first one lays a box, the next one ends the edit. */
function onDown(pt, page) {
  if (editing) {
    finish();
    return;
  }
  start(pt, page);
}

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(context) {
  ctx = context;
  registerTool('text', { onDown });
  ctx.on('tool', (id) => {
    if (id !== 'text') finish();
  });
  // A repaint would take the editor with it, and a new document has no page to
  // put it back on, so both end the edit rather than let it be lost quietly.
  ctx.on('doc', finish);
  ctx.on('zoom', finish);
  ctx.on('open', finish);
  return ctx;
}
