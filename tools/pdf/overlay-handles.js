/**
 * Wab Fit — the chrome around a selected object.
 *
 * An accent frame around the object, eight square handles on its corners and
 * edges, and a small bar floating beside it with what can be done to it. Every
 * control is 40px on its shortest side, so a finger can hit it at any zoom. The
 * chrome takes no pointer events except on the handles and the buttons, so a tap
 * between them still reaches the object underneath.
 *
 * The arithmetic — where the box is, what a handle drag makes of it — is
 * overlay-geometry.js's business, and the objects themselves are the business of
 * overlay-paint.js.
 *
 * Nothing here knows what an action MEANS: `onAction` is handed an id and
 * overlay.js decides. Nothing here holds a word either; the words are put on
 * when the bar is shown, which is after main.js set the language, because a
 * label written at boot would be in the wrong one.
 */

import { getLang, t } from './i18n.js';

/** The eight handles, named by the edges each one drags. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Where each handle sits in a box: fractions of its width and height. */
const ANCHOR = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5],
  se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};

/** The tap target of a handle, and the dot drawn inside it, in CSS pixels. */
const TOUCH = 40;
const DOT = 14;
/** One square of the floating bar, and the gap between it and the object. */
const SQUARE = 40;
const GAP = 8;

/** Styles by their own CSS names, so the logical ones stay logical. */
function dress(node, styles) {
  for (const name of Object.keys(styles)) node.style.setProperty(name, styles[name]);
  return node;
}

/* ── the chrome ──────────────────────────────────────────────────────────── */

/** Inline SVG, stroke 1.7, on currentColor: no emoji, no icon font. */
const ICONS = {
  edit: '<path d="M4.5 19.5l.9-3.6L16 5.3l2.7 2.7L8.1 18.6z"/>',
  forward: '<path d="M12 19.5V6"/><path d="M6.5 11.5L12 6l5.5 5.5"/>',
  back: '<path d="M12 4.5V18"/><path d="M6.5 12.5L12 18l5.5-5.5"/>',
  duplicate: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/>'
    + '<path d="M15.5 5H7a2 2 0 0 0-2 2v8.5"/>',
  delete: '<path d="M5 7h14"/><path d="M10 4.5h4"/><path d="M6.5 7l1 13h9l1-13"/>'
    + '<path d="M10.5 10.5v6M13.5 10.5v6"/>',
};

/** The bar's buttons, in order. `text` marks the one written text alone has. */
const ACTIONS = [
  { id: 'edit', key: 'edit', icon: ICONS.edit, text: true },
  { id: 'forward', key: 'bringForward', icon: ICONS.forward },
  { id: 'back', key: 'sendBack', icon: ICONS.back },
  { id: 'duplicate', key: 'duplicate', icon: ICONS.duplicate },
  { id: 'delete', key: 'del', icon: ICONS.delete, danger: true },
];

/** One button of the bar: a 40px square drawing its own icon. */
function barButton(action, onAction) {
  const outline = 'fill="none" stroke="currentColor" stroke-width="1.7" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const button = dress(document.createElement('button'), {
    flex: '0 0 auto', width: `${SQUARE}px`, height: `${SQUARE}px`, padding: '0', border: '0',
    background: 'none', display: 'flex', 'align-items': 'center', 'justify-content': 'center',
    cursor: 'pointer', 'touch-action': 'none', '-webkit-tap-highlight-color': 'transparent',
    color: action.danger ? 'var(--danger-text)' : 'var(--text)',
  });
  button.type = 'button';
  button.dataset.action = action.id;
  button.innerHTML = `<svg viewBox="0 0 24 24" ${outline}>${action.icon}</svg>`;
  dress(button.firstElementChild, { width: '22px', height: '22px' });
  button.addEventListener('click', () => onAction(action.id));
  return button;
}

/**
 * The whole chrome. `onAction` is called with the id of a bar button whenever
 * one is clicked; answers `{ root, show, hide }`, where `show` takes the object,
 * its box, the page's scale and the page's size in CSS pixels.
 */
