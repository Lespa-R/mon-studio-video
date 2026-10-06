import { test } from "node:test";
import assert from "node:assert/strict";
import { followBoxes, objectRequest, objectKey, boxTimeline, boxTweens, sizeTimeline, simplifyBoxes } from "../lib/follow.mjs";
import { portableParams } from "../lib/effects.mjs";
import { stageKeys, stageTimeline } from "../lib/stage-motion.mjs";
import { calm } from "../lib/effects-camera.mjs";
import { blurRequest } from "../lib/effects-blur.mjs";
import { compose, pinRequests } from "../lib/compose.mjs";
import { byType, defaultParams, catalogue } from "../lib/effects.mjs";

const T = { start: 1, end: 3, duration: 2, full: false };
const clip = (extra = {}) => ({ id: "vid_1", ext: ".mp4", width: 1000, height: 2000, duration: 10, fps: 30, effects: [], ...extra });
const fx = (type, params = {}, extra = {}) => ({ id: "fx_1", type, start: 1, duration: 2, params: { ...defaultParams(type), ...params }, ...extra });

test("a fixed point follows nothing: two boxes where x / y say", () => {
  const path = followBoxes(fx("spotlight", { source: "fixed", x: 30, y: 40 }), clip(), T);
  assert.deepEqual(path.map((q) => [q.t, q.x, q.y]), [[1, 300, 800], [3, 300, 800]]);
});

test("a person is followed as a box around their track; the group as one box", () => {
  const people = { step: 0.5, tracks: [
    { start: 0, end: 10, cx: Array(21).fill(200), top: Array(21).fill(100), bottom: Array(21).fill(900) },
    { start: 0, end: 10, cx: Array(21).fill(700), top: Array(21).fill(300), bottom: Array(21).fill(1100) },
  ] };
  const one = followBoxes(fx("tracker", { source: "person:2" }), clip({ people }), T);
  assert.deepEqual([one[0].x, one[0].y, one[0].h, Math.round(one[0].w)], [700, 700, 800, 336]);
  const group = followBoxes(fx("tracker", { source: "group" }), clip({ people }), T);
  assert.equal(group[0].y, 600);
  assert.ok(group[0].w > 500, "spans both people");
  assert.equal(followBoxes(fx("tracker", { source: "person:3" }), clip({ people }), T), null);
});

test("an object is followed from its boxes, with its gaps", () => {
  const n = 120;
  const objects = { fx_1: { start: 0, step: 1 / 30, x: Array(n).fill(400), y: Array(n).fill(500), w: Array(n).fill(100), h: Array(n).fill(60),
    seen: Array.from({ length: n }, (_, i) => (i >= 60 && i < 80 ? 0 : 1)) } };
  const path = followBoxes(fx("follow-tag", { source: "object" }), clip({ objects }), T);
  assert.ok(path.length > 50);
  assert.ok(path.some((q) => !q.seen), "out of sight between 2 s and 2.67 s");
  assert.equal(followBoxes(fx("follow-tag", { source: "object" }), clip(), T), null, "not followed yet");
});

test("an object request needs a click on it; its key changes with the clicks", () => {
  assert.equal(objectRequest(fx("follow-tag", { source: "object", object: null })), null);
  const req = objectRequest(fx("follow-tag", { source: "object", object: { t: 1, points: [{ x: 0.5, y: 0.5, l: 1 }], level: 2 } }));
  assert.deepEqual(req, { t: 1, points: [{ x: 0.5, y: 0.5, l: 1 }], level: 2 });
  const k = objectKey(req, clip());
  assert.notEqual(objectKey({ ...req, level: 1 }, clip()), k);
});

test("box tweens: offsets from the origin, sizes, any property, and fades out of sight", () => {
  const path = [
    { t: 1, x: 100, y: 100, w: 50, h: 80, seen: true },
    { t: 2, x: 200, y: 150, w: 100, h: 160, seen: true },
    { t: 2.5, x: 210, y: 150, w: 100, h: 160, seen: false },
    { t: 3, x: 220, y: 150, w: 100, h: 160, seen: true },
  ];
  const move = boxTimeline("#m", path, { x: 100, y: 100 });
  assert.match(move, /tl\.set\("#m", \{ x: 0, y: 0, opacity: 1 \}, 1\);/);
  assert.match(move, /tl\.to\("#m", \{ x: 100, y: 50, duration: 0\.999, ease: "none" \}, 1\);/);
  assert.match(move, /opacity: 0, duration: 0\.2/);
  assert.match(sizeTimeline("#b", path, { pad: 5 }), /width: 110, height: 170/);
  assert.match(boxTweens("#s", path, (q) => `"--w": "${q.w}px"`), /tl\.to\("#s", \{ "--w": "100px", duration: 0\.999, ease: "none" \}, 1\);/);
  assert.equal(simplifyBoxes(path).length, 4);
});

