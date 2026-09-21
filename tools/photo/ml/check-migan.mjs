#!/usr/bin/env node
/**
 * Wab Fit — verify MI-GAN's ONNX pipeline against the vendored model.
 *
 *   node site/tools/photo/ml/check-migan.mjs
 *
 * Plain Node: onnxruntime-web is imported by file URL from site/tools/vendor/ml.
 * The script reads the model's own header for the input and output names,
 * element types and shapes, then runs the pipeline twice on one synthetic
 * 512x512 photo — a red left half, a blue right half, a centred 128x128 hole —
 * with the mask inverted between runs. The finding is at the top of ml/runtime.js.
 */
import { readFileSync } from 'node:fs';

const HERE = new URL('.', import.meta.url);
const VENDOR = new URL('../../vendor/ml/', HERE);
const MODEL = new URL('migan_pipeline_v2.onnx', VENDOR);
const ORT = new URL('ort.wasm.min.mjs', VENDOR);

const SIDE = 512;
const HOLE = 64;
const KEEP = 255;
const FILL = 0;

const ELEM_TYPES = {
  1: 'float32', 2: 'uint8', 3: 'int8', 4: 'uint16', 5: 'int16', 6: 'int32',
  7: 'int64', 9: 'bool', 10: 'float16', 11: 'float64',
};

// --- the model's header, read without a protobuf dependency ----------------

function varint(buf, at) {
  let value = 0;
  let shift = 0;
  for (;;) {
    const byte = buf[at];
    if (byte === undefined) throw new Error('truncated varint');
    at += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, at };
    shift += 7;
  }
}

/** Every field of the message in buf[from, to), as {number, wire, ...}. */
function fields(buf, from, to) {
  const found = [];
  let at = from;
  while (at < to) {
    const key = varint(buf, at);
    at = key.at;
    const wire = key.value & 7;
    if (wire === 2) {
      const size = varint(buf, at);
      at = size.at;
      found.push({ number: key.value >>> 3, wire, from: at, to: at + size.value });
      at += size.value;
    } else if (wire === 0) {
      const value = varint(buf, at);
      at = value.at;
      found.push({ number: key.value >>> 3, wire, value: value.value });
    } else if (wire === 1) at += 8;
    else if (wire === 5) at += 4;
    else throw new Error(`unsupported protobuf wire type ${wire}`);
  }
  return found;
}

const pick = (list, number) => list.find((field) => field.number === number);
const text = (buf, field) => (field ? buf.toString('utf8', field.from, field.to) : '');

/** One ValueInfoProto: the port's name, element type and shape. */
function valueInfo(buf, field) {
  const inside = fields(buf, field.from, field.to);
  const name = text(buf, pick(inside, 1));
  const type = pick(inside, 2);
  const tensor = type ? pick(fields(buf, type.from, type.to), 1) : undefined;
  if (!tensor) return { name, type: 'not a tensor', shape: [] };
  const parts = fields(buf, tensor.from, tensor.to);
  const kind = pick(parts, 1);
  const shape = pick(parts, 2);
  const dims = shape ? fields(buf, shape.from, shape.to).filter((f) => f.number === 1) : [];
  return {
    name,
    type: ELEM_TYPES[kind ? kind.value : 0] ?? `elem_type ${kind ? kind.value : '?'}`,
    shape: dims.map((dim) => {
      const dimParts = fields(buf, dim.from, dim.to);
      const known = pick(dimParts, 1);
      const symbolic = pick(dimParts, 2);
      if (known !== undefined && known.value !== undefined) return known.value;
      return symbolic ? text(buf, symbolic) : '?';
    }),
  };
}

/** The graph's declared inputs and outputs. */
function header(bytes) {
  const graph = pick(fields(bytes, 0, bytes.length), 7);
  if (!graph) throw new Error('the ONNX file carries no graph');
  const inside = fields(bytes, graph.from, graph.to);
  return {
    inputs: inside.filter((f) => f.number === 11).map((f) => valueInfo(bytes, f)),
    outputs: inside.filter((f) => f.number === 12).map((f) => valueInfo(bytes, f)),
  };
}

// --- the synthetic photo, its hole, and the two masks ----------------------
const inHole = (x, y) =>
  x >= SIDE / 2 - HOLE && x < SIDE / 2 + HOLE && y >= SIDE / 2 - HOLE && y < SIDE / 2 + HOLE;

