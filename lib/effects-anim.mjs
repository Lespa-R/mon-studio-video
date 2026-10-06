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
import { esc, num, clamp, r3, jsString, unitOf } from "./util.mjs";
import { PIN, PIN_OPTION, pinFields, pinnedPath, pinTimeline, pinWrap } from "./pins.mjs";

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

// "free" is what dragging an element on the preview sets: its centre then
// sits at (x %, y %) of the frame.
const FREE = { value: "free", label: "Libre (déplacé à la souris)" };

const POSITIONS = [
  { value: "top", label: "Haut" },
  { value: "center", label: "Centre" },
  { value: "bottom", label: "Bas" },
  FREE,
];

// The x / y fields that go with a "free" position, shown only in that mode.
const freeXY = (key, also = []) => [
  { key: "x", label: "Horizontal (%)", type: "range", min: 0, max: 100, step: 0.5, default: 50, showIf: { key, values: ["free", ...also] } },
  { key: "y", label: "Vertical (%)", type: "range", min: 0, max: 100, step: 0.5, default: 50, showIf: { key, values: ["free", ...also] } },
];

// Centred on (x %, y %). max-content keeps an element near the right edge
// from being squeezed by the little room left of it.
const freeSpot = (p) =>
  `left: ${clamp(num(p.x, 50), -20, 120)}%; top: ${clamp(num(p.y, 50), -20, 120)}%;
        transform: translate(-50%, -50%); width: max-content;`;

// A full-frame flex box that puts its content (the -pos child) at one of
// POSITIONS, or anywhere in "free" mode.
function placeCss(id, p, key, video, z) {
  const u = unitOf(video);
  const position = p[key];
  if (position === "free" || position === PIN) {
    return `
      #${id} { z-index: ${z}; pointer-events: none; }
      #${id} .${id}-pos { position: absolute; ${freeSpot(p)} }`;
  }
  const justify = { top: "flex-start", center: "center", bottom: "flex-end" }[position] || "center";
  return `
      #${id} {
        z-index: ${z};
        display: flex; flex-direction: column; align-items: center; justify-content: ${justify};
        padding: ${Math.round(video.height * 0.1)}px ${Math.round(40 * u)}px ${Math.round(video.height * 0.12)}px;
        pointer-events: none;
      }
      #${id} .${id}-pos { width: max-content; max-width: 100%; }`;
}

// ------------------------------------------------ pinned to the scenery
//
// Arrow, circle, emoji and counter can be « Fixé dans le décor »
// (lib/pins.mjs): laid out on the stage (source px, so x / y are % of the
// source frame) instead of the screen, inside a mover that turns around their
// spot and follows the camera's motion.

const ATTACH = [{ value: "screen", label: "À l'écran" }, { value: PIN, label: "Fixé dans le décor (suit la caméra)" }];
const attachFields = () => [
  { key: "attach", label: "Accroche", type: "select", default: "screen", options: ATTACH },
  ...pinFields({ key: "attach", values: [PIN] }),
];
const spaceBy = (key) => (fx) => (fx.params?.[key] === PIN ? "stage" : "canvas");

// Laying out an effect pinned by `key` on its spot (ax, ay, source px): its
// markup in a mover (lib/pins.mjs pinWrap), and the mover's tweens once the
// spot has been followed. Not pinned: the markup as it is, no tweens.
function pinning(fx, video, t, key, ax, ay) {
  if (fx.params[key] !== PIN) return { lay: (inner) => inner, tweens: "" };
  const tweens = pinTimeline(`#${fx.id}-mv`, pinnedPath(video, fx.id, t, fx.params.pinFollow), { x: ax, y: ay });
  return { lay: (inner) => pinWrap(fx.id, ax, ay, inner), tweens: tweens && `${tweens}\n` };
}

