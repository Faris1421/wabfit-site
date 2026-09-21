/**
 * Wab Fit — the PDF tool's document core.
 *
 * This file owns two things and nothing else: the SHAPE of an edit, and the one
 * piece of code that turns that shape into a PDF. Nothing here touches the DOM,
 * the network or a clock, so the same module runs inside the page and inside
 * Node under vitest, and the whole test suite runs against the real pdf-lib.
 *
 * ── the edit model ──
 *
 * A document is plain JSON — `{pages, objects}` — because it is the thing undo,
 * redo and the on-device cache hold on to. No class instances, no Date, no Map:
 * anything else would not survive being written down and read back.
 *
 *   PageRef = {src, index, rotate, blank?}
 *     `src` is the position of a source PDF in the caller's own list of byte
 *     arrays; `index` is the page inside it. A blank page is its own page, with
 *     `src: -1` and `blank: {w, h}` — the box it was created with.
 *
 *     `rotate` is a quarter turn applied ON TOP of whatever the source page
 *     already carries, which is what makes rotatePage a +90/-90: a page that
 *     arrives rotated 90 and is turned once more is drawn at 180, and one that
 *     arrives straight and is turned once is drawn at 90.
 *
 *   Obj = text | ink | rect/ellipse/line/arrow | image | whiteout
 *     `kind` says which of them it is — and for a shape it is the shape itself,
 *     so one switch draws every object there is. Every object carries the
 *     position of its page in `pages`, so an object follows its page when pages
 *     move and disappears with it when they do.
 *
 * ── coordinates ──
 *
 * Every x/y/w/h in the model is measured in PDF points from the TOP-left corner
 * of the page AS IT IS DISPLAYED — the rotated page the person actually sees,
 * which is why the box is the same box the canvas drew. `toPdfSpace` and
 * `toTopLeft` walk between that frame and pdf-lib's, which counts from the
 * bottom-left of the unrotated page and turns nothing.
 *
 * ── text ──
 *
 * pdf-lib embeds a font by its character codes and cannot shape Arabic: a
 * right-to-left run written as text comes out disconnected and backwards. So
 * text that fits Latin-1 is written as real, selectable text with Helvetica,
 * and text that does not (`needsImageText`) is drawn from a PNG the browser
 * rendered and passed in at export time.
 *
 * The PDF never leaves the device. There is no fetch, no XHR and no beacon
 * anywhere below.
 */

import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFTextField,
  LineCapStyle,
  StandardFonts,
  degrees,
  rgb,
} from '../vendor/pdf-lib.esm.min.js';

/* ── limits ─────────────────────────────────────────────────────────────── */

/** How many states the undo stack keeps before it starts forgetting. */
const HISTORY_LIMIT = 100;
/** A blank page with no usable size of its own is A4 portrait, in points. */
const A4 = { w: 595.28, h: 841.89 };
/** Line box of written text, in multiples of the font size. */
export const TEXT_LINE_HEIGHT = 1.25;
/** Distance from the top of a text box down to the first baseline, in ems. */
const TEXT_ASCENT = 0.82;
const BLACK = '000000';
const WHITE = 'ffffff';

/* ── rotations and coordinates ──────────────────────────────────────────── */

/** Anything at all becomes one of 0, 90, 180, 270. */
export function normalizeRotation(value) {
  const angle = Math.round(Number(value));
  if (!Number.isFinite(angle)) return 0;
  const wrapped = ((angle % 360) + 360) % 360;
  return wrapped === 90 || wrapped === 180 || wrapped === 270 ? wrapped : 0;
}

