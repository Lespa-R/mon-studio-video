import { test } from "node:test";
import assert from "node:assert/strict";
import { groupWords, normaliseCues, parseSrt, toSrt, chunkPlan, spreadWords } from "../lib/captions.mjs";
import { parseSilences } from "../lib/media.mjs";
import { byType, defaultParams } from "../lib/effects.mjs";

const words = (text, start = 0, step = 0.3) =>
  text.split(" ").map((w, i) => ({ w, s: start + i * step, e: start + i * step + 0.25 }));

test("words become readable lines: short, cut at sentence ends and pauses", () => {
  const cues = groupWords([
    ...words("Bonjour à tous."),
    ...words("Aujourd'hui je vous montre un outil de montage vidéo très pratique", 1.2),
    ...words("Après une pause", 6),
  ]);
  assert.equal(cues[0].text, "Bonjour à tous.");
  for (const c of cues) assert.ok(c.text.length <= 38, c.text);
  assert.ok(cues.some((c) => c.text.startsWith("Après")), "a pause starts a new line");
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end, "no overlap");
});

test("editing a line keeps the heard timing when the text is unchanged", () => {
  const [cue] = groupWords(words("un deux trois"));
  const same = normaliseCues([{ ...cue }], [cue], 10);
  assert.deepEqual(same[0].words, cue.words);
  const moved = normaliseCues([{ ...cue, start: cue.start + 1, end: cue.end + 1 }], [cue], 10);
  assert.equal(moved[0].words[0].s, cue.words[0].s + 1);
  const edited = normaliseCues([{ ...cue, text: "un deux quatre cinq" }], [cue], 10);
  assert.equal(edited[0].words.length, 4);
  assert.equal(edited[0].words[3].e, edited[0].end);
});

test("lines are clamped to the clip, empty ones dropped, bad ids replaced", () => {
  const cues = normaliseCues([
    { id: "<script>", start: 8, end: 20, text: "fin" },
    { start: 1, end: 2, text: "   " },
  ], [], 10);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].end, 10);
  assert.match(cues[0].id, /^cue_[a-f0-9]{8}$/);
});

test("SRT goes out and comes back", () => {
  const cues = groupWords(words("Bonjour à tous. Voici la suite du texte", 61.5));
  const srt = toSrt(cues);
  assert.match(srt, /^1\n00:01:01,500 --> /);
  const back = parseSrt(srt);
  assert.deepEqual(back.map((c) => [c.start, c.end, c.text]), cues.map((c) => [c.start, c.end, c.text]));
});

test("WebVTT with tags and a BOM imports too", () => {
  const vtt = "﻿WEBVTT\n\n00:00:01.000 --> 00:00:02.500\n<i>Salut</i> le monde\n\nnote\n\n00:00:03.000 --> 00:00:04.000\nFin";
  const cues = parseSrt(vtt);
  assert.deepEqual(cues.map((c) => c.text), ["Salut le monde", "Fin"]);
  assert.equal(cues[0].end, 2.5);
});

test("long audio is cut at pauses, never past the recogniser's limit", () => {
  const plan = chunkPlan(130, [{ start: 44, end: 45 }, { start: 92, end: 93 }]);
  assert.deepEqual(plan.map((p) => [p.start, p.end]), [[0, 44.5], [44.5, 92.5], [92.5, 130]]);
  const blind = chunkPlan(120, []);
  for (const p of blind) assert.ok(p.end - p.start <= 55);
  assert.deepEqual(chunkPlan(30, []), [{ start: 0, end: 30 }]);
});

test("ffmpeg's silence log is read", () => {
  const log = "[silencedetect @ 0x1] silence_start: 3.2\n[silencedetect @ 0x1] silence_end: 4.1 | silence_duration: 0.9\n";
  assert.deepEqual(parseSilences(log), [{ start: 3.2, end: 4.1 }]);
});

test("words spread across a line in proportion to their length", () => {
  const w = spreadWords("a longword", 0, 1);
  assert.ok(w[1].e - w[1].s > w[0].e - w[0].s);
  assert.equal(w[1].e, 1);
});

// ------------------------------------------------------------- the effect

const canvas = (cues) => ({ width: 1080, height: 1920, duration: 6, captions: cues ? { cues } : null });

test("the subtitles effect draws nothing without lines", () => {
  assert.equal(byType("captions").build({ id: "fx_cc", params: defaultParams("captions") }, canvas(null)), null);
});

test("each line shows at its time; karaoke lights every word; pop groups words", () => {
  const cues = groupWords(words("Bonjour à tous et bienvenue"));
  const fx = (style) => ({ id: "fx_cc", params: { ...defaultParams("captions"), style } });
  const box = byType("captions").build(fx("box"), canvas(cues));
  assert.equal((box.html.match(/class="fx_cc-c"/g) || []).length, cues.length);
  assert.match(box.timeline, new RegExp(`"#fx_cc-c0", \\{ opacity: 0 \\}.*${cues[0].start}\\);`));
  const karaoke = byType("captions").build(fx("karaoke"), canvas(cues));
  assert.equal((karaoke.html.match(/class="fx_cc-h"/g) || []).length, 5);
  const pop = byType("captions").build({ ...fx("pop"), params: { ...fx("pop").params, per: 2 } }, canvas(cues));
  assert.equal((pop.html.match(/class="fx_cc-c"/g) || []).length, 3);
});

test("subtitle text never injects markup", () => {
  const built = byType("captions").build(
    { id: "fx_cc", params: defaultParams("captions") },
    canvas([{ start: 0, end: 1, text: "<img src=x>", words: [{ w: "<img", s: 0, e: 0.5 }, { w: "src=x>", s: 0.5, e: 1 }] }]));
  assert.doesNotMatch(built.html, /<img/);
});