// The box the studio lets you grab on the preview is marked data-drag.
const pos = (id, inner) => `<div class="${id}-pos" data-drag="${id}">${inner}</div>`;

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
    ...freeXY("position"),
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
      css: `${placeCss(id, p, "position", video, 63)}
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
        ${pos(id, `<div id="${id}-line" class="${id}-line"><span class="${id}-bar"></span><span class="${id}-txt">${esc(p.text)}</span></div>`)}`),
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
    ...freeXY("position"),
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
      css: `${placeCss(id, p, "position", video, 64)}
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
        ${pos(id, `<div class="${id}-slot">${words.map((w, i) =>
          `<div id="${id}-k${i}" class="${id}-w">${esc(w)}</div>`).join("")}</div>`)}`),
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
        FREE,
      ],
    },
    ...freeXY("side"),
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
      free: `left: ${clamp(num(p.x, 50), -20, 120)}%; top: ${clamp(num(p.y, 50), -20, 120)}%; transform: translate(-50%, -50%);`,
    }[p.side] || "";
    const fromX = p.side === "right" ? 40 : p.side === "left" ? -40 : 0;
    const fromY = p.side === "bottom" || p.side === "free" ? 30 : 0;

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
        <div class="${id}-spot" data-drag="${id}"><div class="${id}-card"><div class="${id}-in">
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
    { key: "position", label: "Position", type: "select", default: "center", options: [...POSITIONS.slice(0, 3), PIN_OPTION, POSITIONS[3]] },
    ...freeXY("position", [PIN]),
    ...pinFields({ key: "position", values: [PIN] }),
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

    const pin = pinning(fx, video, t, "position", video.width * clamp(num(p.x, 50), 0, 100) / 100, video.height * clamp(num(p.y, 50), 0, 100) / 100);

    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `${placeCss(id, p, "position", video, 66)}
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
      html: wrapper(id, video, 23, pin.lay(`
        ${pos(id, `<div class="${id}-box">
          <div id="${id}-num" class="${id}-num">${esc(p.prefix || "")}<span id="${id}-n">${esc(formatNumber(from, decimals))}</span>${esc(p.suffix || "")}</div>
          ${p.label ? `<div class="${id}-lab">${esc(p.label)}</div>` : ""}
        </div>`)}`)),
      // Measured at the final value, the widest the number will get.
      init: `
      (function () {
        var n = document.getElementById(${jsString(`${id}-n`)});
        if (!n) return;
        var start = n.textContent;
        n.textContent = ${jsString(formatNumber(to, decimals))};${fitWidth(`${id}-num`, video.width * 0.86)}
        n.textContent = start;
      })();`,
      timeline: pin.tweens + `
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
    ...attachFields(),
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
    const pin = pinning(fx, video, t, "attach", tx, ty);
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
      html: wrapper(id, video, 24, pin.lay(`
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
          <path class="${id}-path" pathLength="1" data-drag="${id}"
            d="M ${r3(sx)} ${r3(sy)} Q ${r3(cx)} ${r3(cy)} ${r3(ex)} ${r3(ey)}" />
          <g transform="translate(${r3(ex)} ${r3(ey)}) rotate(${r3(angle)})">
            <path class="${id}-head" data-drag="${id}" d="M ${head * 0.35} 0 L ${-head * 0.75} ${-head * 0.55} L ${-head * 0.45} 0 L ${-head * 0.75} ${head * 0.55} Z" />
          </g>
        </svg>
        ${p.label ? `<div class="${id}-lab" data-drag="${id}">${esc(p.label)}</div>` : ""}`)),
      init: "",
      timeline: pin.tweens + `
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
const ctaSpot = (p) => (p.position === "free" ? freeSpot(p) : CTA_SPOTS[p.position] || CTA_SPOTS["bottom-center"]);

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
        FREE,
      ],
    },
    ...freeXY("position"),
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
      #${id} .${id}-spot { position: absolute; ${ctaSpot(p)} }
      #${id} .${id}-btn {
        display: inline-flex; align-items: center; gap: 0.45em; white-space: nowrap; opacity: 0;
        font-family: var(--font-title); font-weight: 800; letter-spacing: -0.01em;
        font-size: ${Math.round(34 * u)}px; line-height: 1;
        padding: 0.55em 1.05em; border-radius: 999px;
        background: ${paint(p.fill, "brand:primary")}; color: ${paint(p.color, "brand:text")};
        box-shadow: 0 12px 32px rgba(6,12,22,.4);
      }`,
      html: wrapper(id, video, 26, `
        <div class="${id}-spot" data-drag="${id}"><div class="${id}-btn">${icon ? `<span>${icon}</span>` : ""}<span>${esc(p.text)}</span></div></div>`),
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
        FREE,
      ],
    },
    ...freeXY("corner"),
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
    const free = p.corner === "free";
    const corner = CORNERS[p.corner] ? p.corner : "top-right";
    const [v, h] = corner.split("-");
    // The box is placed, the image inside it animated: a tween on the box's
    // scale would overwrite the free position's centring.
    const place = free ? freeSpot(p) : `${v}: ${margin}px; ${h}: ${margin}px;`;
    const fadeIn = t.full ? 0.001 : r3(Math.min(0.45, t.duration / 4));
    const fadeOut = t.full ? 0.001 : r3(Math.min(0.3, t.duration / 6));

    return {
      layer: "top",
      needsMatte: false,
      timing: t,
      css: `
      #${id} {
        z-index: 84; inset: auto; ${place}
        width: ${size}px; height: ${size}px;
      }
      #${id} img { width: 100%; height: 100%; object-fit: contain; object-position: ${free ? "center" : `${v} ${h}`}; opacity: 0;
        filter: drop-shadow(0 4px 12px rgba(6,12,22,.35)); }`,
      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}"
        data-track-index="27" data-drag="${id}"><img src="media/${file}" alt="" /></div>`,
      init: "",
      timeline: `
      tl.fromTo("#${id} img", { opacity: 0, scale: 0.85 },
        { opacity: ${clamp(num(p.opacity, 0.9), 0, 1)}, scale: 1, duration: ${fadeIn}, ease: "power2.out" }, ${r3(t.start)});
      tl.to("#${id} img", { opacity: 0, duration: ${fadeOut}, ease: "power2.in" }, ${r3(Math.max(t.start + fadeIn, t.end - fadeOut))});`,
    };
  },
};

// ---------------------------------------------------------------- circle

// A smooth deterministic wobble, for the "hand-drawn" circle.
const wobble = (i, k) => Math.sin(i * 0.37 + k * 1.7) * 0.5;
// A deterministic scatter in [-0.5, 0.5): uncorrelated from one i (or k) to
// the next, and the same on every run — never Math.random.
const scatter = (i, k) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
};

const circle = {
  type: "circle",
  space: "canvas",
  label: "Cercle dessiné",
  hint: "Un cercle tracé à la main autour d'un détail de l'image.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "x", label: "Centre horizontal (%)", type: "range", min: 0, max: 100, step: 0.5, default: 60 },
    { key: "y", label: "Centre vertical (%)", type: "range", min: 0, max: 100, step: 0.5, default: 40 },
    { key: "w", label: "Largeur", type: "range", min: 0.05, max: 0.9, step: 0.01, default: 0.26 },
    { key: "h", label: "Hauteur", type: "range", min: 0.05, max: 0.9, step: 0.01, default: 0.16 },
    { key: "color", label: "Couleur", type: "color", default: "brand:primary" },
    { key: "thickness", label: "Épaisseur", type: "range", min: 2, max: 20, step: 1, default: 7 },
    ...attachFields(),
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const u = unitOf(video);
    const short = Math.min(video.width, video.height);
    const cx = video.width * clamp(num(p.x, 60), 0, 100) / 100;
    const cy = video.height * clamp(num(p.y, 40), 0, 100) / 100;
    const pin = pinning(fx, video, t, "attach", cx, cy);
    const rx = short * clamp(num(p.w, 0.26), 0.02, 2) / 2;
    const ry = short * clamp(num(p.h, 0.16), 0.02, 2) / 2;
    // A little more than one turn, slightly off-round, like a pen stroke that
    // overshoots where it started.
    const steps = 64;
    const turns = 1.12;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI * 0.6 + (i / steps) * Math.PI * 2 * turns;
      const grow = 1 + 0.06 * (i / steps) + 0.025 * wobble(i, 1);
      pts.push(`${r3(cx + Math.cos(a) * rx * grow)} ${r3(cy + Math.sin(a) * ry * grow)}`);
    }
    const draw = r3(Math.min(0.7, t.duration / 3));
    const exit = r3(Math.min(0.3, t.duration / 6));
    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `
      #${id} { z-index: 67; pointer-events: none; }
      #${id} svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
      #${id} path { fill: none; stroke: ${paint(p.color, "brand:primary")};
        stroke-width: ${Math.round(clamp(num(p.thickness, 7), 1, 40) * u)}; stroke-linecap: round; stroke-linejoin: round;
        stroke-dasharray: 1; stroke-dashoffset: 1; filter: drop-shadow(0 3px 6px rgba(6,12,22,.4)); }`,
      html: wrapper(id, video, 28, pin.lay(`
        <svg viewBox="0 0 ${video.width} ${video.height}" preserveAspectRatio="none">
          <path pathLength="1" data-drag="${id}" d="M ${pts.join(" L ")}" />
        </svg>`)),
      init: "",
      timeline: pin.tweens + `
      tl.fromTo("#${id} path", { strokeDashoffset: 1, opacity: 1 },
        { strokeDashoffset: 0, duration: ${draw}, ease: "power2.inOut" }, ${r3(t.start)});
      tl.to("#${id} path", { opacity: 0, duration: ${exit}, ease: "power2.in" }, ${r3(Math.max(t.start + draw, t.end - exit))});`,
    };
  },
};

// ----------------------------------------------------------------- quote

const quote = {
  type: "quote",
  space: "canvas",
  label: "Citation",
  hint: "Une citation mise en valeur, mot à mot, avec son auteur.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "text", label: "Citation", type: "text", default: "La simplicité est la sophistication suprême." },
    { key: "author", label: "Auteur", type: "text", default: "Léonard de Vinci" },
    { key: "position", label: "Position", type: "select", default: "center", options: POSITIONS },
    ...freeXY("position"),
    { key: "accent", label: "Guillemets", type: "color", default: "brand:primary" },
    { key: "card", label: "Fond", type: "range", min: 0, max: 1, step: 0.05, default: 0.7 },
    { key: "size", label: "Taille", type: "range", min: 0.5, max: 2, step: 0.05, default: 1 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const u = unitOf(video) * clamp(num(p.size, 1), 0.3, 3);
    const words = String(p.text || "").split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const width = Math.round(video.width * (landscape(video) ? 0.62 : 0.84));
    const intro = r3(Math.min(0.4, t.duration / 5));
    const exit = r3(Math.min(0.35, t.duration / 6));
    const stagger = r3(Math.min(0.09, Math.max(0.01, (t.duration - intro - exit - 0.8) / Math.max(1, words.length))));
    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `${placeCss(id, p, "position", video, 64)}
      #${id} .${id}-card {
        width: ${width}px; max-width: ${Math.round(video.width * 0.9)}px; box-sizing: border-box; opacity: 0;
        padding: ${Math.round(30 * u)}px ${Math.round(36 * u)}px; border-radius: ${Math.round(18 * u)}px;
        background: ${paintAlpha("brand:surface", clamp(num(p.card, 0.7), 0, 1))};
        color: var(--brand-text); text-shadow: ${num(p.card, 0.7) < 0.3 ? shadow : "none"};
      }
      #${id} .${id}-q { font-family: Georgia, serif; font-weight: 700; line-height: 0.6; height: ${Math.round(40 * u)}px;
        font-size: ${Math.round(110 * u)}px; color: ${paint(p.accent, "brand:primary")}; }
      #${id} .${id}-t { font-family: var(--font-title); font-weight: 700; font-size: ${Math.round(38 * u)}px;
        line-height: 1.25; letter-spacing: -0.01em; }
      #${id} .${id}-wd { display: inline-block; opacity: 0; }
      #${id} .${id}-a { font-family: var(--font-body); font-size: ${Math.round(22 * u)}px; margin-top: ${Math.round(16 * u)}px;
        opacity: 0; color: ${paintAlpha("brand:text", 0.75)}; }`,
      html: wrapper(id, video, 29, `
        ${pos(id, `<div class="${id}-card">
          <div class="${id}-q">“</div>
          <div class="${id}-t">${words.map((w) => `<span class="${id}-wd">${esc(w)}</span>`).join(" ")}</div>
          ${p.author ? `<div class="${id}-a">— ${esc(p.author)}</div>` : ""}
        </div>`)}`),
      init: "",
      timeline: `
      tl.fromTo("#${id} .${id}-card", { opacity: 0, y: ${Math.round(24 * u)} },
        { opacity: 1, y: 0, duration: ${intro}, ease: "power3.out" }, ${r3(t.start)});
      tl.fromTo("#${id} .${id}-wd", { opacity: 0, y: ${Math.round(10 * u)} },
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: ${stagger} }, ${r3(t.start + intro * 0.7)});
      tl.fromTo("#${id} .${id}-a", { opacity: 0 }, { opacity: 1, duration: 0.3 },
        ${r3(Math.min(t.end - exit - 0.3, t.start + intro + stagger * words.length + 0.2))});
      tl.to("#${id} .${id}-card", { opacity: 0, y: ${Math.round(-16 * u)}, duration: ${exit}, ease: "power2.in" }, ${r3(t.end - exit)});`,
    };
  },
};

// ---------------------------------------------------------- notification

const NOTIF_SPOTS = [
  { value: "top", label: "En haut au centre" },
  { value: "top-right", label: "En haut à droite" },
  FREE,
];

const notification = {
  type: "notification",
  space: "canvas",
  label: "Notification",
  hint: "Une notification façon téléphone qui glisse depuis le haut.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "app", label: "Expéditeur", type: "text", default: "Mon Studio" },
    { key: "title", label: "Titre", type: "text", default: "Nouveau message" },
    { key: "text", label: "Message", type: "text", default: "Ta vidéo est prête à être publiée 🎬" },
    { key: "position", label: "Position", type: "select", default: "top", options: NOTIF_SPOTS },
    ...freeXY("position"),
    { key: "accent", label: "Icône", type: "color", default: "brand:primary" },
    { key: "size", label: "Taille", type: "range", min: 0.6, max: 1.8, step: 0.05, default: 1 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const u = unitOf(video) * clamp(num(p.size, 1), 0.3, 3);
    const width = Math.round(Math.min(video.width * 0.9, 560 * u));
    const top = Math.round(video.height * 0.05);
    const spot = p.position === "free" ? freeSpot(p)
      : p.position === "top-right" ? `right: ${Math.round(video.width * 0.04)}px; top: ${top}px;`
      : `left: 50%; top: ${top}px; transform: translateX(-50%);`;
    const slide = r3(Math.min(0.5, t.duration / 4));
    const exit = r3(Math.min(0.4, t.duration / 5));
    const initial = [...String(p.app || "?").trim()][0] || "?";
    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `
      #${id} { z-index: 69; pointer-events: none; }
      #${id} .${id}-spot { position: absolute; ${spot} width: ${width}px; }
      #${id} .${id}-card {
        display: flex; gap: ${Math.round(14 * u)}px; align-items: flex-start; opacity: 0;
        padding: ${Math.round(14 * u)}px ${Math.round(16 * u)}px; border-radius: ${Math.round(22 * u)}px;
        background: rgba(245,246,248,.94); color: #111827; box-shadow: 0 18px 40px rgba(6,12,22,.35);
        font-family: var(--font-body);
      }
      #${id} .${id}-ic { flex: 0 0 auto; width: ${Math.round(44 * u)}px; height: ${Math.round(44 * u)}px; border-radius: ${Math.round(11 * u)}px;
        background: ${paint(p.accent, "brand:primary")}; color: #fff; display: grid; place-items: center;
        font-family: var(--font-title); font-weight: 800; font-size: ${Math.round(22 * u)}px; }
      #${id} .${id}-body { min-width: 0; flex: 1; }
      #${id} .${id}-app { font-size: ${Math.round(15 * u)}px; color: #6b7280; display: flex; justify-content: space-between; }
      #${id} .${id}-ti { font-size: ${Math.round(19 * u)}px; font-weight: 700; margin-top: ${Math.round(2 * u)}px; }
      #${id} .${id}-tx { font-size: ${Math.round(18 * u)}px; line-height: 1.3; }`,
      html: wrapper(id, video, 31, `
        <div class="${id}-spot" data-drag="${id}"><div class="${id}-card">
          <div class="${id}-ic">${esc(initial.toUpperCase())}</div>
          <div class="${id}-body">
            <div class="${id}-app"><span>${esc(p.app)}</span><span>maintenant</span></div>
            ${p.title ? `<div class="${id}-ti">${esc(p.title)}</div>` : ""}
            ${p.text ? `<div class="${id}-tx">${esc(p.text)}</div>` : ""}
          </div>
        </div></div>`),
      init: "",
      timeline: `
      tl.fromTo("#${id} .${id}-card", { opacity: 0, y: ${Math.round(-60 * u)}, scale: 0.96 },
        { opacity: 1, y: 0, scale: 1, duration: ${slide}, ease: "back.out(1.4)" }, ${r3(t.start)});
      tl.to("#${id} .${id}-card", { opacity: 0, y: ${Math.round(-50 * u)}, duration: ${exit}, ease: "power2.in" }, ${r3(t.end - exit)});`,
    };
  },
};

