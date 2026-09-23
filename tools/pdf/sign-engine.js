// GENERATED - edit src/features/signature/engine.ts and run `node scripts/gen-sign-engine.mjs`.
/**
 * Wab Fit — the signature lift: a pen read out of a photographed page.
 *
 * Pure TypeScript over an array-like of RGBA: no DOM, no canvas, no clock, so
 * the same file runs in the PDF tool's page, under vitest in Node, and in the
 * app. Nothing here is stateful: every stage is a function of its own input.
 *
 * This file is the SOURCE OF TRUTH for both callers. The copy the PDF tool's
 * page loads, `site/tools/pdf/sign-engine.js`, is generated from it by
 * `node scripts/gen-sign-engine.mjs`, which the gate runs with `--check`.
 *
 * One global threshold cannot read a photographed page. Paper on the dark side
 * of a gradient falls under the split and becomes "ink"; a hand's shadow is the
 * largest mark in the frame; a printed rule three pixels thick survives as the
 * mark the pen then has to sit near; a blue pen and a red stamp of the same
 * lightness are the same ink. This engine answers the same question in nine
 * stages, each one exported so that it can be read and pinned alone:
 *
 *   1 LIGHT       every pixel's luminance (Rec. 709 on the sRGB values) and its
 *                 Lab colour. Both are read off the source composited on white,
 *                 because a PDF page renders transparent paper.
 *   2 BACKGROUND  a grey closing — a max filter then a min filter, separable and
 *                 O(n) by the van Herk / Gil-Werman scheme — over a radius of a
 *                 tenth of the shorter side. What survives is the paper: strokes,
 *                 rules, specks and shadows smaller than the radius are gone, and
 *                 a brightness gradient across the page stays.
 *   3 NORMALISE   L / background. The paper under every pixel reads bright again,
 *                 so a shadow is not ink and a gradient is not a gradient.
 *   4 INK         Sauvola's local threshold (window about 25 px at 300 dpi, k in
 *                 0.2..0.34) on the normalised light, OR any pixel whose Lab
 *                 chroma stands off its local background by more than
 *                 `chromaThreshold` — which is what finds blue or red ink that
 *                 the greyscale cannot see.
 *   5 RULES       an opening with a line kernel as long as 40% of the crop takes
 *                 out horizontal and vertical rules; a rule pixel with ink above
 *                 and below it (or left and right) is the pen crossing the rule
 *                 and goes back in, and anything thicker than `ruleThickness` is
 *                 a stroke rather than a rule and is never touched.
 *   6 MARKS       8-connected components, specks under a resolution-scaled area
 *                 dropped, each one measured: median stroke width from a distance
 *                 transform, elongation from the second moments, and how much of
 *                 its box it fills. The writing is the SET of stroke-like marks —
 *                 never the largest, which is what a printed word or a shadow is —
 *                 rows of similar small marks on one baseline are refused unless
 *                 the pen runs through them, and parts join by PIXEL distance,
 *                 never by box.
 *   7 ALPHA       (background - L) / (background - the ink's own light), clamped:
 *                 the source's own anti-aliased edge lives on instead of being
 *                 re-derived from a binary mask.
 *   8 COLOUR      every kept pixel keeps ITS OWN colour, un-premultiplied against
 *                 the paper under it — or is repainted black or blue.
 *   9 CROP        the tight bounds of the ink plus 4% of padding.
 *
 * Everything here is plain data — array-likes and numbers — because the stages
 * are pure and are called from a page as well as from the app. Nothing is a
 * class, a Date, a Map, a function or a Promise, so nothing has to be revived
 * after a round trip through storage.
 */
/** The three weights of Rec. 709, which is what "luminance" means here. */
const RED = 0.2126;
const GREEN = 0.7152;
const BLUE = 0.0722;
/** The D65 white point and the knee of the sRGB curve, for the Lab stage. */
const WHITE_X = 95.047;
const WHITE_Z = 108.883;
const SRGB_KNEE = 0.04045;
/** Sauvola's own constant: the range a light value is measured in. */
const SAUVOLA_RANGE = 128;
/** A rule has to be at least this many pixels long before it can be a rule. */
const MIN_RULE_KERNEL = 8;
/* ----------------------------------------------------------- the constants */
/** The longer side a crop is worked at; anything bigger is averaged down. */
export const MAX_SIDE = 3000;
/**
 * The resolution the pixel constants are quoted at: 2480 px on the longer side,
 * the width of an A4 page at 300 dpi. `scaleUnit` reads a crop against it.
 */
export const SCALE_300 = 2480;
/**
 * What a repainted pen is painted in. The two are said as channels: a hex literal
 * outside `src/theme` is a colour with no theme, and no palette in the app holds
 * the blue a ballpoint writes in — `#1a3fa8`.
 */
export const INK_BLACK = rgbToHex(0, 0, 0);
export const INK_BLUE = rgbToHex(26, 63, 168);
/**
 * Every dial, with its default. Lengths in pixels are quoted at 300 dpi and are
 * multiplied by `scaleUnit`; shares are of the crop or of its longer side.
 */
export const DEFAULT_OPTIONS = {
    /** The longer side a crop is worked at. */
    maxSide: MAX_SIDE,
    /** The closing radius, as a share of the SHORTER side. */
    backgroundRadius: 0.1,
    /** Sauvola's window, in pixels at 300 dpi. */
    sauvolaWindow: 25,
    /** Sauvola's k: how far the cut sits under the local mean. 0.2..0.34. */
    sauvolaK: 0.3,
    /** The window the local background colour is read over, at 300 dpi. */
    chromaWindow: 25,
    /** How far a pixel's Lab chroma must stand off the paper to be ink. */
    chromaThreshold: 10,
    /** How much darker than the paper a pixel must be to be ink on its own. */
    inkContrast: 0.25,
    /** How straight and how long a run must be to be a rule. */
    ruleSpan: 0.4,
    /** How thick a rule may be, in pixels at 300 dpi; thicker is a stroke. */
    ruleThickness: 6,
    /** Specks under this area, in pixels at 300 dpi, are dropped. */
    minArea: 8,
    /** The stroke width band of a pen, in pixels at 300 dpi. */
    minStroke: 1,
    maxStroke: 12,
    /** How stretched and how empty of its box a mark must be to be a stroke. */
    minElongation: 2,
    maxFill: 0.85,
    /** How close two parts may be, as a share of the longer side, in PIXELS. */
    joinGap: 0.02,
    /** Padding put around the tight bounds, as a share of their longer side. */
    padding: 0.04,
    /** What the kept pixels are painted in: 'source', 'black' or 'blue'. */
    ink: 'source',
    /** How many pixels the alpha is grown past the chosen mask, for the edge. */
    grow: 1,
};
/* ------------------------------------------------------------------ light */
/** The source pixel at `at`, one channel of it, composited on white paper. */
function over(rgba, at, channel) {
    const value = rgba[at + 3] ?? 0;
    const colour = rgba[at + channel] ?? 0;
    if (value === 255)
        return colour;
    const alpha = value / 255;
    return colour * alpha + 255 * (1 - alpha);
}
/** A number held between two others. */
function clamp(value, low, high) {
    return value < low ? low : value > high ? high : value;
}
/** How many pixels a width and a height ask for. */
function pixelCount(width, height) {
    return Math.max(0, Math.floor(width) * Math.floor(height));
}
/**
 * The working scale of a crop: 1 at 2480 px on the longer side — an A4 page at
 * 300 dpi, which is what every pixel constant here is quoted at — and never
 * below 1, so that a small crop is read as generously as a large one.
 */
