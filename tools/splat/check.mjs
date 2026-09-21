// Checks the splat tool without a browser. Run from the repo root:
//   node site/tools/splat/check.mjs
// Exits non-zero on the first miss. No dependencies, no network, no writes.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name), "utf8");
const errors = [];
const fail = (msg) => errors.push(msg);

// 1. Every script parses. viewer.js is a classic script; boot.js and i18n.js
//    are ES modules, so they are syntax-checked through stdin.
for (const name of ["boot.js", "i18n.js"]) {
  try {
    execFileSync(process.execPath, ["--input-type=module", "--check"], {
      input: read(name),
      stdio: ["pipe", "ignore", "pipe"],
    });
  } catch (err) {
    fail(`${name} does not parse as an ES module: ${String(err.stderr).trim()}`);
  }
}
try {
  execFileSync(process.execPath, ["--check", join(here, "viewer.js")], {
    stdio: ["ignore", "ignore", "pipe"],
  });
} catch (err) {
  fail(`viewer.js does not parse: ${String(err.stderr).trim()}`);
}

// 2. No stray marker, no remote host, no popup, no absolute URL — the scan
//    ignores comments and licence prose, which are allowed to name the source.
const MARKER = "__APP" + "END__";
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\/[^\n]*/g, "");
for (const name of ["boot.js", "i18n.js", "viewer.js", "index.html", "app.css"]) {
  const code = stripComments(read(name));
  if (code.includes(MARKER)) fail(`${name}: a stray append marker survived`);
  if (/huggingface/i.test(code)) fail(`${name}: names a remote host`);
  if (code.includes("alert(")) fail(`${name}: calls alert()`);
  if (/https?:\/\//.test(code)) fail(`${name}: contains an absolute URL`);
}

// 3. Both dictionaries carry the same keys, and every key boot.js uses exists
//    in BOTH of them.
const i18n = read("i18n.js");
const keysOf = (lang) => {
  const at = i18n.indexOf(`${lang}: {`);
  if (at < 0) return null;
  const open = i18n.indexOf("{", at);
  const body = i18n.slice(open + 1, i18n.indexOf("}", open));
  return new Set([...body.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]));
};
const ar = keysOf("ar");
const en = keysOf("en");
if (!ar || !en) {
  fail("i18n.js does not define both an ar and an en dictionary");
} else {
  for (const k of ar) if (!en.has(k)) fail(`i18n.js: "${k}" is in ar but not en`);
  for (const k of en) if (!ar.has(k)) fail(`i18n.js: "${k}" is in en but not ar`);
  const boot = read("boot.js");
  const used = new Set([...boot.matchAll(/\bt\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  // `t[key]` resolves through string literals (errFormat, …): pick up every
  // literal that is a dictionary key so the dynamic lookup is checked too.
  for (const m of boot.matchAll(/"([A-Za-z_$][\w$]*)"/g)) if (ar.has(m[1]) || en.has(m[1])) used.add(m[1]);
  for (const k of used) {
    if (!ar.has(k)) fail(`boot.js uses "${k}", which is missing from the ar dictionary`);
    if (!en.has(k)) fail(`boot.js uses "${k}", which is missing from the en dictionary`);
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`check: ${e}`);
  process.exit(1);
}
console.log("check: all good");
