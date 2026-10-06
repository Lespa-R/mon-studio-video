// Effects that follow a subject — a person, an object clicked in the effect,
// a spot of the scenery or a fixed point (lib/follow.mjs, « Sujet »):
//
//   spotlight      the scenery darkens, a round of light follows the subject
//   follow-tag     a label hanging on the subject (above, below, beside it)
//   tracker        a « lock-on » viewfinder: corner brackets, a tag, live coordinates
//   orbit-text     a ring of text turning around the subject, behind then in front
//
// All on the stage (source pixels). Each sits in a "mover" whose origin is
// where the subject starts; boxTimeline() slides it along the subject's path
// and fades it while the subject is out of sight. A marker in the mover
// (`<id>-anchor`) sits on the subject: when the subject is a spot of the
// scenery, a drop on the preview re-pins it where the marker is now.

import { timingOf, overlayTimeline } from "./timing.mjs";
import { paint, paintAlpha } from "./brand.mjs";
import { esc, num, clamp, r1, r3, unitOf, jsString } from "./util.mjs";
import { PIN } from "./pins.mjs";
import { sourceFields, followBoxes, followsPeople, boxTimeline, boxTweens, sizeTimeline } from "./follow.mjs";

// Until the subject has been followed (or when it cannot be), the effect
// stands where x / y say — the user still sees it and can drag it.
const subjectPath = (fx, video, t, size) => followBoxes(fx, video, t, { size, still: true });

// The same path, moved: each box's point at `at(q)` (e.g. above its top).
const shifted = (path, at) => path.map((q) => ({ ...q, ...at(q) }));

// The marker on the subject, inside the mover.
const anchor = (id, q) => `<i id="${id}-anchor" style="position: absolute; left: ${r1(q.x)}px; top: ${r1(q.y)}px"></i>`;

// A drag only means something when the subject is a point: the fixed point
// moves, the scenery's spot is re-pinned.
const pointDrag = { stage: true, key: "source", pin: PIN, xy: true, only: [PIN, "fixed"] };

// ---------------------------------------------------------------- spotlight

const spotlight = {
  type: "spotlight",
  label: "Projecteur",
  hint: "Le décor s'assombrit, un rond de lumière suit le sujet : une personne, un objet que tu cliques ou un point du décor.",
  needsMatte: false,
  timed: true,
  layer: "behind",
  schema: [
    ...sourceFields("person:1"),
    { key: "size", label: "Taille du rond", type: "range", min: 0.4, max: 3, step: 0.05, default: 1.2 },
    { key: "darkness", label: "Obscurité", type: "range", min: 0.1, max: 0.95, step: 0.05, default: 0.7 },
    { key: "soft", label: "Bord adouci", type: "range", min: 0, max: 1, step: 0.05, default: 0.6 },
    {
      key: "keep", label: "Le sujet", type: "select", default: "lit",
      options: [
        { value: "lit", label: "Reste éclairé en entier (découpe)" },
        { value: "round", label: "Éclairé seulement dans le rond" },
      ],
    },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const path = subjectPath(fx, video, t, 0.3);
    const o = path[0];
    // The light is an oval around the subject's box (round for a point):
    // its half-axes, which grow and shrink with the subject.
    const k = clamp(num(p.size, 1.2), 0.2, 5) * 1.15;
    const axes = (q) => [Math.max(20, (q.w / 2) * k), Math.max(20, (q.h / 2) * k)];
    const [a, b] = axes(o);
    const soft = clamp(num(p.soft, 0.6), 0, 1);
    // A pane centred on the subject, big enough to darken the whole frame
    // wherever the subject goes: its gradient is clear within the oval and
    // dark beyond. The oval's size is a pair of CSS variables GSAP tweens,
    // so the pane itself is never scaled.
    const big = Math.round(Math.max(video.width, video.height) * 1.3);
    const dark = `rgba(2,4,8,${r3(clamp(num(p.darkness, 0.7), 0, 1))})`;
    const lit = p.keep !== "round";
    return {
      layer: "behind",
      needsMatte: lit,
      timing: t,
      // Under the subject and under text behind the subject (z 9).
      css: `
      #${id}-mv { position: absolute; inset: 0; z-index: 9; pointer-events: none; }
      #${id} { position: absolute; left: ${r1(o.x - big)}px; top: ${r1(o.y - big)}px; width: ${big * 2}px; height: ${big * 2}px; opacity: 0;
        --rx: ${r1(a)}px; --ry: ${r1(b)}px;
        background: radial-gradient(var(--rx) var(--ry) at 50% 50%, rgba(2,4,8,0) ${Math.round(100 - soft * 55)}%, ${dark} 100%); }
      #${id}-hit { position: absolute; left: ${r1(o.x)}px; top: ${r1(o.y)}px; width: ${r1(a * 2)}px; height: ${r1(b * 2)}px;
        transform: translate(-50%, -50%); }`,
      html: `
      <div id="${id}-mv" class="clip" data-start="0" data-duration="${video.duration}" data-track-index="2" data-layout-allow-overflow>
        <div id="${id}" data-layout-allow-overflow></div><div id="${id}-hit" data-drag="${id}"></div>${anchor(id, o)}
      </div>`,
      init: "",
      timeline: [
        overlayTimeline(`#${id}`, t, 1, 0.45),
        boxTimeline(`#${id}-mv`, path, o),
        boxTweens(`#${id}`, path, (q) => `"--rx": "${r1(axes(q)[0])}px", "--ry": "${r1(axes(q)[1])}px"`),
        sizeTimeline(`#${id}-hit`, path, { k, min: 40 }),
      ].join("\n"),
    };
  },
  needsTracks: followsPeople,
  drag: pointDrag,
  pin: { key: "source" },
};

