import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseCuts, keptSegments, keptLength, localOf, sourceOf, tokens, gapCut, autoCuts,
  isCut, restore, settleCuts, parseWhisperWords, fitToSpeech, parseVad,
} from "../lib/textcut.mjs";
import { shiftForTrim } from "../lib/trim.mjs";
import { joinFilter } from "../lib/media.mjs";
import { classify } from "../lib/storage.mjs";

test("removed passages are sorted, merged and kept inside the trim", () => {
  assert.deepEqual(
    normaliseCuts([{ start: 5, end: 6 }, { start: 1, end: 2 }, { start: 1.9, end: 2.5 }, { start: -1, end: 0.5 }, { start: 8, end: 8.01 }], 0, 10),
    [{ start: 0, end: 0.5 }, { start: 1, end: 2.5 }, { start: 5, end: 6 }],
  );
});

test("kept segments and the time map between the original and the edit", () => {
  const segs = keptSegments({ start: 1, end: 10, cuts: [{ start: 3, end: 4 }, { start: 6, end: 8 }] });
  assert.deepEqual(segs, [{ start: 1, end: 3 }, { start: 4, end: 6 }, { start: 8, end: 10 }]);
  assert.equal(keptLength(segs), 6);
  assert.deepEqual(localOf(segs, 2), { t: 1, kept: true });
  assert.deepEqual(localOf(segs, 3.5), { t: 2, kept: false }); // collapses onto the join
  assert.deepEqual(localOf(segs, 9), { t: 5, kept: true });
  assert.deepEqual(localOf(segs, 0.5), { t: 0, kept: false });
  assert.equal(sourceOf(segs, 1), 2);
  assert.equal(sourceOf(segs, 2, "next"), 4);
  assert.equal(sourceOf(segs, 2, "prev"), 3);
  assert.equal(sourceOf(segs, 6), 10);
});

const transcript = {
  duration: 10,
  // "Bonjour [1 s silence] à [1.4 s voiced, no word] tous euh voilà"
  words: [
    { w: "Bonjour", s: 0.5, e: 1.0 }, { w: "à", s: 2.0, e: 2.2 },
    { w: "tous", s: 3.6, e: 4.0 }, { w: "euh", s: 4.1, e: 4.5 }, { w: "voilà.", s: 4.6, e: 5.0 },
  ],
  speech: [{ start: 0.4, end: 1.1 }, { start: 1.9, end: 5.1 }],
};

test("the text view tells silences from hesitations, and flags filler words", () => {
  const t = tokens(transcript);
  const gaps = t.filter((x) => x.kind !== "word").map((x) => [x.kind, x.start, x.end]);
  assert.deepEqual(gaps, [["pause", 0, 0.5], ["pause", 1, 2], ["hesitation", 2.2, 3.6], ["pause", 5, 10]]);
  assert.equal(t.find((x) => x.w === "euh").filler, true);
  // A word takes half of the gap on each side.
  const tous = t.find((x) => x.w === "tous");
  assert.deepEqual([tous.start, tous.end], [2.9, 4.05]);
});

test("automatic cleanup shortens silences and removes fillers, not hesitations unless asked", () => {
  const cuts = autoCuts(transcript, { maxPause: 0.6, keep: 0.25 });
  assert.deepEqual(cuts, [{ start: 1.125, end: 1.875 }, { start: 4.05, end: 4.55 }, { start: 5.125, end: 9.875 }]);
  const withHes = autoCuts(transcript, { maxPause: 0.6, keep: 0.25, hesitations: true });
  assert.ok(withHes.some((c) => c.start === 2.325 && c.end === 3.475));
  assert.equal(gapCut({ start: 1, end: 1.2 }, 0.25), null);
});

test("a removed token can be put back", () => {
  const cuts = [{ start: 1, end: 5 }];
  assert.equal(isCut(cuts, 2, 3), true);
  assert.deepEqual(restore(cuts, 2, 3), [{ start: 1, end: 2 }, { start: 3, end: 5 }]);
  assert.equal(isCut(restore(cuts, 2, 3), 2, 3), false);
});

test("cut edges settle on the quietest moment nearby", () => {
  const energy = new Uint8Array(100).fill(80);
  energy[23] = 5; // quiet at 0.23 s
  energy[61] = 3; // quiet at 0.61 s
  assert.deepEqual(settleCuts([{ start: 0.2, end: 0.65 }], energy, 0.01, 0.1), [{ start: 0.23, end: 0.61 }]);
});

test("Whisper words are placed on their DTW token times, punctuation glued, no overlaps", () => {
  const json = {
    transcription: [
      { text: "", offsets: { from: 0, to: 0 }, tokens: [] },
      { text: " et", offsets: { from: 4640, to: 4990 }, tokens: [{ text: " et", t_dtw: 498 }] },
      { text: " des", offsets: { from: 4990, to: 5520 }, tokens: [{ text: " des", t_dtw: 740 }] },
      { text: " petites", offsets: { from: 5520, to: 6750 }, tokens: [{ text: " petites", t_dtw: 762 }] },
      { text: " !", offsets: { from: 6750, to: 6750 }, tokens: [{ text: " !", t_dtw: 790 }] },
    ],
  };
  const words = parseWhisperWords(json);
  assert.deepEqual(words.map((w) => w.w), ["et", "des", "petites!"]);
  const [et, des, petites] = words;
  // The gap Whisper's own times hid (5.0 → 7.3 s) shows up.
  assert.ok(et.e < 5.2 && des.s > 7.2, JSON.stringify(words));
  assert.ok(des.e <= petites.s);
});

