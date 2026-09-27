// People tracking: raw detections (tools/persontrack) → one smooth track per
// person, and the helpers effects use to follow one.
//
// A track is sampled on a fixed grid (`step` seconds) over its lifespan:
//
//   { id: "p1", index: 1, start, end, cx: [...], top: [...], bottom: [...] }
//
//   cx      horizontal centre of the person (their face when it is seen
//           often enough — steadier than a body box that grows with the arms)
//   top     top of the head
//   bottom  bottom of the visible body
//
// People are numbered left to right, by where they are on average: "Personne
// 1" is the leftmost. Pure functions only.

const r1 = (n) => Math.round(n * 10) / 10;

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

const centre = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];

// How well a detection continues a track: overlap first, then nearness
// relative to the person's size. 0 = no match.
function affinity(prev, det) {
  const o = iou(prev, det);
  const [ax, ay] = centre(prev);
  const [bx, by] = centre(det);
  const scale = Math.max(prev[2], prev[3], det[2], det[3]) || 1;
  const near = 1 - Math.hypot(ax - bx, ay - by) / (scale * 0.8);
  return Math.max(o, near * 0.8, 0);
}

// The face that belongs to a body box: centred in its upper part.
function faceFor(body, faces) {
  let best = null;
  for (const f of faces) {
    const [fx, fy] = centre(f);
    if (fx < body[0] || fx > body[0] + body[2]) continue;
    if (fy < body[1] - f[3] || fy > body[1] + body[3] * 0.6) continue;
    if (!best || f[2] * f[3] > best[2] * best[3]) best = f;
  }
  return best;
}

export function buildTracks(data, { step = 0.1, minConfidence = 0.3, maxGap = 1.0 } = {}) {
  const duration = Number(data.duration) || 0;
  const open = [];
  const done = [];

  for (const sample of data.samples || []) {
    const t = Number(sample.t);
    const faces = (sample.f || []).filter((f) => f[2] > 0 && f[3] > 0);
    const dets = (sample.p || [])
      .filter((p) => (p[4] ?? 1) >= minConfidence && p[2] > 0 && p[3] > 0)
      .map((p) => ({ box: p.slice(0, 4), face: null }));
    // Faces with no body box around them are people too (a close-up hides
    // the body): stand-in box of a head and shoulders.
    for (const f of faces) {
      const d = dets.find((x) => faceFor(x.box, [f]));
      if (d) { if (!d.face) d.face = f; continue; }
      dets.push({ box: [f[0] - f[2] * 0.6, f[1] - f[3] * 0.3, f[2] * 2.2, f[3] * 3.2], face: f });
    }

    // Greedy matching, best pairs first.
    const pairs = [];
    open.forEach((track, ti) => dets.forEach((d, di) => {
      const a = affinity(track.last.box, d.box);
      if (a > 0.15) pairs.push({ a, ti, di });
    }));
    pairs.sort((x, y) => y.a - x.a);
    const usedT = new Set();
    const usedD = new Set();
    for (const { ti, di } of pairs) {
      if (usedT.has(ti) || usedD.has(di)) continue;
      usedT.add(ti); usedD.add(di);
      const obs = { t, ...dets[di] };
      open[ti].obs.push(obs);
      open[ti].last = obs;
    }
    dets.forEach((d, di) => {
      if (usedD.has(di)) return;
      const obs = { t, ...d };
      open.push({ obs: [obs], last: obs });
    });
    // Close tracks not seen for a while.
    for (let i = open.length - 1; i >= 0; i--) {
      if (t - open[i].last.t > maxGap) done.push(...open.splice(i, 1));
    }
  }
  done.push(...open);

  // Drop flickers: too short or too rarely seen to be a person.
  const minLife = Math.max(0.5, Math.min(2, duration * 0.1));
  const kept = done.filter((tr) => tr.obs.length >= 3 && tr.obs[tr.obs.length - 1].t - tr.obs[0].t >= minLife);

  const tracks = kept.map((tr) => resample(tr.obs, step, duration));
  // Left to right, by average position.
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  tracks.sort((a, b) => mean(a.cx) - mean(b.cx));
  tracks.forEach((tr, i) => { tr.id = `p${i + 1}`; tr.index = i + 1; });
  return { step, width: data.width, height: data.height, tracks };
}

