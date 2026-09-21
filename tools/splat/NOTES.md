# Notes on the vendored renderer (`site/tools/vendor/splat-viewer.js`)

Source: antimatter15/splat `main.js` @ `ba182b51b7c2ad5738cdd6741cd63336d27470fb` (MIT, Kevin Kwok).
See `site/tools/vendor/README.md`. 51,459 bytes, 1,484 lines, plain JavaScript (no HTML wrapper).

Verified anchors: `createWorker` L298, `processPlyBuffer` L474-620 (defined inside `createWorker`),
`gl_Position` L678 (degenerate-splat guard) and L708 (real clip position). Each splat is an instanced
quad — `gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, vertexCount)` L1362 — so there is no `gl_PointSize`.

## (a) How it decides which URL to load

- L739 `async function main()`, L740 `let carousel = true`.
- L741 `const params = new URLSearchParams(location.search);`
- L743-745 the camera pose is parsed from `location.hash`; a parse failure keeps the carousel running.
- L746-751 the URL is built as `new URL(params.get("url") || "train.splat", "https://huggingface.co/cakewalk/splat-data/resolve/main/")`.
  The `?url=` value can therefore be absolute; the fallback is a REMOTE huggingface default model — this is
  the line to change (no CDN at runtime, one local `?src=`).
- L752-755 `fetch(url, { mode: "cors", credentials: "omit" })`.
- L757-758 any non-200 throws `"<status> Unable to load <url>"`.
- L760-762 the body is streamed; the byte array is sized from `req.headers.get("content-length")`, so the
  server must send that header (GitHub Pages does for static assets).
- L764-765 a `downsample` of `1` is used for large models, else `1 / devicePixelRatio`; it scales the canvas
  (L859-860) and `camera.fx / camera.fy` (L848, L1397-1398).
- L768-774 the sort worker is created from a Blob of `createWorker.toString()`.
- This fetch at L752 is the ONLY network request in the file: no CDN, no analytics.

## (b) Dropped / selected file, and the `.ply` branch

- L1384-1388 `isPly(splatData)`: the 3DGS magic header, the four bytes `"ply\n"` (112, 108, 121, 10).
- L1390-1425 `const selectFile = (file) => { ... }`:
  - L1392-1406 `.json` branch: loads a `cameras` array (image poses) over the baked-in one; not used by us.
  - L1407-1408 `stopLoading = true` cancels the streaming loader of L1451-1478.
  - L1413-1415 `.ply` branch: `worker.postMessage({ ply: splatData.buffer, save: true })`.
    `save: true` makes the worker convert the PLY (L637-643) and post it back, which triggers the
    downloader of L869-881: it builds a blob, a hidden `<a download="model.splat">` and `link.click()`.
    That is the ONE download of the splat; it must be tied to `?src=` and must NOT fire merely on load.
  - L1416-1421 otherwise the raw `.splat` is posted as `{ buffer, vertexCount }`.
- L1434-1445 drag & drop wiring: `dragenter`/`dragover`/`dragleave` are prevented on `document`,
  `drop` calls `selectFile(e.dataTransfer.files[0])`. There is NO `<input type=file>` anywhere.
- L1451-1478 the streaming loop; on non-PLY data it posts growing buffers (L1458-1466), and at the end
  (L1468-1477) a PLY is posted once with `{ ply, save: false }`.
- Worker side: L636-652 `self.onmessage` — `e.data.ply` → `processPlyBuffer` (L474-620), `e.data.buffer`,
  `e.data.vertexCount`, `e.data.view`.

## (c) DOM ids it expects (all via `getElementById`)

| id | lines | notes |
| --- | --- | --- |
| `canvas` | L776 | must give a `webgl2` context (L782); sized from `innerWidth`/`innerHeight` (L859-860) |
| `fps` | L777, written L1374 | `Math.round(avgFps) + " fps"` — English literal, must be hidden/replaced |
| `camid` | L778, written L941, L948, L951, L1376 | `"cam  " + n`, L941 — same |
| `spinner` | L1359, L1365, L1482 | `style.display` toggled |
| `progress` | L1370, L1372 | `style.width = n + "%"`, then `style.display = "none"` |
| `message` | L1483 | `innerText = err.toString()` on failure |

A missing `canvas`, `fps` or `camid` throws (they are dereferenced unconditionally). Nothing else in the
document is queried; `resize` listens on `window`, drag & drop on `document`, the rest on `canvas`.

## Other facts worth keeping

- L1-158 a baked-in `cameras` array (a demo scene) and `let camera = cameras[0]` L158; `camera.fx/fy` feed
  the projection (L848-855). `defaultViewMatrix` L734-737, `viewMatrix` L738.
- Controls: `keydown`/`keyup`/`blur` L923-959 (digits switch camera, `V` writes the pose into the hash,
  `P` restarts the carousel), `wheel` L961-1003, `mousedown` L1006, `mousemove` L1021, `mouseup` L1057,
  `contextmenu` L1013, gamepad L1170/L1176, and the touch trio `touchstart` L1066, `touchmove` L1087,
  `touchend` L1152 (all `preventDefault`).
- Carousel: L1331-1339, driven by `Date.now() - start`; any input sets `carousel = false`.
- L1481-1484 `main().catch(...)` hides the spinner and writes the error into `#message`.
- The frame loop L1355-1379 recomputes `progress` from `splatData.length / rowLength`; `vertexCount` 0 keeps
  the spinner visible.
