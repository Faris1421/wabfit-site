/**
 * Wab Fit — finding words on a page, and showing where they are.
 *
 * A PDF's words are read out of the page itself (pdf.js `getTextContent`), so a
 * search never looks at a bitmap: it walks the text items of every page, lays
 * their strings end to end, and looks for the query inside that. Because Arabic
 * writes the same letter in more than one way — أ إ آ and ا, ة and ه, ى and ي —
 * and because a scribe stretches a line with kashida and dots it with harakat,
 * both sides of every comparison are run through `normalise` first: «مدرسه»
 * finds «مدرسة», and «احمد» finds «أَحْمَـد».
 *
 * `normalise`, `findMatches` and `matchBoxes` carry nothing of the page, which is
 * why this one file runs both in the editor and under vitest in Node
 * (src/features/webtools/__tests__/pdfSearch.test.ts). The rest is the tool: the
 * field in the property strip, the place of the match in hand among the matches,
 * a step either way, and a rectangle over every match on its page.
 */

import { normalizeRotation } from './core.js';
import { pdfjsDoc } from './docstore.js';
import { t } from './i18n.js';
import { layerAt } from './overlay-layers.js';
import { pageBox } from './viewer.js';

/* ── the arithmetic, without a page ──────────────────────────────────────── */

/** The harakat: the vowel marks written over and under the letters. */
const HARAKAT = /[\u064B-\u0652]/g;

/** Lower case where that keeps one character, the character itself where not. */
function fold(character) {
  const lower = character.toLowerCase();
  return lower.length === 1 ? lower : character;
}

/**
 * A string as the two sides of a search compare it: lower case, no kashida and
 * no harakat, and the letters that are the same letter written differently folded
 * together — أ إ آ become ا, ة becomes ه, ى becomes ي.
 *
 * The folding is done ONE CHARACTER AT A TIME, so a normalised copy is never
 * longer than the text it came from, and the copies of two halves laid together
 * are the copy of the whole: that is what lets a match be measured back to the
 * item of the page whose characters it covers.
 */
export function normalise(text) {
  return String(text == null ? '' : text)
    .replace(/\u0640/g, '')
    .replace(HARAKAT, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064A')
    .replace(/./gu, fold);
}

/**
 * Every place `query` stands in the pages, in reading order, as
 * `{page, index, length}`: the page it was found on, and where its characters
 * begin and how many they are — counted in the page's text as `normalise` leaves
 * it, which is the text a match is then measured back against.
 *
 * An empty query is no search and answers nothing, and one match may not overlap
 * the one before it.
 */
export function findMatches(pagesText, query) {
  const needle = normalise(query);
  const found = [];
  if (needle === '') return found;
  const pages = Array.isArray(pagesText) ? pagesText : [pagesText];
  for (let page = 0; page < pages.length; page += 1) {
    const hay = normalise(pages[page]);
    let index = hay.indexOf(needle);
    while (index !== -1) {
      found.push({ page, index, length: needle.length });
      index = hay.indexOf(needle, index + needle.length);
    }
  }
  return found;
}

/**
 * Where a match stands on its page, from that page's text items in reading
 * order: one rectangle per item it touches, as wide as the characters of the
 * match inside it, in the page's own points from its top-left as displayed — the
 * same space the overlay draws a mark in.
 */
export function matchBoxes(items, match) {
  const out = [];
  let at = 0;
  for (const item of items) {
    const text = normalise(item.text);
    const start = at;
    at += text.length;
    if (text.length === 0 || at <= match.index) continue;
    if (start >= match.index + match.length) break;
    const from = Math.max(match.index, start) - start;
    const to = Math.min(match.index + match.length, at) - start;
    const left = item.x + item.w * (from / text.length);
    const right = item.x + item.w * (to / text.length);
    out.push({ x: left, y: item.y, w: right - left, h: item.h });
  }
  return out;
}

/* ── the page's own words ────────────────────────────────────────────────── */

/** How far above its baseline a text item's box reaches, in font sizes. */
const ASCENT = 1;
/** And how far below, which is where tails and descenders go. */
const DESCENT = 0.25;
/** How long the typing must be quiet before the pages are read. */
const QUIET = 200;

let ctx = null;
let strip = null;
/** What stands in the field. */
let query = '';
/** The matches of the last search, and which of them is in hand. */
let matches = [];
let at = -1;
/** The text items of every page, beside the matches that were measured on them. */
let items = [];
/** Bumped whenever the rectangles have to be drawn again. */
let version = 0;
/** The search in flight, so an answer to an older query is thrown away. */
let running = 0;
let quiet = 0;
/** `src:index:rotate` → the text items of that page, read once. */
const read = new Map();

/**
 * One text item's box on the displayed page, in points from its top-left: the
 * item's own matrix walked to its four corners and measured in the page's own
 * viewport — the measurement tool-edittext.js:53 makes of the runs it edits.
 */
function boxOfItem(item, viewport) {
  const m = item.transform;
  const width = Number(item.width) || 0;
  const font = Math.hypot(m[2], m[3]) || Number(item.height) || 0;
  const corners = [];
  for (const x of [0, width]) {
    for (const y of [-DESCENT * font, ASCENT * font]) {
      const px = m[0] * x + m[2] * y + m[4];
      const py = m[1] * x + m[3] * y + m[5];
      corners.push(viewport.convertToViewportPoint(px, py));
    }
  }
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top };
}

