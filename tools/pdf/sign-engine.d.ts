/**
 * The signature lift, as TypeScript sees it.
 *
 * A hand-written declaration for `sign-engine.js`, which runs in the PDF tool's
 * page and under vitest as plain JavaScript. It says what every stage of the lift
 * takes and answers: a crop of RGBA pixels in, one number a pixel out, and in the
 * end the pen itself as an RGBA image with a soft alpha.
 *
 * Everything here is plain data — typed arrays and numbers — because the stages
 * are pure and are called from a page as well as from the app. Nothing is a
 * class, a Date, a Map, a function or a Promise.
 */

/** The longer side a crop is worked at; anything bigger is averaged down. */
export declare const MAX_SIDE: number;

/** The resolution the pixel constants are quoted at: 2480 px, A4's width at 300 dpi. */
export declare const SCALE_300: number;

/** What a repainted pen is painted in. */
export declare const INK_BLACK: string;
export declare const INK_BLUE: string;

/** What the kept pixels are painted in. */
export type InkMode = 'source' | 'black' | 'blue';

/** A box of pixels in whatever frame the function that answers it works in. */
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A raster: its pixels and its own size. */
export interface Raster {
  rgba: ArrayLike<number>;
  width: number;
  height: number;
}

/** CIE Lab, one number per pixel per axis. */
export interface Lab {
  /** Lightness, 0 to 100. */
  L: Float32Array;
  /** Green to red, about -128 to 128. */
  a: Float32Array;
  /** Blue to yellow, about -128 to 128. */
  b: Float32Array;
}

/** One island of ink, walked and measured. */
export interface Mark {
  /** The mark's pixels, as `y * width + x` indices into the crop. */
  pixels: Int32Array;
  /** The box it fills. */
  box: Bounds;
  /** How many pixels it holds. */
  area: number;
  /** Median stroke thickness in pixels, from the distance transform. */
  strokeWidth: number;
  /** How stretched its second moments are: 1 round, 60 a straight line. */
  elongation: number;
  /** How much of its own box it fills: 1 is a solid rectangle. */
  fill: number;
}

/**
 * What the writing is, as the stages found it.
 *
 * `chosen` holds one flag a pixel of the crop; `taken`, `stroke` and `text` hold
 * one flag a mark, in the order the marks were handed in; `seeds` are the marks
 * the writing started from.
 */
export interface Writing {
  chosen: Uint8Array;
  taken: Uint8Array;
  stroke: Uint8Array;
  text: Uint8Array;
  seeds: number[];
  selectedArea: number;
  strokeArea: number;
}

/** The colour of the paper an ink pixel is un-premultiplied against. */
export interface Paper {
  r: number;
  g: number;
  b: number;
  /** Its own luminance, 0 to 255. */
  light: number;
}

/** The pen, lifted out of the crop. */
export interface Lift {
  /** The cut: RGB the ink's own colour a pixel, A the soft alpha. */
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** Where the cut came from, in the working frame, padding included. */
  bounds: Bounds;
  /** The pen's own colour, `#rrggbb`, whatever it was repainted in. */
  inkColor: string;
  /** 0 to 1: how much of the ink found was the writing, and how stroke-like it read. */
  confidence: number;
}

/** What Sauvola and the colour test are tuned with. */
export interface MaskOptions {
  /** Sauvola's window, in pixels at 300 dpi. */
  sauvolaWindow?: number;
  /** Sauvola's k: how far the cut sits under the local mean. 0.2 to 0.34. */
  sauvolaK?: number;
  /** The window the local background chroma is read over, in pixels at 300 dpi. */
  chromaWindow?: number;
  /** How far a pixel's Lab chroma must stand off the paper to be counted as ink. */
  chromaThreshold?: number;
  /**
   * How much darker than the paper under it a pixel must be to be ink whatever
   * the local cut says, 0 to 1. This is what keeps a stroke thicker than
   * Sauvola's own window from being hollowed out.
   */
  inkContrast?: number;
}

