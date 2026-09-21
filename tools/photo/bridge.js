/**
 * Wab Fit — the one thread between the photo page and the app.
 *
 * The page is opened inside a WebView by the mobile app, and it also sits at
 * https://www.wabfit.com/tools/photo/ where somebody can use it in a plain
 * browser with nothing behind it. So every function here is written to be quiet
 * when there is no app to talk to: `inApp()` is false, `send()` returns false,
 * and nothing throws. The page is never told to wait for a message that will
 * not come.
 *
 * The two platforms disagree about where a message arrives. On iOS the WebView
 * posts a `message` event on `window`; on Android it posts one on `document`.
 * Both are listened to, and a message arriving twice is the price — the page's
 * handlers are idempotent.
 *
 * What the app says:   {type:'open', name, base64} · {type:'theme', theme, lang}
 * What the page says:  {type:'ready'} · {type:'dirty', dirty}
 *                      {type:'error', code} · {type:'export', name, base64, save}
 *
 * `save` is `'library'` or `'share'`: the app decides where a finished photo
 * goes, because only the app knows whether it has the photo library's
 * permission. Nothing here ever reads the photo back.
 */

/** True when the page is inside the app's WebView rather than a browser. */
export function inApp() {
  return (
    typeof window !== 'undefined' &&
    typeof window.ReactNativeWebView === 'object' &&
    window.ReactNativeWebView !== null &&
    typeof window.ReactNativeWebView.postMessage === 'function'
  );
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

/** The page is up and listening. */
export function sendReady() {
  return send('ready');
}

/** There are unsaved edits (true) or there are none (false). */
export function sendDirty(dirty) {
  return send('dirty', { dirty: dirty === true });
}

/** Something failed. `code` is a short token the app turns into its own words. */
export function sendError(code) {
  return send('error', { code: String(code) });
}

/** A finished photo, on its way to the library or to the share sheet. */
export function sendExport(name, base64, save) {
  return send('export', {
    name,
    base64,
    save: save === 'share' ? 'share' : 'library',
  });
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
 * Listen for messages from the app, on both platforms' events.
 *
 * A message is passed on only when it is an object carrying a string `type`;
 * anything else (a browser extension, a stray postMessage) is dropped rather
 * than handed to the page as an instruction. Returns the function that stops
 * listening.
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

/** Wire bytes → bytes, for a photo the app hands over as base64. */
export function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Bytes → wire base64, in chunks so a full-resolution photo keeps the stack. */
export function base64FromBytes(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(index, index + chunk)));
  }
  return btoa(binary);
}
