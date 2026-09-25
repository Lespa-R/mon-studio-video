// The effect catalogue.
//
// Each effect is a pure function of (instance, video) returning the CSS,
// markup, setup script and GSAP calls to splice into a composition. Nothing
// here touches the filesystem — compose.mjs assembles the fragments.
//
// TIMING lives on the instance, not in params: `fx.start` and `fx.duration`
// (null = to the end of the clip). That is what the timeline strip in the UI
// edits. Effects flagged `timed: false` are treatments that apply to the whole
// clip — see effects-image.mjs for why.
//
// Every element is declared for the FULL clip in data-start/data-duration, and
// GSAP alone controls when it is visible. Two reasons: the setup scripts
// measure rendered text, which fails on an element the runtime has hidden; and
// a fromTo renders immediately, so seeking before it leaves the target at its
// "from" state — opacity 0 — with no extra work.
//
// `layer` decides where the markup lands in the stack:
//   behind — under the cut-out person (needs a matte)
//   front  — over the footage and over the person
//   top    — over everything, including other front effects

import { IMAGE_EFFECTS } from "./effects-image.mjs";
import { ANIM_EFFECTS } from "./effects-anim.mjs";
import { captions } from "./effects-captions.mjs";
import { timingOf } from "./timing.mjs";
import { paint, paintAlpha } from "./brand.mjs";

export { timingOf };

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// A string literal safe to drop inside a <script>: JSON.stringify leaves "<"
// alone, so a text containing "</script>" would close the script early.
const jsString = (v) => JSON.stringify(String(v)).replace(/</g, "\\u003c");
const r3 = (n) => Number(n.toFixed(3));

// The part of the source frame that ends up on screen. Without a recrop it is
// the whole frame; compose.mjs sets it when the output format crops.
const viewOf = (video) => video.view || { x: 0, y: 0, w: video.width, h: video.height };

// Letters inside words: the letter animations target -ch, "mot par mot"
// targets -wd, and the words keep a line from breaking inside one.
function chars(text, cls) {
  return String(text)
    .split(" ")
    .map((word) => word
      ? `<span class="${cls}-wd">${[...word].map((ch) => `<span class="${cls}-ch">${esc(ch)}</span>`).join("")}</span>`
      : "")
    .join(`<span class="${cls}-sp"></span>`);
}

// Fit the line to the visible frame and put the top of the letterforms on an
// exact y. Both are measurements of the rendered font, so they give the same
// answer on every run — which the renderer requires.
//
// Everything is measured in the coordinates of the element's own stage. The
// stage may be scaled onto the canvas (a 16:9 clip recropped for 9:16 sits at
// ×1.78), and getBoundingClientRect() reports what is on screen — so each
// rect is mapped back through that scale before any arithmetic.
function fitAndPlace(id, text, { maxWidth, inkTop, scrimId, viewX, viewW }) {
  return `
      (function () {
        var el = document.getElementById(${jsString(id)});
        if (!el) return;
        var host = el.offsetParent || document.body;
        var hostRect = host.getBoundingClientRect();
        var k = hostRect.width / (host.offsetWidth || hostRect.width) || 1;
        var local = function (r) {
          return { left: (r.left - hostRect.left) / k, top: (r.top - hostRect.top) / k,
                   width: r.width / k, height: r.height / k };
        };

        var width = local(el.getBoundingClientRect()).width;
        if (width > ${maxWidth}) {
          el.style.fontSize =
            parseFloat(getComputedStyle(el).fontSize) * (${maxWidth} / width) + "px";
        }

        var probe = document.createElement("span");
        probe.style.cssText =
          "display:inline-block;width:0;height:0;vertical-align:baseline";
        el.appendChild(probe);
        var baselineY = local(probe.getBoundingClientRect()).top;
        probe.remove();

        var cs = getComputedStyle(el);
        var ctx = document.createElement("canvas").getContext("2d");
        ctx.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
        var m = ctx.measureText(${jsString(text)});
        var ascent = m.actualBoundingBoxAscent;
        var inkHeight = ascent + m.actualBoundingBoxDescent;

        el.style.top = parseFloat(cs.top) + (${inkTop} - (baselineY - ascent)) + "px";

        // Keep the line inside the visible part of the frame: after a recrop,
        // text anchored on the face can hang past the edge.
        var rect = local(el.getBoundingClientRect());
        var dx = 0;
        if (rect.left < ${viewX}) dx = ${viewX} - rect.left;
        else if (rect.left + rect.width > ${viewX + viewW}) dx = ${viewX + viewW} - (rect.left + rect.width);
        if (dx) {
          el.style.left = parseFloat(cs.left) + dx + "px";
          rect = local(el.getBoundingClientRect());
        }
${scrimId ? `
        var scrim = document.getElementById(${jsString(scrimId)});
        if (scrim) {
          var padX = inkHeight * 0.85;
          var padY = inkHeight * 0.75;
          scrim.style.left = rect.left - padX + "px";
          scrim.style.width = rect.width + padX * 2 + "px";
          scrim.style.top = ${inkTop} - padY + "px";
          scrim.style.height = inkHeight + padY * 2 + "px";
        }
` : ""}
      })();`;
}

