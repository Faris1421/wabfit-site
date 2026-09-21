/**
 * Wab Fit — the property strip: what the next mark will be made with.
 *
 * One row above the tool bar, written again whenever the tool changes. Every
 * tool REMEMBERS what it was last set to — colour, size, stroke weight, bold,
 * shape, fill — and reads it back through `settings(tool)` when it makes a
 * mark, so a tool never reaches for a control and this file never touches the
 * model. The colours are the app's own palette (`src/theme/tokens.ts`).
 */

import { t } from './i18n.js';

/** The eight swatches: black, white, then the app's accent and its hues. */
const SWATCHES = [
  '#000000', '#ffffff', '#0a84ff', '#30d158', '#ff453a', '#ff9f0a', '#bf5af2', '#40c8e0',
];

/**
 * What a tool is set to the first time it is used. A colour of `null` is not a
 * colour but the absence of one: the whiteout tool reads the paper's own colour
 * from the page until somebody picks a swatch, which is the only way a cover
 * laid on grey or photographed paper blends in.
 */
const DEFAULTS = {
  text: { color: '#000000', size: 14, bold: false },
  draw: { color: '#000000', width: 2 },
  highlight: { color: '#ff9f0a', width: 18, opacity: 0.35 },
  shapes: { color: '#ff453a', width: 2, shape: 'rect', fill: false },
  sign: { color: '#0a84ff', width: 2 },
  whiteout: { color: null, secure: false },
};

/** The stroke weights a tool offers, in points. */
const WIDTHS = {
  draw: [1, 2, 4, 8],
  highlight: [8, 12, 18, 24],
  shapes: [1, 2, 4, 8],
  sign: [1, 2, 4, 6],
};

const OPACITIES = [0.25, 0.35, 0.5, 0.75];
/** Written text may be set anywhere from 8 to 96, and no further. */
const MIN_TEXT = 8, MAX_TEXT = 96, TEXT_STEP = 2;

/** The four shapes, and how each one is drawn on its button. */
const SHAPES = ['rect', 'ellipse', 'line', 'arrow'];
const SHAPE_ICONS = {
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  line: '<path d="M4.5 19.5L19.5 5"/>',
  arrow: '<path d="M4.5 19.5L19.5 5"/><path d="M19.5 11V5h-6"/>',
};
const FILL_ICON = '<rect x="4" y="6" width="16" height="12" rx="1.5" fill="currentColor"'
  + ' fill-opacity="0.4"/>';

/** Tool id → the groups its strip shows. A tool that is not here has no strip. */
const GROUPS = {
  text: ['color', 'fontSize', 'bold'],
  draw: ['color', 'width'],
  highlight: ['color', 'opacity'],
  shapes: ['shape', 'color', 'width', 'fill'],
  sign: ['color', 'width'],
  whiteout: ['color', 'secure'],
};

/** The strip element, and the settings each tool remembers. */
let ctx = null;
let strip = null;
const saved = new Map();

/** The settings of one tool, created the first time the tool is used. */
export function settings(tool) {
  if (!saved.has(tool)) saved.set(tool, Object.assign({}, DEFAULTS[tool] || {}));
  return saved.get(tool);
}

/** The box of one group: its word when it needs one, then its controls. */
function group(labelKey, controls) {
  const wrap = document.createElement('div');
  wrap.className = 'prop-group';
  if (labelKey) {
    const label = document.createElement('span');
    label.className = 'prop-label';
    label.textContent = t(labelKey);
    wrap.append(label);
  }
  wrap.append(...controls);
  return wrap;
}

/** A chip of the strip: picking it sets one value and writes the strip again. */
function chip(text, label, pressed, apply) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(pressed));
  button.addEventListener('click', () => {
    apply();
    build();
  });
  return button;
}

/** A chip that is a drawing: a shape, or a shape that is filled. */
function iconChip(markup, label, pressed, apply) {
  const button = chip('', label, pressed, apply);
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"'
    + ` aria-hidden="true">${markup}</svg>`;
  button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;';
  return button;
}