/** What the rule stage is tuned with. */
export interface RulesOptions {
  /** How long a run must be to be a rule, as a share of the crop's width or height. */
  ruleSpan?: number;
  /** How thick a rule may be, in pixels at 300 dpi; thicker is a stroke. */
  ruleThickness?: number;
}

/** What the marks are measured and chosen with. */
export interface MarkOptions {
  /** Specks under this area, in pixels at 300 dpi, are dropped. */
  minArea?: number;
  /** The stroke width band of a pen, in pixels at 300 dpi. */
  minStroke?: number;
  maxStroke?: number;
  /** How stretched and how empty of its box a mark must be to read as a stroke. */
  minElongation?: number;
  maxFill?: number;
  /** A distance transform to reuse instead of measuring one over the mask. */
  distance?: Float32Array;
}

/** What joining the parts of one hand is tuned with. */
export interface WritingOptions extends MarkOptions {
  /** How close two parts may be, as a share of the longer side, in PIXELS. */
  joinGap?: number;
}

/** What the soft alpha is tuned with. */
export interface AlphaOptions {
  /** How many pixels the alpha is grown past the chosen mask, for the edge. */
  grow?: number;
}

/** Every dial of the whole lift. */
export interface LiftOptions extends MaskOptions, RulesOptions, WritingOptions, AlphaOptions {
  /** The longer side a crop is worked at; anything bigger is averaged down. */
  maxSide?: number;
  /** The closing radius, as a share of the SHORTER side. */
  backgroundRadius?: number;
  /** Padding put around the tight bounds, as a share of their longer side. */
  padding?: number;
  /** What the kept pixels are painted in: 'source', 'black' or 'blue'. */
  ink?: InkMode;
}

/** Every dial with the default it runs at, as `DEFAULT_OPTIONS` holds them. */
export interface ResolvedOptions {
  maxSide: number;
  backgroundRadius: number;
  sauvolaWindow: number;
  sauvolaK: number;
  chromaWindow: number;
  chromaThreshold: number;
  inkContrast: number;
  ruleSpan: number;
  ruleThickness: number;
  minArea: number;
  minStroke: number;
  maxStroke: number;
  minElongation: number;
  maxFill: number;
  joinGap: number;
  padding: number;
  ink: InkMode;
  grow: number;
}

/** Every dial, with its default. */
export declare const DEFAULT_OPTIONS: ResolvedOptions;

/** The working scale of a crop: 1 at 2480 px on the longer side, never below 1. */
export declare function scaleUnit(width: number, height: number): number;

/** Stage 1a. Every pixel's luminance, 0 to 255, Rec. 709 weighted. */
export declare function luminance(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): Float32Array;

/** Stage 1b. CIE Lab of every pixel: L 0 to 100, a and b the two hue axes. */
export declare function lab(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): Lab;

/** A max filter: the lightest value within `radius` of every pixel. */
export declare function maxFilter(
  src: ArrayLike<number>,
  width: number,
  height: number,
  radius: number,
): Float32Array;

/** A min filter: the darkest value within `radius` of every pixel. */
export declare function minFilter(
  src: ArrayLike<number>,
  width: number,
  height: number,
  radius: number,
): Float32Array;

/** The sum of the values in a `2 * radius + 1` square around every pixel. */
export declare function boxSum(
  src: ArrayLike<number>,
  width: number,
  height: number,
  radius: number,
): Float32Array;

/** The mean of the values in a `2 * radius + 1` square around every pixel. */
export declare function boxMean(
  src: ArrayLike<number>,
  width: number,
  height: number,
  radius: number,
): Float32Array;

/** Every pixel with any ink within `radius` of it: a box dilation. */
export declare function dilate(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  radius: number,
): Uint8Array;

/** Every pixel whose whole window is ink: a box erosion. */
export declare function erode(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  radius: number,
): Uint8Array;

/** The distance from every ink pixel to the nearest paper, in pixels. */
export declare function distanceTransform(
  mask: ArrayLike<number>,
  width: number,
  height: number,
): Float32Array;

