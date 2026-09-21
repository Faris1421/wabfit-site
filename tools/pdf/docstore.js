/**
 * Wab Fit — where the PDFs come from, and the only place their bytes live.
 *
 * Everything in this app is done on the device. A file arrives either from the
 * file input or from the app over the bridge, its bytes are kept HERE — the
 * originals, untouched — and a COPY of them is handed to pdf.js, which detaches
 * the buffer it is given. The originals are what an export is written from, and
 * the only thing this page ever fetches is its own vendored library.
 *
 * One pdf.js handle is kept per source; a source that needed a password is
 * remembered too, because pdf-lib cannot write an encrypted file back.
 *
 * A locked file is asked for its password in the PAGE — an inline field, never
 * window.prompt, which a WebView blocks and which cannot say that the password
 * was wrong.
 */

import { t } from './i18n.js';
import { appendSource, emptyDoc, history } from './core.js';

/** Fetched the first time a file is opened, never at boot. */
let libPromise = null;

async function loadPdfjs() {
  if (!libPromise) {
    libPromise = import('../vendor/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      return lib;
    });
  }
  return libPromise;
}

/** srcIndex → the pdf.js document for that source. */
const handles = new Map();

/** The sources pdf.js had to unlock, which pdf-lib cannot write back. */
const locked = new Set();

let ctxRef = null;

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(ctx) {
  ctxRef = ctx;
  return ctx;
}

/** The pdf.js handle for one source, or null while it is not loaded. */
export function pdfjsDoc(srcIndex) {
  const found = handles.get(srcIndex);
  return found === undefined ? null : found;
}

/** True when that source arrived locked, so its export cannot carry a password. */
export function isEncrypted(srcIndex) {
  return locked.has(srcIndex);
}

/** A copy for pdf.js: it moves the buffer it is handed into its worker. */
function copyOf(bytes) {
  return new Uint8Array(bytes);
}

function isPasswordError(error) {
  return Boolean(error) && error.name === 'PasswordException';
}

/** The gate that is open right now, if any; calling it with null closes it. */
let openGate = null;

/**
 * One inline field, in the page itself. Answers the typed password, or null
 * when the person backs out (Escape, or a second file opened meanwhile).
 * A wrong password keeps the field open and says so above it.
 */
function askPassword(wrong) {
  if (openGate) openGate(null);
  return new Promise((resolve) => {
    const form = document.createElement('form');
    form.className = 'gate';
    const card = document.createElement('div');
    card.className = 'gate-card';

    const label = document.createElement('label');
    label.className = 'gate-label';
    label.textContent = t('password');
    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'gate-input';
    input.autocomplete = 'current-password';
    input.setAttribute('autocapitalize', 'off');
    label.append(input);
    card.append(label);

    if (wrong) {
      const error = document.createElement('p');
      error.className = 'gate-error';
      error.textContent = t('wrongPassword');
      card.append(error);
    }

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn primary';
    submit.textContent = t('done');
    card.append(submit);
    form.append(card);

    function onKey(event) {
      if (event.key === 'Escape') close(null);
    }

    function close(value) {
      openGate = null;
      document.removeEventListener('keydown', onKey);
      form.remove();
      resolve(value);
    }

    openGate = close;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value;
      if (!value) {
        input.focus();
        return;
      }
      close(value);
    });
    document.addEventListener('keydown', onKey);
    document.body.append(form);
    input.focus();
  });
}

/**
 * Hands bytes to pdf.js, asking for the password in the page when the file is
 * locked and asking again when it was wrong. Answers null when the person
 * backed out, otherwise `{doc, locked}`.
 *
 * A second caller opens a file with the lock tool, which is why this is handed
 * out: the field, the retry and the refusal to guess are the same ones either
 * way, and there is one password gate in this page, not two.
 */
export async function readPdf(bytes) {
  const lib = await loadPdfjs();
  let password = null;
  for (;;) {
    const options = password === null
      ? { data: copyOf(bytes) }
      : { data: copyOf(bytes), password };
    const task = lib.getDocument(options);
    try {
      const doc = await task.promise;
      return { doc, locked: password !== null };
    } catch (error) {
      if (!isPasswordError(error)) throw error;
      Promise.resolve(task.destroy()).catch(() => {});
      // pdf.js's INCORRECT_PASSWORD is 2; anything else is the first ask.
      password = await askPassword(error.code === 2);
      if (password === null) return null;
    }
  }
}

/** A file's name, or the em dash the rest of the app shows for missing data. */
function nameOf(name) {
  return typeof name === 'string' && name !== '' ? name : '—';
}

/**
 * Opens a PDF as THE document. Its bytes become source 0, every source opened
 * before it is forgotten, and the history starts again — a file that was just
 * opened is not an edit of the file that was open before it.
 */
export async function openBytes(ctx, name, bytes) {
  const app = ctx || ctxRef;
  if (!app) return null;
  const original = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const read = await readPdf(original);
  if (!read) return null;

  // Let the previous document's handles go: a phone has few workers to spare.
  for (const old of handles.values()) Promise.resolve(old.destroy()).catch(() => {});
  handles.clear();
  locked.clear();
  handles.set(0, read.doc);
  if (read.locked) locked.add(0);

  app.sources.length = 0;
  app.sources.push(original);
  app.names.length = 0;
  app.names.push(nameOf(name));

  app.doc = appendSource(emptyDoc(), 0, read.doc.numPages);
  app.history = history(app.doc);
  app.dirty = false;
  app.selection = null;
  app.emit('doc', app.doc);
  app.emit('open', { name: app.names[0], pages: app.doc.pages.length });
  return app.doc;
}

/**
 * Registers one more PDF as a source for a merge and answers where its pages
 * are: `{index, pageCount}`, or null when the password gate was abandoned.
 *
 * It does NOT touch the document — the pages tool decides which of those pages
 * it wants and commits once, so a cancelled merge leaves nothing behind.
 */
export async function addSource(ctx, name, bytes) {
  const app = ctx || ctxRef;
  if (!app) return null;
  const original = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const read = await readPdf(original);
  if (!read) return null;

  const index = app.sources.length;
  app.sources.push(original);
  app.names.push(nameOf(name));
  handles.set(index, read.doc);
  if (read.locked) locked.add(index);
  return { index, pageCount: read.doc.numPages };
}
