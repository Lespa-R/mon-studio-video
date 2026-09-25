// Animated elements — graphics with a little choreography: key words punched
// in one after another, a bullet list, a counter, an arrow that draws itself,
// a progress bar, a call-to-action button, the brand's logo.
//
// All of them are screen-anchored (space: "canvas"): they are laid out on the
// output frame, so a vertical 9:16 export gets them at the right size and
// place, not a scaled-up copy of the landscape layout. Sizes derive from the
// short side of the frame (`unit`), like the lower third.
//
// Colours go through paint() so they can follow the project's brand kit, and
// text uses the brand's fonts through --font-title / --font-body.
//
// Same rules as every effect: elements span the whole clip, GSAP alone decides
// what is visible, every tween is finite and every value computed here —
// nothing random, nothing from the clock.

import { timingOf } from "./timing.mjs";
import { paint, paintAlpha, LOGO_FILE } from "./brand.mjs";

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r3 = (n) => Number(Number(n).toFixed(3));
const jsString = (v) => JSON.stringify(String(v)).replace(/</g, "\\u003c");

const unitOf = (video) => Math.min(video.width, video.height) / 720;
const landscape = (video) => video.width > video.height;

// "Rapide / Local / Gratuit" → ["Rapide", "Local", "Gratuit"]
const splitList = (text) =>
  String(text ?? "").split(/\s*[/|\n]\s*/).map((s) => s.trim()).filter(Boolean).slice(0, 12);

const shadow = "0 2px 4px rgba(6,12,22,.45), 0 10px 30px rgba(6,12,22,.4)";

// Shrink a line that would not fit. offsetWidth is layout, so the scale the
// preview applies to its iframe does not skew it.
function fitWidth(id, maxWidth) {
  return `
      (function () {
        var el = document.getElementById(${jsString(id)});
        if (!el) return;
        var w = el.offsetWidth;
        if (w > ${Math.round(maxWidth)}) {
          el.style.fontSize = parseFloat(getComputedStyle(el).fontSize) * (${Math.round(maxWidth)} / w) + "px";
        }
      })();`;
}

const POSITIONS = [
  { value: "top", label: "Haut" },
  { value: "center", label: "Centre" },
  { value: "bottom", label: "Bas" },
];

// A full-frame flex box that puts its content at one of POSITIONS.
function placeCss(id, position, video, z) {
  const u = unitOf(video);
  const justify = { top: "flex-start", center: "center", bottom: "flex-end" }[position] || "center";
  return `
      #${id} {
        z-index: ${z};
        display: flex; flex-direction: column; align-items: center; justify-content: ${justify};
        padding: ${Math.round(video.height * 0.1)}px ${Math.round(40 * u)}px ${Math.round(video.height * 0.12)}px;
        pointer-events: none;
      }`;
}

const wrapper = (id, video, track, inner) => `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}"
        data-track-index="${track}">${inner}
      </div>`;

// ------------------------------------------------------------ highlight

