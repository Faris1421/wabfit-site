/**
 * The photo editor's undo trail, as TypeScript sees it.
 *
 * A hand-written declaration for `history.js`, which runs in the page and under
 * vitest as plain JavaScript. The module is generic on purpose: the trail holds
 * whatever states the caller pushes, and the only thing it asks of them is a
 * `label` naming the step, so `labels` can say what an undo would undo.
 */

/** The one thing every state on the trail must carry. */
export interface HistoryState {
  readonly label: string;
}

/** The trail: where it is, what it remembers, and how to move. */
export interface History<T extends HistoryState> {
  /** The state the cursor is on. */
  readonly state: T;
  /** True when there is an earlier state to go back to. */
  readonly canUndo: boolean;
  /** True when there is a later state to go forward to. */
  readonly canRedo: boolean;
  /** The name of every step on the trail, oldest first. */
  readonly labels: string[];
  /** Add a state; whatever was ahead of the cursor is forgotten. */
  push(next: T): T;
  /** One step back, staying put at the oldest state. */
  undo(): T;
  /** One step forward, staying put at the newest state. */
  redo(): T;
}

/** How many states a trail keeps when no cap is given. */
export const DEFAULT_CAP: number;

/** A new trail, sitting on `initial`. */
export function createHistory<T extends HistoryState>(initial: T, cap?: number): History<T>;
