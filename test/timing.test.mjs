import { test } from "node:test";
import assert from "node:assert/strict";
import { timingOf, overlayTimeline } from "../lib/timing.mjs";

const clip = { duration: 3 };

test("no placement means the whole clip", () => {
  assert.deepEqual(timingOf({}, clip), { start: 0, duration: 3, end: 3, full: true });
});

test("duration null runs to the end of the clip", () => {
  const t = timingOf({ start: 1, duration: null }, clip);
  assert.equal(t.end, 3);
  assert.equal(t.duration, 2);
  assert.equal(t.full, false);
});

test("a window past the end is trimmed to the clip", () => {
  assert.equal(timingOf({ start: 2, duration: 10 }, clip).end, 3);
});

test("a start past the end still leaves a visible window", () => {
  const t = timingOf({ start: 99, duration: 1 }, clip);
  assert.ok(t.start < 3);
  assert.ok(t.duration >= 0.1);
});

test("negative and garbage values fall back to sane numbers", () => {
  assert.equal(timingOf({ start: -5 }, clip).start, 0);
  assert.equal(timingOf({ start: "abc" }, clip).start, 0);
});

test("a full-clip overlay does not ramp in and out", () => {
  const calls = overlayTimeline("#x", timingOf({}, clip), 1);
  assert.match(calls, /duration: 0\.001/);
});
