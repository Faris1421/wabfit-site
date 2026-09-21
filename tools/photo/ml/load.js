/**
 * Wab Fit — how an on-device model is fetched: one streamed read, one closed
 * vocabulary of failures, one promise per load. Every runtime under ml/ shares
 * this, so a caller switches on the same three words whatever it asked for.
 */

/** Where the vendored runtimes and models live, beside this page's folder. */
export const VENDOR = new URL('../../vendor/ml/', import.meta.url);

/** Every way a load can fail, and the only ones. `error.code` is one of them. */
export const LOAD_FAILURES = ['network', 'memory', 'unsupported'];

/** A failure from the closed vocabulary, whose message is the word itself. */
export function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/** Sort whatever was thrown into one of the three words. */
export function classify(error) {
  const text = String((error && error.message) || error);
  if (/fetch|network|load failed|failed to load|404|not found/i.test(text)) return 'network';
  if (/memory|allocat|out of bounds|RangeError/i.test(text)) return 'memory';
  return 'unsupported';
}

/**
 * One load however many callers. The first call starts it and the first
 * `onProgress` is the one that is reported; a failure clears the slot so the
 * next call can try again.
 */
export function once(start) {
  let landed = null;
  return (...args) => {
    if (!landed) {
      landed = start(...args).catch((error) => {
        landed = null;
        throw error;
      });
    }
    return landed;
  };
}

/**
 * The whole file, counted as it arrives: `onProgress(fraction)` gets real bytes
 * over real bytes, 0 at the first and 1 at the end. GitHub Pages sends a
 * content-length for every vendored file, so the fraction is determinate.
 */
export async function streamed(url, onProgress) {
  if (onProgress) onProgress(0);
  let answer;
  try {
    answer = await fetch(url);
  } catch {
    throw failure('network');
  }
  if (!answer.ok) throw failure('network');
  if (!answer.body) {
    const whole = new Uint8Array(await answer.arrayBuffer());
    if (onProgress) onProgress(1);
    return whole;
  }
  const total = Number(answer.headers.get('content-length') || 0);
  const reader = answer.body.getReader();
  const parts = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    if (onProgress && total > 0) onProgress(Math.min(1, loaded / total));
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  if (onProgress) onProgress(1);
  return bytes;
}