test("the camera follows the subject and never shows past the frame's edges", () => {
  const T0 = { scale: 1, x: 0, y: 0 };
  const canvas = { width: 500, height: 1000 };
  const source = { width: 1000, height: 1000 };
  const path = [{ t: 1, x: 100, y: 500 }, { t: 2, x: 400, y: 500 }, { t: 3, x: 950, y: 500 }, { t: 4, x: 600, y: 500 }];
  const plan = stageKeys({ mode: "center", path, zoom: 1, axis: "x" }, T0, canvas, source);
  // Subject at 400 → stage at -150 (centred); at 100 and 950 the edges stop it.
  assert.deepEqual(plan.keys.map((k) => k.x), [0, -150, -500, -350]);
  const js = stageTimeline({ mode: "center", path, zoom: 1, axis: "x", start: 1, end: 3, duration: 10 }, T0, canvas, source);
  assert.match(js, /tl\.set\("#stage", \{ x: 0, y: 0, scale: 1, transformOrigin: "0 0" \}, 0\);/);
  assert.doesNotMatch(js, /NaN|undefined/);
});

test("stabilising keeps the spot where it was, within the zoom's margin", () => {
  const T0 = { scale: 1, x: 0, y: 0 };
  const canvas = { width: 1000, height: 1000 };
  const source = { width: 1000, height: 1000 };
  // The spot drifts 20 px right: the stage moves 20 × 1.2 px left.
  const path = [{ t: 0, x: 500, y: 500 }, { t: 1, x: 520, y: 500 }];
  const plan = stageKeys({ mode: "lock", path, at: { x: 500, y: 500 }, zoom: 1.2 }, T0, canvas, source);
  assert.equal(Math.round(plan.keys[1].x - plan.keys[0].x), -24);
  assert.equal(plan.scale, 1.2);
});

test("the reframing camera is calm: lost moments hold, steps are smoothed", () => {
  const path = Array.from({ length: 21 }, (_, i) => ({ t: i * 0.1, x: i % 2 ? 110 : 90, y: 0, seen: i !== 10 }));
  const out = calm(path, 0.3);
  for (const q of out.slice(3, -3)) assert.ok(Math.abs(q.x - 100) < 5, String(q.x));
});

test("a blur is made once an object is chosen, or straight away for everyone", () => {
  assert.equal(blurRequest(fx("blur-object", { source: "object", object: null }), clip()), null);
  const one = blurRequest(fx("blur-object", { source: "object", object: { t: 1, points: [{ x: 0.5, y: 0.5, l: 1 }], level: 2 }, mode: "pixels" }), clip());
  assert.equal(one.mode, "pixels");
  assert.match(one.key, /^[a-f0-9]{8}$/);
  const all = blurRequest(fx("blur-object", { source: "people" }), clip({ matteSignature: "v2|x" }));
  assert.equal(all.source, "people");
  assert.notEqual(blurRequest(fx("blur-object", { source: "people" }), clip({ matteSignature: "v2|y" })).key, all.key);
});

test("a route asks for one followed spot per point", () => {
  const video = clip({ effects: [fx("route", { count: "3", pinAt0: 1, pinAt1: 1.5, pinAt2: 2 })] });
  assert.deepEqual(pinRequests(video).map((r) => [r.fxId, r.t]), [["fx_1:0", 1], ["fx_1:1", 1.5], ["fx_1:2", 2]]);
});

test("the orbit's front half goes in front of the subject", () => {
  const html = compose(clip({ effects: [fx("orbit-text", { source: "fixed" })] }), { bgFile: "vid_1-bg.mp4", fgFile: "vid_1-fg.webm" }, {});
  const fg = html.indexOf('id="fg"');
  assert.ok(html.indexOf('id="fx_1-back"') < fg && html.indexOf('id="fx_1-front"') > fg);
});

test("an arrow pinned to the scenery is laid out on the stage, on screen otherwise", () => {
  const stageEnd = (html) => html.indexOf("\n      </div>\n", html.indexOf('<div id="stage">'));
  const on = compose(clip({ effects: [fx("arrow", { attach: "pin" })] }), { bgFile: "b.mp4", fgFile: null }, {});
  assert.ok(on.indexOf('id="fx_1"') < stageEnd(on));
  const off = compose(clip({ effects: [fx("arrow", { attach: "screen" })] }), { bgFile: "b.mp4", fgFile: null }, {});
  assert.ok(off.indexOf('id="fx_1"') > stageEnd(off));
});

test("every « Suivi » effect builds, whatever it follows, with nothing yet followed", () => {
  const types = catalogue().filter((e) => e.category === "Suivi").map((e) => e.type);
  assert.ok(types.length >= 14, types.join(", "));
  for (const type of types) {
    for (const source of ["person:1", "object", "pin", "fixed", "people"]) {
      const b = byType(type).build(fx(type, { source }), { ...clip(), view: { x: 0, y: 0, w: 1000, h: 2000 } });
      if (!b) continue;
      assert.doesNotMatch(b.css + b.html + b.timeline + (b.htmlFront || ""), /NaN|undefined/, `${type} / ${source}`);
    }
  }
});

