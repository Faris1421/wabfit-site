/**
 * The page's wiring, loaded as an ES module BEFORE viewer.js so that the
 * viewer finds everything it needs already in place: the model URL, the
 * language, the theme, and the three callbacks it reports through.
 *
 * Nothing here runs a network request. The only URL the page will ever fetch
 * is the one the app hands in through ?src=, and only if it points at our own
 * storage.
 */
import { STRINGS } from "./i18n.js";

const params = new URLSearchParams(location.search);

// ── The model URL ───────────────────────────────────────────────────────────
// A src is accepted only when it is https and its host is our own: the
// Supabase storage bucket the app uploads to, or this site. Anything else is
// treated as no source at all — an arbitrary URL must never become a fetch.
const acceptSrc = (raw) => {
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch (err) {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== "www.wabfit.com" && !url.hostname.endsWith(".supabase.co"))
    return null;
  return url.href;
};

window.__WABFIT_SRC__ = acceptSrc(params.get("src"));

// ── The bridge, identical to the PDF tool's ─────────────────────────────────
const post = (msg) => {
  const rn = window.ReactNativeWebView;
  if (rn && typeof rn.postMessage === "function") {
    rn.postMessage(JSON.stringify(msg));
  }
};

// ── Language and theme ──────────────────────────────────────────────────────
let t = STRINGS.ar;
const stateLine = document.getElementById("message");
const resetButton = document.getElementById("reset");

const setState = (text) => {
  if (stateLine) stateLine.textContent = text;
};

const applyTheme = (theme, lang) => {
  const root = document.documentElement;
  root.dataset.theme = theme === "light" ? "light" : "dark";
  const language = lang === "en" ? "en" : "ar";
  root.lang = language;
  root.dir = language === "ar" ? "rtl" : "ltr";
  t = STRINGS[language];
  if (resetButton) resetButton.setAttribute("aria-label", t.reset);
};

applyTheme(params.get("theme"), params.get("lang"));

// ── What the viewer reports through ─────────────────────────────────────────
window.__WABFIT_NOSOURCE__ = () => {
  setState(t.noSource);
};

window.__WABFIT_FAIL__ = (code) => {
  const key = code === "format" ? "errFormat" : code === "webgl" ? "errWebgl" : "errNetwork";
  setState(t[key]);
  post({ type: "error", code: code });
};

window.__WABFIT_READY__ = () => {
  setState("");
  if (resetButton) resetButton.hidden = false;
  post({ type: "ready" });
};

// ── The one control ─────────────────────────────────────────────────────────
if (resetButton) {
  resetButton.addEventListener("click", () => {
    if (typeof window.__WABFIT_RESET__ === "function") window.__WABFIT_RESET__();
  });
}

// ── The app can change the theme or the language after load ─────────────────
const onMessage = (event) => {
  let msg = event.data;
  if (typeof msg === "string") {
    try {
      msg = JSON.parse(msg);
    } catch (err) {
      return;
    }
  }
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "theme") applyTheme(msg.theme, msg.lang);
};

window.addEventListener("message", onMessage);
document.addEventListener("message", onMessage);

// ── The opening state ───────────────────────────────────────────────────────
if (window.__WABFIT_SRC__) {
  setState(t.loading);
} else {
  setState(t.noSource);
}