// --------------------------------------------------------------- chapter

const chapter = {
  type: "chapter",
  space: "canvas",
  label: "Titre de chapitre",
  hint: "Un panneau plein écran balaie l'image pour annoncer une nouvelle partie.",
  needsMatte: false,
  timed: true,
  layer: "top",
  schema: [
    { key: "number", label: "Numéro", type: "text", default: "01" },
    { key: "title", label: "Titre", type: "text", default: "L'essentiel" },
    { key: "fill", label: "Panneau", type: "color", default: "brand:primary" },
    { key: "color", label: "Texte", type: "color", default: "brand:text" },
    { key: "hold", label: "Durée à l'écran (s)", type: "number", min: 0.3, step: 0.1, default: 1.4 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const u = unitOf(video);
    // In, hold, out — all inside the window, starting at its beginning.
    const sweep = r3(Math.min(0.45, t.duration / 4));
    const hold = r3(Math.max(0.1, Math.min(num(p.hold, 1.4), t.duration - sweep * 2)));
    const outAt = r3(t.start + sweep + hold);
    return {
      layer: "top",
      needsMatte: false,
      timing: t,
      css: `
      #${id} { z-index: 89; pointer-events: none; overflow: hidden; }
      /* No CSS transform: GSAP reads one back as pixels and would add its
         own xPercent on top. The fromTo tweens put the panels off-frame. */
      #${id} .${id}-panel { position: absolute; inset: 0; background: ${paint(p.fill, "brand:primary")};
        display: flex; flex-direction: column; justify-content: center;
        padding: 0 ${Math.round(video.width * 0.1)}px; color: ${paint(p.color, "brand:text")}; }
      #${id} .${id}-band { position: absolute; top: 0; bottom: 0; width: 18%; background: var(--brand-secondary); }
      #${id} .${id}-n { font-family: var(--font-title); font-weight: 900; font-size: ${Math.round(110 * u)}px;
        line-height: 1; opacity: 0; letter-spacing: -0.04em; }
      #${id} .${id}-t { font-family: var(--font-title); font-weight: 800; font-size: ${Math.round(64 * u)}px;
        line-height: 1.1; margin-top: ${Math.round(10 * u)}px; opacity: 0; letter-spacing: -0.02em; }`,
      html: wrapper(id, video, 32, `
        <div class="${id}-band"></div>
        <div class="${id}-panel">
          ${p.number ? `<div class="${id}-n">${esc(p.number)}</div>` : ""}
          <div class="${id}-t">${esc(p.title)}</div>
        </div>`),
      init: "",
      timeline: `
      tl.fromTo("#${id} .${id}-band", { xPercent: -101 }, { xPercent: 560, duration: ${r3(sweep * 1.3)}, ease: "power2.inOut" }, ${r3(t.start)});
      tl.fromTo("#${id} .${id}-panel", { xPercent: -101 }, { xPercent: 0, duration: ${sweep}, ease: "power3.inOut" }, ${r3(t.start + sweep * 0.2)});
      tl.fromTo("#${id} .${id}-n, #${id} .${id}-t", { opacity: 0, x: ${Math.round(-40 * u)} },
        { opacity: 1, x: 0, duration: 0.35, ease: "power3.out", stagger: 0.08 }, ${r3(t.start + sweep * 0.9)});
      tl.to("#${id} .${id}-panel", { xPercent: 101, duration: ${sweep}, ease: "power3.inOut" }, ${outAt});`,
    };
  },
};

// ------------------------------------------------------------------ wipe

const wipe = {
  type: "wipe",
  space: "canvas",
  label: "Transition balayage",
  hint: "Deux bandes de couleur traversent l'image : parfait pour masquer une coupe. Place-la sur la timeline.",
  needsMatte: false,
  timed: true,
  layer: "top",
  schema: [
    {
      key: "direction", label: "Sens", type: "select", default: "right",
      options: [
        { value: "right", label: "Vers la droite" },
        { value: "left", label: "Vers la gauche" },
        { value: "down", label: "Vers le bas" },
        { value: "up", label: "Vers le haut" },
      ],
    },
    { key: "speed", label: "Durée (s)", type: "number", min: 0.2, step: 0.05, default: 0.7 },
    { key: "c1", label: "Première bande", type: "color", default: "brand:primary" },
    { key: "c2", label: "Seconde bande", type: "color", default: "brand:secondary" },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const d = r3(Math.min(Math.max(0.2, num(p.speed, 0.7)), t.duration));
    const axis = p.direction === "down" || p.direction === "up" ? "yPercent" : "xPercent";
    const sign = p.direction === "left" || p.direction === "up" ? -1 : 1;
    // Each band crosses the whole frame: in from one side, out the other.
    return {
      layer: "top",
      needsMatte: false,
      timing: t,
      css: `
      #${id} { z-index: 89; pointer-events: none; overflow: hidden; }
      #${id} .${id}-b { position: absolute; inset: 0; }
      #${id} .${id}-b1 { background: ${paint(p.c1, "brand:primary")}; }
      #${id} .${id}-b2 { background: ${paint(p.c2, "brand:secondary")}; }`,
      html: wrapper(id, video, 33, `
        <div class="${id}-b ${id}-b2"></div>
        <div class="${id}-b ${id}-b1"></div>`),
      init: "",
      timeline: `
      tl.fromTo("#${id} .${id}-b2", { ${axis}: ${-101 * sign} }, { ${axis}: ${101 * sign}, duration: ${d}, ease: "power3.inOut" }, ${r3(t.start)});
      tl.fromTo("#${id} .${id}-b1", { ${axis}: ${-101 * sign} }, { ${axis}: ${101 * sign}, duration: ${r3(d * 0.9)}, ease: "power3.inOut" }, ${r3(t.start + d * 0.1)});`,
    };
  },
};

// ----------------------------------------------------------------- emoji

const EMOJIS = ["❤️", "👍", "🔥", "😂", "👏", "🎉", "💡", "🚀", "✨", "😮"].map((e) => ({ value: e, label: e }));

const emoji = {
  type: "emoji",
  space: "canvas",
  label: "Réaction emoji",
  hint: "Une gerbe d'emojis qui s'envolent depuis un point.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "emoji", label: "Emoji", type: "select", default: "❤️", options: EMOJIS },
    { key: "x", label: "Départ horizontal (%)", type: "range", min: 0, max: 100, step: 0.5, default: 78 },
    { key: "y", label: "Départ vertical (%)", type: "range", min: 0, max: 100, step: 0.5, default: 85 },
    { key: "count", label: "Nombre", type: "range", min: 3, max: 24, step: 1, default: 10 },
    { key: "size", label: "Taille", type: "range", min: 0.5, max: 2.5, step: 0.05, default: 1 },
    ...attachFields(),
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const u = unitOf(video) * clamp(num(p.size, 1), 0.3, 4);
    const glyph = EMOJIS.some((e) => e.value === p.emoji) ? p.emoji : "❤️";
    const n = clamp(Math.round(num(p.count, 10)), 1, 40);
    const x = video.width * clamp(num(p.x, 78), 0, 100) / 100;
    const y = video.height * clamp(num(p.y, 85), 0, 100) / 100;
    const pin = pinning(fx, video, t, "attach", x, y);
    const rise = Math.min(video.height * 0.55, 420 * unitOf(video));
    const fly = r3(Math.min(1.6, t.duration * 0.7));
    const spread = r3(Math.max(0, Math.min(0.08, (t.duration - fly) / n)));
    // Each particle's drift, size and delay from a fixed formula, never random.
    const parts = Array.from({ length: n }, (_, i) => ({
      dx: Math.round(scatter(i, 3) * 320 * unitOf(video)),
      dy: Math.round(-rise * (0.55 + 0.45 * (scatter(i, 5) + 0.5))),
      rot: Math.round(scatter(i, 7) * 60),
      s: r3(0.7 + 0.6 * (scatter(i, 9) + 0.5)),
    }));
    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `
      #${id} { z-index: 70; pointer-events: none; }
      #${id} .${id}-e { position: absolute; left: ${Math.round(x)}px; top: ${Math.round(y)}px; opacity: 0;
        font-size: ${Math.round(46 * u)}px; line-height: 1; transform: translate(-50%, -50%); }
      /* inline-block: transforms do nothing on an inline span */
      #${id} .${id}-e span { display: inline-block; }
      #${id} .${id}-o { position: absolute; left: ${Math.round(x - 30 * u)}px; top: ${Math.round(y - 30 * u)}px;
        width: ${Math.round(60 * u)}px; height: ${Math.round(60 * u)}px; }`,
      html: wrapper(id, video, 34, pin.lay(`
        <div class="${id}-o" data-drag="${id}"></div>
        ${parts.map((_, i) => `<div id="${id}-e${i}" class="${id}-e"><span>${glyph}</span></div>`).join("")}`)),
      init: "",
      timeline: pin.tweens + parts.map((q, i) => {
        const at = r3(t.start + i * spread);
        return `
      tl.fromTo("#${id}-e${i} span", { opacity: 0, x: 0, y: 0, scale: 0.3, rotation: 0 },
        { opacity: 1, scale: ${q.s}, duration: 0.2, ease: "back.out(3)" }, ${at});
      tl.to("#${id}-e${i} span", { x: ${q.dx}, y: ${q.dy}, rotation: ${q.rot}, duration: ${fly}, ease: "power1.out" }, ${at});
      tl.to("#${id}-e${i} span", { opacity: 0, duration: ${r3(fly * 0.35)}, ease: "power1.in" }, ${r3(at + fly * 0.65)});`;
      }).join("") + `
      tl.set("#${id} .${id}-e", { opacity: 1 }, ${r3(t.start)});
      tl.set("#${id} .${id}-e", { opacity: 0 }, ${r3(t.end)});`,
    };
  },
};

