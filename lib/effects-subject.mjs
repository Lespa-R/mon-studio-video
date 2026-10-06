// Effects built on the subject's cut-out — the person, or the object chosen in
// « Découpe » (media/<id>-fg.webm, the "fg" layer at z-index 50):
//
//   subject-glow   a neon halo or outline hugging the silhouette
//   color-pop      the scenery turns black & white, the subject keeps its colours
//   pop-out        a frame behind the subject, who spills over its edges
//   motion-echo    delayed copies of the subject trail behind its moves
//
// They sit on the stage (source pixels). The cut-out itself is a video with
// an alpha channel, so a copy of it can carry a CSS filter (drop-shadow makes
// a halo) or be shown a little later (an echo). Anything meant to stay under
// the subject uses a z-index below 50; the scenery's layers are 1–2, text
// behind the subject 10–11.
//
// Same rules as every effect: elements span the whole clip (or, for the
// delayed copies, their exact stretch), GSAP decides what shows, every tween
// is finite and nothing is random.

import { timingOf, overlayTimeline } from "./timing.mjs";
import { paint, paintAlpha } from "./brand.mjs";
import { num, clamp, r3, unitOf } from "./util.mjs";

// The cut-out file, given by compose; without one there is nothing to copy.
const fgOf = (video) => video.files?.fg || `${video.id}-fg.webm`;

// A gentle breathing of the opacity between the fades (overlayTimeline's,
// `ramp` long), a millisecond clear of each: whole cycles only, so it ends
// where it began (finite repeats, never infinite), about `cycle` long —
// stretched or squeezed a little so they fill the stretch exactly.
function pulse(sel, t, low, cycle, ramp = 0.4) {
  ramp = Math.min(ramp, t.duration / 3);
  const span = t.duration - ramp * 2 - 0.002;
  const n = Math.round(span / cycle);
  if (n < 1) return "";
  const half = Math.floor((span / n / 2) * 1000) / 1000;
  return `
      tl.to("${sel}", { opacity: ${low}, duration: ${half}, ease: "sine.inOut", repeat: ${n * 2 - 1}, yoyo: true }, ${r3(t.start + ramp + 0.001)});`;
}

// ------------------------------------------------------------- subject-glow

const subjectGlow = {
  type: "subject-glow",
  label: "Halo néon",
  hint: "Un contour lumineux épouse la silhouette de la personne (ou de l'objet choisi dans « Découpe ») et la suit. Nécessite la découpe.",
  needsMatte: true,
  timed: true,
  layer: "behind",
  schema: [
    { key: "color", label: "Couleur", type: "color", default: "brand:primary" },
    {
      key: "style", label: "Style", type: "select", default: "glow",
      options: [
        { value: "glow", label: "Halo lumineux" },
        { value: "outline", label: "Contour net" },
        { value: "both", label: "Contour et halo" },
      ],
    },
    { key: "size", label: "Épaisseur", type: "range", min: 0.5, max: 3, step: 0.05, default: 1 },
    { key: "intensity", label: "Intensité", type: "range", min: 0.2, max: 1, step: 0.05, default: 0.9 },
    {
      key: "pulse", label: "Pulsation", type: "select", default: "soft",
      options: [
        { value: "none", label: "Aucune" },
        { value: "soft", label: "Douce" },
        { value: "strong", label: "Marquée" },
      ],
    },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const u = unitOf(video) * clamp(num(p.size, 1), 0.2, 5);
    const c = paint(p.color, "brand:primary");
    const w = Math.max(1, Math.round(3 * u));
    const outline = [`${w}px 0 0 ${c}`, `-${w}px 0 0 ${c}`, `0 ${w}px 0 ${c}`, `0 -${w}px 0 ${c}`];
    const glow = [`0 0 ${Math.round(4 * u)}px ${c}`, `0 0 ${Math.round(12 * u)}px ${c}`, `0 0 ${Math.round(28 * u)}px ${c}`];
    const shadows = p.style === "outline" ? outline : p.style === "both" ? [...outline, ...glow] : glow;
    const peak = clamp(num(p.intensity, 0.9), 0.1, 1);
    const cycle = p.pulse === "strong" ? 0.9 : 1.6;
    return {
      layer: "behind",
      needsMatte: true,
      timing: t,
      // Under the real cut-out (50): only what spills past the silhouette shows.
      css: `
      #${id} { z-index: 49; opacity: 0; filter: ${shadows.map((s) => `drop-shadow(${s})`).join(" ")}; }`,
      // A copy of the cut-out over the window only (decoded then, and not
      // a twin of #fg the renderer would discover twice).
      html: `
      <video id="${id}" class="clip" data-start="${t.start}" data-duration="${t.duration}" data-media-start="${t.start}"
        src="media/${fgOf(video)}" muted></video>`,
      init: "",
      timeline: overlayTimeline(`#${id}`, t, peak, 0.4) + (p.pulse === "none" ? "" : pulse(`#${id}`, t, r3(peak * (p.pulse === "strong" ? 0.35 : 0.65)), cycle)),
    };
  },
};