/**
 * One page's text items, read once and kept. The key carries the model's own
 * rotation, because a quarter turn moves every box on the page. A blank page is
 * a page with nothing on it, and answers nothing.
 */
async function itemsOf(ref) {
  const key = `${ref.src}:${ref.index}:${normalizeRotation(ref.rotate)}`;
  const kept = read.get(key);
  if (kept) return kept;
  const handle = pdfjsDoc(ref.src);
  if (!handle) return [];
  const page = await handle.getPage(ref.index + 1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: 1,
    rotation: (base.rotation + normalizeRotation(ref.rotate)) % 360,
  });
  const content = await page.getTextContent();
  const found = [];
  for (const item of content.items) {
    if (typeof item.str !== 'string' || item.str === '') continue;
    const box = boxOfItem(item, viewport);
    if (box.w > 0 && box.h > 0) {
      found.push({ text: item.str, x: box.x, y: box.y, w: box.w, h: box.h });
    }
  }
  read.set(key, found);
  return found;
}

/** The field and the count, while the search tool is on. */
const ui = { field: null, count: null };

/** Every page's items, and the text a query is looked for in. */
async function readPages() {
  const refs = ctx.doc.pages;
  const reading = [];
  const texts = [];
  for (let page = 0; page < refs.length; page += 1) {
    const found = await itemsOf(refs[page]);
    reading.push(found);
    texts.push(found.map((item) => normalise(item.text)).join(''));
  }
  return { reading, texts };
}

/** Looks for what the field holds, and shows what came back. */
async function look() {
  const mine = (running += 1);
  if (query.trim() === '') {
    matches = [];
    items = [];
    at = -1;
    version += 1;
    paintCount();
    drawHits();
    return;
  }
  const { reading, texts } = await readPages();
  if (mine !== running) return;
  matches = findMatches(texts, query);
  items = reading;
  at = matches.length > 0 ? 0 : -1;
  version += 1;
  paintCount();
  drawHits();
  if (at >= 0) goTo(matches[0]);
}

/** The typing stopped: the pages are read a beat later, once, not per keystroke. */
function typed() {
  query = ui.field ? ui.field.value : query;
  paintCount();
  window.clearTimeout(quiet);
  quiet = window.setTimeout(() => {
    look().catch(() => {});
  }, QUIET);
}

/* ── the strip ───────────────────────────────────────────────────────────── */

/** A button of the strip, in the strip's own clothes. */
function button(label, action) {
  const made = document.createElement('button');
  made.type = 'button';
  made.className = 'chip';
  made.textContent = label;
  made.setAttribute('aria-label', label);
  made.addEventListener('click', action);
  return made;
}

/**
 * The strip while the search tool is on: the field someone types into, the place
 * of the match in hand among the matches, and a step either way. props.js owns
 * the strip and writes it empty for a tool with no settings of its own, so this
 * answers to the same 'tool' event and runs after it has.
 */
function buildStrip() {
  if (!strip || !ctx) return;
  if (ctx.tool !== 'search') {
    ui.field = null;
    ui.count = null;
    clearHits();
    return;
  }
  strip.textContent = '';
  strip.hidden = false;
  const field = document.createElement('input');
  field.type = 'search';
  field.dir = 'auto';
  field.value = query;
  field.setAttribute('aria-label', t('tSearch'));
  field.placeholder = t('tSearch');
  field.style.cssText = 'min-height:40px;min-width:180px;flex:1 1 200px;padding:0 12px;'
    + 'border:1px solid var(--line);border-radius:var(--r-md);background:var(--fill);'
    + 'color:var(--text);font-size:13px;';
  field.addEventListener('input', typed);
  const count = document.createElement('span');
  count.className = 'chip';
  count.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;'
    + 'background:none;font-variant-numeric:tabular-nums;';
  ui.field = field;
  ui.count = count;
  strip.append(field, count, button(t('prevMatch'), () => step(-1)),
    button(t('nextMatch'), () => step(1)));
  paintCount();
  // The search tool was away and its rectangles were taken with it: what is
  // still found is laid on the pages again.
  drawHits();
}

