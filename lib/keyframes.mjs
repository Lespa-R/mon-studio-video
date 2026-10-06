// From a sampled path to GSAP calls, for everything that moves along a track
// (a spot of the scenery, a followed subject, the camera):
//
//   simplifyBy()   fewer keyframes, same motion (Ramer–Douglas–Peucker)
//   span()         a tween's duration, one millisecond short
//   steadySight()  no blinking: short runs of seen / unseen frames merged
//   sightFades()   fade out where the subject is lost, back in where found
//   pointAt()      a point between two keyframes
//   holdSeen()     while out of sight, the last place it was seen
//
// Points are { t, …, seen }, times in seconds on the clip. Pure functions only.

import { r3 } from "./util.mjs";

// Fewer keyframes, same motion: Ramer–Douglas–Peucker over the vectors
// `vec(p)` (in pixels, or measured like them), keeping the first and last
// points and every point `must(i)` asks for.
export function simplifyBy(path, vec, tolerance, must = () => false) {
  if (path.length <= 2) return path;
  const keep = path.map((_, i) => i === 0 || i === path.length - 1 || must(i));
  const v = path.map(vec);
  const stack = [[0, path.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const k = (path[i].t - path[a].t) / (path[b].t - path[a].t || 1);
      let d = 0;
      for (let c = 0; c < v[i].length; c++) d += (v[a][c] + (v[b][c] - v[a][c]) * k - v[i][c]) ** 2;
      d = Math.sqrt(d);
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance) { keep[at] = true; stack.push([a, at], [at, b]); }
  }
  return path.filter((_, i) => keep[i]);
}

// The points on either side of a change of visibility: kept, or a fade
// would start from the wrong place.
export const sightChanges = (path) => (i) =>
  (i > 0 && path[i].seen !== path[i - 1].seen) || (i + 1 < path.length && path[i + 1].seen !== path[i].seen);

// A tween's duration from a to b, one millisecond short: 3.77 + 0.03 can land
// past 3.8 in floating point and make two tweens touch. A 1 ms gap shows
// nothing.
export const span = (a, b) => Math.round((b - a) * 1000 - 1) / 1000;

// The subject flickering in and out of sight for a few frames (a passer-by,
// the edge of the frame) would make the effect blink: a run of seen / unseen
// frames shorter than `min` seconds takes the state around it.
export function steadySight(path, min = 0.35) {
  if (path.length < 3) return path;
  const out = path.map((p) => ({ ...p }));
  const step = path[1].t - path[0].t;
  // Shortest first, merging as it goes: two short runs next to each other
  // may make one long enough to stay.
  for (;;) {
    const runs = [];
    for (let i = 0; i < out.length; i++) {
      const last = runs[runs.length - 1];
      if (last && last.seen === out[i].seen) last.end = i;
      else runs.push({ seen: out[i].seen, start: i, end: i });
    }
    if (runs.length < 2) return out;
    let pick = null;
    runs.forEach((run, r) => {
      const length = out[run.end].t - out[run.start].t + step;
      const edge = r === 0 || r === runs.length - 1;
      // At an end only a short "lost" goes (start or end the stretch shown).
      if (length < min && (!edge || !run.seen) && (!pick || length < pick.length)) pick = { run, length };
    });
    if (!pick) return out;
    for (let i = pick.run.start; i <= pick.run.end; i++) out[i].seen = !pick.run.seen;
  }
}

// GSAP calls fading `selector` out where the subject is lost and back in
// where it is found again, never past the end of the path.
export function sightFades(selector, path, fade = 0.2) {
  const out = [];
  const end = path.length ? path[path.length - 1].t : 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a.seen && !b.seen) {
      out.push(`      tl.to("${selector}", { opacity: 0, duration: ${fade}, ease: "power1.in" }, ${r3(Math.max(path[0].t, a.t - fade / 2))});`);
    } else if (!a.seen && b.seen) {
      const d = r3(Math.min(fade, end - b.t));
      out.push(d > 0
        ? `      tl.to("${selector}", { opacity: 1, duration: ${d}, ease: "power1.out" }, ${b.t});`
        : `      tl.set("${selector}", { opacity: 1 }, ${b.t});`);
    }
  }
  return out;
}

// Where keyframes { t, x, y } put a point at time `at`: linear between the
// two around it, held before the first and after the last.
export function pointAt(keys, at) {
  if (at <= keys[0].t) return { t: at, x: keys[0].x, y: keys[0].y };
  for (let i = 1; i < keys.length; i++) {
    if (at <= keys[i].t) {
      const a = keys[i - 1];
      const b = keys[i];
      const k = (at - a.t) / (b.t - a.t || 1);
      return { t: at, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  const last = keys[keys.length - 1];
  return { t: at, x: last.x, y: last.y };
}

// Where the subject is at each moment and, while it is out of sight, where
// it was last seen: [{ t, x, y }] — what a camera holds on.
export function holdSeen(path) {
  let last = path.find((q) => q.seen) || path[0];
  return path.map((q) => {
    if (q.seen) last = q;
    return { t: q.t, x: last.x, y: last.y };
  });
}
