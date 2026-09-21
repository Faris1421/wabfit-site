#!/usr/bin/env node
/**
 * Wab Fit — the PDF page's own check.
 *
 * Plain Node, no browser, no dependencies. Run it from the repository root:
 *
 *   node site/tools/pdf/check.mjs
 *
 *   1. every module in this folder parses as an ES module;
 *   2. the two dictionaries of i18n.js carry exactly the same keys, and every
 *      key a module NAMES — `t('key')`, and the `key:` of a tool or an operation
 *      — is in both of them;
 *   3. no file still holds a half-written module's marker;
 *   4. `parsePlan` reads a fixture plan, refuses a plan naming an operation the
 *      closed list does not have, and answers a question as a question;
 *   5. `applyPlan` runs NO part of a plan holding an unknown operation, and runs
 *      the rest of a plan whole — onto its own copy, never the document given;
 *   6. a text step with nothing that can measure it is refused rather than
 *      estimated, and every operation in the closed list has a runner.
 *
 * A failure prints one line per problem and exits 1. Silence is a pass.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The folder this file lives in. It reads every file but itself. */
const HOME = dirname(fileURLToPath(import.meta.url));
const SELF = 'check.mjs';

/** The marker a module carries while it is being written, in two pieces here. */
const MARKER = `__APP${'END'}__`;

/** Every problem found, so one run reports all of them rather than the first. */
const problems = [];
const fail = (problem) => problems.push(problem);

const read = (file) => readFileSync(file, 'utf8');

function walk(dir) {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (name !== SELF) found.push(full);
  }
  return found;
}

const files = walk(HOME);

/** 1. Every module parses — as a module, whatever the package type says. */
for (const file of files.filter((name) => /\.m?js$/.test(name))) {
  try {
    execFileSync(process.execPath, ['--input-type=module', '--check'], {
      input: read(file),
      stdio: ['pipe', 'ignore', 'pipe'],
    });
  } catch (error) {
    fail(`${relative(HOME, file)} does not parse: ${String(error.stderr).trim()}`);
  }
}

/** 2. The two dictionaries are the same dictionary in two languages. */
const i18n = read(join(HOME, 'i18n.js'));

/** The keys of `const <name> = { ... };` in `source`, however they are ordered. */
function tableKeys(source, name) {
  const start = source.indexOf(`const ${name} = {`);
  if (start < 0) return new Set();
  const end = source.indexOf('\n};', start);
  const body = source.slice(start, end < 0 ? source.length : end);
  return new Set([...body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_]*)\s*:/gm)].map((match) => match[1]));
}

const ar = tableKeys(i18n, 'ar');
const en = tableKeys(i18n, 'en');
for (const key of ar) if (!en.has(key)) fail(`i18n.js: ${key} is Arabic only`);
for (const key of en) if (!ar.has(key)) fail(`i18n.js: ${key} is English only`);

