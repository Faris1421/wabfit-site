/**
 * Wab Fit — a plan applied through the editor's own operations.
 *
 * Every step below ends where a finger would have ended: core.js's page
 * operations for a page, and one mark made the way the tool that owns it makes it
 * — the text tool's measured box, the cover tool's colour, the highlighter's own
 * see-through block, the shapes tool's box. Nothing here writes a PDF, nothing
 * rewrites a source page, and nothing reaches into the model on its own.
 *
 * The WHOLE plan is applied to the document in memory and answered as ONE
 * document. That is the point of the operation: the caller hands that single
 * document to `ctx.commit`, so one undo takes the entire plan back — the same
 * way a single gesture commits once.
 *
 * A step that cannot be built exactly as it was read refuses the WHOLE plan, and
 * nothing is half-run: text with nothing that can measure it, a page that is no
 * longer there because an earlier step moved the document under it. Two things
 * only a browser can do — measuring a run of text, and reading the paper's colour
 * off a page — arrive through `opts`, which is why this module carries no DOM and
 * runs under Node beside check.mjs.
 */

import {
  deletePage, duplicatePage, insertBlank, movePage, needsImageText, newId, rotatePage,
  TEXT_LINE_HEIGHT,
} from './core.js';
import { settings } from './props.js';

/** What covers paper nothing could be read from, exactly as page-colours.js has it. */
const PAPER = '#ffffff';

