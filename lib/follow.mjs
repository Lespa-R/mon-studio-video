// What an effect follows — its « Sujet » — and how it moves.
//
//   params.source  "person:1" … "person:4", "group"   tracked people (lib/tracking.mjs, video.people)
//                  "object"                           the object clicked in the effect (SAM 2, video.objects)
//                  "pin"                              a spot of the scenery (lib/pins.mjs, video.pins)
//                  "fixed"                            a point of the frame (x / y)
//
// followBoxes() turns whichever it is into one path of boxes over the
// effect's window — [{ t, x, y, w, h, seen }], centre and size in source
// pixels — so an effect can light, frame, label or circle its subject without
// caring what it is. boxTimeline() / sizeTimeline() / boxTweens() turn the
// path into GSAP tweens of a mover (and of a box inside it), fading it while
// the subject is out of sight.
//
// Pure functions only.

import { num, clamp, r1, r3, shortHash } from "./util.mjs";
import { simplifyBy, sightChanges, span, steadySight, sightFades } from "./keyframes.mjs";
import { PIN, FOLLOW_OPTIONS, pinAtField, pinPath } from "./pins.mjs";

export const SOURCE_OPTIONS = [
  { value: "person:1", label: "Personne 1 (la plus à gauche)" },
  { value: "person:2", label: "Personne 2" },
  { value: "person:3", label: "Personne 3" },
  { value: "person:4", label: "Personne 4" },
  { value: "group", label: "Tout le groupe" },
  { value: "object", label: "Un objet (clique dessus)" },
  { value: PIN, label: "Un point du décor (suit la caméra)" },
  { value: "fixed", label: "Un point fixe de l'image" },
];

// The fields that choose the subject. `object` is set by the object dialog;
// `pinAt` by a drop on the preview; neither is typed by hand.
export function sourceFields(def = "person:1", { y = 45 } = {}) {
  const at = (values) => ({ key: "source", values });
  return [
    { key: "source", label: "Sujet", type: "select", default: def, options: SOURCE_OPTIONS },
    { key: "object", label: "Objet suivi", type: "object", default: null, showIf: at(["object"]) },
    { key: "x", label: "Horizontal (%)", type: "range", min: 0, max: 100, step: 0.1, default: 50, showIf: at([PIN, "fixed"]) },
    { key: "y", label: "Vertical (%)", type: "range", min: 0, max: 100, step: 0.1, default: y, showIf: at([PIN, "fixed"]) },
    { key: "pinFollow", label: "Suivre", type: "select", default: "move", options: FOLLOW_OPTIONS, showIf: at([PIN]) },
    pinAtField(),
  ];
}

// Whether the effect needs the clip's people tracked.
export const followsPeople = (fx) => /^person:|^group$/.test(String(fx.params?.source ?? ""));

// The object to follow, or null: { t, points, level }.
export function objectRequest(fx) {
  const p = fx.params || {};
  if (p.source !== "object" || !p.object || !Array.isArray(p.object.points)) return null;
  if (!p.object.points.some((q) => q.l !== 0)) return null;
  return { t: num(p.object.t, 0), points: p.object.points, level: [0, 1, 2].includes(p.object.level) ? p.object.level : 2 };
}

// A short name for an object track: same clicks, same moment, same file.
export function objectKey(req, video) {
  return shortHash(JSON.stringify([req.t, req.points, req.level, video.duration, video.ext, "v1"]));
}

// A person's box from a track at time t (cx, top, bottom; the width is not
// measured: a standing person is about 0.42 of their height).
function personAt(track, t, step) {
  const f = Math.min(track.cx.length - 1, Math.max(0, (t - track.start) / step));
  const i = Math.floor(f);
  const k = f - i;
  const j = Math.min(i + 1, track.cx.length - 1);
  const lerp = (a) => a[i] + (a[j] - a[i]) * k;
  return { cx: lerp(track.cx), top: lerp(track.top), bottom: lerp(track.bottom) };
}

// Samples of a track that has { start, step, x, y, w?, h?, seen? } arrays.
function sampled(track, from, to, map) {
  const n = track.x.length;
  const at = (t) => Math.min(n - 1, Math.max(0, Math.round((t - track.start) / track.step)));
  const out = [];
  for (let i = at(from); i <= at(to); i++) out.push(map(i, r3(Math.max(from, Math.min(to, track.start + i * track.step)))));
  if (out.length) {
    out[0].t = r3(from);
    out[out.length - 1].t = r3(to);
  }
  return out.filter((p, i) => i === 0 || p.t > out[i - 1].t);
}

// A point that does not move (x / y % of the frame), as a box of `box` px.
function pointBoxes(p, video, t, box) {
  const x = video.width * clamp(num(p.x, 50), 0, 100) / 100;
  const y = video.height * clamp(num(p.y, 45), 0, 100) / 100;
  return [{ t: r3(t.start), x, y, w: box, h: box, seen: true }, { t: r3(t.end), x, y, w: box, h: box, seen: true }];
}