// How a line of text comes in and goes out. Each style animates a unit —
// letters (ch), words (wd) or the whole line — from a hidden state to its
// place, and away again. All of them are plain fromTo/to tweens: seekable,
// finite, identical on every run.
export const TEXT_ANIMS = {
  "blur-rise": {
    label: "Flou montant", unit: "ch", ease: "power3.out", outEase: "power2.in",
    from: `opacity: 0, yPercent: 55, filter: "blur(14px)"`,
    to: `opacity: 1, yPercent: 0, filter: "blur(0px)"`,
    out: (up) => `opacity: 0, yPercent: ${up ? -40 : 40}, filter: "blur(12px)"`,
  },
  pop: {
    label: "Rebond", unit: "ch", ease: "back.out(2.4)", outEase: "back.in(1.8)",
    from: `opacity: 0, scale: 0.3, yPercent: 25`,
    to: `opacity: 1, scale: 1, yPercent: 0`,
    out: () => `opacity: 0, scale: 0.4`,
  },
  slide: {
    label: "Glissement", unit: "ch", ease: "power3.out", outEase: "power2.in",
    from: `opacity: 0, xPercent: -90`,
    to: `opacity: 1, xPercent: 0`,
    out: () => `opacity: 0, xPercent: 90`,
  },
  typewriter: {
    // Each letter snaps on; only the stagger sets the pace.
    label: "Machine à écrire", unit: "ch", ease: "none", outEase: "none", instant: true,
    from: `opacity: 0`,
    to: `opacity: 1`,
    out: () => `opacity: 0`,
  },
  words: {
    label: "Mot par mot", unit: "wd", ease: "power3.out", outEase: "power2.in",
    from: `opacity: 0, yPercent: 60, scale: 0.9`,
    to: `opacity: 1, yPercent: 0, scale: 1`,
    out: (up) => `opacity: 0, yPercent: ${up ? -50 : 50}`,
  },
  wipe: {
    // The whole line is uncovered left to right, and covered again to leave.
    // The negative insets leave room for the shadow and the accents.
    label: "Balayage", unit: "line", ease: "power3.inOut", outEase: "power3.inOut",
    from: `clipPath: "inset(-40% 100% -40% -6%)"`,
    to: `clipPath: "inset(-40% -6% -40% -6%)"`,
    out: () => `clipPath: "inset(-40% -6% -40% 100%)"`,
  },
};

const ANIM_OPTIONS = Object.entries(TEXT_ANIMS).map(([value, a]) => ({ value, label: a.label }));
const animOf = (key) => TEXT_ANIMS[key] || TEXT_ANIMS["blur-rise"];

