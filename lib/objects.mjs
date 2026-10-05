// « Objet choisi »: the object clicked in a clip, followed by SAM 2.
//
//   video.matteOptions = { model: "person" | "subject" | "none", object: { t, points } | null, … }
//
// `points` are clicks on the frame at time `t` (x, y in 0..1; l = 1 "this",
// 0 "not this"); `level` the size picked for a single click (0 a part,
// 1 medium, 2 the whole object — SAM 2 proposes the three). model "none" keeps the object alone in front of the text;
// "person" / "subject" keep it next to the person.
//
// Pure functions only.

const r3 = (n) => Math.round(n * 1000) / 1000;

// What the cut-out choice menu offers, and the options behind each entry.
export const CUTOUT_CHOICES = [
  { value: "person", label: "Personne seule", model: "person", object: false },
  { value: "subject", label: "Personne + objets tenus", model: "subject", object: false },
  { value: "object", label: "Objet choisi", model: "none", object: true },
  { value: "person-object", label: "Personne + objet choisi", model: "person", object: true },
];

// The menu entry matching a clip's options.
export function cutoutChoice(opts = {}) {
  if (opts.object) return opts.model === "none" ? "object" : "person-object";
  return opts.model === "subject" ? "subject" : "person";
}

// A clean { t, points } inside the clip, or null.
export function normaliseObject(obj, duration) {
  if (!obj || !Array.isArray(obj.points)) return null;
  const points = obj.points
    .map((p) => ({ x: Number(p?.x), y: Number(p?.y), l: p?.l === 0 || p?.l === false ? 0 : 1 }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
    .slice(0, 20)
    .map((p) => ({ x: r3(p.x), y: r3(p.y), l: p.l }));
  if (!points.some((p) => p.l === 1)) return null;
  const t = Math.min(Math.max(0, Number(obj.t) || 0), Math.max(0, duration - 0.01));
  const level = [0, 1, 2].includes(Number(obj.level)) ? Number(obj.level) : 2;
  return { t: r3(t), points, level };
}
