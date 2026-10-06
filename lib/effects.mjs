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
import { personTags } from "./effects-people.mjs";
import { SUBJECT_EFFECTS } from "./effects-subject.mjs";
import { FOLLOW_EFFECTS } from "./effects-follow.mjs";
import { CAMERA_EFFECTS } from "./effects-camera.mjs";
import { SCENE_EFFECTS } from "./effects-scene.mjs";
import { BLUR_EFFECTS } from "./effects-blur.mjs";
import { timingOf } from "./timing.mjs";
import { paint, paintAlpha } from "./brand.mjs";
import { followPath, simplifyPath, pathTimeline } from "./tracking.mjs";
import { PIN, PIN_OPTION, pinFields, pinnedPath, pinTimeline, pinWrap } from "./pins.mjs";
import { esc, num, r3, jsString, viewOf } from "./util.mjs";

export { timingOf };

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
  rise: {
    // Letters climb from below their place: behind a ridge cut out with
    // « Objet choisi », the title rises from behind the mountain.
    label: "Lever (derrière un relief)", unit: "ch", ease: "power2.out", outEase: "power2.in",
    from: `opacity: 0, yPercent: 130`,
    to: `opacity: 1, yPercent: 0`,
    out: () => `opacity: 0, yPercent: 130`,
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

// Following a tracked person (lib/tracking.mjs). "all" follows the group.
export const PERSON_OPTIONS = [
  { value: "1", label: "Personne 1 (la plus à gauche)" },
  { value: "2", label: "Personne 2" },
  { value: "3", label: "Personne 3" },
  { value: "4", label: "Personne 4" },
  { value: "5", label: "Personne 5" },
  { value: "6", label: "Personne 6" },
  { value: "all", label: "Tout le groupe" },
];
// Nudges on top of the followed point, in % of the source frame; dragging the
// text on the preview writes them.
const offsetXY = (showIf) => [
  { key: "ox", label: "Décalage horizontal (%)", type: "range", min: -50, max: 50, step: 0.5, default: 0, showIf },
  { key: "oy", label: "Décalage vertical (%)", type: "range", min: -50, max: 50, step: 0.5, default: 0, showIf },
];

// A path to follow, or null when the clip has no tracks (yet) or not that
// person. Offsets are converted from % to source pixels.
function pathFor(p, video, t, height) {
  const path = followPath(video.people, p.person || "1", {
    from: t.start, to: t.end, height,
    offsetX: (num(p.ox, 0) / 100) * video.width,
    offsetY: (num(p.oy, 0) / 100) * video.height,
  });
  return path && path.length ? path : null;
}
// Free and pinned placements both use x / y (pinned: where the spot was at
// the moment it was put — see lib/pins.mjs).
const stageXY = (key, y = 30, values = ["free", PIN]) => [
  { key: "x", label: "Horizontal (%)", type: "range", min: 0, max: 100, step: 0.1, default: 50, showIf: { key, values } },
  { key: "y", label: "Vertical (%)", type: "range", min: 0, max: 100, step: 0.1, default: y, showIf: { key, values } },
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
  hint: "Le texte passe derrière la personne — de face, de dos ou de loin. Nécessite la découpe. Fais-le glisser sur l'aperçu pour le placer. Derrière une montagne : « Fixé dans le décor », animation « Lever », et « Objet choisi » sur la montagne dans Découpe.",
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
      options: [
        { value: "face", label: "Calé sur le visage" },
        { value: "follow", label: "Suit une personne (en mouvement)" },
        PIN_OPTION,
        FREE_OPTION,
      ],
    },
    ...pinFields({ key: "anchor", values: [PIN] }),
    { key: "person", label: "Personne suivie", type: "select", default: "1", options: PERSON_OPTIONS,
      showIf: { key: "anchor", values: ["follow"] } },
    { key: "height", label: "Hauteur sur la personne", type: "range", min: -0.3, max: 1, step: 0.01, default: 0.3,
      showIf: { key: "anchor", values: ["follow"] } },
    ...offsetXY({ key: "anchor", values: ["follow"] }),
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
    const t = timingOf(fx, video);
    // Following someone: the line rides along their track. Until the clip has
    // been tracked (or if that person does not exist) it falls back below.
    const path = p.anchor === "follow" ? pathFor(p, video, t, num(p.height, 0.3)) : null;
    // Pinned to the scenery: placed like free, then carried by the camera's
    // motion once the clip has been followed.
    const pinned = p.anchor === PIN;
    const pin = pinned ? pinnedPath(video, fx.id, t, p.pinFollow) : null;
    // Free when asked, and whenever no face was found (seen from behind, far
    // away): the cut-out still separates the person from the room.
    const free = !path && (p.anchor !== "face" || !face);

    const view = viewOf(video);
    const fontSize = Math.round(video.height * num(p.fontScale, 0.164));
    const maxWidth = Math.round(view.w * 0.92);
    const at = path
      ? { centreX: Math.round(path[0].x), inkTop: path[0].y }
      : free
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
      css: `${scrimId ? scrimCss(scrimId, scrim, 10) : ""}${path ? `
      /* Under the cut-out (50) like the text itself: the mover is a stacking
         context of its own once GSAP gives it a transform. */
      #${id}-mv { position: absolute; inset: 0; z-index: 11; }` : ""}
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

      // In a mover when it moves: along a person's path, or pinned (under
      // the cut-out, z 11, like the text).
      html: ((body) => (pinned ? pinWrap(id, centreX, inkTop, body, 11) : path ? `
      <div id="${id}-mv">${body}
      </div>` : body))(`
      ${scrimId ? `<div id="${scrimId}" class="clip" data-start="0"
        data-duration="${video.duration}" data-track-index="2"></div>` : ""}
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}"
        data-track-index="3" ${dragAttrs(id, centreX, inkTop)}>${chars(p.text, id)}</div>`),

      init: fitAndPlace(id, p.text, { maxWidth, inkTop, scrimId, viewX: view.x, viewW: view.w }),

      // The mover carries the person's (or the scenery's) motion; the letters
      // animate inside it.
      timeline: (path ? pathTimeline(`#${id}-mv`, simplifyPath(path)) + "\n" : "")
        + (pin ? pinTimeline(`#${id}-mv`, pin, { x: centreX, y: inkTop }) + "\n" : "") + textTimeline(id, scrimId, t, {
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

// Laid on a surface: the line tilted in perspective (posed on the ground, on
// a wall). Set by GSAP at time 0 — after the setup script has measured the
// line flat, so its fitting and placing stay exact.
const TILTS = {
  none: { label: "Aucune (face caméra)", x: 0, y: 0 },
  ground: { label: "Posé au sol", x: 62, y: 0 },
  "wall-left": { label: "Sur un mur, à gauche", x: 0, y: 38 },
  "wall-right": { label: "Sur un mur, à droite", x: 0, y: -38 },
  custom: { label: "Personnalisée", x: 0, y: 0 },
};

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
        PIN_OPTION,
        FREE_OPTION,
      ],
    },
    ...pinFields({ key: "position", values: [PIN] }),
    ...stageXY("position", 70),
    {
      key: "tilt", label: "Perspective", type: "select", default: "none",
      options: Object.entries(TILTS).map(([value, d]) => ({ value, label: d.label })),
    },
    { key: "tiltX", label: "Inclinaison (°)", type: "range", min: -80, max: 80, step: 1, default: 45, showIf: { key: "tilt", values: ["custom"] } },
    { key: "tiltY", label: "Orientation (°)", type: "range", min: -70, max: 70, step: 1, default: 0, showIf: { key: "tilt", values: ["custom"] } },
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
      case "free":
      case PIN: ({ centreX, inkTop } = freeAt(p, video, 70)); break;
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
    const pinned = p.position === PIN;
    const pin = pinned ? pinnedPath(video, fx.id, t, p.pinFollow) : null;
    const tilt = TILTS[p.tilt] || TILTS.none;
    const tiltX = p.tilt === "custom" ? num(p.tiltX, 45) : tilt.x;
    const tiltY = p.tilt === "custom" ? num(p.tiltY, 0) : tilt.y;
    const tilted = tiltX !== 0 || tiltY !== 0;
    // Tilted: a wrapper laid in perspective around the line's middle.
    const lay = (inner) => (tilted ? `
      <div id="${id}-tilt" class="clip" data-start="0" data-duration="${video.duration}" data-layout-allow-overflow style="z-index: 61">${inner}
      </div>` : inner);
    const body = lay(`
      ${scrimId ? `<div id="${scrimId}" class="clip" data-start="0"
        data-duration="${video.duration}" data-track-index="6"></div>` : ""}
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}"
        data-track-index="7" ${dragAttrs(id, centreX, inkTop)}>${chars(p.text, id)}</div>`);
    // The tilt is set once the line has been measured flat (the setup may
    // run after the timeline's first seek, when a brand font loads late).
    const tiltSetup = tilted ? `
      (function () {
        var el = document.getElementById(${jsString(`${id}-tilt`)});
        if (!el) return;
        el.style.transformOrigin = "${centreX}px ${Math.round(inkTop + fontSize * 0.36)}px";
        el.style.transform = "perspective(${Math.round(Math.max(video.width, video.height) * 1.1)}px) rotateX(${r3(tiltX)}deg) rotateY(${r3(tiltY)}deg)";
      })();` : "";

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

      html: pinned ? pinWrap(id, centreX, inkTop, body, 61) : body,

      init: fitAndPlace(id, p.text, { maxWidth, inkTop, scrimId, viewX: view.x, viewW: view.w }) + tiltSetup,

      timeline: (pin ? pinTimeline(`#${id}-mv`, pin, { x: centreX, y: inkTop }) + "\n" : "") + textTimeline(id, scrimId, t, {
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
    // Entrance (0.62 s) and exit both inside the window: squeezed when short.
    const exit = r3(Math.max(0, Math.min(num(p.exit, 0.4), t.duration / 3)));
    const k = Math.min(1, (t.duration - exit) / 0.62);
    const outAt = r3(t.end - exit);

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
        { scaleY: 1, duration: ${r3(0.45 * k)}, ease: "power3.out" }, ${r3(t.start)});
      tl.fromTo("#${id} .${id}-body", { opacity: 0, x: -${Math.round(28 * unit)} },
        { opacity: 1, x: 0, duration: ${r3(0.5 * k)}, ease: "power3.out" }, ${r3(t.start + 0.12 * k)});
      ${exit > 0 ? `tl.to("#${id}",
        { opacity: 0, x: -${Math.round(20 * unit)}, duration: ${exit}, ease: "power2.in" },
        ${outAt});` : ""}`,
    };
  },
};

// --------------------------------------------------------------- scene-label

// A landmark caption: a dot on a spot of the scenery, a stem, and a label —
// pinned to the spot while the camera moves (lib/pins.mjs). Stage space.
const sceneLabel = {
  type: "scene-label",
  label: "Repère dans le décor",
  hint: "Un point sur un endroit du décor (un bâtiment, une montagne, la mer) avec son étiquette, qui y reste accroché quand la caméra bouge. Fais-le glisser sur l'aperçu, à l'image où l'endroit se voit bien.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "title", label: "Titre", type: "text", default: "Le Morne" },
    { key: "subtitle", label: "Sous-titre", type: "text", default: "" },
    { key: "accent", label: "Accent", type: "color", default: "brand:primary" },
    {
      key: "side", label: "Étiquette", type: "select", default: "above",
      options: [
        { value: "above", label: "Au-dessus du point" },
        { value: "below", label: "En dessous du point" },
      ],
    },
    { key: "stem", label: "Longueur du trait", type: "range", min: 0, max: 3, step: 0.05, default: 1 },
    { key: "size", label: "Taille", type: "range", min: 0.5, max: 2.5, step: 0.05, default: 1 },
    {
      key: "behind", label: "Les personnes passent", type: "select", default: "front",
      options: [
        { value: "front", label: "Derrière l'étiquette" },
        { value: "behind", label: "Devant l'étiquette (découpe)" },
      ],
    },
    { key: "x", label: "Horizontal (%)", type: "range", min: 0, max: 100, step: 0.1, default: 50 },
    { key: "y", label: "Vertical (%)", type: "range", min: 0, max: 100, step: 0.1, default: 45 },
    ...pinFields(),
    { key: "exit", label: "Sortie (s)", type: "number", min: 0, step: 0.05, default: 0.4 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const view = viewOf(video);
    const behind = p.behind === "behind";
    const z = behind ? 11 : 63;
    const u = (Math.min(view.w, view.h) / 720) * Math.min(4, Math.max(0.3, num(p.size, 1)));
    const ax = Math.round(video.width * Math.min(100, Math.max(0, num(p.x, 50))) / 100);
    const ay = Math.round(video.height * Math.min(100, Math.max(0, num(p.y, 45))) / 100);
    const below = p.side === "below";
    const stem = Math.round(64 * u * Math.min(3, Math.max(0, num(p.stem, 1))));
    const dot = Math.max(4, Math.round(8 * u));
    const accent = paint(p.accent, "brand:primary");
    const pin = pinnedPath(video, fx.id, t, p.pinFollow);

    // Entrance 0.75 s and exit, both inside the window.
    const exit = Math.max(0, Math.min(num(p.exit, 0.4), t.duration / 3));
    const k = Math.min(1, (t.duration - exit) / 0.9);
    const at = (s) => r3(t.start + s * k);
    const outAt = r3(t.end - exit);

    return {
      layer: behind ? "behind" : "front",
      needsMatte: behind,
      timing: t,
      css: `
      #${id} { position: absolute; inset: auto; left: ${ax}px; top: ${ay}px; width: 0; height: 0; z-index: ${z}; }
      #${id} .${id}-dot {
        position: absolute; left: ${-dot}px; top: ${-dot}px; width: ${dot * 2}px; height: ${dot * 2}px;
        border-radius: 50%; background: ${accent}; box-shadow: 0 0 0 ${Math.max(2, Math.round(3 * u))}px rgba(255,255,255,.92), 0 4px 14px rgba(6,12,22,.45);
      }
      #${id} .${id}-ring {
        position: absolute; left: ${-dot * 2}px; top: ${-dot * 2}px; width: ${dot * 4}px; height: ${dot * 4}px;
        border-radius: 50%; border: ${Math.max(2, Math.round(2 * u))}px solid ${accent}; opacity: 0;
      }
      #${id} .${id}-stem {
        position: absolute; left: ${-Math.max(1, Math.round(1.5 * u))}px; width: ${Math.max(2, Math.round(3 * u))}px;
        ${below ? `top: ${dot}px;` : `top: ${-dot - stem}px;`} height: ${stem}px;
        background: linear-gradient(${below ? "to bottom" : "to top"}, ${accent}, rgba(255,255,255,.9));
        transform-origin: ${below ? "top" : "bottom"} center;
      }
      #${id} .${id}-card {
        position: absolute; left: 0; ${below ? `top: ${dot + stem}px;` : `bottom: ${dot + stem}px;`}
        width: max-content; max-width: ${Math.round(view.w * 0.8)}px;
        opacity: 0; white-space: nowrap; text-align: center;
        padding: ${Math.round(9 * u)}px ${Math.round(16 * u)}px; border-radius: ${Math.round(12 * u)}px;
        background: ${paintAlpha("brand:surface", 0.8)}; color: var(--brand-text);
        border-${below ? "top" : "bottom"}: ${Math.max(2, Math.round(4 * u))}px solid ${accent};
        box-shadow: 0 10px 26px rgba(6,12,22,.38);
      }
      #${id} .${id}-t { font-family: var(--font-title); font-weight: 800; font-size: ${Math.round(28 * u)}px; line-height: 1.15; letter-spacing: -0.01em; }
      #${id} .${id}-s { font-family: var(--font-body); font-size: ${Math.round(17 * u)}px; opacity: .8; margin-top: ${Math.round(3 * u)}px; }`,

      html: pinWrap(id, ax, ay, `
        <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}" data-track-index="38"
          data-anchor-x="${ax}" data-anchor-y="${ay}">
          <span class="${id}-ring"></span>
          <span class="${id}-stem"></span>
          <span class="${id}-dot" data-drag="${id}"></span>
          <div class="${id}-card" data-drag="${id}">
            <div class="${id}-t">${esc(p.title)}</div>${p.subtitle ? `<div class="${id}-s">${esc(p.subtitle)}</div>` : ""}
          </div>
        </div>`, z),

      init: "",

      // The card is centred on the stem with xPercent (not a CSS translate,
      // which GSAP would read back in pixels). Dot and stem start hidden
      // through their fromTo (which applies its "from" before it starts),
      // never through a CSS transform GSAP would overwrite.
      timeline: (pin ? pinTimeline(`#${id}-mv`, pin, { x: ax, y: ay }) + "\n" : "") + `
      tl.set("#${id} .${id}-card", { xPercent: -50 }, 0);
      tl.fromTo("#${id} .${id}-dot", { scale: 0 }, { scale: 1, duration: ${r3(0.3 * k)}, ease: "back.out(2.5)" }, ${at(0)});
      tl.fromTo("#${id} .${id}-ring", { scale: 0.4, opacity: 0.9 }, { scale: 1.6, opacity: 0, duration: ${r3(0.8 * k)}, ease: "power2.out" }, ${at(0.05)});
      tl.fromTo("#${id} .${id}-stem", { scaleY: 0 }, { scaleY: 1, duration: ${r3(0.3 * k)}, ease: "power3.out" }, ${at(0.15)});
      tl.fromTo("#${id} .${id}-card", { opacity: 0, y: ${below ? -10 : 10} * ${r3(u)} }, { opacity: 1, y: 0, duration: ${r3(0.4 * k)}, ease: "power3.out" }, ${at(0.35)});${exit > 0 ? `
      tl.to("#${id} .${id}-card", { opacity: 0, y: ${below ? -8 : 8} * ${r3(u)}, duration: ${r3(exit * 0.6)}, ease: "power2.in" }, ${outAt});
      tl.to("#${id} .${id}-stem", { scaleY: 0, duration: ${r3(exit * 0.5)}, ease: "power2.in" }, ${r3(outAt + exit * 0.3)});
      tl.to("#${id} .${id}-dot", { scale: 0, duration: ${r3(exit * 0.4)}, ease: "back.in(2)" }, ${r3(t.end - exit * 0.4)});` : ""}`,
    };
  },
  // Always pinned: a drop re-pins it where it lands, at that moment.
  drag: { stage: true, pin: true },
  pin: {},
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
behindText.drag = { key: "anchor", stage: true, follow: "follow", pin: PIN };
// Effects that need the clip's people tracked before they can be composed.
behindText.needsTracks = (fx) => fx.params?.anchor === "follow";
title.drag = { key: "position", stage: true, pin: PIN };
// Effects that can be pinned to the scenery (lib/pins.mjs): which select
// pins them; the server follows their spot before previewing or rendering.
behindText.pin = { key: "anchor" };
title.pin = { key: "position" };