export function scaleUnit(width, height) {
    return Math.max(1, Math.max(width, height) / SCALE_300);
}
/** The radius of the `2 * radius + 1` window that holds `at300` pixels at 300 dpi. */
function windowRadius(at300, unit) {
    return Math.max(2, Math.round((at300 * unit - 1) / 2));
}
/** `#rrggbb` as three numbers. */
function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
/** Three numbers as `#rrggbb`. */
function rgbToHex(r, g, b) {
    const two = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
    return `#${two(r)}${two(g)}${two(b)}`;
}
/** The sRGB knee and curve are the same for all 256 values: read them, not them. */
const SRGB_TABLE = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
    const c = i / 255;
    SRGB_TABLE[i] = c <= SRGB_KNEE ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
/** The sRGB value as the linear light it stands for. */
function srgbLinear(value) {
    return SRGB_TABLE[clamp(Math.round(value), 0, 255)] ?? 0;
}
/** Lab's cube-root curve, for one axis. */
function labCurve(t) {
    return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}
/**
 * Stage 1a. Every pixel's luminance, 0 to 255, Rec. 709 weighted, read off the
 * source composited on white paper.
 */
export function luminance(rgba, width, height) {
    const n = pixelCount(width, height);
    const light = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
        const at = i * 4;
        light[i] = RED * over(rgba, at, 0) + GREEN * over(rgba, at, 1) + BLUE * over(rgba, at, 2);
    }
    return light;
}
/**
 * Stage 1b. CIE Lab of every pixel: L is 0 to 100, a and b run about -128 to 128
 * and are what a hue is read from. Taken from the source composited on white,
 * like the luminance.
 */
export function lab(rgba, width, height) {
    const n = pixelCount(width, height);
    const L = new Float32Array(n);
    const A = new Float32Array(n);
    const B = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
        const at = i * 4;
        const r = srgbLinear(over(rgba, at, 0));
        const g = srgbLinear(over(rgba, at, 1));
        const b = srgbLinear(over(rgba, at, 2));
        const fx = labCurve((0.4124 * r + 0.3576 * g + 0.1805 * b) * (100 / WHITE_X));
        const fy = labCurve(0.2126 * r + 0.7152 * g + 0.0722 * b);
        const fz = labCurve((0.0193 * r + 0.1192 * g + 0.9505 * b) * (100 / WHITE_Z));
        L[i] = 116 * fy - 16;
        A[i] = 500 * (fx - fy);
        B[i] = 200 * (fy - fz);
    }
    return { L, a: A, b: B };
}
/* ---------------------------------------------------------------- filters */
/**
 * One line through the van Herk / Gil-Werman scheme: the window of
 * `2 * radius + 1` around every position, in one pass.
 *
 * The line is laid into a buffer padded at both ends with `pad`, the identity of
 * the filter, and cut into windows of the kernel's length. `prefix[i]` is the
 * running answer from the start of i's window to i, `suffix[i]` from i to the end
 * of i's window. The output at i is `pick(suffix[i - radius], prefix[i + radius])`:
 * those two blocks are either the two halves of i's own window or two whole
 * windows laid end to end, so what comes out is exactly the window wanted and
 * never anything past it. That is what makes this O(n) rather than O(n * radius).
 */
function lineWindow(values, n, radius, pick, pad, output, line, prefix, suffix) {
    const window = 2 * radius + 1;
    if (n <= 0)
        return;
    const length = Math.max(window, Math.ceil((n + 2 * radius) / window) * window);
    line.fill(pad, 0, length);
    line.set(values.subarray(0, n), radius);
    for (let start = 0; start < length; start += window) {
        const end = start + window;
        let forward = line[start] ?? 0;
        for (let i = start; i < end; i += 1) {
            forward = pick(forward, line[i] ?? 0);
            prefix[i] = forward;
        }
        let backward = line[end - 1] ?? 0;
        for (let i = end - 1; i >= start; i -= 1) {
            backward = pick(backward, line[i] ?? 0);
            suffix[i] = backward;
        }
    }
    for (let i = 0; i < n; i += 1) {
        const at = i + radius;
        output[i] = pick(suffix[at - radius] ?? 0, prefix[at + radius] ?? 0);
    }
}
/** A separable max or min filter over a whole image. */
function extreme(src, width, height, radius, pick, pad) {
    const data = src instanceof Float32Array ? src : Float32Array.from(src);
    const n = width * height;
    const longest = Math.max(width, height);
    const room = longest + 4 * radius + 2;
    const values = new Float32Array(longest);
    const output = new Float32Array(longest);
    const line = new Float32Array(room);
    const prefix = new Float32Array(room);
    const suffix = new Float32Array(room);
    const rows = new Float32Array(n);
    for (let y = 0; y < height; y += 1) {
        const base = y * width;
        values.set(data.subarray(base, base + width));
        lineWindow(values, width, radius, pick, pad, output, line, prefix, suffix);
        rows.set(output.subarray(0, width), base);
    }
    const out = new Float32Array(n);
    for (let x = 0; x < width; x += 1) {
        for (let y = 0; y < height; y += 1)
            values[y] = rows[y * width + x] ?? 0;
        lineWindow(values, height, radius, pick, pad, output, line, prefix, suffix);
        for (let y = 0; y < height; y += 1)
            out[y * width + x] = output[y] ?? 0;
    }
    return out;
}
/** A max filter: every pixel becomes the lightest value within `radius` of it. */
export function maxFilter(src, width, height, radius) {
    const r = Math.max(0, Math.round(radius));
    if (r < 1)
        return Float32Array.from(src);
    return extreme(src, width, height, r, Math.max, -Infinity);
}
/** A min filter: every pixel becomes the darkest value within `radius` of it. */
export function minFilter(src, width, height, radius) {
    const r = Math.max(0, Math.round(radius));
    if (r < 1)
        return Float32Array.from(src);
    return extreme(src, width, height, r, Math.min, Infinity);
}
/** The running sum of a window along one line. */
function sumWindow(input, output, n, radius) {
    let sum = 0;
    const first = Math.min(n - 1, radius);
    for (let i = 0; i <= first; i += 1)
        sum += input[i] ?? 0;
    output[0] = sum;
    for (let i = 1; i < n; i += 1) {
        const add = i + radius;
        if (add < n)
            sum += input[add] ?? 0;
        const drop = i - radius - 1;
        if (drop >= 0)
            sum -= input[drop] ?? 0;
        output[i] = sum;
    }
}
/**
 * The sum of the values in a `2 * radius + 1` square around every pixel, held in
 * as far as the crop reaches. Separable, so it is O(n). `into`, when given, is
 * written and answered instead of a fresh array.
 */