// Observations → values on a fixed grid, gaps interpolated, then smoothed.
function resample(obs, step, duration) {
  const useFace = obs.filter((o) => o.face).length >= obs.length * 0.5;
  const point = (o) => {
    const [bx, by, bw, bh] = o.box;
    if (useFace && o.face) {
      const [fx, fy, fw, fh] = o.face;
      return { cx: fx + fw / 2, top: fy - fh * 0.25, bottom: by + bh };
    }
    return { cx: bx + bw / 2, top: by, bottom: by + bh };
  };
  // With faces as the reference, observations without one are skipped rather
  // than mixed in: body and face centres differ, and mixing them jitters.
  const pts = obs.filter((o) => !useFace || o.face).map((o) => ({ t: o.t, ...point(o) }));
  const start = Math.max(0, Math.floor(pts[0].t / step) * step);
  const end = Math.min(duration || Infinity, pts[pts.length - 1].t);
  const grid = { cx: [], top: [], bottom: [] };
  let j = 0;
  for (let t = start; t <= end + 1e-6; t += step) {
    while (j < pts.length - 2 && pts[j + 1].t < t) j++;
    const a = pts[j];
    const b = pts[Math.min(j + 1, pts.length - 1)];
    const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    for (const key of ["cx", "top", "bottom"]) grid[key].push(a[key] + (b[key] - a[key]) * k);
  }
  for (const key of ["cx", "top", "bottom"]) grid[key] = smooth(grid[key], 2).map(r1);
  return { start: Math.round(start * 1000) / 1000, end: Math.round((start + (grid.cx.length - 1) * step) * 1000) / 1000, ...grid };
}

// Centred moving average; `r` samples each side.
function smooth(values, r) {
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(values.length - 1, i + r); k++) { sum += values[k]; n++; }
    return sum / n;
  });
}

// ------------------------------------------------------------ following

// Where a track is at time t (held at its ends).
export function at(track, t, step) {
  const f = Math.min(track.cx.length - 1, Math.max(0, (t - track.start) / step));
  const i = Math.floor(f);
  const k = f - i;
  const j = Math.min(i + 1, track.cx.length - 1);
  const lerp = (arr) => arr[i] + (arr[j] - arr[i]) * k;
  return { cx: lerp(track.cx), top: lerp(track.top), bottom: lerp(track.bottom) };
}

// The anchor point to follow over [from, to]: one person, or the whole group
// (its centre, the highest head, the lowest feet). `height` 0 = top of the
// head, 1 = bottom of the visible body. Returns [{ t, x, y }] every step.
export function followPath(people, which, { from, to, height = 0.3, offsetX = 0, offsetY = 0 }) {
  if (!people || !people.tracks?.length) return null;
  const step = people.step;
  const pick = which === "all" ? people.tracks : [people.tracks[Number(which) - 1]].filter(Boolean);
  if (!pick.length) return null;
  const path = [];
  for (let t = from; t <= to + 1e-6; t += step) {
    // The group only counts who is on screen at that moment.
    const live = pick.filter((tr) => t >= tr.start - step && t <= tr.end + step);
    const set = live.length ? live : pick;
    const pts = set.map((tr) => at(tr, t, step));
    const cx = pts.reduce((s, p) => s + p.cx, 0) / pts.length;
    const top = Math.min(...pts.map((p) => p.top));
    const bottom = Math.max(...pts.map((p) => p.bottom));
    path.push({ t: Math.round(t * 1000) / 1000, x: r1(cx + offsetX), y: r1(top + (bottom - top) * height + offsetY) });
  }
  return path;
}

// Fewer keyframes, same motion: drop the points a straight line through
// their neighbours already passes within `tolerance` pixels of
// (Ramer–Douglas–Peucker, in x and y against time).
export function simplifyPath(path, tolerance = 2) {
  if (path.length <= 2) return path;
  const keep = new Array(path.length).fill(false);
  keep[0] = keep[path.length - 1] = true;
  const stack = [[0, path.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const k = (path[i].t - path[a].t) / (path[b].t - path[a].t || 1);
      const dx = path[a].x + (path[b].x - path[a].x) * k - path[i].x;
      const dy = path[a].y + (path[b].y - path[a].y) * k - path[i].y;
      const d = Math.hypot(dx, dy);
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance) { keep[at] = true; stack.push([a, at], [at, b]); }
  }
  return path.filter((_, i) => keep[i]);
}

// GSAP calls that move `selector` along a path, relative to its first point.
export function pathTimeline(selector, path) {
  const out = [];
  const [first] = path;
  for (let i = 1; i < path.length; i++) {
    const p = path[i];
    const prev = path[i - 1];
    out.push(`      tl.to("${selector}", { x: ${r1(p.x - first.x)}, y: ${r1(p.y - first.y)}, duration: ${Math.round((p.t - prev.t) * 1000) / 1000}, ease: "none" }, ${prev.t});`);
  }
  return out.join("\n");
}