/** Every key a module NAMES, and the first file that names it. */
const asked = new Map();
for (const file of files.filter((name) => extname(name) === '.js')) {
  const source = read(file);
  for (const match of source.matchAll(/(?<![\w$])t\(\s*['"]([^'"]+)['"]/g)) {
    if (!asked.has(match[1])) asked.set(match[1], relative(HOME, file));
  }
  // A tool's `key:` and an operation's `key:` are looked up at run time, so the
  // scan has to read the literals out of the source rather than the call.
  for (const match of source.matchAll(/^\s*key: '([A-Za-z][A-Za-z0-9_]*)'/gm)) {
    if (!asked.has(match[1])) asked.set(match[1], relative(HOME, file));
  }
}
for (const [key, where] of asked) {
  if (!ar.has(key) || !en.has(key)) fail(`${where}: '${key}' is not in both dictionaries`);
}

/** 3. A half-written module must not ship: the marker is a bug on its own. */
for (const file of files) {
  if (read(file).includes(MARKER)) fail(`${relative(HOME, file)} holds ${MARKER}`);
}

/* ── 4. the answer, read against a fixture plan ──────────────────────────── */

const { appendSource, emptyDoc } = await import(pathToFileURL(join(HOME, 'core.js')).href);
const { OP_NAMES, describeDocument, parsePlan } = await import(pathToFileURL(join(HOME, 'plan.js')).href);
const { applyPlan } = await import(pathToFileURL(join(HOME, 'plan-run.js')).href);

const ok = (condition, message) => {
  if (!condition) fail(message);
};

/** Three pages, and the sizes the screen would have measured for them. */
const doc = appendSource(emptyDoc(), 0, 3);
const sizes = doc.pages.map(() => ({ w: 595.28, h: 841.89 }));

/** The steps of an answer, whether or not it was read as a plan. */
const stepsOf = (answered) => (answered.kind === 'plan' ? answered.steps : []);

const FIXTURE = {
  steps: [
    { op: 'rotatePage', args: { page: 1, delta: 90 }, why: 'الصفحة الأولى مقلوبة' },
    { op: 'addPage', args: { at: 2 } },
    { op: 'addText', args: { page: 2, x: 40, y: 60, text: 'الفاتورة' } },
  ],
};

const plan = parsePlan(FIXTURE, doc, sizes);
ok(plan.kind === 'plan', 'a fixture plan of three known operations was not read as a plan');
ok(stepsOf(plan).length === 3, 'the fixture plan lost a step');
ok(stepsOf(plan)[0].key === 'opRotatePage', 'the first step did not name the line for a quarter turn');
ok(stepsOf(plan)[0].vars.n === 1 && stepsOf(plan)[0].vars.deg === 90, 'the first step lost its numerals');
ok(stepsOf(plan)[0].why === 'الصفحة الأولى مقلوبة', 'the reason the model gave was dropped');
ok(stepsOf(plan)[1].key === 'opAddPage' && stepsOf(plan)[1].vars.n === 2, 'the second step was misread');
ok(stepsOf(plan)[2].key === 'opAddText', 'the third step was misread');

/** 5. An operation the closed list does not have is refused, never executed. */
const unknown = parsePlan({ steps: [{ op: 'addImage', args: { page: 1 } }] }, doc, sizes);
ok(unknown.kind === 'refused', 'a plan naming addImage was not refused');
ok(unknown.kind === 'refused' && unknown.op === 'addImage', 'the refusal did not name the operation');
ok(unknown.steps === undefined, 'a refusal carried steps to run');

const misplaced = parsePlan({ steps: [{ op: 'rotatePage', args: { page: 9, delta: 45 } }] }, doc, sizes);
ok(misplaced.kind === 'refused', 'a page that is not there, turned 45 degrees, was not refused');

const overflowing = parsePlan({ steps: [{ op: 'whiteout', args: { page: 1, x: 500, y: 800, w: 300, h: 100 } }] }, doc, sizes);
ok(overflowing.kind === 'refused', 'a box that leaves its page was not refused');

const questioned = parsePlan({ steps: [], question: 'أي صفحة تقصد؟' }, doc, sizes);
ok(questioned.kind === 'question' && questioned.question === 'أي صفحة تقصد؟', 'a question was not read as one');
ok(parsePlan('{ not json', doc, sizes).kind === 'none', 'something that is not an answer was read as one');

/* ── 6. the plan run, onto its own copy ──────────────────────────────────── */

const run = applyPlan(doc, [
  { op: 'addPage', args: { at: 4 } },
  { op: 'rotatePage', args: { page: 1, delta: 90 } },
  { op: 'movePage', args: { page: 1, to: 4 } },
  { op: 'whiteout', args: { page: 2, x: 10, y: 10, w: 40, h: 20, color: null } },
], { sizes });
ok(run.ok === true, 'a plan of four known operations did not run');
ok(run.ok === true && run.count === 4, 'the run did not count every step');
ok(run.ok === true && run.doc.pages.length === 4, 'the blank page did not join the document');
ok(run.ok === true && run.doc.pages[3].rotate === 90, 'the page that moved did not keep its quarter turn');
ok(run.ok === true && run.doc.objects.length === 1, 'the cover did not join the document');
ok(run.ok === true && run.doc.objects[0].color === '#ffffff', 'a cover with no colour of its own is not the paper');
ok(doc.pages.length === 3 && doc.objects.length === 0, 'the document the plan ran against was written to');

const forged = applyPlan(doc, [{ op: 'addImage', args: { page: 1, x: 0, y: 0, w: 10, h: 10 } }], { sizes });
ok(forged.ok === false && forged.op === 'addImage', 'the run did not refuse an unknown operation');
ok(doc.pages.length === 3 && doc.objects.length === 0, 'an unknown operation was executed anyway');

const half = applyPlan(doc, [
  { op: 'addPage', args: { at: 1 } },
  { op: 'deletePage', args: { page: 9 } },
], { sizes });
ok(half.ok === false, 'a plan with an impossible step was not refused');
ok(doc.pages.length === 3, 'part of a refused plan was applied');

const words = { op: 'addText', args: { page: 1, x: 10, y: 10, text: 'hi', size: null, color: null, bold: null } };
ok(applyPlan(doc, [words], { sizes }).ok === false, 'text with nothing to measure it was not refused');
const measured = applyPlan(doc, [words], { sizes, measure: () => ({ w: 60, h: 18 }) });
ok(measured.ok === true && measured.doc.objects[0].kind === 'text', 'a measured run of text did not join the document');

/** Every operation in the closed list has something that runs it. */
const runner = read(join(HOME, 'plan-run.js'));
const runners = new Set([...runner.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_]*)\(doc/gm)].map((match) => match[1]));
for (const op of OP_NAMES) if (!runners.has(op)) fail(`plan-run.js has no runner for ${op}`);
ok(OP_NAMES.length === 9, `the closed list has ${OP_NAMES.length} operations, not nine`);

/** The description is built from the model, and says what the steps are written against. */
const described = describeDocument(doc, sizes);
ok(described.startsWith('pages: 3\n'), 'the description does not open with the page count');
ok(described.includes('page 1: 595.28x841.89pt'), 'the description does not carry a page and its size');

if (problems.length > 0) {
  for (const problem of problems) console.error(`check: ${problem}`);
  console.error(`check: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`check: ${files.length} files, ${ar.size} strings, ${asked.size} keys asked, ${OP_NAMES.length} operations — ok`);