// --------------------------------------------------------------- color-pop

const DECOR = {
  bw: { label: "Noir et blanc", filter: "grayscale(1) contrast(1.08)" },
  dark: { label: "Noir et blanc assombri", filter: "grayscale(1) brightness(0.55)" },
  sepia: { label: "Sépia", filter: "sepia(0.85) contrast(1.05)" },
  muted: { label: "Couleurs ternies", filter: "saturate(0.25)" },
};

const colorPop = {
  type: "color-pop",
  label: "Couleur sur le sujet",
  hint: "Le décor passe en noir et blanc (ou sépia, ou terni), la personne ou l'objet choisi garde ses couleurs. Nécessite la découpe.",
  needsMatte: true,
  timed: true,
  layer: "behind",
  schema: [
    {
      key: "decor", label: "Décor", type: "select", default: "bw",
      options: Object.entries(DECOR).map(([value, d]) => ({ value, label: d.label })),
    },
    { key: "ramp", label: "Transition (s)", type: "number", min: 0, step: 0.1, default: 0.6 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const decor = DECOR[p.decor] || DECOR.bw;
    return {
      layer: "behind",
      needsMatte: true,
      timing: t,
      // A pane over the scenery only (z 9: under text behind the subject at
      // 10–11 and the subject at 50) that filters what is behind it.
      css: `
      #${id} { z-index: 9; opacity: 0; pointer-events: none;
        backdrop-filter: ${decor.filter}; -webkit-backdrop-filter: ${decor.filter}; }`,
      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}" data-track-index="2"></div>`,
      init: "",
      timeline: overlayTimeline(`#${id}`, t, 1, Math.max(0.05, num(p.ramp, 0.6))),
    };
  },
};

// ------------------------------------------------------------------ pop-out