// ---------------------------------------------------------------- social

const social = {
  type: "social",
  space: "canvas",
  label: "Pseudo réseau social",
  hint: "Ton pseudo et ton réseau dans une pastille qui glisse dans le coin.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "handle", label: "Pseudo", type: "text", default: "@robin" },
    { key: "network", label: "Réseau", type: "text", default: "LinkedIn" },
    {
      key: "position", label: "Position", type: "select", default: "bottom-left",
      options: [
        { value: "bottom-left", label: "En bas à gauche" },
        { value: "bottom-right", label: "En bas à droite" },
        { value: "top-left", label: "En haut à gauche" },
        FREE,
      ],
    },
    ...freeXY("position"),
    { key: "accent", label: "Pastille", type: "color", default: "brand:primary" },
    { key: "size", label: "Taille", type: "range", min: 0.6, max: 2, step: 0.05, default: 1 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const u = unitOf(video) * clamp(num(p.size, 1), 0.3, 3);
    const m = Math.round(Math.min(video.width, video.height) * 0.06);
    const spots = {
      "bottom-left": `left: ${m}px; bottom: ${m}px;`,
      "bottom-right": `right: ${m}px; bottom: ${m}px;`,
      "top-left": `left: ${m}px; top: ${m}px;`,
    };
    const spot = p.position === "free" ? freeSpot(p) : spots[p.position] || spots["bottom-left"];
    const fromX = p.position === "bottom-right" ? 40 : -40;
    const intro = r3(Math.min(0.5, t.duration / 4));
    const exit = r3(Math.min(0.35, t.duration / 6));
    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `
      #${id} { z-index: 71; pointer-events: none; }
      #${id} .${id}-spot { position: absolute; ${spot} }
      #${id} .${id}-pill {
        display: inline-flex; align-items: center; gap: ${Math.round(12 * u)}px; opacity: 0; white-space: nowrap;
        padding: ${Math.round(8 * u)}px ${Math.round(18 * u)}px ${Math.round(8 * u)}px ${Math.round(8 * u)}px;
        border-radius: 999px; background: ${paintAlpha("brand:surface", 0.78)}; color: var(--brand-text);
        box-shadow: 0 10px 28px rgba(6,12,22,.35);
      }
      #${id} .${id}-at { width: ${Math.round(40 * u)}px; height: ${Math.round(40 * u)}px; border-radius: 50%;
        display: grid; place-items: center; background: ${paint(p.accent, "brand:primary")};
        font-family: var(--font-title); font-weight: 900; font-size: ${Math.round(22 * u)}px; color: #fff; }
      #${id} .${id}-h { font-family: var(--font-title); font-weight: 800; font-size: ${Math.round(24 * u)}px; line-height: 1.1; }
      #${id} .${id}-n { font-family: var(--font-body); font-size: ${Math.round(15 * u)}px; opacity: .72; }`,
      html: wrapper(id, video, 35, `
        <div class="${id}-spot" data-drag="${id}"><div class="${id}-pill">
          <div class="${id}-at">@</div>
          <div><div class="${id}-h">${esc(p.handle)}</div>${p.network ? `<div class="${id}-n">${esc(p.network)}</div>` : ""}</div>
        </div></div>`),
      init: "",
      timeline: `
      tl.fromTo("#${id} .${id}-pill", { opacity: 0, x: ${Math.round(fromX * u)} },
        { opacity: 1, x: 0, duration: ${intro}, ease: "power3.out" }, ${r3(t.start)});
      tl.fromTo("#${id} .${id}-at", { rotation: -120, scale: 0.4 },
        { rotation: 0, scale: 1, duration: ${intro}, ease: "back.out(2)" }, ${r3(t.start + 0.05)});
      tl.to("#${id} .${id}-pill", { opacity: 0, x: ${Math.round(fromX * 0.6 * u)}, duration: ${exit}, ease: "power2.in" }, ${r3(t.end - exit)});`,
    };
  },
};

