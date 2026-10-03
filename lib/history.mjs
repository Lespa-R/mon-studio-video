// Undo / redo of a clip's edits: effects, subtitles, cut-out choice.
//
// The server saves what the clip looked like before each edit; ⌘Z puts it
// back. Kept in memory (lost when the studio restarts), `limit` steps per
// clip. Bursts on the same thing (a slider dragged, arrows held on a number)
// make one step. Steps that would change nothing are skipped.
//
// Pure except for the Map it is handed.

export const editState = (v) => structuredClone({
  effects: v.effects, captions: v.captions ?? null, matteOptions: v.matteOptions ?? null,
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function makeHistory({ limit = 50, burstMs = 1500, now = () => Date.now() } = {}) {
  const clips = new Map(); // videoId -> { undo: [], redo: [], lastKey, lastAt }

  function remember(video, key, label) {
    const h = clips.get(video.id) || { undo: [], redo: [] };
    const t = now();
    if (!(h.lastKey === key && t - h.lastAt < burstMs)) {
      h.undo.push({ state: editState(video), label });
      if (h.undo.length > limit) h.undo.shift();
    }
    h.redo = [];
    h.lastKey = key;
    h.lastAt = t;
    clips.set(video.id, h);
  }

  // One step back ("undo") or forward ("redo"); returns its label, or null.
  function travel(video, which) {
    const h = clips.get(video.id);
    if (!h) return null;
    const [from, to] = which === "undo" ? ["undo", "redo"] : ["redo", "undo"];
    const current = editState(video);
    while (h[from].length) {
      const step = h[from].pop();
      if (same(step.state, current)) continue;
      h[to].push({ state: current, label: step.label });
      video.effects = step.state.effects;
      if (step.state.captions) video.captions = step.state.captions;
      else delete video.captions;
      if (step.state.matteOptions) video.matteOptions = step.state.matteOptions;
      h.lastKey = null;
      return step.label;
    }
    return null;
  }

  const peek = (id) => {
    const h = clips.get(id);
    return { undo: h?.undo.at(-1)?.label || null, redo: h?.redo.at(-1)?.label || null };
  };

  return { remember, travel, peek, forget: (id) => clips.delete(id) };
}
