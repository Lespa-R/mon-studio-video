// Trimming a clip: keep [start, end] of the original footage.
//
// The studio keeps the original file and cuts a new working copy from it, so
// a trim can always be changed — extended again, or undone. Everything timed
// on the clip (effects, subtitles) lives in the working copy's time, and is
// shifted here when the cut moves.
//
// Pure functions only; the server does the cutting (lib/media.mjs cutClip).

import { keptSegments, keptLength, localOf, sourceOf } from "./textcut.mjs";

const r3 = (n) => Math.round(n * 1000) / 1000;
const MIN = 0.1;

// A valid [start, end] within the original, at least half a second long.
export function normaliseTrim({ start, end } = {}, sourceDuration) {
  const s = Math.max(0, Math.min(Number(start) || 0, sourceDuration - 0.5));
  const eRaw = Number.isFinite(Number(end)) ? Number(end) : sourceDuration;
  const e = Math.min(sourceDuration, Math.max(s + 0.5, eRaw));
  return { start: r3(s), end: r3(e) };
}

// Effects and subtitles after the cut moves from `from` to `to` (both
// { start, end, cuts? } in the original's time — `cuts` being the passages
// removed by the text editor, lib/textcut.mjs). Returns what changed so the UI
// can say so: effects pulled back inside the kept part, lines hidden.
//
// Nothing is lost for good: an effect pulled to the edge remembers where it
// was (`trimmedFrom`, original time), subtitle lines cut off are kept aside
// (`captions.offcuts`), and a line cut in half keeps its whole self (`full`).
// Widening the trim again puts them back — unless they were edited since.
export function shiftForTrim(video, from, to) {
  const fromSegs = keptSegments(from);
  const toSegs = keptSegments(to);
  const length = keptLength(toSegs);
  let clamped = 0;

  const effects = (video.effects || []).map((original) => {
    const fx = { ...original, params: retimeParams(original.params, fromSegs, toSegs) };
    const { trimmedFrom, ...rest } = fx;
    const start = Number(fx.start) || 0;
    // An effect over the whole clip stays over the whole clip.
    if (start < 0.001 && fx.duration == null) return rest;

    // Where it is in the original: remembered if it was pulled to an edge
    // and has not been moved since, else computed from where it is now.
    const untouched = trimmedFrom && trimmedFrom.was.start === fx.start && trimmedFrom.was.duration === fx.duration;
    const absStart = untouched ? trimmedFrom.start : sourceOf(fromSegs, start, "next");
    const absEnd = untouched
      ? (trimmedFrom.duration == null ? null : trimmedFrom.start + trimmedFrom.duration)
      : (fx.duration == null ? null : sourceOf(fromSegs, start + Number(fx.duration), "prev"));

    const a = localOf(toSegs, absStart);
    const b = absEnd == null ? null : localOf(toSegs, absEnd);
    let ns = a.t;
    let ne = b ? b.t : null;
    const outside = !a.kept || ns > length - MIN || (b && (!b.kept || ne < MIN));
    ns = Math.min(Math.max(0, ns), length - MIN);
    if (ne != null) ne = Math.min(length, Math.max(ns + MIN, ne));
    const next = { ...rest, start: r3(ns), duration: ne == null ? null : r3(ne - ns) };
    if (outside) {
      if (fx.enabled !== false) clamped++;
      next.trimmedFrom = {
        start: r3(absStart), duration: absEnd == null ? null : r3(absEnd - absStart),
        was: { start: next.start, duration: next.duration },
      };
    }
    return next;
  });

  let dropped = 0;
  let captions = video.captions || null;
  if (captions && (captions.cues?.length || captions.offcuts?.length)) {
    const toSource = (c) => ({
      ...c,
      start: sourceOf(fromSegs, c.start, "next"), end: sourceOf(fromSegs, c.end, "prev"),
      words: (c.words || []).map((w) => ({ w: w.w, s: sourceOf(fromSegs, w.s, "next"), e: sourceOf(fromSegs, w.e, "prev") })),
    });
    // Every line in the original's time: the visible ones (whole again if
    // they had been cut and not edited since) and those set aside earlier.
    const all = [
      ...(captions.cues || []).map((c) => {
        const { full, ...cue } = c;
        return full && (full.shown ?? full.text) === c.text ? { ...cue, ...full, shown: undefined } : toSource(cue);
      }),
      ...(captions.offcuts || []),
    ].map(({ shown, ...c }) => c).sort((a, b) => a.start - b.start);

    const cues = [];
    const offcuts = [];
    for (const c of all) {
      const words = c.words || [];
      const keptWords = words.filter((w) => localOf(toSegs, (w.s + w.e) / 2).kept);
      const visible = words.length
        ? keptWords.length > 0
        : keptLength(keptSegments({ ...to, start: Math.max(to.start, c.start), end: Math.min(to.end, c.end) })) >= 0.05;
      if (!visible) { offcuts.push(c); continue; }

      const a = localOf(toSegs, c.start);
      const b = localOf(toSegs, c.end);
      const lost = keptWords.length < words.length;
      const cut = !a.kept || !b.kept || lost;
      const local = keptWords.map((w) => ({ w: w.w, s: localOf(toSegs, w.s).t, e: localOf(toSegs, w.e).t }));
      // A line whose words were removed loses them from its text too —
      // unless its text was edited by hand (then it no longer matches them).
      const untouchedText = words.map((w) => w.w).join(" ").replace(/\s+/g, " ").trim() === String(c.text).replace(/\s+/g, " ").trim();
      const text = lost && untouchedText ? keptWords.map((w) => w.w).join(" ") : c.text;
      const start = local.length ? Math.min(a.t, local[0].s) : a.t;
      const end = local.length ? Math.max(b.t, local[local.length - 1].e) : b.t;
      const kept = { ...c, text, start: r3(Math.max(0, start)), end: r3(Math.min(length, Math.max(start + 0.05, end))), words: local };
      if (cut) kept.full = { text: c.text, start: c.start, end: c.end, words: c.words, ...(text !== c.text ? { shown: text } : {}) };
      else delete kept.full;
      cues.push(kept);
    }
    dropped = Math.max(0, (captions.cues?.length || 0) - cues.length);
    captions = { ...captions, cues, offcuts };
  }
  return { effects, captions, clamped, dropped, length };
}

// Moments inside an effect's params move with the cut too: when it was
// pinned to the scenery (pinAt, or pinAt0… for several spots) — on the edge
// of a removed passage if it was in one — and the frame an object was
// clicked on in it, to be chosen again (null) if that frame was cut away.
function retimeParams(params, fromSegs, toSegs) {
  if (!params) return params;
  const out = { ...params };
  const moved = (t) => localOf(toSegs, sourceOf(fromSegs, Number(t) || 0));
  for (const [key, value] of Object.entries(params)) {
    if (/^pinAt\d*$/.test(key) && value !== null && value !== undefined && value !== "") out[key] = r3(moved(value).t);
  }
  if (params.object && params.object.t !== undefined) {
    const at = moved(params.object.t);
    out.object = at.kept ? { ...params.object, t: r3(at.t) } : null;
  }
  return out;
}