// How a drag on the preview maps to params (see the UI's drag handles):
//   { key }         — sets params[key] = "free" and x / y to the box's new centre
//   { delta: true } — adds the move to x / y (the arrow's target)
highlight.drag = { key: "position" };
keywords.drag = { key: "position" };
counter.drag = { key: "position", pin: PIN };
bullets.drag = { key: "side" };
cta.drag = { key: "position" };
logo.drag = { key: "corner" };
arrow.drag = { delta: true, pin: PIN, pinKey: "attach" };
circle.drag = { delta: true, pin: PIN, pinKey: "attach" };
emoji.drag = { delta: true, pin: PIN, pinKey: "attach" };
// Pinned to the scenery: laid out on the stage, their spot followed.
counter.space = spaceBy("position");
counter.pin = { key: "position" };
for (const e of [arrow, circle, emoji]) {
  e.space = spaceBy("attach");
  e.pin = { key: "attach" };
}
quote.drag = { key: "position" };
notification.drag = { key: "position" };
social.drag = { key: "position" };

export const ANIM_EFFECTS = [
  highlight, keywords, quote, bullets, counter, arrow, circle, emoji, notification, social, cta, logo,
  chapter, wipe, progress,
]
  .map((e) => Object.assign(e, { category: "Animations" }));