test("words heard outside any speech, and known inventions, are dropped", () => {
  const words = [{ w: "Bonjour", s: 1, e: 1.4 }, { w: "fantôme", s: 6, e: 6.5 }];
  assert.deepEqual(fitToSpeech(words, [{ start: 0.9, end: 1.6 }]).map((w) => w.w), ["Bonjour"]);
  const invented = [{ w: "Sous-titrage", s: 0, e: 3 }, { w: "Société", s: 3, e: 5 }, { w: "Radio-Canada", s: 5, e: 8 }];
  assert.deepEqual(fitToSpeech(invented, []), []);
});

test("VAD output is read in seconds", () => {
  assert.deepEqual(parseVad("Speech segment 0: start = 93.00, end = 409.00\nSpeech segment 1: start = 439.00, end = 838.00"),
    [{ start: 0.93, end: 4.09 }, { start: 4.39, end: 8.38 }]);
});

const fx = (start, duration) => ({ id: "fx", type: "title", start, duration, params: {} });

test("removing passages moves effects and drops removed words from the subtitles", () => {
  const whole = { start: 0, end: 10, cuts: [] };
  const edit = { start: 0, end: 10, cuts: [{ start: 2, end: 4 }] };
  const cues = [{
    id: "cue_00000001", start: 1, end: 5, text: "un deux trois",
    words: [{ w: "un", s: 1, e: 1.5 }, { w: "deux", s: 2.5, e: 3 }, { w: "trois", s: 4.5, e: 5 }],
  }];
  const r = shiftForTrim({ effects: [fx(6, 1), fx(3, 0.5)], captions: { lang: "fr-FR", cues } }, whole, edit);
  assert.equal(r.length, 8);
  assert.deepEqual([r.effects[0].start, r.effects[0].duration], [4, 1]);
  // Inside the removed passage: pulled to the join, remembers its place.
  assert.equal(r.effects[1].start, 2);
  assert.ok(r.effects[1].trimmedFrom);
  const cue = r.captions.cues[0];
  assert.equal(cue.text, "un trois");
  assert.deepEqual(cue.words.map((w) => [w.w, w.s, w.e]), [["un", 1, 1.5], ["trois", 2.5, 3]]);

  // Putting the passage back restores the line and the effect.
  const back = shiftForTrim({ effects: r.effects, captions: r.captions }, edit, whole);
  assert.equal(back.captions.cues[0].text, "un deux trois");
  assert.deepEqual(back.captions.cues[0].words.map((w) => w.s), [1, 2.5, 4.5]);
  assert.deepEqual([back.effects[1].start, back.effects[1].duration], [3, 0.5]);
});

test("a line whose every word is removed is set aside, then restored", () => {
  const whole = { start: 0, end: 10, cuts: [] };
  const edit = { start: 0, end: 10, cuts: [{ start: 2, end: 4 }] };
  const cues = [{ id: "cue_00000001", start: 2.2, end: 3.5, text: "coupé", words: [{ w: "coupé", s: 2.2, e: 3.5 }] }];
  const r = shiftForTrim({ effects: [], captions: { lang: "fr-FR", cues } }, whole, edit);
  assert.equal(r.captions.cues.length, 0);
  assert.equal(r.dropped, 1);
  const back = shiftForTrim({ effects: [], captions: r.captions }, edit, whole);
  assert.deepEqual(back.captions.cues.map((c) => [c.text, c.start]), [["coupé", 2.2]]);
});

test("the ffmpeg join filter has one trimmed piece per segment, with short fades", () => {
  const f = joinFilter([{ start: 0, end: 1 }, { start: 2, end: 3.5 }], true);
  assert.match(f, /\[0:v\]trim=start=2\.000:end=3\.500,setpts=PTS-STARTPTS\[v1\]/);
  assert.match(f, /afade=t=out:st=1\.490:d=0\.01\[a1\]/);
  assert.match(f, /\[v0\]\[a0\]\[v1\]\[a1\]concat=n=2:v=1:a=1\[v\]\[a\]$/);
  assert.match(joinFilter([{ start: 0, end: 1 }, { start: 2, end: 3 }], false), /concat=n=2:v=1:a=0\[v\]$/);
});

test("the storage page knows transcripts, and lets them go", () => {
  const state = { projects: [{ id: "p", name: "P", videos: [{ id: "vid_1", name: "c", ext: ".mp4" }] }] };
  const { items } = classify({ media: [{ name: "vid_1-transcript.json", size: 10, mtime: 0 }] }, state);
  assert.equal(items[0].kind, "transcript");
  assert.equal(items[0].deletable, true);
});
