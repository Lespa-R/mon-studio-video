// Image effects — treatments applied to the footage itself rather than
// graphics laid over it.
//
// Two ways to touch the picture:
//
//   filters: { footage: [...], bg: [...] }
//       CSS filter functions. `footage` hits both the background and the
//       cut-out person so they stay identical; `bg` hits the background only,
//       which is how the background blur keeps you sharp.
//       compose.mjs concatenates them, so several effects stack cleanly.
//
//   bgScale: 1.02
//       A static scale on the background. Blur samples past the element's
//       edges and leaves them translucent; a slight overscan hides that.
//
// Plus the usual `html` / `css` / `timeline` for overlay effects.
//
// Stacking above the footage: tint 55 · vignette 80 · grain 82 ·
// letterbox 88 · fade 90.

import { timingOf, overlayTimeline } from "./timing.mjs";

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// ------------------------------------------------------------------- grade

const grade = {
  type: "grade",
  label: "Étalonnage",
  hint: "Exposition, contraste, saturation et température. S'applique à tout le clip.",
  needsMatte: false,
  timed: false,
  layer: "front",
  schema: [
    { key: "brightness", label: "Exposition", type: "range", min: 0.5, max: 1.6, step: 0.01, default: 1 },
    { key: "contrast", label: "Contraste", type: "range", min: 0.5, max: 1.8, step: 0.01, default: 1.06 },
    { key: "saturation", label: "Saturation", type: "range", min: 0, max: 2, step: 0.01, default: 1.05 },
    { key: "warmth", label: "Température", type: "range", min: -1, max: 1, step: 0.02, default: 0 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const warmth = num(p.warmth, 0);
    const tint = Math.abs(warmth);

    const footage = [
      `brightness(${num(p.brightness, 1)})`,
      `contrast(${num(p.contrast, 1.06)})`,
      `saturate(${num(p.saturation, 1.05)})`,
    ];

    if (tint < 0.02) {
      return { layer: "front", needsMatte: false, filters: { footage }, css: "", html: "", init: "", timeline: "" };
    }

    // A blended wash reads far better than hue-rotate, which skews skin tones.
    const colour = warmth > 0 ? "#ff9a3c" : "#3ca0ff";
    return {
      layer: "front",
      needsMatte: false,
      filters: { footage },
      css: `
      #${id} {
        z-index: 55;
        background: ${colour};
        mix-blend-mode: soft-light;
        opacity: ${(tint * 0.62).toFixed(3)};
      }`,
      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.domDuration ?? video.duration}"
        data-track-index="10"></div>`,
      init: "",
      timeline: "",
    };
  },
};

// ---------------------------------------------------------------- bg-blur

const bgBlur = {
  type: "bg-blur",
  label: "Flou d'arrière-plan",
  hint: "Floute la pièce derrière toi et te garde net. Nécessite la découpe. S'applique à tout le clip.",
  needsMatte: true,
  timed: false,
  layer: "front",
  schema: [
    { key: "amount", label: "Intensité (px)", type: "range", min: 0, max: 40, step: 1, default: 14 },
  ],

  build(fx, video) {
    const amount = num(fx.params.amount, 14);
    if (amount <= 0) {
      return { layer: "front", needsMatte: true, css: "", html: "", init: "", timeline: "" };
    }
    return {
      layer: "front",
      needsMatte: true,
      filters: { bg: [`blur(${amount}px)`] },
      // Overscan just enough to push the blur's translucent edges off-frame.
      bgScale: 1 + (amount * 3) / video.width,
      css: "",
      html: "",
      init: "",
      timeline: "",
    };
  },
};

// ---------------------------------------------------------------- vignette

const vignette = {
  type: "vignette",
  space: "canvas",
  label: "Vignettage",
  hint: "Assombrit les bords pour ramener l'œil au centre.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "amount", label: "Intensité", type: "range", min: 0, max: 1, step: 0.02, default: 0.45 },
    { key: "size", label: "Ouverture", type: "range", min: 0.2, max: 0.9, step: 0.02, default: 0.5 },
  ],

  build(fx, video) {
    const id = fx.id;
    const amount = num(fx.params.amount, 0.45);
    const size = num(fx.params.size, 0.5);
    const t = timingOf(fx, video);
    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `
      #${id} {
        z-index: 80;
        opacity: 0;
        background: radial-gradient(ellipse at center,
          rgba(0,0,0,0) ${Math.round(size * 100)}%,
          rgba(0,0,0,${(amount * 0.55).toFixed(3)}) ${Math.round(size * 100 + 26)}%,
          rgba(0,0,0,${amount.toFixed(3)}) 100%);
      }`,
      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.domDuration ?? video.duration}"
        data-track-index="11"></div>`,
      init: "",
      timeline: overlayTimeline(`#${id}`, t, 1),
    };
  },
};

