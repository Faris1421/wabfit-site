# Self-test — the 3D scan viewer (`site/tools/splat/`)

No browser automation, no npm. Two parts: what `check.mjs` proves on its own,
and what a person must look at in a desktop browser.

## 0. The automated check

From the repo root:

```
node site/tools/splat/check.mjs
```

It must print `check: all good` and exit 0. It proves: `boot.js` and `i18n.js`
parse as ES modules, `viewer.js` parses as a classic script; no stray append
marker, no remote host, no `alert(` and no absolute URL appear outside comments
in `boot.js`, `i18n.js`, `viewer.js`, `index.html` or `app.css`; and every key
`boot.js` reads exists in BOTH the `ar` and the `en` dictionary (the `ar` and
`en` key sets are identical).

## 1. Serve the static app

From the repo root:

```
cd site && python -m http.server 8000
```

The site root is `site/`, so the tool is at
<http://localhost:8000/tools/splat/>. Keep the terminal open.

## 2. No source (the opening state)

Open <http://localhost:8000/tools/splat/> with no query string.

- The line «لا يوجد مجسّم للعرض» is centred on a black background.
- There is no reset button, no progress bar, no error in the console, and no
  network request other than the page's own files.

`?lang=en` shows `Nothing to show`; `?theme=light` gives the light palette.

## 3. Why the host allowlist refuses a remote sample

`boot.js` accepts a `?src=` only when it is `https:` AND its host is
`www.wabfit.com` or ends in `.supabase.co`. A public sample URL (for example a
raw GitHub or an S3 URL) therefore fails `acceptSrc`, `window.__WABFIT_SRC__`
stays `null`, and the page shows the same «لا يوجد مجسّم للعرض» line as §2.

Confirm: <http://localhost:8000/tools/splat/?src=https://example.com/model.splat>
shows the no-source line and issues no fetch to `example.com`.

## 4. Testing a real model locally (temporary dev switch)

Loading a model needs a URL the allowlist will take. Add a switch to `boot.js`
that is honoured ONLY on a loopback host, and REMOVE it again afterwards.

In `site/tools/splat/boot.js`, inside `acceptSrc`, right after
`url = new URL(raw);` and before the `url.protocol !== "https:"` line, insert:

```js
  // TEMPORARY — local testing only. Remove before committing.
  if (
    params.get("dev") === "1" &&
    (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ) {
    return url.href;
  }
```

Then put a sample scan in the served folder (copy one in; do not commit it):

```
cp /path/to/model.splat site/tools/splat/sample.splat   # or a Brush .ply
```

and open, on the phone-sized viewport (DevTools, 390x844):

- <http://localhost:8000/tools/splat/?dev=1&src=http://localhost:8000/tools/splat/sample.splat>

Expect: the thin accent progress bar fills, the model appears, the reset button
fades in, and — for a `.ply` only — the worker converts it and the one
`model.splat` download named by `?src=` is offered. Drag on the canvas must
orbit and pinch must zoom; `?dev=0` or a non-loopback host must NOT be let in
(open the same URL through a machine's LAN IP: the no-source line returns).

When done: delete the inserted lines and the sample file, then re-run
`node site/tools/splat/check.mjs` and confirm `check: all good`.

## 5. The rest of the matrix (desktop, no model needed)

- `?lang=ar` (default) sets `<html dir="rtl" lang="ar">`; `?lang=en` sets
  `dir="ltr" lang="en"`. Toggling via the bridge (`{type:"theme",theme,lang}`
  from the WebView, and the DOM `message` event) flips palette and direction
  without a reload.
- `?theme=light` swaps to the light tokens; dark is the default.
- The reset button's `aria-label` follows the language.