export function boxSum(src, width, height, radius, into) {
    const data = src instanceof Float32Array ? src : Float32Array.from(src);
    const r = Math.max(0, Math.round(radius));
    const n = width * height;
    if (r < 1)
        return into && into.length >= n ? into : Float32Array.from(data);
    const longest = Math.max(width, height);
    const line = new Float32Array(longest);
    const summed = new Float32Array(longest);
    const rows = new Float32Array(n);
    for (let y = 0; y < height; y += 1) {
        const base = y * width;
        line.set(data.subarray(base, base + width));
        sumWindow(line, summed, width, r);
        rows.set(summed.subarray(0, width), base);
    }
    const out = into && into.length >= n ? into : new Float32Array(n);
    for (let x = 0; x < width; x += 1) {
        for (let y = 0; y < height; y += 1)
            line[y] = rows[y * width + x] ?? 0;
        sumWindow(line, summed, height, r);
        for (let y = 0; y < height; y += 1)
            out[y * width + x] = summed[y] ?? 0;
    }
    return out;
}
/** The mean of the values in a `2 * radius + 1` square around every pixel. */
export function boxMean(src, width, height, radius) {
    const r = Math.max(0, Math.round(radius));
    const n = width * height;
    if (r < 1)
        return Float32Array.from(src);
    const sums = new Float32Array(n);
    boxSum(src, width, height, r, sums);
    for (let y = 0; y < height; y += 1) {
        const ny = Math.min(height - 1, y + r) - Math.max(0, y - r) + 1;
        for (let x = 0; x < width; x += 1) {
            const nx = Math.min(width - 1, x + r) - Math.max(0, x - r) + 1;
            const at = y * width + x;
            sums[at] = (sums[at] ?? 0) / (nx * ny);
        }
    }
    return sums;
}
/** One direction of a binary window filter: all of the window, or any of it. */
function binaryPass(src, width, height, radius, horizontal, all) {
    const out = new Uint8Array(width * height);
    const n = horizontal ? width : height;
    const lines = horizontal ? height : width;
    for (let line = 0; line < lines; line += 1) {
        const base = horizontal ? line * width : line;
        const step = horizontal ? 1 : width;
        const first = Math.min(n - 1, radius);
        let ink = 0;
        for (let i = 0; i <= first; i += 1)
            ink += src[base + i * step] ? 1 : 0;
        for (let i = 0; i < n; i += 1) {
            if (i > 0) {
                const add = i + radius;
                if (add < n)
                    ink += src[base + add * step] ? 1 : 0;
                const drop = i - radius - 1;
                if (drop >= 0)
                    ink -= src[base + drop * step] ? 1 : 0;
            }
            const low = Math.max(0, i - radius);
            const high = Math.min(n - 1, i + radius);
            out[base + i * step] = all ? (ink === high - low + 1 ? 1 : 0) : ink > 0 ? 1 : 0;
        }
    }
    return out;
}
/** Every pixel with any ink within `radius` of it: a box dilation. */
export function dilate(mask, width, height, radius) {
    const r = Math.max(0, Math.round(radius));
    if (r < 1)
        return Uint8Array.from(mask);
    return binaryPass(binaryPass(mask, width, height, r, true, false), width, height, r, false, false);
}
/** Every pixel whose whole window is ink: a box erosion. */
export function erode(mask, width, height, radius) {
    const r = Math.max(0, Math.round(radius));
    if (r < 1)
        return Uint8Array.from(mask);
    return binaryPass(binaryPass(mask, width, height, r, true, true), width, height, r, false, true);
}
/**
 * The distance from every ink pixel to the nearest paper, by the 3/4 chamfer
 * scheme in two passes, brought back into pixels. Twice this is how thick the
 * stroke a pixel sits in is, which is how a pen is told from a printed block.
 *
 * `width` and `height` default to NaN, which is how the lift calls it: with the
 * mask alone. A frame of NaN measures an empty transform, so a mark's stroke
 * width comes out NaN — unknown — and `strokeLike` is read on the other two
 * measures alone. This is what the site's tool has always done, kept verbatim.
 */
export function distanceTransform(mask, width = Number.NaN, height = Number.NaN) {
    const n = width * height;
    const far = 1e9;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i += 1)
        d[i] = mask[i] ? far : 0;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const i = y * width + x;
            if (d[i] === 0)
                continue;
            let value = d[i] ?? 0;
            if (x > 0)
                value = Math.min(value, (d[i - 1] ?? 0) + 3);
            if (y > 0) {
                value = Math.min(value, (d[i - width] ?? 0) + 3);
                if (x > 0)
                    value = Math.min(value, (d[i - width - 1] ?? 0) + 4);
                if (x < width - 1)
                    value = Math.min(value, (d[i - width + 1] ?? 0) + 4);
            }
            d[i] = value;
        }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
        for (let x = width - 1; x >= 0; x -= 1) {
            const i = y * width + x;
            if (d[i] === 0)
                continue;
            let value = d[i] ?? 0;
            if (x < width - 1)
                value = Math.min(value, (d[i + 1] ?? 0) + 3);
            if (y < height - 1) {
                value = Math.min(value, (d[i + width] ?? 0) + 3);
                if (x < width - 1)
                    value = Math.min(value, (d[i + width + 1] ?? 0) + 4);
                if (x > 0)
                    value = Math.min(value, (d[i + width - 1] ?? 0) + 4);
            }
            d[i] = value;
        }
    }
    for (let i = 0; i < n; i += 1)
        d[i] = (d[i] ?? 0) / 3;
    return d;
}
/* -------------------------------------------- background, normalised, ink */
/**
 * Stage 2. The paper under every pixel: a grey closing of the light — a max
 * filter, then a min filter — over `radius`. Everything smaller than that window
 * (a stroke, a rule, a speck, the edge of a shadow) is taken out and the page's
 * own light is left, gradient and all.
 */