// The CSS that goes with a style: what starts hidden, and how.
function textUnitCss(id, animKey) {
  const anim = animOf(animKey);
  const hidden = anim.unit === "line" ? "" : "opacity: 0;";
  return `
      #${id} .${id}-wd { display: inline-block; ${anim.unit === "wd" ? "opacity: 0; will-change: transform, opacity;" : ""} }
      #${id} .${id}-ch { display: inline-block; ${anim.unit === "ch" ? `${hidden} will-change: transform, opacity, filter;` : ""} }
      #${id} .${id}-sp { display: inline-block; width: 0.3em; }${anim.unit === "line" ? `
      #${id} { clip-path: inset(-40% 100% -40% -6%); }` : ""}`;
}

export function textTimeline(id, scrimId, t, { text = "", anim: animKey, reveal, stagger, exit, exitUp = true }) {
  const anim = animOf(animKey);
  const sel = anim.unit === "line" ? `#${id}` : `#${id} .${id}-${anim.unit}`;
  const units = anim.unit === "line" ? 1
    : anim.unit === "wd" ? String(text).split(" ").filter(Boolean).length
    : [...String(text)].filter((c) => c !== " ").length;
  if (anim.unit === "line") stagger = 0;
  if (anim.instant) reveal = 0.01;

  // A staggered animation lasts its duration plus one stagger per extra unit.
  // Entrance and exit must both fit inside the window — the exit in particular
  // has to be over by its end, or the last letters linger past it. When the
  // window is too short for both, everything is compressed by the same factor
  // rather than cut.
  const gaps = Math.max(0, units - 1);
  if (anim.instant && exit > 0) exit = 0.01;
  const need = reveal + stagger * gaps + (exit > 0 ? exit + stagger * gaps : 0);
  const k = need > t.duration ? t.duration / need : 1;
  reveal = Math.max(0.01, r3(reveal * k));
  exit = exit > 0 ? Math.max(0.01, r3(exit * k)) : 0;
  stagger = r3(stagger * k);

  const inAt = t.start;
  const outAt = r3(t.end - exit - stagger * gaps);

  let out = "";
  if (scrimId) {
    out += `
      tl.fromTo("#${scrimId}", { opacity: 0 },
        { opacity: 1, duration: ${r3(Math.min(0.6, Math.max(0.2, reveal)))}, ease: "power2.out" }, ${r3(Math.max(0, inAt - 0.05))});`;
  }
  out += `
      tl.fromTo("${sel}",
        { ${anim.from} },
        { ${anim.to}, duration: ${reveal}, ease: "${anim.ease}"${stagger ? `, stagger: ${stagger}` : ""} },
        ${r3(inAt)});`;

  if (exit > 0) {
    // Lifting the letters away is the nicer exit, but when the line already
    // sits near the top of the frame it would push them off-canvas — drop them
    // instead.
    out += `
      tl.to("${sel}",
        { ${anim.out(exitUp)}, duration: ${exit}, ease: "${anim.outEase}"${stagger ? `,
          stagger: { each: ${stagger}, from: "end" }` : ""} },
        ${outAt});`;
    if (scrimId) {
      // The scrim fades with the letters and is gone when the last one is.
      const fade = r3(Math.max(0.2, exit + stagger * gaps * 0.5));
      out += `
      tl.to("#${scrimId}", { opacity: 0, duration: ${fade}, ease: "power2.in" },
        ${r3(Math.max(inAt, t.end - fade))});`;
    }
  }
  return out;
}

const TEXT_MOTION = [
  { key: "anim", label: "Animation", type: "select", default: "blur-rise", options: ANIM_OPTIONS },
  { key: "reveal", label: "Entrée (s)", type: "number", min: 0.1, step: 0.05, default: 0.75 },
  { key: "exit", label: "Sortie (s)", type: "number", min: 0, step: 0.05, default: 0.5 },
  { key: "stagger", label: "Décalage lettres (s)", type: "number", min: 0, step: 0.01, default: 0.04 },
];

