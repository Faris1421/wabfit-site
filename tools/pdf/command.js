/**
 * Wab Fit — the command bar: what the person wants done, and the plan before it
 * runs.
 *
 * One field at the foot of the document, above the tools, and one button. What is
 * typed goes to the app's assistant together with a DESCRIPTION of the document —
 * plan.js builds that out of the model the editor already holds — and never with
 * the file itself: the bytes stay on the device.
 *
 * The answer comes back the same way and is read against the editor's closed list
 * by `parsePlan`. A plan is SHOWN before it runs, one line per step in the
 * person's own language, with the two things that can be done to it: «نفّذ» runs
 * the whole plan through the editor's own operations and commits it as ONE
 * document — so a single undo takes the entire plan back — and «إلغاء» takes the
 * plan off the screen and leaves the document alone. An answer that ASKS instead
 * of assuming is shown for what it is, and so is a request the list cannot
 * express: neither is ever run.
 *
 * ── the two messages this bar is one end of ──
 *
 *   page → app   `{type:'ask', words, description}` — the person's words, and the
 *                description of the document; nothing of the file.
 *   app → page   `{type:'plan', plan}` — the assistant's own answer, passed
 *                through untouched. Reading it is the page's business, because
 *                the closed list of operations lives in the page.
 *
 * A browser has nobody behind that wire, so the field is there and the button is
 * not: asking is the one thing this page cannot answer on its own.
 */

import { t } from './i18n.js';
import { inApp, send } from './bridge.js';
import { describeDocument, parsePlan } from './plan.js';
import { applyPlan } from './plan-run.js';
import { measureRun } from './run-editor.js';
import { paperColour } from './page-colours.js';
import { pageBox } from './viewer.js';

/** How long an answer is waited for before the field is handed back. */
const PATIENCE = 30000;

let ctx = null;
let timer = 0;
/** The plan on the screen, as parsePlan read it, or null when there is none. */
let shown = null;
/** True while the answer is still on its way. */
let asking = false;

const el = { bar: null, field: null, ask: null, plan: null, steps: null, note: null, run: null, cancel: null };

/* ── the bar itself ──────────────────────────────────────────────────────── */

/** One element, its class and its words. */
function make(tag, className, words) {
  const node = document.createElement(tag);
  node.className = className;
  if (words !== undefined) node.textContent = words;
  return node;
}

/** The field, the button, and the plan that stands between them and the page. */
function build() {
  const bar = make('div', 'ask');
  bar.id = 'ask';
  bar.hidden = true;

  const form = make('form', 'ask-form');
  const field = make('input', 'ask-input');
  field.type = 'text';
  field.dir = 'auto';
  field.autocomplete = 'off';
  const ask = make('button', 'btn primary');
  ask.type = 'submit';
  form.append(field, ask);

  const plan = make('div', 'plan');
  plan.hidden = true;
  const note = make('p', 'plan-note');
  note.hidden = true;
  const steps = make('ol', 'plan-steps');
  const actions = make('div', 'plan-actions');
  const cancel = make('button', 'btn ghost');
  cancel.type = 'button';
  const run = make('button', 'btn primary');
  run.type = 'button';
  actions.append(cancel, run);
  plan.append(note, steps, actions);

  bar.append(form, plan);
  // Above the tool bar and below the property strip: the last band of the screen
  // is still the tools, and this is where the document ends.
  const toolbar = document.getElementById('toolbar');
  toolbar.parentNode.insertBefore(bar, toolbar);

  field.addEventListener('input', paint);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    askAbout();
  });
  run.addEventListener('click', runPlan);
  cancel.addEventListener('click', hide);

  el.bar = bar;
  el.field = field;
  el.ask = ask;
  el.plan = plan;
  el.steps = steps;
  el.note = note;
  el.run = run;
  el.cancel = cancel;
}

/** Every page's own box in points, as the screen measured it. */
function sizes() {
  return ctx.doc.pages.map((_, at) => {
    const box = pageBox(at);
    return box && box.scale > 0 ? { w: box.width / box.scale, h: box.height / box.scale } : null;
  });
}

/* ── what can be pressed, and when ───────────────────────────────────────── */

/** The button is asking, or there is nobody to ask, or nothing has been written. */
function paint() {
  el.ask.disabled = asking || !inApp() || el.field.value.trim() === '';
  el.field.disabled = asking;
  el.ask.setAttribute('aria-busy', String(asking));
  el.bar.hidden = ctx.doc.pages.length === 0;
}

