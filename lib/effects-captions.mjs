// The subtitles effect: draws the clip's captions (video.captions, see
// lib/captions.mjs) in one of four styles.
//
// The lines themselves are not params — they belong to the clip and are
// edited in the studio's "Sous-titres" tab. This effect only decides how they
// look: several subtitle effects on one clip would show the same lines.
//
// Every line (or word group) is its own element, stacked in one grid cell and
// shown by opacity tweens at its times. Karaoke colour changes use a second,
// highlighted copy of each word faded in over the first: GSAP cannot tween a
// colour that is a CSS variable, and opacity always can.

import { paint, paintAlpha } from "./brand.mjs";
import { esc, num, clamp, r3 } from "./util.mjs";

const STYLES = [
  { value: "box", label: "Bandeau (texte sur fond)" },
  { value: "karaoke", label: "Karaoké (le mot dit s'allume)" },
  { value: "pop", label: "Mot à mot (gros, style Reels)" },
  { value: "outline", label: "Contour (sans fond)" },
];

// A display unit: a whole line, or for "pop" a few words of it.
function unitsOf(cues, style, per) {
  if (style !== "pop") return cues.map((c) => ({ start: c.start, end: c.end, words: c.words?.length ? c.words : [{ w: c.text, s: c.start, e: c.end }] }));
  const units = [];
  for (const c of cues) {
    const words = c.words?.length ? c.words : [{ w: c.text, s: c.start, e: c.end }];
    for (let i = 0; i < words.length; i += per) {
      const group = words.slice(i, i + per);
      const next = words[i + per];
      units.push({ start: group[0].s, end: next ? next.s : c.end, words: group });
    }
  }
  return units;
}

