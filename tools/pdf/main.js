/**
 * Wab Fit — the PDF tool's shell.
 *
 * The screen is three bands: the bar at the top (name, page x / n, undo, redo,
 * export), the page canvases in the middle, the tool bar at the bottom with a
 * contextual property strip above it. This module owns the shell — layout,
 * language, theme, the empty state, the tool selection and which page the bar
 * says is on screen. The pages themselves, their lazy rendering and the zoom
 * gestures are viewer.js's business, the bytes, the pdf.js handles and the
 * password gate are docstore.js's, the shared state is ctx.js's, the editing
 * itself is the tools' business, and writing the edited document out is
 * export.js's; this file wires them to the screen and nothing more.
 *
 * Two ways in, and they are the same code path afterwards:
 *
 *   · inside the app, the WebView posts `{type:'open', name, base64}` and the
 *     bytes arrive already read — the app picked the file;
 *   · in a browser, the person picks a file from a file input.
 *
 * The PDF never leaves the page. There is no fetch, no XHR and no beacon
 * anywhere below: the file is read locally, drawn locally, edited locally, and
 * handed back to the app as bytes (in a browser, as a download).
 */

import { t, setLang } from './i18n.js';
import { send, onMessage } from './bridge.js';
import { createCtx } from './ctx.js';
import { init as initDocstore, openBytes } from './docstore.js';
import { exportEdited } from './export.js';
import { init as initViewer } from './viewer.js';
import { init as initOverlay } from './overlay.js';
import { init as initPages } from './pages.js';
import { init as initProps, refresh as refreshProps } from './props.js';
import { init as initTextTool } from './tool-text.js';
import { init as initDrawTool } from './tool-draw.js';
import { init as initShapesTool } from './tool-shapes.js';
import { init as initImageTool } from './tool-image.js';
import { init as initSignTool } from './tool-sign.js';
import { init as initWhiteoutTool } from './tool-whiteout.js';
import { init as initEditTextTool } from './tool-edittext.js';
import { init as initUnlockTool, refresh as refreshUnlock } from './unlock.js';
import { init as initSearchTool, refresh as refreshSearch } from './search.js';
import { answer as answerCommand, init as initCommand, refresh as refreshCommand } from './command.js';

/* ── the tools ───────────────────────────────────────────────────────────── */

const TOOLS = [
  { id: 'select', key: 'tSelect', icon: 'select' },
  { id: 'search', key: 'tSearch', icon: 'search' },
  { id: 'text', key: 'tText', icon: 'text' },
  { id: 'draw', key: 'tDraw', icon: 'draw' },
  { id: 'highlight', key: 'tHighlight', icon: 'highlight' },
  { id: 'shapes', key: 'tShapes', icon: 'shapes' },
  { id: 'image', key: 'tImage', icon: 'image' },
  { id: 'sign', key: 'tSign', icon: 'sign' },
  { id: 'whiteout', key: 'tWhiteout', icon: 'whiteout' },
  { id: 'editText', key: 'tEditText', icon: 'editText' },
  { id: 'forms', key: 'tForms', icon: 'forms' },
  { id: 'pages', key: 'tPages', icon: 'pages' },
  { id: 'unlock', key: 'tUnlock', icon: 'unlock' },
];

/**
 * Inline SVG, stroke 1.7, 24×24, on `currentColor`. No emoji, no icon font:
 * one drawing per tool, and nothing that has to be downloaded.
 */
