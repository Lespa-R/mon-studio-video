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
import { timingOf } from "./timing.mjs";

export { timingOf };

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const r3 = (n) => Number(n.toFixed(3));

// The part of the source frame that ends up on screen. Without a recrop it is
// the whole frame; compose.mjs sets it when the output format crops.
const viewOf = (video) => video.view || { x: 0, y: 0, w: video.width, h: video.height };

function chars(text, cls) {
  return [...String(text)]
    .map((ch) =>
      ch === " "
        ? `<span class="${cls}-sp"></span>`
        : `<span class="${cls}-ch">${esc(ch)}</span>`)
    .join("");
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
        var el = document.getElementById(${JSON.stringify(id)});
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
        var m = ctx.measureText(${JSON.stringify(text)});
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
        var scrim = document.getElementById(${JSON.stringify(scrimId)});
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

// In: letters rise out of a blur. Out: they lift away in reverse order, so the
// line unbuilds from its end rather than collapsing all at once.
function textTimeline(id, scrimId, t, { reveal, stagger, exit, exitUp = true, letters = 12 }) {
  const sel = `#${id} .${id}-ch`;

  // A staggered animation lasts its duration plus one stagger per extra letter.
  // Entrance and exit must both fit inside the window — the exit in particular
  // has to be over by its end, or the last letters linger into whatever comes
  // next (the following shot, in a sequence). When the window is too short
  // for both, everything is compressed by the same factor rather than cut.
  const gaps = Math.max(0, letters - 1);
  const need = reveal + stagger * gaps + (exit > 0 ? exit + stagger * gaps : 0);
  const k = need > t.duration ? t.duration / need : 1;
  reveal = r3(reveal * k);
  exit = r3(exit * k);
  stagger = r3(stagger * k);

  const inAt = t.start;
  const outAt = r3(t.end - exit - stagger * gaps);

  let out = "";
  if (scrimId) {
    out += `
      tl.fromTo("#${scrimId}", { opacity: 0 },
        { opacity: 1, duration: ${r3(Math.min(0.6, reveal))}, ease: "power2.out" }, ${r3(Math.max(0, inAt - 0.05))});`;
  }
  out += `
      tl.fromTo("${sel}",
        { opacity: 0, yPercent: 55, filter: "blur(14px)" },
        { opacity: 1, yPercent: 0, filter: "blur(0px)",
          duration: ${reveal}, ease: "power3.out", stagger: ${stagger} },
        ${r3(inAt)});`;

  if (exit > 0) {
    // Lifting the letters away is the nicer exit, but when the line already
    // sits near the top of the frame it would push them off-canvas — drop them
    // instead.
    out += `
      tl.to("${sel}",
        { opacity: 0, yPercent: ${exitUp ? -40 : 40}, filter: "blur(12px)",
          duration: ${exit}, ease: "power2.in",
          stagger: { each: ${stagger}, from: "end" } },
        ${outAt});`;
    if (scrimId) {
      // The scrim fades with the letters and is gone when the last one is.
      out += `
      tl.to("#${scrimId}", { opacity: 0, duration: ${r3(exit + stagger * gaps * 0.5)}, ease: "power2.in" },
        ${r3(t.end - exit - stagger * gaps * 0.5)});`;
    }
  }
  return out;
}

const TEXT_MOTION = [
  { key: "reveal", label: "Entrée (s)", type: "number", min: 0.1, step: 0.05, default: 0.75 },
  { key: "exit", label: "Sortie (s)", type: "number", min: 0, step: 0.05, default: 0.5 },
  { key: "stagger", label: "Décalage lettres (s)", type: "number", min: 0, step: 0.01, default: 0.04 },
];

function scrimCss(id, amount, z) {
  return `
      #${id} {
        position: absolute; inset: auto;
        left: 0; top: 0; width: 0; height: 0;
        opacity: 0;
        z-index: ${z};
        background: radial-gradient(ellipse at center,
          rgba(8,14,26,${amount}) 0%,
          rgba(8,14,26,${(amount * 0.78).toFixed(3)}) 38%,
          rgba(8,14,26,${(amount * 0.32).toFixed(3)}) 62%,
          rgba(8,14,26,0) 78%);
      }`;
}

// --------------------------------------------------------------- behind-text

const behindText = {
  type: "behind-text",
  label: "Texte derrière moi",
  hint: "Le texte passe derrière ta tête et tes épaules. Nécessite la découpe.",
  needsMatte: true,
  timed: true,
  layer: "behind",
  schema: [
    { key: "text", label: "Texte", type: "text", default: "Hello World" },
    { key: "color", label: "Couleur", type: "color", default: "#ffffff" },
    { key: "rise", label: "Hauteur (× visage)", type: "range", min: -0.8, max: 2, step: 0.02, default: 0.18 },
    { key: "scrim", label: "Voile", type: "range", min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: "fontScale", label: "Taille (× cadre)", type: "range", min: 0.06, max: 0.3, step: 0.005, default: 0.164 },
    ...TEXT_MOTION,
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const face = video.face;
    if (!face) return null;

    const t = timingOf(fx, video);
    const view = viewOf(video);
    const fontSize = Math.round(video.height * num(p.fontScale, 0.164));
    const maxWidth = Math.round(view.w * 0.92);
    // Keep the line inside the visible frame whatever the slider says: extreme
    // rise values with a large size would otherwise push it off-screen.
    const inkTop = Math.round(Math.min(
      Math.max(view.y, face.chinMin - face.faceHeight * num(p.rise, 0.18)),
      view.y + view.h - fontSize));
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
        left: ${face.centreX}px; top: ${inkTop}px;
        width: auto; height: auto;
        transform: translateX(-50%);
        white-space: nowrap; line-height: 1;
        font-size: ${fontSize}px; font-weight: 800; letter-spacing: -0.035em;
        color: ${esc(p.color || "#ffffff")};
        text-shadow: 0 2px 4px rgba(6,12,22,.5), 0 10px 30px rgba(6,12,22,.45);
      }
      #${id} .${id}-ch { display: inline-block; opacity: 0; will-change: transform, opacity, filter; }
      #${id} .${id}-sp { display: inline-block; width: 0.3em; }`,

      html: `
      ${scrimId ? `<div id="${scrimId}" class="clip" data-start="0"
        data-duration="${video.duration}" data-track-index="2"></div>` : ""}
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}"
        data-track-index="3">${chars(p.text, id)}</div>`,

      init: fitAndPlace(id, p.text, { maxWidth, inkTop, scrimId, viewX: view.x, viewW: view.w }),

      timeline: textTimeline(id, scrimId, t, {
        reveal: num(p.reveal, 0.75),
        stagger: num(p.stagger, 0.04),
        exit: num(p.exit, 0.5),
        letters: [...String(p.text)].filter((c) => c !== " ").length,
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
    { key: "color", label: "Couleur", type: "color", default: "#ffffff" },
    {
      key: "position", label: "Position", type: "select", default: "under-chin",
      options: [
        { value: "top", label: "Haut" },
        { value: "center", label: "Centre" },
        { value: "under-chin", label: "Sous le menton" },
        { value: "bottom", label: "Bas" },
      ],
    },
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
        font-size: ${fontSize}px; font-weight: 800; letter-spacing: -0.035em;
        color: ${esc(p.color || "#ffffff")};
        text-shadow: 0 2px 4px rgba(6,12,22,.5), 0 10px 30px rgba(6,12,22,.45);
      }
      #${id} .${id}-ch { display: inline-block; opacity: 0; will-change: transform, opacity, filter; }
      #${id} .${id}-sp { display: inline-block; width: 0.3em; }`,

      html: `
      ${scrimId ? `<div id="${scrimId}" class="clip" data-start="0"
        data-duration="${video.duration}" data-track-index="6"></div>` : ""}
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}"
        data-track-index="7">${chars(p.text, id)}</div>`,

      init: fitAndPlace(id, p.text, { maxWidth, inkTop, scrimId, viewX: view.x, viewW: view.w }),

      timeline: textTimeline(id, scrimId, t, {
        reveal: num(p.reveal, 0.75),
        stagger: num(p.stagger, 0.035),
        exit: num(p.exit, 0.5),
        letters: [...String(p.text)].filter((c) => c !== " ").length,
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
    { key: "accent", label: "Accent", type: "color", default: "#4f8cff" },
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
        background: ${esc(p.accent || "#4f8cff")};
        transform-origin: bottom center;
      }
      #${id} .${id}-body {
        background: rgba(8,14,26,.62);
        backdrop-filter: blur(${Math.round(10 * unit)}px);
        padding: ${Math.round(14 * unit)}px ${Math.round(24 * unit)}px;
        border-radius: ${Math.round(10 * unit)}px;
      }
      #${id} .${id}-t {
        font-size: ${Math.round(40 * unit)}px; font-weight: 700;
        letter-spacing: -0.02em; color: #fff; line-height: 1.1; white-space: nowrap;
      }
      #${id} .${id}-s {
        font-size: ${Math.round(24 * unit)}px; font-weight: 500;
        color: rgba(255,255,255,.72); line-height: 1.3; white-space: nowrap;
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
      #${id} { z-index: 90; background: ${esc(p.color || "#000000")}; opacity: ${fadeIn > 0 ? 1 : 0}; }`,
      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}"
        data-track-index="9"></div>`,
      init: "",
      timeline: calls.join("\n"),
    };
  },
};

// ------------------------------------------------------------------ registry

export const EFFECTS = [behindText, title, lowerThird, ...IMAGE_EFFECTS, fade];

export const byType = (type) => EFFECTS.find((e) => e.type === type) || null;

export function defaultParams(type) {
  const effect = byType(type);
  if (!effect) return {};
  return Object.fromEntries(effect.schema.map((f) => [f.key, f.default]));
}

export const isTimed = (type) => Boolean(byType(type)?.timed);

// What the UI needs to render its controls — no functions, JSON-safe.
export function catalogue() {
  return EFFECTS.map(({ type, label, hint, needsMatte, timed, schema }) => ({
    type, label, hint, needsMatte, timed: Boolean(timed), schema,
  }));
}
