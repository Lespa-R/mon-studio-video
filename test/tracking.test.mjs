import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTracks, followPath, simplifyPath, pathTimeline } from "../lib/tracking.mjs";
import { byType, defaultParams } from "../lib/effects.mjs";
import { needsTracking } from "../lib/compose.mjs";

// Two people walking towards each other, one flicker, 3 s at 10 samples/s.
function scene() {
  const samples = [];
  for (let i = 0; i <= 30; i++) {
    const t = i / 10;
    const p = [
      [900 - i * 10, 200, 200, 480, 0.9],  // starts right, walks left (stays right of the other)
      [100 + i * 10, 220, 200, 460, 0.8],  // starts left, walks right
    ];
    if (i === 12) p.push([600, 50, 60, 60, 0.9]); // a one-frame false positive
    samples.push({ t, p, f: [] });
  }
  return { width: 1280, height: 720, duration: 3, samples };
}

test("detections become one track per person, numbered left to right", () => {
  const people = buildTracks(scene());
  assert.equal(people.tracks.length, 2, "the flicker is dropped");
  const [left, right] = people.tracks;
  assert.equal(left.id, "p1");
  assert.ok(left.cx[0] < right.cx[0]);
  // Each keeps its own identity while moving.
  assert.ok(left.cx[left.cx.length - 1] > left.cx[0], "p1 walks right");
  assert.ok(right.cx[right.cx.length - 1] < right.cx[0], "p2 walks left");
});

test("a face seen often enough steers the track: steadier than the body box", () => {
  const data = scene();
  for (const s of data.samples) s.f = [[s.p[1][0] + 70, s.p[1][1] + 20, 60, 60]];
  const people = buildTracks(data);
  const p1 = people.tracks[0];
  // Head top is above the face, not the top of the body box.
  assert.ok(Math.abs(p1.top[0] - (240 - 15)) < 3, `top ${p1.top[0]}`);
});

test("following one person, or the whole group", () => {
  const people = buildTracks(scene());
  const one = followPath(people, "1", { from: 0, to: 3, height: 0 });
  assert.ok(one[0].x < one[one.length - 1].x);
  const group = followPath(people, "all", { from: 0, to: 3, height: 1 });
  // The group's centre stays between them; its bottom is the lowest feet.
  assert.ok(Math.abs(group[0].x - 600) < 20, `${group[0].x}`);
  assert.ok(group[0].y >= 679);
  assert.equal(followPath(people, "5", { from: 0, to: 3 }), null);
  assert.equal(followPath(null, "1", { from: 0, to: 3 }), null);
});

test("a straight walk needs only its two ends as keyframes", () => {
  const path = Array.from({ length: 31 }, (_, i) => ({ t: i / 10, x: 100 + i * 10, y: 300 }));
  const simple = simplifyPath(path);
  assert.deepEqual(simple.map((p) => p.t), [0, 3]);
  // One millisecond short (lib/keyframes.mjs span): tweens never touch.
  assert.match(pathTimeline("#m", simple), /tl\.to\("#m", \{ x: 300, y: 0, duration: 2\.999, ease: "none" \}, 0\);/);
});

test("text behind a person rides along their track", () => {
  const people = buildTracks(scene());
  const video = { id: "v", width: 1280, height: 720, duration: 3, face: null, people };
  const fx = { id: "fx_bt", type: "behind-text", start: 0, duration: null,
    params: { ...defaultParams("behind-text"), anchor: "follow", person: "2" } };
  assert.equal(needsTracking({ effects: [fx] }), true);
  const built = byType("behind-text").build(fx, video);
  assert.match(built.html, /id="fx_bt-mv"/);
  assert.match(built.timeline, /tl\.to\("#fx_bt-mv", \{ x: -/);
  // Without tracks yet it still builds, placed freely.
  const bare = byType("behind-text").build(fx, { ...video, people: null });
  assert.doesNotMatch(bare.html, /-mv/);
});

test("name tags: one per tracked person, in order, none beyond the names given", () => {
  const people = buildTracks(scene());
  const video = { id: "v", width: 1280, height: 720, duration: 3, face: null, people };
  const fx = (names) => ({ id: "fx_pt", type: "person-tags", start: 0, duration: null,
    params: { ...defaultParams("person-tags"), names } });
  const built = byType("person-tags").build(fx("Alice / Bruno / Chloé"), video);
  assert.equal((built.html.match(/class="fx_pt-t"/g) || []).length, 2);
  assert.ok(built.html.indexOf("Alice") < built.html.indexOf("Bruno"));
  const one = byType("person-tags").build(fx("Alice"), video);
  assert.equal((one.html.match(/class="fx_pt-t"/g) || []).length, 1);
  assert.equal(byType("person-tags").build(fx("Alice"), { ...video, people: null }), null);
  assert.doesNotMatch(byType("person-tags").build(fx("<b>x</b>"), video).html, /<b>/);
});
