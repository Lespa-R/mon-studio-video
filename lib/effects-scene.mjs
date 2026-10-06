// Effects pinned to the scenery (lib/pins.mjs) — they stay on their spots
// while the camera moves:
//
//   sun-flare   a lens flare on the sun (or a lamp): glow, halo, streak, and
//               ghosts mirrored through the middle of the frame
//   route       a line drawn across the landscape through 2–4 spots, from a
//               start to an arrival
//
// Stage space (source px). Each spot is followed on its own (a route asks for
// several: pinPoints); a ghost of the flare moves like the sun scaled through
// the frame's centre, so it is the sun's own track, stretched.

import { timingOf } from "./timing.mjs";
import { paint, paintAlpha } from "./brand.mjs";
import { esc, num, clamp, r1, r3, viewOf, unitOf } from "./util.mjs";
import { span, pointAt } from "./keyframes.mjs";
import { pinAtField, pinnedPath, pinTimeline, simplifyPin, spotRequest } from "./pins.mjs";

// ---------------------------------------------------------------- sun-flare

const sunFlare = {
  type: "sun-flare",
  label: "Reflet de soleil",
  hint: "Un reflet d'objectif accroché au soleil (ou à une lampe) : il reste dessus quand la caméra bouge, ses reflets glissent à travers l'image. Fais glisser le soleil du reflet sur le vrai soleil.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "color", label: "Teinte", type: "color", default: "#ffcf87" },
    { key: "size", label: "Taille", type: "range", min: 0.3, max: 3, step: 0.05, default: 1 },
    { key: "intensity", label: "Intensité", type: "range", min: 0.1, max: 1, step: 0.05, default: 0.8 },
    {
      key: "ghosts", label: "Reflets", type: "select", default: "yes",
      options: [{ value: "yes", label: "Avec les reflets" }, { value: "no", label: "Le halo seulement" }],
    },
    {
      key: "streak", label: "Trait horizontal", type: "select", default: "yes",
      options: [{ value: "yes", label: "Oui" }, { value: "no", label: "Non" }],
    },
    {
      key: "behind", label: "Les personnes passent", type: "select", default: "front",
      options: [
        { value: "front", label: "Sous le reflet (comme sur l'objectif)" },
        { value: "behind", label: "Devant le reflet (découpe)" },
      ],
    },
    { key: "x", label: "Horizontal (%)", type: "range", min: 0, max: 100, step: 0.1, default: 50 },
    { key: "y", label: "Vertical (%)", type: "range", min: 0, max: 100, step: 0.1, default: 35 },
    pinAtField(),
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const u = unitOf(video) * clamp(num(p.size, 1), 0.1, 6);
    const ax = video.width * clamp(num(p.x, 50), 0, 100) / 100;
    const ay = video.height * clamp(num(p.y, 35), 0, 100) / 100;
    const tint = paint(p.color, "#ffcf87");
    const peak = clamp(num(p.intensity, 0.8), 0.05, 1);
    const view = viewOf(video);
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    const R = Math.round(60 * u);
    const path = pinnedPath(video, fx.id, t);
    // A ghost at fraction f sits at S + 2f (C − S): it moves (1 − 2f) times
    // as far as the sun — the other way past the middle.
    const GHOSTS = p.ghosts === "no" ? [] : [
      { f: 0.32, r: 0.55, a: 0.35, ring: false },
      { f: 0.55, r: 0.28, a: 0.45, ring: false },
      { f: 0.78, r: 0.9, a: 0.18, ring: true },
      { f: 1.1, r: 0.4, a: 0.3, ring: false },
    ];
    const ghostAt = (g) => ({ x: ax + 2 * g.f * (cx - ax), y: ay + 2 * g.f * (cy - ay) });
    const ghostPath = (g) => path && path.map((q) => ({
      ...q,
      x: ghostAt(g).x + (q.x - ax) * (1 - 2 * g.f),
      y: ghostAt(g).y + (q.y - ay) * (1 - 2 * g.f),
    }));
    const ramp = r3(Math.min(0.6, t.duration / 4));
    const behind = p.behind === "behind";
    return {
      layer: behind ? "behind" : "front",
      needsMatte: behind,
      timing: t,
      css: `
      #${id} { z-index: ${behind ? 12 : 65}; pointer-events: none; mix-blend-mode: screen; opacity: 0; }
      #${id} .${id}-m { position: absolute; inset: 0; }
      #${id}-sun { position: absolute; left: ${r1(ax - R * 3)}px; top: ${r1(ay - R * 3)}px; width: ${R * 6}px; height: ${R * 6}px; border-radius: 50%;
        background: radial-gradient(circle, rgba(255,255,255,.95) 0%, ${tint} 9%, ${paintAlpha(p.color, 0.35, "#ffcf87")} 22%, transparent 62%); }
      #${id}-halo { position: absolute; left: ${r1(ax - R * 4)}px; top: ${r1(ay - R * 4)}px; width: ${R * 8}px; height: ${R * 8}px; border-radius: 50%;
        background: radial-gradient(circle, transparent 52%, ${paintAlpha(p.color, 0.22, "#ffcf87")} 58%, transparent 66%); }
      #${id}-streak { position: absolute; left: ${r1(ax - R * 9)}px; top: ${r1(ay - R * 0.18)}px; width: ${R * 18}px; height: ${Math.max(2, Math.round(R * 0.36))}px;
        border-radius: 50%; background: radial-gradient(ellipse, rgba(255,255,255,.75) 0%, ${paintAlpha(p.color, 0.4, "#ffcf87")} 30%, transparent 70%); }
${GHOSTS.map((g, i) => {
    const at = ghostAt(g);
    const r = Math.round(R * g.r);
    return `      #${id}-g${i} { position: absolute; left: ${r1(at.x - r)}px; top: ${r1(at.y - r)}px; width: ${r * 2}px; height: ${r * 2}px; border-radius: 50%;
        background: ${g.ring
      ? `radial-gradient(circle, transparent 62%, ${paintAlpha(p.color, g.a, "#ffcf87")} 70%, transparent 80%)`
      : `radial-gradient(circle, ${paintAlpha(p.color, g.a, "#ffcf87")} 0%, ${paintAlpha(p.color, g.a * 0.6, "#ffcf87")} 55%, transparent 72%)`}; }`;
  }).join("\n")}`,
      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}" data-track-index="41" data-layout-allow-overflow>
        <div id="${id}-mv" class="${id}-m" style="transform-origin: ${r1(ax)}px ${r1(ay)}px">
          <div id="${id}-halo"></div>${p.streak === "no" ? "" : `<div id="${id}-streak"></div>`}<div id="${id}-sun" data-drag="${id}"></div>
          <i id="${id}-anchor" style="position: absolute; left: ${r1(ax)}px; top: ${r1(ay)}px"></i>
        </div>