/** The photo the pipeline is handed: uint8 RGB, planar (NCHW), 512x512. */
function photo() {
  const rgb = new Uint8Array(3 * SIDE * SIDE);
  for (let at = 0; at < SIDE * SIDE; at += 1) {
    const left = at % SIDE < SIDE / 2;
    rgb[at] = left ? 220 : 20;
    rgb[SIDE * SIDE + at] = 30;
    rgb[2 * SIDE * SIDE + at] = left ? 30 : 220;
  }
  return rgb;
}

/** What the original pixel is, per channel, so a change can be measured. */
function original(x, y, channel) {
  const left = x < SIDE / 2;
  if (channel === 1) return 30;
  return channel === 0 ? (left ? 220 : 20) : left ? 30 : 220;
}

/** `holeValue` is what the hole carries: 0 = fill me, 255 = keep me. */
function maskOf(holeValue) {
  const mask = new Uint8Array(SIDE * SIDE);
  for (let y = 0; y < SIDE; y += 1) {
    for (let x = 0; x < SIDE; x += 1) mask[y * SIDE + x] = inHole(x, y) ? holeValue : KEEP - holeValue;
  }
  return mask;
}

/**
 * How far the answer moved from the photo: inside the hole, outside it, and how
 * many pixels outside were touched at all (a difference of more than 2 of 255).
 */
function measure(result, holeValue) {
  const plane = SIDE * SIDE;
  const data = result.data;
  const found = { holeValue, insideChanged: 0, insideMax: 0, outsideChanged: 0, outsideMax: 0, outsideReach: 0 };
  for (let y = 0; y < SIDE; y += 1) {
    for (let x = 0; x < SIDE; x += 1) {
      const at = y * SIDE + x;
      let delta = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const moved = Math.abs(data[channel * plane + at] - original(x, y, channel));
        if (moved > delta) delta = moved;
      }
      if (inHole(x, y)) {
        if (delta > 2) found.insideChanged += 1;
        if (delta > found.insideMax) found.insideMax = delta;
      } else {
        if (delta > 2) {
          found.outsideChanged += 1;
          const reach = Math.max(Math.abs(x - SIDE / 2), Math.abs(y - SIDE / 2)) - HOLE;
          if (reach > found.outsideReach) found.outsideReach = reach;
        }
        if (delta > found.outsideMax) found.outsideMax = delta;
      }
    }
  }
  return found;
}

const share = (count, area) => `${((100 * count) / area).toFixed(3)}% of the ${area} px`;

function say(found) {
  const hole = (2 * HOLE) ** 2;
  const frame = SIDE * SIDE - hole;
  const fills = found.insideChanged / hole > 0.5 && found.outsideChanged / frame < 0.05;
  console.log(
    `  mask ${found.holeValue} over the hole, ${KEEP - found.holeValue} over the frame: ` +
      `${share(found.insideChanged, hole)} inside changed (max ${found.insideMax}), ` +
      `${share(found.outsideChanged, frame)} outside changed (max ${found.outsideMax}, ` +
      `never further than ${found.outsideReach} px from the hole).`,
  );
  return fills;
}

// --- run it ----------------------------------------------------------------
const bytes = readFileSync(MODEL);
const ort = await import(ORT.href);
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
ort.env.wasm.wasmPaths = VENDOR.href;

const declared = header(bytes);
for (const port of ['inputs', 'outputs'])
  for (const item of declared[port])
    console.log(`${port.slice(0, -1)}: ${item.name} ${item.type} [${item.shape.join(', ')}]`);

const session = await ort.InferenceSession.create(bytes);
console.log(`session: ${session.inputNames.join(', ')} -> ${session.outputNames.join(', ')}`);

const image = new ort.Tensor('uint8', photo(), [1, 3, SIDE, SIDE]);
const outcome = [];
for (const holeValue of [FILL, KEEP]) {
  const mask = new ort.Tensor('uint8', maskOf(holeValue), [1, 1, SIDE, SIDE]);
  const result = await session.run({ image, mask });
  const answer = result[session.outputNames[0]];
  console.log(`  output: ${answer.type} [${answer.dims.join(', ')}]`);
  outcome.push(say(measure(answer, holeValue)));
}

const filler = outcome[0] ? FILL : outcome[1] ? KEEP : undefined;
if (filler === undefined) {
  console.error('neither polarity fills the hole: the pipeline behaves as undocumented');
  process.exit(1);
}
console.log(
  filler === FILL
    ? `VERIFIED: mask ${FILL} names the hole to fill, mask ${KEEP} the region to keep — as the MI-GAN README documents.`
    : `VERIFIED, BUT INVERTED: mask ${filler} names the hole to fill, ${KEEP - filler} the region to keep.`,
);
