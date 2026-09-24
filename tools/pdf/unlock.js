/**
 * Wab Fit — the lock on a file, and taking it off.
 *
 * A PDF can be locked in two ways, and the panel below says which one the file
 * in hand carries, in the person's own words:
 *
 *   · an OWNER password — the file opens without any password but forbids
 *     printing, copying and editing. Most "locked" files are this one, and the
 *     restrictions can be taken off without a password at all;
 *   · a USER password — the file will not open until it is typed. Only the
 *     person's own password opens it: the field here asks for it, says so when
 *     it is wrong, and this file never guesses one. A forgotten user password is
 *     a dead end, and the panel says that too.
 *
 * ── why the copy is DRAWN and not rewritten ──
 *
 * The two libraries beside this page are pdf.js, which reads and decrypts and
 * cannot write, and pdf-lib, which writes and CANNOT decrypt — there is no
 * cipher of any kind in it, and `ignoreEncryption` only stops it complaining
 * about the one in the file. Copying a page out of an encrypted file with
 * pdf-lib therefore writes a PDF with no encryption dictionary whose page
 * content is still the ENCRYPTED bytes: it opens with no password and shows
 * nothing at all. So the unlocked copy is made the one way that is both true and
 * readable: pdf.js draws every page as it decrypted it — no password needed for
 * an owner-locked file, the typed one for a user-locked file — and pdf-lib
 * writes those drawings as the pages of a new, unencrypted PDF. The result line
 * says what came back: the pages of the copy are pictures.
 *
 * Nothing is uploaded and nothing is fetched: the file is read, decrypted,
 * drawn and written inside this page.
 */

import { t } from './i18n.js';
import { isEncrypted, pdfjsDoc, readPdf } from './docstore.js';
import { dress } from './pages-panel.js';

/* ── the copy ────────────────────────────────────────────────────────────── */

/** A page is drawn at this many pixels per point — about 144 dpi. */
const SCALE = 2;
/** A page bigger than this many pixels is memory spent on nothing. */
const MAX_PIXELS = 4200000;
/** The quality one drawn page is written at. */
const QUALITY = 0.85;

/** The bytes behind a canvas's data URL. */
function bytesOf(dataUrl) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

/** One page as pdf.js decrypted it: its pixels, and the size it shows at. */
async function drawPage(doc, index) {
  const page = await doc.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(SCALE, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) return null;
  // Paper is white and a JPEG has no transparency: a canvas left empty would come
  // back black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return {
    jpeg: bytesOf(canvas.toDataURL('image/jpeg', QUALITY)),
    width: base.width,
    height: base.height,
  };
}

/** The name the unlocked copy goes back under, beside the original's own. */
function unlockedName() {
  const stored = ctx.names[sourceIndex];
  const base = !stored || stored === '—' ? 'wabfit' : stored.replace(/\.pdf$/i, '');
  return `${base}-unlocked.pdf`;
}

/**
 * Every page of one pdf.js document — which is already decrypted — written out
 * as the pages of a new PDF and handed to the same save path an export uses.
 */
async function write(doc) {
  const { PDFDocument } = await import('../vendor/pdf-lib.esm.min.js');
  const out = await PDFDocument.create();
  out.setProducer('Wab Fit');
  for (let index = 0; index < doc.numPages; index += 1) {
    const drawn = await drawPage(doc, index);
    if (!drawn) continue;
    const image = await out.embedJpg(drawn.jpeg);
    const page = out.addPage([drawn.width, drawn.height]);
    page.drawImage(image, { x: 0, y: 0, width: drawn.width, height: drawn.height });
  }
  ctx.emit('save', { name: unlockedName(), bytes: await out.save({ addDefaultPage: false }) });
}

/* ── what the screen holds ───────────────────────────────────────────────── */

let ctx = null;
let el = null;
/** Which lock the file in hand carries: 'none', 'owner' or 'user'. */
let kind = 'none';
/** The source the panel is about: the document, unless a merge named another. */
let sourceIndex = 0;
/** The line under the action once something was done, by key, or null. */
let said = null;
let busy = false;

/** One line of the panel's words. Its text is written by `paint`. */
function line() {
  return dress(document.createElement('p'), {
    margin: '0', color: 'var(--muted)', 'font-size': '13px', 'font-weight': '700',
  });
}

/** The panel: a head, what the file is, the one action, and what came back. */
function build() {
  const panel = dress(document.createElement('div'), {
    position: 'fixed', inset: '0', 'z-index': '8', display: 'flex', 'flex-direction': 'column',
    background: 'var(--bg)', 'padding-block-end': 'env(safe-area-inset-bottom, 0px)',
  });
  panel.hidden = true;

  const head = dress(document.createElement('div'), {
    display: 'flex', 'align-items': 'center', gap: 'var(--s-sm)',
    padding: 'var(--s-sm) var(--s-md)', background: 'var(--surface)',
    'border-block-end': '1px solid var(--line)',
  });
  const title = dress(document.createElement('span'), { 'font-weight': '700' });
  const done = dress(document.createElement('button'), { 'margin-inline-start': 'auto' });
  done.type = 'button';
  done.className = 'btn primary';
  done.addEventListener('click', () => ctx.setTool('select'));
  head.append(title, done);

  const body = dress(document.createElement('div'), {
    flex: '1 1 auto', overflow: 'auto', display: 'flex', 'flex-direction': 'column',
    gap: 'var(--s-md)', padding: 'var(--s-md)', '-webkit-overflow-scrolling': 'touch',
  });
  const lines = dress(document.createElement('div'), {
    display: 'flex', 'flex-direction': 'column', gap: 'var(--s-xs)',
  });
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'btn primary';
  action.addEventListener('click', () => {
    run().catch(() => undefined);
  });
  const result = dress(document.createElement('p'), {
    margin: '0', color: 'var(--accent-text)', 'font-weight': '700',
  });
  body.append(lines, action, result);

  panel.append(head, body);
  document.body.append(panel);
  return { panel, title, done, lines, action, result };
}