export function estimateBackground(light, width, height, radius) {
    const r = Math.max(1, Math.round(radius));
    return minFilter(maxFilter(light, width, height, r), width, height, r);
}
/**
 * Stage 3. The light as a share of the paper under it, 0 to 255, paper at 255.
 * A shadow or a gradient divides out; ink stays dark.
 */
export function normalise(light, background, width, height) {
    const n = pixelCount(width, height);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
        out[i] = clamp(((light[i] ?? 0) / Math.max(1, background[i] ?? 0)) * 255, 0, 255);
    }
    return out;
}
/**
 * Stage 4a. Sauvola's local threshold over a `2 * radius + 1` window: the cut is
 * the local mean, taken down by `k` for every unit the local deviation falls
 * short of the full range. Ink is at or under the cut, which on unevenly lit
 * paper is the pen and on the paper is nothing.
 */
export function sauvola(lightNorm, width, height, k, radius) {
    const n = pixelCount(width, height);
    const mean = boxMean(lightNorm, width, height, radius);
    const squares = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
        const value = lightNorm[i] ?? 0;
        squares[i] = value * value;
    }
    const meanSquares = boxMean(squares, width, height, radius);
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
        const m = mean[i] ?? 0;
        const deviation = Math.sqrt(Math.max(0, (meanSquares[i] ?? 0) - m * m));
        const cut = m * (1 + k * (deviation / SAUVOLA_RANGE - 1));
        mask[i] = (lightNorm[i] ?? 0) <= cut ? 1 : 0;
    }
    return mask;
}
/**
 * Stage 4b. The coloured ink: a pixel whose Lab chroma stands off the chroma of
 * the paper around it by more than `threshold`. This is the stage that sees a
 * blue pen on a page whose greyscale says the paper and the pen are one value.
 */
export function chromaInk(channels, width, height, radius, threshold) {
    const n = pixelCount(width, height);
    const mask = new Uint8Array(n);
    // Nothing can stand off its own neighbourhood by more than the whole crop
    // spreads, so a page that is one colour — a scan, a black and white pen — is
    // answered here rather than walked twice.
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (let i = 0; i < n; i += 1) {
        const a = channels.a[i] ?? 0;
        const b = channels.b[i] ?? 0;
        if (a < minA)
            minA = a;
        if (a > maxA)
            maxA = a;
        if (b < minB)
            minB = b;
        if (b > maxB)
            maxB = b;
    }
    const spreadA = maxA - minA;
    const spreadB = maxB - minB;
    if (spreadA * spreadA + spreadB * spreadB <= threshold * threshold)
        return mask;
    const meanA = boxMean(channels.a, width, height, radius);
    const meanB = boxMean(channels.b, width, height, radius);
    for (let i = 0; i < n; i += 1) {
        const da = (channels.a[i] ?? 0) - (meanA[i] ?? 0);
        const db = (channels.b[i] ?? 0) - (meanB[i] ?? 0);
        mask[i] = da * da + db * db > threshold * threshold ? 1 : 0;
    }
    return mask;
}
/** Stage 4. The ink mask: Sauvola's cut or the colour test, whichever fires. */
export function inkMask(lightNorm, channels, width, height, opts) {
    const o = opts || {};
    const unit = scaleUnit(width, height);
    const dark = sauvola(lightNorm, width, height, o.sauvolaK ?? DEFAULT_OPTIONS.sauvolaK, windowRadius(o.sauvolaWindow ?? DEFAULT_OPTIONS.sauvolaWindow, unit));
    // Sauvola alone hollows a stroke thicker than its own window — deep inside one
    // the window holds no paper, no deviation and therefore no cut. A pixel this
    // much darker than the paper under it is ink whatever the window says.
    const floor = 255 * (1 - (o.inkContrast ?? DEFAULT_OPTIONS.inkContrast));
    for (let i = 0; i < dark.length; i += 1) {
        if ((lightNorm[i] ?? 0) <= floor)
            dark[i] = 1;
    }
    const coloured = chromaInk(channels, width, height, windowRadius(o.chromaWindow ?? DEFAULT_OPTIONS.chromaWindow, unit), o.chromaThreshold ?? DEFAULT_OPTIONS.chromaThreshold);
    for (let i = 0; i < dark.length; i += 1) {
        if (coloured[i])
            dark[i] = 1;
    }
    return dark;
}
/* ------------------------------------------------------------------ rules */
/** A morphological opening with a line kernel: erode along the line, grow back. */
function openLine(mask, width, height, radius, horizontal) {
    const eroded = binaryPass(mask, width, height, radius, horizontal, true);
    return binaryPass(eroded, width, height, radius, horizontal, false);
}
/** Does ink run on both sides of this pixel, along one axis, within `band`? */
function crosses(ink, width, height, x, y, alongX, band) {
    const step = alongX ? 1 : width;
    const limit = alongX ? width : height;
    const index = alongX ? x : y;
    const at = y * width + x;
    let behind = false;
    for (let k = 1; k <= band && index - k >= 0; k += 1) {
        if (ink[at - k * step]) {
            behind = true;
            break;
        }
    }
    if (!behind)
        return false;
    for (let k = 1; k <= band && index + k < limit; k += 1) {
        if (ink[at + k * step])
            return true;
    }
    return false;
}
/**
 * The pixels of every run of ink at least `run` long along one axis whose own
 * thickness across never passes `thickness`. Only the middle line of such a run
 * survives the opening, so the run's own thickness is read at those pixels and
 * the line is grown back across it — never past it.
 */
