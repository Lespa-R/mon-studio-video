import { test } from "node:test";
import assert from "node:assert/strict";
import { byType, catalogue, defaultParams } from "../lib/effects.mjs";
import { compose } from "../lib/compose.mjs";
import { stageTimeline } from "../lib/stage-motion.mjs";

// Every effect's GSAP calls, run against a recorder: what each one tweens,
// from when to when. Two tweens of the same element and property must never
// overlap (the later one would fight the earlier, and a seek could land
// either way), and nothing may run past the effect's window.

const META = new Set(["duration", "ease", "repeat", "yoyo", "stagger", "delay", "repeatDelay", "immediateRender", "overwrite"]);

function record(js) {
  const calls = [];
  const push = (kind, sel, vars, at) => {
    const dur = kind === "set" ? 0 : Number(vars.duration ?? 0.5) * (Number(vars.repeat ?? 0) + 1);
    // All attributes count as one property, "attr", as the HyperFrames lint
    // sees them (x1 and x2 of a line tweened apart overlap for it).
    const props = Object.keys(vars).filter((k) => !META.has(k));
    calls.push({ kind, sels: String(sel).split(/\s*,\s*/), props, at: Number(at), dur, stagger: Boolean(vars.stagger) });
  };
  const tl = {
    set: (sel, vars, at) => push("set", sel, vars, at),
    to: (sel, vars, at) => push("to", sel, vars, at),
    fromTo: (sel, from, vars, at) => push("fromTo", sel, { ...from, ...vars }, at),
  };
  new Function("tl", js)(tl);
  return calls;
}

// [description] of every pair of calls that fight over a property.
function overlaps(calls) {
  const out = [];
  const eps = 1e-6;
  for (let i = 0; i < calls.length; i++) {
    for (let j = i + 1; j < calls.length; j++) {
      const a = calls[i];
      const b = calls[j];
      if (a.stagger || b.stagger) continue;
      const sel = a.sels.find((s) => b.sels.includes(s));
      const prop = a.props.find((p) => b.props.includes(p));
      if (!sel || !prop) continue;
      const [x, y] = a.at <= b.at ? [a, b] : [b, a];
      // y starts inside x — even by a rounding error, as GSAP and the
      // HyperFrames lint compute it (a set at x's very start is fine).
      if (y.at > x.at + eps && y.at < x.at + x.dur) out.push(`${sel} ${prop}: ${x.kind}@${x.at}+${x.dur} / ${y.kind}@${y.at}+${y.dur}`);
    }
  }
  return out;
}

// A clip with everything an effect may follow: two people, a scenery track
// that loses its spot for a while, an object first seen a little late.
const clip = (effects = []) => {
  const n = 301;
  const track = {
    start: 0, step: 1 / 30, ref: 30, width: 1080, height: 1920,
    x: Array.from({ length: n }, (_, i) => 540 + i * 2), y: Array.from({ length: n }, (_, i) => 700 + Math.sin(i / 9) * 40),
    s: Array(n).fill(1), r: Array(n).fill(0), lost: Array.from({ length: n }, (_, i) => (i > 120 && i < 150 ? 1 : 0)),
  };
  const boxes = {
    start: 0, step: 1 / 30, width: 1080, height: 1920,
    x: Array.from({ length: n }, (_, i) => (i < 12 ? 0 : 400 + i)), y: Array(n).fill(900),
    w: Array.from({ length: n }, (_, i) => (i < 12 ? 0 : 200)), h: Array.from({ length: n }, (_, i) => (i < 12 ? 0 : 160)),
    seen: Array.from({ length: n }, (_, i) => (i < 12 || (i > 200 && i < 230) ? 0 : 1)),
  };
  const people = {
    step: 0.1,
    tracks: [
      { start: 0, end: 10, cx: Array(101).fill(300), top: Array(101).fill(500), bottom: Array(101).fill(1700) },
      { start: 2, end: 8, cx: Array(61).fill(800), top: Array(61).fill(600), bottom: Array(61).fill(1800) },
    ],
  };
  const pins = {};
  const objects = {};
  for (const fx of effects) {
    pins[fx.id] = track;
    for (let i = 0; i < 4; i++) pins[`${fx.id}:${i}`] = track;
    objects[fx.id] = boxes;
  }
  return {
    id: "vid_t", ext: ".mp4", width: 1080, height: 1920, duration: 10, fps: 30, hasAudio: true,
    face: { centreX: 540, chinMin: 900, chinMax: 940, faceHeight: 300 },
    people, pins, objects, blurs: Object.fromEntries(effects.map((fx) => [fx.id, "vid_t-blur-0.webm"])),
    view: { x: 0, y: 0, w: 1080, h: 1920 }, effects,
  };
};

