/**
 * Wab Fit — the box a run of text is retyped in.
 *
 * This is the edit-text tool's editor, in a file of its own because finding what
 * stands on a page and standing an editor over it are two jobs, and because the
 * tool is long enough already. The editor is a `contentEditable` laid exactly
 * where a text object is, at its size and colour, holding its string with the
 * whole string selected — so the first keystroke replaces it, which is what a
 * tap on printed text is for. The object itself is hidden underneath while the
 * editor stands there: two texts in one place is neither readable nor honest
 * about which one will be kept.
 *
 * Nothing joins the model while the editor is open. `finishEditor` makes the one
 * commit — the object's new words, measured from the editor as it stood, its box
 * grown to hold them, or, when the editor was emptied, the object gone.
 * `closeEditor` only takes the editor off the page, for a caller that has already
 * decided nothing is to be written. Both are safe to call at any time.
 *
 * `measureRun` is the same measuring for words nothing has typed yet: the plan in
 * plan.js writes text without an editor standing over it, and the one question it
 * leaves is how big the box has to be.
 */

import { TEXT_LINE_HEIGHT, needsImageText } from './core.js';
import { pageBox } from './viewer.js';
import { layerAt } from './overlay-layers.js';
import { t } from './i18n.js';

/** A box is never thinner or shorter than this, in points. */
const MIN = 0.6;

/** The editor in flight, or null. */
let editing = null;

/** The element one object is drawn by, so the editor can stand in front of it. */
function nodeOf(layer, id) {
  for (const node of layer.children) {
    if (node.dataset.id === id) return node;
  }
  return null;
}

/** What the editor holds. `innerText` where the engine has it, its text where not. */
function typed(node) {
  return typeof node.innerText === 'string' ? node.innerText : node.textContent || '';
}

/** The text as the model keeps it: no Windows ends, no trailing empty line. */
function clean(text) {
  return String(text == null ? '' : text).replace(/\r\n|\r/g, '\n').replace(/\n+$/, '');
}

/** A hundredth of a point is as fine as a box needs to be. */
function round(value) {
  return Math.round(value * 100) / 100;
}

/** The editor's own look: the object's size, weight and ink, in page pixels. */
function styleOf(node, obj, scale) {
  node.style.cssText = 'position:absolute;inset-block-start:0;inset-inline-start:0;'
    + `font-size:${obj.size * scale}px;line-height:${TEXT_LINE_HEIGHT};font-weight:${obj.bold ? 700 : 400};`
    + `color:${obj.color};white-space:pre-wrap;margin:0;padding:0;border:0;`
    + 'outline:1px dashed var(--accent);outline-offset:2px;z-index:2;touch-action:manipulation;'
    + 'background:transparent;-webkit-user-select:text;user-select:text;'
    + `transform:translate(${obj.x * scale}px,${obj.y * scale}px);`
    + `width:${Math.max(40, obj.w) * scale}px;min-height:${Math.max(1, obj.h) * scale}px;`;
}

/** The editor's own box, in the page's points, taken while it is on screen. */
function measure(state) {
  const rect = state.node.getBoundingClientRect();
  if (rect.width > 0) state.w = rect.width / state.scale;
  if (rect.height > 0) state.h = rect.height / state.scale;
}

/**
 * The editor over one text object, or false when there is no such text object
 * or no page to lay it on. An editor already open is taken away first: a second
 * one would be laid over a document the first had already stopped agreeing with.
 */
export function openEditor(ctx, id) {
  const index = ctx.doc.objects.findIndex((obj) => obj.id === id);
  const obj = index < 0 ? null : ctx.doc.objects[index];
  if (!obj || obj.kind !== 'text') return false;
  closeEditor();
  const box = pageBox(obj.page);
  const layer = layerAt(obj.page);
  if (!box || !layer) return false;
  const node = document.createElement('div');
  node.contentEditable = 'true';
  node.dir = 'auto';
  node.className = 'text-edit';
  node.setAttribute('aria-label', t('tEditText'));
  node.textContent = obj.text;
  styleOf(node, obj, box.scale);
  const drawn = nodeOf(layer, obj.id);
  if (drawn) drawn.style.visibility = 'hidden';
  const state = { id, node, scale: box.scale, w: obj.w, h: obj.h };
  editing = state;
  node.addEventListener('input', () => measure(state));
  node.addEventListener('blur', () => finishEditor(ctx));
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') node.blur();
  });
  // A finger in the text places a caret; it must not become a page gesture.
  node.addEventListener('pointerdown', (event) => event.stopPropagation());
  layer.append(node);
  measure(state);
  node.focus();
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return true;
}

/** True while an editor is on the page, whatever is being typed into it. */
export function isEditing() {
  return editing !== null;
}

/** The editor is taken off the page without touching the model. */
export function closeEditor() {
  if (!editing) return;
  editing.node.remove();
  editing = null;
}

/** The retype is over: what the editor holds becomes the object itself. */
export function finishEditor(ctx) {
  if (!editing) return;
  const done = editing;
  editing = null;
  // Measured while the editor is still on the page; a node a repaint has already
  // taken away keeps the measurement taken the last time it was written in.
  if (done.node.isConnected) measure(done);
  const text = clean(typed(done.node));
  done.node.remove();
  const index = ctx.doc.objects.findIndex((obj) => obj.id === done.id);
  if (index < 0) return;
  const objects = ctx.doc.objects.slice();
  if (text.trim() === '') {
    objects.splice(index, 1);
  } else {
    objects[index] = Object.assign({}, objects[index], {
      text,
      w: Math.max(MIN, round(done.w)),
      h: Math.max(MIN, round(done.h)),
      asImage: needsImageText(text),
    });
  }
  ctx.commit({ pages: ctx.doc.pages, objects });
}

/**
 * The box a run of text needs, in the page's own points: what `measure` above
 * reads off an editor that is open, asked here of the string itself.
 *
 * The run is laid out in the size, weight and line height an editor stands in,
 * wrapped at the width the page has left, and measured off the screen; the
 * element is never drawn and goes as soon as it has been read. Answers zeroes for
 * a run laid out where nothing can be read, which its caller refuses.
 */
export function measureRun(text, set, maxWidth) {
  const probe = document.createElement('div');
  probe.dir = 'auto';
  probe.setAttribute('aria-hidden', 'true');
  probe.textContent = String(text == null ? '' : text);
  probe.style.cssText = 'position:absolute;inset-block-start:0;inset-inline-start:0;'
    + 'visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;'
    + 'margin:0;padding:0;border:0;'
    + `font-size:${set.size}px;line-height:${TEXT_LINE_HEIGHT};font-weight:${set.bold ? 700 : 400};`;
  if (maxWidth > 0) probe.style.maxWidth = `${maxWidth}px`;
  document.body.append(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  return { w: round(rect.width), h: round(rect.height) };
}