function ruleLine(mask, width, height, run, thickness, horizontal) {
    const n = mask.length;
    const along = horizontal ? 1 : width;
    const across = horizontal ? width : 1;
    const outer = horizontal ? height : width;
    const inner = horizontal ? width : height;
    const acrossLimit = horizontal ? height : width;
    // A run this long needs this many ink pixels on one line: cheap, and it saves
    // the opening over a crop that has no rule in it at all.
    const counts = new Uint32Array(outer);
    for (let at = 0; at < n; at += 1) {
        if (mask[at]) {
            const bucket = horizontal ? (at / width) | 0 : at % width;
            counts[bucket] = (counts[bucket] ?? 0) + 1;
        }
    }
    let most = 0;
    for (let k = 0; k < outer; k += 1) {
        const count = counts[k] ?? 0;
        if (count > most)
            most = count;
    }
    if (most < run)
        return null;
    const centre = openLine(mask, width, height, (run - 1) >> 1, horizontal);
    const flags = new Uint8Array(n);
    for (let line = 0; line < outer; line += 1) {
        const base = horizontal ? line * width : line;
        for (let i = 0; i < inner; i += 1) {
            const at = base + i * along;
            if (!centre[at])
                continue;
            const acrossAt = horizontal ? (at / width) | 0 : at % width;
            let thick = 1;
            for (let k = 1; k <= thickness; k += 1) {
                if (acrossAt - k < 0 || !mask[at - k * across])
                    break;
                thick += 1;
            }
            for (let k = 1; k <= thickness; k += 1) {
                if (acrossAt + k >= acrossLimit || !mask[at + k * across])
                    break;
                thick += 1;
            }
            if (thick > thickness)
                continue;
            for (let k = -thickness; k <= thickness; k += 1) {
                const away = acrossAt + k;
                if (away < 0 || away >= acrossLimit)
                    continue;
                const to = at + k * across;
                if (mask[to])
                    flags[to] = 1;
            }
        }
    }
    return flags;
}
/**
 * Stage 5. Ruled and grid paper. A run of ink as long as `ruleSpan` of the crop
 * is a rule, unless it is thicker than `ruleThickness` across — that is a stroke,
 * not a rule, and is left alone. A rule pixel that has ink on both sides of it is
 * the pen crossing the rule, and goes back into the ink.
 */
export function removeRules(mask, width, height, opts) {
    const o = opts || {};
    const unit = scaleUnit(width, height);
    const span = o.ruleSpan ?? DEFAULT_OPTIONS.ruleSpan;
    const thickness = Math.max(3, Math.round((o.ruleThickness ?? DEFAULT_OPTIONS.ruleThickness) * unit));
    const n = width * height;
    const ink = Uint8Array.from(mask);
    const across = Math.round(span * width);
    const horizontal = across >= MIN_RULE_KERNEL && across < width
        ? ruleLine(mask, width, height, across, thickness, true)
        : null;
    const down = Math.round(span * height);
    const vertical = down >= MIN_RULE_KERNEL && down < height
        ? ruleLine(mask, width, height, down, thickness, false)
        : null;
    if (!horizontal && !vertical)
        return ink;
    for (let at = 0; at < n; at += 1) {
        if ((horizontal && horizontal[at]) || (vertical && vertical[at]))
            ink[at] = 0;
    }
    const band = thickness + 2;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const at = y * width + x;
            if (ink[at])
                continue;
            const isH = horizontal !== null && horizontal[at] === 1;
            const isV = vertical !== null && vertical[at] === 1;
            if (!isH && !isV)
                continue;
            const crossing = isH
                ? crosses(ink, width, height, x, y, false, band)
                : crosses(ink, width, height, x, y, true, band);
            if (crossing)
                ink[at] = 1;
        }
    }
    return ink;
}
/* ------------------------------------------------------------------ marks */
/** The eight neighbours of a pixel, which is what 8-connected means. */
const NEIGHBOURS = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
];
/** The islands of an ink mask, each one walked and measured. */
function marksFromMask(mask, width, height, minArea, distance) {
    const n = width * height;
    const seen = new Uint8Array(n);
    const stack = new Int32Array(n);
    const pixels = new Int32Array(n);
    const marks = [];
    for (let start = 0; start < n; start += 1) {
        if (!mask[start] || seen[start])
            continue;
        let top = 0;
        let count = 0;
        let minX = width;
        let maxX = -1;
        let minY = height;
        let maxY = -1;
        let sumX = 0;
        let sumY = 0;
        let sumXX = 0;
        let sumYY = 0;
        let sumXY = 0;
        seen[start] = 1;
        stack[top] = start;
        top += 1;
        while (top > 0) {
            top -= 1;
            const at = stack[top] ?? 0;
            pixels[count] = at;
            count += 1;
            const x = at % width;
            const y = (at - x) / width;
            if (x < minX)
                minX = x;
            if (x > maxX)
                maxX = x;
            if (y < minY)
                minY = y;
            if (y > maxY)
                maxY = y;
            sumX += x;
            sumY += y;
            sumXX += x * x;
            sumYY += y * y;
            sumXY += x * y;
            for (const offset of NEIGHBOURS) {
                const nx = x + offset[0];
                const ny = y + offset[1];
                if (nx < 0 || ny < 0 || nx >= width || ny >= height)
                    continue;
                const next = ny * width + nx;
                if (!mask[next] || seen[next])
                    continue;
                seen[next] = 1;
                stack[top] = next;
                top += 1;
            }
        }
        if (count < minArea)
            continue;
        const widths = new Float32Array(count);
        for (let k = 0; k < count; k += 1)
            widths[k] = 2 * (distance[pixels[k] ?? 0] ?? Number.NaN);
        const sorted = Array.from(widths);
        sorted.sort((a, b) => a - b);
        const meanX = sumX / count;
        const meanY = sumY / count;
        const varX = Math.max(0, sumXX / count - meanX * meanX);
        const varY = Math.max(0, sumYY / count - meanY * meanY);
        const covXY = sumXY / count - meanX * meanY;
        const trace = varX + varY;
        const spread = Math.sqrt(Math.max(0, (trace * trace) / 4 - (varX * varY - covXY * covXY)));
        const major = trace / 2 + spread;
        const minor = Math.max(0, trace / 2 - spread);
        const box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
        marks.push({
            pixels: pixels.slice(0, count),
            box,
            area: count,
            strokeWidth: sorted[sorted.length >> 1] ?? 0,
            elongation: minor > 0.25 ? Math.min(60, Math.sqrt(major / minor)) : 60,
            fill: count / (box.w * box.h),
        });
    }
    return marks;
}
/**
 * Stage 6a. The marks of an ink mask: 8-connected islands with the specks under
 * an area scaled to the resolution dropped, and every survivor measured.
 */
