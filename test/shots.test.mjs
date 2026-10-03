import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseShots, shotName } from "../lib/shots.mjs";

test("shots are put in order, kept inside the clip, never overlapping", () => {
  assert.deepEqual(
    normaliseShots([{ start: 4, end: 9 }, { start: -1, end: 4.2 }, { start: 9, end: 20 }], 16.5),
    [{ start: 0, end: 4.2 }, { start: 4.2, end: 9 }, { start: 9, end: 16.5 }],
  );
});

test("a shot too short to be useful joins its neighbour", () => {
  assert.deepEqual(
    normaliseShots([{ start: 0, end: 3 }, { start: 3, end: 3.1 }, { start: 3.1, end: 6 }], 6),
    [{ start: 0, end: 3.1 }, { start: 3.1, end: 6 }],
  );
  assert.deepEqual(normaliseShots([{ start: 0, end: 0.1 }, { start: 0.1, end: 5 }], 5), [{ start: 0, end: 5 }]);
});

test("garbage in, nothing out", () => {
  assert.deepEqual(normaliseShots("nope", 5), []);
  assert.deepEqual(normaliseShots([{ start: "a", end: 2 }, { start: 3, end: 2 }], 5), []);
});

test("a shot clip is named after its rush", () => {
  assert.equal(shotName("DJI_0165_D.MP4", 3), "DJI_0165_D — plan 3");
  assert.equal(shotName("Ma vidéo", 1), "Ma vidéo — plan 1");
});
