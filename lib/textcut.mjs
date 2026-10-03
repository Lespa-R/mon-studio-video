// Montage par le texte: a clip's transcript, and the passages removed from it.
//
// Times here are in the ORIGINAL footage's time (the file kept by a trim, or
// the clip itself while it has never been trimmed). A clip's cut is
//
//   video.trim = { start, end, source, ext, cuts: [{ start, end }] }
//
// — keep [start, end] of the original, minus every `cuts` range. The working
// copy is those kept segments end to end ("local" time); the helpers below map
// a time between the two.
//
// The transcript (media/<id>-transcript.json) is
//
//   { engine, lang, duration, words: [{ w, s, e }], speech: [{ start, end }] }
//
// `speech` is where a voice detector heard someone talk: a gap between words
// outside it is a pause, a gap inside it is speech nobody transcribed —
// usually a « euh » or a false start, which Whisper leaves out of its text.
//
// Pure, and no imports: the UI loads this same file as a module.

export const r3 = (n) => Math.round(n * 1000) / 1000;

// Removed ranges, sorted, merged, inside [start, end], none shorter than minLen.
export function normaliseCuts(cuts, start, end, minLen = 0.04) {
  const list = (Array.isArray(cuts) ? cuts : [])
    .map((c) => ({ start: Math.max(start, Number(c?.start)), end: Math.min(end, Number(c?.end)) }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end - c.start >= minLen)
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const c of list) {
    const last = out[out.length - 1];
    if (last && c.start <= last.end + 0.02) last.end = Math.max(last.end, c.end);
    else out.push({ ...c });
  }
  return out.map((c) => ({ start: r3(c.start), end: r3(c.end) }));
}

// The kept segments of a cut, in the original's time.
export function keptSegments({ start = 0, end, cuts = [] }) {
  const segs = [];
  let at = start;
  for (const c of normaliseCuts(cuts, start, end)) {
    if (c.start - at > 0.001) segs.push({ start: at, end: c.start });
    at = Math.max(at, c.end);
  }
  if (end - at > 0.001) segs.push({ start: at, end });
  return segs;
}

export const keptLength = (segs) => r3(segs.reduce((n, s) => n + (s.end - s.start), 0));

// Original time → local time. A removed range collapses to one point in the
// working copy, so a time inside it lands on that point; `kept` says whether
// the moment itself survives the cut.
export function localOf(segs, t) {
  let acc = 0;
  for (const s of segs) {
    if (t < s.start - 0.0005) return { t: r3(acc), kept: false };
    if (t <= s.end + 0.0005) return { t: r3(acc + Math.min(Math.max(t, s.start), s.end) - s.start), kept: true };
    acc += s.end - s.start;
  }
  return { t: r3(acc), kept: false };
}

// Local time → original time. At a junction between two segments, `prefer`
// says which side: "next" (where something starts) or "prev" (where it ends).
export function sourceOf(segs, t, prefer = "next") {
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const len = s.end - s.start;
    const atEnd = Math.abs(t - (acc + len)) < 0.0005;
    if (t < acc + len - 0.0005 || (atEnd && (prefer === "prev" || i === segs.length - 1))) {
      return r3(s.start + Math.max(0, t - acc));
    }
    acc += len;
  }
  return segs.length ? segs[segs.length - 1].end : 0;
}

// ------------------------------------------------------------ the text view

const FILLERS = new Set(["euh", "heu", "euhm", "hum", "hmm", "mmh", "bah", "ben", "beh", "hein"]);
const bare = (w) => w.toLowerCase().replace(/[^\p{L}]/gu, "");
export const isFiller = (w) => FILLERS.has(bare(w));

// How much of [a, b] someone was speaking.
function speechWithin(speech, a, b) {
  let n = 0;
  for (const s of speech || []) n += Math.max(0, Math.min(b, s.end) - Math.max(a, s.start));
  return n;
}