// Free placement for text on the stage: x = centre of the line, y = top of
// its letters, both in % of the source frame — so they stay put whatever the
// output format. Dragging the text on the preview writes them.
const FREE_OPTION = { value: "free", label: "Libre (déplacé à la souris)" };
const stageXY = (key, y = 30) => [
  { key: "x", label: "Horizontal (%)", type: "range", min: 0, max: 100, step: 0.5, default: 50, showIf: { key, values: ["free"] } },
  { key: "y", label: "Vertical (%)", type: "range", min: 0, max: 100, step: 0.5, default: y, showIf: { key, values: ["free"] } },
];
const freeAt = (p, video, yDefault) => ({
  centreX: Math.round(video.width * Math.min(100, Math.max(0, num(p.x, 50))) / 100),
  inkTop: Math.round(video.height * Math.min(100, Math.max(0, num(p.y, yDefault))) / 100),
});

// What the drag handle needs: the box to grab, and where the line is anchored
// (source pixels), so a move can be added to it exactly.
const dragAttrs = (id, centreX, inkTop) =>
  `data-drag="${id}" data-anchor-x="${centreX}" data-anchor-y="${inkTop}"`;

function scrimCss(id, amount, z) {
  return `
      #${id} {
        position: absolute; inset: auto;
        left: 0; top: 0; width: 0; height: 0;
        opacity: 0;
        z-index: ${z};
        background: radial-gradient(ellipse at center,
          ${paintAlpha("brand:surface", amount)} 0%,
          ${paintAlpha("brand:surface", amount * 0.78)} 38%,
          ${paintAlpha("brand:surface", amount * 0.32)} 62%,
          transparent 78%);
      }`;
}

// --------------------------------------------------------------- behind-text

const behindText = {
  type: "behind-text",
  label: "Texte derrière moi",
  hint: "Le texte passe derrière la personne — de face, de dos ou de loin. Nécessite la découpe. Fais-le glisser sur l'aperçu pour le placer.",
  needsMatte: true,
  timed: true,
  layer: "behind",
  schema: [
    { key: "text", label: "Texte", type: "text", default: "Hello World" },
    { key: "color", label: "Couleur", type: "color", default: "brand:text" },
    {
      // The person's silhouette comes from the cut-out, which needs no face:
      // only the "face" anchor does. Without a face the line is placed freely.
      key: "anchor", label: "Placement", type: "select", default: "face",
      options: [{ value: "face", label: "Calé sur le visage" }, FREE_OPTION],
    },
    { key: "rise", label: "Hauteur (× visage)", type: "range", min: -0.8, max: 2, step: 0.02, default: 0.18,
      showIf: { key: "anchor", values: ["face"] } },
    ...stageXY("anchor", 28),
    { key: "scrim", label: "Voile", type: "range", min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: "fontScale", label: "Taille (× cadre)", type: "range", min: 0.06, max: 0.3, step: 0.005, default: 0.164 },
    ...TEXT_MOTION,
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const face = video.face;
    // Free when asked, and whenever no face was found (seen from behind, far
    // away): the cut-out still separates the person from the room.
    const free = p.anchor === "free" || !face;

    const t = timingOf(fx, video);
    const view = viewOf(video);
    const fontSize = Math.round(video.height * num(p.fontScale, 0.164));
    const maxWidth = Math.round(view.w * 0.92);
    const at = free
      ? freeAt(p, video, 28)
      : { centreX: face.centreX, inkTop: face.chinMin - face.faceHeight * num(p.rise, 0.18) };
    const centreX = at.centreX;
    // Keep the line inside the visible frame whatever the slider says: extreme
    // rise values with a large size would otherwise push it off-screen.
    const inkTop = Math.round(Math.min(Math.max(view.y, at.inkTop), view.y + view.h - fontSize));
    const scrim = num(p.scrim, 0.5);
    const scrimId = scrim > 0 ? `${id}-scrim` : null;

    return {
      layer: "behind",
      needsMatte: true,
      timing: t,
      css: `${scrimId ? scrimCss(scrimId, scrim, 10) : ""}
      /* inset/width/height auto undo the shared .clip box, which would
         otherwise stretch this full-frame and break translateX(-50%) */
      #${id} {
        z-index: 11;
        position: absolute; inset: auto;
        left: ${centreX}px; top: ${inkTop}px;
        width: auto; height: auto;
        transform: translateX(-50%);
        white-space: nowrap; line-height: 1;
        font-family: var(--font-title);
        font-size: ${fontSize}px; font-weight: 800; letter-spacing: -0.035em;
        color: ${paint(p.color, "brand:text")};
        text-shadow: 0 2px 4px rgba(6,12,22,.5), 0 10px 30px rgba(6,12,22,.45);
      }
${textUnitCss(id, p.anim)}`,

      html: `
      ${scrimId ? `<div id="${scrimId}" class="clip" data-start="0"
        data-duration="${video.duration}" data-track-index="2"></div>` : ""}
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}"
        data-track-index="3" ${dragAttrs(id, centreX, inkTop)}>${chars(p.text, id)}</div>`,

      init: fitAndPlace(id, p.text, { maxWidth, inkTop, scrimId, viewX: view.x, viewW: view.w }),

      timeline: textTimeline(id, scrimId, t, {
        reveal: num(p.reveal, 0.75),
        stagger: num(p.stagger, 0.04),
        exit: num(p.exit, 0.5),
        text: p.text,
        anim: p.anim,
        // Leave by whichever side has more room, so the letters never slide
        // off the visible frame on their way out.
        exitUp: inkTop - view.y > view.y + view.h - inkTop - fontSize,
      }),
    };
  },
};