export function createChrome(onAction) {
  const root = dress(document.createElement('div'), {
    position: 'absolute', inset: '0', 'pointer-events': 'none', 'z-index': '2',
  });
  const frame = dress(document.createElement('div'), {
    position: 'absolute', 'inset-block-start': '0', 'inset-inline-start': '0',
    border: '1.5px solid var(--accent)', 'border-radius': '2px',
  });
  root.append(frame);

  const handles = new Map();
  for (const id of HANDLES) {
    const handle = dress(document.createElement('button'), {
      position: 'absolute', 'inset-block-start': '0', 'inset-inline-start': '0',
      width: `${TOUCH}px`, height: `${TOUCH}px`, padding: '0', border: '0', background: 'none',
      display: 'flex', 'align-items': 'center', 'justify-content': 'center',
      'pointer-events': 'auto', 'touch-action': 'none', cursor: 'pointer',
      '-webkit-tap-highlight-color': 'transparent',
    });
    handle.type = 'button';
    handle.dataset.handle = id;
    // A handle is dragged, never tabbed to: the keyboard cannot resize.
    handle.tabIndex = -1;
    handle.append(dress(document.createElement('i'), {
      display: 'block', width: `${DOT}px`, height: `${DOT}px`, 'border-radius': 'var(--r-xs)',
      background: 'var(--surface)', border: '1.5px solid var(--accent)',
    }));
    handles.set(id, handle);
    root.append(handle);
  }

  const bar = dress(document.createElement('div'), {
    position: 'absolute', 'inset-block-start': '0', 'inset-inline-start': '0',
    display: 'flex', 'align-items': 'center', gap: '2px', padding: '2px', height: '44px',
    background: 'var(--surface)', border: '1px solid var(--line)', 'border-radius': 'var(--r-md)',
    'pointer-events': 'auto',
  });
  // Named, so a tap on the bar's own edges is not read as a tap on the page.
  bar.className = 'overlay-bar';
  const buttons = new Map();
  for (const action of ACTIONS) {
    const button = barButton(action, onAction);
    buttons.set(action.id, button);
    bar.append(button);
  }
  root.append(bar);
  root.hidden = true;

  /** The words are put on when the bar appears: the language may have changed. */
  let spoken = null;
  function speak() {
    const now = getLang();
    if (now === spoken) return;
    spoken = now;
    for (const action of ACTIONS) buttons.get(action.id).setAttribute('aria-label', t(action.key));
    for (const handle of handles.values()) handle.setAttribute('aria-label', t('resize'));
  }

  function show(obj, box, scale, area) {
    speak();
    root.hidden = false;
    frame.style.transform = `translate(${box.x * scale}px,${box.y * scale}px)`;
    frame.style.width = `${Math.max(2, box.w * scale)}px`;
    frame.style.height = `${Math.max(2, box.h * scale)}px`;

    for (const [id, handle] of handles) {
      const anchor = ANCHOR[id];
      const x = (box.x + box.w * anchor[0]) * scale;
      const y = (box.y + box.h * anchor[1]) * scale;
      handle.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
    }

    let count = 0;
    for (const action of ACTIONS) {
      const wanted = action.text !== true || obj.kind === 'text';
      buttons.get(action.id).hidden = !wanted;
      if (wanted) count += 1;
    }
    // The bar is a physical box in an LTR layer, so it mirrors by its order.
    const width = count * SQUARE + (count - 1) * 2 + 6;
    const height = SQUARE + 4;
    const above = box.y * scale - height - GAP;
    const below = (box.y + box.h) * scale + GAP;
    const top = above >= 0 ? above : Math.min(below, area.height - height);
    const start = Math.min(Math.max(0, box.x * scale), Math.max(0, area.width - width));
    bar.style.width = `${width}px`;
    bar.style.flexDirection = document.documentElement.dir === 'rtl' ? 'row-reverse' : 'row';
    bar.style.transform = `translate(${start}px,${Math.max(0, top)}px)`;
  }

  function hide() {
    root.hidden = true;
  }

  return { root, show, hide };
}