const windows = [
  { start: 0, duration: null },  // the whole clip
  { start: 1, duration: 3 },
  { start: 0.5, duration: 4 },   // whole cycles fit exactly (a pulse)
  { start: 2.5, duration: 0.6 }, // a short one
];

// The ways an effect can be set up worth trying: each select's every value
// for the few that change the shape of the timeline.
function variants(type) {
  const def = byType(type);
  const out = [{}];
  for (const key of ["source", "anchor", "position", "attach", "place", "style", "pulse", "keep", "direction", "count", "ghosts", "behind", "mode"]) {
    const f = def.schema.find((x) => x.key === key && x.type === "select");
    if (f) for (const o of f.options) out.push({ [key]: o.value });
  }
  return out;
}

test("no effect's tweens fight over a property, nor run past its window", () => {
  const problems = [];
  for (const { type } of catalogue()) {
    for (const w of windows) {
      for (const v of variants(type)) {
        const fx = { id: "fx_1", type, enabled: true, ...w, params: { ...defaultParams(type), ...v, object: { t: 1, points: [{ x: 0.5, y: 0.5, l: 1 }], level: 2 } } };
        const video = clip([fx]);
        const def = byType(type);
        const space = typeof def.space === "function" ? def.space(fx) : def.space || "stage";
        const b = def.build(fx, space === "canvas" ? { ...video, view: undefined } : video);
        if (!b || !b.timeline) continue;
        let calls;
        try {
          calls = record(b.timeline);
        } catch (e) {
          problems.push(`${type} ${JSON.stringify(v)} ${JSON.stringify(w)}: does not run (${e.message})`);
          continue;
        }
        for (const o of overlaps(calls)) problems.push(`${type} ${JSON.stringify(v)} ${JSON.stringify(w)}: ${o}`);
        const end = b.timing ? b.timing.end : 10;
        for (const c of calls) {
          if (!c.stagger && c.at + c.dur > end + 0.002) problems.push(`${type} ${JSON.stringify(v)} ${JSON.stringify(w)}: ${c.sels.join(",")} ends at ${c.at + c.dur} > ${end}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("the moving camera's tweens never overlap, whatever its keys", () => {
  const T0 = { scale: 1, x: 0, y: 0 };
  const canvas = { width: 500, height: 1000 };
  const source = { width: 1000, height: 1000 };
  // Standing still (two keys once simplified), moving, and over the whole clip.
  const still = [{ t: 1, x: 500, y: 500 }, { t: 2, x: 500, y: 500 }, { t: 3, x: 500, y: 500 }];
  const moving = Array.from({ length: 61 }, (_, i) => ({ t: 1 + i / 30, x: 200 + i * 10, y: 500 }));
  for (const [path, start, end] of [[still, 1, 3], [moving, 1, 3], [moving, 0, 10]]) {
    const js = stageTimeline({ mode: "center", path, zoom: 1.2, axis: "x", start, end, duration: 10 }, T0, canvas, source);
    const calls = record(js);
    assert.deepEqual(overlaps(calls), [], js);
    for (const c of calls) assert.ok(c.at + c.dur <= Math.max(end, 0) + 0.002, js);
  }
});

test("every composition's script runs: the stage rule never outweighs an effect's own z-index", () => {
  const html = compose(clip([{ id: "fx_1", type: "subject-glow", start: 0, duration: null, params: defaultParams("subject-glow") }]), { bgFile: "b.mp4", fgFile: "f.webm" }, {});
  assert.match(html, /:where\(#stage video\) \{ object-fit: cover; z-index: 1; \}/);
  assert.doesNotMatch(html, /\n\s*#stage video \{/);
});