${GHOSTS.map((g, i) => `        <div id="${id}-gm${i}" class="${id}-m"><div id="${id}-g${i}"></div></div>`).join("\n")}
      </div>`,
      init: "",
      timeline: (path ? pinTimeline(`#${id}-mv`, path, { x: ax, y: ay }) + "\n"
        + GHOSTS.map((g, i) => pinTimeline(`#${id}-gm${i}`, ghostPath(g), ghostAt(g))).join("\n") + "\n" : "") + `
      tl.fromTo("#${id}", { opacity: 0 }, { opacity: ${r3(peak)}, duration: ${ramp}, ease: "power2.out" }, ${t.start});
      tl.to("#${id}", { opacity: 0, duration: ${ramp}, ease: "power2.in" }, ${r3(t.end - ramp)});`,
    };
  },
  drag: { stage: true, pin: true },
  pin: {},
};

// -------------------------------------------------------------------- route

const POINTS = 4;
const routeXY = [[22, 78], [40, 55], [62, 40], [80, 26]];

const route = {
  type: "route",
  label: "Tracé d'itinéraire",
  hint: "Une ligne se dessine à travers le paysage, d'un point de départ à une arrivée (jusqu'à 4 points), et reste accrochée au décor quand la caméra bouge. Fais glisser chaque point sur son endroit.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    { key: "from", label: "Départ", type: "text", default: "Départ" },
    { key: "to", label: "Arrivée", type: "text", default: "Sommet" },
    {
      key: "count", label: "Nombre de points", type: "select", default: "3",
      options: [{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }],
    },
    { key: "color", label: "Couleur", type: "color", default: "brand:primary" },
    {
      key: "style", label: "Trait", type: "select", default: "dash",
      options: [{ value: "solid", label: "Plein" }, { value: "dash", label: "Pointillé" }],
    },
    { key: "thickness", label: "Épaisseur", type: "range", min: 2, max: 20, step: 1, default: 7 },
    { key: "draw", label: "Durée du tracé (s)", type: "number", min: 0.2, step: 0.1, default: 1.6 },
    ...Array.from({ length: POINTS }, (_, i) => [
      { key: `x${i}`, label: `Point ${i + 1} — horizontal (%)`, type: "range", min: 0, max: 100, step: 0.1, default: routeXY[i][0] },
      { key: `y${i}`, label: `Point ${i + 1} — vertical (%)`, type: "range", min: 0, max: 100, step: 0.1, default: routeXY[i][1] },
      pinAtField(`pinAt${i}`, `Point ${i + 1} posé à (s)`),
    ]).flat(),
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const n = clamp(Math.round(num(p.count, 3)), 2, POINTS);
    const u = unitOf(video);
    const W = video.width;
    const H = video.height;
    const pts = Array.from({ length: n }, (_, i) => {
      const x = W * clamp(num(p[`x${i}`], routeXY[i][0]), 0, 100) / 100;
      const y = H * clamp(num(p[`y${i}`], routeXY[i][1]), 0, 100) / 100;
      return { x, y, path: pinnedPath(video, `${fx.id}:${i}`, t) };
    });
    const c = paint(p.color, "brand:primary");
    const stroke = Math.max(2, Math.round(clamp(num(p.thickness, 7), 1, 40) * u));
    const dot = Math.round(11 * u);
    const draw = r3(Math.min(clamp(num(p.draw, 1.6), 0.1, 30), t.duration * 0.6));
    const segDraw = r3(draw / (n - 1));
    const exit = r3(Math.min(0.4, t.duration / 6));
    const dash = p.style === "solid" ? "" : `stroke-dasharray: ${Math.round(stroke * 2.2)} ${Math.round(stroke * 1.8)};`;
    // Each line follows both its ends in one series of tweens (x1 y1 x2 y2
    // at every keyframe of either end): tweens of one element's attributes
    // must not overlap, even for different attributes.
    const lineTweens = (k, a, b) => {
      if (!a.path && !b.path) return "";
      const ends = [a, b].map((q) => (q.path ? simplifyPin(q.path, 1) : [{ t: t.start, x: q.x, y: q.y }]));
      const times = [...new Set(ends.flat().map((q) => q.t))].sort((x, y) => x - y);
      const state = (at) => {
        const [p0, p1] = ends.map((keys) => pointAt(keys, at));
        return `attr: { x1: ${r1(p0.x)}, y1: ${r1(p0.y)}, x2: ${r1(p1.x)}, y2: ${r1(p1.y)} }`;
      };
      const out = [`      tl.set("#${id}-l${k}", { ${state(times[0])} }, ${times[0]});`];
      for (let i = 1; i < times.length; i++) {
        const d = span(times[i - 1], times[i]);
        if (d > 0) out.push(`      tl.to("#${id}-l${k}", { ${state(times[i])}, duration: ${d}, ease: "none" }, ${times[i - 1]});`);
      }
      return out.join("\n");
    };
    const labelFor = (i) => (i === 0 ? p.from : i === n - 1 ? p.to : "");
    return {
      layer: "front",
      needsMatte: false,
      timing: t,
      css: `
      #${id} { z-index: 66; pointer-events: none; }
      #${id} svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
      #${id} line { opacity: 0; stroke: ${c}; stroke-width: ${stroke}; stroke-linecap: round; ${dash}
        filter: drop-shadow(0 3px 6px rgba(6,12,22,.45)); }
      #${id} .${id}-m { position: absolute; inset: 0; }
      #${id} .${id}-d { position: absolute; width: ${dot * 2}px; height: ${dot * 2}px; margin: -${dot}px 0 0 -${dot}px; border-radius: 50%;
        background: ${c}; box-shadow: 0 0 0 ${Math.max(2, Math.round(3 * u))}px rgba(255,255,255,.95), 0 4px 12px rgba(6,12,22,.45); opacity: 0; }
      #${id} .${id}-lab { position: absolute; margin-top: -${dot + Math.round(10 * u)}px; white-space: nowrap; opacity: 0;
        font-family: var(--font-title); font-weight: 800; font-size: ${Math.round(26 * u)}px; color: var(--brand-text);
        background: ${paintAlpha("brand:surface", 0.8)}; padding: ${Math.round(5 * u)}px ${Math.round(12 * u)}px; border-radius: ${Math.round(10 * u)}px; }`,
      html: `
      <div id="${id}" class="clip" data-start="0" data-duration="${video.duration}" data-track-index="42" data-layout-allow-overflow>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
${pts.slice(1).map((b, k) => `          <line id="${id}-l${k}" x1="${r1(pts[k].x)}" y1="${r1(pts[k].y)}" x2="${r1(b.x)}" y2="${r1(b.y)}" />`).join("\n")}
        </svg>
${pts.map((q, i) => `        <div id="${id}-m${i}" class="${id}-m" style="transform-origin: ${r1(q.x)}px ${r1(q.y)}px">
          <div class="${id}-d" style="left: ${r1(q.x)}px; top: ${r1(q.y)}px" data-drag="${id}" data-drag-pt="${i}"></div>${labelFor(i) ? `
          <div class="${id}-lab" style="left: ${r1(q.x)}px; top: ${r1(q.y)}px">${esc(labelFor(i))}</div>` : ""}
          <i id="${id}-anchor${i}" style="position: absolute; left: ${r1(q.x)}px; top: ${r1(q.y)}px"></i>
        </div>`).join("\n")}
      </div>`,
      init: "",
      timeline: pts.map((q, i) => (q.path ? pinTimeline(`#${id}-m${i}`, q.path, { x: q.x, y: q.y }) : "")).filter(Boolean).join("\n") + "\n"
        + pts.slice(1).map((b, k) => lineTweens(k, pts[k], b)).filter(Boolean).join("\n") + `
      tl.fromTo("#${id} .${id}-d", { opacity: 0, scale: 0.3 }, { opacity: 1, scale: 1, duration: 0.25, ease: "back.out(2.5)", stagger: ${segDraw} }, ${t.start});
${pts.slice(1).map((_, k) => `      tl.fromTo("#${id}-l${k}", { opacity: 0 }, { opacity: 1, duration: ${r3(segDraw * 0.6)}, ease: "power2.out" }, ${r3(t.start + k * segDraw + 0.1)});`).join("\n")}
      tl.fromTo("#${id} .${id}-lab", { opacity: 0, xPercent: -50, yPercent: -100, y: 8 }, { opacity: 1, xPercent: -50, yPercent: -100, y: 0, duration: 0.3, ease: "power2.out", stagger: ${r3(Math.max(0.05, draw - 0.3))} }, ${r3(t.start + 0.1)});
      tl.to("#${id}", { opacity: 0, duration: ${exit}, ease: "power2.in" }, ${r3(t.end - exit)});`,
    };
  },
  // Each point is dragged on its own and pinned where it lands.
  drag: { stage: true, pin: true, points: true },
  // One spot per point.
  pinPoints(fx, duration) {
    const p = fx.params || {};
    const n = clamp(Math.round(num(p.count, 3)), 2, POINTS);
    return Array.from({ length: n }, (_, i) =>
      spotRequest(p[`x${i}`], p[`y${i}`], p[`pinAt${i}`], fx.start, duration, { x: routeXY[i][0], y: routeXY[i][1] }));
  },
};

export const SCENE_EFFECTS = [sunFlare, route];