// --------------------------------------------------------------------- title

const title = {
  type: "title",
  label: "Titre devant",
  hint: "Même révélation, mais au-dessus de l'image. Pas de découpe nécessaire.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "text", label: "Texte", type: "text", default: "Mon titre" },
    { key: "color", label: "Couleur", type: "color", default: "brand:text" },
    {
      key: "position", label: "Position", type: "select", default: "under-chin",
      options: [
        { value: "top", label: "Haut" },
        { value: "center", label: "Centre" },
        { value: "under-chin", label: "Sous le menton" },
        { value: "bottom", label: "Bas" },
        FREE_OPTION,
      ],
    },
    ...stageXY("position", 70),
    { key: "scrim", label: "Voile", type: "range", min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: "fontScale", label: "Taille (× cadre)", type: "range", min: 0.05, max: 0.25, step: 0.005, default: 0.12 },
    ...TEXT_MOTION,
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const view = viewOf(video);
    const fontSize = Math.round(video.height * num(p.fontScale, 0.12));
    const maxWidth = Math.round(view.w * 0.9);

    // Top / centre / bottom mean on screen, so they are measured in the view.
    let inkTop;
    let centreX = Math.round(view.x + view.w / 2);
    switch (p.position) {
      case "top": inkTop = view.y + view.h * 0.1; break;
      case "center": inkTop = view.y + (view.h - fontSize * 0.72) / 2; break;
      case "bottom": inkTop = view.y + view.h * 0.8; break;
      case "free": ({ centreX, inkTop } = freeAt(p, video, 70)); break;
      default:
        if (video.face) {
          inkTop = video.face.chinMin + video.face.faceHeight * 0.05;
          centreX = video.face.centreX;
        } else {
          inkTop = view.y + view.h * 0.7;
        }
    }

    inkTop = Math.round(Math.min(Math.max(view.y, inkTop), view.y + view.h - fontSize));

    const scrim = num(p.scrim, 0.5);
    const scrimId = scrim > 0 ? `${id}-scrim` : null;

    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `${scrimId ? scrimCss(scrimId, scrim, 60) : ""}
      #${id} {
        z-index: 61;
        position: absolute; inset: auto;
        left: ${centreX}px; top: ${inkTop}px;
        width: auto; height: auto;
        transform: translateX(-50%);
        white-space: nowrap; line-height: 1;
        font-family: var(--font-title);
        font-size: ${fontSize}px; font-weight: 800; letter-spacing: -0.035em;
        color: ${paint(p.color, "brand:text")};
        text-shadow: 0 2px 4px rgba(6,12,22,.5), 0 10px 30px rgba(6,12,22,.45);
      }
${textUnitCss(id, p.anim)}`,

      html: `
      ${scrimId ? `<div id="${scrimId}" class="clip" data-start="0"
        data-duration="${video.duration}" data-track-index="6"></div>` : ""}
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}"
        data-track-index="7" ${dragAttrs(id, centreX, inkTop)}>${chars(p.text, id)}</div>`,

      init: fitAndPlace(id, p.text, { maxWidth, inkTop, scrimId, viewX: view.x, viewW: view.w }),

      timeline: textTimeline(id, scrimId, t, {
        reveal: num(p.reveal, 0.75),
        stagger: num(p.stagger, 0.035),
        exit: num(p.exit, 0.5),
        text: p.text,
        anim: p.anim,
        exitUp: inkTop - view.y > view.y + view.h - inkTop - fontSize,
      }),
    };
  },
};

