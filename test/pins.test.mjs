import { test } from "node:test";
import assert from "node:assert/strict";
import { pinRequest, pinRange, pinKey, pinPath, simplifyPin, pinTimeline, PIN } from "../lib/pins.mjs";
import { steadySight } from "../lib/keyframes.mjs";
import { pinRequests } from "../lib/compose.mjs";
import { byType, defaultParams } from "../lib/effects.mjs";
import { classify } from "../lib/storage.mjs";

const fx = (type, params, extra = {}) => ({ id: "fx_1", type, start: 1, duration: 4, params: { ...defaultParams(type), ...params }, ...extra });

test("only pinned effects ask for the scenery to be followed", () => {
  const title = byType("title");
  assert.equal(pinRequest(fx("title", { position: "top" }), title, 10), null);
  assert.deepEqual(pinRequest(fx("title", { position: PIN, x: 40, y: 30, pinAt: 2 }), title, 10), { t: 2, x: 0.4, y: 0.3 });
  assert.equal(pinRequest(fx("title", { position: PIN }, { enabled: false }), title, 10), null);
  // The landmark caption is always pinned; without pinAt, at its start.
  assert.deepEqual(pinRequest(fx("scene-label", { x: 50, y: 45, pinAt: undefined }), byType("scene-label"), 10), { t: 1, x: 0.5, y: 0.45 });
});

test("the followed stretch covers the window and the pinning moment", () => {
  assert.deepEqual(pinRange({ t: 2 }, 1.2, 4.7, 10), { from: 1, to: 5 });
  assert.deepEqual(pinRange({ t: 7 }, 1.2, 4.7, 10), { from: 1, to: 7 });
  assert.deepEqual(pinRange({ t: 0.3 }, 1, 9.9, 9.95), { from: 0.3, to: 9.95 });
});

test("a track's key changes with the spot, the moment, the window and the file", () => {
  const v = { duration: 10, ext: ".mp4" };
  const k = pinKey({ t: 2, x: 0.4, y: 0.3 }, { from: 1, to: 5 }, v);
  assert.match(k, /^[a-f0-9]{8}$/);
  assert.equal(pinKey({ t: 2, x: 0.4, y: 0.3 }, { from: 1, to: 5 }, v), k);
  assert.notEqual(pinKey({ t: 2, x: 0.41, y: 0.3 }, { from: 1, to: 5 }, v), k);
  assert.notEqual(pinKey({ t: 2, x: 0.4, y: 0.3 }, { from: 1, to: 5 }, { ...v, duration: 9 }), k);
});

test("the clip lists one request per pinned effect, with its stretch", () => {
  const video = { duration: 10, effects: [
    fx("scene-label", { x: 40, y: 30, pinAt: 2 }),
    { ...fx("title", { position: "top" }), id: "fx_2" },
  ] };
  assert.deepEqual(pinRequests(video), [{ fxId: "fx_1", t: 2, x: 0.4, y: 0.3, from: 1, to: 5 }]);
});

const track = {
  start: 0, step: 0.5, ref: 2,
  x: [100, 110, 120, 140, 160, 160], y: [50, 50, 50, 55, 60, 60],
  s: [0.9, 0.95, 1, 1.05, 1.1, 1.1], r: [-2, -1, 0, 1, 2, 2], lost: [0, 0, 0, 0, 1, 1],
};

test("the path keeps what is followed and says when the spot is out of sight", () => {
  const moveOnly = pinPath(track, { from: 0.5, to: 2.2, follow: "move" });
  assert.deepEqual(moveOnly.map((p) => [p.t, p.x, p.s, p.r, p.seen]),
    [[0.5, 110, 1, 0, true], [1, 120, 1, 0, true], [1.5, 140, 1, 0, true], [2.2, 160, 1, 0, false]]);
  const full = pinPath(track, { from: 0, to: 2.5, follow: "full" });
  assert.deepEqual(full.map((p) => [p.s, p.r]), [[0.9, -2], [0.95, -1], [1, 0], [1.05, 1], [1.1, 2], [1.1, 2]]);
});

test("the spot flickering in and out of sight does not make the text blink", () => {
  const seq = [1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0];
  const path = seq.map((v, i) => ({ t: i * 0.1, x: 0, y: 0, s: 1, r: 0, seen: Boolean(v) }));
  assert.deepEqual(steadySight(path).map((p) => (p.seen ? 1 : 0)),
    [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("a straight stretch needs two keyframes; visibility changes are kept", () => {
  const line = Array.from({ length: 11 }, (_, i) => ({ t: i / 10, x: i * 10, y: 0, s: 1, r: 0, seen: i !== 6 }));
  const kept = simplifyPin(line);
  assert.deepEqual(kept.map((p) => p.t), [0, 0.5, 0.6, 0.7, 1]);
});

test("the timeline moves the mover from the spot and fades it out of sight", () => {
  const path = pinPath(track, { from: 0, to: 2.5, follow: "zoom" });
  const js = pinTimeline("#fx_1-mv", path, { x: 120, y: 50 });
  assert.match(js, /tl\.set\("#fx_1-mv", \{ x: -20, y: 0, scale: 0\.9, rotation: 0, opacity: 1 \}, 0\);/);
  assert.match(js, /tl\.to\("#fx_1-mv", \{ x: 40, y: 10, scale: 1\.1, rotation: 0, duration: [\d.]+, ease: "none" \}/);
  assert.match(js, /opacity: 0, duration: 0\.2/);
  assert.doesNotMatch(js, /NaN|undefined/);
});

test("pinned effects build: a mover around the spot, with its marker", () => {
  const video = { id: "vid_1", width: 1080, height: 1920, duration: 10, fps: 30, face: null, effects: [],
    pins: { fx_1: track } };
  for (const type of ["scene-label", "title", "behind-text"]) {
    const f = fx(type, { position: PIN, anchor: PIN, x: 50, y: 30, pinAt: 1 });
    const b = byType(type).build(f, video);
    assert.match(b.html, /id="fx_1-mv" data-layout-allow-overflow style="position: absolute; inset: 0; z-index: \d+; transform-origin: 540px \d+px"/, type);
    assert.match(b.html, /id="fx_1-anchor"/, type);
    assert.match(b.timeline, /tl\.set\("#fx_1-mv"/, type);
    // Not followed yet: it still builds, standing where it was put.
    const still = byType(type).build(f, { ...video, pins: {} });
    assert.doesNotMatch(still.timeline, /#fx_1-mv/, type);
  }
});

test("the storage page knows the scenery tracks, and lets them go", () => {
  const state = { projects: [{ id: "p", name: "P", videos: [{ id: "vid_1", name: "c", ext: ".mp4" }] }] };
  const { items } = classify({ media: [{ name: "vid_1-pin-0a1b2c3d.json", size: 10, mtime: 0 }] }, state);
  assert.equal(items[0].kind, "pin");
  assert.equal(items[0].deletable, true);
  const orphan = classify({ media: [{ name: "vid_9-pin-0a1b2c3d.json", size: 10, mtime: 0 }] }, state);
  assert.equal(orphan.items[0].kind, "orphan");
});
