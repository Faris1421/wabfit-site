/**
 * Wab Fit — the photo editor's undo trail.
 *
 * Pure, DOM-free and clock-free, so the same module runs inside the page and
 * inside Node under vitest. It knows nothing about photos, adjustments or
 * pixels: it keeps the STATES a caller hands it, in order, and moves a cursor
 * along that list.
 *
 *   const history = createHistory({ params, baked, label: '' });
 *   history.push({ params: next, baked, label: 'التعريض' });
 *   history.undo();   // the state before that edit, exactly as it was
 *   history.redo();   // and forward again
 *
 * Three rules, and they are the whole file:
 *
 *   · a state belongs to the caller. This module never copies it, never looks
 *     inside it and never edits it; the only key it reads is `label`, which
 *     names the step in `labels`. A caller that keeps editing a state it has
 *     already pushed is editing its own undo trail.
 *   · a push after an undo forgets everything ahead of the cursor, so redo
 *     disappears the moment a new edit lands.
 *   · the list is capped and a full list drops its OLDEST state, so what a long
 *     session holds is bounded by `cap`, not by how long the person has been
 *     working.
 */

/** How many states the trail keeps when the caller does not say. */
export const DEFAULT_CAP = 60;

/**
 * A new trail, sitting on `initial`. `cap` is the most states it will hold: a
 * cap that is not a usable number falls back to the default, and a cap below
 * one is one, because a trail always has the state it is sitting on.
 */
export function createHistory(initial, cap = DEFAULT_CAP) {
  const limit = Number.isFinite(cap) ? Math.max(1, Math.floor(cap)) : DEFAULT_CAP;
  const states = [initial];
  let at = 0;

  return {
    /** The state the cursor is on — what the editor should be showing. */
    get state() {
      return states[at];
    },

    /** True when there is an earlier state to go back to. */
    get canUndo() {
      return at > 0;
    },

    /** True when there is a later state to go forward to. */
    get canRedo() {
      return at < states.length - 1;
    },

    /** The name of every step on the trail, oldest first. */
    get labels() {
      return states.map(labelOf);
    },

    /** Add a state. Whatever was ahead of the cursor is forgotten. */
    push(next) {
      states.length = at + 1;
      states.push(next);
      if (states.length > limit) states.shift();
      at = states.length - 1;
      return states[at];
    },

    /** One step back. At the oldest state this stays where it is. */
    undo() {
      if (at > 0) at -= 1;
      return states[at];
    },

    /** One step forward. At the newest state this stays where it is. */
    redo() {
      if (at < states.length - 1) at += 1;
      return states[at];
    },
  };
}

/** A state's name, or an empty string when it was pushed without one. */
function labelOf(state) {
  return state && typeof state.label === 'string' ? state.label : '';
}
