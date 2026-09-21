/**
 * Wab Fit — putting a page in another place, in the pages tool's grid.
 *
 * A finger lifts nothing until it has been still for a quarter of a second: a
 * finger that moves sooner is scrolling the grid, and this module gets out of
 * its way. A mouse, which has no scroll of its own to protect, lifts a page
 * after a few pixels. Either way what follows the pointer is a lifted COPY — a
 * ghost at the size the slot stands at — and a line between two slots says
 * where the page will land. Letting go calls `onDrop(from, at)`, `at` being the
 * place the line stood in, counted with the page still in the list. A press
 * that never lifted anything is a tap, and it calls `onPick(index)`: choosing a
 * page and dragging it are one gesture until they part, so both are decided
 * here rather than in two listeners that would fight over one pointer.
 *
 * The layer the ghost and the line live in is pinned to the viewport and forced
 * to `direction: ltr`, so a pixel is a pixel whichever way the panel reads.
 */
/** How long a finger must be still before a press becomes a drag. */
const HOLD_MS = 250;
/** How far a mouse may travel before its press becomes a drag. */
const MOUSE_SLOP = 4;
/** How far a finger may drift before its press is a scroll, not a drag. */
const TOUCH_SLOP = 8;

let grid = null;
let onPick = null;
let onDrop = null;
let layer = null;
let marker = null;
let ghost = null;
let press = null;

/** The slots of the grid, in the order the model has them. */
function slots() {
  return Array.from(grid.querySelectorAll('.pg-item'));
}

/** Styles by their CSS names, so the logical ones stay logical. */
function dress(node, styles) {
  for (const name of Object.keys(styles)) node.style.setProperty(name, styles[name]);
  return node;
}

/* ── the lifted copy and the line it will land on ────────────────────────── */

/** The layer, its line and its ghost: built once, on the first drag. */
function ensureLayer() {
  if (layer) return;
  layer = dress(document.createElement('div'), {
    position: 'fixed', inset: '0', 'z-index': '12', 'pointer-events': 'none', direction: 'ltr',
  });
  marker = dress(document.createElement('div'), {
    position: 'absolute', top: '0', 'inset-inline-start': '0', width: '3px',
    'border-radius': '2px', background: 'var(--accent)',
  });
  marker.hidden = true;
  layer.append(marker);
  document.body.append(layer);
}

/** A copy of a slot, its canvas included, held at the size it stands at. */
function lifted(item) {
  const copy = item.cloneNode(true);
  const from = item.querySelectorAll('canvas');
  const to = copy.querySelectorAll('canvas');
  for (let i = 0; i < from.length && i < to.length; i += 1) {
    const source = from[i];
    const target = to[i];
    target.width = source.width;
    target.height = source.height;
    const brush = target.getContext('2d');
    if (brush) brush.drawImage(source, 0, 0);
  }
  dress(copy, {
    position: 'absolute', top: '0', 'inset-inline-start': '0', opacity: '0.9',
    width: `${item.getBoundingClientRect().width}px`, background: 'var(--surface)',
    'border-radius': 'var(--r-md)',
  });
  return copy;
}

/** Where the pointer is among the slots: an index, 0 to as many as there are. */
function insertion(x, y) {
  const list = slots();
  if (list.length === 0) return 0;
  let best = 0;
  let score = Infinity;
  list.forEach((slot, at) => {
    const rect = slot.getBoundingClientRect();
    const now = Math.abs(y - (rect.top + rect.height / 2)) * 4
      + Math.abs(x - (rect.left + rect.width / 2));
    if (now < score) {
      score = now;
      best = at;
    }
  });
  const rect = list[best].getBoundingClientRect();
  const backward = getComputedStyle(grid).direction === 'rtl';
  const past = backward ? x < rect.left + rect.width / 2 : x > rect.left + rect.width / 2;
  return past ? best + 1 : best;
}

/** The line stands on the edge the page would take. */
function showLine(at) {
  const list = slots();
  if (list.length === 0) {
    marker.hidden = true;
    return;
  }
  const backward = getComputedStyle(grid).direction === 'rtl';
  const inList = at < list.length;
  const rect = (inList ? list[at] : list[list.length - 1]).getBoundingClientRect();
  const edge = inList
    ? (backward ? rect.right : rect.left)
    : (backward ? rect.left : rect.right);
  dress(marker, {
    'inset-inline-start': `${edge}px`, top: `${rect.top}px`, height: `${rect.height}px`,
  });
  marker.hidden = false;
}

/* ── the gesture ─────────────────────────────────────────────────────────── */

function lift() {
  if (!press || press.live) return;
  press.live = true;
  ensureLayer();
  // A finger carrying a page scrolls nothing; touch-action set now is too late.
  grid.addEventListener('touchmove', block, { passive: false });
  ghost = lifted(press.item);
  layer.append(ghost);
  press.item.style.setProperty('opacity', '0.35');
  carry(press.x, press.y);
}

/** The ghost follows the pointer, the line says where it would land. */
function carry(x, y) {
  press.x = x;
  press.y = y;
  press.at = insertion(x, y);
  dress(ghost, {
    transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(1.04)`,
  });
  showLine(press.at);
}

/** A finger that is carrying a page scrolls nothing. */
function block(event) {
  event.preventDefault();
}

/** Everything the gesture put on the screen is taken off it again. */
function clear(state) {
  state.item.style.removeProperty('opacity');
  if (ghost) ghost.remove();
  ghost = null;
  if (marker) marker.hidden = true;
  grid.removeEventListener('touchmove', block);
}

function onDown(event) {
  if (press || (event.button !== undefined && event.button !== 0)) return;
  const item = event.target.closest ? event.target.closest('.pg-item') : null;
  if (!item || !grid.contains(item)) return;
  const index = Number(item.dataset.index);
  if (!Number.isInteger(index)) return;
  press = {
    id: event.pointerId, item, index, x: event.clientX, y: event.clientY,
    x0: event.clientX, y0: event.clientY, at: index, live: false, timer: 0,
  };
  if (event.pointerType === 'mouse') {
    if (grid.setPointerCapture) grid.setPointerCapture(event.pointerId);
  } else {
    press.timer = window.setTimeout(lift, HOLD_MS);
  }
}

function onMove(event) {
  if (!press || event.pointerId !== press.id) return;
  const far = Math.hypot(event.clientX - press.x0, event.clientY - press.y0);
  press.x = event.clientX;
  press.y = event.clientY;
  if (press.live) {
    carry(press.x, press.y);
    return;
  }
  if (event.pointerType === 'mouse') {
    if (far > MOUSE_SLOP) lift();
  } else if (far > TOUCH_SLOP) {
    // A press that moved too soon is a scroll: it leaves nothing behind.
    window.clearTimeout(press.timer);
    press = null;
  }
}

/** The pointer was lifted, or taken away: either way the gesture is over. */
function onEnd(event, dropped) {
  if (!press || event.pointerId !== press.id) return;
  const done = press;
  press = null;
  window.clearTimeout(done.timer);
  if (!done.live) {
    if (dropped) onPick(done.index);
    return;
  }
  clear(done);
  if (dropped) onDrop(done.index, done.at);
}

/** Wired once by pages.js. Answers the grid, so it can be called inline. */
export function initDrag(options) {
  grid = options.grid;
  onPick = options.onPick;
  onDrop = options.onDrop;
  grid.addEventListener('pointerdown', onDown);
  grid.addEventListener('pointermove', onMove);
  grid.addEventListener('pointerup', (event) => onEnd(event, true));
  grid.addEventListener('pointercancel', (event) => onEnd(event, false));
  return grid;
}