/** The plan comes off the screen. The document is not touched by this. */
function hide() {
  shown = null;
  el.plan.hidden = true;
  el.note.hidden = true;
  el.note.textContent = '';
  el.steps.textContent = '';
}

/** The answer is not coming: the field is handed back rather than held. */
function stopWaiting() {
  asking = false;
  if (timer) window.clearTimeout(timer);
  timer = 0;
}

/* ── asking ──────────────────────────────────────────────────────────────── */

/**
 * The words and the description of the document, and nothing else of the file:
 * one message to the app, which hands both to the assistant and hands the answer
 * straight back.
 */
function askAbout() {
  const words = el.field.value.trim();
  if (words === '' || asking || !inApp()) return;
  const sent = send('ask', { words, description: describeDocument(ctx.doc, sizes()) });
  if (!sent) return;
  hide();
  asking = true;
  timer = window.setTimeout(stopWaiting, PATIENCE);
  paint();
}

/**
 * The assistant answered. `raw` is its own answer, untouched: a plan, the
 * question it asked instead of assuming, or a step the closed list does not have
 * — which is refused here, and never run.
 */
export function answer(raw) {
  if (!ctx) return;
  stopWaiting();
  const read = parsePlan(raw, ctx.doc, sizes());
  shown = read.kind === 'none' ? null : read;
  draw();
  paint();
}

/** One step as one line: what will happen, and, when the model said, why. */
function stepLine(step) {
  const row = make('li', 'plan-step');
  row.append(make('span', 'plan-op', t(step.key, step.vars)));
  if (step.why !== '') row.append(make('span', 'plan-why', step.why));
  return row;
}

/** The plan, or the one line that stands where it would be, on the screen. */
function draw() {
  el.steps.textContent = '';
  el.note.textContent = '';
  const steps = shown !== null && shown.kind === 'plan';
  const note = shown !== null && (shown.kind === 'question' || shown.kind === 'refused');
  el.plan.hidden = shown === null;
  el.steps.hidden = !steps;
  el.note.hidden = !note;
  el.run.hidden = !steps;
  if (steps) {
    for (const step of shown.steps) el.steps.append(stepLine(step));
    return;
  }
  // The model's question is its own sentence, in the person's own language, and
  // is shown as it arrived; a refusal is this page's, and says what it is.
  if (shown !== null && shown.kind === 'question') el.note.textContent = shown.question;
  if (shown !== null && shown.kind === 'refused') el.note.textContent = t('planOutside');
}

/* ── running ─────────────────────────────────────────────────────────────── */

/**
 * «نفّذ»: the whole plan through the editor's own operations, into ONE document,
 * with ONE commit — which is what makes a single undo take all of it back.
 *
 * A step that no longer fits the document — the document moved since the plan was
 * shown — refuses the run. Nothing is applied, and the line a request outside the
 * list gets is the line the person reads.
 */
function runPlan() {
  if (shown === null || shown.kind !== 'plan') return;
  const done = applyPlan(ctx.doc, shown.steps, {
    sizes: sizes(),
    measure: measureRun,
    paper: paperColour,
  });
  el.field.value = '';
  if (!done.ok) {
    shown = { kind: 'refused', op: done.op };
    draw();
    return;
  }
  hide();
  ctx.commit(done.doc);
  paint();
}

/* ── boot ────────────────────────────────────────────────────────────────── */

/**
 * The document moved — this bar's own plan, another tool's edit, an undo — so a
 * plan written about the document as it was is taken off the screen: what stands
 * there is only ever what would run against the document in front of the person.
 */
function followDoc() {
  hide();
  paint();
}

/** The language changed: every word here is written again in the new one. */
export function refresh() {
  if (!ctx) return;
  el.field.setAttribute('aria-label', t('askWhat'));
  el.steps.setAttribute('aria-label', t('planTitle'));
  el.ask.textContent = t('ask');
  el.run.textContent = t('run');
  el.cancel.textContent = t('cancelPlan');
  draw();
}

/** Wired once by main.js. Answers the context, so it can be called inline. */
export function init(context) {
  ctx = context;
  build();
  ctx.on('doc', followDoc);
  ctx.on('open', followDoc);
  refresh();
  paint();
  return ctx;
}
