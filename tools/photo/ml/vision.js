/**
 * Wab Fit — faces and people, on the device: MediaPipe Tasks Vision, vendored.
 *
 * The bundle and its two wasm pairs are imported only when a face or background
 * tool opens. MediaPipe fetches that wasm itself and reports nothing, so a bar
 * driven by `onProgress` here fills to 1 on the model and then waits.
 */
import { VENDOR, classify, failure, once, streamed } from './load.js';

/** The bundle, imported the moment a face or background tool opens. */
let visionLanding = null;
function vision() {
  if (!visionLanding) {
    visionLanding = import(new URL('vision_bundle.mjs', VENDOR).href).catch((error) => {
      visionLanding = null;
      throw failure(classify(error));
    });
  }
  return visionLanding;
}

/** The vendored wasm pair, resolved from this folder and never from a CDN. */
const filesetOf = (bundle) => bundle.FilesetResolver.forVisionTasks(new URL('wasm', VENDOR).href);

/** How much of the frame a face covers, in normalised units: the widest wins. */
function boxOf(face) {
  let west = 1, north = 1, east = 0, south = 0;
  for (const point of face) {
    if (point.x < west) west = point.x;
    if (point.x > east) east = point.x;
    if (point.y < north) north = point.y;
    if (point.y > south) south = point.y;
  }
  return (east - west) * (south - north);
}

/** The largest face's 478 landmarks, in image pixels, or null. */
function faceOf(landmarker, bitmap) {
  let answer;
  try {
    answer = landmarker.detect(bitmap);
  } catch (error) {
    throw failure(classify(error));
  }
  let best = null;
  let widest = -1;
  for (const face of answer.faceLandmarks ?? []) {
    if (face.length !== 478) continue;
    const box = boxOf(face);
    if (box > widest) {
      widest = box;
      best = face;
    }
  }
  if (!best) return null;
  return best.map((point) => ({
    x: point.x * bitmap.width,
    y: point.y * bitmap.height,
    z: point.z * bitmap.width,
  }));
}

/** The face mesh model. The first call's onProgress is the one that is used. */
export const loadFaceLandmarker = once(async (onProgress) => {
  const bundle = await vision();
  const fileset = await filesetOf(bundle);
  const model = await streamed(new URL('face_landmarker.task', VENDOR).href, onProgress);
  let landmarker;
  try {
    landmarker = await bundle.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: model },
      runningMode: 'IMAGE',
      numFaces: 4,
    });
  } catch (error) {
    throw failure(classify(error));
  }
  return { landmarks: (bitmap) => faceOf(landmarker, bitmap) };
});

/** The largest face's landmarks in image pixels, or null when there is no face. */
export const landmarks = async (bitmap) => (await loadFaceLandmarker()).landmarks(bitmap);

/** The person mask, 1 where a person is, at the model's own resolution. */
function personOf(segmenter, bitmap) {
  let answer;
  try {
    answer = segmenter.segment(bitmap);
  } catch (error) {
    throw failure(classify(error));
  }
  const mask = (answer.confidenceMasks ?? [])[0];
  const found = mask
    ? { mask: Float32Array.from(mask.getAsFloat32Array()), width: mask.width, height: mask.height }
    : null;
  answer.close();
  return found;
}

/** The selfie segmenter. The first call's onProgress is the one that is used. */
export const loadSegmenter = once(async (onProgress) => {
  const bundle = await vision();
  const fileset = await filesetOf(bundle);
  const model = await streamed(new URL('selfie_segmenter.tflite', VENDOR).href, onProgress);
  let segmenter;
  try {
    segmenter = await bundle.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: model },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  } catch (error) {
    throw failure(classify(error));
  }
  return { segmentPerson: (bitmap) => personOf(segmenter, bitmap) };
});

/** The person mask for a photo, at the model's resolution, or null. */
export const segmentPerson = async (bitmap) => (await loadSegmenter()).segmentPerson(bitmap);
