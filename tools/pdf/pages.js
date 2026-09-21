/**
 * Wab Fit — the pages tool: what is picked, and what can be done to it.
 *
 * The tool opens the panel pages-panel.js builds: pages-thumbs.js fills its
 * grid with a thumbnail per page, a tap puts a page into the selection and a
 * second tap takes it out again — so any number of pages can be picked — and
 * the row along the bottom acts on whatever is picked.
 *
 * Every operation edits the model with core.js and hands the WHOLE next
 * document to `ctx.commit`, which is what puts the edit on the undo trail and
 * tells the viewer, the bar and the grid that the document moved. The source
 * bytes are never rewritten here: a merge registers one more source with
 * docstore and appends ITS pages to the model, and an extract writes a new PDF
 * from the picked pages and hands the bytes to the same save path an export
 * uses. A drag is pages-drag.js's business, and `drop` below is the one place
 * the model is reordered.
 */

import { t } from './i18n.js';
import { addSource } from './docstore.js';
import { initDrag } from './pages-drag.js';
import { initThumbs } from './pages-thumbs.js';
import { buildPanel, paintRow } from './pages-panel.js';
import {
  appendSource, deletePage, duplicatePage, exportPdf, extract, insertBlank, movePage,
  rotatePage,
} from './core.js';

let ctx = null;
let thumbs = null;
/** The panel, its head and its row of operations. */
let el = null;
/** The pages the operations act on, as positions in `ctx.doc.pages`. */
const selected = new Set();
let showing = false;

/** The two drawings of a turn, and what each button of the row does. */
const TURN_LEFT = '<path d="M4 12a8 8 0 1 0 3.1-6.3"/><path d="M4 3.5V8h4.5"/>';
const TURN_RIGHT = '<path d="M20 12a8 8 0 1 1-3.1-6.3"/><path d="M20 3.5V8h-4.5"/>';

const ACTIONS = [
  { id: 'left', key: 'rotate', icon: TURN_LEFT, run: () => turn(-90) },
  { id: 'right', key: 'rotate', icon: TURN_RIGHT, run: () => turn(90) },
  { id: 'duplicate', key: 'duplicate', run: () => change(duplicatePages) },
  { id: 'blank', key: 'blankPage', run: newBlank },
  { id: 'merge', key: 'mergeFile', run: () => el.file.click(), any: true },
  { id: 'extract', key: 'extractSelected', run: extractPicked },
  { id: 'delete', key: 'del', run: () => change(deletePages), danger: true },
];

/* ── what is picked ──────────────────────────────────────────────────────── */

/** A tap picks a page; a second tap on the same page lets it go. */
function pick(index) {
  if (selected.has(index)) selected.delete(index);
  else selected.add(index);
  draw();
}

/** The picked pages, in the order the model counts them. */
function chosen() {
  return Array.from(selected).sort((a, b) => a - b);
}

/** Nothing is picked any more, and the row says so. */
function clearSelection() {
  selected.clear();
  draw();
}

/** Everything but a merge needs a page to work on. */
function updateRow() {
  const empty = selected.size === 0;
  for (const btn of el.row.children) {
    if (btn.dataset.any === 'true') continue;
    btn.disabled = empty;
    btn.style.setProperty('opacity', empty ? '0.4' : '1');
  }
}

/* ── what the operations do ──────────────────────────────────────────────── */

/** Runs an operation over the selection, and starts again with nothing picked. */
function change(operation) {
  const picks = chosen();
  if (picks.length > 0) operation(ctx, picks);
  clearSelection();
}

/** A quarter turn, left or right, on every picked page. */
function turn(delta) {
  let next = ctx.doc;
  for (const index of chosen()) next = rotatePage(next, index, delta);
  ctx.commit(next);
}

/** A copy of each picked page, straight after it. */
function duplicatePages(context, picks) {
  let next = context.doc;
  for (let at = picks.length - 1; at >= 0; at -= 1) next = duplicatePage(next, picks[at]);
  context.commit(next);
}

/** Removes every picked page, and the marks drawn on it. */
function deletePages(context, picks) {
  let next = context.doc;
  for (let at = picks.length - 1; at >= 0; at -= 1) next = deletePage(next, picks[at]);
  context.commit(next);
}

/** One empty page after the selection, as big as the page it follows. */
function newBlank() {
  const picks = chosen();
  const last = picks[picks.length - 1];
  if (last === undefined) return;
  const size = thumbs.sizeOf(last);
  ctx.commit(insertBlank(ctx.doc, last + 1, { w: size.width, h: size.height }));
  clearSelection();
}

/** The second picker answered: every page of that file joins the document. */
async function addFile(file) {
  const buffer = await file.arrayBuffer();
  const added = await addSource(ctx, file.name, new Uint8Array(buffer));
  if (!added) return;
  ctx.commit(appendSource(ctx.doc, added.index, added.pageCount));
  clearSelection();
}

/** Only the picked pages, in order, written out and handed to the save path. */
async function extractPicked() {
  const picks = chosen();
  if (picks.length === 0) return;
  const bytes = await exportPdf(ctx.sources, extract(ctx.doc, picks));
  ctx.emit('save', { name: extractedName(), bytes });
}

/** The original's name, marked as the pages that were taken out of it. */
function extractedName() {
  const stored = ctx.names[0];
  const base = !stored || stored === '—' ? 'wabfit' : stored.replace(/\.pdf$/i, '');
  return `${base}-pages.pdf`;
}

/** Where the drag let a page go: `at` counts the list with the page still in it. */
function drop(from, at) {
  const next = movePage(ctx.doc, from, at > from ? at - 1 : at);
  if (next === ctx.doc) return;
  selected.clear();
  ctx.commit(next);
}

/* ── open, close and boot ────────────────────────────────────────────────── */

/** The grid and the row follow the model and the selection. */
function draw() {
  if (!showing) return;
  thumbs.render(ctx.doc.pages, selected);
  updateRow();
}

function show() {
  showing = true;
  el.panel.hidden = false;
  el.title.textContent = t('tPages');
  el.done.textContent = t('done');
  paintRow(el.row, ACTIONS);
  draw();
}

function hide() {
  showing = false;
  selected.clear();
  el.panel.hidden = true;
}

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(context) {
  ctx = context;
  el = buildPanel({
    onDone: () => ctx.setTool('select'),
    onFile: (file) => addFile(file).catch(() => undefined),
  });
  thumbs = initThumbs({ grid: el.grid, onPick: pick });
  initDrag({ grid: el.grid, onPick: pick, onDrop: drop });
  ctx.on('doc', draw);
  ctx.on('tool', (id) => {
    if (id === 'pages') show();
    else hide();
  });
  return ctx;
}