/** A point is a hundredth of a point, and never finer than that. */
function round(value) {
  return Math.round(value * 100) / 100;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ── the pages the steps count ───────────────────────────────────────────── */

/**
 * The pages' own sizes in points, kept in step with the document as the steps
 * change it.
 *
 * A plan's page numbers move under it — a page is inserted, deleted, turned — and
 * the size a later step needs is the size of the page it names by THEN and not
 * the size that page had when the plan was read. So every step mirrors in this
 * list what core.js did to the document. A page whose size nobody measured stays
 * null, and null is answered as "not known" rather than guessed at.
 */
function tracker(cols) {
  const sizes = Array.isArray(cols) ? cols.slice() : [];
  const known = (index) => {
    const found = sizes[index];
    return found && found.w > 0 && found.h > 0 ? { w: found.w, h: found.h } : null;
  };
  return {
    at(page) {
      return Number.isInteger(page) && page >= 1 ? known(page - 1) : null;
    },
    add(index, size) {
      sizes.splice(index, 0, size || null);
    },
    drop(index) {
      sizes.splice(index, 1);
    },
    copy(index) {
      sizes.splice(index + 1, 0, known(index));
    },
    move(from, to) {
      sizes.splice(to, 0, sizes.splice(from, 1)[0] || null);
    },
    turn(index) {
      const found = known(index);
      if (found) sizes[index] = { w: found.h, h: found.w };
    },
  };
}

/** One page of the document as it stands now, or null when it is not there. */
function pageAt(doc, number) {
  return Number.isInteger(number) && number >= 1 && number <= doc.pages.length ? number - 1 : null;
}

/* ── one mark, made the way its tool makes it ────────────────────────────── */

/** One more object on the document, exactly as every tool adds one. */
function added(doc, mark) {
  return { pages: doc.pages, objects: doc.objects.concat([mark]) };
}

/**
 * Written text: the text tool's own object, in the size and ink that tool is set
 * to when the plan runs, in a box MEASURED from the run. `opts.measure` is that
 * measuring, and without it there is nothing here that knows how wide a run is —
 * which is a refusal, not an estimate.
 */
function textMark(args, opts, sizes) {
  if (typeof opts.measure !== 'function') return null;
  const set = settings('text');
  const size = args.size === null ? set.size : args.size;
  const color = args.color === null ? set.color : args.color;
  const bold = args.bold === null ? set.bold === true : args.bold;
  // The run wraps inside the page rather than running off it, as it does under a
  // finger: the width the page has left from where the text starts.
  const page = sizes.at(args.page);
  const room = page ? Math.max(40, page.w - args.x - 4) : 0;
  const measured = opts.measure(args.text, { size, color, bold }, room);
  if (!isRecord(measured) || !(measured.w > 0) || !(measured.h > 0)) return null;
  return {
    kind: 'text',
    id: newId(),
    page: args.page - 1,
    x: args.x,
    y: args.y,
    w: Math.max(round(room > 0 ? Math.min(measured.w, room) : measured.w), size * 0.6),
    h: Math.max(round(measured.h), size * TEXT_LINE_HEIGHT),
    text: args.text,
    size,
    color,
    bold,
    // Arabic cannot be written by pdf-lib: export draws it from a picture.
    asImage: needsImageText(args.text),
  };
}

/**
 * An opaque cover over a box, in the colour the cover tool is set to — and, when
 * that tool is set to the paper itself, in the colour of the paper under the box,
 * read from the page where it is drawn.
 */
function coverMark(args, opts) {
  const set = settings('whiteout');
  const chosen = args.color !== null ? args.color : typeof set.color === 'string' ? set.color : null;
  const paper = chosen === null && typeof opts.paper === 'function'
    ? opts.paper(args.page - 1, { x: args.x, y: args.y, w: args.w, h: args.h })
    : null;
  return {
    kind: 'whiteout',
    id: newId(),
    page: args.page - 1,
    x: args.x,
    y: args.y,
    w: args.w,
    h: args.h,
    color: chosen || (typeof paper === 'string' && paper !== '' ? paper : PAPER),
  };
}

/**
 * A highlight over a box: the model's own shape whose border is an empty string
 * and whose fill is see-through — the object overlay-paint draws as a highlight
 * and export writes as one — in the colour and opacity the highlighter is set to.
 */
function highlightMark(args) {
  const set = settings('highlight');
  return {
    kind: 'rect',
    id: newId(),
    page: args.page - 1,
    x: args.x,
    y: args.y,
    w: args.w,
    h: args.h,
    stroke: '',
    fill: args.color === null ? set.color : args.color,
    width: set.width,
    opacity: set.opacity,
  };
}

/** One of the four shapes, in the box the shapes tool would have drawn it in. */
function shapeMark(args) {
  const set = settings('shapes');
  const color = args.color === null ? set.color : args.color;
  const fill = args.fill === null ? set.fill === true : args.fill;
  const along = args.shape === 'line' || args.shape === 'arrow';
  return {
    kind: args.shape,
    id: newId(),
    page: args.page - 1,
    x: args.x,
    y: args.y,
    w: args.w,
    h: args.h,
    stroke: color,
    fill: along || !fill ? null : color,
    width: set.width,
  };
}

/* ── the steps ───────────────────────────────────────────────────────────── */

/*
 * One runner per operation, and every runner answers the NEXT document or null:
 * a null refuses the plan, whole. A page number is checked HERE again and not
 * only when the plan was read, because the document can have moved since it was
 * shown — an undo, a page deleted by hand — and a plan is not to be run against a
 * page it was not written about.
 */

const RUNS = {
  addPage(doc, args, opts, sizes) {
    if (!Number.isInteger(args.at) || args.at < 1 || args.at > doc.pages.length + 1) return null;
    const at = args.at - 1;
    // The size asked for, else the size of the page it goes before or after —
    // what the pages tool's own "blank page" does — and core.js answers A4 when
    // neither is known.
    const size = args.size || sizes.at(args.at - 1) || sizes.at(args.at);
    sizes.add(at, size);
    return insertBlank(doc, at, size);
  },

  deletePage(doc, args, opts, sizes) {
    const at = pageAt(doc, args.page);
    if (at === null) return null;
    sizes.drop(at);
    return deletePage(doc, at);
  },

  duplicatePage(doc, args, opts, sizes) {
    const at = pageAt(doc, args.page);
    if (at === null) return null;
    sizes.copy(at);
    return duplicatePage(doc, at);
  },

  movePage(doc, args, opts, sizes) {
    const from = pageAt(doc, args.page);
    if (from === null || args.to < 1 || args.to > doc.pages.length) return null;
    sizes.move(from, args.to - 1);
    return movePage(doc, from, args.to - 1);
  },

  rotatePage(doc, args, opts, sizes) {
    const at = pageAt(doc, args.page);
    if (at === null) return null;
    // A page shown on its side is as wide as it was tall: the displayed box the
    // later steps are written against turns with it.
    if (Math.abs(args.delta) % 180 === 90) sizes.turn(at);
    return rotatePage(doc, at, args.delta);
  },

  addText(doc, args, opts, sizes) {
    const mark = textMark(args, opts, sizes);
    return mark === null ? null : added(doc, mark);
  },

  whiteout(doc, args, opts) {
    if (pageAt(doc, args.page) === null) return null;
    return added(doc, coverMark(args, opts));
  },

  highlight(doc, args) {
    if (pageAt(doc, args.page) === null) return null;
    return added(doc, highlightMark(args));
  },

  addShape(doc, args) {
    if (pageAt(doc, args.page) === null) return null;
    return added(doc, shapeMark(args));
  },
};

/**
 * The plan run: every step, in order, against the document the steps before it
 * left. Answers `{ok: true, doc, count}` for a plan that ran whole, or
 * `{ok: false, op}` for the step that refused it — and in that case the caller's
 * document is exactly what it was, because nothing was written to it.
 */
export function applyPlan(doc, steps, opts) {
  const options = opts || {};
  const sizes = tracker(options.sizes);
  const list = Array.isArray(steps) ? steps : [];
  let working = doc;
  for (const step of list) {
    const run = isRecord(step) && typeof step.op === 'string' ? RUNS[step.op] : null;
    if (!run) return { ok: false, op: isRecord(step) ? String(step.op) : '' };
    const next = run(working, isRecord(step.args) ? step.args : {}, options, sizes);
    if (!next) return { ok: false, op: step.op };
    working = next;
  }
  return { ok: true, doc: working, count: list.length };
}
