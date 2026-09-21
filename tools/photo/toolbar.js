/**
 * Wab Fit — the tool bar: which tools exist, what a button draws, and the inline
 * SVG for every icon the page uses.
 *
 * main.js owns WHEN a tool arrives — it fetches each file and hands it to
 * `registerTool` — and this module owns what the bar looks like once one has.
 * The two are apart because the tool list is the one thing a later part of this
 * app extends: the four tools it adds are already named here, with the file each
 * one will live in, and a tool whose file is not there yet is simply not drawn.
 *
 * Every icon is one drawing on `currentColor`, stroke 1.7, 24×24: no emoji, no
 * icon font, nothing fetched.
 */

import { t } from './i18n.js';

/**
 * One line per tool: the id the context carries, the string key on its label,
 * the file that provides it, and the icon below that draws it. The order here is
 * the order on the bar and the order they are fetched in.
 */
export const TOOLS = [
  { id: 'adjust', key: 'tAdjust', file: './tools/adjust.js', icon: 'adjust' },
  { id: 'filters', key: 'tFilters', file: './tools/filters.js', icon: 'filters' },
  { id: 'crop', key: 'tCrop', file: './tools/crop.js', icon: 'crop' },
  { id: 'erase', key: 'tErase', file: './tools/erase.js', icon: 'erase' },
  { id: 'face', key: 'tFace', file: './tools/face.js', icon: 'face' },
  { id: 'swap', key: 'tSwap', file: './swap.js', icon: 'swap' },
  { id: 'background', key: 'tBackground', file: './background.js', icon: 'background' },
];

/** The drawings, by name. `undo`, `redo` and `compare` are the bar's. */
export const ICONS = {
  undo: '<path d="M4 9h9.5a5.5 5.5 0 0 1 0 11H9"/><path d="M7.5 5.5 4 9l3.5 3.5"/>',
  redo: '<path d="M20 9h-9.5a5.5 5.5 0 0 0 0 11H15"/><path d="M16.5 5.5 20 9l-3.5 3.5"/>',
  compare:
    '<path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6z"/>'
    + '<circle cx="12" cy="12" r="2.6"/>',
  adjust:
    '<path d="M4 7.5h16"/><path d="M4 16.5h16"/><circle cx="9.5" cy="7.5" r="2"/>'
    + '<circle cx="15" cy="16.5" r="2"/>',
  filters: '<circle cx="9.2" cy="10" r="4.6"/><circle cx="14.8" cy="14" r="4.6"/>',
  crop: '<path d="M6.5 2.5v15h15"/><path d="M2.5 6.5h15v15"/>',
  erase: '<path d="M15.6 5.4l4 4-8.6 8.6H7.4L4.2 14.8z"/><path d="M7.5 20.5h12"/>',
  face:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="9.4" cy="10.6" r="0.5"/>'
    + '<circle cx="14.6" cy="10.6" r="0.5"/>'
    + '<path d="M9.4 15.3c1.6 1.2 3.6 1.2 5.2 0"/>',
  swap:
    '<path d="M4 8.5h12.5"/><path d="M13 5l3.5 3.5L13 12"/>'
    + '<path d="M20 15.5H7.5"/><path d="M11 12l-3.5 3.5L11 19"/>',
  background:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke-dasharray="3.4 2.6"/>'
    + '<circle cx="12" cy="10.4" r="2"/>'
    + '<path d="M8 16.5c.6-1.7 2.2-2.6 4-2.6s3.4.9 4 2.6"/>',
};

/** One icon wrapped the way every button wants it. */
export function svg(markup) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${markup}</svg>`;
}

/** The bar the tools are drawn on, and the band it sits in. */
function toolbarElements() {
  return {
    band: document.getElementById('tools'),
    bar: document.getElementById('toolbar'),
  };
}

/**
 * Redraw the bar: one button per tool in TOOLS whose file was found, in that
 * order, and nothing for a tool that is not there. `loaded` is the set of ids
 * that registered.
 */
export function buildToolbar(ctx, loaded) {
  const { band, bar } = toolbarElements();
  const ready = TOOLS.filter((tool) => loaded.has(tool.id));

  band.hidden = ready.length === 0;
  bar.textContent = '';
  for (const tool of ready) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tool';
    button.dataset.tool = tool.id;
    button.innerHTML = `${svg(ICONS[tool.icon])}<span class="tool-label"></span>`;
    button.addEventListener('click', () => ctx.setTool(tool.id));
    bar.append(button);
  }
  paintToolbar(ctx);
}

/** The words and the pressed state, after a language or a tool change. */
export function paintToolbar(ctx) {
  const { bar } = toolbarElements();
  for (const button of bar.children) {
    const tool = TOOLS.find((candidate) => candidate.id === button.dataset.tool);
    if (!tool) continue;
    const label = button.querySelector('.tool-label');
    if (label) label.textContent = t(tool.key);
    button.setAttribute('aria-label', t(tool.key));
    button.setAttribute('aria-pressed', String(tool.id === ctx.tool));
  }
}