const ICONS = {
  select:
    '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.6"/>',
  search:
    '<circle cx="11" cy="11" r="6.5"/><path d="M15.8 15.8L20.5 20.5"/>',
  text:
    '<path d="M5 6.5V5h14v1.5"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  draw:
    '<path d="M4.5 19.5l.9-3.6L16 5.3l2.7 2.7L8.1 18.6z"/><path d="M14.8 6.5l2.7 2.7"/>',
  highlight:
    '<path d="M6 14.2l5.6-5.6 4.4 4.4-5.6 5.6H6z"/><path d="M3.5 20.5h9"/>'
    + '<path d="M12.9 6.1l2.4-2.4 4.4 4.4-2.4 2.4"/>',
  shapes:
    '<rect x="3.5" y="3.5" width="10" height="10" rx="1.5"/><circle cx="15.5" cy="15.5" r="5"/>',
  image:
    '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/>'
    + '<path d="M4.5 18l4.6-4.2 3.4 3 3-2.6 4 3.6"/>',
  sign:
    '<path d="M3.5 17c2.4 0 2.7-6.4 4.4-6.4s1 7.4 3.4 7.4 2.4-4.6 3.9-4.6 '
    + '1.3 3.1 3 3.1"/><path d="M3.5 20.5h17"/>',
  whiteout:
    '<path d="M8 19.5h12"/><path d="M15.6 5.4l4 4-8.6 8.6H7.4L4.2 14.8z"/>',
  editText:
    '<path d="M4 7h12"/><path d="M4 12.5h7"/><path d="M4 18h5"/>'
    + '<path d="M14.2 20l.8-3.1 4.2-4.2 2.3 2.3-4.2 4.2z"/>',
  forms:
    '<rect x="3.5" y="4.5" width="5" height="5" rx="1"/><path d="M4.8 7l1.2 1.2L8 5.8"/>'
    + '<path d="M11.5 7h9"/><rect x="3.5" y="14.5" width="5" height="5" rx="1"/>'
    + '<path d="M11.5 17h9"/>',
  pages:
    '<rect x="7.5" y="3.5" width="13" height="17" rx="2"/>'
    + '<path d="M4.5 6.5v13a1 1 0 0 0 1 1h11"/>',
  unlock:
    '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/>'
    + '<path d="M8 10.5V7.2a4 4 0 0 1 7.8-1.2"/><path d="M12 14v2.5"/>',
  undo: '<path d="M4 9h9.5a5.5 5.5 0 0 1 0 11H9"/><path d="M7.5 5.5L4 9l3.5 3.5"/>',
  redo: '<path d="M20 9h-9.5a5.5 5.5 0 0 0 0 11H15"/><path d="M16.5 5.5L20 9l-3.5 3.5"/>',
};