// --------------------------------------------------------------- follow-tag

const PLACES = {
  above: { label: "Au-dessus", at: (q, gap) => ({ y: q.y - q.h / 2 - gap }), x: -50, y: -100 },
  below: { label: "En dessous", at: (q, gap) => ({ y: q.y + q.h / 2 + gap }), x: -50, y: 0 },
  left: { label: "À gauche", at: (q, gap) => ({ x: q.x - q.w / 2 - gap }), x: -100, y: -50 },
  right: { label: "À droite", at: (q, gap) => ({ x: q.x + q.w / 2 + gap }), x: 0, y: -50 },
  center: { label: "Au centre", at: () => ({}), x: -50, y: -50 },
};

const followTag = {
  type: "follow-tag",
  label: "Étiquette qui suit",
  hint: "Une étiquette accrochée à un objet que tu cliques (une planche, un vélo, un produit), à une personne ou à un point du décor, qui le suit.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "title", label: "Titre", type: "text", default: "Ma planche" },
    { key: "subtitle", label: "Sous-titre", type: "text", default: "" },
    ...sourceFields("object"),
    {
      key: "place", label: "Position", type: "select", default: "above",
      options: Object.entries(PLACES).map(([value, d]) => ({ value, label: d.label })),
    },
    { key: "accent", label: "Accent", type: "color", default: "brand:primary" },
    { key: "size", label: "Taille", type: "range", min: 0.5, max: 2.5, step: 0.05, default: 1 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const u = unitOf(video) * clamp(num(p.size, 1), 0.3, 4);
    const place = PLACES[p.place] || PLACES.above;
    const gap = Math.round(12 * u);
    const boxes = subjectPath(fx, video, t, 0.12);
    const path = shifted(boxes, (q) => place.at(q, gap));
    const o = path[0];
    const pop = r3(Math.min(0.3, t.duration / 4));
    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `
      #${id}-mv { position: absolute; inset: 0; z-index: 63; pointer-events: none; }
      #${id} { position: absolute; left: ${r1(o.x)}px; top: ${r1(o.y)}px; opacity: 0; white-space: nowrap; text-align: center;
        padding: ${Math.round(8 * u)}px ${Math.round(16 * u)}px; border-radius: ${Math.round(12 * u)}px;
        background: ${paintAlpha("brand:surface", 0.8)}; color: var(--brand-text);
        border-bottom: ${Math.max(2, Math.round(4 * u))}px solid ${paint(p.accent, "brand:primary")};
        box-shadow: 0 8px 22px rgba(6,12,22,.35); }
      #${id} .${id}-t { font-family: var(--font-title); font-weight: 800; font-size: ${Math.round(26 * u)}px; line-height: 1.15; }
      #${id} .${id}-s { font-family: var(--font-body); font-size: ${Math.round(16 * u)}px; opacity: .78; margin-top: ${Math.round(2 * u)}px; }`,
      html: `
      <div id="${id}-mv" class="clip" data-start="0" data-duration="${video.duration}" data-track-index="36" data-layout-allow-overflow>
        <div id="${id}" data-drag="${id}"><div class="${id}-t">${esc(p.title)}</div>${p.subtitle ? `<div class="${id}-s">${esc(p.subtitle)}</div>` : ""}</div>${anchor(id, boxes[0])}
      </div>`,
      init: "",
      // Anchored by xPercent / yPercent (never a CSS translate GSAP would
      // read back in pixels).
      timeline: boxTimeline(`#${id}-mv`, path, o) + `
      tl.fromTo("#${id}", { opacity: 0, scale: 0.7, xPercent: ${place.x}, yPercent: ${place.y} },
        { opacity: 1, scale: 1, xPercent: ${place.x}, yPercent: ${place.y}, duration: ${pop}, ease: "back.out(2)" }, ${t.start});
      tl.to("#${id}", { opacity: 0, scale: 0.8, duration: ${pop}, ease: "power2.in" }, ${r3(t.end - pop)});`,
    };
  },
  needsTracks: followsPeople,
  drag: pointDrag,
  pin: { key: "source" },
};