// --------------------------------------------------------------- lower-third

const lowerThird = {
  type: "lower-third",
  space: "canvas",
  label: "Bandeau (lower third)",
  hint: "Nom et fonction en bas à gauche, entrée latérale.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "title", label: "Titre", type: "text", default: "Robin" },
    { key: "subtitle", label: "Sous-titre", type: "text", default: "Data & Dev" },
    { key: "accent", label: "Accent", type: "color", default: "brand:primary" },
    { key: "exit", label: "Sortie (s)", type: "number", min: 0, step: 0.05, default: 0.4 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    // Sized on the short side, so a vertical canvas does not blow it up.
    const unit = Math.min(video.width, video.height) / 720;
    const exit = num(p.exit, 0.4);
    const outAt = Math.max(t.start + 0.4, t.end - exit);

    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `
      #${id} {
        z-index: 62;
        position: absolute; inset: auto;
        left: ${Math.round(64 * unit)}px;
        bottom: ${Math.round(72 * unit)}px;
        width: auto; height: auto;
        opacity: 0;
        display: flex; align-items: stretch; gap: ${Math.round(16 * unit)}px;
      }
      #${id} .${id}-bar {
        width: ${Math.round(6 * unit)}px; border-radius: ${Math.round(3 * unit)}px;
        background: ${paint(p.accent, "brand:primary")};
        transform-origin: bottom center;
      }
      #${id} .${id}-body {
        background: ${paintAlpha("brand:surface", 0.62)};
        backdrop-filter: blur(${Math.round(10 * unit)}px);
        padding: ${Math.round(14 * unit)}px ${Math.round(24 * unit)}px;
        border-radius: ${Math.round(10 * unit)}px;
      }
      #${id} .${id}-t {
        font-family: var(--font-title);
        font-size: ${Math.round(40 * unit)}px; font-weight: 700;
        letter-spacing: -0.02em; color: var(--brand-text); line-height: 1.1; white-space: nowrap;
      }
      #${id} .${id}-s {
        font-family: var(--font-body);
        font-size: ${Math.round(24 * unit)}px; font-weight: 500;
        color: ${paintAlpha("brand:text", 0.72)}; line-height: 1.3; white-space: nowrap;
        margin-top: ${Math.round(4 * unit)}px;
      }`,

      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}"
        data-track-index="8">
        <div class="${id}-bar"></div>
        <div class="${id}-body">
          <div class="${id}-t">${esc(p.title)}</div>
          ${p.subtitle ? `<div class="${id}-s">${esc(p.subtitle)}</div>` : ""}
        </div>
      </div>`,

      init: "",

      timeline: `
      tl.fromTo("#${id}", { opacity: 0 },
        { opacity: 1, duration: 0.01 }, ${r3(t.start)});
      tl.fromTo("#${id} .${id}-bar", { scaleY: 0 },
        { scaleY: 1, duration: 0.45, ease: "power3.out" }, ${r3(t.start)});
      tl.fromTo("#${id} .${id}-body", { opacity: 0, x: -${Math.round(28 * unit)} },
        { opacity: 1, x: 0, duration: 0.5, ease: "power3.out" }, ${r3(t.start + 0.12)});
      ${exit > 0 ? `tl.to("#${id}",
        { opacity: 0, x: -${Math.round(20 * unit)}, duration: ${exit}, ease: "power2.in" },
        ${r3(outAt)});` : ""}`,
    };
  },
};

// ---------------------------------------------------------------------- fade

const fade = {
  type: "fade",
  space: "canvas",
  label: "Fondu entrée / sortie",
  hint: "Ouverture et fermeture au noir, sur toute la durée du clip.",
  needsMatte: false,
  timed: false,
  layer: "top",
  schema: [
    { key: "inDuration", label: "Fondu d'entrée (s)", type: "number", min: 0, step: 0.1, default: 0.4 },
    { key: "outDuration", label: "Fondu de sortie (s)", type: "number", min: 0, step: 0.1, default: 0.5 },
    { key: "color", label: "Couleur", type: "color", default: "#000000" },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const fadeIn = num(p.inDuration, 0.4);
    const fadeOut = num(p.outDuration, 0.5);

    const calls = [];
    if (fadeIn > 0) {
      calls.push(`      tl.fromTo("#${id}", { opacity: 1 },
        { opacity: 0, duration: ${fadeIn}, ease: "power2.out" }, 0);`);
    }
    if (fadeOut > 0) {
      calls.push(`      tl.to("#${id}",
        { opacity: 1, duration: ${fadeOut}, ease: "power2.in" },
        ${r3(Math.max(0, video.duration - fadeOut))});`);
    }

    return {
      layer: "top",
      needsMatte: false,
      css: `
      #${id} { z-index: 90; background: ${paint(p.color, "#000000")}; opacity: ${fadeIn > 0 ? 1 : 0}; }`,
      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}"
        data-track-index="9"></div>`,
      init: "",
      timeline: calls.join("\n"),
    };
  },
};

// ------------------------------------------------------------------ registry

// Dragged on the preview: these live on the stage (source pixels), so the UI
// converts the move through the stage's scale and adds it to the anchor.
behindText.drag = { key: "anchor", stage: true };
title.drag = { key: "position", stage: true };

// Each effect gets a category for the pickers; the order within one is the
// order of this list.
const TEXT = "Textes";
for (const e of [behindText, title, lowerThird]) e.category = TEXT;
for (const e of IMAGE_EFFECTS) e.category ??= "Image";
fade.category = "Image";

export const CATEGORIES = [TEXT, "Animations", "Image"];

export const EFFECTS = [behindText, title, lowerThird, captions, ...ANIM_EFFECTS, ...IMAGE_EFFECTS, fade];

export const byType = (type) => EFFECTS.find((e) => e.type === type) || null;

export function defaultParams(type) {
  const effect = byType(type);
  if (!effect) return {};
  return Object.fromEntries(effect.schema.map((f) => [f.key, f.default]));
}

export const isTimed = (type) => Boolean(byType(type)?.timed);

// What the UI needs to render its controls — no functions, JSON-safe.
export function catalogue() {
  return EFFECTS.map(({ type, label, hint, category, needsMatte, needsFace, timed, schema, drag }) => ({
    type, label, hint, category, needsMatte, needsFace: Boolean(needsFace), timed: Boolean(timed), schema,
    drag: drag || null,
  }));
}