// The transcript as a row of tokens for the editor: words, and between them
// the gaps worth showing — "pause" (silence) or "hesitation" (voice heard,
// no word transcribed). Each token knows the range removing it would cut:
// a word takes half of the gap on each side, so the words left around it end
// up one natural gap apart.
export function tokens(transcript, { minGap = 0.3 } = {}) {
  const words = transcript?.words || [];
  const speech = transcript?.speech || [];
  const duration = transcript?.duration ?? (words.length ? words[words.length - 1].e : 0);
  const out = [];
  const mid = (a, b) => (a + b) / 2;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    const next = words[i + 1];
    const gapStart = prev ? prev.e : 0;
    if (w.s - gapStart >= minGap) {
      const voiced = speechWithin(speech, gapStart, w.s);
      out.push({
        // Mostly voiced, yet no word: a hesitation (or a word Whisper missed).
        kind: speech.length && voiced >= Math.max(0.25, (w.s - gapStart) * 0.6) ? "hesitation" : "pause",
        start: r3(gapStart), end: r3(w.s), length: r3(w.s - gapStart),
      });
    }
    out.push({
      kind: "word", i, w: w.w, s: w.s, e: w.e, filler: isFiller(w.w),
      start: r3(prev ? mid(prev.e, w.s) : Math.max(0, w.s - 0.08)),
      end: r3(next ? mid(w.e, next.s) : Math.min(duration, w.e + 0.08)),
    });
  }
  const last = words[words.length - 1];
  if (last && duration - last.e >= minGap) {
    out.push({ kind: "pause", start: r3(last.e), end: r3(duration), length: r3(duration - last.e) });
  }
  return out;
}

// The part of a gap to remove so that `keep` seconds of it are left, shared
// between both sides. Null when the gap is already short enough.
export function gapCut(gap, keep = 0.25) {
  if (gap.end - gap.start <= keep + 0.05) return null;
  return { start: r3(gap.start + keep / 2), end: r3(gap.end - keep / 2) };
}

// One click: shorten every pause longer than maxPause, remove filler words,
// and — only if asked — the hesitations. They are off by default: a
// "hesitation" can also be a real word Whisper did not write (an acronym,
// a name), and cutting it would cut the sentence.
export function autoCuts(transcript, { maxPause = 0.6, keep = 0.25, hesitations = false, fillers = true } = {}) {
  const cuts = [];
  for (const t of tokens(transcript)) {
    if (t.kind === "pause" && t.length > maxPause) {
      const c = gapCut(t, keep);
      if (c) cuts.push(c);
    } else if (t.kind === "hesitation" && hesitations) {
      const c = gapCut(t, keep);
      if (c) cuts.push(c);
    } else if (t.kind === "word" && t.filler && fillers) {
      cuts.push({ start: t.start, end: t.end });
    }
  }
  return cuts;
}

// Whether a token is removed by the cuts (most of it inside them).
export function isCut(cuts, a, b) {
  let n = 0;
  for (const c of cuts) n += Math.max(0, Math.min(b, c.end) - Math.max(a, c.start));
  return n >= (b - a) * 0.5;
}

// Cuts with [a, b] removed from them (putting a token back).
export function restore(cuts, a, b) {
  const out = [];
  for (const c of cuts) {
    if (c.end <= a || c.start >= b) { out.push(c); continue; }
    if (c.start < a) out.push({ start: c.start, end: a });
    if (c.end > b) out.push({ start: b, end: c.end });
  }
  return out;
}

// ------------------------------------------------------------ cut edges

