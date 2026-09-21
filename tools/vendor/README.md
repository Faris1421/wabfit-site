# Vendored third-party code

Everything in this folder is third-party source, copied verbatim at a pinned commit.

## splat-viewer.js

- Upstream name: `main.js` from [antimatter15/splat](https://github.com/antimatter15/splat)
- Author: Kevin Kwok
- Licence: MIT (full text in `splat-viewer.LICENSE`)
- Pinned commit: `ba182b51b7c2ad5738cdd6741cd63336d27470fb` (main, 2025-11-16)
- Source URL: https://raw.githubusercontent.com/antimatter15/splat/ba182b51b7c2ad5738cdd6741cd63336d27470fb/main.js
- Licence URL: https://raw.githubusercontent.com/antimatter15/splat/ba182b51b7c2ad5738cdd6741cd63336d27470fb/LICENSE

A complete WebGL Gaussian-splat viewer in one file: the sort worker, the vertex and
fragment shaders, touch/mouse/keyboard camera controls, a streaming loader for the
`.splat` format and a converter for standard 3DGS `.ply` files.

## ml/ — the on-device models and runtimes of the photo page

Everything the photo editor runs inside the page. Nothing here is sent anywhere,
no CDN is asked for anything at runtime, and every file is loaded lazily — only
when the tool that needs it is opened. `site/tools/photo/ml/runtime.js` is the
only code that names these files.

### onnxruntime-web — the inpainting runtime

- Upstream name: `onnxruntime-web`
- Version: 1.20.1
- Licence: MIT (`ml/onnxruntime.LICENSE`)
- Source URL: https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/
- Files:
  - `ml/ort.wasm.min.mjs` — 48,904 bytes — the ESM bundle for the wasm backend
  - `ml/ort-wasm-simd-threaded.mjs` — 24,618 bytes — the glue that bundle loads
  - `ml/ort-wasm-simd-threaded.wasm` — 11,246,032 bytes — the engine itself

Why exactly these three: GitHub Pages cannot send COOP/COEP, so there is no
SharedArrayBuffer and no thread pool. The page sets `ort.env.wasm.numThreads = 1`
and `ort.env.wasm.simd = true`, which is the pair `ort-wasm-simd-threaded` is for.
The WebGPU, WebGL, WebNN and JSEP bundles and every source map are left out.

### MI-GAN — object removal

- Upstream name: `migan_pipeline_v2.onnx` (the MI-GAN-512-Places2 ONNX pipeline)
- Version: the file the repository links as its pre-converted pipeline (main, 2026-09-21)
- Author: Andranik Sargsyan and the Picsart AI Research team
- Licence: MIT for the code and MIT for the weights (`ml/migan.LICENSE`, `ml/migan.LICENSE-WEIGHTS`)
- Model card: https://huggingface.co/andraniksargsyan/migan
- Source URL: https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx
- File: `ml/migan_pipeline_v2.onnx` — 28,079,181 bytes

The whole pipeline — cropping around the mask, resizing to 512, the network, the
resize back and the blend — in one graph. `image` is uint8 RGB planar, `mask` is
uint8 grayscale planar where **0 marks the pixels to fill and 255 the pixels to
keep**, and `result` is uint8 RGB planar at the size it was handed. Verified by
running it, both polarities: `node site/tools/photo/ml/check-migan.mjs`.

### MediaPipe Tasks Vision — face landmarks and person masks

- Upstream name: `@mediapipe/tasks-vision`
- Version: 0.10.14
- Licence: Apache-2.0 (`ml/mediapipe.LICENSE`)
- Source URL: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/
- Files:
  - `ml/vision_bundle.mjs` — 136,870 bytes — the ESM bundle
  - `ml/wasm/vision_wasm_internal.js` — 209,826 bytes — the SIMD loader
  - `ml/wasm/vision_wasm_internal.wasm` — 9,423,986 bytes
  - `ml/wasm/vision_wasm_nosimd_internal.js` — 209,735 bytes — the loader a
    browser without WebAssembly SIMD asks for by name
  - `ml/wasm/vision_wasm_nosimd_internal.wasm` — 9,294,247 bytes

Models, from Google's own model store:

- `ml/face_landmarker.task` — 3,758,596 bytes — `face_landmarker` float16, version 1,
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- `ml/selfie_segmenter.tflite` — 249,537 bytes — `selfie_segmenter` float16, latest,
  https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite

# Vendored libraries

Plain files, committed as they were published. No bundler, no npm, no CDN at runtime: the PDF
tool under `site/tools/pdf/` loads these by relative URL, so the page works with its own origin
as the only network it has — and it has none of its own either, because every byte of the PDF
stays inside the page.

When one of these is updated, replace the file, update the row below, and re-check that the
`sha256` still matches the published artefact.

| file | library | version | licence | source URL |
| --- | --- | --- | --- | --- |
| `pdf-lib.esm.min.js` | pdf-lib | 1.17.1 | MIT | https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.min.js |
| `fontkit.umd.min.js` | @pdf-lib/fontkit | 1.1.1 | MIT | https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js |
| `pdf.min.mjs` | pdfjs-dist | 4.10.38 | Apache-2.0 | https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs |
| `pdf.worker.min.mjs` | pdfjs-dist | 4.10.38 | Apache-2.0 | https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs |

## sha256 of what is committed

```
d8df561b9fba98e24f2e5130e40948809281bbbc55a20c412359f1a0a5eb35a6  fontkit.umd.min.js
27fc2a057a00f92a4334ad06e17dbd7259912954e9fb7f76400bcca5fd190a9c  pdf.min.mjs
1baa1844c89c80a5b2797c916e75ab29254be46d8e9cb53cb6364d7aad84be36  pdf.worker.min.mjs
72c052d97b4d5d9fa6cdbdcb7ad709f03d4ddb1122390cb3afeba4d88651d969  pdf-lib.esm.min.js
```

## How each one is loaded

- `pdf-lib.esm.min.js` — ES module. `await import('../vendor/pdf-lib.esm.min.js')`, on demand.
  It WRITES a PDF: building a blank document, and every edit the toolbar performs.
- `fontkit.umd.min.js` — classic script (UMD), sets the global `fontkit`, committed beside the
  others for the typeface work: `pdfDoc.registerFontkit(fontkit)` is what lets an Arabic face be
  embedded and subset into a document. It is fetched by a script tag injected on demand, never at
  import time, so a session that only reads a PDF never pays for it.
- `pdf.min.mjs` — ES module. `await import('../vendor/pdf.min.mjs')`, on demand. It READS a
  PDF and rasterises it onto the page canvases.
- `pdf.worker.min.mjs` — the pdf.js worker, addressed through
  `new URL('../vendor/pdf.worker.min.mjs', import.meta.url)`. It is the reason the main
  thread keeps scrolling while a page renders.