/** The size a page shows at when it is displayed with this rotation. */
export function displaySize(size, rotate) {
  const angle = normalizeRotation(rotate);
  const swapped = angle === 90 || angle === 270;
  return swapped
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

/**
 * A point on the displayed page (top-left origin) as pdf-lib wants it
 * (bottom-left origin of the unrotated page). `size` is the page's own box,
 * never the displayed one.
 */
export function toPdfSpace(x, y, size, rotate) {
  switch (normalizeRotation(rotate)) {
    case 90:
      return { x: y, y: x };
    case 180:
      return { x: size.width - x, y };
    case 270:
      return { x: size.width - y, y: size.height - x };
    default:
      return { x, y: size.height - y };
  }
}

/** The other way: a pdf-lib point back onto the displayed page. */
export function toTopLeft(x, y, size, rotate) {
  switch (normalizeRotation(rotate)) {
    case 90:
      return { x: y, y: x };
    case 180:
      return { x: size.width - x, y };
    case 270:
      return { x: size.height - y, y: size.width - x };
    default:
      return { x, y: size.height - y };
  }
}

/* ── identity ───────────────────────────────────────────────────────────── */

const SESSION = Math.random().toString(36).slice(2, 7);
let sequence = 0;

/**
 * A new object id. Unique within the session that made it, and unique against
 * ids from earlier sessions too, because an id is what a redone edit and a
 * reopened document agree on.
 */
export function newId() {
  sequence += 1;
  return `${SESSION}-${sequence.toString(36)}`;
}

/** A document with nothing in it. */
export function emptyDoc() {
  return { pages: [], objects: [] };
}

/* ── copies ─────────────────────────────────────────────────────────────── */

function clonePage(page) {
  const copy = { src: page.src, index: page.index, rotate: normalizeRotation(page.rotate) };
  if (page.blank) copy.blank = { w: page.blank.w, h: page.blank.h };
  return copy;
}

function cloneObj(obj) {
  if (obj.kind === 'ink') return { ...obj, points: obj.points.map(([x, y]) => [x, y]) };
  return { ...obj };
}

function cloneObjects(objects) {
  return objects.map(cloneObj);
}

/**
 * Rebuilds a document around a new page order, given as the OLD index of every
 * new position. Pages keep their own identity, objects follow the page they
 * were drawn on, and an object whose page is not in the order is gone.
 *
 * An old page named twice in the order (a duplicate) keeps its objects on the
 * FIRST of the two: the copy is made by the caller, with objects of its own.
 */
function around(doc, order) {
  const moved = new Map();
  for (let at = 0; at < order.length; at += 1) {
    if (!moved.has(order[at])) moved.set(order[at], at);
  }
  const objects = [];
  for (const obj of doc.objects) {
    const page = moved.get(obj.page);
    if (page === undefined) continue;
    objects.push({ ...cloneObj(obj), page });
  }
  return { pages: order.map((from) => clonePage(doc.pages[from])), objects };
}

/** The order that leaves the document alone. */
function order(doc) {
  return doc.pages.map((_, at) => at);
}

function within(value, low, high) {
  return Number.isInteger(value) && value >= low && value < high;
}

/* ── page operations ────────────────────────────────────────────────────── */

/**
 * Takes the page at `from` out and puts it back at `to`, counted in the list
 * that is left behind. Objects travel with their page; z-order is untouched.
 */
export function movePage(doc, from, to) {
  const count = doc.pages.length;
  if (!within(from, 0, count)) return doc;
  const target = Math.min(Math.max(Math.trunc(Number(to)) || 0, 0), count - 1);
  if (from === target) return doc;
  const next = order(doc);
  const [taken] = next.splice(from, 1);
  next.splice(target, 0, taken);
  return around(doc, next);
}

/** A quarter turn, +90 or -90, on the page's own rotation. */
export function rotatePage(doc, index, delta) {
  if (!within(index, 0, doc.pages.length)) return doc;
  const pages = doc.pages.map(clonePage);
  pages[index].rotate = normalizeRotation(pages[index].rotate + delta);
  return { pages, objects: cloneObjects(doc.objects) };
}

/** Removes a page and everything drawn on it. */
export function deletePage(doc, index) {
  if (!within(index, 0, doc.pages.length)) return doc;
  const next = order(doc);
  next.splice(index, 1);
  return around(doc, next);
}

/**
 * Puts a copy of a page directly after it. The copy is its own page — a new
 * copy of every object with a new id, so editing one does not edit the other.
 */
export function duplicatePage(doc, index) {
  if (!within(index, 0, doc.pages.length)) return doc;
  const next = order(doc);
  next.splice(index + 1, 0, index);
  const copy = around(doc, next);
  for (const obj of doc.objects) {
    if (obj.page !== index) continue;
    copy.objects.push({ ...cloneObj(obj), id: newId(), page: index + 1 });
  }
  return copy;
}

/**
 * A new empty page at `at`, `size` points across and down. `size` is the page's
 * own box, so a page inserted at 150×250 shows at 150×250 wide until it is
 * turned. A size that is missing or unusable becomes A4 portrait.
 */
export function insertBlank(doc, at, size) {
  const count = doc.pages.length;
  const position = Math.min(Math.max(Math.trunc(Number(at)) || 0, 0), count);
  const w = Number(size && size.w) > 0 ? Number(size.w) : A4.w;
  const h = Number(size && size.h) > 0 ? Number(size.h) : A4.h;
  const pages = doc.pages.map(clonePage);
  pages.splice(position, 0, { src: -1, index: 0, rotate: 0, blank: { w, h } });
  const objects = doc.objects.map((obj) => (
    obj.page >= position ? { ...cloneObj(obj), page: obj.page + 1 } : cloneObj(obj)
  ));
  return { pages, objects };
}

/**
 * Every page of one more source PDF, in order, at the end of the document.
 * `srcIndex` is the position of that PDF's bytes in the caller's own list.
 */
export function appendSource(doc, srcIndex, pageCount) {
  const src = Math.trunc(Number(srcIndex));
  const count = Math.trunc(Number(pageCount));
  if (!Number.isInteger(src) || src < 0) return doc;
  if (!Number.isFinite(count) || count <= 0) return doc;
  const pages = doc.pages.map(clonePage);
  for (let index = 0; index < count; index += 1) pages.push({ src, index, rotate: 0 });
  return { pages, objects: cloneObjects(doc.objects) };
}

/**
 * A document holding only the pages asked for, in the order they are asked for.
 * Each page is taken at most once; objects on the pages that stay follow them.
 */
export function extract(doc, indices) {
  const wanted = [];
  for (const index of indices) {
    if (within(index, 0, doc.pages.length) && !wanted.includes(index)) wanted.push(index);
  }
  return around(doc, wanted);
}

/* ── undo and redo ──────────────────────────────────────────────────────── */

/**
 * The states a document has been in. `push` is called with the whole next
 * document after an edit; `undo` and `redo` answer with the state to show, and
 * the caller reads `state` for the current one. A push after an undo throws the
 * redo trail away, and only the newest hundred states are kept.
 */
export function history(initial) {
  const states = [initial];
  let at = 0;
  return {
    get state() {
      return states[at];
    },
    get canUndo() {
      return at > 0;
    },
    get canRedo() {
      return at < states.length - 1;
    },
    push(next) {
      states.length = at + 1;
      states.push(next);
      if (states.length > HISTORY_LIMIT) states.shift();
      at = states.length - 1;
      return states[at];
    },
    undo() {
      if (at > 0) at -= 1;
      return states[at];
    },
    redo() {
      if (at < states.length - 1) at += 1;
      return states[at];
    },
  };
}

/* ── text: written, or drawn from a picture ─────────────────────────────── */

/**
 * True when the text holds a character pdf-lib cannot write as text: anything
 * outside Latin-1, which is every Arabic letter. Such text has to arrive at
 * export as a PNG the browser rendered.
 */
export function needsImageText(text) {
  if (typeof text !== 'string') return false;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code !== undefined && code > 0xff) return true;
  }
  return false;
}