const highlight = {
  type: "highlight",
  space: "canvas",
  label: "Titre surligné",
  hint: "Un coup de surligneur passe derrière la phrase, puis le texte monte.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "text", label: "Texte", type: "text", default: "L'idée clé" },
    {
      key: "style", label: "Style", type: "select", default: "marker",
      options: [
        { value: "marker", label: "Surligneur" },
        { value: "underline", label: "Soulignement" },
        { value: "box", label: "Encadré plein" },
      ],
    },
    { key: "position", label: "Position", type: "select", default: "bottom", options: POSITIONS },
    { key: "color", label: "Texte", type: "color", default: "brand:text" },
    { key: "marker", label: "Surligneur", type: "color", default: "brand:primary" },
    { key: "size", label: "Taille", type: "range", min: 0.5, max: 2, step: 0.05, default: 1 },
    { key: "exit", label: "Sortie (s)", type: "number", min: 0, step: 0.05, default: 0.35 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const u = unitOf(video);
    const size = Math.round(58 * u * clamp(num(p.size, 1), 0.3, 3));
    const style = p.style;
    const marker = paint(p.marker, "brand:primary");
    const exit = Math.min(num(p.exit, 0.35), t.duration / 3);
    const sweep = r3(Math.min(0.45, t.duration / 4));

    // The marker is a box behind the line, drawn from the left.
    const bar = {
      marker: `left: -0.18em; right: -0.18em; top: 42%; bottom: 2%; border-radius: 0.08em; opacity: 0.9;`,
      underline: `left: 0; right: 0; bottom: -0.1em; height: 0.09em; border-radius: 0.05em;`,
      box: `left: -0.35em; right: -0.35em; top: -0.18em; bottom: -0.18em; border-radius: 0.14em;`,
    }[style] || "";

    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `${placeCss(id, p.position, video, 63)}
      #${id} .${id}-line {
        position: relative; display: inline-block; white-space: nowrap;
        font-family: var(--font-title); font-weight: 800; letter-spacing: -0.02em; line-height: 1.1;
        font-size: ${size}px; color: ${paint(p.color, "brand:text")};
        ${style === "box" ? "" : `text-shadow: ${shadow};`}
      }
      #${id} .${id}-bar {
        position: absolute; ${bar}
        background: ${marker}; transform-origin: left center; transform: scaleX(0); z-index: 0;
      }
      #${id} .${id}-txt { position: relative; z-index: 1; display: inline-block; opacity: 0; }`,
      html: wrapper(id, video, 20, `
        <div id="${id}-line" class="${id}-line"><span class="${id}-bar"></span><span class="${id}-txt">${esc(p.text)}</span></div>`),
      init: fitWidth(`${id}-line`, video.width * 0.86),
      timeline: `
      tl.fromTo("#${id} .${id}-bar", { scaleX: 0, transformOrigin: "left center" },
        { scaleX: 1, duration: ${sweep}, ease: "power3.inOut" }, ${r3(t.start)});
      tl.fromTo("#${id} .${id}-txt", { opacity: 0, yPercent: 35 },
        { opacity: 1, yPercent: 0, duration: ${r3(Math.min(0.4, t.duration / 4))}, ease: "power3.out" },
        ${r3(t.start + sweep * 0.35)});${exit > 0 ? `
      tl.to("#${id} .${id}-txt", { opacity: 0, yPercent: -25, duration: ${r3(exit)}, ease: "power2.in" },
        ${r3(t.end - exit)});
      tl.to("#${id} .${id}-bar", { scaleX: 0, transformOrigin: "right center", duration: ${r3(exit)}, ease: "power3.in" },
        ${r3(t.end - exit)});` : ""}`,
    };
  },
};

// ------------------------------------------------------------- keywords

const keywords = {
  type: "keywords",
  space: "canvas",
  label: "Mots-clés percutants",
  hint: "Des mots qui claquent l'un après l'autre. Sépare-les par « / ».",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "words", label: "Mots (séparés par /)", type: "text", default: "Rapide / Local / Gratuit" },
    {
      key: "style", label: "Style", type: "select", default: "plain",
      options: [
        { value: "plain", label: "Texte seul" },
        { value: "boxed", label: "Sur pastille" },
      ],
    },
    { key: "position", label: "Position", type: "select", default: "center", options: POSITIONS },
    { key: "color", label: "Texte", type: "color", default: "brand:text" },
    { key: "fill", label: "Pastille", type: "color", default: "brand:primary", showIf: { key: "style", values: ["boxed"] } },
    { key: "size", label: "Taille", type: "range", min: 0.5, max: 2.5, step: 0.05, default: 1.3 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const words = splitList(p.words);
    if (!words.length) return null;
    const t = timingOf(fx, video);
    const u = unitOf(video);
    const size = Math.round(72 * u * clamp(num(p.size, 1.3), 0.3, 4));
    const boxed = p.style === "boxed";

    // Each word gets an equal slot: in with a punch, out just before the next.
    const slot = t.duration / words.length;
    const punch = r3(Math.min(0.28, slot * 0.4));
    const leave = r3(Math.min(0.14, slot * 0.25));

    const tl = words.map((_, i) => {
      const at = t.start + i * slot;
      return `
      tl.fromTo("#${id}-k${i}", { opacity: 0, scale: 1.45 },
        { opacity: 1, scale: 1, duration: ${punch}, ease: "back.out(2)" }, ${r3(at)});
      tl.to("#${id}-k${i}", { opacity: 0, scale: 0.9, duration: ${leave}, ease: "power2.in" }, ${r3(at + slot - leave)});`;
    }).join("");

    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `${placeCss(id, p.position, video, 64)}
      #${id} .${id}-slot { display: grid; place-items: center; }
      #${id} .${id}-w {
        grid-area: 1 / 1; opacity: 0; white-space: nowrap;
        font-family: var(--font-title); font-weight: 900; letter-spacing: -0.03em; line-height: 1;
        font-size: ${size}px; color: ${paint(p.color, "brand:text")};
        ${boxed
          ? `background: ${paint(p.fill, "brand:primary")}; padding: 0.14em 0.38em 0.18em; border-radius: 0.22em;
        box-shadow: 0 10px 30px rgba(6,12,22,.35);`
          : `text-shadow: ${shadow};`}
      }`,
      html: wrapper(id, video, 21, `
        <div class="${id}-slot">${words.map((w, i) =>
          `<div id="${id}-k${i}" class="${id}-w">${esc(w)}</div>`).join("")}</div>`),
      init: words.map((_, i) => fitWidth(`${id}-k${i}`, video.width * 0.86)).join(""),
      timeline: tl,
    };
  },
};