// ------------------------------------------------------------------ tracker

const tracker = {
  type: "tracker",
  label: "Viseur de suivi",
  hint: "Un viseur se verrouille sur le sujet : crochets d'angle, une étiquette et ses coordonnées en direct, qui le suivent.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "label", label: "Étiquette", type: "text", default: "CIBLE 01" },
    ...sourceFields("person:1"),
    { key: "color", label: "Couleur", type: "color", default: "#3ddc84" },
    {
      key: "data", label: "Données", type: "select", default: "coords",
      options: [
        { value: "coords", label: "Coordonnées en direct" },
        { value: "none", label: "Aucune" },
      ],
    },
    { key: "pad", label: "Marge autour", type: "range", min: 0, max: 0.5, step: 0.01, default: 0.08 },
    { key: "thickness", label: "Épaisseur", type: "range", min: 1, max: 10, step: 0.5, default: 3 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const u = unitOf(video);
    const path = subjectPath(fx, video, t, 0.25);
    const o = path[0];
    const pad = Math.round(Math.min(video.width, video.height) * clamp(num(p.pad, 0.08), 0, 1) / 2);
    const c = paint(p.color, "#3ddc84");
    const line = Math.max(1, Math.round(clamp(num(p.thickness, 3), 0.5, 20) * u));
    const arm = Math.round(28 * u);
    const lock = r3(Math.min(0.45, t.duration / 4));
    // The centre dot blinks in whole periods that fit in the window.
    const blinks = Math.floor(t.duration / 0.4);
    // Coordinates, refreshed ten times a second as a series of sets (seekable,
    // no callbacks): where the subject's centre is, in source pixels.
    const data = p.data !== "none";
    const sets = [];
    if (data) {
      let last = "";
      let j = 0;
      for (let at = t.start; at <= t.end + 1e-6; at += 0.1) {
        while (j + 1 < path.length && Math.abs(path[j + 1].t - at) <= Math.abs(path[j].t - at)) j++;
        const q = path[j];
        const text = `X ${String(Math.round(q.x)).padStart(4, "0")} · Y ${String(Math.round(q.y)).padStart(4, "0")}`;
        if (text === last) continue;
        last = text;
        sets.push(`      tl.set("#${id}-d", { textContent: ${jsString(text)} }, ${r3(at)});`);
      }
    }
    const corner = (v, h) => `<i class="${id}-c" style="${v}: 0; ${h}: 0; border-${v}: ${line}px solid; border-${h}: ${line}px solid"></i>`;
    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `
      #${id}-mv { position: absolute; inset: 0; z-index: 64; pointer-events: none; }
      #${id} { position: absolute; left: ${r1(o.x)}px; top: ${r1(o.y)}px; width: 0; height: 0; opacity: 0; }
      #${id}-lock { position: absolute; left: 0; top: 0; width: 0; height: 0; }
      #${id}-box { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); color: ${c};
        filter: drop-shadow(0 0 ${Math.round(4 * u)}px rgba(0,0,0,.6)); }
      #${id} .${id}-c { position: absolute; width: ${arm}px; height: ${arm}px; border-color: ${c}; }
      #${id} .${id}-dot { position: absolute; left: 50%; top: 50%; width: ${Math.round(8 * u)}px; height: ${Math.round(8 * u)}px;
        margin: -${Math.round(4 * u)}px 0 0 -${Math.round(4 * u)}px; border-radius: 50%; background: ${c}; }
      #${id} .${id}-tag { position: absolute; left: 0; bottom: 100%; margin-bottom: ${Math.round(6 * u)}px; white-space: nowrap;
        font: 700 ${Math.round(18 * u)}px/1 Menlo, ui-monospace, monospace; letter-spacing: 0.08em;
        color: #06110a; background: ${c}; padding: ${Math.round(4 * u)}px ${Math.round(8 * u)}px; }
      #${id} .${id}-data { position: absolute; left: 0; top: 100%; margin-top: ${Math.round(6 * u)}px; white-space: nowrap;
        font: 600 ${Math.round(15 * u)}px/1 Menlo, ui-monospace, monospace; color: ${c}; letter-spacing: 0.05em;
        text-shadow: 0 1px 3px rgba(0,0,0,.8); }`,
      html: `
      <div id="${id}-mv" class="clip" data-start="0" data-duration="${video.duration}" data-track-index="37" data-layout-allow-overflow>
        <div id="${id}"><div id="${id}-lock"><div id="${id}-box" data-drag="${id}">
          ${corner("top", "left")}${corner("top", "right")}${corner("bottom", "left")}${corner("bottom", "right")}
          <i class="${id}-dot"></i>
          <div class="${id}-tag">${esc(p.label)}</div>
          ${data ? `<div id="${id}-d" class="${id}-data"></div>` : ""}
        </div></div></div>${anchor(id, o)}
      </div>`,
      init: "",
      // Lock-on: the brackets close in from wider, then stay on the subject.
      timeline: [
        boxTimeline(`#${id}-mv`, path, o),
        sizeTimeline(`#${id}-box`, path, { k: 1, pad, min: arm * 2.4 }),
        overlayTimeline(`#${id}`, t, 1, 0.15),
        `      tl.fromTo("#${id}-lock", { scale: 1.7 }, { scale: 1, duration: ${lock}, ease: "power3.out" }, ${t.start});`,
        blinks >= 2 ? `      tl.fromTo("#${id} .${id}-dot", { opacity: 1 }, { opacity: 0.2, duration: 0.4, ease: "steps(1)", repeat: ${blinks - 1}, yoyo: true }, ${t.start});` : "",
        ...sets,
      ].filter(Boolean).join("\n"),
    };
  },
  needsTracks: followsPeople,
  drag: pointDrag,
  pin: { key: "source" },
};

