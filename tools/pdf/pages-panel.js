/**
 * Wab Fit — the pages tool's panel, which is one screen built in the page.
 *
 * The panel covers everything while the tool is on: a head with the name of the
 * tool and the way out of it, the grid of thumbnails that pages-thumbs.js fills
 * afterwards, a row of operations along the bottom, and the second file picker
 * a merge needs — which lives in the page rather than in a sheet, because a
 * WebView only opens a file input that is really there.
 *
 * The row is built again whenever it has to say something in another language:
 * `paintRow` is handed the list of operations and draws one button for each,
 * so the words and the drawings always come from pages.js and i18n.js and never
 * from a string kept here. What each button does is decided in pages.js; this
 * file is structure, style and nothing else.
 */

import { t } from './i18n.js';

/** Styles by their CSS names, so the logical ones stay logical. */
export function dress(node, styles) {
  for (const name of Object.keys(styles)) node.style.setProperty(name, styles[name]);
  return node;
}

function svg(markup) {
  const outline = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" '
    + 'stroke-linejoin="round" aria-hidden="true"';
  return `<svg viewBox="0 0 24 24" ${outline}>${markup}</svg>`;
}

/** Draws one button per operation, in the language that is on right now. */
export function paintRow(row, actions) {
  row.textContent = '';
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.action = action.id;
    if (action.any) btn.dataset.any = 'true';
    if (action.danger) btn.style.setProperty('color', 'var(--danger-text)');
    if (action.icon) btn.innerHTML = svg(action.icon);
    else btn.textContent = t(action.key);
    btn.setAttribute('aria-label', t(action.key));
    btn.addEventListener('click', () => action.run());
    row.append(btn);
  }
}

/** Builds the panel, wired to the two things only pages.js can answer for. */
export function buildPanel(handlers) {
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
  done.addEventListener('click', () => handlers.onDone());
  head.append(title, done);

  const grid = dress(document.createElement('div'), {
    flex: '1 1 auto', overflow: 'auto', display: 'grid', 'align-content': 'start',
    'grid-template-columns': 'repeat(auto-fill, minmax(96px, 1fr))',
    gap: 'var(--s-sm)', padding: 'var(--s-md)', '-webkit-overflow-scrolling': 'touch',
  });

  const row = dress(document.createElement('div'), {
    flex: '0 0 auto', display: 'flex', gap: 'var(--s-sm)', overflow: 'auto',
    padding: 'var(--s-sm) var(--s-md)', background: 'var(--surface)',
    'border-block-start': '1px solid var(--line)',
  });

  // The picker behind a merge: in the page, in the flow, and out of sight.
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'application/pdf';
  file.setAttribute('aria-hidden', 'true');
  dress(file, { position: 'absolute', width: '1px', height: '1px', opacity: '0' });
  file.addEventListener('change', () => {
    const chosen = file.files && file.files[0];
    file.value = '';
    if (chosen) handlers.onFile(chosen);
  });

  panel.append(head, grid, row, file);
  document.body.append(panel);
  return { panel, title, done, grid, row, file };
}