// -------------------------------------------------------------- bullets

const bullets = {
  type: "bullets",
  space: "canvas",
  label: "Liste à puces",
  hint: "Une carte dont les points apparaissent un à un. Sépare-les par « / ».",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "title", label: "Titre", type: "text", default: "Au programme" },
    { key: "items", label: "Points (séparés par /)", type: "text", default: "Le problème / L'outil / La démo" },
    {
      key: "side", label: "Position", type: "select", default: "left",
      options: [
        { value: "left", label: "À gauche" },
        { value: "right", label: "À droite" },
        { value: "bottom", label: "En bas" },
      ],
    },
    { key: "accent", label: "Puces", type: "color", default: "brand:primary" },
    { key: "pace", label: "Écart entre points (s)", type: "number", min: 0.1, step: 0.1, default: 0.8 },
    { key: "size", label: "Taille", type: "range", min: 0.6, max: 1.8, step: 0.05, default: 1 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const items = splitList(p.items);
    if (!items.length && !p.title) return null;
    const t = timingOf(fx, video);
    const u = unitOf(video) * clamp(num(p.size, 1), 0.3, 3);
    const margin = Math.round(56 * unitOf(video));
    const width = Math.round(video.width * (landscape(video) ? 0.4 : 0.84));

    const intro = r3(Math.min(0.45, t.duration / 5));
    const exit = r3(Math.min(0.35, t.duration / 6));
    // Points arrive every `pace` seconds after the card, squeezed if the
    // window is too short to show them all before the exit.
    const room = Math.max(0.1, t.duration - intro - exit - 0.4);
    const pace = r3(items.length > 1 ? Math.min(num(p.pace, 0.8), room / items.length) : 0);
    const itemIn = r3(Math.max(0.12, Math.min(0.35, pace || 0.35)));

    const box = {
      left: `left: ${margin}px; top: 50%; transform: translateY(-50%);`,
      right: `right: ${margin}px; top: 50%; transform: translateY(-50%);`,
      bottom: `left: 50%; bottom: ${Math.round(video.height * 0.08)}px; transform: translateX(-50%);`,
    }[p.side] || "";
    const fromX = p.side === "right" ? 40 : p.side === "left" ? -40 : 0;
    const fromY = p.side === "bottom" ? 30 : 0;

    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `
      #${id} { z-index: 65; pointer-events: none; }
      /* The spot carries the placement transform, the card the animated one:
         a GSAP tween on x/y would otherwise overwrite the centring. */
      #${id} .${id}-spot { position: absolute; ${box} width: ${width}px; max-width: calc(100% - ${margin * 2}px); }
      #${id} .${id}-card {
        padding: ${Math.round(26 * u)}px ${Math.round(30 * u)}px;
        background: ${paintAlpha("brand:surface", 0.72)};
        backdrop-filter: blur(${Math.round(12 * u)}px);
        border-radius: ${Math.round(16 * u)}px;
        border-left: ${Math.max(2, Math.round(5 * u))}px solid ${paint(p.accent, "brand:primary")};
        color: var(--brand-text);
      }
      #${id} .${id}-in { opacity: 0; }
      #${id} .${id}-t {
        font-family: var(--font-title); font-weight: 800; letter-spacing: -0.02em;
        font-size: ${Math.round(34 * u)}px; line-height: 1.15; margin-bottom: ${Math.round(14 * u)}px;
      }
      #${id} .${id}-li {
        display: flex; align-items: baseline; gap: ${Math.round(14 * u)}px;
        font-family: var(--font-body); font-weight: 500;
        font-size: ${Math.round(26 * u)}px; line-height: 1.3; opacity: 0;
      }
      #${id} .${id}-li + .${id}-li { margin-top: ${Math.round(10 * u)}px; }
      #${id} .${id}-dot {
        flex: 0 0 auto; width: ${Math.round(12 * u)}px; height: ${Math.round(12 * u)}px;
        border-radius: 50%; background: ${paint(p.accent, "brand:primary")};
        transform: translateY(-${Math.round(2 * u)}px);
      }`,
      html: wrapper(id, video, 22, `
        <div class="${id}-spot"><div class="${id}-card"><div class="${id}-in">
          ${p.title ? `<div class="${id}-t">${esc(p.title)}</div>` : ""}
          ${items.map((it) => `<div class="${id}-li"><span class="${id}-dot"></span><span>${esc(it)}</span></div>`).join("\n          ")}
        </div></div></div>`),
      init: "",
      timeline: `
      tl.fromTo("#${id} .${id}-in", { opacity: 0 }, { opacity: 1, duration: 0.01 }, ${r3(t.start)});
      tl.fromTo("#${id} .${id}-card", { opacity: 0, x: ${Math.round(fromX * u)}, y: ${Math.round(fromY * u)} },
        { opacity: 1, x: 0, y: 0, duration: ${intro}, ease: "power3.out" }, ${r3(t.start)});${items.length ? `
      tl.fromTo("#${id} .${id}-li", { opacity: 0, x: ${Math.round(-18 * u)} },
        { opacity: 1, x: 0, duration: ${itemIn}, ease: "power2.out"${pace ? `, stagger: ${pace}` : ""} },
        ${r3(t.start + intro * 0.8)});` : ""}
      tl.to("#${id} .${id}-card", { opacity: 0, x: ${Math.round(fromX * 0.6 * u)}, y: ${Math.round(fromY * 0.6 * u)},
        duration: ${exit}, ease: "power2.in" }, ${r3(t.end - exit)});`,
    };
  },
};