export function components(mask, width, height, opts) {
    const o = opts || {};
    const unit = scaleUnit(width, height);
    const minArea = Math.max(1, Math.round((o.minArea ?? DEFAULT_OPTIONS.minArea) * unit * unit));
    const distance = o.distance ?? distanceTransform(mask, width, height);
    return marksFromMask(mask, width, height, minArea, distance);
}
/**
 * Stage 6b. Is this mark a stroke of a pen rather than a printed block, a shadow
 * or a speck? Thin enough, stretched enough, and not a filled box.
 */
export function strokeLike(mark, limits) {
    const o = limits || {};
    const minStroke = o.minStroke ?? DEFAULT_OPTIONS.minStroke;
    const maxStroke = o.maxStroke ?? DEFAULT_OPTIONS.maxStroke;
    if (mark.strokeWidth < minStroke || mark.strokeWidth > maxStroke)
        return false;
    if (mark.elongation < (o.minElongation ?? DEFAULT_OPTIONS.minElongation))
        return false;
    return mark.fill <= (o.maxFill ?? DEFAULT_OPTIONS.maxFill);
}
/** How much a mark reads as a pen, 0 to 1, for choosing when nothing is clean. */
function penScore(mark, limits) {
    const thin = Math.min(1, limits.maxStroke / Math.max(0.5, mark.strokeWidth));
    const stretched = Math.min(1, mark.elongation / Math.max(1, limits.minElongation));
    return (0.5 + 0.5 * stretched) * thin * (1 - 0.5 * Math.min(1, mark.fill));
}
/** Two marks on one printed line: like heights, one baseline, overlapping. */
function sameLine(a, b) {
    const shorter = Math.min(a.box.h, b.box.h);
    const taller = Math.max(a.box.h, b.box.h);
    if (taller > shorter * 1.8)
        return false;
    const bottomA = a.box.y + a.box.h;
    const bottomB = b.box.y + b.box.h;
    if (Math.abs(bottomA - bottomB) > 0.4 * shorter)
        return false;
    return Math.min(bottomA, bottomB) - Math.max(a.box.y, b.box.y) >= 0.5 * shorter;
}
/**
 * Stage 6c. Which marks are letters of a printed line: three or more marks of a
 * like height, sharing a baseline, are a line of type rather than a hand. They
 * are refused as writing unless the pen runs through them — which `chooseWriting`
 * below decides, since a signature written over a printed name is both.
 */
export function textRow(marks, width, height) {
    const flags = new Uint8Array(marks.length);
    const groups = [];
    const order = [];
    for (let i = 0; i < marks.length; i += 1)
        order.push(i);
    order.sort((a, b) => (marks[a]?.box.y ?? 0) - (marks[b]?.box.y ?? 0));
    for (let k = 0; k < order.length; k += 1) {
        const i = order[k] ?? 0;
        const mark = marks[i];
        if (mark === undefined || mark.box.h > 0.5 * height)
            continue;
        let group = null;
        for (let g = 0; g < groups.length; g += 1) {
            const head = marks[groups[g]?.[0] ?? 0];
            if (head !== undefined && sameLine(head, mark)) {
                group = groups[g] ?? null;
                break;
            }
        }
        if (group)
            group.push(i);
        else
            groups.push([i]);
    }
    for (let g = 0; g < groups.length; g += 1) {
        const group = groups[g] ?? [];
        if (group.length < 3)
            continue;
        for (let k = 0; k < group.length; k += 1)
            flags[group[k] ?? 0] = 1;
    }
    return flags;
}
/** Does any pixel of this mark sit on the given mask? */
function touches(mark, where) {
    const pixels = mark.pixels;
    for (let k = 0; k < pixels.length; k += 1) {
        if (where[pixels[k] ?? 0])
            return true;
    }
    return false;
}
/**
 * Stage 6d. The writing itself, as a mask of the pixels it owns.
 *
 * The seed is every stroke-like mark that is not part of a printed line — a SET,
 * never the largest mark, which is what a printed word or a hand's shadow is.
 * Marks are then joined while any PIXEL of them comes within `joinGap` of a pixel
 * already chosen, so a detached dot or a lifted flourish comes home, and a
 * printed line only joins where the pen actually runs through it.
 */
export function chooseWriting(marks, width, height, opts) {
    const o = opts || {};
    const unit = scaleUnit(width, height);
    const limits = {
        minStroke: (o.minStroke ?? DEFAULT_OPTIONS.minStroke) * unit,
        maxStroke: (o.maxStroke ?? DEFAULT_OPTIONS.maxStroke) * unit,
        minElongation: o.minElongation ?? DEFAULT_OPTIONS.minElongation,
        maxFill: o.maxFill ?? DEFAULT_OPTIONS.maxFill,
    };
    const text = textRow(marks, width, height);
    const stroke = new Uint8Array(marks.length);
    const seeds = [];
    for (let i = 0; i < marks.length; i += 1) {
        const mark = marks[i];
        const like = mark !== undefined && strokeLike(mark, limits);
        stroke[i] = like ? 1 : 0;
        if (like && !text[i])
            seeds.push(i);
    }
    if (seeds.length === 0) {
        // Nothing reads as a clean pen: take the most pen-like mark there is, but
        // never a printed line while any other mark is left.
        let best = -1;
        let bestScore = 0.12;
        for (let i = 0; i < marks.length; i += 1) {
            const mark = marks[i];
            if (mark === undefined || text[i])
                continue;
            const score = penScore(mark, limits);
            if (best < 0 || score > bestScore) {
                best = i;
                bestScore = score;
            }
        }
        for (let i = 0; i < marks.length && best < 0; i += 1) {
            const mark = marks[i];
            if (mark === undefined)
                continue;
            const score = penScore(mark, limits);
            if (score > bestScore) {
                best = i;
                bestScore = score;
            }
        }
        if (best >= 0)
            seeds.push(best);
    }
    const chosen = new Uint8Array(width * height);
    const taken = new Uint8Array(marks.length);
    const take = (i) => {
        const pixels = marks[i]?.pixels ?? [];
        for (let k = 0; k < pixels.length; k += 1)
            chosen[pixels[k] ?? 0] = 1;
        taken[i] = 1;
    };
    for (let k = 0; k < seeds.length; k += 1)
        take(seeds[k] ?? 0);
    const gap = Math.max(1, Math.round((o.joinGap ?? DEFAULT_OPTIONS.joinGap) * Math.max(width, height)));
    const tight = Math.max(1, Math.round(gap / 4));
    let grew = seeds.length > 0;
    let rounds = 0;
    while (grew && rounds < 16) {
        grew = false;
        rounds += 1;
        const near = dilate(chosen, width, height, gap);
        const tightNear = tight < gap ? dilate(chosen, width, height, tight) : near;
        for (let i = 0; i < marks.length; i += 1) {
            const mark = marks[i];
            if (taken[i] || mark === undefined)
                continue;
            if (text[i] && !touches(mark, tightNear))
                continue;
            if (!touches(mark, near))
                continue;
            take(i);
            grew = true;
        }
    }
    let selectedArea = 0;
    let strokeArea = 0;
    for (let i = 0; i < marks.length; i += 1) {
        if (!taken[i])
            continue;
        const area = marks[i]?.area ?? 0;
        selectedArea += area;
        if (stroke[i])
            strokeArea += area;
    }
    return { chosen, taken, stroke, text, seeds, selectedArea, strokeArea };
}
/* ----------------------------------------------------------- alpha, colour */
/**
 * Stage 7. How much of the pen is over every pixel: the paper under it less its
 * own light, over the paper less the darkest light the pen reaches. That is 1
 * deep inside a stroke and 0 on the paper, and in between it is the source's own
 * anti-aliased edge — no binary mask to re-derive an alpha from.
 */
