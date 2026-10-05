import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseObject, cutoutChoice, CUTOUT_CHOICES } from "../lib/objects.mjs";

test("an object needs at least one 'this' click inside the frame", () => {
  assert.equal(normaliseObject(null, 5), null);
  assert.equal(normaliseObject({ t: 1, points: [{ x: 0.5, y: 0.5, l: 0 }] }, 5), null);
  assert.equal(normaliseObject({ t: 1, points: [{ x: 1.5, y: 0.5, l: 1 }] }, 5), null);
  assert.deepEqual(
    normaliseObject({ t: 9, points: [{ x: 0.41234, y: 0.6, l: 1 }, { x: 0.2, y: 0.2, l: false }, { x: "a", y: 1 }] }, 5),
    { t: 4.99, points: [{ x: 0.412, y: 0.6, l: 1 }, { x: 0.2, y: 0.2, l: 0 }], level: 2 },
  );
  assert.equal(normaliseObject({ t: 0, level: 1, points: [{ x: 0.5, y: 0.5 }] }, 5).level, 1);
  assert.equal(normaliseObject({ t: 0, level: 7, points: [{ x: 0.5, y: 0.5 }] }, 5).level, 2);
});

test("the menu entry follows the clip's cut-out options", () => {
  const obj = { t: 0, points: [{ x: 0.5, y: 0.5, l: 1 }] };
  assert.equal(cutoutChoice({ model: "person" }), "person");
  assert.equal(cutoutChoice({ model: "subject" }), "subject");
  assert.equal(cutoutChoice({ model: "none", object: obj }), "object");
  assert.equal(cutoutChoice({ model: "person", object: obj }), "person-object");
  assert.deepEqual(CUTOUT_CHOICES.map((c) => c.value), ["person", "subject", "object", "person-object"]);
});
