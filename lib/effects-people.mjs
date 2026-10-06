// Name tags that follow people: one label per tracked person, left to right,
// above their head, on their chest or under them — and moving with them.
//
// Stage space (source pixels): the tracks were measured on the source frame,
// and the stage carries the tags through any recrop exactly like the people.
// Each tag sits in a "mover" that GSAP slides along the person's path; the tag
// itself only fades and pops, so the two transforms never fight.

import { timingOf } from "./timing.mjs";
import { paint, paintAlpha } from "./brand.mjs";
import { followPath, simplifyPath, pathTimeline } from "./tracking.mjs";
import { esc, num, clamp, r3, viewOf } from "./util.mjs";

// Where on the person the tag hangs: `height` along head → feet, and which
// point of the tag touches it.
// The anchoring is given to GSAP as xPercent / yPercent, not as a CSS
// translate: GSAP would read that back in pixels and add its own on top.
const PLACES = {
  above: { height: 0, yPercent: -100, gap: -1 },
  chest: { height: 0.45, yPercent: -50, gap: 0 },
  below: { height: 1, yPercent: 0, gap: 1 },
};

export const personTags = {
  type: "person-tags",
  label: "Étiquettes des personnes",
  hint: "Un nom accroché à chaque personne, qui la suit quand elle bouge. Les personnes sont numérotées de gauche à droite.",
  category: "Textes",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "names", label: "Noms (séparés par /)", type: "text", default: "Alice / Bruno / Chloé" },
    { key: "roles", label: "Fonctions (séparées par /)", type: "text", default: "" },
    {
      key: "place", label: "Position", type: "select", default: "above",
      options: [
        { value: "above", label: "Au-dessus de la tête" },
        { value: "chest", label: "Sur le buste" },
        { value: "below", label: "Sous la personne" },
      ],
    },
    { key: "accent", label: "Accent", type: "color", default: "brand:primary" },
    { key: "size", label: "Taille", type: "range", min: 0.5, max: 2.5, step: 0.05, default: 1 },
    { key: "ox", label: "Décalage horizontal (%)", type: "range", min: -50, max: 50, step: 0.5, default: 0 },
    { key: "oy", label: "Décalage vertical (%)", type: "range", min: -50, max: 50, step: 0.5, default: 0 },
  ],

  build(fx, video) {
    const tracks = video.people?.tracks || [];
    const names = String(fx.params.names || "").split("/").map((s) => s.trim());
    const roles = String(fx.params.roles || "").split("/").map((s) => s.trim());
    if (!tracks.length || !names.some(Boolean)) return null;

    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const view = viewOf(video);
    const u = (Math.min(view.w, view.h) / 720) * clamp(num(p.size, 1), 0.3, 4);
    const place = PLACES[p.place] || PLACES.above;
    const gap = Math.round(14 * u) * place.gap;
    const offsetX = (num(p.ox, 0) / 100) * video.width;
    const offsetY = (num(p.oy, 0) / 100) * video.height + gap;

    const tags = [];
    tracks.forEach((track, i) => {
      const name = names[i];
      if (!name) return;
      // Only while this person is on screen, inside the effect's window.
      const from = Math.max(t.start, track.start);
      const to = Math.min(t.end, track.end);
      if (to - from < 0.3) return;
      const path = followPath(video.people, String(i + 1), { from, to, height: place.height, offsetX, offsetY });
      if (!path) return;
      // "Under the person" is often the bottom edge of the frame: keep the
      // tag's top inside the visible part.
      const floor = view.y + view.h - 70 * u;
      for (const pt of path) pt.y = Math.min(pt.y, floor);
      tags.push({ i, name, role: roles[i] || "", path, from, to });
    });
    if (!tags.length) return null;

    const html = tags.map(({ i, name, role, path }) => `
      <div id="${id}-m${i}" class="${id}-m">
        <div id="${id}-t${i}" class="${id}-t" data-drag="${id}" style="left: ${Math.round(path[0].x)}px; top: ${Math.round(path[0].y)}px">
          <div class="${id}-n">${esc(name)}</div>${role ? `<div class="${id}-r">${esc(role)}</div>` : ""}
        </div>
      </div>`).join("");

    const timeline = tags.map(({ i, path, from, to }) => {
      const fade = r3(Math.min(0.3, (to - from) / 4));
      return `
${pathTimeline(`#${id}-m${i}`, simplifyPath(path))}
      tl.fromTo("#${id}-t${i}", { opacity: 0, scale: 0.7, xPercent: -50, yPercent: ${place.yPercent} },
        { opacity: 1, scale: 1, xPercent: -50, yPercent: ${place.yPercent}, duration: ${fade}, ease: "back.out(2)" }, ${r3(from)});
      tl.to("#${id}-t${i}", { opacity: 0, scale: 0.8, duration: ${fade}, ease: "power2.in" }, ${r3(to - fade)});`;
    }).join("");

    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `
      #${id} { z-index: 63; pointer-events: none; }
      #${id} .${id}-m { position: absolute; inset: 0; }
      #${id} .${id}-t {
        position: absolute; opacity: 0; white-space: nowrap; text-align: center;
        padding: ${Math.round(8 * u)}px ${Math.round(16 * u)}px; border-radius: ${Math.round(12 * u)}px;
        background: ${paintAlpha("brand:surface", 0.78)}; color: var(--brand-text);
        border-bottom: ${Math.max(2, Math.round(4 * u))}px solid ${paint(p.accent, "brand:primary")};
        box-shadow: 0 8px 22px rgba(6,12,22,.35);
      }
      #${id} .${id}-n { font-family: var(--font-title); font-weight: 800; font-size: ${Math.round(26 * u)}px; line-height: 1.15; }
      #${id} .${id}-r { font-family: var(--font-body); font-size: ${Math.round(16 * u)}px; opacity: .78; margin-top: ${Math.round(2 * u)}px; }`,
      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}" data-track-index="36">${html}
      </div>`,
      init: "",
      timeline,
    };
  },
  // Dragging moves every tag by the same offset (ox / oy).
  drag: { stage: true, offset: true },
  needsTracks: () => true,
};
