// « Fixé dans le décor »: text pinned to a spot of the scenery, which stays
// on that spot while the camera moves (pans, zooms, rolls).
//
// A pinned effect stores where it was put and when:
//
//   params.x, params.y   the spot, % of the source frame, at time params.pinAt
//
// tools/scenetrack.py follows that spot through the clip (lib/media.mjs
// trackScene, cached by the server in media/<id>-pin-<key>.json):
//
//   { start, step, ref, width, height, x: [], y: [], s: [], r: [], lost: [] }
//
// x / y where the spot is (source px), s its zoom and r its turn (degrees)
// since pinAt, lost = 1 while it is out of sight. The effect sits in a
// "mover" whose transform-origin is the spot (pinWrap); pinTimeline() turns
// the track into GSAP tweens of that mover (move, zoom, turn), and fades it
// while the spot is out of sight.
//
// Pure functions only.

import { num, clamp, r1, r3, shortHash } from "./util.mjs";
import { simplifyBy, sightChanges, span, steadySight, sightFades } from "./keyframes.mjs";

// What the text follows of the camera's motion.
export const FOLLOW_OPTIONS = [
  { value: "move", label: "Le déplacement (conseillé)" },
  { value: "zoom", label: "Déplacement et taille" },
  { value: "full", label: "Déplacement, taille et rotation" },
];

// The value of a placement select that pins the effect.
export const PIN = "pin";
export const PIN_OPTION = { value: PIN, label: "Fixé dans le décor (suit la caméra)" };

// The moment a spot was pinned is never typed by hand: the preview writes it
// (a drop, or choosing « Fixé dans le décor »). null: the effect's start.
export const NEVER = { key: "__never", values: [] };
export const pinAtField = (key = "pinAt", label = "Posé à (s)") => ({ key, label, type: "number", default: null, showIf: NEVER });

// The fields a pinnable effect adds.
export function pinFields(showIf) {
  return [
    { key: "pinFollow", label: "Suivre", type: "select", default: "move", options: FOLLOW_OPTIONS, ...(showIf ? { showIf } : {}) },
    pinAtField(),
  ];
}

// A pinAt-like param: null / "" / missing mean "not set".
const unset = (v) => v === null || v === undefined || v === "";

// The spot to follow for an effect, or null when it is not pinned:
// { t, x, y } with x, y in 0..1.
export function pinRequest(fx, def, duration) {
  const pin = def?.pin;
  if (!pin || fx.enabled === false) return null;
  const p = fx.params || {};
  if (pin.key && p[pin.key] !== PIN) return null;
  return spotRequest(p.x, p.y, p.pinAt, fx.start, duration, { x: pin.x ?? 50, y: pin.y ?? 50 });
}

// A spot at x / y % pinned at `pinAt` (or the effect's start), as asked of
// scenetrack — shared by effects with several spots (a route).
export function spotRequest(x, y, pinAt, start, duration, fallback = { x: 50, y: 50 }) {
  const t = clamp(unset(pinAt) ? num(start, 0) : num(pinAt, num(start, 0)), 0, Math.max(0, duration - 0.02));
  return {
    t: r3(t),
    x: Math.round(clamp(num(x, fallback.x), 0, 100) * 100) / 10000,
    y: Math.round(clamp(num(y, fallback.y), 0, 100) * 100) / 10000,
  };
}

// The stretch of the clip to follow: the effect's window, widened to whole
// half-seconds (a small change of timing reuses the track) and to the
// moment it was pinned.
export function pinRange(req, start, end, duration) {
  const from = Math.max(0, Math.min(Math.floor(start * 2) / 2, req.t));
  const to = Math.min(duration, Math.max(Math.ceil(end * 2) / 2, req.t));
  return { from, to };
}

// A short name for a track: same spot, same moment, same stretch, same file.
export function pinKey(req, range, video) {
  return shortHash([req.t, req.x, req.y, range.from, range.to, video.duration, video.ext, "v1"].join("|"));
}

// The track over [from, to], as points { t, x, y, s, r, seen } — one per
// tracked frame, x / y in source px. What is not followed is left at rest.
export function pinPath(track, { from, to, follow = "move" }) {
  if (!track || !track.x?.length) return null;
  const n = track.x.length;
  const at = (t) => Math.min(n - 1, Math.max(0, Math.round((t - track.start) / track.step)));
  const i0 = at(from);
  const i1 = at(to);
  const path = [];
  for (let i = i0; i <= i1; i++) {
    path.push({
      t: r3(Math.max(from, Math.min(to, track.start + i * track.step))),
      x: track.x[i], y: track.y[i],
      s: follow === "move" ? 1 : track.s[i],
      r: follow === "full" ? track.r[i] : 0,
      seen: !track.lost[i],
    });
  }
  if (path.length) {
    path[0].t = r3(from);
    path[path.length - 1].t = r3(to);
  }
  // Strictly later each time: two keyframes at one moment would make
  // overlapping tweens.
  return steadySight(path.filter((p, i) => i === 0 || p.t > path[i - 1].t));
}

// The path of a pinned effect's spot over its window (`key`: the effect's
// id, or "<id>:<i>" for one of several spots) — or null until the clip has
// been followed: the effect then stays where it was put.
export function pinnedPath(video, key, t, follow = "move") {
  const track = video.pins?.[key];
  return track ? pinPath(track, { from: t.start, to: t.end, follow }) : null;
}

// Fewer keyframes, same motion (over move, zoom and turn, all in pixels at
// the size of a line of text), keeping every change of visibility.
export function simplifyPin(path, tolerance = 1.5, size = 300) {
  return simplifyBy(path, (p) => [p.x, p.y, (p.s - 1) * size, (p.r * Math.PI / 180) * size], tolerance, sightChanges(path));
}

// The mover of a pinned effect: it turns around its spot (transform-origin
// on it), and a marker on the spot tells the preview where the spot is now —
// a drop re-pins the effect there. `z`: its stacking order, as the mover is
// a stacking context of its own once GSAP gives it a transform.
export const pinWrap = (id, ax, ay, inner, z = null) => `
        <div id="${id}-mv" data-layout-allow-overflow style="position: absolute; inset: 0;${z === null ? "" : ` z-index: ${z};`} transform-origin: ${r3(ax)}px ${r3(ay)}px">${inner}
          <i id="${id}-anchor" style="position: absolute; left: ${r3(ax)}px; top: ${r3(ay)}px"></i>
        </div>`;

// GSAP calls that carry `selector` (a mover with its transform-origin on the
// spot, at `anchor` = { x, y } source px) along the path, and fade it while
// the spot is out of sight.
export function pinTimeline(selector, path, anchor) {
  if (!path || !path.length) return "";
  const state = (p) => `x: ${r1(p.x - anchor.x)}, y: ${r1(p.y - anchor.y)}, scale: ${r3(p.s)}, rotation: ${r1(p.r)}`;
  const out = [`      tl.set("${selector}", { ${state(path[0])}, opacity: ${path[0].seen ? 1 : 0} }, ${path[0].t});`];
  const pts = simplifyPin(path);
  for (let i = 1; i < pts.length; i++) {
    const d = span(pts[i - 1].t, pts[i].t);
    if (d > 0) out.push(`      tl.to("${selector}", { ${state(pts[i])}, duration: ${d}, ease: "none" }, ${pts[i - 1].t});`);
  }
  return [...out, ...sightFades(selector, path)].join("\n");
}