/** What the panel says about the file in hand — nothing at all when there is none. */
function statusKeys() {
  if (ctx.doc.pages.length === 0 || !ctx.sources[sourceIndex]) return [];
  if (kind === 'owner') return ['lockOwner'];
  if (kind === 'user') return ['lockUser', 'lockForgotten'];
  return ['lockNone'];
}

/** The panel in the language that is on right now, for the lock in hand. */
function paint() {
  if (!el) return;
  el.title.textContent = t('tUnlock');
  el.done.textContent = t('done');
  el.action.textContent = t('unlockNow');
  el.lines.textContent = '';
  for (const key of statusKeys()) {
    const node = line();
    node.textContent = t(key);
    el.lines.append(node);
  }
  const ready = !busy && kind !== 'none' && ctx.doc.pages.length > 0;
  el.action.disabled = !ready;
  el.action.style.setProperty('opacity', ready ? '1' : '0.4');
  el.result.hidden = said === null;
  el.result.textContent = said === null ? '' : t(said);
}

/* ── which lock the file carries ─────────────────────────────────────────── */

/**
 * Read once every time a file is opened, so the panel already knows. An /Encrypt
 * in the trailer is what pdf.js answers with a permission list for — null when
 * there is none, empty when the file grants nothing — and a file pdf.js had to be
 * given a password for is the one that will not open without it.
 */
async function readKind() {
  const at = sourceIndex;
  kind = 'none';
  said = null;
  const handle = pdfjsDoc(at);
  if (ctx.sources[at] && handle) {
    const permissions = await handle.getPermissions();
    // A merge may have named another source meanwhile: this answer is stale.
    if (at !== sourceIndex) return;
    if (isEncrypted(at)) kind = 'user';
    else if (Array.isArray(permissions)) kind = 'owner';
  }
  paint();
}

/* ── the one action ──────────────────────────────────────────────────────── */

/**
 * The tap: take the lock off what is in hand, then say what came back. A
 * `password` already in hand — the one main.js just opened the file with, or the
 * one a merge's gate was answered with — is used instead of asking a second time.
 */
async function run(password = null) {
  if (busy || kind === 'none' || ctx.doc.pages.length === 0) return;
  busy = true;
  said = null;
  paint();
  try {
    if (kind === 'user') {
      // The person's own password, typed into the page's gate: pdf.js opens the
      // file with it, says so when it is wrong, and lets them try again. Nothing
      // here guesses, and there is no list of words to try.
      const opened = await readPdf(ctx.sources[sourceIndex], password);
      if (!opened) return;
      try {
        await write(opened.doc);
      } finally {
        Promise.resolve(opened.doc.destroy()).catch(() => undefined);
      }
      said = 'unlockedUser';
    } else {
      const handle = pdfjsDoc(sourceIndex);
      if (!handle) return;
      await write(handle);
      said = 'unlockedOwner';
    }
  } catch {
    said = 'unlockFailed';
  } finally {
    busy = false;
    paint();
  }
}

/* ── boot ────────────────────────────────────────────────────────────────── */

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(context) {
  ctx = context;
  el = build();
  ctx.on('tool', (id) => {
    if (id !== 'unlock') {
      el.panel.hidden = true;
      return;
    }
    el.panel.hidden = false;
    // Tapped in the bar: the panel is about the document in hand. A merge that
    // asked for a source's lock to come off sets the index again right after.
    sourceIndex = 0;
    readKind().catch(() => undefined);
  });
  // A file was opened: what it is locked with is read before anything is asked
  // of it, and the document is source 0 again.
  ctx.on('open', () => {
    sourceIndex = 0;
    readKind().catch(() => undefined);
  });
  ctx.on('doc', () => {
    if (!el.panel.hidden) paint();
  });
  paint();
  return ctx;
}

/** The language changed: the panel is written again in the new one. */
export function refresh() {
  paint();
}

/**
 * A locked file was just opened — or a locked file just joined a merge — and its
 * person asked, in the gate itself, for the lock to come off: the tool comes up
 * and its one action runs with the password that is already in hand, so the
 * unlocked copy is written without a second question. `source` names the source
 * the copy is written from: the document, or the one a merge just registered.
 */
export async function removeLock(password, source = 0) {
  if (!ctx) return;
  ctx.setTool('unlock');
  // A tap in the bar means the document; this call names the source the copy is
  // to be written from, so it is set after the tool is entered.
  sourceIndex = source;
  // The lock in hand is read before the action looks at it: when the tool is
  // entered this way the panel has only just been shown.
  await readKind().catch(() => undefined);
  await run(password);
}
