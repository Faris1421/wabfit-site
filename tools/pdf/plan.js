/**
 * Wab Fit — what the editor can be told to do, and how an answer becomes a plan.
 *
 * The person writes what they want changed. The app's assistant is told TWO
 * things about the document — a description of it, built here from the model the
 * editor already holds (`describeDocument`), and the person's own words. The
 * file itself never leaves the device, so nothing below ever reads a PDF's bytes.
 *
 * The answer is `{steps: [{op, args, why}], question?}`, and `parsePlan` reads it
 * against the CLOSED list of operations below. There is no open list on purpose:
 * the editor does exactly these nine things, and an instruction that names
 * anything else is REFUSED rather than guessed at. The honest answer to a request
 * the list cannot express is the model's own `question`, which asks instead of
 * assuming.
 *
 *   op             what it changes
 *   addText        written text on a page, at a point, in the text tool's own size
 *   addPage        one blank page, at a position, in a size
 *   deletePage     a page, and everything drawn on it
 *   duplicatePage  a copy of a page, straight after it
 *   movePage       where a page sits in the document
 *   rotatePage     a quarter turn, on top of the page's own rotation
 *   whiteout       an opaque cover over a box, in the colour the cover tool is set to
 *   highlight      a see-through block over a box, in the highlighter's own colour
 *   addShape       a rectangle, an ellipse, a line or an arrow
 *
 * Two instructions are deliberately NOT in that list, and a plan that names them
 * is refused like any other: a PICTURE (its bytes cannot come from the words, so
 * the image tool is where a picture is chosen) and a page size that is not a new
 * page's (a page that came from a file has the file's own box, and this editor
 * never rewrites a source page).
 *
 * Steps run IN ORDER, each against the document the steps before it left: a page
 * number in the third step counts the pages as the first two left them. The
 * numbers themselves are the person's own — one-based — and every step carries
 * `vars` so the line that is shown before anything runs needs no arithmetic.
 *
 * Nothing here touches the DOM, the network or a clock: it is the same module
 * inside the page and inside Node under check.mjs, which is how the closed list
 * is tested against a fixture plan that names an operation it does not have.
 */

