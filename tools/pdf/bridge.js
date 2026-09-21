/**
 * Wab Fit — the one thread between the page and the app.
 *
 * The tool is opened inside a WebView by the mobile app, and also sits at
 * https://www.wabfit.com/tools/pdf/ where somebody can use it in a browser with
 * nothing behind it. So every function here is written to be quiet when there is
 * no app to talk to: `inApp()` is false, `send()` does nothing, and nothing
 * throws. The page is never told to wait for a message that will not come.
 *
 * The two platforms disagree about where a message arrives. On iOS the WebView
 * posts a `message` event on `window`; on Android it posts one on `document`.
 * Both are listened to, and a message arriving twice is the price — the shapes
 * are small and the handlers are idempotent.
 *
 * `ask()` is the other direction, and it is still quiet: a question carries an
 * id, and everything except an answer inside its own time is `null`, which
 * every caller of it treats as "do the job here instead".
 */

/** True when the page is inside the app's WebView rather than a browser. */
export function inApp() {
  return typeof window !== 'undefined' && typeof window.ReactNativeWebView === 'object'
    && window.ReactNativeWebView !== null
    && typeof window.ReactNativeWebView.postMessage === 'function';
}

/**
 * Post one message to the app: `{type, ...payload}` as JSON.
 *
 * Answers whether it went anywhere, so a caller can fall back to doing the job
 * itself in a browser (an export becomes a download).
 */
export function send(type, payload) {
  if (!inApp()) return false;
  const message = JSON.stringify(payload === undefined ? { type } : { type, ...payload });
  try {
    window.ReactNativeWebView.postMessage(message);
    return true;
  } catch {
    // A WebView that has gone away mid-call is not the page's problem to report.
    return false;
  }
}

function parse(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Listen for messages from the app on both platforms' events.
 *
 * A message is only passed on when it is an object carrying a string `type`;
 * anything else (a browser extension, a stray postMessage) is dropped rather
 * than handed to the page as an instruction.
 *
 * Returns the function that stops listening.
 */
export function onMessage(handler) {
  const listener = (event) => {
    const data = parse(event && event.data);
    if (!data || typeof data.type !== 'string') return;
    handler(data);
  };
  window.addEventListener('message', listener);
  document.addEventListener('message', listener);
  return () => {
    window.removeEventListener('message', listener);
    document.removeEventListener('message', listener);
  };
}

/* ── the questions only the app can answer ───────────────────────────────── */

/**
 * How long one question waits for its answer, in milliseconds.
 *
 * A vision call is seconds of a provider's time with a slow connection on top
 * of it. The page has already done the work locally and says so, so a question
 * that goes unanswered costs a line of Arabic and nothing else — which is the
 * whole reason the wait can be this long.
 */
const ASK_TIMEOUT = 45000;

let asked = 0;
/** id → the function that settles that question, while it is still wanted. */
const pending = new Map();
let hearing = false;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The app's answer to one question: the same `type` and the same `id` back,
 * with the answer under `result`. An answer that carries an `error` instead is
 * the question being refused, and a bare `error` message — the one shape the
 * app already sends when a job failed — is every question in flight being
 * refused, because there is nothing left to answer.
 */
function heard(message) {
  const settle = typeof message.id === 'string' ? pending.get(message.id) : undefined;
  if (settle && message.error === undefined) {
    settle(isRecord(message.result) ? message.result : null);
    return;
  }
  if (settle) {
    settle(null);
    return;
  }
  if (message.type === 'error') {
    for (const waiting of Array.from(pending.values())) waiting(null);
  }
}

/**
 * One question the page cannot answer itself, and the app's answer to it.
 *
 * `send` is one-way and this is the other half of it: a question carries an
 * `id`, the app puts that `id` on its reply, and this resolves with the reply's
 * `result` object. Every other ending is the same `null` — no app to ask (the
 * page in a browser), no reply within ASK_TIMEOUT, a reply that is not an
 * object, or a refusal — because a question the page asks is one it can do
 * without.
 */
export function ask(type, payload, timeout = ASK_TIMEOUT) {
  if (!inApp()) return Promise.resolve(null);
  if (!hearing) {
    hearing = true;
    onMessage(heard);
  }
  asked += 1;
  const id = `q${asked}`;
  return new Promise((resolve) => {
    const settle = (value) => {
      if (pending.get(id) !== settle) return;
      pending.delete(id);
      window.clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => settle(null), timeout);
    pending.set(id, settle);
    if (!send(type, { id, ...payload })) settle(null);
  });
}
