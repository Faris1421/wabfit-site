/**
 * Wab Fit — the types of the PDF tool's document core (core.js).
 *
 * A hand-written declaration beside the module, so the page's JavaScript and
 * the tests' TypeScript agree on the same shape without a build step. Every
 * type here is JSON: nothing is a class, a Date, a Map, a function or a
 * Promise, because the document is written to disk and read back.
 *
 * Coordinates are PDF points from the TOP-left of the page AS DISPLAYED, which
 * is the rotated page the person sees. `toPdfSpace` and `toTopLeft` convert
 * between that frame and pdf-lib's bottom-left one.
 */

/** A point, in whatever frame the function that asked for it works in. */
export interface Point {
  x: number;
  y: number;
}

/** A page's own box: its width and height in points, unrotated. */
export interface Size {
  width: number;
  height: number;
}

/** The box of a blank page, as it was created. */
export interface BlankBox {
  w: number;
  h: number;
}

/** A quarter turn. The only four rotations a page can have. */
export type Rotation = 0 | 90 | 180 | 270;

/** What every object carries, whichever kind it is. */
interface ObjBase {
  /** Unique across sessions, so a redone edit and a reopened file agree. */
  id: string;
  /** The position of the object's page in `Doc.pages`. */
  page: number;
}

/** Written text. Arabic is drawn from a picture instead — see `needsImageText`. */
export interface TextObj extends ObjBase {
  kind: 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** Font size in points. */
  size: number;
  /** `#rgb` or `#rrggbb`. */
  color: string;
  bold: boolean;
  /** True when the browser rendered this text as a PNG for export to embed. */
  asImage: boolean;
}

/** A freehand stroke. */
export interface InkObj extends ObjBase {
  kind: 'ink';
  points: Array<[number, number]>;
  color: string;
  /** Stroke width in points. */
  width: number;
  /** 0 to 1. */
  opacity: number;
}

/** Which shape a shape object is. */
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';

/**
 * A shape. For `line` and `arrow` the box is the segment's two ends: it starts
 * at (x, y) and ends at (x + w, y + h).
 */
export interface ShapeObj extends ObjBase {
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** `#rgb` or `#rrggbb`; an empty string draws no border — a highlight. */
  stroke: string;
  /** A colour, or null for a shape that is only an outline. */
  fill: string | null;
  /** Border width in points. */
  width: number;
  /** 0 to 1; missing means fully opaque. */
  opacity?: number;
}

/** An embedded picture: a signature, a photo, a scaled screenshot. */
export interface ImageObj extends ObjBase {
  kind: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Base64 PNG, with or without a `data:image/png;base64,` prefix. */
  pngBase64: string;
}

/** An opaque rectangle: the whiteout tool, and the first half of a redaction. */
export interface WhiteoutObj extends ObjBase {
  kind: 'whiteout';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /**
   * True for a cover made with `t('secureRedact')` on. Its page is a redaction,
   * so export draws that whole page to a picture and the words under the cover
   * are gone from the file rather than hidden behind a rectangle.
   */
  secure?: boolean;
}

/** Anything that can be drawn on a page. */
export type Obj = TextObj | InkObj | ShapeObj | ImageObj | WhiteoutObj;

/**
 * One page of the document: a page of a source PDF, or a blank page made here.
 *
 * `src` is the position of the source PDF in the caller's own list of byte
 * arrays, or -1 for a blank page. `rotate` is a quarter turn ON TOP of whatever
 * the source page already carries, which is what makes rotatePage a +90/-90.
 */
export interface PageRef {
  src: number;
  index: number;
  rotate: Rotation;
  blank?: BlankBox;
}

/** The whole edit. Plain JSON, so undo, redo and the on-device cache hold it. */
export interface Doc {
  pages: PageRef[];
  objects: Obj[];
}

/** A PNG the browser rendered for a text object that pdf-lib cannot write. */
export interface RasterText {
  pngBase64: string;
  w: number;
  h: number;
}

/** What a form field turned out to be. */
export interface FormField {
  name: string;
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'other';
  value: string | boolean;
  options?: string[];
}

/** Undo and redo over whole documents, newest last, a hundred states deep. */
export interface History {
  readonly state: Doc;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  push(next: Doc): Doc;
  undo(): Doc;
  redo(): Doc;
}

/** Line box of written text, in multiples of the font size. */
export declare const TEXT_LINE_HEIGHT: number;

/** Anything at all becomes one of 0, 90, 180, 270. */
export declare function normalizeRotation(value: number): Rotation;

/** The size a page shows at when it is displayed with this rotation. */
export declare function displaySize(size: Size, rotate: number): Size;

/** A point on the displayed page as pdf-lib wants it. */
export declare function toPdfSpace(x: number, y: number, size: Size, rotate: number): Point;

/** The other way: a pdf-lib point back onto the displayed page. */
export declare function toTopLeft(x: number, y: number, size: Size, rotate: number): Point;

/** A new object id, unique within the session and against older sessions. */
export declare function newId(): string;

/** A document with nothing in it. */
export declare function emptyDoc(): Doc;

/** Takes the page at `from` out and puts it back at `to`. */
export declare function movePage(doc: Doc, from: number, to: number): Doc;

/** A quarter turn, +90 or -90, on the page's own rotation. */
export declare function rotatePage(doc: Doc, index: number, delta: number): Doc;

/** Removes a page and everything drawn on it. */
export declare function deletePage(doc: Doc, index: number): Doc;

/** Puts a copy of a page directly after it, with new copies of its objects. */
export declare function duplicatePage(doc: Doc, index: number): Doc;

/** A new empty page at `at`; a missing size becomes A4 portrait. */
export declare function insertBlank(doc: Doc, at: number, size: BlankBox): Doc;

/** Every page of one more source PDF, in order, at the end of the document. */
export declare function appendSource(doc: Doc, srcIndex: number, pageCount: number): Doc;

/** A document holding only the pages asked for, in the order asked for. */
export declare function extract(doc: Doc, indices: number[]): Doc;

/** Undo and redo over whole documents. */
export declare function history(initial: Doc): History;

/** True when the text has a character pdf-lib cannot write, Arabic included. */
export declare function needsImageText(text: string): boolean;

/** The lines of a text object. */
export declare function textLines(text: string): string[];

/** Where a line's baseline starts, on the displayed page. */
export declare function textBaseline(obj: TextObj, line?: number): Point;

/**
 * Writes the document into one new PDF and answers its bytes.
 *
 * `sources` is the caller's list of PDFs in the order `PageRef.src` counts.
 * `rasterTexts` carries the pictures for text objects with `asImage: true`,
 * keyed by object id. A text object that needs a picture and has none is left
 * out rather than written as broken glyphs.
 */
export declare function exportPdf(
  sources: Uint8Array[],
  doc: Doc,
  rasterTexts?: Record<string, RasterText>,
): Promise<Uint8Array>;

/** Every field of a PDF, in the order the form lists them. */
export declare function listFormFields(bytes: Uint8Array): Promise<FormField[]>;

/**
 * Writes values into a PDF's own form. A name the form does not have is
 * ignored; `flatten` bakes the answers in and takes the fields out.
 */
export declare function fillForm(
  bytes: Uint8Array,
  values: Record<string, string | boolean>,
  flatten: boolean,
): Promise<Uint8Array>;