// --------------------------------------------------------------- orbit-text

const orbitText = {
  type: "orbit-text",
  label: "Texte en orbite",
  hint: "Un anneau de texte tourne autour du sujet : il passe derrière lui, puis devant. Nécessite la découpe.",
  needsMatte: true,
  timed: true,
  layer: "behind",
  schema: [
    { key: "text", label: "Texte", type: "text", default: "Nouvelle vidéo • Abonne-toi • " },
    ...sourceFields("person:1"),
    { key: "color", label: "Couleur", type: "color", default: "brand:text" },
    { key: "size", label: "Taille du texte", type: "range", min: 0.3, max: 3, step: 0.05, default: 1 },
    { key: "radius", label: "Largeur de l'anneau (× sujet)", type: "range", min: 0.5, max: 4, step: 0.05, default: 1.9 },
    { key: "tilt", label: "Inclinaison", type: "range", min: 0.08, max: 0.6, step: 0.01, default: 0.22 },
    { key: "height", label: "Hauteur sur le sujet", type: "range", min: -0.5, max: 0.5, step: 0.01, default: -0.12 },
    { key: "speed", label: "Tours par seconde", type: "range", min: 0.05, max: 1, step: 0.01, default: 0.25 },
    {
      key: "direction", label: "Sens", type: "select", default: "right",
      options: [{ value: "right", label: "Devant, vers la droite" }, { value: "left", label: "Devant, vers la gauche" }],
    },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const boxes = subjectPath(fx, video, t, 0.35);
    const height = clamp(num(p.height, -0.12), -1, 1);
    const path = shifted(boxes, (q) => ({ y: q.y + q.h * height }));
    const o = path[0];
    const rx = Math.max(40, (boxes[0].w / 2) * clamp(num(p.radius, 1.9), 0.2, 6));
    const ry = rx * clamp(num(p.tilt, 0.22), 0.02, 1);
    const fs = Math.round(36 * unitOf(video) * clamp(num(p.size, 1), 0.2, 6));
    // One lap of the ellipse (Ramanujan). The text is repeated to about one
    // lap and stretched to exactly one (textLength); the path goes round
    // twice, so sliding the text by one lap loops seamlessly.
    const lap = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    const unit = String(p.text || " ");
    const unitLength = Math.max(1, unit.length * fs * 0.62);
    const reps = Math.max(1, Math.floor(lap / unitLength));
    const text = esc(unit.repeat(reps));
    // A text longer than the ring is narrowed to fit, not overlapped.
    const adjust = unitLength > lap ? "spacingAndGlyphs" : "spacing";
    // Left → bottom → right → top: the front half (bottom) reads upright.
    const half = `A ${r1(rx)} ${r1(ry)} 0 1 0 ${r1(rx)} 0 A ${r1(rx)} ${r1(ry)} 0 1 0 ${r1(-rx)} 0`;
    const d = `M ${r1(-rx)} 0 ${half} ${half}`;
    const laps = clamp(num(p.speed, 0.25), 0.01, 3) * t.duration;
    const whole = Math.max(1, Math.round(laps));
    const lapTime = r3(t.duration / whole);
    // Forwards along the path (0 → 50 %, one lap) the front half moves to the
    // right; backwards (50 → 0 %) to the left. Either way the text stays on
    // the doubled path.
    const [from, to] = p.direction === "left" ? [50, 0] : [0, 50];
    const ring = (side) => {
      // The back half (top) sits behind the subject, the front half before it.
      const clip = side === "back"
        ? `<rect x="${r1(-rx - fs * 2)}" y="${r1(-ry - fs * 2)}" width="${r1(rx * 2 + fs * 4)}" height="${r1(ry + fs * 2)}" />`
        : `<rect x="${r1(-rx - fs * 2)}" y="0" width="${r1(rx * 2 + fs * 4)}" height="${r1(ry + fs * 2)}" />`;
      return `
      <div id="${id}-${side}" class="clip ${id}-ring" data-start="0" data-duration="${video.duration}" data-track-index="${side === "back" ? 3 : 39}" data-layout-allow-overflow>
        <svg class="${id}-svg" width="1" height="1" style="left: ${r1(o.x)}px; top: ${r1(o.y)}px">
          <defs><path id="${id}-${side}-p" d="${d}" /><clipPath id="${id}-${side}-c">${clip}</clipPath></defs>
          <g clip-path="url(#${id}-${side}-c)"><text class="${id}-txt"${side === "front" ? ` data-drag="${id}"` : ""}><textPath id="${id}-${side}-tp" href="#${id}-${side}-p" startOffset="${from}%" textLength="${r1(lap)}" lengthAdjust="${adjust}">${text}</textPath></text></g>
        </svg>${side === "front" ? anchor(id, boxes[0]) : ""}
      </div>`;
    };
    // The rings (movers) carry the motion and the out-of-sight fades; their
    // SVGs fade in and out with the window — never the same property twice.
    const both = `#${id}-back .${id}-svg, #${id}-front .${id}-svg`;
    return {
      layer: "behind",
      needsMatte: true,
      timing: t,
      css: `
      #${id}-back { z-index: 11; pointer-events: none; }
      #${id}-front { z-index: 60; pointer-events: none; }
      #${id}-back .${id}-txt { opacity: 0.6; }
      .${id}-svg { position: absolute; overflow: visible; opacity: 0; }
      .${id}-txt { font-family: var(--font-title); font-weight: 800; font-size: ${fs}px; letter-spacing: 0.04em;
        fill: ${paint(p.color, "brand:text")}; dominant-baseline: middle;
        filter: drop-shadow(0 2px 6px rgba(6,12,22,.55)); }`,
      html: ring("back"),
      // The front half goes in front of the subject (compose: htmlFront).
      htmlFront: ring("front"),
      init: "",
      timeline: [
        boxTimeline(`#${id}-back`, path, o),
        boxTimeline(`#${id}-front`, path, o),
        overlayTimeline(both, t, 1, 0.4),
        `      tl.fromTo("#${id}-back-tp, #${id}-front-tp", { attr: { startOffset: "${from}%" } },
        { attr: { startOffset: "${to}%" }, duration: ${lapTime}, ease: "none", repeat: ${whole - 1} }, ${t.start});`,
      ].join("\n"),
    };
  },
  needsTracks: followsPeople,
  drag: pointDrag,
  pin: { key: "source" },
};

export const FOLLOW_EFFECTS = [spotlight, followTag, tracker, orbitText];
