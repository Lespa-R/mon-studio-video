// Subtitles: timed words → editable lines ("cues"), SRT in and out.
//
// A clip's captions are stored on it:
//
//   video.captions = {
//     lang: "fr-FR",
//     source: "apple" | "srt" | "manual",
//     cues: [{ id, start, end, text, words: [{ w, s, e }] }],
//   }
//
// `words` carry the timing of each word (karaoke highlight, word-by-word
// styles). They come from the transcriber; when a line's text is edited by
// hand they are re-timed across the line, so every style keeps working.
//
// Pure functions only.

import crypto from "node:crypto";

const r3 = (n) => Math.round(n * 1000) / 1000;
const newCueId = () => `cue_${crypto.randomBytes(4).toString("hex")}`;

export const LANGUAGES = [
  { value: "fr-FR", label: "Français" },
  { value: "en-US", label: "Anglais (US)" },
  { value: "en-GB", label: "Anglais (UK)" },
  { value: "es-ES", label: "Espagnol" },
  { value: "de-DE", label: "Allemand" },
  { value: "it-IT", label: "Italien" },
  { value: "pt-PT", label: "Portugais" },
];

// ------------------------------------------------------------ grouping

// Words → lines a viewer can read: at most `maxChars` characters, cut at a
// sentence end or at a pause, never longer than `maxDuration` seconds.
export function groupWords(words, { maxChars = 38, maxDuration = 3.2, pause = 0.55 } = {}) {
  const cues = [];
  let line = [];
  const flush = () => {
    if (!line.length) return;
    cues.push({
      id: newCueId(),
      start: line[0].s,
      end: line[line.length - 1].e,
      text: line.map((w) => w.w).join(" "),
      words: line,
    });
    line = [];
  };

  for (const word of words) {
    if (!word || !String(word.w).trim()) continue;
    const w = { w: String(word.w).trim(), s: r3(Number(word.s) || 0), e: r3(Math.max(Number(word.e) || 0, Number(word.s) || 0)) };
    if (line.length) {
      const last = line[line.length - 1];
      const length = line.map((x) => x.w).join(" ").length + 1 + w.w.length;
      const tooLong = length > maxChars;
      const tooSlow = w.e - line[0].s > maxDuration;
      const paused = w.s - last.e > pause;
      // A sentence end closes the line, unless it would leave a lone word.
      const sentence = /[.!?…]$/.test(last.w) && line.length > 1;
      if (tooLong || tooSlow || paused || sentence) flush();
    }
    line.push(w);
  }
  flush();
  return fixOverlaps(cues);
}

// Lines never overlap, and each stays on screen long enough to read.
function fixOverlaps(cues) {
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const next = cues[i + 1];
    const minEnd = cue.start + 0.5;
    if (cue.end < minEnd) cue.end = next ? Math.min(minEnd, next.start) : minEnd;
    if (next && cue.end > next.start) cue.end = next.start;
    cue.start = r3(cue.start);
    cue.end = r3(Math.max(cue.end, cue.start + 0.05));
  }
  return cues;
}

// ------------------------------------------------------------- editing

// Spread a line's words across its window, in proportion to their length —
// the best guess once the text no longer matches what was heard.
export function spreadWords(text, start, end) {
  const tokens = String(text).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const weights = tokens.map((t) => t.length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  let at = start;
  return tokens.map((w, i) => {
    const d = ((end - start) * weights[i]) / total;
    const word = { w, s: r3(at), e: r3(at + d) };
    at += d;
    return word;
  });
}

// The words of a cue whose window moved: same words, stretched to fit.
function rescale(words, from, to) {
  const span = from.end - from.start || 1;
  const k = (to.end - to.start) / span;
  return words.map((w) => ({
    w: w.w,
    s: r3(to.start + (w.s - from.start) * k),
    e: r3(to.start + (w.e - from.start) * k),
  }));
}

// Validate cues coming from the editor, keeping the timed words wherever the
// text did not change. `previous` is what was stored before this edit.
export function normaliseCues(incoming, previous = [], duration = Infinity) {
  const before = new Map(previous.map((c) => [c.id, c]));
  const out = [];
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const text = String(raw?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    let start = Math.max(0, Number(raw?.start) || 0);
    let end = Number(raw?.end);
    if (!Number.isFinite(end) || end <= start) end = start + 1;
    start = Math.min(start, Math.max(0, duration - 0.05));
    end = Math.min(end, duration);
    if (!text) continue;

    const id = typeof raw?.id === "string" && /^cue_[a-f0-9]{8}$/.test(raw.id) ? raw.id : newCueId();
    const old = before.get(id);
    let words;
    // A line cut by a trim remembers its whole self while its text is
    // unchanged (see lib/trim.mjs).
    const full = old && old.full && old.text === text && old.start === start && old.end === end ? old.full : null;
    if (old && old.text === text && Array.isArray(old.words) && old.words.length) {
      words = old.start === start && old.end === end
        ? old.words
        : rescale(old.words, old, { start, end });
    } else {
      words = spreadWords(text, start, end);
    }
    out.push({ id, start: r3(start), end: r3(end), text, words, ...(full ? { full } : {}) });
  }
  return fixOverlaps(out);
}

// ---------------------------------------------------------------- SRT

const pad = (n, w = 2) => String(n).padStart(w, "0");
function srtTime(t) {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

export function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
const seconds = (m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;

// SRT (and WebVTT, which differs mostly by its header and a dot in the times).
export function parseSrt(text) {
  const blocks = String(text).replace(/\r/g, "").replace(/^﻿/, "").split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [a, b] = lines[at].split("-->");
    const ma = TIME.exec(a);
    const mb = TIME.exec(b);
    if (!ma || !mb) continue;
    const body = lines.slice(at + 1).join(" ").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (!body) continue;
    const start = seconds(ma);
    const end = Math.max(seconds(mb), start + 0.1);
    cues.push({ id: newCueId(), start: r3(start), end: r3(end), text: body, words: spreadWords(body, start, end) });
  }
  return fixOverlaps(cues);
}

// ------------------------------------------------------------ chunking

// Long audio is transcribed in pieces cut at pauses, so no word is split and
// the recogniser never gets an overly long file. `silences` are
// [{ start, end }] from ffmpeg's silencedetect.
export function chunkPlan(duration, silences, target = 45, hardMax = 55) {
  const cuts = [];
  let from = 0;
  while (duration - from > hardMax) {
    const candidates = silences
      .map((s) => (s.start + s.end) / 2)
      .filter((mid) => mid > from + 10 && mid <= from + hardMax);
    const cut = candidates.length
      ? candidates.reduce((best, mid) => (Math.abs(mid - (from + target)) < Math.abs(best - (from + target)) ? mid : best))
      : from + target;
    cuts.push(r3(cut));
    from = cut;
  }
  const edges = [0, ...cuts, duration];
  return edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1] }));
}