// The subject's boxes over [t.start, t.end]. When there is nothing (yet) to
// follow — no people tracked, no object chosen or followed — null, or with
// `still`, the point x / y says (the effect still shows and can be dragged).
// `size` is the box of a point (pin, fixed), × the frame's short side.
export function followBoxes(fx, video, t, { size = 0.2, still = false } = {}) {
  const p = fx.params || {};
  const src = String(p.source || "fixed");
  const box = Math.min(video.width, video.height) * size;
  const nothing = () => (still ? pointBoxes(p, video, t, box) : null);

  if (src === "fixed") return pointBoxes(p, video, t, box);

  if (src === PIN) {
    const path = pinPath(video.pins?.[fx.id], { from: t.start, to: t.end, follow: p.pinFollow || "move" });
    return path ? path.map((q) => ({ t: q.t, x: q.x, y: q.y, w: box * q.s, h: box * q.s, r: q.r, seen: q.seen })) : pointBoxes(p, video, t, box);
  }

  if (src === "object") {
    const track = video.objects?.[fx.id];
    if (!track || !track.x?.length) return nothing();
    const raw = sampled(track, t.start, t.end, (i, at) => ({
      t: at, x: track.x[i], y: track.y[i], w: track.w[i], h: track.h[i], seen: Boolean(track.seen[i]),
    }));
    // Before the object is first seen its box is unknown (zeros): it takes
    // the first one seen, so a moment merged into sight shows it in place.
    const first = raw.find((q) => q.seen);
    if (!first) return nothing();
    for (const q of raw) {
      if (q === first) break;
      Object.assign(q, { x: first.x, y: first.y, w: first.w, h: first.h });
    }
    return steadySight(smoothBoxes(raw));
  }

  // People: one person, or the whole group (the box around everyone on screen).
  const people = video.people;
  if (!people?.tracks?.length) return nothing();
  const pick = src === "group" ? people.tracks : [people.tracks[Number(src.split(":")[1]) - 1]].filter(Boolean);
  if (!pick.length) return nothing();
  const step = people.step;
  const out = [];
  for (let at = t.start; at <= t.end + 1e-6; at += step) {
    const live = pick.filter((tr) => at >= tr.start - step && at <= tr.end + step);
    const set = live.length ? live : pick;
    const pts = set.map((tr) => personAt(tr, at, step));
    const top = Math.min(...pts.map((q) => q.top));
    const bottom = Math.max(...pts.map((q) => q.bottom));
    const h = bottom - top;
    const left = Math.min(...pts.map((q) => q.cx)) - h * 0.21;
    const right = Math.max(...pts.map((q) => q.cx)) + h * 0.21;
    out.push({ t: r3(Math.min(at, t.end)), x: (left + right) / 2, y: (top + bottom) / 2, w: right - left, h, seen: live.length > 0 });
  }
  if (out.length) out[out.length - 1].t = r3(t.end);
  return steadySight(out.filter((q, i) => i === 0 || q.t > out[i - 1].t));
}

// A light moving average of the boxes (no lag): the edges of a mask jitter a
// little from frame to frame.
export function smoothBoxes(path, r = 2) {
  return path.map((q, i) => {
    let n = 0;
    const s = { x: 0, y: 0, w: 0, h: 0 };
    for (let j = Math.max(0, i - r); j <= Math.min(path.length - 1, i + r); j++) {
      if (path[j].seen !== q.seen) continue;
      for (const k of ["x", "y", "w", "h"]) s[k] += path[j][k];
      n++;
    }
    return { ...q, x: s.x / n, y: s.y / n, w: s.w / n, h: s.h / n };
  });
}

// Fewer keyframes, same motion (over centre, size and turn), keeping every
// change of visibility.
export function simplifyBoxes(path, tolerance = 2) {
  return simplifyBy(path, (q) => [q.x, q.y, q.w / 2, q.h / 2, (q.r || 0) * 2], tolerance, sightChanges(path));
}

// GSAP calls tweening `selector` through the path's keyframes: `state(q)`
// gives the properties at each one (`first`: more to set at the start).
export function boxTweens(selector, path, state, first = "") {
  const pts = simplifyBoxes(path);
  const out = [`      tl.set("${selector}", { ${state(pts[0])}${first} }, ${pts[0].t});`];
  for (let i = 1; i < pts.length; i++) {
    const d = span(pts[i - 1].t, pts[i].t);
    if (d > 0) out.push(`      tl.to("${selector}", { ${state(pts[i])}, duration: ${d}, ease: "none" }, ${pts[i - 1].t});`);
  }
  return out.join("\n");
}

// GSAP calls moving `selector` (a mover placed so that `origin` is where the
// path starts) along the path: x / y offsets from the origin, a turn when the
// path has one, and fades while the subject is out of sight.
export function boxTimeline(selector, path, origin, { fade = 0.2 } = {}) {
  if (!path || !path.length) return "";
  const state = (q) => `x: ${r1(q.x - origin.x)}, y: ${r1(q.y - origin.y)}${q.r !== undefined ? `, rotation: ${r1(q.r)}` : ""}`;
  return [boxTweens(selector, path, state, `, opacity: ${path[0].seen ? 1 : 0}`), ...sightFades(selector, path, fade)].join("\n");
}

// GSAP calls sizing `selector` (a box centred on the mover) to the subject:
// width / height in px, scaled by `k` and never under `min`.
export function sizeTimeline(selector, path, { k = 1, min = 0, pad = 0 } = {}) {
  if (!path || !path.length) return "";
  return boxTweens(selector, path, (q) => `width: ${Math.round(Math.max(min, q.w * k + pad * 2))}, height: ${Math.round(Math.max(min, q.h * k + pad * 2))}`);
}
