// Effects that move the camera itself — the stage slides and zooms on the
// output frame (lib/stage-motion.mjs; compose.mjs applies the first one):
//
//   reframe     the frame follows the subject: a 16:9 clip exported in 9:16
//               keeps the person (or the clicked object) in the middle
//   stabilize   a spot of the scenery stays put: the shake of a handheld or
//               drone shot goes, with a slight zoom to hide the edges
//
// They draw nothing in the export. Stabilise shows a crosshair on its spot in
// the preview only (class studio-guide, made visible by server/player.mjs).

import { timingOf } from "./timing.mjs";
import { num, clamp, r1, unitOf } from "./util.mjs";
import { holdSeen } from "./keyframes.mjs";
import { PIN, pinAtField, pinnedPath, pinTimeline } from "./pins.mjs";
import { sourceFields, followBoxes, followsPeople } from "./follow.mjs";

// A camera does not jerk after every step of its subject: centred moving
// average over ±`radius` seconds (no lag), holding the last seen place while
// the subject is out of sight.
export function calm(path, radius) {
  if (!path || path.length < 3 || radius <= 0) return path;
  const held = holdSeen(path);
  const step = (path[path.length - 1].t - path[0].t) / (path.length - 1) || 0.1;
  const r = Math.max(1, Math.round(radius / step));
  return held.map((q, i) => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(held.length - 1, i + r); j++) {
      sx += held[j].x;
      sy += held[j].y;
      n++;
    }
    return { t: q.t, x: sx / n, y: sy / n, seen: true };
  });
}

const reframe = {
  type: "reframe",
  label: "Recadrage qui suit le sujet",
  hint: "Le cadre suit la personne (ou l'objet que tu cliques) : idéal pour sortir en 9:16 une vidéo filmée à l'horizontale sans couper le sujet. Choisis le format dans l'onglet Projet.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    ...sourceFields("person:1").filter((f) => !["x", "y", "pinFollow", "pinAt"].includes(f.key))
      .map((f) => (f.key === "source" ? { ...f, options: f.options.filter((o) => o.value !== PIN && o.value !== "fixed") } : f)),
    { key: "zoom", label: "Zoom", type: "range", min: 1, max: 2.5, step: 0.05, default: 1 },
    {
      key: "axis", label: "Suivre", type: "select", default: "both",
      options: [
        { value: "both", label: "Dans les deux sens" },
        { value: "x", label: "Horizontalement seulement" },
        { value: "y", label: "Verticalement seulement" },
      ],
    },
    { key: "smooth", label: "Fluidité", type: "range", min: 0, max: 1, step: 0.05, default: 0.6 },
  ],

  build(fx, video) {
    const p = fx.params;
    const t = timingOf(fx, video);
    const path = followBoxes(fx, video, t, { size: 0.2 });
    if (!path || !path.length) return null;
    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: "",
      html: "",
      init: "",
      timeline: "",
      stageMotion: {
        mode: "center",
        path: calm(path, 0.15 + clamp(num(p.smooth, 0.6), 0, 1) * 1.1),
        zoom: clamp(num(p.zoom, 1), 1, 4),
        axis: ["x", "y"].includes(p.axis) ? p.axis : "both",
        start: t.start, end: t.end, duration: video.duration,
      },
    };
  },
  needsTracks: followsPeople,
};

const stabilize = {
  type: "stabilize",
  label: "Stabilisation sur un point",
  hint: "Un endroit du décor reste immobile à l'écran : la vidéo à main levée ou au drone ne tremble plus. Fais glisser la cible sur un endroit net et bien visible (un bâtiment, un rocher). Un léger zoom cache les bords.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "x", label: "Horizontal (%)", type: "range", min: 0, max: 100, step: 0.1, default: 50 },
    { key: "y", label: "Vertical (%)", type: "range", min: 0, max: 100, step: 0.1, default: 50 },
    { key: "zoom", label: "Zoom (marge)", type: "range", min: 1, max: 1.8, step: 0.01, default: 1.12 },
    pinAtField(),
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const ax = video.width * clamp(num(p.x, 50), 0, 100) / 100;
    const ay = video.height * clamp(num(p.y, 50), 0, 100) / 100;
    const path = pinnedPath(video, fx.id, t);
    const u = unitOf(video);
    const size = Math.round(70 * u);
    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      // The crosshair: on the spot, moving with it on the stage — so it
      // stays still on screen. Seen in the preview only.
      css: `
      #${id}-mv { position: absolute; inset: 0; z-index: 69; pointer-events: none; }
      #${id} { position: absolute; left: ${r1(ax - size / 2)}px; top: ${r1(ay - size / 2)}px; width: ${size}px; height: ${size}px;
        border: ${Math.max(2, Math.round(3 * u))}px solid #f5c518; border-radius: 50%; opacity: 0;
        box-shadow: 0 0 0 ${Math.max(1, Math.round(2 * u))}px rgba(0,0,0,.6); }
      #${id}::before, #${id}::after { content: ""; position: absolute; background: #f5c518; }
      #${id}::before { left: 50%; top: -30%; width: ${Math.max(2, Math.round(3 * u))}px; height: 160%; transform: translateX(-50%); }
      #${id}::after { top: 50%; left: -30%; height: ${Math.max(2, Math.round(3 * u))}px; width: 160%; transform: translateY(-50%); }`,
      html: `
      <div id="${id}-mv" class="clip" data-start="0" data-duration="${video.duration}" data-track-index="40" data-layout-allow-overflow>
        <div id="${id}" class="studio-guide" data-drag="${id}"></div><i id="${id}-anchor" style="position:absolute;left:${r1(ax)}px;top:${r1(ay)}px"></i>
      </div>`,
      init: "",
      // The crosshair shows only during the window (visibility: the preview
      // forces its opacity).
      timeline: [
        `      tl.set("#${id}", { visibility: "hidden" }, 0);`,
        `      tl.set("#${id}", { visibility: "visible" }, ${t.start});`,
        `      tl.set("#${id}", { visibility: "hidden" }, ${t.end});`,
        path ? pinTimeline(`#${id}-mv`, path, { x: ax, y: ay }) : "",
      ].filter(Boolean).join("\n"),
      // Where the spot is at each moment; while it is out of sight, where it
      // was last seen (the frame then stops compensating).
      stageMotion: path ? {
        mode: "lock",
        path: holdSeen(path),
        at: { x: ax, y: ay },
        zoom: clamp(num(p.zoom, 1.12), 1, 3),
        start: t.start, end: t.end, duration: video.duration,
      } : null,
    };
  },
  // Always pinned: a drop of the crosshair re-pins it, at that moment.
  drag: { stage: true, pin: true },
  pin: {},
};

export const CAMERA_EFFECTS = [reframe, stabilize];
