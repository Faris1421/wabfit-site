/**
 * Wab Fit — object removal, on the device: MI-GAN through onnxruntime-web.
 *
 * The polarity here is the whole finding of ml/check-migan.mjs, measured against
 * the vendored model: MI-GAN's mask names the pixels TO FILL with 0 and the
 * pixels to KEEP with 255 — the reverse of a paint layer. No caller sees that:
 * the mask this module accepts is a fill mask (see `planarMask`), and it is
 * inverted once, here. The input must be binary and 512 by 512; the pipeline
 * does its own cropping, resizing and blending around the mask.
 */
import { VENDOR, classify, failure, once, streamed } from './load.js';

/** Imported once and configured once: GitHub Pages sends no COOP/COEP header. */
let ortLanding = null;
function ort() {
  if (!ortLanding) {
    ortLanding = import(new URL('ort.wasm.min.mjs', VENDOR).href)
      .then((module) => {
        module.env.wasm.numThreads = 1;
        module.env.wasm.simd = true;
        module.env.wasm.wasmPaths = VENDOR.href;
        return module;
      })
      .catch((error) => {
        ortLanding = null;
        throw failure(classify(error));
      });
  }
  return ortLanding;
}

/** RGBA pixels -> the planar uint8 RGB the pipeline declares. */
function planarRGB(pixels) {
  const side = pixels.length / 4;
  const plane = new Uint8Array(side * 3);
  for (let at = 0; at < side; at += 1) {
    plane[at] = pixels[at * 4];
    plane[side + at] = pixels[at * 4 + 1];
    plane[2 * side + at] = pixels[at * 4 + 2];
  }
  return plane;
}

/**
 * RGBA pixels -> MI-GAN's mask, in its own inverted polarity: 0 where the pixel
 * is to be filled, 255 where it is to be kept. A fill mask is a hole cut out of
 * a transparent layer, alpha below 128; a mask with no transparency at all is
 * read as a hole painted on it instead, red 128 and up.
 */
function planarMask(pixels) {
  const side = pixels.length / 4;
  const plane = new Uint8Array(side);
  let solid = true;
  for (let at = 0; at < side; at += 1) if (pixels[at * 4 + 3] < 128) solid = false;
  for (let at = 0; at < side; at += 1) {
    const hole = solid ? pixels[at * 4] >= 128 : pixels[at * 4 + 3] < 128;
    plane[at] = hole ? 0 : 255;
  }
  return plane;
}

/** Planar uint8 RGB -> the RGBA pixels the editor draws. */
function toImageData(plane, width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const side = width * height;
  for (let at = 0; at < side; at += 1) {
    pixels[at * 4] = plane[at];
    pixels[at * 4 + 1] = plane[side + at];
    pixels[at * 4 + 2] = plane[2 * side + at];
    pixels[at * 4 + 3] = 255;
  }
  return new ImageData(pixels, width, height);
}

/** The inpainter, its model, and one session for the life of the page. */
export const loadInpainter = once(async (onProgress) => {
  const engine = await ort();
  const model = await streamed(new URL('migan_pipeline_v2.onnx', VENDOR).href, onProgress);
  let session;
  try {
    session = await engine.InferenceSession.create(model, { executionProviders: ['wasm'] });
  } catch (error) {
    throw failure(classify(error));
  }
  return {
    /** 512 by 512 in, 512 by 512 out: the pipeline crops, resizes and blends. */
    async inpaint(image, mask) {
      const side = image.width;
      const inputs = {
        image: new engine.Tensor('uint8', planarRGB(image.data), [1, 3, side, side]),
        mask: new engine.Tensor('uint8', planarMask(mask.data), [1, 1, side, side]),
      };
      let answer;
      try {
        answer = await session.run(inputs);
      } catch (error) {
        throw failure(classify(error));
      }
      const result = answer[session.outputNames[0]];
      return toImageData(result.data, result.dims[3], result.dims[2]);
    },
  };
});

/** One object removal, for a caller that does not hold the engine. */
export const inpaint = async (image, mask) => (await loadInpainter()).inpaint(image, mask);
