/**
 * Wab Fit — the one object every part of the photo page shares.
 *
 * The shell, the pipeline and every tool are separate files that never import
 * each other. main.js hands them the same `ctx`, and they talk through it and
 * its events; nothing else is shared state.
 *
 *   image    the ORIGINAL pixels, as the app or the file picker delivered them.
 *            Never drawn into, never adjusted, never written to: it is what
 *            "compare with the original" shows.
 *   baked    the original AFTER the destructive steps — crop, erase, face work,
 *            background — which is what the pipeline reads and what an export
 *            is written from. It equals `image` until a destructive step lands.
 *   params   the NON-destructive values: the thirteen adjustments, the sharpen
 *            amount, the filter and its strength. Changed through `setParams`,
 *            never edited in place.
 *   history  the undo trail (history.js). It holds `{params, baked, label}`
 *            states, so an undo moves the adjustments and the pixels together.
 *   tool     the id of the tool whose controls are on screen ('' for none).
 *   dirty    true once there is an edit to hand back to the app.
 *
 * EVENTS, and who hears what:
 *
 *   'image'    a photo was opened: {name, bitmap}
 *   'params'   the adjustments changed: the new params object
 *   'baked'    the pixels under them changed: the baked bitmap (or null)
 *   'tool'     the selected tool changed: the tool's id
 *   'history'  undo, redo or an edit: nothing, and the trail is the news
 *   'export'   the export button was pressed: {name} — the writer answers it,
 *              and there is no writer until a later step lands
 *   'compare'  the compare button went down (true) or up (false) — the pipeline
 *              answers it by drawing the original while it is true
 *
 * TWO RULES keep undo honest, and both are the caller's to keep: a `params`
 * object is REPLACED rather than edited, and `image` is never changed at all. A
 * state that is still on the trail must never move under it.
 */

import { t } from './i18n.js';
import { createHistory } from './history.js';

/**
 * The pipeline's neutral position: thirteen adjustments that move nothing, a
 * sharpen amount that moves nothing, and no filter. These are the values a photo
 * arrives with and the values every control returns to. The ranges and the maths
 * belong to the pipeline; the names live here, because a state on the undo trail
 * is described by them.
 */
export function neutralParams() {
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    clarity: 0,
    vignette: 0,
    grain: 0,
    sharpen: 0,
    /** The filter's id; `'none'` is no filter. The filter list owns the ids. */
    filter: 'none',
    /** How much of the filter is applied, 0 to 1. */
    strength: 1,
  };
}

/** One state on the trail, built in the one place that decides its shape. */
export function stateOf(params, baked, label) {
  return { params, baked, label: typeof label === 'string' ? label : '' };
}

/** One context for the whole session. */
export function createCtx() {
  const listeners = new Map();
  const params = neutralParams();

  const ctx = {
    image: null,
    baked: null,
    params,
    history: createHistory(stateOf(params, null, '')),
    tool: '',
    dirty: false,

    /** Listen for one event. Answers the function that stops listening. */
    on(event, fn) {
      const group = listeners.get(event);
      if (group) group.push(fn);
      else listeners.set(event, [fn]);
      return () => {
        const list = listeners.get(event);
        if (!list) return;
        const at = list.indexOf(fn);
        if (at >= 0) list.splice(at, 1);
      };
    },

    /**
     * Tell everyone. A copy of the list is walked, so a listener that stops
     * listening while it is being called cannot disturb the walk.
     */
    emit(event, payload) {
      const group = listeners.get(event);
      if (!group) return;
      for (const fn of Array.from(group)) fn(payload);
    },

    /**
     * A non-destructive edit. `patch` is merged OVER the current values, so only
     * the keys the caller names move, and `label` names the step on the trail —
     * already translated, because the caller can reach `t` through `ctx.t`.
     */
    setParams(patch, label) {
      const next = { ...ctx.params, ...patch };
      ctx.params = next;
      ctx.dirty = true;
      ctx.history.push(stateOf(next, ctx.baked, label));
      ctx.emit('params', next);
      ctx.emit('history');
      return next;
    },

    /**
     * A destructive step is done: `bitmap` is the pixels every adjustment now
     * reads, and the step goes on the trail carrying the parameters it left
     * behind. Undoing it therefore puts the earlier pixels and the earlier
     * adjustments back together, which is the only way "bake" and "undo" are
     * both true at once.
     */
    bake(bitmap, label) {
      ctx.baked = bitmap === undefined ? null : bitmap;
      ctx.dirty = true;
      ctx.history.push(stateOf(ctx.params, ctx.baked, label));
      ctx.emit('baked', ctx.baked);
      ctx.emit('history');
      return ctx.baked;
    },

    /** The tool whose controls are on screen. The same id twice is not news. */
    setTool(name) {
      if (ctx.tool === name) return name;
      ctx.tool = name;
      ctx.emit('tool', name);
      return name;
    },

    /** One step back: the adjustments and the pixels move together. */
    undo() {
      return restore(ctx, ctx.history.undo());
    },

    /** One step forward again, on the same terms. */
    redo() {
      return restore(ctx, ctx.history.redo());
    },

    t,
  };

  return ctx;
}

/**
 * Put a state from the trail back on the screen. Both halves move before anyone
 * is told, so no listener can see the new adjustments over the old bitmap.
 */
function restore(ctx, state) {
  ctx.params = state.params;
  ctx.baked = state.baked === undefined ? null : state.baked;
  ctx.emit('params', ctx.params);
  ctx.emit('baked', ctx.baked);
  ctx.emit('history');
  return state;
}