/** One of the eight colours: pressed when it is the colour in use. */
function swatch(colour, set) {
  const button = chip('', t('color'), colour === set.color, () => { set.color = colour; });
  button.className = 'swatch';
  button.dataset.sw = colour;
  button.style.setProperty('--sw', colour);
  button.innerHTML = '<i></i>';
  return button;
}

/** The eight colours, and the one nobody put there: the system's own picker. */
function colorGroup(set) {
  const buttons = SWATCHES.map((colour) => swatch(colour, set));
  const custom = document.createElement('input');
  custom.type = 'color';
  // Nothing pressed and no colour of its own is "read the paper", which is where
  // the whiteout tool starts: the picker shows the last colour, not a choice.
  custom.value = typeof set.color === 'string' ? set.color : '#ffffff';
  custom.setAttribute('aria-label', t('color'));
  custom.style.cssText = 'width:40px;height:40px;padding:0;border:0;background:none;'
    + 'border-radius:20px;cursor:pointer;-webkit-tap-highlight-color:transparent;';
  // The picker stays open while it is moved, so the strip is not rebuilt under
  // it: only the mark that says which colour is in use follows it.
  custom.addEventListener('input', () => {
    set.color = custom.value;
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.sw === set.color));
    }
  });
  return group('color', [...buttons, custom]);
}

/** The stroke weights of a tool, in points. */
function widthChips(tool, set) {
  return (WIDTHS[tool] || [2]).map((width) => chip(String(width), `${t('size')} ${width}`,
    width === set.width, () => {
      set.width = width;
    }));
}

/** Written text: a size from 8 to 96, reached a step at a time. */
function fontSizeChips(set) {
  const nudge = (delta) => () => {
    set.size = Math.min(MAX_TEXT, Math.max(MIN_TEXT, set.size + delta));
  };
  const value = document.createElement('span');
  value.className = 'chip';
  value.textContent = String(set.size);
  value.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;'
    + 'background:none;font-variant-numeric:tabular-nums;';
  return [
    chip('−', `${t('size')} ${set.size - TEXT_STEP}`, false, nudge(-TEXT_STEP)),
    value,
    chip('+', `${t('size')} ${set.size + TEXT_STEP}`, false, nudge(TEXT_STEP)),
  ];
}

/** How much of the page shows through a highlight. */
function opacityChips(set) {
  return OPACITIES.map((value) => {
    const percent = Math.round(value * 100);
    return chip(`${percent}%`, `${t('opacity')} ${percent}%`, value === set.opacity, () => {
      set.opacity = value;
    });
  });
}

/** Every group the strip can show, by the name a tool's list gives it. */
const MAKERS = {
  color: (set) => colorGroup(set),
  width: (set) => group('size', widthChips(ctx.tool, set)),
  fontSize: (set) => group('size', fontSizeChips(set)),
  opacity: (set) => group('opacity', opacityChips(set)),
  bold: (set) => group(null, [chip('B', t('bold'), set.bold, () => {
    set.bold = !set.bold;
  })]),
  shape: (set) => group(null, SHAPES.map((make) => iconChip(SHAPE_ICONS[make], t('shape'),
    make === set.shape, () => {
      set.shape = make;
    }))),
  fill: (set) => group(null, [iconChip(FILL_ICON, t('fill'), set.fill, () => {
    set.fill = !set.fill;
  })]),
  secure: (set) => group(null, [chip(t('secureRedact'), t('secureRedact'), set.secure === true, () => {
    set.secure = !(set.secure === true);
  })]),
};

/** The whole strip again: the tool changed, a control was used, words moved. */
function build() {
  if (!strip) return;
  const kinds = GROUPS[ctx.tool] || [];
  strip.textContent = '';
  strip.hidden = kinds.length === 0;
  const set = settings(ctx.tool);
  for (const kind of kinds) {
    const make = MAKERS[kind];
    if (make) strip.append(make(set));
  }
}

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(context) {
  ctx = context;
  strip = document.getElementById('props');
  ctx.on('tool', build);
  build();
  return ctx;
}

/** The language changed: the strip is written again in the new one. */
export function refresh() { build(); }