/** The lines of a text object, split the way the writer split them. */
export function textLines(text) {
  return typeof text === 'string' ? text.split(/\r\n|\r|\n/) : [];
}

/**
 * Where a line's baseline starts, on the displayed page. The box decides where
 * text begins and the font size decides how far apart the lines are, so a
 * renderer and this writer place the same glyphs in the same place.
 */
export function textBaseline(obj, line) {
  const at = Number.isInteger(line) ? line : 0;
  return { x: obj.x, y: obj.y + obj.size * (TEXT_ASCENT + TEXT_LINE_HEIGHT * at) };
}

/* ── drawing ────────────────────────────────────────────────────────────── */

function rgbOf(value, fallback) {
  const hex = typeof value === 'string' ? value.trim().replace(/^#/, '') : '';
  const full = /^[0-9a-f]{6}$/i.test(hex)
    ? hex
    : /^[0-9a-f]{3}$/i.test(hex)
      ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
      : fallback;
  return rgb(
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  );
}

/** pdf-lib takes a bare base64 string; a data URL has to be unwrapped first. */
function base64Of(value) {
  if (typeof value !== 'string') return '';
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma > -1 ? value.slice(comma + 1) : value;
}

function opacityOf(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(1, Math.max(0, number));
}

/** The axis-aligned pdf-lib box a displayed box covers, whatever the rotation. */
function pdfBox(box, size, rotate) {
  const a = toPdfSpace(box.x, box.y, size, rotate);
  const b = toPdfSpace(box.x + box.w, box.y + box.h, size, rotate);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Where an arrow's two head strokes end, one on each side of the shaft. */
function arrowHead(from, to, width) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.max(width * 3.5, 6);
  return [angle + Math.PI / 7, angle - Math.PI / 7].map((side) => ({
    x: to.x - Math.cos(side) * length,
    y: to.y - Math.sin(side) * length,
  }));
}

async function drawPicture(out, page, place, box, pngBase64) {
  const data = base64Of(pngBase64);
  if (!data) return;
  const image = await out.embedPng(data);
  const width = box.w > 0 ? box.w : image.width;
  const height = box.h > 0 ? box.h : image.height;
  const anchor = toPdfSpace(box.x, box.y + height, place.size, place.rotation);
  page.drawImage(image, {
    x: anchor.x,
    y: anchor.y,
    width,
    height,
    rotate: degrees(place.rotation),
  });
}

async function drawObjects(out, page, place, objects, rasters, fonts) {
  for (const obj of objects) {
    switch (obj.kind) {
      case 'text': {
        if (obj.asImage) {
          const raster = rasters[obj.id];
          if (raster) await drawPicture(out, page, place, obj, raster.pngBase64);
          break;
        }
        const font = await fonts.for(obj.bold === true);
        const color = rgbOf(obj.color, BLACK);
        const lines = textLines(obj.text);
        for (let line = 0; line < lines.length; line += 1) {
          const written = textBaseline(obj, line);
          const at = toPdfSpace(written.x, written.y, place.size, place.rotation);
          page.drawText(lines[line], {
            x: at.x,
            y: at.y,
            size: obj.size,
            font,
            color,
            rotate: degrees(place.rotation),
          });
        }
        break;
      }

      case 'ink': {
        const color = rgbOf(obj.color, BLACK);
        const thickness = obj.width > 0 ? obj.width : 1;
        const opacity = opacityOf(obj.opacity);
        const points = obj.points.map(([x, y]) => toPdfSpace(x, y, place.size, place.rotation));
        if (points.length === 1) {
          page.drawCircle({ x: points[0].x, y: points[0].y, size: thickness / 2, color, opacity });
          break;
        }
        for (let at = 1; at < points.length; at += 1) {
          page.drawLine({
            start: points[at - 1],
            end: points[at],
            thickness,
            color,
            opacity,
            lineCap: LineCapStyle.Round,
          });
        }
        break;
      }

      case 'rect':
      case 'ellipse':
      case 'line':
      case 'arrow': {
        const width = obj.width > 0 ? obj.width : 1;
        const border = typeof obj.stroke === 'string' && obj.stroke.trim() !== ''
          ? rgbOf(obj.stroke, BLACK)
          : undefined;
        const fill = typeof obj.fill === 'string' && obj.fill.trim() !== ''
          ? rgbOf(obj.fill, WHITE)
          : undefined;
        if (obj.kind === 'rect' || obj.kind === 'ellipse') {
          const box = pdfBox(obj, place.size, place.rotation);
          const common = { opacity: opacityOf(obj.opacity) };
          if (fill) {
            if (border) {
              page.drawRectangle({ ...box, color: fill, borderColor: border, borderWidth: width, ...common });
            } else {
              page.drawRectangle({ ...box, color: fill, ...common });
            }
          } else if (border) {
            page.drawRectangle({ ...box, borderColor: border, borderWidth: width, ...common });
          }
          break;
        }
        if (!border) break;
        const from = toPdfSpace(obj.x, obj.y, place.size, place.rotation);
        const to = toPdfSpace(obj.x + obj.w, obj.y + obj.h, place.size, place.rotation);
        const line = { thickness: width, color: border, opacity: opacityOf(obj.opacity), lineCap: LineCapStyle.Round };
        page.drawLine({ start: from, end: to, ...line });
        if (obj.kind === 'arrow') {
          const head = arrowHead({ x: obj.x, y: obj.y }, { x: obj.x + obj.w, y: obj.y + obj.h }, width);
          for (const side of head) {
            page.drawLine({
              start: to,
              end: toPdfSpace(side.x, side.y, place.size, place.rotation),
              ...line,
            });
          }
        }
        break;
      }

      case 'image':
        await drawPicture(out, page, place, obj, obj.pngBase64);
        break;

      case 'whiteout':
        page.drawRectangle({
          ...pdfBox(obj, place.size, place.rotation),
          color: rgbOf(obj.color, WHITE),
        });
        break;

      default:
        break;
    }
  }
}

/* ── forms ──────────────────────────────────────────────────────────────── */

/** A name for a field, empty rather than fatal when the PDF does not give one. */
function nameOf(field) {
  try {
    return typeof field.getName === 'function' ? String(field.getName() ?? '') : '';
  } catch {
    return '';
  }
}

/**
 * pdf-lib hands a copied page its widgets but leaves them out of the AcroForm,
 * where a viewer looks for fields. This puts every widget's field back on the
 * form and points the widget at the page it now lives on.
 */
function adoptFormFields(out, copied) {
  const form = out.catalog.getOrCreateAcroForm();
  const fields = form.Fields();
  if (!fields) return;
  const seen = new Set();
  for (const place of copied) {
    const annots = place.page.node.Annots();
    if (!annots) continue;
    for (let at = 0; at < annots.size(); at += 1) {
      const ref = annots.get(at);
      if (!(ref instanceof PDFRef)) continue;
      const annot = out.context.lookup(ref, PDFDict);
      if (!annot || String(annot.get(PDFName.of('Subtype'))) !== '/Widget') continue;
      const parent = annot.get(PDFName.of('Parent'));
      const fieldRef = parent instanceof PDFRef ? parent : ref;
      if (!seen.has(fieldRef.tag)) {
        fields.push(fieldRef);
        seen.add(fieldRef.tag);
      }
      annot.set(PDFName.of('P'), place.page.ref);
    }
  }
}

/* ── export ─────────────────────────────────────────────────────────────── */

/**
 * Writes the document into one new PDF and answers its bytes.
 *
 * `sources` is the caller's list of PDFs, in the order `PageRef.src` counts.
 * Every page in the document is copied into the new file in order — blank pages
 * are made rather than copied — each one turned by its own rotation, and then
 * every object is drawn on the page it belongs to, in z-order: whiteout is an
 * opaque rectangle, ink is round-capped segments, shapes are stroked and filled
 * as the model says, images are embedded PNGs.
 *
 * `rasterTexts` carries the pictures for text objects with `asImage: true`,
 * keyed by object id: `{pngBase64, w, h}`. Text that needs a picture and has
 * none is left out rather than written as broken glyphs.
 */
export async function exportPdf(sources, doc, rasterTexts) {
  const rasters = rasterTexts || {};
  const out = await PDFDocument.create();
  out.setProducer('Wab Fit');

  const loaded = [];
  for (const bytes of sources) {
    loaded.push(await PDFDocument.load(bytes, { ignoreEncryption: true }));
  }

  let regular = null;
  let bold = null;
  const fonts = {
    for: async (isBold) => {
      if (isBold) {
        if (!bold) bold = out.embedStandardFont(StandardFonts.HelveticaBold);
        return bold;
      }
      if (!regular) regular = out.embedStandardFont(StandardFonts.Helvetica);
      return regular;
    },
  };

  const copied = [];
  for (const ref of doc.pages) {
    if (ref.blank) {
      const rotation = normalizeRotation(ref.rotate);
      const page = out.addPage([Math.max(1, ref.blank.w), Math.max(1, ref.blank.h)]);
      page.setRotation(degrees(rotation));
      copied.push({ page, size: page.getSize(), rotation });
      continue;
    }
    const source = loaded[ref.src];
    if (!source || !within(ref.index, 0, source.getPageCount())) continue;
    const [page] = await out.copyPages(source, [ref.index]);
    out.addPage(page);
    const base = normalizeRotation(page.getRotation().angle);
    const rotation = normalizeRotation(base + ref.rotate);
    if (rotation !== base) page.setRotation(degrees(rotation));
    copied.push({ page, size: page.getSize(), rotation });
  }

  for (let at = 0; at < copied.length; at += 1) {
    const objects = doc.objects.filter((obj) => obj.page === at);
    if (objects.length > 0) await drawObjects(out, copied[at].page, copied[at], objects, rasters, fonts);
  }

  adoptFormFields(out, copied);

  // `addDefaultPage: false` keeps a document whose every page was deleted
  // empty, instead of writing a blank page the model never asked for.
  return out.save({ addDefaultPage: false });
}

/* ── filling in somebody else's form ───────────────────────────────────── */

/** What `listFormFields` says about one field. */
function describeField(field) {
  const name = nameOf(field);
  if (field instanceof PDFTextField) {
    return { name, type: 'text', value: field.getText() ?? '' };
  }
  if (field instanceof PDFCheckBox) {
    return { name, type: 'checkbox', value: field.isChecked() };
  }
  if (field instanceof PDFRadioGroup) {
    return { name, type: 'radio', value: field.getSelected() ?? '', options: field.getOptions() };
  }
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const selected = field.getSelected();
    return {
      name,
      type: 'dropdown',
      value: selected[0] ?? '',
      options: field.getOptions(),
    };
  }
  return { name, type: 'other', value: '' };
}