test("an object first seen late does not flash in a corner: it starts where it is first seen", () => {
  const n = 120;
  const objects = { fx_1: { start: 0, step: 1 / 30,
    x: Array.from({ length: n }, (_, i) => (i < 5 ? 0 : 400)), y: Array.from({ length: n }, (_, i) => (i < 5 ? 0 : 500)),
    w: Array.from({ length: n }, (_, i) => (i < 5 ? 0 : 100)), h: Array.from({ length: n }, (_, i) => (i < 5 ? 0 : 60)),
    seen: Array.from({ length: n }, (_, i) => (i < 5 ? 0 : 1)) } };
  const path = followBoxes(fx("follow-tag", { source: "object" }), clip({ objects }), { start: 0, end: 3, duration: 3, full: false });
  assert.ok(path.every((q) => q.x === 400 && q.y === 500 && q.w === 100), "no box at 0, 0");
});

test("with nothing followed yet, an effect can still stand where x / y say", () => {
  const path = followBoxes(fx("spotlight", { source: "person:1", x: 30, y: 40 }), clip(), T, { still: true });
  assert.deepEqual(path.map((q) => [q.x, q.y]), [[300, 800], [300, 800]]);
  assert.equal(followBoxes(fx("spotlight", { source: "person:1" }), clip(), T), null);
});

test("every follow effect marks its subject, so a drop can pin it there", () => {
  for (const type of ["spotlight", "follow-tag", "tracker", "orbit-text"]) {
    const b = byType(type).build(fx(type, { source: "fixed", x: 30, y: 40 }), { ...clip(), view: { x: 0, y: 0, w: 1000, h: 2000 } });
    assert.match(b.html + (b.htmlFront || ""), /<i id="fx_1-anchor" style="position: absolute; left: 300px; top: 800px"><\/i>/, type);
  }
});

test("the spotlight's oval grows and shrinks with the subject, the pane itself is never scaled", () => {
  const people = { step: 0.5, tracks: [{ start: 0, end: 10, cx: Array(21).fill(500), top: Array.from({ length: 21 }, (_, i) => 1000 - i * 30), bottom: Array(21).fill(1900) }] };
  const b = byType("spotlight").build(fx("spotlight", { source: "person:1" }), { ...clip({ people }), view: { x: 0, y: 0, w: 1000, h: 2000 } });
  assert.match(b.css, /radial-gradient\(var\(--rx\) var\(--ry\)/);
  assert.match(b.timeline, /"--ry": "\d+(\.\d)?px"/);
  assert.doesNotMatch(b.timeline, /scaleX|scaleY/);
});

test("the orbiting text goes round the right way, and stays on its path", () => {
  const ring = (direction) => byType("orbit-text").build(fx("orbit-text", { source: "fixed", direction }), { ...clip(), view: { x: 0, y: 0, w: 1000, h: 2000 } });
  // Forwards along the path (0 → 50 %), the front half moves right.
  assert.match(ring("right").timeline, /startOffset: "0%" \} \},\s+\{ attr: \{ startOffset: "50%" \}/);
  assert.match(ring("left").timeline, /startOffset: "50%" \} \},\s+\{ attr: \{ startOffset: "0%" \}/);
  assert.match(ring("right").htmlFront, /textLength="[\d.]+" lengthAdjust="spacing"/);
});

test("a route's labels are centred by GSAP, never by a CSS translate it would read back", () => {
  const b = byType("route").build(fx("route", {}), { ...clip(), view: { x: 0, y: 0, w: 1000, h: 2000 } });
  assert.doesNotMatch(b.css, /-lab \{[^}]*translate/);
  assert.match(b.timeline, /xPercent: -50, yPercent: -100, y: 0/);
});

test("a tilted title is laid in perspective after it is measured, not by the timeline", () => {
  const b = byType("title").build(fx("title", { tilt: "ground" }), { ...clip(), view: { x: 0, y: 0, w: 1000, h: 2000 } });
  assert.doesNotMatch(b.timeline, /tilt/);
  assert.match(b.init, /el\.style\.transform = "perspective\(\d+px\) rotateX\(62deg\) rotateY\(0deg\)"/);
  assert.ok(b.init.indexOf("perspective") > b.init.indexOf("measureText"), "after the measurement");
});

test("going to another clip, an effect forgets the object clicked and the moments pinned on this one", () => {
  const params = { source: "object", object: { t: 1, points: [], level: 2 }, x: 30, title: "Ma planche", pinAt: 2 };
  assert.deepEqual(portableParams("follow-tag", params), { ...params, object: null, pinAt: null });
  const route = portableParams("route", { pinAt0: 1, pinAt3: 2, x0: 40 });
  assert.equal(route.pinAt0, null);
  assert.equal(route.pinAt3, null);
  assert.equal(route.x0, 40);
});
