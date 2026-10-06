// Moving the camera: the stage (the source frame placed on the output
// canvas, lib/format.mjs) slides and zooms over time instead of standing
// still. Two uses, given by an effect as `stageMotion` (compose.mjs takes the
// first one):
//
//   { mode: "center", path, zoom, axis, start, end }
//       reframe — keep the subject (path of source px points) in the middle
//       of the frame: a clip turned 9:16 that follows the person;
//   { mode: "lock", path, at, zoom, start, end }
//       stabilise — keep a spot of the scenery (its track) where it was at
//       the moment `at` (its source px position then), so the shake goes.
//
// The stage always covers the canvas (no black edge): positions are clamped,
// and `zoom` (≥ 1) gives the margin a stabilised shot needs. Outside the
// effect's window the stage rests where the format puts it, with short
// ramps in and out.
//
// Pure functions only.

import { r1, r3 } from "./util.mjs";
import { simplifyBy, span, pointAt } from "./keyframes.mjs";

const r4 = (n) => Math.round(n * 10000) / 10000;

// Where the stage goes: [{ t, x, y }] in canvas px, its scale, and where it
// rests outside the window (the format's own placement).
export function stageKeys(motion, T, canvas, source) {
  if (!motion || !motion.path || !motion.path.length) return null;
  const S = T.scale * Math.max(1, Number(motion.zoom) || 1);
  const cw = canvas.width;
  const ch = canvas.height;
  const W = source.width * S;
  const H = source.height * S;
  const fitX = (x) => (W >= cw ? Math.min(0, Math.max(cw - W, x)) : (cw - W) / 2);
  const fitY = (y) => (H >= ch ? Math.min(0, Math.max(ch - H, y)) : (ch - H) / 2);
  // The zoomed rest: zoomed around the centre of the canvas from T.
  const restX = fitX(cw / 2 - (cw / 2 - T.x) * (S / T.scale));
  const restY = fitY(ch / 2 - (ch / 2 - T.y) * (S / T.scale));
  let keys;
  if (motion.mode === "lock") {
    const qx = restX + motion.at.x * S;
    const qy = restY + motion.at.y * S;
    keys = motion.path.map((q) => ({ t: q.t, x: fitX(qx - q.x * S), y: fitY(qy - q.y * S) }));
  } else {
    keys = motion.path.map((q) => ({
      t: q.t,
      x: motion.axis === "y" ? restX : fitX(cw / 2 - q.x * S),
      y: motion.axis === "x" ? restY : fitY(ch / 2 - q.y * S),
    }));
  }
  // Fewer keyframes, same motion (within a pixel of the canvas).
  return { keys: simplifyBy(keys, (k) => [k.x, k.y], 1), scale: S, rest: { x: T.x, y: T.y, scale: T.scale } };
}

// GSAP calls for the stage: from its rest to the motion (eased in), along
// it, and back to rest at the end of the window. The ramps take the first
// and last `ramp` seconds of the window; the motion in between follows the
// keys, cut where the ramps begin and end, so no two tweens overlap.
export function stageTimeline(motion, T, canvas, source) {
  const plan = stageKeys(motion, T, canvas, source);
  if (!plan) return "";
  const { keys, scale, rest } = plan;
  const full = motion.start <= 0.001 && motion.end >= motion.duration - 0.001;
  const ramp = full ? 0 : r3(Math.min(0.5, (motion.end - motion.start) / 4));
  const a = r3(motion.start + ramp);
  const b = r3(motion.end - ramp);
  const along = [pointAt(keys, a), ...keys.filter((k) => k.t > a && k.t < b), pointAt(keys, b)];
  const state = (k) => `x: ${r1(k.x)}, y: ${r1(k.y)}, scale: ${r4(scale)}`;
  const restState = `x: ${r1(rest.x)}, y: ${r1(rest.y)}, scale: ${r4(rest.scale)}`;
  const out = [`      tl.set("#stage", { ${restState}, transformOrigin: "0 0" }, 0);`];
  out.push(ramp > 0
    ? `      tl.to("#stage", { ${state(along[0])}, duration: ${span(motion.start, a)}, ease: "power2.inOut" }, ${r3(motion.start)});`
    : `      tl.set("#stage", { ${state(along[0])} }, ${a});`);
  for (let i = 1; i < along.length; i++) {
    const d = span(along[i - 1].t, along[i].t);
    if (d > 0) out.push(`      tl.to("#stage", { ${state(along[i])}, duration: ${d}, ease: "none" }, ${r3(along[i - 1].t)});`);
  }
  if (ramp > 0) out.push(`      tl.to("#stage", { ${restState}, duration: ${ramp}, ease: "power2.inOut" }, ${b});`);
  return out.join("\n");
}