// ------------------------------------------------------------------- grain

// feTurbulence with a fixed seed gives the same texture on every run, so the
// render stays deterministic — no Math.random anywhere.
const NOISE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E" +
  "%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' " +
  "numOctaves='3' stitchTiles='stitch' seed='7'/%3E" +
  "%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E" +
  "%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E";

const grain = {
  type: "grain",
  space: "canvas",
  label: "Grain argentique",
  hint: "Texture de pellicule. Casse les aplats un peu plats des webcams.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "amount", label: "Intensité", type: "range", min: 0, max: 0.6, step: 0.01, default: 0.16 },
    { key: "size", label: "Grosseur", type: "range", min: 0.5, max: 3, step: 0.1, default: 1 },
    { key: "fps", label: "Scintillement (/s)", type: "range", min: 0, max: 24, step: 1, default: 12 },
  ],

  build(fx, video) {
    const id = fx.id;
    const amount = num(fx.params.amount, 0.16);
    const size = num(fx.params.size, 1);
    const flicker = num(fx.params.fps, 12);
    const tile = Math.round(300 * size);
    const t = timingOf(fx, video);
    const steps = Math.max(1, Math.round(t.duration * flicker));

    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `
      #${id} {
        z-index: 82;
        background-image: url("${NOISE}");
        background-size: ${tile}px ${tile}px;
        background-repeat: repeat;
        mix-blend-mode: overlay;
        opacity: 0;
        will-change: background-position, opacity;
      }`,
      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.domDuration ?? video.duration}"
        data-track-index="12"></div>`,
      init: "",
      // A stepped tween across the instance's own window: finite, seekable, and
      // it jumps the texture `flicker` times a second the way real grain does.
      // An infinite repeat would give the root timeline an infinite duration.
      timeline: overlayTimeline(`#${id}`, t, amount.toFixed(3)) + (flicker > 0 ? `
      tl.fromTo("#${id}",
        { backgroundPosition: "0px 0px" },
        { backgroundPosition: "${tile * 7}px ${tile * 11}px",
          duration: ${t.duration}, ease: "steps(${steps})" },
        ${t.start});` : ""),
    };
  },
};

// --------------------------------------------------------------- letterbox

const RATIOS = [
  { value: "2.39", label: "2.39 : 1 (scope)" },
  { value: "2.00", label: "2.00 : 1" },
  { value: "1.85", label: "1.85 : 1" },
  { value: "1.60", label: "16 : 10" },
];

const letterbox = {
  type: "letterbox",
  space: "canvas",
  label: "Bandes cinéma",
  hint: "Barres haut et bas pour recadrer en format large.",
  needsMatte: false,
  timed: true,
  layer: "top",
  schema: [
    { key: "ratio", label: "Format", type: "select", default: "2.39", options: RATIOS },
    { key: "color", label: "Couleur", type: "color", default: "#000000" },
  ],

  build(fx, video) {
    const id = fx.id;
    const ratio = num(fx.params.ratio, 2.39);
    const colour = esc(fx.params.color || "#000000");
    const bar = Math.max(0, Math.round((video.height - video.width / ratio) / 2));
    if (!bar) return null;
    const t = timingOf(fx, video);

    return {
      layer: "top",
      needsMatte: false,
      timing: t,
      css: `
      #${id} {
        z-index: 88;
        opacity: 0;
        background: linear-gradient(to bottom,
          ${colour} 0, ${colour} ${bar}px,
          rgba(0,0,0,0) ${bar}px,
          rgba(0,0,0,0) ${video.height - bar}px,
          ${colour} ${video.height - bar}px, ${colour} 100%);
      }`,
      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.domDuration ?? video.duration}"
        data-track-index="13"></div>`,
      init: "",
      timeline: overlayTimeline(`#${id}`, t, 1),
    };
  },
};

export const IMAGE_EFFECTS = [grade, bgBlur, vignette, grain, letterbox];