/** Every field of a PDF, in the order the form lists them. */
export async function listFormFields(bytes) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const fields = [];
  for (const field of pdf.getForm().getFields()) fields.push(describeField(field));
  return fields;
}

/** True for the values a switch is on for. */
function truthy(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  const word = value.trim().toLowerCase();
  return word === 'true' || word === 'on' || word === 'yes' || word === '1';
}

function applyValue(field, value) {
  if (field instanceof PDFTextField) {
    field.setText(typeof value === 'boolean' ? String(value) : String(value ?? ''));
    return;
  }
  if (field instanceof PDFCheckBox) {
    if (truthy(value)) field.check();
    else field.uncheck();
    return;
  }
  if (field instanceof PDFRadioGroup) {
    const choice = typeof value === 'string' ? value : '';
    if (field.getOptions().includes(choice)) field.select(choice);
    return;
  }
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const choice = typeof value === 'string' ? value : '';
    if (field.getOptions().includes(choice)) field.select(choice);
  }
}

/**
 * Writes values into a PDF's own form — somebody else's form, filled in.
 * `values` is keyed by field name, and a name the form does not have is
 * ignored rather than fatal. `flatten` bakes the answers into the page and
 * takes the fields out, so the result cannot be edited again.
 */
export async function fillForm(bytes, values, flatten) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  for (const name of Object.keys(values)) {
    const field = form.getFieldMaybe(name);
    if (field) applyValue(field, values[name]);
  }
  if (flatten) form.flatten();
  return pdf.save();
}