// -------------------------------------------------------------- counter

// French formatting by hand: grouping with a narrow no-break space, a comma
// for decimals. Intl would work too, but its output depends on the ICU the
// Node binary ships with.
function formatNumber(value, decimals) {
  const fixed = Math.abs(value).toFixed(decimals);
  const [int, dec] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (value < 0 ? "−" : "") + grouped + (dec ? "," + dec : "");
}

const counter = {
  type: "counter",
  space: "canvas",
  label: "Compteur animé",
  hint: "Un chiffre qui défile jusqu'à sa valeur, avec une légende.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "to", label: "Valeur", type: "number", step: 1, default: 250 },
    { key: "from", label: "Départ", type: "number", step: 1, default: 0 },
    { key: "decimals", label: "Décimales", type: "select", default: "0",
      options: [{ value: "0", label: "Aucune" }, { value: "1", label: "1" }, { value: "2", label: "2" }] },
    { key: "prefix", label: "Avant", type: "text", default: "+" },
    { key: "suffix", label: "Après", type: "text", default: " %" },
    { key: "label", label: "Légende", type: "text", default: "de productivité" },
    { key: "position", label: "Position", type: "select", default: "center", options: POSITIONS },
    { key: "color", label: "Chiffre", type: "color", default: "brand:primary" },
    { key: "count", label: "Durée du défilé (s)", type: "number", min: 0.2, step: 0.1, default: 1.4 },
    { key: "size", label: "Taille", type: "range", min: 0.5, max: 2.5, step: 0.05, default: 1.2 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const u = unitOf(video) * clamp(num(p.size, 1.2), 0.3, 4);
    const from = num(p.from, 0);
    const to = num(p.to, 250);
    const decimals = clamp(Math.round(num(p.decimals, 0)), 0, 2);
    const exit = r3(Math.min(0.35, t.duration / 6));
    const count = Math.max(0.2, Math.min(num(p.count, 1.4), t.duration - exit - 0.2));

    // The number is written frame by frame as a series of sets on the
    // timeline: seekable in both directions, formatted in French, and with
    // no dependence on a plugin or on callbacks firing during a seek.
    const steps = Math.max(2, Math.min(90, Math.round(count * 30)));
    const sets = [];
    let last = null;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const eased = 1 - Math.pow(1 - k, 3); // power3.out
      const text = formatNumber(from + (to - from) * eased, decimals);
      if (text === last) continue;
      last = text;
      sets.push(`      tl.set("#${id}-n", { textContent: ${jsString(text)} }, ${r3(t.start + k * count)});`);
    }

    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `${placeCss(id, p.position, video, 66)}
      #${id} .${id}-box { text-align: center; opacity: 0; }
      #${id} .${id}-num {
        white-space: nowrap; font-family: var(--font-title); font-weight: 900;
        letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums;
        font-size: ${Math.round(96 * u)}px; color: ${paint(p.color, "brand:primary")};
        text-shadow: ${shadow};
      }
      #${id} .${id}-lab {
        font-family: var(--font-body); font-weight: 600;
        font-size: ${Math.round(28 * u)}px; margin-top: ${Math.round(8 * u)}px;
        color: var(--brand-text); text-shadow: ${shadow};
      }`,
      html: wrapper(id, video, 23, `
        <div class="${id}-box">
          <div id="${id}-num" class="${id}-num">${esc(p.prefix || "")}<span id="${id}-n">${esc(formatNumber(from, decimals))}</span>${esc(p.suffix || "")}</div>
          ${p.label ? `<div class="${id}-lab">${esc(p.label)}</div>` : ""}
        </div>`),
      // Measured at the final value, the widest the number will get.
      init: `
      (function () {
        var n = document.getElementById(${jsString(`${id}-n`)});
        if (!n) return;
        var start = n.textContent;
        n.textContent = ${jsString(formatNumber(to, decimals))};${fitWidth(`${id}-num`, video.width * 0.86)}
        n.textContent = start;
      })();`,
      timeline: `
      tl.fromTo("#${id} .${id}-box", { opacity: 0, scale: 0.85, y: ${Math.round(20 * u)} },
        { opacity: 1, scale: 1, y: 0, duration: ${r3(Math.min(0.4, t.duration / 5))}, ease: "back.out(1.8)" }, ${r3(t.start)});
${sets.join("\n")}
      tl.to("#${id} .${id}-box", { opacity: 0, y: ${Math.round(-16 * u)}, duration: ${exit}, ease: "power2.in" }, ${r3(t.end - exit)});`,
    };
  },
};