/** Stage 2. The paper under every pixel: a grey closing of the light. */
export declare function estimateBackground(
  light: ArrayLike<number>,
  width: number,
  height: number,
  radius: number,
): Float32Array;

/** Stage 3. The light as a share of the paper under it, 0 to 255, paper at 255. */
export declare function normalise(
  light: ArrayLike<number>,
  background: ArrayLike<number>,
  width: number,
  height: number,
): Float32Array;

/** Stage 4a. Sauvola's local threshold: ink is at or under the local cut. */
export declare function sauvola(
  lightNorm: ArrayLike<number>,
  width: number,
  height: number,
  k: number,
  radius: number,
): Uint8Array;

/** Stage 4b. The coloured ink: Lab chroma standing off the paper around it. */
export declare function chromaInk(
  channels: Lab,
  width: number,
  height: number,
  radius: number,
  threshold: number,
): Uint8Array;

/** Stage 4. The ink mask: Sauvola's cut or the colour test, whichever fires. */
export declare function inkMask(
  lightNorm: ArrayLike<number>,
  channels: Lab,
  width: number,
  height: number,
  opts?: MaskOptions,
): Uint8Array;

/** Stage 5. Ruled and grid paper out, a pen crossing a rule kept. */
export declare function removeRules(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  opts?: RulesOptions,
): Uint8Array;

/** Stage 6a. The marks of an ink mask: 8-connected islands, specks dropped. */
export declare function components(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  opts?: MarkOptions,
): Mark[];

/** Stage 6b. Is this mark a stroke of a pen rather than a block or a speck? */
export declare function strokeLike(mark: Mark, limits?: MarkOptions): boolean;

/** Stage 6c. One flag a mark: is it a letter of a printed line? */
export declare function textRow(marks: Mark[], width: number, height: number): Uint8Array;

/** Stage 6d. The writing itself, as the set of marks the pen owns. */
export declare function chooseWriting(
  marks: Mark[],
  width: number,
  height: number,
  opts?: WritingOptions,
): Writing;

/** Stage 7. How much of the pen is over every pixel, 0 to 1, soft at the edge. */
export declare function softAlpha(
  light: ArrayLike<number>,
  background: ArrayLike<number>,
  chosen: ArrayLike<number>,
  width: number,
  height: number,
  opts?: AlphaOptions,
): Float32Array;

/** Stage 8a. The colour of the paper, or null when the mask claims it all. */
export declare function paperColour(
  rgba: ArrayLike<number>,
  mask: ArrayLike<number>,
  width: number,
  height: number,
): Paper | null;

/** Stage 8b. Three numbers a pixel: the ink's own colour, or one flat one. */
export declare function inkColours(
  rgba: ArrayLike<number>,
  alpha: ArrayLike<number>,
  background: ArrayLike<number>,
  width: number,
  height: number,
  paper: Paper | null,
  mode: InkMode,
): Uint8ClampedArray;

/** The pen's own colour, as `#rrggbb`, from the opaque pixels. */
export declare function dominantInkColour(
  colours: ArrayLike<number>,
  alpha: ArrayLike<number>,
  width: number,
  height: number,
): string;

/** Stage 9a. The tight bounds of the ink, plus `padding` of their longer side. */
export declare function inkBounds(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  padding?: number,
): Bounds | null;

/** Stage 9b. The box, out of the source, as its own RGBA array. */
export declare function cropRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  bounds: Bounds,
): Uint8ClampedArray;

/** The crop as it is worked on: left alone below `maxSide`, averaged down above. */
export declare function fitToMaxSide(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  maxSide?: number,
): Raster;

/**
 * The whole lift: the crop in, the pen out, or null when there is no pen in it.
 *
 * `rgba` is width * height * 4 numbers; the answer is at the working size, at
 * most `maxSide` on its longer side, and `bounds` is in that same frame.
 */
export declare function liftSignature(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  opts?: LiftOptions,
): Lift | null;