export const captions = {
  type: "captions",
  space: "canvas",
  label: "Sous-titres",
  hint: "Affiche les sous-titres du clip. Génère-les ou modifie-les dans l'onglet « Sous-titres ».",
  needsMatte: false,
  timed: false,
  layer: "top",
  category: "Textes",
  schema: [
    { key: "style", label: "Style", type: "select", default: "box", options: STYLES },
    {
      key: "position", label: "Position", type: "select", default: "bottom",
      options: [
        { value: "bottom", label: "Bas" },
        { value: "center", label: "Centre" },
        { value: "top", label: "Haut" },
        { value: "free", label: "Libre (déplacé à la souris)" },
      ],
    },
    { key: "x", label: "Horizontal (%)", type: "range", min: 0, max: 100, step: 0.5, default: 50, showIf: { key: "position", values: ["free"] } },
    { key: "y", label: "Vertical (%)", type: "range", min: 0, max: 100, step: 0.5, default: 80, showIf: { key: "position", values: ["free"] } },
    { key: "size", label: "Taille", type: "range", min: 0.5, max: 2.5, step: 0.05, default: 1 },
    { key: "color", label: "Texte", type: "color", default: "brand:text" },
    { key: "highlight", label: "Mot en cours", type: "color", default: "brand:primary", showIf: { key: "style", values: ["karaoke", "pop"] } },
    { key: "box", label: "Opacité du fond", type: "range", min: 0, max: 1, step: 0.05, default: 0.6, showIf: { key: "style", values: ["box", "karaoke"] } },
    { key: "per", label: "Mots à la fois", type: "range", min: 1, max: 5, step: 1, default: 3, showIf: { key: "style", values: ["pop"] } },
    {
      key: "caps", label: "Majuscules", type: "select", default: "no",
      options: [{ value: "no", label: "Non" }, { value: "yes", label: "Oui" }],
    },
  ],

  build(fx, video) {
    const cues = video.captions?.cues || [];
    if (!cues.length) return null;
    const p = fx.params;
    const id = fx.id;
    const style = STYLES.some((s) => s.value === p.style) ? p.style : "box";
    const u = Math.min(video.width, video.height) / 720;
    const scale = clamp(num(p.size, 1), 0.3, 4);
    const fontSize = Math.round((style === "pop" ? 60 : 38) * u * scale);
    const width = Math.round(video.width * (video.width > video.height ? 0.8 : 0.88));
    const units = unitsOf(cues, style, clamp(Math.round(num(p.per, 3)), 1, 8))
      .filter((x) => x.end > x.start && x.start < video.duration);
    const lit = style === "karaoke" || style === "pop";
    const withBox = style === "box" || style === "karaoke";

    const place = {
      bottom: `justify-content: flex-end; padding-bottom: ${Math.round(video.height * 0.08)}px;`,
      top: `justify-content: flex-start; padding-top: ${Math.round(video.height * 0.08)}px;`,
      center: `justify-content: center;`,
    };
    const free = p.position === "free";
    const align = { bottom: "end", top: "start", center: "center" }[p.position] || "center";
    const outline = paint("brand:surface");
    const stroke = Math.max(1, Math.round(fontSize * 0.06));

    const html = units.map((unit, i) => {
      const words = unit.words.map((w, j) =>
        `<span class="${id}-w">${lit ? `<span class="${id}-b">${esc(w.w)}</span><span id="${id}-h${i}_${j}" class="${id}-h">${esc(w.w)}</span>` : esc(w.w)}</span>`);
      return `<div id="${id}-c${i}" class="${id}-c"><span class="${id}-t">${words.join(" ")}</span></div>`;
    }).join("\n          ");

    const tl = [];
    units.forEach((unit, i) => {
      const next = units[i + 1];
      const end = Math.min(unit.end, next ? next.start : unit.end, video.duration);
      const inDur = style === "pop" ? 0.12 : 0.08;
      tl.push(style === "pop"
        ? `      tl.fromTo("#${id}-c${i}", { opacity: 0, scale: 0.82 }, { opacity: 1, scale: 1, duration: ${inDur}, ease: "back.out(2.5)" }, ${r3(unit.start)});`
        : `      tl.fromTo("#${id}-c${i}", { opacity: 0 }, { opacity: 1, duration: ${inDur}, ease: "power1.out" }, ${r3(unit.start)});`);
      tl.push(`      tl.to("#${id}-c${i}", { opacity: 0, duration: 0.04 }, ${r3(Math.max(unit.start + inDur, end - 0.04))});`);
      if (lit) {
        unit.words.forEach((w, j) => {
          tl.push(`      tl.fromTo("#${id}-h${i}_${j}", { opacity: 0 }, { opacity: 1, duration: 0.05 }, ${r3(clamp(w.s, unit.start, end))});`);
          // "pop" lights only the word being said; karaoke keeps what was said lit.
          if (style === "pop") {
            const off = unit.words[j + 1] ? unit.words[j + 1].s : end;
            tl.push(`      tl.to("#${id}-h${i}_${j}", { opacity: 0, duration: 0.03 }, ${r3(clamp(off - 0.03, w.s + 0.05, end))});`);
          }
        });
      }
    });

    return {
      layer: "top",
      needsMatte: false,
      css: `
      #${id} { z-index: 87; display: flex; flex-direction: column; align-items: center; pointer-events: none;
        ${free ? "" : place[p.position] || place.bottom} }
      #${id} .${id}-pos {
        width: ${width}px; display: grid; align-items: ${align}; justify-items: center;
        ${free ? `position: absolute; left: ${clamp(num(p.x, 50), -20, 120)}%; top: ${clamp(num(p.y, 80), -20, 120)}%; transform: translate(-50%, -50%);` : ""}
      }
      #${id} .${id}-c {
        grid-area: 1 / 1; opacity: 0; text-align: center; max-width: 100%;
        font-family: ${style === "pop" ? "var(--font-title)" : "var(--font-body)"};
        font-weight: ${style === "pop" ? 900 : 700}; font-size: ${fontSize}px; line-height: 1.32;
        letter-spacing: ${style === "pop" ? "-0.02em" : "0"};
        color: ${paint(p.color, "brand:text")};
        ${p.caps === "yes" ? "text-transform: uppercase;" : ""}
      }
      #${id} .${id}-t {
        ${withBox
          ? `background: ${paintAlpha("brand:surface", clamp(num(p.box, 0.6), 0, 1))};
        padding: 0.12em 0.45em; border-radius: 0.3em;
        -webkit-box-decoration-break: clone; box-decoration-break: clone;`
          : `text-shadow: ${[[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1.4], [0, -1.4], [1.4, 0], [-1.4, 0]]
            .map(([x, y]) => `${Math.round(x * stroke)}px ${Math.round(y * stroke)}px 0 ${outline}`).join(", ")},
          0 ${stroke * 2}px ${stroke * 5}px rgba(6,12,22,.45);`}
      }
      #${id} .${id}-w { position: relative; display: inline-block; }
      #${id} .${id}-h { position: absolute; left: 0; top: 0; opacity: 0; color: ${paint(p.highlight, "brand:primary")}; }`,
      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}" data-track-index="30">
        <div class="${id}-pos" data-drag="${id}">
          ${html}
        </div>
      </div>`,
      init: "",
      timeline: tl.join("\n"),
    };
  },
  drag: { key: "position" },
};