// ---------------------------------------------------------------- arrow

const arrow = {
  type: "arrow",
  space: "canvas",
  label: "Flèche animée",
  hint: "Une flèche se dessine vers un point de l'image, avec une étiquette.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "label", label: "Étiquette", type: "text", default: "Regarde ici" },
    { key: "x", label: "Cible horizontale (%)", type: "range", min: 0, max: 100, step: 1, default: 62 },
    { key: "y", label: "Cible verticale (%)", type: "range", min: 0, max: 100, step: 1, default: 45 },
    {
      key: "from", label: "Arrive de", type: "select", default: "bottom-left",
      options: [
        { value: "left", label: "La gauche" },
        { value: "right", label: "La droite" },
        { value: "top-left", label: "En haut à gauche" },
        { value: "top-right", label: "En haut à droite" },
        { value: "bottom-left", label: "En bas à gauche" },
        { value: "bottom-right", label: "En bas à droite" },
      ],
    },
    { key: "length", label: "Longueur", type: "range", min: 0.1, max: 0.6, step: 0.01, default: 0.24 },
    { key: "bend", label: "Courbure", type: "range", min: -1, max: 1, step: 0.05, default: 0.35 },
    { key: "color", label: "Couleur", type: "color", default: "brand:primary" },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const u = unitOf(video);
    const W = video.width;
    const H = video.height;

    const dirs = {
      left: [-1, 0], right: [1, 0],
      "top-left": [-0.72, -0.7], "top-right": [0.72, -0.7],
      "bottom-left": [-0.72, 0.7], "bottom-right": [0.72, 0.7],
    };
    const [dx, dy] = dirs[p.from] || dirs["bottom-left"];
    const len = Math.min(W, H) * clamp(num(p.length, 0.24), 0.05, 1) * 1.6;
    const tx = W * clamp(num(p.x, 62), 0, 100) / 100;
    const ty = H * clamp(num(p.y, 45), 0, 100) / 100;
    const gap = 18 * u; // stop short of the target
    const ex = tx + dx * gap;
    const ey = ty + dy * gap;
    const sx = clamp(tx + dx * len, 30 * u, W - 30 * u);
    const sy = clamp(ty + dy * len, 30 * u, H - 30 * u);
    // Control point pushed sideways from the midpoint, for a hand-drawn curve.
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;
    const nx = -(ey - sy);
    const ny = ex - sx;
    const bend = clamp(num(p.bend, 0.35), -1, 1) * 0.35;
    const cx = mx + nx * bend;
    const cy = my + ny * bend;
    // The head follows the curve's final tangent.
    const angle = Math.atan2(ey - cy, ex - cx) * 180 / Math.PI;
    const stroke = Math.max(4, Math.round(9 * u));
    const head = Math.round(26 * u);

    const draw = r3(Math.min(0.6, t.duration / 3));
    const exit = r3(Math.min(0.3, t.duration / 6));
    const colour = paint(p.color, "brand:primary");

    // Label sits beyond the tail, on the side the arrow comes from.
    const labelX = Math.round(sx + dx * 14 * u);
    const labelY = Math.round(sy + dy * 14 * u);
    const anchorX = dx < -0.1 ? "-100%" : dx > 0.1 ? "0%" : "-50%";
    const anchorY = dy < -0.1 ? "-100%" : dy > 0.1 ? "0%" : "-50%";

    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `
      #${id} { z-index: 67; pointer-events: none; }
      #${id} svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
      #${id} .${id}-path { fill: none; stroke: ${colour}; stroke-width: ${stroke}; stroke-linecap: round;
        stroke-dasharray: 1; stroke-dashoffset: 1; filter: drop-shadow(0 3px 6px rgba(6,12,22,.45)); }
      #${id} .${id}-head { fill: ${colour}; opacity: 0; filter: drop-shadow(0 3px 6px rgba(6,12,22,.45)); }
      #${id} .${id}-lab {
        position: absolute; left: ${labelX}px; top: ${labelY}px;
        transform: translate(${anchorX}, ${anchorY});
        white-space: nowrap; opacity: 0;
        font-family: var(--font-title); font-weight: 800; letter-spacing: -0.01em;
        font-size: ${Math.round(34 * u)}px; color: var(--brand-text);
        background: ${colour}; padding: 0.18em 0.5em 0.22em; border-radius: 0.4em;
        box-shadow: 0 8px 24px rgba(6,12,22,.35);
      }`,
      html: wrapper(id, video, 24, `
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
          <path class="${id}-path" pathLength="1"
            d="M ${r3(sx)} ${r3(sy)} Q ${r3(cx)} ${r3(cy)} ${r3(ex)} ${r3(ey)}" />
          <g transform="translate(${r3(ex)} ${r3(ey)}) rotate(${r3(angle)})">
            <path class="${id}-head" d="M ${head * 0.35} 0 L ${-head * 0.75} ${-head * 0.55} L ${-head * 0.45} 0 L ${-head * 0.75} ${head * 0.55} Z" />
          </g>
        </svg>
        ${p.label ? `<div class="${id}-lab">${esc(p.label)}</div>` : ""}`),
      init: "",
      timeline: `
      tl.fromTo("#${id} .${id}-lab", { opacity: 0, scale: 0.8 },
        { opacity: 1, scale: 1, duration: ${r3(Math.min(0.3, draw))}, ease: "back.out(2)" }, ${r3(t.start)});
      tl.fromTo("#${id} .${id}-path", { strokeDashoffset: 1 },
        { strokeDashoffset: 0, duration: ${draw}, ease: "power2.inOut" }, ${r3(t.start + 0.1)});
      tl.fromTo("#${id} .${id}-head", { opacity: 0, scale: 0.3, transformOrigin: "50% 50%" },
        { opacity: 1, scale: 1, duration: 0.2, ease: "back.out(2.5)" }, ${r3(t.start + 0.1 + draw * 0.85)});
      tl.to("#${id} .${id}-path, #${id} .${id}-head, #${id} .${id}-lab",
        { opacity: 0, duration: ${exit}, ease: "power2.in" }, ${r3(t.end - exit)});`,
    };
  },
};