/** A point is a hundredth of a point, and never finer than that. */
function round(value) {
  return Math.round(value * 100) / 100;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A whole number inside a range, or null for anything else — never a guess. */
function whole(value, low, high) {
  return Number.isInteger(value) && value >= low && value <= high ? value : null;
}

/** A length in points from zero up: a position, or a side of an upright box. */
function length(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? round(value) : null;
}

/** A length a line runs along, which may be negative: leftwards, or upwards. */
function span(value) {
  return typeof value === 'number' && Number.isFinite(value) ? round(value) : null;
}

/** `#rgb` or `#rrggbb`, the only colours the model keeps. */
const COLOUR = /^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i;

function colour(value) {
  return typeof value === 'string' && COLOUR.test(value) ? value : null;
}

/** The size of one page, when the caller knows it. */
function sizeOf(where, page) {
  const known = where.sizes && where.sizes[page - 1];
  return known && known.w > 0 && known.h > 0 ? known : null;
}

/** An upright box on a page: inside the page's own box when that box is known. */
function upright(args, size) {
  const x = length(args.x);
  const y = length(args.y);
  const w = length(args.w);
  const h = length(args.h);
  if (x === null || y === null || w === null || h === null) return null;
  if (w <= 0 || h <= 0) return null;
  if (size && (x + w > size.w || y + h > size.h)) return null;
  return { x, y, w, h };
}

/** A segment on a page: a box whose two ends are the shape's two ends. */
function segment(args, size) {
  const x = length(args.x);
  const y = length(args.y);
  const w = span(args.w);
  const h = span(args.h);
  if (x === null || y === null || w === null || h === null) return null;
  if (w === 0 && h === 0) return null;
  const end = { x: x + w, y: y + h };
  if (Math.min(x, end.x) < 0 || Math.min(y, end.y) < 0) return null;
  if (size && (Math.max(x, end.x) > size.w || Math.max(y, end.y) > size.h)) return null;
  return { x, y, w, h };
}

/** The four shapes the model can draw, spelled as the object kinds are. */
const SHAPES = ['rect', 'ellipse', 'line', 'arrow'];

/**
 * A box a cover or a highlight is laid over. The two are read alike and differ
 * only in what plan-run.js makes of them, so they are read in one place.
 */
function covered(args, where) {
  const page = whole(args.page, 1, where.count);
  const box = page === null ? null : upright(args, sizeOf(where, page));
  if (box === null) return null;
  if (args.color !== undefined && colour(args.color) === null) return null;
  return {
    args: { page, ...box, color: args.color === undefined ? null : colour(args.color) },
    vars: { n: page },
  };
}

/* ── the closed list ─────────────────────────────────────────────────────── */

/*
 * One reader per operation: what the model said in, what the editor will run
 * out. A reader answers null for anything it cannot read EXACTLY as asked — a
 * page that is not there, a box that leaves the page, a colour that is not one —
 * and a null anywhere in a plan refuses the whole plan. `key` is the line under
 * the step, in i18n.js, and `vars` are the numerals that line is read with.
 */

const OPS = {
  addText: {
    key: 'opAddText',
    read(args, where) {
      const page = whole(args.page, 1, where.count);
      const text = typeof args.text === 'string' ? args.text.trim() : '';
      const x = length(args.x);
      const y = length(args.y);
      if (page === null || text === '' || x === null || y === null) return null;
      const box = sizeOf(where, page);
      if (box && (x > box.w || y > box.h)) return null;
      // A number the model did not give is `null`, not a default: what the tool
      // is set to when the plan RUNS is the editor's business, and plan-run.js
      // reads it there, in the same place every mark's own settings are read.
      let font = null;
      if (args.size !== undefined) {
        font = whole(args.size, 8, 96);
        if (font === null) return null;
      }
      let ink = null;
      if (args.color !== undefined) {
        ink = colour(args.color);
        if (ink === null) return null;
      }
      if (args.bold !== undefined && typeof args.bold !== 'boolean') return null;
      const bold = args.bold === undefined ? null : args.bold;
      return {
        args: { page, x, y, text, size: font, color: ink, bold },
        vars: { n: page },
      };
    },
  },
  addPage: {
    key: 'opAddPage',
    read(args, where) {
      const at = whole(args.at, 1, where.count + 1);
      if (at === null) return null;
      // A size is asked for or it is not. Half a size is not a size.
      if (args.w === undefined && args.h === undefined) return { args: { at }, vars: { n: at } };
      const w = length(args.w);
      const h = length(args.h);
      if (w === null || h === null || w <= 0 || h <= 0) return null;
      return { args: { at, size: { w, h } }, vars: { n: at } };
    },
  },

  deletePage: {
    key: 'opDeletePage',
    read(args, where) {
      const page = whole(args.page, 1, where.count);
      return page === null ? null : { args: { page }, vars: { n: page } };
    },
  },

  duplicatePage: {
    key: 'opDuplicatePage',
    read(args, where) {
      const page = whole(args.page, 1, where.count);
      return page === null ? null : { args: { page }, vars: { n: page } };
    },
  },

  movePage: {
    key: 'opMovePage',
    read(args, where) {
      const page = whole(args.page, 1, where.count);
      const to = whole(args.to, 1, where.count);
      if (page === null || to === null) return null;
      return { args: { page, to }, vars: { n: page, to } };
    },
  },

  rotatePage: {
    key: 'opRotatePage',
    read(args, where) {
      const page = whole(args.page, 1, where.count);
      const delta = whole(args.delta, -360, 360);
      if (page === null || delta === null || delta === 0 || delta % 90 !== 0) return null;
      return { args: { page, delta }, vars: { n: page, deg: delta } };
    },
  },

  whiteout: {
    key: 'opWhiteout',
    read: covered,
  },

  highlight: {
    key: 'opHighlight',
    read: covered,
  },

  addShape: {
    key: 'opAddShape',
    read(args, where) {
      const page = whole(args.page, 1, where.count);
      if (page === null || !SHAPES.includes(args.shape)) return null;
      const size = sizeOf(where, page);
      const box = args.shape === 'line' || args.shape === 'arrow'
        ? segment(args, size)
        : upright(args, size);
      if (box === null) return null;
      if (args.color !== undefined && colour(args.color) === null) return null;
      if (args.fill !== undefined && typeof args.fill !== 'boolean') return null;
      return {
        args: {
          page,
          shape: args.shape,
          ...box,
          color: args.color === undefined ? null : colour(args.color),
          fill: args.fill === undefined ? null : args.fill,
        },
        vars: { n: page },
      };
    },
  },
};

/** The closed list, as the names the assistant is told and nothing else. */
export const OP_NAMES = Object.freeze(Object.keys(OPS));

/* ── reading the answer ──────────────────────────────────────────────────── */

/** The document's page count, from whatever the caller handed in. */
function pageCountOf(doc) {
  return doc && Array.isArray(doc.pages) ? doc.pages.length : 0;
}

/** One step of an answer, read whole against the closed list, or null. */
function readStep(item, where) {
  if (!isRecord(item) || typeof item.op !== 'string') return null;
  const op = OPS[item.op];
  if (!op) return null;
  const read = op.read(isRecord(item.args) ? item.args : {}, where);
  if (!read) return null;
  return {
    op: item.op,
    key: op.key,
    args: read.args,
    vars: read.vars,
    why: typeof item.why === 'string' ? item.why.trim() : '',
  };
}

/**
 * An answer from the assistant, read into a plan — or into the question it asked
 * instead, or into a refusal when it named something the editor cannot do.
 *
 * Four answers, and nothing else comes back:
 *
 *   `{kind:'plan', steps}`        every step is one the editor has, read whole
 *   `{kind:'question', question}` the model asked rather than guessed
 *   `{kind:'refused', op}`        an operation the closed list does not have
 *   `{kind:'none'}`               not an answer at all
 *
 * `doc` is the document as it stands and `sizes` the pages' own sizes in points,
 * when the caller knows them: they are what makes a page number or a box that is
 * not there a refusal instead of a step that runs somewhere else.
 */
export function parsePlan(raw, doc, sizes) {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { kind: 'none' };
    }
  }
  if (!isRecord(value)) return { kind: 'none' };

  const where = { count: pageCountOf(doc), sizes: Array.isArray(sizes) ? sizes : null };
  const list = Array.isArray(value.steps) ? value.steps : [];
  const asked = typeof value.question === 'string' ? value.question.trim() : '';

  if (list.length > 0) {
    const steps = [];
    for (const item of list) {
      const step = readStep(item, where);
      if (!step) {
        return { kind: 'refused', op: isRecord(item) && typeof item.op === 'string' ? item.op : '' };
      }
      steps.push(step);
    }
    return { kind: 'plan', steps };
  }
  if (asked !== '') return { kind: 'question', question: asked };
  return { kind: 'none' };
}

