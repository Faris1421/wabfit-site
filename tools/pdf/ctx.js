/**
 * Wab Fit — the one object every part of this page shares.
 *
 * The shell, the document store, the viewer and every tool are separate files
 * that never import each other. They are handed the same `ctx` by main.js and
 * they talk through it: a module reads `ctx.doc`, changes one thing, calls
 * `ctx.commit(next)`, and every other module hears about it on the `'doc'`
 * event. Nothing else is shared state.
 *
 * `doc` and `history` are REPLACED when another document is opened — the store
 * does that, because a new file is not an edit of the old one — so they are
 * always read through `ctx` at the moment of use, never copied into a variable
 * of one's own at boot.
 *
 * Events, and who hears what:
 *
 *   'doc'     the model changed (commit, or a document was opened)
 *   'open'    a document was opened: {name, pages}
 *   'zoom'    the zoom factor changed
 *   'tool'    the selected tool changed
 *   'select'  the selected object changed, or became null
 */

import { t } from './i18n.js';
import { emptyDoc, history } from './core.js';

/**
 * One context for the whole session. `sources` and `names` are the ORIGINAL
 * bytes of every PDF that has been opened or merged, in the order `PageRef.src`
 * counts them, and the handle for each lives in docstore.js beside this file.
 */
export function createCtx() {
  /** The document the history currently sits on. */
  let doc = emptyDoc();

  /** Event name → the functions listening to it. */
  const listeners = new Map();

  const ctx = {
    sources: [],
    names: [],
    doc,
    history: history(doc),
    zoom: 1,
    tool: 'select',
    selection: null,
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

    /** The one way an edit is made: pushed onto the history, then announced. */
    commit(next) {
      ctx.history.push(next);
      ctx.doc = next;
      ctx.dirty = true;
      ctx.emit('doc', next);
      return next;
    },

    setTool(name) {
      if (ctx.tool === name) return;
      ctx.tool = name;
      ctx.emit('tool', name);
    },

    /** The selected object's id, or null for nothing selected. */
    select(id) {
      if (ctx.selection === id) return;
      ctx.selection = id;
      ctx.emit('select', id);
    },

    t,
  };

  return ctx;
}