// ------------------------------------------------------------- progress

const progress = {
  type: "progress",
  space: "canvas",
  label: "Barre de progression",
  hint: "Une fine barre qui se remplit au fil du clip.",
  needsMatte: false,
  timed: true,
  layer: "top",
  schema: [
    {
      key: "position", label: "Position", type: "select", default: "bottom",
      options: [{ value: "top", label: "En haut" }, { value: "bottom", label: "En bas" }],
    },
    { key: "color", label: "Couleur", type: "color", default: "brand:primary" },
    { key: "thickness", label: "Épaisseur (px)", type: "range", min: 2, max: 24, step: 1, default: 8 },
    { key: "track", label: "Fond de piste", type: "range", min: 0, max: 0.8, step: 0.05, default: 0.25 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const h = Math.round(clamp(num(p.thickness, 8), 1, 60) * unitOf(video));
    return {
      layer: "top",
      needsMatte: false,
      timing: t,
      css: `
      #${id} {
        z-index: 86; inset: auto; left: 0; width: 100%; height: ${h}px;
        ${p.position === "top" ? "top: 0;" : "bottom: 0;"}
        background: rgba(255,255,255,${clamp(num(p.track, 0.25), 0, 1)}); opacity: 0;
      }
      #${id} .${id}-fill { position: absolute; inset: 0; background: ${paint(p.color, "brand:primary")};
        transform-origin: left center; transform: scaleX(0); }`,
      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}"
        data-track-index="25"><div class="${id}-fill"></div></div>`,
      init: "",
      timeline: `
      tl.fromTo("#${id}", { opacity: 0 }, { opacity: 1, duration: ${t.full ? 0.001 : 0.2} }, ${r3(t.start)});
      tl.fromTo("#${id} .${id}-fill", { scaleX: 0 }, { scaleX: 1, duration: ${t.duration}, ease: "none" }, ${r3(t.start)});${t.full ? "" : `
      tl.to("#${id}", { opacity: 0, duration: 0.2 }, ${r3(Math.max(t.start, t.end - 0.2))});`}`,
    };
  },
};

// ------------------------------------------------------------------ cta

const CTA_ICONS = [
  { value: "", label: "Aucune" },
  { value: "→", label: "→ Flèche" },
  { value: "▶", label: "▶ Lecture" },
  { value: "🔔", label: "🔔 Cloche" },
  { value: "👍", label: "👍 Pouce" },
  { value: "🔗", label: "🔗 Lien" },
  { value: "💬", label: "💬 Commentaire" },
];

const CTA_SPOTS = {
  "bottom-center": `left: 50%; bottom: 9%; transform: translateX(-50%);`,
  "bottom-right": `right: 5%; bottom: 9%;`,
  "top-right": `right: 5%; top: 7%;`,
  center: `left: 50%; top: 50%; transform: translate(-50%, -50%);`,
};

const cta = {
  type: "cta",
  space: "canvas",
  label: "Bouton d'appel à l'action",
  hint: "Un bouton qui surgit puis pulse doucement : « Abonne-toi », « Lien en commentaire »…",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "text", label: "Texte", type: "text", default: "Abonne-toi" },
    { key: "icon", label: "Icône", type: "select", default: "🔔", options: CTA_ICONS },
    {
      key: "position", label: "Position", type: "select", default: "bottom-center",
      options: [
        { value: "bottom-center", label: "En bas au centre" },
        { value: "bottom-right", label: "En bas à droite" },
        { value: "top-right", label: "En haut à droite" },
        { value: "center", label: "Au centre" },
      ],
    },
    { key: "fill", label: "Bouton", type: "color", default: "brand:primary" },
    { key: "color", label: "Texte", type: "color", default: "brand:text" },
    { key: "size", label: "Taille", type: "range", min: 0.5, max: 2, step: 0.05, default: 1 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const u = unitOf(video) * clamp(num(p.size, 1), 0.3, 3);
    const icon = CTA_ICONS.some((i) => i.value === p.icon) ? p.icon : "";
    const pop = r3(Math.min(0.45, t.duration / 4));
    const exit = r3(Math.min(0.3, t.duration / 6));
    // A finite number of pulses between the entrance and the exit — an
    // infinite repeat would make the whole timeline infinite.
    const room = t.duration - pop - exit - 0.3;
    const pulses = Math.max(0, Math.min(8, Math.floor(room / 1.1)));

    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `
      #${id} { z-index: 68; pointer-events: none; }
      #${id} .${id}-spot { position: absolute; ${CTA_SPOTS[p.position] || CTA_SPOTS["bottom-center"]} }
      #${id} .${id}-btn {
        display: inline-flex; align-items: center; gap: 0.45em; white-space: nowrap; opacity: 0;
        font-family: var(--font-title); font-weight: 800; letter-spacing: -0.01em;
        font-size: ${Math.round(34 * u)}px; line-height: 1;
        padding: 0.55em 1.05em; border-radius: 999px;
        background: ${paint(p.fill, "brand:primary")}; color: ${paint(p.color, "brand:text")};
        box-shadow: 0 12px 32px rgba(6,12,22,.4);
      }`,
      html: wrapper(id, video, 26, `
        <div class="${id}-spot"><div class="${id}-btn">${icon ? `<span>${icon}</span>` : ""}<span>${esc(p.text)}</span></div></div>`),
      init: "",
      timeline: `
      tl.fromTo("#${id} .${id}-btn", { opacity: 0, scale: 0.4, y: ${Math.round(24 * u)} },
        { opacity: 1, scale: 1, y: 0, duration: ${pop}, ease: "back.out(2.2)" }, ${r3(t.start)});${pulses ? `
      tl.to("#${id} .${id}-btn", { scale: 1.07, duration: 0.25, ease: "power1.inOut", yoyo: true,
        repeat: ${pulses * 2 - 1}, repeatDelay: 0.3 }, ${r3(t.start + pop + 0.2)});` : ""}
      tl.to("#${id} .${id}-btn", { opacity: 0, scale: 0.7, duration: ${exit}, ease: "power2.in" }, ${r3(t.end - exit)});`,
    };
  },
};

// ----------------------------------------------------------------- logo

const CORNERS = {
  "top-left": "left", "top-right": "right", "bottom-left": "left", "bottom-right": "right",
};

const logo = {
  type: "logo",
  space: "canvas",
  label: "Logo",
  hint: "Le logo de ta charte graphique dans un coin (ou une autre image).",
  needsMatte: false,
  timed: true,
  layer: "top",
  schema: [
    { key: "image", label: "Image", type: "image", default: "", brandLogo: true },
    {
      key: "corner", label: "Coin", type: "select", default: "top-right",
      options: [
        { value: "top-left", label: "En haut à gauche" },
        { value: "top-right", label: "En haut à droite" },
        { value: "bottom-left", label: "En bas à gauche" },
        { value: "bottom-right", label: "En bas à droite" },
      ],
    },
    { key: "size", label: "Taille (× cadre)", type: "range", min: 0.04, max: 0.4, step: 0.01, default: 0.12 },
    { key: "opacity", label: "Opacité", type: "range", min: 0.1, max: 1, step: 0.05, default: 0.9 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    // Its own image if one was chosen, else the brand's logo.
    const file = LOGO_FILE.test(String(p.image || "")) ? p.image
      : LOGO_FILE.test(String(video.brand?.logo || "")) ? video.brand.logo : null;
    if (!file) return null;
    const t = timingOf(fx, video);
    const short = Math.min(video.width, video.height);
    const size = Math.round(short * clamp(num(p.size, 0.12), 0.01, 1));
    const margin = Math.round(short * 0.045);
    const corner = CORNERS[p.corner] ? p.corner : "top-right";
    const [v, h] = corner.split("-");
    const fadeIn = t.full ? 0.001 : r3(Math.min(0.45, t.duration / 4));
    const fadeOut = t.full ? 0.001 : r3(Math.min(0.3, t.duration / 6));

    return {
      layer: "top",
      needsMatte: false,
      timing: t,
      css: `
      #${id} {
        z-index: 84; inset: auto; ${v}: ${margin}px; ${h}: ${margin}px;
        width: ${size}px; height: ${size}px; opacity: 0;
      }
      #${id} img { width: 100%; height: 100%; object-fit: contain; object-position: ${v} ${h};
        filter: drop-shadow(0 4px 12px rgba(6,12,22,.35)); }`,
      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}"
        data-track-index="27"><img src="media/${file}" alt="" /></div>`,
      init: "",
      timeline: `
      tl.fromTo("#${id}", { opacity: 0, scale: 0.85 },
        { opacity: ${clamp(num(p.opacity, 0.9), 0, 1)}, scale: 1, duration: ${fadeIn}, ease: "power2.out" }, ${r3(t.start)});
      tl.to("#${id}", { opacity: 0, duration: ${fadeOut}, ease: "power2.in" }, ${r3(Math.max(t.start + fadeIn, t.end - fadeOut))});`,
    };
  },
};

export const ANIM_EFFECTS = [highlight, keywords, bullets, counter, arrow, progress, cta, logo]
  .map((e) => Object.assign(e, { category: "Animations" }));