/* ── what the assistant is told ──────────────────────────────────────────── */

/*
 * The description below is what the model reads, and it is deliberately not a
 * user-visible string: it says what the document IS — how many pages, how big
 * each one is, and what stands on it — and never what is inside the file. It is
 * written from the model the editor already holds and from the sizes the screen
 * measured; the PDF's own bytes are not read here and are never sent.
 */

/** The most of a page's own words that goes into the description, in characters. */
const SNIPPET = 40;

/** One run of text as one line, cut where it stops being a description. */
function snippet(text) {
  const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET ? `${flat.slice(0, SNIPPET)}…` : flat;
}

/** A number as it is written down, or a question mark for one that is not there. */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? round(value) : '?';
}

/** One object of the model, as one line of the description. */
function describeObj(obj) {
  if (obj.kind === 'ink') return `ink stroke of ${obj.points.length} points in ${obj.color}`;
  const at = `${num(obj.x)},${num(obj.y)} ${num(obj.w)}x${num(obj.h)}`;
  if (obj.kind === 'text') {
    return `text at ${at} size ${obj.size}${obj.bold ? ' bold' : ''} "${snippet(obj.text)}"`;
  }
  if (obj.kind === 'image') return `image at ${at}`;
  if (obj.kind === 'whiteout') return `whiteout at ${at} in ${obj.color}`;
  return `${obj.kind} at ${at}`;
}

/**
 * The document as the model is told about it: one line for the count, one for
 * each page and its own size, and under each page the marks already on it, in
 * the model's order. Coordinates are the same ones the steps are written in —
 * points from the top-left of the page as it is displayed.
 */
export function describeDocument(doc, sizes) {
  const pages = doc && Array.isArray(doc.pages) ? doc.pages : [];
  const objects = doc && Array.isArray(doc.objects) ? doc.objects : [];
  const where = { sizes: Array.isArray(sizes) ? sizes : null };
  const lines = [`pages: ${pages.length}`];
  for (let at = 0; at < pages.length; at += 1) {
    const ref = pages[at];
    const box = sizeOf(where, at + 1);
    const size = box ? `${num(box.w)}x${num(box.h)}pt` : 'size unknown';
    const blank = ref.src < 0 ? 'blank ' : '';
    const turn = ref.rotate ? ` rotate ${ref.rotate}` : '';
    lines.push(`page ${at + 1}: ${blank}${size}${turn}`);
    for (const obj of objects) {
      if (obj.page === at) lines.push(`  ${describeObj(obj)}`);
    }
  }
  return lines.join('\n');
}