// A rounded rectangle as an SVG path, clockwise.
function roundRect(x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M ${x + k} ${y} H ${x + w - k} A ${k} ${k} 0 0 1 ${x + w} ${y + k} V ${y + h - k} A ${k} ${k} 0 0 1 ${x + w - k} ${y + h} `
    + `H ${x + k} A ${k} ${k} 0 0 1 ${x} ${y + h - k} V ${y + k} A ${k} ${k} 0 0 1 ${x + k} ${y} Z`;
}

const popOut = {
  type: "pop-out",
  label: "Sortie du cadre (effet 3D)",
  hint: "Un cadre derrière la personne : autour, l'image s'assombrit ; elle déborde du cadre comme si elle en sortait. Fais glisser le cadre sur l'aperçu. Nécessite la découpe.",
  needsMatte: true,
  timed: true,
  layer: "behind",
  schema: [
    { key: "x", label: "Centre horizontal (%)", type: "range", min: 0, max: 100, step: 0.5, default: 50 },
    { key: "y", label: "Centre vertical (%)", type: "range", min: 0, max: 100, step: 0.5, default: 55 },
    { key: "w", label: "Largeur (%)", type: "range", min: 10, max: 100, step: 0.5, default: 62 },
    { key: "h", label: "Hauteur (%)", type: "range", min: 10, max: 100, step: 0.5, default: 48 },
    { key: "color", label: "Bordure", type: "color", default: "brand:text" },
    { key: "border", label: "Épaisseur de la bordure", type: "range", min: 0, max: 30, step: 1, default: 10 },
    { key: "radius", label: "Arrondi", type: "range", min: 0, max: 0.5, step: 0.01, default: 0.06 },
    {
      key: "outside", label: "Autour du cadre", type: "select", default: "dark",
      options: [
        { value: "dark", label: "Assombri" },
        { value: "blur", label: "Flou et assombri" },
        { value: "color", label: "Couleur de la charte" },
      ],
    },
    { key: "amount", label: "Intensité", type: "range", min: 0, max: 1, step: 0.05, default: 0.65 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const W = video.width;
    const H = video.height;
    const u = unitOf(video);
    const w = W * clamp(num(p.w, 62), 1, 100) / 100;
    const h = H * clamp(num(p.h, 48), 1, 100) / 100;
    const x = W * clamp(num(p.x, 50), 0, 100) / 100 - w / 2;
    const y = H * clamp(num(p.y, 55), 0, 100) / 100 - h / 2;
    const radius = Math.min(w, h) * clamp(num(p.radius, 0.06), 0, 0.5);
    const border = Math.round(clamp(num(p.border, 10), 0, 60) * u);
    const amount = clamp(num(p.amount, 0.65), 0, 1);
    const fill = p.outside === "color" ? paintAlpha("brand:surface", Math.max(0.4, amount)) : `rgba(4,8,14,${r3(amount)})`;
    const blur = p.outside === "blur" ? `backdrop-filter: blur(${Math.round(14 * u)}px); -webkit-backdrop-filter: blur(${Math.round(14 * u)}px);` : "";
    // The whole frame minus the card (even-odd): the shade around it.
    const hole = `M 0 0 H ${W} V ${H} H 0 Z ${roundRect(r3(x), r3(y), r3(w), r3(h), r3(radius))}`;
    const ramp = t.full ? 0.001 : r3(Math.min(0.5, t.duration / 4));
    return {
      layer: "behind",
      needsMatte: true,
      timing: t,
      css: `
      #${id}-shade { z-index: 8; opacity: 0; background: ${fill}; ${blur}
        clip-path: path(evenodd, "${hole}"); pointer-events: none; }
      #${id} { position: absolute; inset: auto; left: ${r3(x)}px; top: ${r3(y)}px; width: ${r3(w)}px; height: ${r3(h)}px;
        z-index: 12; border: ${border}px solid ${paint(p.color, "brand:text")}; border-radius: ${r3(radius)}px;
        box-shadow: 0 ${Math.round(18 * u)}px ${Math.round(50 * u)}px rgba(0,0,0,.45); opacity: 0; }`,
      html: `
      <div id="${id}-shade" class="clip" data-start="0" data-duration="${video.duration}" data-track-index="2"></div>
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}" data-track-index="3"
        data-drag="${id}"></div>`,
      init: "",
      timeline: `
      tl.fromTo("#${id}-shade", { opacity: 0 }, { opacity: 1, duration: ${ramp}, ease: "power2.out" }, ${t.start});
      tl.fromTo("#${id}", { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: ${ramp}, ease: "back.out(1.6)" }, ${t.start});
      tl.to("#${id}, #${id}-shade", { opacity: 0, duration: ${ramp}, ease: "power2.in" }, ${r3(Math.max(t.start + ramp, t.end - ramp))});`,
    };
  },
  // Dragging the frame moves its centre.
  drag: { stage: true, xy: true },
};

// -------------------------------------------------------------- motion-echo

const ECHO_STYLES = [
  { value: "ghost", label: "Fantômes (copies de l'image)" },
  { value: "color", label: "Silhouettes de couleur" },
  { value: "white", label: "Silhouettes blanches" },
];

const motionEcho = {
  type: "motion-echo",
  label: "Écho de mouvement",
  hint: "Des copies de la personne (ou de l'objet choisi) suivent ses gestes avec un léger retard : une traînée quand elle bouge, rien quand elle est immobile. Nécessite la découpe.",
  needsMatte: true,
  timed: true,
  layer: "behind",
  schema: [
    { key: "copies", label: "Nombre de copies", type: "range", min: 1, max: 6, step: 1, default: 4 },
    { key: "gap", label: "Retard entre deux copies (s)", type: "range", min: 0.03, max: 0.4, step: 0.01, default: 0.1 },
    { key: "style", label: "Style", type: "select", default: "ghost", options: ECHO_STYLES },
    { key: "color", label: "Couleur", type: "color", default: "brand:primary", showIf: { key: "style", values: ["color"] } },
    { key: "opacity", label: "Opacité de la première copie", type: "range", min: 0.1, max: 1, step: 0.05, default: 0.55 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const n = clamp(Math.round(num(p.copies, 4)), 1, 8);
    const gap = clamp(num(p.gap, 0.1), 0.02, 1);
    const first = clamp(num(p.opacity, 0.55), 0.05, 1);
    const copies = [];
    for (let k = 1; k <= n; k++) {
      // Copy k shows the subject k × gap seconds late: it starts k × gap
      // into the window, playing the footage from the window's start.
      const start = r3(t.start + k * gap);
      if (start >= t.end - 0.05) break;
      copies.push({ k, start, duration: r3(t.end - start), opacity: r3(first * (1 - (k - 1) / n)) });
    }
    if (!copies.length) return null;
    const tint = p.style === "color" || p.style === "white";
    const flood = p.style === "white" ? "#ffffff" : paint(p.color, "brand:primary");
    return {
      layer: "behind",
      needsMatte: true,
      timing: t,
      css: `
${copies.map((c) => `      #${id}-${c.k} { z-index: ${49 - c.k}; opacity: 0;${tint ? ` filter: url(#${id}-tint);` : ""} }`).join("\n")}${tint ? `
      #${id}-defs { position: absolute; width: 0; height: 0; }
      #${id}-defs feFlood { flood-color: ${flood}; }` : ""}`,
      html: `${tint ? `
      <svg id="${id}-defs" aria-hidden="true"><filter id="${id}-tint" color-interpolation-filters="sRGB">
        <feFlood /><feComposite in2="SourceAlpha" operator="in" /></filter></svg>` : ""}
${copies.map((c) => `      <video id="${id}-${c.k}" class="clip" data-start="${c.start}" data-duration="${c.duration}"
        data-media-start="${r3(t.start)}" src="media/${fgOf(video)}" muted></video>`).join("\n")}`,
      init: "",
      // Each copy fades in and out inside its own stretch.
      timeline: copies.map((c) => overlayTimeline(`#${id}-${c.k}`, { ...t, start: c.start, duration: c.duration, full: false }, c.opacity, 0.15)).join(""),
    };
  },
};

export const SUBJECT_EFFECTS = [subjectGlow, colorPop, popOut, motionEcho];