function svg(markup) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${markup}</svg>`;
}

/* ── state ───────────────────────────────────────────────────────────────── */

const params = new URLSearchParams(window.location.search);

/**
 * What is on the screen rather than in the document: the language, the theme
 * and the page being looked at. What each tool is set to lives in props.js,
 * beside the strip that shows it.
 */
const view = {
  lang: params.get('lang') === 'en' ? 'en' : 'ar',
  theme: params.get('theme') === 'light' ? 'light' : 'dark',
  page: 1,
};

/**
 * The one object this page's modules share. Everything about the DOCUMENT lives
 * in it — its sources, its model, its undo trail — and every module talks to
 * the others through it and its events. `doc` and `history` are REPLACED when
 * another document is opened, so they are always read through `ctx` and never
 * copied into a variable of one's own at boot.
 */
const ctx = createCtx();

const el = {
  root: document.documentElement,
  docName: document.getElementById('docName'),
  pageCount: document.getElementById('pageCount'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),
  exportBtn: document.getElementById('exportBtn'),
  stage: document.getElementById('stage'),
  pages: document.getElementById('pages'),
  toolbar: document.getElementById('toolbar'),
  openBtn: document.getElementById('openBtn'),
  blankBtn: document.getElementById('blankBtn'),
  fileInput: document.getElementById('fileInput'),
};

/* ── words, language and theme ───────────────────────────────────────────── */

function applyChrome() {
  el.root.lang = view.lang;
  el.root.dir = view.lang === 'ar' ? 'rtl' : 'ltr';
  el.root.dataset.theme = view.theme;
}

function paintLabels() {
  el.openBtn.textContent = t('openPdf');
  el.blankBtn.textContent = t('newBlank');
  el.exportBtn.textContent = t('export');
  el.undoBtn.setAttribute('aria-label', t('undo'));
  el.redoBtn.setAttribute('aria-label', t('redo'));
  el.undoBtn.innerHTML = svg(ICONS.undo);
  el.redoBtn.innerHTML = svg(ICONS.redo);

  for (const btn of el.toolbar.children) {
    const tool = TOOLS.find((candidate) => candidate.id === btn.dataset.tool);
    if (!tool) continue;
    const label = btn.querySelector('.tool-label');
    if (label) label.textContent = t(tool.key);
    btn.setAttribute('aria-label', t(tool.key));
  }

  refreshProps();
  refreshSearch();
  refreshUnlock();
  refreshCommand();
  updateBar();
}

function setLanguage(lang) {
  view.lang = lang === 'en' ? 'en' : 'ar';
  setLang(view.lang);
  applyChrome();
  paintLabels();
}

/* ── the bar ─────────────────────────────────────────────────────────────── */

/** The bar: the file's name, page x / n, and what the three buttons can do. */
function updateBar() {
  const count = ctx.doc.pages.length;
  el.docName.textContent = ctx.names.length > 0 ? ctx.names[0] : '—';
  el.pageCount.textContent = count === 0 ? '—' : t('pageOf', { x: view.page, n: count });
  el.exportBtn.disabled = count === 0;
  el.undoBtn.disabled = !ctx.history.canUndo;
  el.redoBtn.disabled = !ctx.history.canRedo;
}

/* ── the tool bar and the property strip ─────────────────────────────────── */

function buildToolbar() {
  el.toolbar.textContent = '';
  for (const tool of TOOLS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool';
    btn.dataset.tool = tool.id;
    btn.setAttribute('aria-pressed', String(tool.id === ctx.tool));
    btn.innerHTML = `${svg(ICONS[tool.icon])}<span class="tool-label"></span>`;
    btn.addEventListener('click', () => ctx.setTool(tool.id));
    el.toolbar.append(btn);
  }
}

/** The tool changed, wherever it was changed from: the row says which one is on. */
function onToolChanged(id) {
  for (const btn of el.toolbar.children) {
    btn.setAttribute('aria-pressed', String(btn.dataset.tool === id));
  }
}

/* ── the libraries ───────────────────────────────────────────────────────── */

/*
 * pdf.js and its worker are docstore.js's business — a file is opened there,
 * and the handle that comes back is what the pages below are drawn from. The
 * one library this file still fetches itself is the one that writes.
 */

/** pdf-lib writes; it is only fetched when something is about to be written. */
async function loadPdfLib() {
  return import('../vendor/pdf-lib.esm.min.js');
}

/* ── the two ways in ─────────────────────────────────────────────────────── */

function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64FromBytes(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(index, index + chunk)));
  }
  return btoa(binary);
}

/** A blank A4 page, written here and then opened like any other file. */
async function openBlankDocument() {
  const { PDFDocument } = await loadPdfLib();
  const pdf = await PDFDocument.create();
  pdf.addPage([595.28, 841.89]); // A4, in points
  const bytes = await pdf.save();
  await openBytes(ctx, '—', bytes);
}

/**
 * An earlier or later document put back where it was: undo and redo of a whole
 * state, newest last, exactly as the history in ctx.js keeps them. It is 'doc'
 * that tells the screen, the bar and every tool about it, just as a commit does.
 */
function restore(next) {
  ctx.doc = next;
  ctx.emit('doc', next);
}

function wireInputs() {
  el.openBtn.addEventListener('click', () => el.fileInput.click());
  el.blankBtn.addEventListener('click', () => {
    openBlankDocument().catch(() => send('error', { code: 'create-failed' }));
  });
  el.fileInput.addEventListener('change', () => {
    const file = el.fileInput.files && el.fileInput.files[0];
    el.fileInput.value = '';
    if (!file) return;
    file
      .arrayBuffer()
      .then((buffer) => openBytes(ctx, file.name, new Uint8Array(buffer)))
      .catch(() => send('error', { code: 'open-failed' }));
  });
  el.exportBtn.addEventListener('click', () => {
    exportDocument().catch(() => send('error', { code: 'export-failed' }));
  });
  // Undo and redo put a whole earlier document back; 'doc' tells the screen,
  // the bar and every tool about it, exactly as it does after a commit.
  el.undoBtn.addEventListener('click', () => restore(ctx.history.undo()));
  el.redoBtn.addEventListener('click', () => restore(ctx.history.redo()));
}

/* ── the keyboard a desktop has, and a phone has not ─────────────────────── */

/*
 * Nothing works only by keyboard: these are the shortcuts of the things the bar
 * already does, for a browser. Delete asks for the picked object to go — the
 * model change belongs to the overlay that owns the selection, so an event says
 * it rather than this file reaching into the document. Escape is the way back to
 * the select tool, which is the only tool with no panel of its own.
 */
function wireKeys() {
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, [contenteditable]')) return;
    const meta = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (meta && (key === 'z' || key === 'y')) {
      event.preventDefault();
      restore(key === 'y' || event.shiftKey ? ctx.history.redo() : ctx.history.undo());
      return;
    }
    if (event.key === 'Escape') {
      ctx.select(null);
      ctx.setTool('select');
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && ctx.selection) {
      event.preventDefault();
      ctx.emit('remove');
    }
  });
}

/** Hands finished bytes out: to the app when it is listening, else a download. */
function deliver(name, bytes) {
  const base64 = base64FromBytes(bytes);
  if (send('export', { name, base64 })) return;
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * The document itself, written out of the edit model — every page in its place,
 * every object on its page — and handed back to the app, or downloaded when
 * there is none. It is never a source file: what the person edited is what they
 * get, which is the whole point of the button.
 */
async function exportDocument() {
  if (ctx.doc.pages.length === 0 || ctx.sources.length === 0) return;
  const bytes = await exportEdited(ctx);
  const stored = ctx.names[0];
  const name = !stored || stored === '—' ? 'wabfit.pdf' : stored;
  deliver(name, bytes);
}

/* ── which page is on screen ─────────────────────────────────────────────── */

/*
 * The pages themselves are viewer.js's business: it builds one wrapper per
 * page, decides the fit, draws what is near the screen and owns the zoom. All
 * this file needs of them is which page the bar should count, and that is read
 * from the wrappers' own geometry — their `data-page` is one-based.
 */

let counting = false;

function updateCurrentPage() {
  if (ctx.doc.pages.length === 0 || el.pages.hidden) return;
  const rect = el.stage.getBoundingClientRect();
  const middle = rect.top + rect.height / 2;
  let nearest = view.page;
  let bestDistance = Infinity;
  for (const wrapper of el.pages.children) {
    const box = wrapper.getBoundingClientRect();
    const distance = Math.abs(box.top + box.height / 2 - middle);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = Number(wrapper.dataset.page);
    }
  }
  if (nearest !== view.page) {
    view.page = nearest;
    updateBar();
  }
}

function wireScroll() {
  el.stage.addEventListener('scroll', () => {
    if (counting) return;
    counting = true;
    window.requestAnimationFrame(() => {
      counting = false;
      updateCurrentPage();
    });
  });
}

/* ── what the app can say ────────────────────────────────────────────────── */

function wireBridge() {
  onMessage((message) => {
    if (message.type === 'open' && typeof message.base64 === 'string') {
      const name = typeof message.name === 'string' ? message.name : '';
      openBytes(ctx, name, bytesFromBase64(message.base64)).catch(() =>
        send('error', { code: 'open-failed' }),
      );
      return;
    }
    if (message.type === 'theme') {
      if (message.lang === 'ar' || message.lang === 'en') setLanguage(message.lang);
      if (message.theme === 'light' || message.theme === 'dark') {
        view.theme = message.theme;
        applyChrome();
      }
    }
    // The assistant's answer to what the command bar asked. It goes to the bar
    // untouched: reading it against the editor's closed list is the bar's own job.
    if (message.type === 'plan') answerCommand(message.plan);
  });
}

/* ── the events this module listens to ───────────────────────────────────── */

/**
 * The bar follows the document: how many pages there are, whether there is
 * anything to export, and whether undo and redo have anywhere to go. The pages
 * on the screen are viewer.js's business, and it listens to the same events.
 */
function wireEvents() {
  ctx.on('doc', () => {
    const count = ctx.doc.pages.length;
    if (view.page > count) view.page = count;
    updateBar();
  });

  /** A document was opened: it starts at the top of page one. */
  ctx.on('open', () => {
    view.page = 1;
    updateBar();
  });

  ctx.on('tool', onToolChanged);

  /** Bytes another module finished — an extracted document — go out the same way. */
  ctx.on('save', (payload) => {
    if (payload && payload.bytes) deliver(payload.name, payload.bytes);
  });
}

/* ── boot ────────────────────────────────────────────────────────────────── */

function boot() {
  initDocstore(ctx);
  initViewer(ctx);
  initOverlay(ctx);
  initPages(ctx);
  // The strip is built before the tools that read it, and every tool is handed
  // the same context: they find each other through it and nothing else.
  initProps(ctx);
  initTextTool(ctx);
  initDrawTool(ctx);
  initShapesTool(ctx);
  initImageTool(ctx);
  initSignTool(ctx);
  initWhiteoutTool(ctx);
  initEditTextTool(ctx);
  initSearchTool(ctx);
  initUnlockTool(ctx);
  initCommand(ctx);
  setLang(view.lang);
  applyChrome();
  buildToolbar();
  paintLabels();
  wireEvents();
  wireInputs();
  wireKeys();
  wireScroll();
  wireBridge();
  updateBar();
  send('ready');
}

boot();
