// Trimming a clip: keep [start, end] of the original footage.
//
// The studio keeps the original file and cuts a new working copy from it, so
// a trim can always be changed — extended again, or undone. Everything timed
// on the clip (effects, subtitles) lives in the working copy's time, and is
// shifted here when the cut moves.
//
// Pure functions only; the server does the cutting (lib/media.mjs cutClip).

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
// { start, end } in the original's time). Returns what changed so the UI can
// say so: effects pulled back inside the kept part, lines hidden.
//
// Nothing is lost for good: an effect pulled to the edge remembers where it
// was (`trimmedFrom`, original time), subtitle lines cut off are kept aside
// (`captions.offcuts`), and a line cut in half keeps its whole self (`full`).
// Widening the trim again puts them back — unless they were edited since.
export function shiftForTrim(video, from, to) {
  const length = r3(to.end - to.start);
  let clamped = 0;

  const effects = (video.effects || []).map((fx) => {
    const { trimmedFrom, ...rest } = fx;
    const start = Number(fx.start) || 0;
    // An effect over the whole clip stays over the whole clip.
    if (start < 0.001 && fx.duration == null) return rest;

    // Where it is in the original: remembered if it was pulled to an edge
    // and has not been moved since, else computed from where it is now.
    const untouched = trimmedFrom && trimmedFrom.was.start === fx.start && trimmedFrom.was.duration === fx.duration;
    const absStart = untouched ? trimmedFrom.start : start + from.start;
    const absEnd = untouched
      ? (trimmedFrom.duration == null ? null : trimmedFrom.start + trimmedFrom.duration)
      : (fx.duration == null ? null : start + Number(fx.duration) + from.start);

    let ns = absStart - to.start;
    let ne = absEnd == null ? null : absEnd - to.start;
    const outside = ns < -0.001 || ns > length - MIN || (ne != null && (ne > length + 0.001 || ne < MIN));
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
    const shift = (c, d) => ({
      ...c, start: r3(c.start + d), end: r3(c.end + d),
      words: (c.words || []).map((w) => ({ w: w.w, s: r3(w.s + d), e: r3(w.e + d) })),
    });
    // Every line in the original's time: the visible ones (whole again if
    // they had been cut and not edited since) and those set aside earlier.
    const all = [
      ...(captions.cues || []).map((c) => {
        const { full, ...cue } = c;
        return full && full.text === c.text ? { ...cue, ...full } : shift(cue, from.start);
      }),
      ...(captions.offcuts || []),
    ].sort((a, b) => a.start - b.start);

    const cues = [];
    const offcuts = [];
    for (const c of all) {
      if (c.end <= to.start + 0.05 || c.start >= to.end - 0.05) { offcuts.push(c); continue; }
      const local = shift(c, -to.start);
      const cut = local.start < 0 || local.end > length;
      const words = local.words
        .filter((w) => w.e > 0 && w.s < length)
        .map((w) => ({ ...w, s: Math.max(0, w.s), e: Math.min(length, w.e) }));
      const kept = { ...local, start: r3(Math.max(0, local.start)), end: r3(Math.min(length, local.end)), words };
      if (cut) kept.full = { text: c.text, start: c.start, end: c.end, words: c.words };
      cues.push(kept);
    }
    dropped = Math.max(0, (captions.cues?.length || 0) - cues.length);
    captions = { ...captions, cues, offcuts };
  }
  return { effects, captions, clamped, dropped, length };
}