/** The count: the match in hand over the whole, and a dash before there is one. */
function paintCount() {
  if (!ui.count) return;
  ui.count.textContent = query.trim() === ''
    ? '—'
    : t('searchCount', { x: at + 1, n: matches.length });
}

/* ── the matches on the page ─────────────────────────────────────────────── */

/** A step to the next match, or to the one before it; the ends wrap round. */
function step(delta) {
  if (matches.length === 0) return;
  at = (at + delta + matches.length) % matches.length;
  version += 1;
  paintCount();
  drawHits();
  goTo(matches[at]);
}

/** The match in hand is brought onto the screen: its own page is scrolled to. */
function goTo(match) {
  const box = pageBox(match.page);
  if (box) box.el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** One rectangle of a match: amber, and the match in hand a shade of its own. */
function hitNode(rect, current, scale) {
  const node = document.createElement('div');
  node.style.cssText = 'position:absolute;direction:ltr;pointer-events:none;border-radius:2px;'
    + `left:${rect.x * scale}px;top:${rect.y * scale}px;`
    + `width:${Math.max(1, rect.w * scale)}px;height:${Math.max(1, rect.h * scale)}px;`
    + `background:${current ? 'rgba(255,159,10,0.55)' : 'rgba(255,214,10,0.35)'};`;
  if (current) node.style.outline = '1.5px solid var(--accent)';
  return node;
}

/** Every rectangle the search drew, taken off the pages again. */
function clearHits() {
  for (const node of document.querySelectorAll('#pages .search-hits')) node.remove();
}

/**
 * Every match laid over its page: what is found on one page is drawn as a single
 * layer of that page, with the match in hand picked out of the rest. A layer is
 * kept while it is still the layer this reading asked for and is left alone
 * otherwise — a repaint of the page takes it away, and the next look at the
 * pages puts it back.
 */
function drawHits() {
  // The rectangles belong to the search tool: with another one on, there are
  // none on the pages to keep up to date.
  if (!ctx || !ctx.doc || ctx.tool !== 'search') return;
  const wanted = new Map();
  for (const match of matches) {
    const list = wanted.get(match.page);
    if (list) list.push(match);
    else wanted.set(match.page, [match]);
  }
  for (const [page, list] of wanted) {
    const box = pageBox(page);
    const layer = layerAt(page);
    if (!box || !layer) continue;
    const kept = layer.querySelector('.search-hits');
    if (kept && kept.dataset.at === String(version)) continue;
    if (kept) kept.remove();
    const wrap = document.createElement('div');
    wrap.className = 'search-hits';
    wrap.dataset.at = String(version);
    wrap.style.cssText = 'position:absolute;inset:0;z-index:3;pointer-events:none;direction:ltr;';
    for (const match of list) {
      for (const rect of matchBoxes(items[match.page] || [], match)) {
        wrap.append(hitNode(rect, match === matches[at], box.scale));
      }
    }
    layer.append(wrap);
  }
  // A page that no longer holds a match keeps no rectangles.
  for (const node of document.querySelectorAll('#pages .search-hits')) {
    const layer = node.parentElement;
    const page = layer ? Number(layer.dataset.index) : -1;
    if (!wanted.has(page)) node.remove();
  }
}

/* ── boot ────────────────────────────────────────────────────────────────── */

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(context) {
  ctx = context;
  strip = document.getElementById('props');
  ctx.on('tool', buildStrip);
  // A page is thrown away and built again whenever the editor likes, and what
  // was drawn on it goes with it: the matches are laid on the pages again after
  // every change to them. A layer that is still the layer this reading asked for
  // is left where it is, so this does not chase its own tail.
  new MutationObserver(drawHits).observe(document.getElementById('pages'), {
    childList: true,
    subtree: true,
  });
  ctx.on('zoom', drawHits);
  /** The document changed: the pages are read again, and the matches with them. */
  ctx.on('doc', () => {
    if (ctx.tool === 'search') look().catch(() => {});
  });
  /** Another file is open: nothing read from the old one is worth keeping. */
  ctx.on('open', () => {
    read.clear();
    items = [];
    matches = [];
    at = -1;
    version += 1;
    paintCount();
    drawHits();
    if (ctx.tool === 'search') look().catch(() => {});
  });
  return ctx;
}

/** The language changed: the strip is written again in the new one. */
export function refresh() {
  buildStrip();
}