export function softAlpha(light, background, chosen, width, height, opts) {
    const o = opts || {};
    const n = pixelCount(width, height);
    const alpha = new Float32Array(n);
    let inkLight = Infinity;
    for (let i = 0; i < n; i += 1) {
        const value = light[i] ?? 0;
        if (chosen[i] && value < inkLight)
            inkLight = value;
    }
    if (inkLight === Infinity)
        return alpha;
    const grow = Math.max(0, Math.round(o.grow ?? DEFAULT_OPTIONS.grow));
    const wide = grow > 0 ? dilate(chosen, width, height, grow) : chosen;
    for (let i = 0; i < n; i += 1) {
        if (!wide[i])
            continue;
        const paper = Math.max(inkLight + 1, background[i] ?? 0);
        alpha[i] = clamp((paper - (light[i] ?? 0)) / (paper - inkLight), 0, 1);
    }
    return alpha;
}
/**
 * Stage 8a. The colour of the paper: the mean of the source over every pixel the
 * ink mask does not claim, which is what an ink pixel is un-premultiplied
 * against. `light` is that colour's own luminance, so the paper can be taken to
 * the light a shadow left it at.
 */
export function paperColour(rgba, mask, width, height) {
    const n = pixelCount(width, height);
    let r = 0;
    let g = 0;
    let b = 0;
    let weight = 0;
    for (let i = 0; i < n; i += 1) {
        if (mask[i])
            continue;
        const at = i * 4;
        r += over(rgba, at, 0);
        g += over(rgba, at, 1);
        b += over(rgba, at, 2);
        weight += 1;
    }
    if (weight === 0)
        return null;
    const paper = { r: r / weight, g: g / weight, b: b / weight };
    return { ...paper, light: Math.max(1, RED * paper.r + GREEN * paper.g + BLUE * paper.b) };
}
/** What a repainted pen is, or null when the pen keeps its own colour. */
function flatColour(mode) {
    if (mode === 'black')
        return hexToRgb(INK_BLACK);
    if (mode === 'blue')
        return hexToRgb(INK_BLUE);
    return null;
}
/**
 * Stage 8b. Three numbers a pixel, in the same frame as the source. A kept pixel
 * takes ITS OWN colour back out of the paper it was written on: the source value
 * less the part of the paper its alpha leaves showing, over that alpha. Or every
 * kept pixel is painted one flat colour, when the caller asks for that.
 */
export function inkColours(rgba, alpha, background, width, height, paper, mode) {
    const n = pixelCount(width, height);
    const out = new Uint8ClampedArray(n * 3);
    const flat = flatColour(mode);
    const base = paper || { r: 255, g: 255, b: 255, light: 255 };
    for (let i = 0; i < n; i += 1) {
        const at = i * 4;
        const to = i * 3;
        if (flat) {
            out[to] = flat[0];
            out[to + 1] = flat[1];
            out[to + 2] = flat[2];
            continue;
        }
        const a = Math.max(alpha[i] ?? 0, 0.2);
        const scale = clamp((background[i] ?? 0) / base.light, 0.2, 4);
        out[to] = clamp((over(rgba, at, 0) - (1 - a) * base.r * scale) / a, 0, 255);
        out[to + 1] = clamp((over(rgba, at, 1) - (1 - a) * base.g * scale) / a, 0, 255);
        out[to + 2] = clamp((over(rgba, at, 2) - (1 - a) * base.b * scale) / a, 0, 255);
    }
    return out;
}
/**
 * The pen's own colour, as `#rrggbb`: the median of the colours of the pixels
 * that are at least three quarters opaque, which is the ink and not its edge.
 */
export function dominantInkColour(colours, alpha, width, height) {
    const n = pixelCount(width, height);
    let most = 0;
    for (let i = 0; i < n; i += 1) {
        const value = alpha[i] ?? 0;
        if (value > most)
            most = value;
    }
    if (most <= 0)
        return INK_BLACK;
    const floor = Math.max(0.5, most * 0.75);
    // A histogram, not a sort: the pen can be millions of pixels and every one of
    // them is already a whole number.
    const red = new Uint32Array(256);
    const green = new Uint32Array(256);
    const blue = new Uint32Array(256);
    let count = 0;
    for (let i = 0; i < n; i += 1) {
        if ((alpha[i] ?? 0) < floor)
            continue;
        count += 1;
        const at = i * 3;
        const r = colours[at] ?? 0;
        const g = colours[at + 1] ?? 0;
        const b = colours[at + 2] ?? 0;
        red[r] = (red[r] ?? 0) + 1;
        green[g] = (green[g] ?? 0) + 1;
        blue[b] = (blue[b] ?? 0) + 1;
    }
    if (count === 0)
        return INK_BLACK;
    const middle = count >> 1;
    const median = (histogram) => {
        let seen = 0;
        for (let value = 0; value < 256; value += 1) {
            seen += histogram[value] ?? 0;
            if (seen > middle)
                return value;
        }
        return 255;
    };
    return rgbToHex(median(red), median(green), median(blue));
}
/* ------------------------------------------------------------------- crop */
/**
 * Stage 9a. The tight bounds of everything with any alpha, plus `padding` of the
 * bounds' longer side, held inside the crop.
 */
