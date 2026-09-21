/**
 * Wab Fit — the on-device runtimes and models of the photo editor, behind one
 * lazy surface. Nothing here is fetched until a tool that needs it opens, and
 * nothing is ever uploaded: every file comes from this site's own folder, and
 * the photo never leaves the page.
 *
 * MI-GAN'S CONVENTIONS, measured against the vendored model by ml/check-migan.mjs:
 *
 *   image   uint8 RGB, planar (NCHW) [1, 3, H, W]. The declared shape is
 *           [batch_size, 3, height, width]; the pipeline crops around the mask,
 *           resizes to 512, inpaints, resizes back and blends, so the answer is
 *           the whole frame at the size it was handed.
 *   mask    uint8 grayscale, planar [1, 1, H, W], and THE POLARITY IS THE
 *           REVERSE OF A PAINT LAYER: 0 names the pixels to FILL and 255 the
 *           pixels to KEEP. Run both ways on a red half, a blue half and a
 *           centred 128x128 hole, mask 0 moved 84.5% of the hole (by up to 130
 *           of 255) and 0.15% of the frame — never more than one pixel past the
 *           hole's edge — while mask 255 moved 99.3% of the frame. The MI-GAN
 *           README says the same: 255 is the known region, 0 the masked one.
 *   result  uint8 RGB, planar [1, 3, H, W].
 *
 * The mask must be binary, and `inpaint` reads it as a FILL mask — a hole cut
 * out of a transparent layer — and writes MI-GAN's inverse polarity itself.
 *
 * Every loader here is memoised and takes `onProgress(0..1)`, counted from the
 * real bytes of the model it streams. The MediaPipe runtime wasm is fetched by
 * MediaPipe itself, with no progress hook, so a bar fills to 1 on the model and
 * then waits. A load that fails rejects with an Error whose `code` is one of
 * 'network', 'memory' or 'unsupported' — no other word.
 */

export { LOAD_FAILURES } from './load.js';
export { inpaint, loadInpainter } from './inpaint.js';
export { landmarks, loadFaceLandmarker, loadSegmenter, segmentPerson } from './vision.js';
