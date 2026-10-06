import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseTrim, shiftForTrim } from "../lib/trim.mjs";

test("a trim stays inside the original and at least half a second long", () => {
  assert.deepEqual(normaliseTrim({ start: -3, end: 99 }, 10), { start: 0, end: 10 });
  assert.deepEqual(normaliseTrim({ start: 9.9, end: 9.95 }, 10), { start: 9.5, end: 10 });
  assert.deepEqual(normaliseTrim({ start: 2, end: 2.1 }, 10), { start: 2, end: 2.5 });
});

const clip = (effects, cues = []) => ({ effects, captions: cues.length ? { lang: "fr-FR", cues } : null });
const fx = (start, duration) => ({ id: "fx", type: "title", start, duration, params: {} });

test("cutting the start moves every effect earlier by the same amount", () => {
  const r = shiftForTrim(clip([fx(3, 2), fx(1.5, null)]), { start: 0, end: 10 }, { start: 1, end: 10 });
  assert.deepEqual(r.effects.map((e) => [e.start, e.duration]), [[2, 2], [0.5, null]]);
  assert.equal(r.clamped, 0);
  assert.equal(r.length, 9);
});

test("an effect in the part cut off is brought back to the edge, not lost", () => {
  const r = shiftForTrim(clip([fx(0.2, 0.5), fx(8, 1.5)]), { start: 0, end: 10 }, { start: 1, end: 8.5 });
  assert.equal(r.effects.length, 2);
  assert.deepEqual([r.effects[0].start, r.effects[0].duration], [0, 0.1]);
  assert.ok(r.effects[1].start + r.effects[1].duration <= 7.5 + 1e-9);
  assert.equal(r.clamped, 2);
});

test("widening a trim again moves effects later", () => {
  const r = shiftForTrim(clip([fx(0, 1)]), { start: 2, end: 6 }, { start: 0, end: 10 });
  assert.deepEqual([r.effects[0].start, r.effects[0].duration], [2, 1]);
});

test("subtitles move with the cut; lines wholly cut off are dropped", () => {
  const cues = [
    { id: "cue_00000001", start: 0.2, end: 0.8, text: "coupé", words: [{ w: "coupé", s: 0.2, e: 0.8 }] },
    { id: "cue_00000002", start: 1.5, end: 2.5, text: "gardé mot", words: [{ w: "gardé", s: 1.5, e: 2 }, { w: "mot", s: 2, e: 2.5 }] },
  ];
  const r = shiftForTrim(clip([], cues), { start: 0, end: 5 }, { start: 1, end: 5 });
  assert.equal(r.dropped, 1);
  assert.deepEqual(r.captions.cues.map((c) => [c.text, c.start, c.end]), [["gardé mot", 0.5, 1.5]]);
  assert.deepEqual(r.captions.cues[0].words.map((w) => w.s), [0.5, 1]);
});

test("an effect over the whole clip stays over the whole clip", () => {
  const r = shiftForTrim(clip([fx(0, null)]), { start: 0, end: 10 }, { start: 2, end: 6 });
  assert.deepEqual([r.effects[0].start, r.effects[0].duration], [0, null]);
});

test("cutting then widening again puts effects and lines back where they were", () => {
  const cues = [
    { id: "cue_00000001", start: 0.2, end: 0.8, text: "début", words: [{ w: "début", s: 0.2, e: 0.8 }] },
    { id: "cue_00000002", start: 0.9, end: 2.1, text: "à cheval", words: [{ w: "à", s: 0.9, e: 1.2 }, { w: "cheval", s: 1.2, e: 2.1 }] },
  ];
  const whole = { start: 0, end: 5 };
  const cut = { start: 1.5, end: 5 };
  const a = shiftForTrim(clip([fx(0.3, 0.5)], cues), whole, cut);
  assert.equal(a.captions.cues.length, 1);
  assert.equal(a.captions.cues[0].start, 0);
  const b = shiftForTrim({ effects: a.effects, captions: a.captions }, cut, whole);
  assert.deepEqual([b.effects[0].start, b.effects[0].duration], [0.3, 0.5]);
  assert.equal(b.effects[0].trimmedFrom, undefined);
  assert.deepEqual(b.captions.cues.map((c) => [c.text, c.start, c.end]), [["début", 0.2, 0.8], ["à cheval", 0.9, 2.1]]);
  assert.deepEqual(b.captions.cues[1].words.map((w) => w.s), [0.9, 1.2]);
});

test("an effect moved by hand after a trim is not snapped back", () => {
  const a = shiftForTrim(clip([fx(0.3, 0.5)]), { start: 0, end: 5 }, { start: 1.5, end: 5 });
  const moved = { ...a.effects[0], start: 1 };
  const b = shiftForTrim(clip([moved]), { start: 1.5, end: 5 }, { start: 0, end: 5 });
  assert.equal(b.effects[0].start, 2.5);
});

test("the moments an effect was pinned or clicked at move with the cut", () => {
  const effect = {
    id: "fx", type: "route", start: 0, duration: null,
    params: { pinAt: 4, pinAt0: 2, pinAt1: null, object: { t: 1.5, points: [{ x: 0.5, y: 0.5, l: 1 }], level: 2 } },
  };
  const r = shiftForTrim(clip([effect]), { start: 0, end: 10 }, { start: 1, end: 10 });
  assert.equal(r.effects[0].params.pinAt, 3);
  assert.equal(r.effects[0].params.pinAt0, 1);
  assert.equal(r.effects[0].params.pinAt1, null, "not set stays not set");
  assert.equal(r.effects[0].params.object.t, 0.5);
  // The frame the object was clicked on is cut away: it must be chosen again.
  const gone = shiftForTrim(clip([effect]), { start: 0, end: 10 }, { start: 2, end: 10 });
  assert.equal(gone.effects[0].params.object, null);
  assert.equal(gone.effects[0].params.pinAt0, 0);
});
