/**
 * Wab Fit — the signature sheet's own screen.
 *
 * This file is structure and style and nothing else: the head with the tool's
 * name and the way out of it, the row of the signatures this device remembers —
 * each one a picture that places it, with a delete beside it — the framed pad,
 * and the foot with Clear and the way in from a page. tool-sign.js owns the
 * storage, the words and every decision; sign-pad.js owns the ink.
 *
 * The framed box carries two faces, and only one of them is on the screen: the
 * pad a signature is drawn on, and the result of one lifted off a page — the
 * cut over the squares that are what transparent looks like, with the two
 * answers that result can be given. Which face is showing is tool-sign.js's
 * decision; this file only holds them.
 *
 * The row is written again whenever it changes, from the list and the two
 * callbacks the caller hands in, so the sheet never keeps a list of its own and
 * never holds a word: a label written at boot would be in the wrong language.
 */

import { t } from './i18n.js';
import { createPad } from './sign-pad.js';

/** Styles by their CSS names, so the logical ones stay logical. */
function dress(node, styles) {
  for (const name of Object.keys(styles)) node.style.setProperty(name, styles[name]);
  return node;
}

/** Inline SVG, stroke 1.7, on currentColor: no emoji, no icon font. */
const TRASH = '<path d="M5 7h14"/><path d="M10 4.5h4"/><path d="M6.5 7l1 13h9l1-13"/>'
  + '<path d="M10.5 10.5v6M13.5 10.5v6"/>';

/** A button of the sheet; the words are put on it when the sheet opens. */
function button(className) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  return node;
}

/** One remembered signature: its picture, which places it, and its delete. */
function savedEntry(entry, onPick, onForget) {
  const wrap = dress(document.createElement('div'), {
    flex: '0 0 auto', display: 'flex', 'flex-direction': 'column', 'align-items': 'center',
    gap: 'var(--s-xs)',
  });

  const pick = dress(button('sign-pick'), {
    display: 'block', padding: 'var(--s-xs)', border: '1px solid var(--line)',
    'border-radius': 'var(--r-sm)', background: 'var(--surface)', cursor: 'pointer',
    '-webkit-tap-highlight-color': 'transparent',
  });
  const picture = document.createElement('img');
  picture.src = entry.png;
  picture.alt = '';
  dress(picture, {
    display: 'block', height: '48px', width: 'auto', 'max-width': '104px',
    'object-fit': 'contain', 'pointer-events': 'none',
  });
  pick.append(picture);
  pick.setAttribute('aria-label', t('tSign'));
  pick.addEventListener('click', () => onPick(entry));

  const forget = dress(button('sign-forget'), {
    width: '40px', height: '40px', display: 'flex', 'align-items': 'center',
    'justify-content': 'center', padding: '0', border: '0', background: 'none',
    color: 'var(--danger-text)', cursor: 'pointer', '-webkit-tap-highlight-color': 'transparent',
  });
  forget.setAttribute('aria-label', t('del'));
  forget.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + `${TRASH}</svg>`;
  dress(forget.firstElementChild, { width: '20px', height: '20px' });
  forget.addEventListener('click', () => onForget(entry));

  wrap.append(pick, forget);
  return wrap;
}

/** The remembered signatures, or nothing at all when there are none. */
export function paintSaved(row, entries, onPick, onForget) {
  row.hidden = entries.length === 0;
  row.replaceChildren(...entries.map((entry) => savedEntry(entry, onPick, onForget)));
}

/**
 * The whole sheet, wired to the things only tool-sign.js can answer for: Done,
 * Clear, Save and Try again, and where the pad's own ways in and out are.
 * Answers the parts whose words change with the language, the pad itself, and
 * the face a lifted signature is shown on.
 */
export function buildSheet(handlers) {
  const panel = dress(document.createElement('div'), {
    position: 'fixed', inset: '0', 'z-index': '9', display: 'flex', 'flex-direction': 'column',
    background: 'var(--bg)', 'padding-block-end': 'env(safe-area-inset-bottom, 0px)',
  });
  panel.hidden = true;

  const head = dress(document.createElement('div'), {
    display: 'flex', 'align-items': 'center', gap: 'var(--s-sm)',
    padding: 'var(--s-sm) var(--s-md)', background: 'var(--surface)',
    'border-block-end': '1px solid var(--line)',
  });
  const title = dress(document.createElement('span'), { 'font-weight': '700' });
  const done = dress(button('btn primary'), { 'margin-inline-start': 'auto' });
  done.addEventListener('click', () => handlers.onDone());
  head.append(title, done);

  const saved = dress(document.createElement('div'), {
    display: 'flex', 'align-items': 'center', gap: 'var(--s-md)', 'overflow-x': 'auto',
    padding: 'var(--s-sm) var(--s-md)', background: 'var(--surface)',
    'border-block-end': '1px solid var(--line)',
  });
  saved.hidden = true;

  const surface = dress(document.createElement('div'), {
    flex: '1 1 auto', position: 'relative', 'min-height': '180px', margin: 'var(--s-md)',
    overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--line)',
    'border-radius': 'var(--r-lg)',
  });
  const ink = createPad();
  surface.append(ink.canvas);

  // The lifted signature's own face: the cut over the squares that are what
  // transparent looks like, and the line for a cut the page made without help.
  const preview = dress(document.createElement('div'), {
    position: 'absolute', inset: '0', display: 'flex', 'flex-direction': 'column',
    'align-items': 'center', 'justify-content': 'center', gap: 'var(--s-sm)',
    padding: 'var(--s-md)',
  });
  preview.hidden = true;
  const art = document.createElement('img');
  art.alt = '';
  dress(art, {
    display: 'block', flex: '1 1 auto', 'min-height': '0', 'max-width': '100%',
    'object-fit': 'contain', 'background-color': 'var(--surface)',
    'background-image': 'linear-gradient(45deg, var(--fill) 25%, transparent 25%, '
      + 'transparent 75%, var(--fill) 75%), '
      + 'linear-gradient(45deg, var(--fill) 25%, transparent 25%, transparent 75%, '
      + 'var(--fill) 75%)',
    'background-position': '0 0, 8px 8px', 'background-size': '16px 16px',
  });
  const note = dress(document.createElement('p'), {
    margin: '0', color: 'var(--muted)', 'font-size': '13px', 'text-align': 'center',
  });
  note.hidden = true;
  preview.append(art, note);
  surface.append(preview);

  const foot = dress(document.createElement('div'), {
    display: 'flex', 'align-items': 'center', 'justify-content': 'flex-end',
    gap: 'var(--s-sm)', padding: 'var(--s-sm) var(--s-md)', background: 'var(--surface)',
    'border-block-start': '1px solid var(--line)',
  });
  /** The way in from a page: out of the sheet, and framing on the page itself. */
  const lift = button('chip');
  lift.addEventListener('click', () => handlers.onLift());
  /** The two answers a finished lift can be given. */
  const retry = button('chip');
  retry.hidden = true;
  retry.addEventListener('click', () => handlers.onRetry());
  const save = button('btn primary');
  save.hidden = true;
  save.addEventListener('click', () => handlers.onSave());
  const clear = button('chip');
  clear.addEventListener('click', () => handlers.onClear());
  foot.append(lift, retry, save, clear);

  panel.append(head, saved, surface, foot);
  document.body.append(panel);
  return {
    panel, title, done, lift, retry, save, clear, note, art, preview, saved, surface, ink,
  };
}