// Move each cut edge to the quietest moment within ±window seconds, so a
// rough word timing does not clip the end of a syllable. `energy` is a level
// per `hop` seconds (any scale, higher = louder).
export function settleCuts(cuts, energy, hop = 0.01, window = 0.1) {
  if (!energy || !energy.length) return cuts;
  const quietest = (t) => {
    const from = Math.max(0, Math.round((t - window) / hop));
    const to = Math.min(energy.length - 1, Math.round((t + window) / hop));
    let best = Math.round(t / hop);
    let bestLevel = Infinity;
    for (let i = from; i <= to; i++) {
      // Ties go to the point closest to the asked-for edge.
      const level = energy[i] + Math.abs(i * hop - t) * 1e-3;
      if (level < bestLevel) { bestLevel = level; best = i; }
    }
    return r3(best * hop);
  };
  return cuts
    .map((c) => ({ start: quietest(c.start), end: quietest(c.end) }))
    .filter((c) => c.end - c.start >= 0.04);
}

// ------------------------------------------------------------ Whisper output

// Things Whisper writes when it hears music or noise and nobody talks.
const HALLUCINATIONS = [
  /sous-titr/i, /amara\.org/i, /radio-canada/i, /merci d'avoir regard/i,
  /abonnez-vous/i, /thanks? for watching/i, /^\s*\[?musique\]?\s*$/i,
];

// `whisper-cli -ml 1 -sow -ojf -dtw …` output (one segment per word) → words.
//
// Whisper's own word times are rough (they can be a second late after a
// hesitation it chose not to write). The DTW times of the tokens are much
// closer: each marks where a token is heard. A word is placed around its
// tokens, given a length that grows with its letters, and kept from
// overlapping its neighbours. Punctuation that comes as its own segment is
// glued to the word before; it never counts for timing.
export function parseWhisperWords(json) {
  const words = [];
  const isPunct = (t) => /^[\p{P}\s]+$/u.test(t);
  for (const seg of json?.transcription || []) {
    const text = String(seg.text || "").trim();
    if (!text) continue;
    if (isPunct(text)) {
      if (words.length) words[words.length - 1].w += text;
      continue;
    }
    const marks = (seg.tokens || [])
      .filter((t) => !String(t.text).startsWith("[_") && !isPunct(String(t.text).trim()) && t.t_dtw >= 0)
      .map((t) => t.t_dtw / 100);
    let s;
    let e;
    if (marks.length) {
      const letters = text.replace(/[^\p{L}\p{N}]/gu, "").length;
      const len = Math.max(0.12, Math.min(0.9, letters * 0.065));
      const c = (marks[0] + marks[marks.length - 1]) / 2;
      s = Math.min(marks[0], c - len / 2);
      e = Math.max(marks[marks.length - 1], c + len / 2);
    } else {
      s = (seg.offsets?.from ?? 0) / 1000;
      e = Math.max(s, (seg.offsets?.to ?? 0) / 1000);
    }
    words.push({ w: text, s: Math.max(0, s), e });
  }
  // Neighbours never overlap: meet halfway.
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1];
    const b = words[i];
    if (b.s < a.e) {
      const m = Math.max(a.s, Math.min(b.e, (a.e + b.s) / 2));
      a.e = m;
      b.s = m;
    }
  }
  return words.map((w) => ({ w: w.w, s: r3(w.s), e: r3(Math.max(w.s, w.e)) }));
}

// Drop what was "heard" outside any speech (Whisper's inventions on music)
// and known invented phrases.
export function fitToSpeech(words, speech, pad = 0.3) {
  let kept = words;
  if (speech && speech.length) {
    kept = words.filter((w) => {
      const m = (w.s + w.e) / 2;
      return speech.some((sp) => m >= sp.start - pad && m <= sp.end + pad);
    });
  }
  const sentence = kept.map((w) => w.w).join(" ");
  if (HALLUCINATIONS.some((re) => re.test(sentence)) && kept.length <= 8) return [];
  return kept;
}

// whisper-vad-speech-segments output → [{ start, end }] in seconds.
export function parseVad(text) {
  const out = [];
  const re = /start = ([\d.]+), end = ([\d.]+)/g;
  let m;
  // The tool prints centiseconds.
  while ((m = re.exec(String(text)))) out.push({ start: r3(Number(m[1]) / 100), end: r3(Number(m[2]) / 100) });
  return out;
}
