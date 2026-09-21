/**
 * Wab Fit — the photo editor's shell.
 *
 * Three bands, top to bottom: a slim bar (undo, redo, compare, export), the
 * canvas area, and the tool bar of icon buttons with a one-word label. This
 * module owns the shell and nothing else: the language and theme the page is in,
 * the empty state, which tools exist, and the two ways in — open.js reads the
 * photo, this file only hands it the click and the message. The pixels are the
 * pipeline's business and the edits are the tools' business; both talk through
 * ctx.js and its events. The bar's buttons and their drawings are toolbar.js's.
 *
 * THE TOOL BAR IS BUILT FROM WHAT IS THERE. Each tool is one file exporting
 * `init(ctx)`; this module fetches each file named in toolbar.js and hands it to
 * `registerTool`, and only a tool that arrived gets a button, labelled from
 * i18n. A tool whose file does not exist yet is not drawn at all — no stub, no
 * disabled button, no "coming soon" — which is what lets the later parts of this
 * app arrive as new files and nothing else.
 *
 * The photo never leaves the page: no fetch, no XHR, no beacon to any other
 * origin, no analytics, no CDN at runtime. What the app hands over is a base64
 * photo, and what it gets back is a base64 photo.
 */

import { setLang, t } from './i18n.js';
import { onMessage, sendDirty, sendReady } from './bridge.js';
import { createCtx } from './ctx.js';
import { init as initOpen } from './open.js';
import { init as initView } from './view.js';
import { init as initExport } from './export.js';
import { ICONS, TOOLS, buildToolbar, paintToolbar, svg } from './toolbar.js';

/* ── the page ────────────────────────────────────────────────────────────── */

const query = new URLSearchParams(window.location.search);

/** What is on the screen rather than in the photo: language, theme, name. */
const view = {
  lang: query.get('lang') === 'en' ? 'en' : 'ar',
  theme: query.get('theme') === 'light' ? 'light' : 'dark',
  /** The file's name, so a finished export is called what it was called. */
  name: '',
  /** True while the compare button is held down. */
  comparing: false,
};

const ctx = createCtx();

/** The tools whose files were found, by id. Everything the bar draws is here. */
const loaded = new Map();

const el = {
  root: document.documentElement,
  empty: document.getElementById('empty'),
  openBtn: document.getElementById('openBtn'),
  canvas: document.getElementById('view'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),
  compareBtn: document.getElementById('compareBtn'),
  exportBtn: document.getElementById('exportBtn'),
};

/* ── words, language and theme ───────────────────────────────────────────── */

function applyChrome() {
  el.root.lang = view.lang;
  el.root.dir = view.lang === 'ar' ? 'rtl' : 'ltr';
  el.root.dataset.theme = view.theme;
}

function paintLabels() {
  el.openBtn.textContent = t('openPhoto');
  el.exportBtn.textContent = t('export');
  for (const [button, key] of [
    [el.undoBtn, 'undo'],
    [el.redoBtn, 'redo'],
    [el.compareBtn, 'compare'],
  ]) {
    button.setAttribute('aria-label', t(key));
  }
  el.undoBtn.innerHTML = svg(ICONS.undo);
  el.redoBtn.innerHTML = svg(ICONS.redo);
  el.compareBtn.innerHTML = svg(ICONS.compare);
  paintToolbar(ctx);
  updateBar();
}

function setLanguage(lang) {
  view.lang = lang === 'en' ? 'en' : 'ar';
  setLang(view.lang);
  applyChrome();
  paintLabels();
}

/* ── the bar ─────────────────────────────────────────────────────────────── */

/** Undo and redo follow the trail; compare and export follow the photo. */
function updateBar() {
  const open = ctx.image !== null;
  el.empty.hidden = open;
  el.canvas.hidden = !open;
  el.undoBtn.disabled = !ctx.history.canUndo;
  el.redoBtn.disabled = !ctx.history.canRedo;
  el.compareBtn.disabled = !open;
  el.exportBtn.disabled = !open;
}

/* ── the tools ───────────────────────────────────────────────────────────── */

/**
 * A tool has arrived: its button is drawn and it starts running. Called by the
 * loader below, and callable by any file that holds the page as a module.
 */
export function registerTool(name, module) {
  const known = TOOLS.some((tool) => tool.id === name);
  if (!known || loaded.has(name) || !module || typeof module.init !== 'function') return;
  loaded.set(name, module);
  module.init(ctx);
  buildToolbar(ctx, loaded);
  if (!ctx.tool) ctx.setTool(name);
}

/**
 * The tools whose file sits with the others under `tools/`. The bar's own list
 * names a file for every tool, and for these two that name points beside this
 * module; the loader prefers this map, so nothing is fetched from a place that
 * holds nothing — a page that asks for a missing file collects a 404 in the
 * console, and the console is meant to stay empty.
 */
const FILES = {
  swap: './tools/swap.js',
  background: './tools/background.js',
};

/**
 * Fetch each tool's file once, in order. A tool that is not there yet is not an
 * error the page reports — it is simply not offered, which is how the tools of
 * the later parts arrive without a line changing here.
 */
async function loadTools() {
  for (const tool of TOOLS) {
    if (loaded.has(tool.id)) continue;
    try {
      registerTool(tool.id, await import(FILES[tool.id] || tool.file));
    } catch {
      // No file, no button, nothing to say.
    }
  }
}

/* ── the controls ────────────────────────────────────────────────────────── */

/** Compare is HELD, not toggled: the original shows while the finger is down. */
function setCompare(on) {
  if (view.comparing === on) return;
  view.comparing = on;
  el.compareBtn.setAttribute('aria-pressed', String(on));
  ctx.emit('compare', on);
}

function wireInputs() {
  el.undoBtn.addEventListener('click', () => ctx.undo());
  el.redoBtn.addEventListener('click', () => ctx.redo());
  el.exportBtn.addEventListener('click', () => ctx.emit('export', { name: view.name }));
  el.compareBtn.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    setCompare(true);
  });
  for (const done of ['pointerup', 'pointercancel', 'pointerleave']) {
    el.compareBtn.addEventListener(done, () => setCompare(false));
  }
}

/* ── what the app can say ────────────────────────────────────────────────── */

function wireBridge() {
  onMessage((message) => {
    if (message.type !== 'theme') return;
    if (message.lang === 'ar' || message.lang === 'en') setLanguage(message.lang);
    if (message.theme === 'light' || message.theme === 'dark') {
      view.theme = message.theme;
      applyChrome();
    }
  });
}

/* ── the events this module listens to ───────────────────────────────────── */

function wireEvents() {
  /** A photo was opened: the bar has something to act on, and a name for it. */
  ctx.on('image', (payload) => {
    view.name = payload && typeof payload.name === 'string' ? payload.name : '';
    updateBar();
  });

  /** An edit, an undo or a redo: the two arrows, and the app's dirty flag. */
  ctx.on('history', () => {
    updateBar();
    sendDirty(ctx.dirty);
  });

  ctx.on('tool', () => paintToolbar(ctx));
}

/* ── boot ────────────────────────────────────────────────────────────────── */

function boot() {
  setLang(view.lang);
  initOpen(ctx);
  initView(ctx);
  initExport(ctx);
  buildToolbar(ctx, loaded);
  wireEvents();
  wireInputs();
  wireBridge();
  sendReady();
  loadTools();
}

boot();
