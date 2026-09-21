#!/usr/bin/env node
/**
 * Wab Fit — the photo page's own check.
 *
 * Plain Node, no dependencies, no browser: it reads the page's own source and
 * fails on the four rules that are cheapest to break and most expensive to
 * notice. Run it from the repository root:
 *
 *   node site/tools/photo/check.mjs
 *
 *   1. every t('key') a module asks for exists in BOTH dictionaries of i18n.js,
 *      and the two dictionaries carry exactly the same keys;
 *   2. no file still holds a growth marker the module was meant to lose;
 *   3. app.css holds no physical left or right, so Arabic mirrors on its own;
 *   4. no file the page loads names an http(s) address outside a comment: the
 *      photo page asks no other origin for anything;
 *   5. every model and runtime the vendor README records under its `ml/` folder
 *      is present at the byte size it records, so the page runs the pinned
 *      files and not whatever else arrived in that folder;
 *   6. no module under this folder has grown past the line cap — a file that
 *      long is one someone meant to split.
 *
 * A failure prints one line per problem and exits 1. Silence is a pass.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The directory this file lives in. It reads every file but itself. */
const HOME = dirname(fileURLToPath(import.meta.url));
const SELF = 'check.mjs';

/** The growth marker, spelled so that this file does not contain it. */
const MARKER = `__APP${'END'}__`;

/** Every file under `dir`, sorted, this script left out. */
function walk(dir) {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (name !== SELF) found.push(full);
  }
  return found;
}

/** One file as text. */
const read = (file) => readFileSync(file, 'utf8');

/** The keys of `const <name> = { ... };` in `source`, however they are ordered. */
function tableKeys(source, name) {
  const start = source.indexOf(`const ${name} = {`);
  if (start < 0) return new Set();
  const end = source.indexOf('\n};', start);
  const body = source.slice(start, end < 0 ? source.length : end);
  const keys = new Set();
  for (const match of body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_]*)\s*:/gm)) {
    keys.add(match[1]);
  }
  return keys;
}

/** `source` with the body of every comment blanked, strings left intact. */
function maskComments(source) {
  let out = '';
  let at = 0;
  while (at < source.length) {
    const here = source[at];
    const next = source[at + 1];
    if (here === '/' && next === '*') {
      out += '  ';
      at += 2;
      while (at < source.length && !(source[at] === '*' && source[at + 1] === '/')) {
        out += source[at] === '\n' ? '\n' : ' ';
        at += 1;
      }
      out += '  ';
      at += 2;
      continue;
    }
    if (here === '/' && next === '/') {
      out += '  ';
      at += 2;
      while (at < source.length && source[at] !== '\n') {
        out += ' ';
        at += 1;
      }
      continue;
    }
    if (here === "'" || here === '"' || here === '`') {
      out += here;
      at += 1;
      while (at < source.length) {
        const char = source[at];
        if (char === '\\') {
          out += char + (source[at + 1] || '');
          at += 2;
          continue;
        }
        out += char;
        at += 1;
        if (char === here) break;
      }
      continue;
    }
    out += here;
    at += 1;
  }
  return out;
}

/** Every problem found, so one run reports all of them rather than the first. */
const problems = [];
const files = walk(HOME);
const i18n = read(join(HOME, 'i18n.js'));
const ar = tableKeys(i18n, 'ar');
const en = tableKeys(i18n, 'en');

/** 1. The two dictionaries are the same dictionary in two languages. */
for (const key of ar) if (!en.has(key)) problems.push(`i18n.js: ${key} is Arabic only`);
for (const key of en) if (!ar.has(key)) problems.push(`i18n.js: ${key} is English only`);

/** Every key a module names, and the first file that names it. */
const asked = new Map();
for (const file of files.filter((name) => extname(name) === '.js')) {
  for (const match of maskComments(read(file)).matchAll(/(?<![\w$])t\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!asked.has(match[1])) asked.set(match[1], relative(HOME, file));
  }
}
for (const [key, where] of asked) {
  if (!ar.has(key) || !en.has(key)) {
    problems.push(`${where}: t('${key}') is not in both dictionaries`);
  }
}

/** 2. A half-written module must not ship: the marker is a bug on its own. */
for (const file of files) {
  if (read(file).includes(MARKER)) problems.push(`${relative(HOME, file)} holds ${MARKER}`);
}

/** 3. Layout is logical: Arabic mirrors without a second stylesheet. */
const css = maskComments(read(join(HOME, 'app.css')));
css.split('\n').forEach((line, index) => {
  if (/(?:^|[;{\s])(left|right)\s*:/.test(line)) {
    problems.push(`app.css:${index + 1}: physical property ${line.trim()}`);
  }
});

/** 4. Nothing the page loads asks another origin for anything. */
const LOADED = ['.js', '.css', '.html'];
for (const file of files.filter((name) => LOADED.includes(extname(name)))) {
  if (/https?:\/\//.test(maskComments(read(file)))) {
    problems.push(`${relative(HOME, file)} names an address outside a comment`);
  }
}

/** 5. The models are the pinned ones: present, and at the README's own byte size. */
const VENDOR = join(HOME, '..', 'vendor');
const recorded = new Map();
try {
  const readme = read(join(VENDOR, 'README.md'));
  for (const match of readme.matchAll(/`ml\/([^`]+)`\s*—\s*([0-9][0-9,]*) bytes/g)) {
    recorded.set(match[1], Number(match[2].replace(/,/g, '')));
  }
} catch {
  problems.push('vendor/README.md is not readable');
}
if (recorded.size === 0) problems.push('vendor/README.md records no ml/ file');
for (const [name, bytes] of recorded) {
  try {
    const size = statSync(join(VENDOR, 'ml', name)).size;
    if (size !== bytes) problems.push(`vendor/ml/${name}: ${size} bytes, the README records ${bytes}`);
  } catch {
    problems.push(`vendor/ml/${name}: missing`);
  }
}

/** 6. No module is a grown monster. The cap skips i18n.js: it is two tables of
 *  words, not a module, and the whole point of the file is that it is long. */
const CAP = 240;
const WORDS = join(HOME, 'i18n.js');
const modules = files.filter((name) => /\.m?js$/.test(name) && name !== WORDS);
for (const file of [...modules, join(HOME, SELF)]) {
  const lines = (read(file).match(/\n/g) || []).length;
  if (lines > CAP) problems.push(`${relative(HOME, file)}: ${lines} lines, over ${CAP}`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check: ${problem}`);
  console.error(`check: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`check: ${files.length} files, ${ar.size} strings, ${asked.size} keys asked — ok`);