export function inkBounds(alpha, width, height, padding) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if ((alpha[y * width + x] ?? 0) <= 0)
                continue;
            if (x < minX)
                minX = x;
            if (x > maxX)
                maxX = x;
            if (y < minY)
                minY = y;
            if (y > maxY)
                maxY = y;
        }
    }
    if (maxX < 0)
        return null;
    const pad = Math.round((padding ?? DEFAULT_OPTIONS.padding) * Math.max(maxX - minX + 1, maxY - minY + 1));
    const x = Math.max(0, minX - pad);
    const y = Math.max(0, minY - pad);
    const right = Math.min(width - 1, maxX + pad);
    const bottom = Math.min(height - 1, maxY + pad);
    return { x, y, w: right - x + 1, h: bottom - y + 1 };
}
/** Stage 9b. The box, out of the source, as its own RGBA array. */
export function cropRgba(rgba, width, height, bounds) {
    const out = new Uint8ClampedArray(bounds.w * bounds.h * 4);
    for (let y = 0; y < bounds.h; y += 1) {
        const from = ((bounds.y + y) * width + bounds.x) * 4;
        const to = y * bounds.w * 4;
        for (let k = 0; k < bounds.w * 4; k += 1)
            out[to + k] = rgba[from + k] ?? 0;
    }
    return out;
}
/**
 * The crop as it is worked on: below `maxSide` on its longer side it is left
 * alone, above it an area average brings it down. Nothing in the engine is
 * allowed to walk a bitmap bigger than that.
 */
export function fitToMaxSide(rgba, width, height, maxSide) {
    const cap = Math.max(1, Math.round(maxSide ?? MAX_SIDE));
    if (Math.max(width, height) <= cap)
        return { rgba, width, height };
    const scale = cap / Math.max(width, height);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
        const y0 = Math.floor((y * height) / h);
        const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
        for (let x = 0; x < w; x += 1) {
            const x0 = Math.floor((x * width) / w);
            const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let sy = y0; sy < y1; sy += 1) {
                for (let sx = x0; sx < x1; sx += 1) {
                    const at = (sy * width + sx) * 4;
                    r += rgba[at] ?? 0;
                    g += rgba[at + 1] ?? 0;
                    b += rgba[at + 2] ?? 0;
                    a += rgba[at + 3] ?? 0;
                }
            }
            const count = (y1 - y0) * (x1 - x0);
            const to = (y * w + x) * 4;
            out[to] = r / count;
            out[to + 1] = g / count;
            out[to + 2] = b / count;
            out[to + 3] = a / count;
        }
    }
    return { rgba: out, width: w, height: h };
}
/* ----------------------------------------------------------------- engine */
/** Stages 1 to 5, kept together so that the Lab arrays do not outlive them. */
function readInk(pixels, width, height, opts) {
    const light = luminance(pixels, width, height);
    const radius = Math.max(2, Math.round((opts.backgroundRadius ?? DEFAULT_OPTIONS.backgroundRadius) * Math.min(width, height)));
    const background = estimateBackground(light, width, height, radius);
    const lightNorm = normalise(light, background, width, height);
    const coloured = inkMask(lightNorm, lab(pixels, width, height), width, height, opts);
    return { light, background, mask: removeRules(coloured, width, height, opts) };
}
/**
 * The whole lift. `rgba` is the crop to read, `width` by `height` pixels; the
 * answer, or null when there is no pen in it:
 *
 *   rgba        the cut, at the working size: RGB the ink's own colour a pixel,
 *               A the soft alpha — ready to be put on a canvas.
 *   width       the cut's own width, and `height` its own height.
 *   bounds      where the cut was taken from, in the WORKING frame, padding in.
 *   inkColor    the pen's own colour, `#rrggbb`, whatever it was repainted in.
 *   confidence  0 to 1: how much of the ink found was the writing, and how much
 *               of the writing read as a stroke rather than a block.
 */
export function liftSignature(rgba, width, height, opts) {
    if (!rgba || !(width > 1) || !(height > 1))
        return null;
    const o = opts || {};
    const work = fitToMaxSide(rgba, width, height, o.maxSide ?? MAX_SIDE);
    const w = work.width;
    const h = work.height;
    const pixels = work.rgba;
    const read = readInk(pixels, w, h, o);
    const distance = distanceTransform(read.mask);
    const markOptions = { distance };
    if (o.minArea !== undefined)
        markOptions.minArea = o.minArea;
    const marks = components(read.mask, w, h, markOptions);
    if (marks.length === 0)
        return null;
    const writing = chooseWriting(marks, w, h, o);
    if (writing.selectedArea === 0)
        return null;
    const alpha = softAlpha(read.light, read.background, writing.chosen, w, h, o);
    const bounds = inkBounds(alpha, w, h, o.padding ?? DEFAULT_OPTIONS.padding);
    if (!bounds)
        return null;
    const paper = paperColour(pixels, read.mask, w, h);
    const mode = o.ink ?? DEFAULT_OPTIONS.ink;
    const colours = inkColours(pixels, alpha, read.background, w, h, paper, mode);
    const cut = new Uint8ClampedArray(bounds.w * bounds.h * 4);
    for (let y = 0; y < bounds.h; y += 1) {
        for (let x = 0; x < bounds.w; x += 1) {
            const from = (bounds.y + y) * w + bounds.x + x;
            const to = (y * bounds.w + x) * 4;
            cut[to] = colours[from * 3] ?? 0;
            cut[to + 1] = colours[from * 3 + 1] ?? 0;
            cut[to + 2] = colours[from * 3 + 2] ?? 0;
            cut[to + 3] = (alpha[from] ?? 0) * 255;
        }
    }
    let inkArea = 0;
    for (let i = 0; i < w * h; i += 1) {
        if (read.mask[i])
            inkArea += 1;
    }
    const purity = inkArea > 0 ? writing.selectedArea / inkArea : 0;
    const quality = writing.selectedArea > 0 ? writing.strokeArea / writing.selectedArea : 0;
    return {
        rgba: cut,
        width: bounds.w,
        height: bounds.h,
        bounds,
        inkColor: dominantInkColour(colours, alpha, w, h),
        confidence: clamp(0.6 * purity + 0.4 * quality, 0, 1),
    };
}
