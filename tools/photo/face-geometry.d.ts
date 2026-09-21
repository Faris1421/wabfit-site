/**
 * The face geometry's arithmetic, as TypeScript sees it.
 *
 * A hand-written declaration for `face-geometry.js`, which runs in the page and
 * under vitest as plain JavaScript. It says that the mesh groups are index lists
 * into MediaPipe's 478 points, that a frame is a point and an orthonormal pair
 * of unit vectors sized in picture pixels, and that the warps a slider asks for
 * are discs whose displacement always answers a `Float32Array` of `(dx, dy)`.
 */

/** A point in picture pixels. */
export interface Point {
  x: number;
  y: number;
}

/** The groups the tools read out of MediaPipe's canonical 478-point mesh. */
export interface MeshGroups {
  faceOval: readonly number[];
  leftEye: readonly number[];
  rightEye: readonly number[];
  leftIris: readonly number[];
  rightIris: readonly number[];
  lipsOuter: readonly number[];
  lipsInner: readonly number[];
  noseBridge: readonly number[];
  noseAlar: readonly number[];
  jaw: readonly number[];
  chin: readonly number[];
  leftBrow: readonly number[];
  rightBrow: readonly number[];
}

/** The canonical mesh, grouped the way the tools ask for it. */
export const MESH: MeshGroups;

/** The face's own frame: the eye line is its axis, its size the inter-ocular gap. */
export interface FaceFrame {
  /** The midpoint of the two eye centres, in picture pixels. */
  center: Point;
  /** The unit vector from the left eye's centre to the right eye's centre. */
  right: Point;
  /** The unit vector a quarter turn anticlockwise of `right`, toward the top. */
  up: Point;
  /** The inter-ocular distance, in picture pixels. */
  scale: number;
  leftEye: Point;
  rightEye: Point;
}

/** The face sliders, each -100 to 100; a missing key moves nothing. */
export interface FaceSliders {
  slim?: number;
  jaw?: number;
  chin?: number;
  eyes?: number;
  nose?: number;
  lips?: number;
  smile?: number;
}

/** One local move: a disc whose strength falls to nothing at its rim. */
export interface Warp {
  cx: number;
  cy: number;
  radius: number;
  /** For a push, the move at full strength; for a bulge, the axis weights. */
  dx: number;
  dy: number;
  kind: 'push' | 'bulge';
  /** The slider's own fraction, -1 to 1. */
  amount: number;
}

/** The face's own frame, read from the two eye contours. */
export function faceFrame(landmarks: readonly Point[]): FaceFrame;

/** The warps the face sliders ask for, most of them one per landmark they move. */
export function controls(landmarks: readonly Point[], sliders: FaceSliders): Warp[];

/** What every warp does to one point, added together. */
export function displace(warps: readonly Warp[], x: number, y: number): { dx: number; dy: number };

/** The warps sampled on a grid covering the picture: `(dx, dy)` per vertex. */
export function displacementField(
  warps: readonly Warp[],
  gridW: number,
  gridH: number,
  imageW: number,
  imageH: number,
): Float32Array;
