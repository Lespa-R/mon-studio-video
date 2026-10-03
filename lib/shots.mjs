// Splitting a long rush into shots (PySceneDetect, tools/scenes.py).
//
// The detector returns where the picture changes; the user then keeps the
// shots he wants, merges those cut too finely, and each kept shot becomes a
// clip of its own, next to the rush (which stays as it is).
//
// Pure functions only; lib/media.mjs runs the detector and cuts the files.

const r3 = (n) => Math.round(n * 1000) / 1000;

export const SENSITIVITIES = [
  { value: "fine", label: "Fine (plus de plans)" },
  { value: "normal", label: "Normale" },
  { value: "coarse", label: "Large (moins de plans)" },
];

// Shots inside [0, duration], in order, none overlapping, none shorter than
// minLen (a shorter one is merged into the shot before it).
export function normaliseShots(shots, duration, minLen = 0.3) {
  const list = (Array.isArray(shots) ? shots : [])
    .map((s) => ({ start: Math.max(0, Number(s?.start)), end: Math.min(duration, Number(s?.end)) }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const s of list) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) s.start = last.end;
    if (s.end - s.start <= 0) continue;
    if (s.end - s.start < minLen && last) { last.end = Math.max(last.end, s.end); continue; }
    out.push({ ...s });
  }
  // A short first shot joins the next one.
  if (out.length > 1 && out[0].end - out[0].start < minLen) {
    out[1].start = out[0].start;
    out.shift();
  }
  return out.slice(0, 200).map((s) => ({ start: r3(s.start), end: r3(s.end) }));
}

// The name of the n-th shot clip (1-based) of a rush called `name`.
export function shotName(name, n) {
  const stem = String(name || "Rush").replace(/\.[a-z0-9]{2,4}$/i, "");
  return `${stem} — plan ${n}`;
}