// Each effect gets a category for the pickers; the order within one is the
// order of this list.
const TEXT = "Textes";
for (const e of [behindText, title, lowerThird]) e.category = TEXT;
// Effects that follow something — the subject's cut-out, a person, an
// object, a spot of the scenery.
const TRACK = "Suivi";
for (const e of [sceneLabel, ...SUBJECT_EFFECTS, ...FOLLOW_EFFECTS, ...CAMERA_EFFECTS, ...SCENE_EFFECTS, ...BLUR_EFFECTS]) e.category = TRACK;
for (const e of IMAGE_EFFECTS) e.category ??= "Image";
fade.category = "Image";

export const CATEGORIES = [TEXT, "Animations", TRACK, "Image"];

export const EFFECTS = [behindText, title, sceneLabel, lowerThird, personTags, ...SUBJECT_EFFECTS, ...FOLLOW_EFFECTS, ...CAMERA_EFFECTS, ...SCENE_EFFECTS, ...BLUR_EFFECTS, captions, ...ANIM_EFFECTS, ...IMAGE_EFFECTS, fade];

export const byType = (type) => EFFECTS.find((e) => e.type === type) || null;

export function defaultParams(type) {
  const effect = byType(type);
  if (!effect) return {};
  return Object.fromEntries(effect.schema.map((f) => [f.key, f.default]));
}

export const isTimed = (type) => Boolean(byType(type)?.timed);

// An effect's params for another clip (a preset, a paste): what only means
// something on the clip they were set on — an object clicked in it, the
// moment a spot was pinned (pinAt, pinAt0…) — goes back to its default.
export function portableParams(type, params) {
  const out = { ...params };
  for (const f of byType(type)?.schema || []) {
    if (f.type === "object" || /^pinAt\d*$/.test(f.key)) out[f.key] = f.default ?? null;
  }
  return out;
}

// What the UI needs to render its controls — no functions, JSON-safe.
export function catalogue() {
  return EFFECTS.map(({ type, label, hint, category, needsMatte, needsFace, timed, schema, drag }) => ({
    type, label, hint, category, needsMatte, needsFace: Boolean(needsFace), timed: Boolean(timed), schema,
    drag: drag || null,
  }));
}
